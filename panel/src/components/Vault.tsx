import { useEffect, useState } from "react";
import { api, AuthError, type SecretView } from "../api.ts";
import { Badge, Button, Callout, Card, Empty, Input, Label } from "./ui.tsx";

const blank = { name: "", value: "", description: "" };

export function VaultView({ onAuthError }: { onAuthError: () => void }) {
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<typeof blank>(blank);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = () =>
    api
      .vault()
      .then((r) => setSecrets(r.secrets))
      .catch((e) => (e instanceof AuthError ? onAuthError() : setError(String(e))));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNew = () => {
    setForm(blank);
    setEditing("new");
  };
  const startEdit = (s: SecretView) => {
    setForm({ name: s.name, value: "", description: s.description });
    setEditing(s.id);
  };

  const save = async () => {
    try {
      if (editing === "new") await api.createSecret(form);
      else if (editing) await api.updateSecret(editing, form); // empty value = keep existing
      setEditing(null);
      await load();
    } catch (e) {
      if (e instanceof AuthError) return onAuthError();
      setError(String(e));
    }
  };

  const reveal = async (id: string) => {
    if (revealed[id] !== undefined) {
      setRevealed((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      return;
    }
    const { value } = await api.revealSecret(id);
    setRevealed((r) => ({ ...r, [id]: value }));
  };

  const del = async (id: string) => {
    if (!confirm("Delete this secret? Anything referencing it will break.")) return;
    await api.deleteSecret(id);
    await load();
  };

  const importProviders = async () => {
    const { imported } = await api.importSecrets();
    setStatus(imported ? `Imported ${imported} provider token(s) into the vault.` : "No plaintext provider tokens to import.");
    setTimeout(() => setStatus(null), 4000);
    await load();
  };

  return (
    <Card
      title="Secret vault"
      right={
        editing ? null : (
          <Button variant="primary" onClick={startNew}>
            + New secret
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-fg-dim">
        AES-256-GCM encrypted secrets. The master key lives in the macOS Keychain (file fallback on
        Linux). Reference a secret anywhere a token is stored as <code>vault:&lt;id&gt;</code>.
      </p>

      <Callout title="Migrate provider tokens" dismissId="vault-import">
        Move plaintext provider auth tokens into the vault and rewrite them to references in one
        click. Resolution at use-time is transparent.
        <div className="mt-2">
          <Button onClick={importProviders}>Scan &amp; import provider tokens</Button>
          {status && <span className="ml-2 text-xs text-emerald-400">{status}</span>}
        </div>
      </Callout>

      {error && <p className="my-2 text-sm text-red-400">{error}</p>}

      {editing && (
        <div className="my-4 space-y-3 rounded-lg border border-line bg-input p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. notion-token"
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>{editing === "new" ? "Secret value" : "New value (leave blank to keep)"}</Label>
            <Input
              type="password"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder="••••••••"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={save}
              disabled={!form.name.trim() || (editing === "new" && !form.value)}
            >
              Save
            </Button>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {secrets.length === 0 && !editing ? (
        <Empty>No secrets stored.</Empty>
      ) : (
        <div className="mt-3 space-y-2">
          {secrets.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-line p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-fg">{s.name}</span>
                  <Badge>vault:{s.id}</Badge>
                </div>
                {s.description && <p className="text-sm text-fg-dim">{s.description}</p>}
                <p className="mono mt-1 text-xs text-fg-faint">
                  {revealed[s.id] !== undefined ? revealed[s.id] : s.hint}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button onClick={() => reveal(s.id)}>
                  {revealed[s.id] !== undefined ? "Hide" : "Reveal"}
                </Button>
                <Button onClick={() => startEdit(s)}>Edit</Button>
                <Button variant="danger" onClick={() => del(s.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
