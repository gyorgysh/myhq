/**
 * Claude OAuth usage probe.
 *
 * Reads the OAuth access token that the Claude Code CLI stores in the macOS
 * Keychain (service "Claude Code-credentials", account = OS username) and
 * calls the official Anthropic OAuth API:
 *
 *   GET /api/oauth/usage   — session (5h) and weekly utilisation percentages
 *   GET /api/oauth/profile — plan info (Pro / Max), billing status
 *
 * Both require:
 *   Authorization: Bearer <accessToken>
 *   anthropic-beta: oauth-2025-04-20
 *
 * Falls back to stats-cache.json + `claude auth status` on non-macOS hosts or
 * when the keychain entry is absent (e.g. API-key-only installs).
 *
 * Runs on a configurable schedule (default 30 min). A "Check now" endpoint
 * triggers an immediate refresh and caches the result.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { userInfo, homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadJson, saveJson } from "./jsonStore.js";
import { log } from "../logger.js";

const execFileAsync = promisify(execFile);

const STATS_FILE = join(homedir(), ".claude", "stats-cache.json");
const PROBE_FILE = "usageProbe.json";
const OAUTH_BETA = "oauth-2025-04-20";
const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";

// ---------------------------------------------------------------------------
// Types from the Anthropic OAuth API
// ---------------------------------------------------------------------------

interface OAuthUsageWindow {
  utilization: number;        // 0–100 (percent used)
  resets_at: string;          // ISO timestamp
  limit_dollars: number | null;
  used_dollars: number | null;
  remaining_dollars: number | null;
}

interface OAuthUsageLimit {
  kind: string;               // "session", "weekly_all", …
  group: string;              // "session", "weekly"
  percent: number;            // 0–100
  severity: string;           // "normal", "warning", "critical"
  resets_at: string;
  is_active: boolean;
}

interface OAuthUsageResponse {
  five_hour?: OAuthUsageWindow;
  seven_day?: OAuthUsageWindow;
  limits?: OAuthUsageLimit[];
  extra_usage?: {
    is_enabled: boolean;
    monthly_limit: number | null;
    used_credits: number | null;
    utilization: number | null;
    disabled_reason: string | null;
  };
}

interface OAuthProfileAccount {
  uuid: string;
  full_name: string;
  display_name: string;
  email: string;
  has_claude_max: boolean;
  has_claude_pro: boolean;
  created_at: string;
}

interface OAuthProfileOrg {
  name: string;
  organization_type: string;
  billing_type: string;
  subscription_status: string;
  has_extra_usage_enabled: boolean;
}

interface OAuthProfileResponse {
  account: OAuthProfileAccount;
  organization: OAuthProfileOrg;
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface UsageLimitWindow {
  /** Percentage of the limit consumed (0–100). */
  percent: number;
  /** ISO timestamp when this window resets. */
  resetsAt: string;
  /** Milliseconds until reset (computed at probe time). */
  resetsInMs: number;
  /** Human label, e.g. "5-hour session" or "7-day weekly". */
  label: string;
  severity: "normal" | "warning" | "critical";
}

export interface ProbeResult {
  probedAt: string;
  /** "oauth" = real data from the Anthropic OAuth API. "fallback" = stats-cache + auth status. */
  source: "oauth" | "fallback";
  error?: string;
  account?: {
    email?: string;
    fullName?: string;
    hasPro: boolean;
    hasMax: boolean;
    subscriptionStatus?: string;
    subscriptionType?: string;   // from auth status (fallback)
  };
  limits: UsageLimitWindow[];
  /** Whether extra (pay-per-use) usage is enabled on top of the subscription. */
  extraUsageEnabled?: boolean;
  /** Historical activity from stats-cache.json (always present when file exists). */
  activity?: {
    lastDate: string;
    messageCount: number;
    toolCallCount: number;
    sessionCount: number;
    weeklyMessageCount: number;
  };
}

interface ProbeFile {
  version: 1;
  result?: ProbeResult;
}

// ---------------------------------------------------------------------------
// Keychain / token helpers
// ---------------------------------------------------------------------------

interface StoredCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;     // epoch ms
    subscriptionType?: string;
  };
}

async function readStoredCredentials(): Promise<StoredCredentials | null> {
  try {
    const username = userInfo().username;
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-a", username, "-w"],
      { timeout: 5000 },
    );
    return JSON.parse(stdout.trim()) as StoredCredentials;
  } catch {
    return null;
  }
}

