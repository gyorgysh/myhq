import type { Context, MiddlewareFn } from "telegraf";
import { allowedUserIds } from "./config.js";
import { log } from "./logger.js";

/**
 * Gate every update behind the user-id allow-list. This is the only barrier in
 * front of full Claude Code access on this machine, so unknown users are dropped.
 */
export const authMiddleware: MiddlewareFn<Context> = async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId !== undefined && allowedUserIds.has(userId)) {
    return next();
  }
  // Silently drop everything from anyone not on the allow-list: no reply, no
  // callback answer — the update is ignored entirely. Just log for the operator.
  log.warn("Ignored update from unauthorized user", {
    userId: userId ?? null,
    username: ctx.from?.username ?? null,
    type: ctx.updateType,
  });
};
