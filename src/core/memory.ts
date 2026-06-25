import { randomBytes } from "node:crypto";
import { loadJson, saveJson } from "./jsonStore.js";
import { audit } from "./audit.js";

const FILE = "memory.json";

const HOT_DECAY_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
const WARM_DECAY_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days

/**
 * A single durable fact the agent has learned and may recall on future turns.
 *
 * Tiers:
 *   hot  — injected into every turn unconditionally.
 *   warm — keyword-recalled when relevant (default for new entries).
 *   cold — excluded from automatic recall; surfaces only via panel search.
 *
 * Tier degrades automatically:
 *   hot  → warm after 7 days without recall.
 *   warm → cold after 30 days without recall.
 */
export interface MemoryEntry {
  id: string;
  text: string;
  tags: string[];
  salience: number;
  tier: "hot" | "warm" | "cold";
  useCount: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

interface MemoryFile {
  version: 1;
  entries: MemoryEntry[];
}

export interface MemoryInput {
  text: string;
  tags?: string[];
  salience?: number;
  tier?: "hot" | "warm" | "cold";
}

/** Split text into lowercased word tokens of length >= 3 for matching. */
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3);
}

function clampSalience(n: number | undefined, fallback: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

/**
 * In-memory fact store, persisted to memory.json. A singleton held live in the
 * process (mirrors WorkerManager) so concurrent turns mutate one array rather
 * than racing on load-modify-save of the file.
 */
export class MemoryStore {
  private entries: MemoryEntry[];

  constructor() {
    const loaded = loadJson<MemoryFile>(FILE, { version: 1, entries: [] }).entries;
    // Migrate pre-tier entries: any entry missing `tier` defaults to "warm".
    this.entries = loaded.map((e) => ({
      ...e,
      tier: (e.tier ?? "warm") as "hot" | "warm" | "cold",
    }));
  }

  /** All entries (including cold), most salient first, then most recently updated. */
  list(): MemoryEntry[] {
    this.applyDecay();
    return [...this.entries].sort(
      (a, b) => b.salience - a.salience || b.updatedAt - a.updatedAt,
    );
  }

  get(id: string): MemoryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /**
   * Keyword search over hot + warm entries only (cold entries are excluded).
   * Score each entry by how many query tokens appear in its text/tags, nudged by
   * salience. Returns matches only, best first.
   */
  search(query: string, limit = 10): MemoryEntry[] {
    this.applyDecay();
    const terms = new Set(tokenize(query));
    if (terms.size === 0) return [];
    const scored: Array<{ e: MemoryEntry; score: number }> = [];
    for (const e of this.entries) {
      if (e.tier === "cold") continue;
      const hay = new Set(tokenize(`${e.text} ${e.tags.join(" ")}`));
      let hits = 0;
      for (const t of terms) if (hay.has(t)) hits++;
      if (hits > 0) scored.push({ e, score: hits + e.salience });
    }
    scored.sort((a, b) => b.score - a.score || b.e.salience - a.e.salience);
    return scored.slice(0, limit).map((s) => s.e);
  }

  /** Search including cold entries (for panel full-text search). */
  searchAll(query: string, limit = 50): MemoryEntry[] {
    this.applyDecay();
    const terms = new Set(tokenize(query));
    if (terms.size === 0) return this.list().slice(0, limit);
    const scored: Array<{ e: MemoryEntry; score: number }> = [];
    for (const e of this.entries) {
      const hay = new Set(tokenize(`${e.text} ${e.tags.join(" ")}`));
      let hits = 0;
      for (const t of terms) if (hay.has(t)) hits++;
      if (hits > 0) scored.push({ e, score: hits + e.salience });
    }
    scored.sort((a, b) => b.score - a.score || b.e.salience - a.e.salience);
    return scored.slice(0, limit).map((s) => s.e);
  }

  create(input: MemoryInput): MemoryEntry {
    const now = Date.now();
    const text = input.text.trim();
    // De-dupe exact repeats: bump the existing entry instead of growing noise.
    const existing = this.entries.find((e) => e.text.toLowerCase() === text.toLowerCase());
    if (existing) {
      existing.salience = Math.max(existing.salience, clampSalience(input.salience, existing.salience));
      if (input.tags) existing.tags = dedupeTags([...existing.tags, ...input.tags]);
      if (input.tier) existing.tier = input.tier;
      existing.updatedAt = now;
      this.persist();
      return existing;
    }
    const entry: MemoryEntry = {
      id: randomBytes(4).toString("hex"),
      text,
      tags: dedupeTags(input.tags ?? []),
      salience: clampSalience(input.salience, 0.5),
      tier: input.tier ?? "warm",
      useCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.entries.push(entry);
    this.persist();
    audit("memory.create", { id: entry.id, tags: entry.tags });
    return entry;
  }

  update(id: string, patch: Partial<MemoryInput>): MemoryEntry | undefined {
    const e = this.get(id);
    if (!e) return undefined;
    if (patch.text !== undefined) e.text = patch.text.trim() || e.text;
    if (patch.tags !== undefined) e.tags = dedupeTags(patch.tags);
    if (patch.salience !== undefined) e.salience = clampSalience(patch.salience, e.salience);
    if (patch.tier !== undefined) e.tier = patch.tier;
    e.updatedAt = Date.now();
    this.persist();
    audit("memory.update", { id });
    return e;
  }

  /** Set the tier of an entry directly (promote/demote). */
  setTier(id: string, tier: "hot" | "warm" | "cold"): MemoryEntry | undefined {
    const e = this.get(id);
    if (!e) return undefined;
    e.tier = tier;
    e.updatedAt = Date.now();
    this.persist();
    audit("memory.tier", { id, tier });
    return e;
  }

  remove(id: string): boolean {
    const next = this.entries.filter((e) => e.id !== id);
    if (next.length === this.entries.length) return false;
    this.entries = next;
    this.persist();
    audit("memory.delete", { id });
    return true;
  }

  /**
   * Build entries to inject into the system prompt for a turn.
   * Returns all hot entries + top keyword-matched warm entries.
   * Bumps usage stats (salience + useCount) for every returned entry.
   */
  recallForPrompt(prompt: string, warmLimit = 5): MemoryEntry[] {
    this.applyDecay();
    const now = Date.now();

    const hot = this.entries.filter((e) => e.tier === "hot");
    const warmHits = this.search(prompt, warmLimit).filter((e) => e.tier === "warm");

    // De-dupe: warm hits that are actually hot entries show up once (as hot).
    const hotIds = new Set(hot.map((e) => e.id));
    const combined = [...hot, ...warmHits.filter((e) => !hotIds.has(e.id))];

    if (combined.length > 0) {
      for (const e of combined) {
        e.useCount++;
        e.lastUsedAt = now;
      }
      this.persist();
    }
    return combined;
  }

  /** Count entries by tier. */
  countByTier(): Record<"hot" | "warm" | "cold", number> {
    const counts = { hot: 0, warm: 0, cold: 0 };
    for (const e of this.entries) counts[e.tier]++;
    return counts;
  }

  /** All entries including cold, unordered (for maintenance compaction). */
  allRaw(): MemoryEntry[] {
    return this.entries;
  }

  /** Replace all entries (used by maintenance compaction after dedup/prune). */
  replaceAll(entries: MemoryEntry[]): void {
    this.entries = entries;
    this.persist();
  }

  /** Degrade hot/warm entries that haven't been recalled recently. */
  private applyDecay(): void {
    const now = Date.now();
    let changed = false;
    for (const e of this.entries) {
      if (e.tier === "cold") continue;
      const lastUse = e.lastUsedAt ?? e.createdAt;
      if (e.tier === "hot" && now - lastUse > HOT_DECAY_MS) {
        e.tier = "warm";
        changed = true;
      } else if (e.tier === "warm" && now - lastUse > WARM_DECAY_MS) {
        e.tier = "cold";
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private persist(): void {
    saveJson<MemoryFile>(FILE, { version: 1, entries: this.entries });
  }
}

function dedupeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** Render entries as a compact bullet list for the system prompt. */
export function formatMemories(entries: MemoryEntry[]): string {
  return entries
    .map((e) => `- ${e.text}${e.tags.length ? ` [${e.tags.join(", ")}]` : ""}`)
    .join("\n");
}

export const memory = new MemoryStore();