/** Get a valid access token, refreshing via `claude auth status` if expired. */
async function getAccessToken(): Promise<string | null> {
  let creds = await readStoredCredentials();
  if (!creds?.claudeAiOauth) return null;

  const { accessToken, expiresAt } = creds.claudeAiOauth;
  // If the token expires within the next 60 s, trigger a refresh by running
  // `claude auth status`. The CLI validates + refreshes the token automatically.
  if (Date.now() > expiresAt - 60_000) {
    log.debug("OAuth token near expiry — triggering refresh via claude auth status");
    try {
      await execFileAsync("claude", ["auth", "status"], { timeout: 10_000 });
      // Re-read the keychain after the CLI has refreshed it.
      creds = await readStoredCredentials();
    } catch {
      // If refresh fails, try with the existing token anyway.
    }
    if (!creds?.claudeAiOauth) return null;
    return creds.claudeAiOauth.accessToken;
  }

  return accessToken;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": OAUTH_BETA,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${url} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Stats-cache reader (fallback / always used for activity)
// ---------------------------------------------------------------------------

function readActivity(): ProbeResult["activity"] {
  if (!existsSync(STATS_FILE)) return undefined;
  try {
    const s = JSON.parse(readFileSync(STATS_FILE, "utf8")) as {
      dailyActivity?: Array<{ date: string; messageCount: number; toolCallCount: number; sessionCount: number }>;
    };
    const all = [...(s.dailyActivity ?? [])].sort((a, b) => b.date.localeCompare(a.date));
    if (!all.length) return undefined;

    const today = new Date().toISOString().slice(0, 10);
    const weekCutoff = (() => {
      const d = new Date(); d.setDate(d.getDate() - 6);
      return d.toISOString().slice(0, 10);
    })();
    const last = all[0];
    const week = all.filter((d) => d.date >= weekCutoff);

    return {
      lastDate: last.date === today ? "today" : last.date,
      messageCount: last.messageCount,
      toolCallCount: last.toolCallCount,
      sessionCount: last.sessionCount,
      weeklyMessageCount: week.reduce((s, d) => s + d.messageCount, 0),
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Probe functions
// ---------------------------------------------------------------------------

async function probeViaOAuth(token: string): Promise<ProbeResult> {
  const now = Date.now();
  const [usage, profile] = await Promise.all([
    fetchJson<OAuthUsageResponse>(OAUTH_USAGE_URL, token),
    fetchJson<OAuthProfileResponse>(OAUTH_PROFILE_URL, token),
  ]);

  const limits: UsageLimitWindow[] = [];

  if (usage.five_hour) {
    const resetsInMs = Math.max(0, new Date(usage.five_hour.resets_at).getTime() - now);
    limits.push({
      percent: Math.round(usage.five_hour.utilization),
      resetsAt: usage.five_hour.resets_at,
      resetsInMs,
      label: "5-hour session",
      severity: usage.five_hour.utilization >= 90 ? "critical" : usage.five_hour.utilization >= 70 ? "warning" : "normal",
    });
  }

  if (usage.seven_day) {
    const resetsInMs = Math.max(0, new Date(usage.seven_day.resets_at).getTime() - now);
    limits.push({
      percent: Math.round(usage.seven_day.utilization),
      resetsAt: usage.seven_day.resets_at,
      resetsInMs,
      label: "7-day weekly",
      severity: usage.seven_day.utilization >= 90 ? "critical" : usage.seven_day.utilization >= 70 ? "warning" : "normal",
    });
  }

  // Add any additional active limits
  for (const lim of usage.limits ?? []) {
    if (lim.group !== "session" && lim.group !== "weekly" && lim.is_active) {
      const resetsInMs = Math.max(0, new Date(lim.resets_at).getTime() - now);
      limits.push({
        percent: lim.percent,
        resetsAt: lim.resets_at,
        resetsInMs,
        label: lim.kind.replace(/_/g, " "),
        severity: lim.severity as UsageLimitWindow["severity"],
      });
    }
  }

  return {
    probedAt: new Date().toISOString(),
    source: "oauth",
    account: {
      email: profile.account.email,
      fullName: profile.account.full_name,
      hasPro: profile.account.has_claude_pro,
      hasMax: profile.account.has_claude_max,
      subscriptionStatus: profile.organization.subscription_status,
    },
    limits,
    extraUsageEnabled: usage.extra_usage?.is_enabled ?? false,
    activity: readActivity(),
  };
}

async function probeViaFallback(): Promise<ProbeResult> {
  let accountInfo: { loggedIn: boolean; email?: string; subscriptionType?: string } = { loggedIn: false };
  try {
    const { stdout } = await execFileAsync("claude", ["auth", "status"], { timeout: 8000 });
    const d = JSON.parse(stdout.trim()) as Record<string, unknown>;
    accountInfo = {
      loggedIn: Boolean(d.loggedIn),
      email: typeof d.email === "string" ? d.email : undefined,
      subscriptionType: typeof d.subscriptionType === "string" ? d.subscriptionType : undefined,
    };
  } catch { /* ignore */ }

  return {
    probedAt: new Date().toISOString(),
    source: "fallback",
    error: "OAuth token not found. Keychain access requires macOS with a Claude Code install.",
    account: accountInfo.loggedIn
      ? {
          email: accountInfo.email,
          hasPro: accountInfo.subscriptionType === "pro",
          hasMax: accountInfo.subscriptionType?.includes("max") ?? false,
          subscriptionType: accountInfo.subscriptionType,
        }
      : undefined,
    limits: [],
    activity: readActivity(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function loadProbeResult(): ProbeResult | undefined {
  return loadJson<ProbeFile>(PROBE_FILE, { version: 1 }).result;
}

export async function runProbe(): Promise<ProbeResult> {
  log.info("Usage probe starting");
  let result: ProbeResult;

  try {
    const token = await getAccessToken();
    if (token) {
      result = await probeViaOAuth(token);
      log.info("Usage probe complete", { source: "oauth", limits: result.limits.length });
    } else {
      result = await probeViaFallback();
      log.info("Usage probe complete", { source: "fallback" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("Usage probe failed", { error: msg });
    try {
      result = await probeViaFallback();
      result.error = `OAuth probe failed: ${msg}`;
    } catch {
      result = {
        probedAt: new Date().toISOString(),
        source: "fallback",
        error: msg,
        limits: [],
        activity: readActivity(),
      };
    }
  }

  saveJson<ProbeFile>(PROBE_FILE, { version: 1, result });
  return result;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | undefined;

export function startProbeScheduler(intervalMs: number): void {
  if (timer) clearInterval(timer);
  if (!intervalMs || intervalMs <= 0) return;
  void runProbe().catch(() => {});
  timer = setInterval(() => void runProbe().catch(() => {}), intervalMs);
  timer.unref?.();
  log.info("Usage probe scheduler started", { intervalMs, intervalMin: Math.round(intervalMs / 60000) });
}

export function stopProbeScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
