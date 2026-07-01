/**
 * Shared "still working" acknowledgement for messages that arrive while a turn
 * is already running. Used by both Atlas (bot.ts) and the Lead bots
 * (leadBot.ts) so the busy UX is identical everywhere.
 *
 * The rules that matter:
 *  - We NEVER interrupt the in-flight turn. Cancelling the user's real work
 *    because they got impatient would be worse than the wait. The reply just
 *    reassures them it's still going, tells them what it's on and for how long,
 *    and reminds them /stop cancels it (and /ping reports progress).
 *  - It answers essentially every follow-up message (people panic when a bot
 *    goes silent), rotating the wording so it doesn't read like a stuck robot.
 *    A tiny cooldown only dedupes a literal double-send / forwarded burst.
 *  - It's always fire-and-forget. A failed send here must never reject into a
 *    caller's turn-lifecycle catch — doing so previously cleared the RUNNING
 *    turn's busy flag and posted a spurious error.
 */
import type { Telegram } from "telegraf";
import type { Session } from "../session/manager.js";
import { t, langForChat, type TranslationKey } from "./i18n/index.js";
import { escapeHtml } from "./formatting.js";

/** Just long enough to swallow an accidental double-tap / forwarded burst, short
 *  enough that a genuine follow-up a couple of seconds later still gets a reply. */
const BUSY_NOTICE_COOLDOWN_MS = 1500;

/** Rotating reassurance phrases; the busy-notice count picks which one. */
const PHRASES: TranslationKey[] = ["bot_busy_p1", "bot_busy_p2", "bot_busy_p3", "bot_busy_p4"];

export async function sendBusyNotice(tg: Telegram, session: Session): Promise<void> {
  const now = Date.now();
  if (session.lastBusyNoticeAt && now - session.lastBusyNoticeAt < BUSY_NOTICE_COOLDOWN_MS) {
    return; // literal double-send — don't echo it twice
  }
  session.lastBusyNoticeAt = now;
  const count = (session.busyNoticeCount = (session.busyNoticeCount ?? 0) + 1);
  const lang = langForChat(session.chatId);

  const phrase = t(PHRASES[(count - 1) % PHRASES.length], lang);
  const elapsedMs = session.busySince ? now - session.busySince : 0;
  const task = session.busyPrompt
    ? t("bot_busy_task", lang, { task: escapeHtml(session.busyPrompt) })
    : "";
  const text = t("bot_busy_line", lang, { phrase, task, elapsed: fmtElapsed(elapsedMs) });
  await tg.sendMessage(session.chatId, text, { parse_mode: "HTML" }).catch(() => {});
}

function fmtElapsed(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** Short, safe one-line preview of a prompt for busy notices / ping. */
export function promptPreview(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? oneLine.slice(0, 57) + "…" : oneLine;
}
