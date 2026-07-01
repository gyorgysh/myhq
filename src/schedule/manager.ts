import { randomBytes } from "node:crypto";
import { log } from "../logger.js";
import {
  loadSchedules,
  saveSchedules,
  type Schedule,
  type ScheduleSpec,
} from "./store.js";

const TICK_MS = 30_000;

/** Outcome of attempting to fire one due schedule:
 *  - "started": the run actually began; advance nextRunAt and clear busy/error.
 *  - "busy": the chat was busy, skip and retry next tick (records busySince).
 *  - "deferred": the runner handled it another way (e.g. moved it to a background
 *    task because it had been busy too long); advance and clear busy state.
 *  A boolean is still accepted for back-compat (true → "started", false → "busy"). */
export type RunOutcome = "started" | "busy" | "deferred";

/** Callback that runs one due schedule. The schedule passed in carries
 *  `busySince` so the runner can decide to fall back to a background task once
 *  the chat has been busy for a while. */
export type ScheduleRunner = (s: Schedule) => Promise<RunOutcome | boolean>;

export class ScheduleManager {
  private schedules: Schedule[] = loadSchedules();
  private timer?: NodeJS.Timeout;
  private runner?: ScheduleRunner;
  // Guards against a slow tick() overlapping the next setInterval firing (e.g.
  // several due schedules queued at once, or a runner call that blocks) —
  // without it, a second concurrent tick() would see the same schedules as
  // still due (nextRunAt only advances once the first tick's run() resolves)
  // and fire them again, mirroring HeartbeatManager's `running` guard.
  private ticking = false;

