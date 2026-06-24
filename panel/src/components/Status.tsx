import { useState } from "react";
import { api, type BackendStatus, type ServiceStatus } from "../api.ts";
import { usePoll } from "../lib/usePoll.ts";
import { Badge, Card, Empty } from "./ui.tsx";

const KIND_LABEL: Record<BackendStatus["kind"], string> = {
  anthropic: "Anthropic",
  provider: "Provider",
  local: "Local",
};

export function StatusView({ onAuthError }: { onAuthError: () => void }) {
  const { data, error } = usePoll(() => api.status(), 15_000, onAuthError);

  return (
    <div className="space-y-4">
      {data && <ServiceBanner s={data.service} />}
      <Card title="Model backends">
        <p className="mb-3 text-sm text-fg-dim">
          Reachability, auth and model lists for the Anthropic API, every configured provider, and
          any local model server (LM Studio / Ollama) that's running. Refreshes every 15s.
        </p>
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        {!data ? (
          <Empty>Checking…</Empty>
        ) : data.backends.length === 0 ? (
          <Empty>No backends.</Empty>
        ) : (
          <div className="space-y-2">
            {data.backends.map((b) => (
              <BackendRow key={b.id} b={b} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ServiceBanner({ s }: { s: ServiceStatus }) {
  const ok = s.indicator === "none";
  const bad = s.indicator === "major" || s.indicator === "critical";
  const dot = ok ? "bg-emerald-500" : s.indicator === "minor" ? "bg-amber-500" : bad ? "bg-red-500" : "bg-fg-faint";
  return (
    <Card title="Claude service status">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <span className="text-sm text-fg">
            {s.error ? "Status page unreachable" : s.description || "Unknown"}
          </span>
        </div>
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-fg-dim hover:text-fg-muted"
        >
          status.claude.com ↗
        </a>
      </div>
      <p className="mt-1 text-xs text-fg-faint">
        From the public status page — no API key required.
      </p>
    </Card>
  );
}

function BackendRow({ b }: { b: BackendStatus }) {
  const [open, setOpen] = useState(false);
  const state = !b.reachable ? "down" : !b.authOk ? "auth" : "up";
  const dot =
    state === "up" ? "bg-emerald-500" : state === "auth" ? "bg-amber-500" : "bg-red-500";
  const label = state === "up" ? "up" : state === "auth" ? "auth" : "down";

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
            <span className="font-medium text-fg">{b.name}</span>
            <Badge>{KIND_LABEL[b.kind]}</Badge>
          </div>
          <div className="mono mt-1 truncate text-xs text-fg-faint" title={b.baseUrl}>
            {b.baseUrl}
          </div>
          {b.error && <p className="mt-1 text-xs text-red-400">{b.error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-fg-dim">
          <span className="tabular">{b.models.length} models</span>
          <span className={`rounded px-1.5 py-0.5 font-medium ${
            state === "up"
              ? "bg-emerald-500/15 text-emerald-400"
              : state === "auth"
                ? "bg-amber-500/15 text-amber-400"
                : "bg-red-500/15 text-red-400"
          }`}>
            {label}
          </span>
        </div>
      </div>
      {b.models.length > 0 && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-2 text-xs text-fg-dim hover:text-fg-muted"
        >
          {open ? "Hide models" : "Show models"}
        </button>
      )}
      {open && (
        <div className="mono mt-2 flex flex-wrap gap-1.5">
          {b.models.map((m) => (
            <span key={m} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
