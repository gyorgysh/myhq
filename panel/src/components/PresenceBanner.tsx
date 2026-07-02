import { useState } from "react";
import { usePresence } from "../lib/usePresence.ts";
import { useI18n } from "../lib/useI18n.ts";

/**
 * A slim banner shown when more than one device is connected to the panel at
 * once, so concurrent edits from another browser/phone aren't a silent surprise.
 * Dismissible per-session; re-appears if the set of other devices changes.
 */
export function PresenceBanner() {
  const { others } = usePresence();
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState("");

  if (others.length === 0) return null;
  // Key the dismissal to the current set of devices, so a new device joining
  // (a genuinely new conflict risk) re-shows the banner.
  const key = others.map((o) => o.clientId).sort().join(",");
  if (dismissed === key) return null;

  const names = others.map((o) => o.label).join(", ");
  const text =
    others.length === 1
      ? t("presence_one").replace("{device}", names)
      : t("presence_many").replace("{count}", String(others.length)).replace("{devices}", names);

  return (
    <div role="status" aria-live="polite" className="sticky top-0 z-30 bg-page">
      <div className="border-b border-signal/30 bg-signal/10 px-4 py-2 text-sm text-fg">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal/70 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-signal" />
          </span>
          <span className="font-medium">{t("presence_title")}</span>
          <span className="text-fg-dim">{text}</span>
          <button
            onClick={() => setDismissed(key)}
            className="ml-auto rounded-md border border-current/30 px-2 py-0.5 text-xs font-medium hover:bg-current/10"
          >
            {t("presence_dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
