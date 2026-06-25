import { useEffect, useState } from "react";
import { api, AuthError } from "../api.ts";
import { Badge, Button, Card } from "./ui.tsx";
import { useI18n } from "../lib/useI18n.ts";

export function UpdatesView({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const [version, setVersion] = useState<string>("…");

  useEffect(() => {
    api
      .me()
      .then((m) => setVersion(m.version))
      .catch((e) => e instanceof AuthError && onAuthError());
  }, [onAuthError]);

  return (
    <Card title={t("updates_title")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-fg">
            {t("updates_current")} <span className="mono">{version}</span>
          </div>
          <p className="mt-1 text-sm text-fg-dim">{t("updates_latest")}</p>
        </div>
        <Badge tone="green">{t("updates_up_to_date")}</Badge>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-input p-3 text-sm text-fg-dim">
        <p>{t("updates_coming_desc")}</p>
        <pre className="mono mt-2 overflow-x-auto rounded bg-surface-2 p-2 text-xs text-fg">
          scripts/update.sh
        </pre>
      </div>

      <div className="mt-3">
        <Button disabled title={t("updates_coming_soon")}>
          {t("updates_check")}
        </Button>
      </div>
    </Card>
  );
}
