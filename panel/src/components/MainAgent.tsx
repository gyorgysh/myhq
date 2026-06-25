import { useEffect, useId, useState } from "react";
import { api, AuthError, type MainAgent, type Autonomy } from "../api.ts";
import { Badge, Button, Card, Input, Label, Select, TextArea } from "./ui.tsx";

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
  { value: "full", label: "Full", description: "All tools bypass approval (autonomous)" },
];

/** Configure the main bot agent: model, provider, persona, autonomy, lifecycle controls. */
export function MainAgentCard({ onAuthError }: { onAuthError: () => void }) {
  const [agent, setAgent] = useState<MainAgent | null>(null);
  const [model, setModel] = useState("");
  const [providerId, setProviderId] = useState("");
  const [persona, setPersona] = useState("");
  const [autonomy, setAutonomy] = useState<Autonomy>("standard");
  const [fetched, setFetched] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const listId = useId();

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
      flash("Saved — applies on the next message ✓");
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
      flash("Restarting… reconnecting shortly");
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title={agent.effectiveModel ? `${agent.effectiveModel}` : "Main Agent"}
      right={<Badge tone="blue">{agent.effectiveModel}</Badge>}
    >
      <p className="mb-3 text-sm text-fg-dim">
        The agent driving Telegram chats. Changes apply on the next message (a fresh{" "}
        <code>claude</code> process starts per turn).
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Provider</Label>
          <Select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">Anthropic (default / .env)</option>
            {agent.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Model</Label>
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

      <div className="mt-3">
        <Label>Persona (character and tone)</Label>
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

      <div className="mt-3">
        <Label>Autonomy</Label>
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={!dirty || busy === "save"}>
          {busy === "save" ? "Saving…" : "Save"}
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
    </Card>
  );
}