  /** Begin ticking. `run` executes a due schedule's prompt. */
  start(run: ScheduleRunner): void {
    if (this.timer) return;
    this.runner = run;
    this.timer = setInterval(() => void this.tick(run), TICK_MS);
    this.timer.unref?.();
    log.info("Scheduler started", { count: this.schedules.length });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Fire a schedule immediately by id, regardless of its nextRunAt. */
  async runNow(id: string): Promise<"ok" | "not_found" | "no_runner" | "busy"> {
    const s = this.schedules.find((s) => s.id === id);
    if (!s) return "not_found";
    if (!this.runner) return "no_runner";
    let outcome: RunOutcome;
    try {
      outcome = normalizeOutcome(await this.runner(s));
    } catch (err) {
      s.lastError = errText(err);
      s.lastRunAt = Date.now();
      s.nextRunAt = nextRun(s.spec, Date.now());
      saveSchedules(this.schedules);
      return "ok";
    }
    if (outcome === "busy") return "busy";
    s.lastRunAt = Date.now();
    s.nextRunAt = nextRun(s.spec, Date.now());
    s.lastError = undefined;
    s.busySince = undefined;
    saveSchedules(this.schedules);
    return "ok";
  }

  list(chatId: number): Schedule[] {
    return this.schedules
      .filter((s) => s.chatId === chatId)
      .sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  /** Every schedule across all chats (for the management panel). */
  all(): Schedule[] {
    return [...this.schedules].sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  add(chatId: number, cwd: string, prompt: string, spec: ScheduleSpec, webhookUrl?: string): Schedule {
    const s: Schedule = {
      id: randomBytes(3).toString("hex"),
      chatId,
      cwd,
      prompt,
      spec,
      nextRunAt: nextRun(spec, Date.now()),
      createdAt: Date.now(),
      enabled: true,
      webhookUrl: webhookUrl?.trim() || undefined,
    };
    this.schedules.push(s);
    saveSchedules(this.schedules);
    log.info("Schedule added", { chatId, id: s.id, spec });
    return s;
  }

  /** Update mutable fields of a schedule by id. Returns the updated schedule or null. */
  updateById(
    id: string,
    patch: { prompt?: string; when?: string; cwd?: string; chatId?: number; webhookUrl?: string },
  ): Schedule | null {
    const s = this.schedules.find((s) => s.id === id);
    if (!s) return null;
    if (patch.prompt !== undefined) s.prompt = patch.prompt.trim();
    if (patch.cwd !== undefined) s.cwd = patch.cwd.trim();
    if (patch.chatId !== undefined) s.chatId = patch.chatId;
    if (patch.webhookUrl !== undefined) s.webhookUrl = patch.webhookUrl.trim() || undefined;
    if (patch.when !== undefined) {
      const spec = parseWhen(patch.when);
      if (spec) {
        s.spec = spec;
        s.nextRunAt = nextRun(spec, Date.now());
      }
    }
    saveSchedules(this.schedules);
    log.info("Schedule updated", { id });
    return { ...s };
  }

  /** Pause/resume a schedule by id. Paused ones stay in the list but never fire. */
  setEnabled(id: string, enabled: boolean): Schedule | null {
    const s = this.schedules.find((s) => s.id === id);
    if (!s) return null;
    s.enabled = enabled;
    saveSchedules(this.schedules);
    log.info("Schedule enabled toggled", { id, enabled });
    return { ...s };
  }

  /** Remove a schedule by id regardless of owner (panel management). */
  removeById(id: string): boolean {
    const before = this.schedules.length;
    this.schedules = this.schedules.filter((s) => s.id !== id);
    if (this.schedules.length === before) return false;
    saveSchedules(this.schedules);
    log.info("Schedule removed", { id });
    return true;
  }

  /** Remove a schedule owned by `chatId`. Returns true if one was removed. */
  remove(chatId: number, id: string): boolean {
    const before = this.schedules.length;
    this.schedules = this.schedules.filter((s) => !(s.chatId === chatId && s.id === id));
    if (this.schedules.length === before) return false;
    saveSchedules(this.schedules);
    log.info("Schedule removed", { chatId, id });
    return true;
  }

  private async tick(run: ScheduleRunner): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.tickOnce(run);
    } finally {
      this.ticking = false;
    }
  }

  private async tickOnce(run: ScheduleRunner): Promise<void> {
    const now = Date.now();
    let dirty = false;
    for (const s of this.schedules) {
      if (s.enabled === false) continue;
      if (s.nextRunAt > now) continue;
      let outcome: RunOutcome;
      try {
        outcome = normalizeOutcome(await run(s));
      } catch (err) {
        // The run threw: record the error so the panel can flag a broken job,
        // then roll forward so we don't hammer a persistently failing schedule.
        const msg = errText(err);
        log.error("Scheduled run threw", { id: s.id, error: msg });
        s.lastError = msg;
        s.lastRunAt = now;
        s.nextRunAt = nextRun(s.spec, now);
        s.busySince = undefined;
        dirty = true;
        continue;
      }
      if (outcome === "busy") {
        // Chat was busy: leave nextRunAt alone so we retry next tick, but mark
        // when the wait started so the runner can fall back to a background task.
        if (s.busySince === undefined) {
          s.busySince = now;
          dirty = true;
        }
        continue;
      }
      // "started" or "deferred" (runner moved it to a background task): advance.
      s.lastRunAt = now;
      s.nextRunAt = nextRun(s.spec, now);
      s.lastError = undefined;
      s.busySince = undefined;
      dirty = true;
    }
    if (dirty) saveSchedules(this.schedules);
  }
}

/** Coerce a runner's return into a {@link RunOutcome}. */
function normalizeOutcome(r: RunOutcome | boolean): RunOutcome {
  if (r === true) return "started";
  if (r === false) return "busy";
  return r;
}

/** Parse a "when" token: `30s|m|h|d` (interval) or `[daily ]HH:MM` (clock). */
export function parseWhen(input: string): ScheduleSpec | undefined {
  const text = input.trim().toLowerCase();
  const interval = /^(\d+)\s*(s|m|h|d)$/.exec(text);
  if (interval) {
    const n = Number(interval[1]);
    const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[interval[2]]!;
    const everyMs = n * unit;
    if (everyMs < 60_000) return undefined; // floor at 1 minute
    return { kind: "interval", everyMs };
  }
  const daily = /^(?:daily\s+)?(\d{1,2}):(\d{2})$/.exec(text);
  if (daily) {
    const hour = Number(daily[1]);
    const minute = Number(daily[2]);
    if (hour > 23 || minute > 59) return undefined;
    return { kind: "daily", hour, minute };
  }
  return undefined;
}

/** Compute the next firing time (epoch ms) at or after `from`. */
export function nextRun(spec: ScheduleSpec, from: number): number {
  if (spec.kind === "interval") return from + spec.everyMs;
  // daily: next occurrence of hour:minute in the server's local time.
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setHours(spec.hour, spec.minute);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Return a parseable "when" string that round-trips through parseWhen. */
export function specToWhen(spec: ScheduleSpec): string {
  if (spec.kind === "interval") {
    const m = spec.everyMs;
    if (m % 86_400_000 === 0) return `${m / 86_400_000}d`;
    if (m % 3_600_000 === 0) return `${m / 3_600_000}h`;
    return `${Math.round(m / 60_000)}m`;
  }
  return `${String(spec.hour).padStart(2, "0")}:${String(spec.minute).padStart(2, "0")}`;
}

/** Human-readable description of a spec, for /schedule list. */
export function describeSpec(spec: ScheduleSpec): string {
  if (spec.kind === "interval") {
    const m = spec.everyMs;
    if (m % 86_400_000 === 0) return `every ${m / 86_400_000}d`;
    if (m % 3_600_000 === 0) return `every ${m / 3_600_000}h`;
    return `every ${Math.round(m / 60_000)}m`;
  }
  return `daily at ${String(spec.hour).padStart(2, "0")}:${String(spec.minute).padStart(2, "0")}`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const schedules = new ScheduleManager();
