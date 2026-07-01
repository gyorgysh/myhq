import { useEffect, useState } from "react";
import { api, AuthError, type WebhookTriggerView, type Worker } from "../api.ts";
import { Badge, Button, Card, Empty, InfoCard, Input, Label, Select, TextArea } from "./ui.tsx";
import { useWebhookTriggerEvents } from "../lib/useWebhookTriggerEvents.ts";
import { toast } from "../lib/useToast.ts";
import { relTime } from "../lib/format.ts";
import { useI18n } from "../lib/useI18n.ts";
import { errorMessage } from "../lib/errorMessage.ts";

const blank = { name: "", prompt: "", cwd: "", leadId: "" };

export function WebhookTriggersView({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const [triggers, setTriggers] = useState<WebhookTriggerView[]>([]);
  const [leads, setLeads] = useState<Worker[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [form, setForm] = useState<typeof blank>(blank);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<typeof blank>(blank);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .webhookTriggers()
      .then((r) => {
        setTriggers(r.triggers);
        setBaseUrl(r.baseUrl);
      })
      .catch((e) => (e instanceof AuthError ? onAuthError() : setError(errorMessage(e, t))));

  useEffect(() => {
    void load();
    api
      .workers()
      .then((r) => setLeads(r.workers.filter((w) => w.role === "lead")))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-refresh the list (fire counts, edits) without a manual reload.
  useWebhookTriggerEvents((list) => setTriggers(list));

  const create = async () => {
    setError(null);
    try {
      const r = await api.createWebhookTrigger({
        name: form.name,
        prompt: form.prompt,
        cwd: form.cwd || undefined,
        leadId: form.leadId || undefined,
      });
      setTriggers(r.triggers);
      setForm(blank);
      setAdding(false);
    } catch (e) {
      if (e instanceof AuthError) return onAuthError();
      setError(errorMessage(e, t));
    }
  };

  const startEdit = (w: WebhookTriggerView) => {
    setEditingId(w.id);
    setEditForm({ name: w.name, prompt: w.prompt, cwd: w.cwd ?? "", leadId: w.leadId ?? "" });
  };

  const saveEdit = async (id: string) => {
    setError(null);
    try {
      const r = await api.updateWebhookTrigger(id, {
        name: editForm.name,
        prompt: editForm.prompt,
        cwd: editForm.cwd,
        leadId: editForm.leadId,
      });
      setTriggers(r.triggers);
      setEditingId(null);
    } catch (e) {
      if (e instanceof AuthError) return onAuthError();
      setError(errorMessage(e, t));
    }
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    setError(null);
    try {
      const r = await api.updateWebhookTrigger(id, { enabled });
      setTriggers(r.triggers);
    } catch (e) {
      if (e instanceof AuthError) return onAuthError();
      setError(errorMessage(e, t));
    }
  };

  const del = (id: string) => {
    if (!confirm(t("hook_delete_confirm"))) return;
    setError(null);
    const prev = triggers;
    setTriggers((cur) => cur.filter((w) => w.id !== id));
    api.deleteWebhookTrigger(id).catch((e) => {
      setTriggers(prev);
      if (e instanceof AuthError) return onAuthError();
      setError(errorMessage(e, t));
    });
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error(t("hook_copy_failed"));
    }
  };

  const copyUrl = (w: WebhookTriggerView) => void copy(`${baseUrl}${w.path}`, t("hook_url_copied"));

  const copySecret = async (id: string) => {
    try {
      const r = await api.webhookTriggerSecret(id);
      await copy(r.secret, t("hook_secret_copied"));
    } catch (e) {
      if (e instanceof AuthError) return onAuthError();
      toast.error(t("hook_copy_failed"));
    }
  };

  const rotate = async (id: string) => {
    if (!confirm(t("hook_rotate_confirm"))) return;
    setError(null);
    try {
      const r = await api.rotateWebhookTriggerSecret(id);
      setTriggers(r.triggers);
      toast.success(t("hook_rotated"));
    } catch (e) {
      if (e instanceof AuthError) return onAuthError();
      setError(errorMessage(e, t));
    }
  };

  return (
    <Card
      title={t("hook_title")}
      right={
        !adding && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t("hook_new")}
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-fg-dim">{t("hook_desc")}</p>
      <div className="mb-3">
        <InfoCard id="webhook-triggers" title={t("info_hooks_title")} body={t("info_hooks_body")}>
          <p>{t("info_hooks_sig")}</p>
        </InfoCard>
      </div>
      {error && <p className="mb-2 text-sm text-critical-fg">{error}</p>}

      {adding && (
        <div className="mb-4 space-y-3 rounded-lg border border-line bg-input p-3">
          <div>
            <Label>{t("hook_name")}</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t("hook_name_placeholder")}
            />
          </div>
          <div>
            <Label>{t("hook_prompt")}</Label>
            <TextArea
              rows={3}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder={t("hook_prompt_placeholder")}
            />
            <p className="mt-1 text-xs text-fg-faint">{t("hook_prompt_hint")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("hook_cwd")}</Label>
              <Input
                value={form.cwd}
                onChange={(e) => setForm({ ...form, cwd: e.target.value })}
                placeholder={t("hook_cwd_placeholder")}
              />
            </div>
            <div>
              <Label>{t("hook_lead")}</Label>
              <Select value={form.leadId} onChange={(e) => setForm({ ...form, leadId: e.target.value })}>
                <option value="">{t("hook_lead_generic")}</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={create} disabled={!form.name.trim() || !form.prompt.trim()}>
              {t("hook_create")}
            </Button>
            <Button onClick={() => setAdding(false)}>{t("cancel")}</Button>
          </div>
        </div>
      )}

      {triggers.length === 0 && !adding ? (
        <Empty
          title={t("hook_empty")}
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              {t("hook_new")}
            </Button>
          }
        >
          {t("hook_empty_desc")}
        </Empty>
      ) : (
        <div className="space-y-2">
          {triggers.map((w) =>
            editingId === w.id ? (
              <div key={w.id} className="space-y-3 rounded-lg border border-accent/50 bg-input p-3">
                <div>
                  <Label>{t("hook_name")}</Label>
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t("hook_prompt")}</Label>
                  <TextArea
                    rows={3}
                    value={editForm.prompt}
                    onChange={(e) => setEditForm({ ...editForm, prompt: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>{t("hook_cwd")}</Label>
                    <Input
                      value={editForm.cwd}
                      onChange={(e) => setEditForm({ ...editForm, cwd: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>{t("hook_lead")}</Label>
                    <Select
                      value={editForm.leadId}
                      onChange={(e) => setEditForm({ ...editForm, leadId: e.target.value })}
                    >
                      <option value="">{t("hook_lead_generic")}</option>
                      {leads.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => saveEdit(w.id)}
                    disabled={!editForm.name.trim() || !editForm.prompt.trim()}
                  >
                    {t("save")}
                  </Button>
                  <Button onClick={() => setEditingId(null)}>{t("cancel")}</Button>
                </div>
              </div>
            ) : (
              <div
                key={w.id}
                className={`rounded-lg border border-line p-3${w.enabled ? "" : " opacity-60"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{w.name}</span>
                  {w.leadName ? <Badge tone="violet">{w.leadName}</Badge> : <Badge tone="zinc">{t("hook_lead_generic")}</Badge>}
                  {!w.enabled && <Badge tone="amber">{t("hook_disabled")}</Badge>}
                  <span className="ml-auto tabular text-xs text-fg-muted">
                    {t("hook_fired_count").replace("{count}", String(w.fireCount))}
                    {w.lastFiredAt ? ` · ${t("hook_last_fired").replace("{time}", relTime(w.lastFiredAt))}` : ""}
                  </span>
                  <Button onClick={() => void toggleEnabled(w.id, !w.enabled)}>
                    {w.enabled ? t("hook_disable") : t("hook_enable")}
                  </Button>
                  <Button onClick={() => startEdit(w)}>{t("edit")}</Button>
                  <Button variant="danger" onClick={() => del(w.id)}>
                    {t("delete")}
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="mono truncate rounded bg-base px-2 py-1 text-xs text-fg-dim" title={`${baseUrl}${w.path}`}>
                    {baseUrl}{w.path}
                  </code>
                  <Button onClick={() => copyUrl(w)}>{t("hook_copy_url")}</Button>
                  <Button onClick={() => void copySecret(w.id)}>{t("hook_copy_secret")}</Button>
                  <Button onClick={() => void rotate(w.id)}>{t("hook_rotate")}</Button>
                  <span className="mono text-xs text-fg-faint">{t("hook_secret_hint")}: …{w.secretHint}</span>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-fg-dim">{w.prompt}</div>
                {w.cwd && (
                  <div className="mono mt-1 truncate text-xs text-fg-faint" title={w.cwd}>
                    {w.cwd}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}
    </Card>
  );
}
