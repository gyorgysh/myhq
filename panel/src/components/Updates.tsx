import { useEffect, useState } from "react";
import { api, AuthError } from "../api.ts";
import { Badge, Button, Card } from "./ui.tsx";

export function UpdatesView({ onAuthError }: { onAuthError: () => void }) {
  const [version, setVersion] = useState<string>("…");

  useEffect(() => {
    api
      .me()
      .then((m) => setVersion(m.version))
      .catch((e) => e instanceof AuthError && onAuthError());
  }, [onAuthError]);

  return (
    <Card title="Updates">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-fg">
            Current version <span className="mono">{version}</span>
          </div>
          <p className="mt-1 text-sm text-fg-dim">You're on the latest installed build.</p>
        </div>
        <Badge tone="green">up to date</Badge>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-input p-3 text-sm text-fg-dim">
        <p>
          Automatic update checks and one-click updates from the panel are coming soon. For now,
          update on the host:
        </p>
        <pre className="mono mt-2 overflow-x-auto rounded bg-surface-2 p-2 text-xs text-fg">
          scripts/update.sh
        </pre>
      </div>

      <div className="mt-3">
        <Button disabled title="Coming soon">
          Check for updates
        </Button>
      </div>
    </Card>
  );
}
