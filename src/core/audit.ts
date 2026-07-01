import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataPath } from "./jsonStore.js";
import { log } from "../logger.js";

// Day-sharded like logs/ (src/logger.ts) and data/runs/ (src/core/runLog.ts),
// with a retention window — a single ever-growing audit.jsonl meant every read
// (search, facets, anomaly scanning) re-parsed the entire history each time.
const AUDIT_DIR = dataPath("audit");
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const RETENTION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // check once a day

export interface AuditEvent {
  ts: number;
  /** Where the action came from, e.g. "panel". */
  source: string;
  /** Verb + object, e.g. "prompt.save", "worker.run", "task.move". */
  action: string;
  /** Optional structured details (kept small). */
  detail?: Record<string, unknown>;
}

/** YYYY-MM-DD in local time, matching logger.ts's day-file convention. */
function dayOf(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ensureAuditDir(): void {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
  } catch {
    /* best effort */
  }
}

/** One-time migration: fold a legacy flat audit.jsonl (pre-sharding) into
 *  day-shard files by each event's own timestamp, then remove it. A no-op
 *  once migrated, since the old file no longer exists. */
function migrateLegacyFile(): void {
  const legacy = dataPath("audit.jsonl");
  if (!existsSync(legacy)) return;
  try {
    const lines = readFileSync(legacy, "utf8").trim().split("\n").filter(Boolean);
    const byDay = new Map<string, string[]>();
    for (const l of lines) {
      try {
        const day = dayOf((JSON.parse(l) as AuditEvent).ts);
        const arr = byDay.get(day);
        if (arr) arr.push(l);
        else byDay.set(day, [l]);
      } catch {
        /* skip malformed */
      }
    }
    ensureAuditDir();
    for (const [day, dayLines] of byDay) {
      appendFileSync(join(AUDIT_DIR, `${day}.jsonl`), dayLines.join("\n") + "\n");
    }
    rmSync(legacy);
    log.info("Migrated legacy audit.jsonl into day-sharded files", { days: byDay.size, events: lines.length });
  } catch (err) {
    log.warn("Legacy audit.jsonl migration failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

function pruneOldShards(): void {
  try {
    const cutoff = Date.now() - RETENTION_MS;
    for (const file of readdirSync(AUDIT_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))) {
      const ts = new Date(file.slice(0, 10)).getTime();
      if (!Number.isNaN(ts) && ts < cutoff) {
        try {
          rmSync(join(AUDIT_DIR, file));
        } catch {
          /* best effort */
        }
      }
    }
  } catch {
    /* best effort */
  }
}

migrateLegacyFile();
ensureAuditDir();
pruneOldShards();
const _pruneTimer = setInterval(pruneOldShards, RETENTION_CHECK_INTERVAL_MS);
if (_pruneTimer.unref) _pruneTimer.unref();

/** Append one audit event as a JSON line, into the shard for the day it
 *  occurred. Best-effort; never throws. */
export function audit(action: string, detail?: Record<string, unknown>, source = "panel"): void {
  const event: AuditEvent = { ts: Date.now(), source, action, detail };
  try {
    ensureAuditDir();
    appendFileSync(join(AUDIT_DIR, `${dayOf(event.ts)}.jsonl`), JSON.stringify(event) + "\n");
  } catch (err) {
    log.warn("Audit append failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** The resource an action operates on: the segment before the first dot in the
 *  action verb (e.g. "vault.rotate" -> "vault", "task.move" -> "task"). Falls
 *  back to the whole action when it carries no dot. */
export function auditResource(action: string): string {
  const dot = action.indexOf(".");
  return dot === -1 ? action : action.slice(0, dot);
}

/** Every retained day-shard's date (YYYY-MM-DD), newest first. */
function retainedDays(): string[] {
  try {
    return readdirSync(AUDIT_DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Parse one day-shard's lines into events, newest first. Best-effort: a
 *  missing file or malformed lines are skipped. */
function readShard(day: string): AuditEvent[] {
  let raw: string;
  try {
    raw = readFileSync(join(AUDIT_DIR, `${day}.jsonl`), "utf8");
  } catch {
    return [];
  }
  const out: AuditEvent[] = [];
  for (const l of raw.trim().split("\n")) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l) as AuditEvent);
    } catch {
      /* skip malformed */
    }
  }
  return out.reverse();
}

/**
 * Walk retained shards newest-first, calling `visit` with each event and
 * stopping as soon as it returns false — lets a caller cap a read (recentAudit)
 * or stop once a `limit` is hit without touching older shards. `sinceDay`, if
 * given, additionally skips whole shards dated before it (shard filenames sort
 * chronologically, so once we're before it every earlier shard is too).
 */
function walkShards(visit: (e: AuditEvent) => boolean, sinceDay?: string): void {
  for (const day of retainedDays()) {
    if (sinceDay && day < sinceDay) break;
    for (const e of readShard(day)) {
      if (!visit(e)) return;
    }
  }
}

/** Read the most recent `limit` audit events (newest first), across shards. */
export function recentAudit(limit = 100): AuditEvent[] {
  const out: AuditEvent[] = [];
  walkShards((e) => {
    out.push(e);
    return out.length < limit;
  });
  return out;
}

export interface AuditQuery {
  /** Free-text needle matched against action, source, and detail (case-insensitive). */
  q?: string;
  /** Restrict to events from this source/actor (exact match). */
  actor?: string;
  /** Restrict to events whose action equals this (exact match). */
  action?: string;
  /** Restrict to events whose resource (action prefix) equals this. */
  resource?: string;
  /** Only events at/after this epoch-ms. */
  since?: number;
  /** Max rows to return (newest first). */
  limit?: number;
}

export interface AuditFacets {
  /** Distinct actors (sources) seen, most frequent first. */
  actors: string[];
  /** Distinct resources (action prefixes) seen, most frequent first. */
  resources: string[];
  /** Distinct full actions seen, most frequent first. */
  actions: string[];
}

/** Search the audit log with actor/action/resource/text filters. A `since`
 *  filter skips whole shards dated before it, so a recent-window query only
 *  touches the shards that could possibly contain a match. */
export function searchAudit(query: AuditQuery = {}): AuditEvent[] {
  const { q, actor, action, resource, since, limit = 500 } = query;
  const needle = q?.trim().toLowerCase();
  const sinceDay = since !== undefined ? dayOf(since) : undefined;
  const out: AuditEvent[] = [];
  walkShards((e) => {
    if (actor && e.source !== actor) return true;
    if (action && e.action !== action) return true;
    if (resource && auditResource(e.action) !== resource) return true;
    if (since && e.ts < since) return true;
    if (needle) {
      const hay = `${e.action} ${e.source} ${e.detail ? JSON.stringify(e.detail) : ""}`.toLowerCase();
      if (!hay.includes(needle)) return true;
    }
    out.push(e);
    return out.length < limit;
  }, sinceDay);
  return out;
}

/** Distinct actors, resources, and actions across the retained log, ordered by
 *  frequency (for populating the panel's filter dropdowns). */
export function auditFacets(): AuditFacets {
  const actors = new Map<string, number>();
  const resources = new Map<string, number>();
  const actions = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  walkShards((e) => {
    bump(actors, e.source);
    bump(resources, auditResource(e.action));
    bump(actions, e.action);
    return true;
  });
  const ranked = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { actors: ranked(actors), resources: ranked(resources), actions: ranked(actions) };
}
