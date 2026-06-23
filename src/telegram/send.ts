import type { Telegram } from "telegraf";
import { escapeHtml, markdownToHtml, splitForTelegram } from "./formatting.js";

/**
 * Persist a finished reply as one or more real messages: markdown -> Telegram
 * HTML, split under the 4096 limit, with a plain-text fallback if Telegram
 * rejects the HTML so a reply is never dropped.
 */
export async function sendFormattedMarkdown(
  tg: Telegram,
  chatId: number,
  markdown: string,
  footer?: string,
): Promise<void> {
  const body = markdownToHtml(markdown) || "";
  const footerLine = footer ? (body ? "\n\n" : "") + `<i>${escapeHtml(footer)}</i>` : "";
  const full = (body + footerLine).trim();
  if (!full) return;
  for (const chunk of splitForTelegram(full)) {
    await sendChunk(tg, chatId, chunk);
  }
}

async function sendChunk(tg: Telegram, chatId: number, text: string): Promise<void> {
  try {
    await tg.sendMessage(chatId, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    const desc = String((err as { description?: string })?.description ?? err);
    if (desc.includes("can't parse entities")) {
      await tg.sendMessage(chatId, stripTags(text), {
        link_preview_options: { is_disabled: true },
      });
      return;
    }
    throw err;
  }
}

export function stripTags(html: string): string {
  return html
    .replace(/<\/?(b|i|code|pre)>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
