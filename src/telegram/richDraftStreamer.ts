import { BaseDraftStreamer } from "./baseDraftStreamer.js";
import { escapeHtml, markdownToHtml, tameRichMarkdown } from "./formatting.js";
import { sendFormattedMarkdown } from "./send.js";

/**
 * Streams a reply using Bot API 10.1 Rich Messages: `sendRichMessageDraft`
 * while generating, finalized with `sendRichMessage`.
 *
 * We send the `html` field, not raw markdown: Claude's output is full of `<…>`,
 * `#`, `$`, `@`, `/` (code, generics, paths) that the rich markdown parser
 * either treats as HTML or auto-links into mangled entities. Our markdownToHtml
 * escapes text and emits only a safe, balanced tag subset, and we pass
 * skip_entity_detection so code-ish tokens stay literal — robust on every tick.
 */
export class RichDraftStreamer extends BaseDraftStreamer {
  private html(footer?: string): string {
    const body = markdownToHtml(tameRichMarkdown(this.content)) || "";
    const footerLine = footer ? (body ? "\n\n" : "") + `<i>${escapeHtml(footer)}</i>` : "";
    return (body + footerLine).trim();
  }

  protected async pushDraft(): Promise<void> {
    await this.raw.callApi("sendRichMessageDraft", {
      chat_id: this.chatId,
      draft_id: this.draftId,
      rich_message: { html: this.html(), skip_entity_detection: true },
    });
  }

  async finalize(footer?: string): Promise<void> {
    this.stopTimers();
    if (!this.content.trim()) return;
    try {
      await this.raw.callApi("sendRichMessage", {
        chat_id: this.chatId,
        rich_message: { html: this.html(footer), skip_entity_detection: true },
      });
    } catch {
      // Rich send failed (length/unsupported) — degrade to plain formatted messages.
      await sendFormattedMarkdown(this.tg, this.chatId, tameRichMarkdown(this.content), footer);
    }
  }
}
