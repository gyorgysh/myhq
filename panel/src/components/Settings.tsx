import { useEffect, useId, useState } from "react";
import { api, AuthError, type MainAgent, type Autonomy, type Provider, type PlanView, type PlanType, type ProbeResult } from "../api.ts";
import { Badge, Button, Card, Input, Label, Select, TextArea } from "./ui.tsx";
import { useI18n, INTERFACE_LANGUAGES } from "../lib/useI18n.ts";
import { AGENT_LANGUAGES } from "../i18n/languages.ts";

const MODEL_SUGGESTIONS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8"];

const PERSONA_PRESETS = [
  { label: "Concise", value: "Concise and direct. Lead with the result, skip preamble, use short sentences." },
  { label: "Warm", value: "Warm and encouraging. Acknowledge effort, celebrate wins, frame challenges positively." },
  { label: "Formal", value: "Formal and precise. Use structured language, avoid contractions and casual expressions." },
  { label: "Analytical", value: "Analytical and methodical. Think through problems step by step, cite specifics." },
  { label: "Playful", value: "Witty and playful. Use light humor, analogies, and keep the energy high." },
];

const AUTONOMY_OPTIONS: Array<{ value: Autonomy; label: string; description: string }> = [
  { value: "supervised", label: "Supervised", description: "All tools prompt for approval" },
  { value: "standard", label: "Standard", description: "Safe tools auto-allowed, risky tools prompt" },
  { value: "full", label: "Full", description: "All tools bypass approval" },
];

