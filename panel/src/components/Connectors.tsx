import { useEffect, useState } from "react";
import { api, AuthError, type Connector, type SecretView } from "../api.ts";
import { Badge, Card, Empty, Label, Select } from "./ui.tsx";

export function ConnectorsView({ onAuthError }: { onAuthError: () => void }) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.connectors(), api.vault()])
      .then(([c, v]) => {
        setConnectors(c.connectors);
        setSecrets(v.secrets);
      })
      .catch((e) => (e instanceof AuthError ? onAuthError() : setError(String(e))));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSecret = async (id: string, secretId: string) => {
    setConnectors((cs) => cs.map((c) => (c.id === id ? { ...c, secretId } : c)));
    await api.saveConnector(id, { secretId }).catch(() => void load());
  };

  return (
    <Card title="Connectors">
      <p className="mb-3 text-sm text-fg-dim">
        External integrations the agent will be able to use. These are placeholders — the
        registration surface is here, but none are wired up yet. You can pre-attach a vault secret
        to hold each one's credential.
      </p>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {connectors.length === 0 ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {connectors.map((c) => (
            <div key={c.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-fg">{c.name}</span>
                <Badge tone="amber">coming soon</Badge>
              </div>
              <p className="mt-1 text-sm text-fg-dim">{c.description}</p>
              <p className="mt-1 text-xs text-fg-faint">Needs: {c.credential}</p>
              <div className="mt-2">
                <Label>Credential secret</Label>
                <Select
                  value={c.secretId ?? ""}
                  onChange={(e) => setSecret(c.id, e.target.value)}
                >
                  <option value="">— none —</option>
                  {secrets.map((s) => (
                    <option key={s.id} value={`vault:${s.id}`}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
