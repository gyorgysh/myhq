import { config } from "../config.js";
import { listProviders, type Provider } from "./providers.js";
import { fetchProviderModels } from "./providerModels.js";
import { resolveSecret } from "./vault.js";

const TIMEOUT_MS = 6000;

/** Health of one model backend the bot can talk to. */
export interface BackendStatus {
  id: string;
  name: string;
  kind: "anthropic" | "provider" | "local";
  baseUrl: string;
  /** Endpoint answered at all (vs. network/DNS failure). */
  reachable: boolean;
  /** Credentials accepted (where checkable). */
  authOk: boolean;
  models: string[];
  error?: string;
}

export interface StatusSnapshot {
  checkedAt: number;
  backends: BackendStatus[];
}

/** Well-known local backends to surface when running but not configured. */
const KNOWN_LOCAL: Array<{ name: string; baseUrl: string }> = [
  { name: "LM Studio", baseUrl: "http://localhost:1234" },
  { name: "Ollama", baseUrl: "http://localhost:11434" },
];

async function checkAnthropic(): Promise<BackendStatus> {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const key = config.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  const out: BackendStatus = {
    id: "anthropic",
    name: "Anthropic API",
    kind: "anthropic",
    baseUrl,
    reachable: false,
    authOk: false,
    models: [],
  };
  if (!key) {
    out.error = "no ANTHROPIC_API_KEY set";
    return out;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: ctrl.signal,
    });
    out.reachable = true;
    if (res.ok) {
      out.authOk = true;
      const json = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
      out.models = (json.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    } else if (res.status === 401 || res.status === 403) {
      out.error = "auth rejected";
    } else {
      out.error = `HTTP ${res.status}`;
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  return out;
}

async function checkProvider(p: Provider): Promise<BackendStatus> {
  const out: BackendStatus = {
    id: p.id,
    name: p.name,
    kind: "provider",
    baseUrl: p.baseUrl,
    reachable: false,
    authOk: false,
    models: [],
  };
  try {
    out.models = await fetchProviderModels(p.baseUrl, resolveSecret(p.authToken));
    out.reachable = true;
    out.authOk = true;
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  return out;
}

/** Probe a default local endpoint; resolves null unless it actually answered. */
async function probeLocal(name: string, baseUrl: string): Promise<BackendStatus | null> {
  try {
    const models = await fetchProviderModels(baseUrl, undefined);
    return { id: `local:${baseUrl}`, name, kind: "local", baseUrl, reachable: true, authOk: true, models };
  } catch {
    return null;
  }
}

/** Probe Anthropic, every configured provider, and any running local backends. */
export async function getStatus(): Promise<StatusSnapshot> {
  const providers = listProviders();
  const configured = new Set(providers.map((p) => p.baseUrl.replace(/\/+$/, "")));
  const localProbes = KNOWN_LOCAL.filter((l) => !configured.has(l.baseUrl)).map((l) =>
    probeLocal(l.name, l.baseUrl),
  );
  const [anthropic, providerStatuses, localStatuses] = await Promise.all([
    checkAnthropic(),
    Promise.all(providers.map(checkProvider)),
    Promise.all(localProbes),
  ]);
  return {
    checkedAt: Date.now(),
    backends: [anthropic, ...providerStatuses, ...localStatuses.filter((s): s is BackendStatus => s !== null)],
  };
}
