import { Modal } from "./ui.tsx";
import { useI18n } from "../lib/useI18n.ts";
import type { TranslationKey } from "../i18n/en.ts";

type ShortcutRow = { keys: string[]; descKey: TranslationKey };
type ShortcutGroup = { headingKey: TranslationKey; rows: ShortcutRow[] };

/**
 * The single source of truth for the global keyboard-shortcut cheat sheet.
 * Reuses the existing `shortcuts_*` i18n rows so copy stays in one place. Keep
 * this in sync with the real handlers (App's Cmd+K / ? listeners, the command
 * palette's arrow/enter/esc keys, and the Tasks board drag interactions).
 */
const GROUPS: ShortcutGroup[] = [
  {
    headingKey: "shortcuts_nav",
    rows: [
      { keys: ["⌘K", "Ctrl K"], descKey: "shortcuts_cmd_k" },
      { keys: ["?"], descKey: "shortcuts_help_key" },
      { keys: ["Esc"], descKey: "shortcuts_esc" },
      { keys: ["↑ ↓"], descKey: "shortcuts_arrow" },
      { keys: ["Enter"], descKey: "shortcuts_enter" },
    ],
  },
  {
    headingKey: "shortcuts_chat",
    rows: [
      { keys: ["Enter"], descKey: "shortcuts_chat_send" },
      { keys: ["Shift Enter"], descKey: "shortcuts_chat_newline" },
    ],
  },
  {
    headingKey: "shortcuts_group_tasks",
    rows: [
      { keys: ["Drag"], descKey: "shortcuts_tasks_dnd" },
      { keys: ["Click"], descKey: "shortcuts_tasks_rename" },
    ],
  },
];

/** A globally reachable keyboard-shortcut cheat sheet, opened with `?` or the
 *  persistent help affordance. Built on the shared Modal (focus trap + Esc). */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal onClose={onClose} labelledBy="shortcuts-modal-title" closeButton size="md">
      <div className="p-5">
        <h2 id="shortcuts-modal-title" className="mb-4 text-sm font-semibold text-fg">
          {t("shortcuts_title")}
        </h2>
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <div key={g.headingKey}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg-faint">
                {t(g.headingKey)}
              </p>
              <div className="space-y-1">
                {g.rows.map((row, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex shrink-0 gap-1">
                      {row.keys.map((k) => (
                        <kbd
                          key={k}
                          className="mono-xs rounded border border-line bg-surface-2 px-1.5 py-0.5 text-fg-dim"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                    <span className="text-xs text-fg-dim">{t(row.descKey)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-line pt-3 text-xs text-fg-faint">
          {t("shortcuts_hint_footer")}
        </p>
      </div>
    </Modal>
  );
}
