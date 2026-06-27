import { LeadBot } from "./leadBot.js";
import { workers } from "../core/workers.js";
import { log } from "../logger.js";

/**
 * Owns the set of live {@link LeadBot} instances and keeps it in sync with the
 * worker registry. A Lead with a Telegram token, role "lead", and enabled is
 * "always listening": its bot long-polls Telegram and answers DMs even without
 * a specific task assigned.
 *
 * {@link sync} reconciles the running set against `workers.leads()` and is
 * idempotent, so it can be called on boot and on every registry mutation
 * (create/update/delete) to bring Leads online/offline live, no restart needed.
 */
export class LeadBotManager {
  private bots = new Map<string, { bot: LeadBot; tokenRef: string }>();

  /** Reconcile the running Lead bots against the current registry. */
  async sync(): Promise<void> {
    const desired = workers.leads();

    // Stop bots that are no longer desired, or whose token changed (a token
    // change needs a fresh Telegraf instance to take effect).
    for (const [id, entry] of [...this.bots]) {
      const lead = desired.find((w) => w.id === id);
      if (!lead || lead.telegramToken !== entry.tokenRef) {
        try {
          entry.bot.stop("SIGTERM");
        } catch (err) {
          log.error("Lead bot stop failed", { leadId: id, error: String(err) });
        }
        this.bots.delete(id);
      }
    }

    // Start bots for desired Leads not currently running.
    for (const lead of desired) {
      if (this.bots.has(lead.id)) continue;
      try {
        const bot = new LeadBot(lead);
        await bot.start();
        this.bots.set(lead.id, { bot, tokenRef: lead.telegramToken! });
      } catch (err) {
        // One bad token (e.g. 401 from Telegram) must not block the others.
        log.error("Lead bot start failed", { leadId: lead.id, error: String(err) });
      }
    }
  }

  /** Stop every running Lead bot (used on shutdown). */
  stopAll(signal: "SIGINT" | "SIGTERM"): void {
    for (const { bot } of this.bots.values()) {
      try {
        bot.stop(signal);
      } catch {
        // best-effort
      }
    }
    this.bots.clear();
  }
}

export const leadBots = new LeadBotManager();
