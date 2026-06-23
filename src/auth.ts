import type { Context, MiddlewareFn } from "telegraf";
import { allowedUserIds } from "./config.js";
import { log } from "./logger.js";

/**
 * Gate every update behind the user-id allow-list. This is the only barrier in
 * front of full Claude Code access on this machine, so unknown users are dropped.
 */
export const authMiddleware: MiddlewareFn<Context> = async (ctx, next) => {
  const userId = ctx.from?.id;
  // Require a private 1:1 chat whose id equals the sender's id. Auth is keyed on
  // the sender, but sessions, streamed output and approval prompts are keyed on
  // the chat — so in a group a whitelisted user would leak the agent's output
  // (host paths, command results) to every member. Restrict to private chats so
  // those two identities can never diverge.
  const isPrivate = ctx.chat?.type === "private" && ctx.chat.id === userId;
  if (userId !== undefined && allowedUserIds.has(userId) && isPrivate) {
    return next();
  }
  // Silently drop everything from anyone not on the allow-list (or not in a
  // private chat): no reply, no callback answer — the update is ignored
  // entirely. Just log for the operator.
  log.warn("Ignored update from unauthorized user", {
    userId: userId ?? null,
    username: ctx.from?.username ?? null,
    chatType: ctx.chat?.type ?? null,
    type: ctx.updateType,
  });
};