export function SettingsView({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-fg">{t("settings_title")}</h1>
      </div>
      <LanguageSettings onAuthError={onAuthError} />
      <MainAgentSettings onAuthError={onAuthError} />
      <ProvidersSettings onAuthError={onAuthError} />
      <PlanBudgetSettings onAuthError={onAuthError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Agent
// ---------------------------------------------------------------------------

function MainAgentSettings({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const listId = useId();
  const [agent, setAgent] = useState<MainAgent | null>(null);
  const [model, setModel] = useState("");
  const [providerId, setProviderId] = useState("");
  const [persona, setPersona] = useState("");
  const [autonomy, setAutonomy] = useState<Autonomy>("standard");
  const [fetched, setFetched] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = () =>
    api
      .agent()
      .then((a) => {
        setAgent(a);
        setModel(a.model);
        setProviderId(a.providerId);
        setPersona(a.persona ?? "");
        setAutonomy(a.autonomy ?? "standard");
      })
      .catch((e) => e instanceof AuthError && onAuthError());

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!agent) return null;

  const dirty =
    model !== agent.model ||
    providerId !== agent.providerId ||
    persona !== (agent.persona ?? "") ||
    autonomy !== (agent.autonomy ?? "standard");

  const flash = (m: string) => {
    setStatus(m);
    setTimeout(() => setStatus(null), 2500);
  };

  const save = async () => {
    setBusy("save");
    try {
      const next = await api.saveAgent({ model, providerId, persona, autonomy });
      setAgent(next);
      flash("Saved ✓");
    } catch (e) {
      if (e instanceof AuthError) return onAuthError();
      flash(String(e));
    } finally {
      setBusy(null);
    }
  };

  const fetchModels = async () => {
    if (!providerId) return;
    setBusy("fetch");
    try {
      setFetched((await api.providerModels(providerId)).models);
    } catch (e) {
      if (e instanceof AuthError) onAuthError();
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    if (!confirm("Abort any running turn and clear all conversation context?")) return;
    setBusy("reset");
    try {
      const r = await api.resetAgent();
      flash(`Reset ${r.sessions} session(s), aborted ${r.aborted} ✓`);
    } finally {
      setBusy(null);
    }
  };

  const restart = async () => {
    if (!confirm("Restart the bot service? The panel will briefly disconnect.")) return;
    setBusy("restart");
    try {
      await api.restartAgent();
      flash("Restarting…");
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title={t("settings_agent")}
      right={<Badge tone="blue">{agent.effectiveModel}</Badge>}
    >
      <p className="mb-4 text-sm text-fg-dim">{t("settings_agent_desc")}</p>

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{t("provider")}</Label>
            <Select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Anthropic (default / .env)</option>
              {agent.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t("model")}</Label>
            <div className="flex gap-2">
              <Input
                list={listId}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={providerId ? "local model name" : "default (CLAUDE_MODEL)"}
              />
              {providerId && (
                <Button onClick={fetchModels} disabled={busy === "fetch"} className="shrink-0">
                  {busy === "fetch" ? "…" : "Fetch"}
                </Button>
              )}
            </div>
            <datalist id={listId}>
              {[...new Set([...(providerId ? fetched : MODEL_SUGGESTIONS), ...fetched])].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <Label>{t("persona")}</Label>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {PERSONA_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPersona(p.value)}
                className={`rounded px-2 py-0.5 text-xs border transition-colors ${
                  persona === p.value
                    ? "bg-[var(--accent)] text-white border-transparent"
                    : "border-line text-fg-dim hover:text-fg"
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPersona("")}
              className={`rounded px-2 py-0.5 text-xs border transition-colors ${
                !persona
                  ? "bg-[var(--accent)] text-white border-transparent"
                  : "border-line text-fg-dim hover:text-fg"
              }`}
            >
              Default
            </button>
            {persona && !PERSONA_PRESETS.find((p) => p.value === persona) && (
              <span className="rounded px-2 py-0.5 text-xs border border-line text-fg-dim">Custom</span>
            )}
          </div>
          <TextArea
            rows={2}
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            placeholder="concise and direct · warm and encouraging · formal and precise"
          />
        </div>

        <div>
          <Label>{t("autonomy")}</Label>
          <div className="mt-1 flex gap-2 flex-wrap">
            {AUTONOMY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setAutonomy(opt.value)}
                title={opt.description}
                className={`rounded px-2.5 py-1 text-xs font-medium border transition-colors ${
                  autonomy === opt.value
                    ? "bg-[var(--accent)] text-white border-transparent"
                    : "border-line text-fg-dim hover:text-fg"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" onClick={save} disabled={!dirty || busy === "save"}>
            {busy === "save" ? "Saving…" : t("save")}
          </Button>
          <Button onClick={reset} disabled={busy === "reset"}>
            New context
          </Button>
          <Button
            variant="danger"
            onClick={restart}
            disabled={!agent.serviceInstalled || busy === "restart"}
            title={agent.serviceInstalled ? "" : "No service manager detected"}
          >
            Restart service
          </Button>
          {status && <span className="text-xs text-fg-dim">{status}</span>}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Language Settings
// ---------------------------------------------------------------------------

function LanguageSettings({ onAuthError }: { onAuthError: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [agent, setAgent] = useState<MainAgent | null>(null);
  const [agentLang, setAgentLang] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api
      .agent()
      .then((a) => {
        setAgent(a);
        setAgentLang(a.defaultLanguage ?? "en");
      })
      .catch((e) => e instanceof AuthError && onAuthError());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const next = await api.saveAgent({ defaultLanguage: agentLang });
      setAgent(next);
      setStatus("Saved ✓");
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      if (e instanceof AuthError) onAuthError();
    } finally {
      setBusy(false);
    }
  };

  const dirty = agent ? agentLang !== (agent.defaultLanguage ?? "en") : false;

  return (
    <Card title={t("settings_language")}>
      <p className="mb-4 text-sm text-fg-dim">{t("settings_language_desc")}</p>

      <div className="space-y-4">
        {/* Panel interface language */}
        <div>
          <Label>{t("lang_interface")}</Label>
          <div className="mt-1.5 flex gap-2">
            {Object.entries(INTERFACE_LANGUAGES).map(([code, label]) => (
              <button
                key={code}
                onClick={() => setLang(code)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm border transition-colors ${
                  lang === code
                    ? "bg-[var(--accent)] text-white border-transparent"
                    : "border-line text-fg-dim hover:text-fg"
                }`}
              >
                <span className="text-base">{code === "en" ? "🇬🇧" : "🇭🇺"}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Agent communication language */}
        <div>
          <Label>{t("lang_agent")}</Label>
          <p className="mt-0.5 mb-1.5 text-xs text-fg-faint">{t("lang_agent_desc")}</p>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <Select
                value={agentLang}
                onChange={(e) => setAgentLang(e.target.value)}
              >
                {Object.entries(AGENT_LANGUAGES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              variant="primary"
              onClick={save}
              disabled={!dirty || busy}
            >
              {busy ? "Saving…" : t("save")}
            </Button>
          </div>
          {status && <p className="mt-1 text-xs text-fg-dim">{status}</p>}
          <p className="mt-1.5 text-xs text-fg-faint">
            Override per-chat with <code>/lang &lt;code&gt;</code> in Telegram.
            Each Lead can also have its own language in the Agents view.
          </p>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Plan / Budget
// ---------------------------------------------------------------------------

const PLAN_OPTIONS: Array<{ value: PlanType; label: string; sub: string }> = [
  { value: "pro", label: "Claude Pro", sub: "$20/month — set spending cap below" },
  { value: "max", label: "Claude Max", sub: "$100/month — set spending cap below" },
  { value: "api", label: "API", sub: "Pay per token — set your own monthly cap" },
];

const INTERVAL_OPTIONS = [
  { label: "Never", value: 0 },
  { label: "Every hour", value: 3_600_000 },
  { label: "Every 6 hours", value: 21_600_000 },
  { label: "Daily", value: 86_400_000 },
  { label: "Weekly", value: 604_800_000 },
];

const PROBE_INTERVAL_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "15 min", value: 900_000 },
  { label: "30 min", value: 1_800_000 },
  { label: "1 hour", value: 3_600_000 },
  { label: "3 hours", value: 10_800_000 },
];

function PlanBudgetSettings({ onAuthError }: { onAuthError: () => void }) {
  const [, setPlanState] = useState<PlanView | null>(null);
  const [form, setForm] = useState({
    plan: "api" as PlanType,
    monthlyCap: 0,
    billingDay: 1,
    alertThresholdPct: 80,
    costCheckIntervalMs: 0,
    probeIntervalMs: 1_800_000,
  });
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeRunning, setProbeRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadPlan = () =>
    api
      .plan()
      .then((p) => {
        setPlanState(p);
        setForm({
          plan: p.plan,
          monthlyCap: p.monthlyCap,
          billingDay: p.billingDay,
          alertThresholdPct: p.alertThresholdPct,
          costCheckIntervalMs: p.costCheckIntervalMs ?? 0,
          probeIntervalMs: p.probeIntervalMs ?? 1_800_000,
        });
      })
      .catch((e) => e instanceof AuthError && onAuthError());

  useEffect(() => {
    void loadPlan();
    api.usageProbe().then(setProbe).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api.savePlan({
        ...form,
        costCheckIntervalMs: form.costCheckIntervalMs || undefined,
        probeIntervalMs: form.probeIntervalMs,
      });
      await loadPlan();
      setStatus("Saved ✓");
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      if (e instanceof AuthError) onAuthError();
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    setProbeRunning(true);
    await api.runProbe().catch(() => {});
    let attempts = 0;
    const poll = setInterval(async () => {
      const p = await api.usageProbe().catch(() => null);
      if (p) setProbe(p);
      if (++attempts >= 15) clearInterval(poll);
    }, 2000);
    setTimeout(() => { clearInterval(poll); setProbeRunning(false); }, 30_000);
  };

  // Auto-detect from OAuth probe
  const detectedPlan: string | null =
    probe?.account?.hasMax ? "Claude Max" :
    probe?.account?.hasPro ? "Claude Pro" :
    null;
  const isSubscription = Boolean(probe?.account?.hasPro || probe?.account?.hasMax);
  const effectivePlanLabel = detectedPlan ?? PLAN_OPTIONS.find((o) => o.value === form.plan)?.label ?? "";

  return (
    <Card title="Subscription and Budget">
      <div className="space-y-5">

        {/* Account: auto-detected or manual selector */}
        <div className="rounded-lg border border-line bg-input p-3 space-y-3">
          <div className="flex flex-wrap items-start gap-3 justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-fg">Claude account</p>
              {probe?.account?.email && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-fg-faint">Logged in as</span>
                  <BlurredEmail email={probe.account.email} />
                </div>
              )}
              {detectedPlan ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                    {detectedPlan}
                  </span>
                  <span className="text-xs text-fg-faint">auto-detected via Claude Code CLI</span>
                </div>
              ) : probe?.source === "fallback" ? (
                <p className="text-xs text-amber-400">OAuth unavailable — set plan manually below</p>
              ) : (
                <p className="text-xs text-fg-faint">Click "Check now" to detect</p>
              )}
            </div>
            <Button onClick={runCheck} disabled={probeRunning}>
              {probeRunning ? "Checking…" : "Check now"}
            </Button>
          </div>

          {/* Compact limit preview */}
          {probe?.source === "oauth" && probe.limits.length > 0 && (
            <div className="space-y-1.5">
              {probe.limits.slice(0, 2).map((lim) => (
                <div key={lim.label} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs text-fg-dim">{lim.label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${lim.severity === "critical" ? "bg-red-500" : lim.severity === "warning" ? "bg-amber-400" : "bg-accent"}`}
                      style={{ width: `${Math.min(100, lim.percent)}%` }}
                    />
                  </div>
                  <span className="w-8 tabular text-right text-xs text-fg-dim">{lim.percent}%</span>
                  <span className="text-xs text-fg-faint hidden sm:inline">
                    resets {new Date(lim.resetsAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
              {probe.probedAt && (
                <p className="text-[10px] text-fg-faint">Last checked: {new Date(probe.probedAt).toLocaleTimeString()}</p>
              )}
            </div>
          )}

          {/* Auto-refresh interval */}
          <div>
            <p className="text-xs text-fg-faint mb-1.5">Auto-refresh interval</p>
            <div className="flex flex-wrap gap-1.5">
              {PROBE_INTERVAL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setForm({ ...form, probeIntervalMs: opt.value })}
                  className={`rounded px-2 py-0.5 text-xs border transition-colors ${
                    form.probeIntervalMs === opt.value
                      ? "bg-[var(--accent)] text-white border-transparent"
                      : "border-line text-fg-dim hover:text-fg"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Manual plan override — only shown when auto-detect fails */}
        {!detectedPlan && (
          <div>
            <Label>Plan (manual)</Label>
            <p className="mt-0.5 mb-2 text-xs text-fg-faint">
              Set manually if the auto-detect above is unavailable.
            </p>
            <div className="flex flex-wrap gap-2">
              {PLAN_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    const cap = opt.value === "pro" ? 20 : opt.value === "max" ? 100 : form.monthlyCap;
                    setForm({ ...form, plan: opt.value, monthlyCap: cap });
                  }}
                  className={`flex flex-col rounded-lg border px-3 py-2 text-left transition-colors ${
                    form.plan === opt.value ? "border-[var(--accent)] bg-accent/10" : "border-line hover:border-fg-dim"
                  }`}
                >
                  <span className={`text-sm font-medium ${form.plan === opt.value ? "text-accent" : "text-fg"}`}>{opt.label}</span>
                  <span className="text-xs text-fg-faint">{opt.sub}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Budget cap — always available for tracking; labeled by plan */}
        <div>
          <Label>{isSubscription ? `Monthly budget reference (${effectivePlanLabel})` : "Monthly cap (USD)"}</Label>
          {isSubscription && (
            <p className="mt-0.5 mb-1 text-xs text-fg-faint">
              Optional reference amount for MyHQ cost tracking. Your {effectivePlanLabel} subscription is billed separately at a flat rate.
            </p>
          )}
          <div className="mt-1 grid gap-3 sm:grid-cols-3">
            <div>
              <input
                type="number"
                min={0}
                step={1}
                value={form.monthlyCap}
                onChange={(e) => setForm({ ...form, monthlyCap: Number(e.target.value) })}
                className="w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-fg focus:border-[var(--accent)] focus:outline-none"
                placeholder="0 = no cap"
              />
            </div>
            <div>
              <input
                type="number"
                min={1}
                max={28}
                value={form.billingDay}
                onChange={(e) => setForm({ ...form, billingDay: Number(e.target.value) })}
                className="w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-fg focus:border-[var(--accent)] focus:outline-none"
                placeholder="Billing day (1-28)"
                title="Billing day (1-28)"
              />
            </div>
            <div>
              <input
                type="number"
                min={0}
                max={100}
                value={form.alertThresholdPct}
                onChange={(e) => setForm({ ...form, alertThresholdPct: Number(e.target.value) })}
                className="w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-fg focus:border-[var(--accent)] focus:outline-none"
                placeholder="Alert at % (0 = off)"
                title="Telegram alert when spend reaches this % of cap"
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-fg-faint">Monthly cap (USD) · Billing day · Alert at %</p>
        </div>

        {/* Telegram cost report */}
        <div>
          <Label>Telegram cost report interval</Label>
          <p className="mt-0.5 mb-1.5 text-xs text-fg-faint">
            Send a spend summary to Telegram on this schedule (heartbeat must be running).
          </p>
          <div className="flex flex-wrap gap-1.5">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setForm({ ...form, costCheckIntervalMs: opt.value })}
                className={`rounded px-2.5 py-1 text-xs border transition-colors ${
                  form.costCheckIntervalMs === opt.value
                    ? "bg-[var(--accent)] text-white border-transparent"
                    : "border-line text-fg-dim hover:text-fg"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          {status && <span className="text-xs text-fg-dim">{status}</span>}
        </div>
      </div>
    </Card>
  );
}

function BlurredEmail({ email }: { email: string }) {
  return (
    <span
      className="text-xs font-mono text-fg-faint select-none cursor-default transition-all duration-200"
      style={{ filter: "blur(5px)" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = "blur(0)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = "blur(5px)"; }}
      title="Hover to reveal"
    >
      {email}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Providers (moved from Workers)
// ---------------------------------------------------------------------------

const blankProvider = { name: "", baseUrl: "", authToken: "" };

const PROVIDER_PRESETS = [
  { name: "LM Studio", baseUrl: "http://localhost:1234", authToken: "lmstudio" },
  { name: "Ollama", baseUrl: "http://localhost:11434", authToken: "ollama" },
];

function ProvidersSettings({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(blankProvider);
  const [probe, setProbe] = useState<{ busy: boolean; models?: string[]; error?: string }>({ busy: false });

  const load = () =>
    api
      .providers()
      .then((r) => setProviders(r.providers))
      .catch((e) => e instanceof AuthError && onAuthError());

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const testModels = async () => {
    setProbe({ busy: true });
    try {
      const r = await api.fetchModels(form.baseUrl, form.authToken);
      setProbe({ busy: false, models: r.models });
    } catch (e) {
      if (e instanceof AuthError) return onAuthError();
      setProbe({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const save = async () => {
    try {
      if (editing === "new") await api.createProvider(form);
      else if (editing) await api.updateProvider(editing, form);
      setEditing(null);
      await load();
    } catch (e) {
      if (e instanceof AuthError) onAuthError();
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this provider? Workers using it fall back to Anthropic.")) return;
    await api.deleteProvider(id);
    await load();
  };

  return (
    <Card
      title={t("settings_providers")}
      right={
        !editing ? (
          <Button variant="primary" onClick={() => { setForm(blankProvider); setEditing("new"); setProbe({ busy: false }); }}>
            + New provider
          </Button>
        ) : null
      }
    >
      <p className="mb-3 text-sm text-fg-dim">{t("settings_providers_desc")}</p>

      {editing && (
        <div className="mb-4 space-y-3 rounded-lg border border-line bg-input p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-dim">Prefill:</span>
            {PROVIDER_PRESETS.map((p) => (
              <Button key={p.name} onClick={() => { setForm(p); setProbe({ busy: false }); }}>
                {p.name}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="LM Studio" />
            </div>
            <div>
              <Label>Base URL</Label>
              <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://localhost:1234" />
            </div>
            <div>
              <Label>Auth token</Label>
              <Input value={form.authToken} onChange={(e) => setForm({ ...form, authToken: e.target.value })} placeholder="lmstudio" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={save} disabled={!form.name.trim() || !form.baseUrl.trim()}>{t("save")}</Button>
            <Button onClick={testModels} disabled={!form.baseUrl.trim() || probe.busy}>
              {probe.busy ? "Fetching…" : "Test / fetch models"}
            </Button>
            <Button onClick={() => setEditing(null)}>{t("cancel")}</Button>
          </div>
          {probe.error && <p className="text-xs text-red-400">{probe.error}</p>}
          {probe.models && (
            <p className="text-xs text-emerald-400">
              ✓ {probe.models.length} model{probe.models.length === 1 ? "" : "s"}:{" "}
              <span className="font-mono text-fg-dim">{probe.models.join(", ")}</span>
            </p>
          )}
        </div>
      )}

      {providers.length === 0 && !editing ? (
        <p className="text-sm text-fg-dim">
          No providers configured. Add one to point agents at LM Studio, Ollama, or a proxy.
        </p>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-2.5">
              <div className="min-w-0">
                <span className="font-medium text-fg">{p.name}</span>
                <span className="ml-2 font-mono text-xs text-fg-faint">{p.baseUrl}</span>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button onClick={() => { setForm({ name: p.name, baseUrl: p.baseUrl, authToken: p.authToken }); setEditing(p.id); }}>
                  {t("edit")}
                </Button>
                <Button variant="danger" onClick={() => del(p.id)}>{t("delete")}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

