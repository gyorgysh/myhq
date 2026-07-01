import { randomBytes } from "node:crypto";

/** Pending question from a crew agent waiting for the president's reply. */
interface PendingAsk {
  id: string;
  chatId: number;
  /** Id of the agent that asked ("atlas" or a Lead/worker id) — a private 1:1
   *  chat has the same numeric chatId across every bot token (Telegram sets
   *  chat.id == user.id regardless of which bot the conversation is with), so
   *  chatId alone can't tell two agents' pending asks in the same chat apart. */
  agentId: string;
  resolve: (text: string) => void;
  reject: (reason: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingAsk>();

/**
 * Register a pending crew_ask_president question. Returns a promise that
 * resolves with the user's reply text, or rejects on timeout.
 */
export function registerAsk(
  chatId: number,
  agentId: string,
  timeoutMs: number,
): { id: string; promise: Promise<string> } {
  const id = randomBytes(4).toString("hex");
  const promise = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject("Timed out waiting for president's reply.");
    }, timeoutMs);
    timer.unref?.();
    pending.set(id, { id, chatId, agentId, resolve, reject, timer });
  });
  return { id, promise };
}

/**
 * Try to resolve the oldest pending ask from the given agent in the given chat
 * with the given text. Returns true if an ask was found and resolved.
 */
export function resolveAsk(chatId: number, agentId: string, text: string): boolean {
  for (const [id, ask] of pending) {
    if (ask.chatId === chatId && ask.agentId === agentId) {
      clearTimeout(ask.timer);
      pending.delete(id);
      ask.resolve(text);
      return true;
    }
  }
  return false;
}

/** Whether there is a pending ask from the given agent in the given chat. */
export function hasPendingAsk(chatId: number, agentId: string): boolean {
  for (const ask of pending.values()) {
    if (ask.chatId === chatId && ask.agentId === agentId) return true;
  }
  return false;
}
