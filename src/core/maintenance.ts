import { config } from "../config.js";
import { memory } from "./memory.js";
import { listSkills, updateSkill } from "./skills.js";
import { log } from "../logger.js";

const BATCH_SIZE = 20;

export interface MaintenanceStats {
  lastRunAt?: number;
  memoriesCompacted: number;
  memoriesDeleted: number;
  memoriesMerged: number;
  skillsArchived: number;
}

/** Make a direct Anthropic API call for lightweight dedup analysis. */
async function callHaiku(prompt: string): Promise<string | null> {
  const apiKey = config.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((b) => b.type === "text")?.text ?? null;
  } catch {
    return null;
  }
}

class MaintenanceScheduler {
  private stats: MaintenanceStats = {
    memoriesCompacted: 0,
    memoriesDeleted: 0,
    memoriesMerged: 0,
    skillsArchived: 0,
  };
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  start(): void {
    if (this.timer || !config.MAINTENANCE_CRON) return;
    // Check every minute whether it's time to run.
    this.timer = setInterval(() => void this.checkAndRun(), 60_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  view(): MaintenanceStats {
    return { ...this.stats };
  }

  async runOnce(): Promise<MaintenanceStats> {
    if (this.running) return this.view();
    this.running = true;
    log.info("Maintenance run starting");
    const run: MaintenanceStats = {
      memoriesCompacted: 0,
      memoriesDeleted: 0,
      memoriesMerged: 0,
      skillsArchived: 0,
    };
    try {
      await this.compactMemories(run);
      this.pruneSkills(run);
      run.lastRunAt = Date.now();
      this.stats = run;
      log.info("Maintenance run complete", run as unknown as Record<string, unknown>);
    } catch (err) {
      log.error("Maintenance run failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.running = false;
    }
    return this.view();
  }

  private checkAndRun(): void {
    const spec = config.MAINTENANCE_CRON;
    if (!spec) return;
    const [hh, mm] = spec.split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return;
    const now = new Date();
    if (now.getHours() === hh && now.getMinutes() === mm) {
      // Only fire once per minute window.
      if (this.stats.lastRunAt && Date.now() - this.stats.lastRunAt < 90_000) return;
      void this.runOnce();
    }
  }

  private async compactMemories(run: MaintenanceStats): Promise<void> {
    const all = memory.allRaw();
    const counts = memory.countByTier();
    const total = counts.hot + counts.warm + counts.cold;

    // Step 1: demote lowest-salience warm entries to cold if over limit.
    if (total > config.MEMORY_MAX_ENTRIES) {
      const excess = total - config.MEMORY_MAX_ENTRIES;
      const warm = all
        .filter((e) => e.tier === "warm")
        .sort((a, b) => a.salience - b.salience);
      const toDemote = warm.slice(0, excess);
      for (const e of toDemote) {
        e.tier = "cold";
        run.memoriesCompacted++;
      }
      memory.replaceAll(all);
    }

    // Step 2: delete the coldest cold entries if still over COLD_MAX.
    const cold = all.filter((e) => e.tier === "cold");
    if (cold.length > config.COLD_MAX) {
      const toDelete = cold
        .sort((a, b) => a.salience - b.salience)
        .slice(0, cold.length - config.COLD_MAX);
      const deleteIds = new Set(toDelete.map((e) => e.id));
      memory.replaceAll(all.filter((e) => !deleteIds.has(e.id)));
      run.memoriesDeleted += deleteIds.size;
    }

    // Step 3: dedup warm entries in batches via haiku.
    const warm = memory.allRaw().filter((e) => e.tier === "warm");
    for (let i = 0; i < warm.length; i += BATCH_SIZE) {
      const batch = warm.slice(i, i + BATCH_SIZE);
      const numbered = batch.map((e, idx) => `${idx + 1}. [${e.id}] ${e.text}`).join("\n");
      const prompt =
        `Below are ${batch.length} memory entries. Which are duplicates or near-duplicates? ` +
        `Return ONLY a JSON array of pairs to merge: [{"keep":"<id>","drop":"<id>"},...]. ` +
        `If none, return []. Do not explain.\n\n${numbered}`;
      const raw = await callHaiku(prompt);
      if (!raw) continue;
      let pairs: Array<{ keep: string; drop: string }>;
      try {
        pairs = JSON.parse(raw.trim()) as Array<{ keep: string; drop: string }>;
      } catch {
        continue;
      }
      if (!Array.isArray(pairs)) continue;
      for (const pair of pairs) {
        const keep = memory.get(pair.keep);
        const drop = memory.get(pair.drop);
        if (!keep || !drop) continue;
        // Merge: append drop's tags to keep, then delete drop.
        memory.update(pair.keep, {
          tags: [...new Set([...keep.tags, ...drop.tags])],
          salience: Math.max(keep.salience, drop.salience),
        });
        memory.remove(pair.drop);
        run.memoriesMerged++;
      }
    }
  }

  private pruneSkills(run: MaintenanceStats): void {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const skill of listSkills()) {
      if (!skill.archived && skill.useCount === 0 && skill.createdAt < cutoff) {
        updateSkill(skill.id, { archived: true });
        run.skillsArchived++;
        log.info("Skill auto-archived", { id: skill.id, name: skill.name });
      }
    }
  }
}

export const maintenance = new MaintenanceScheduler();
