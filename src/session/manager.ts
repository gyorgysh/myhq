import { config } from "../config.js";

export type PermissionMode = "safe" | "auto";

export interface Session {
  /** Telegram chat id this session belongs to. */
  chatId: number;
  /** Claude Code session id for resuming context; undefined until first turn / after /new. */
  sessionId?: string;
  /** Working directory Claude operates in. */
  cwd: string;
  /** Whether a query is currently running for this chat. */
  busy: boolean;
  /** Aborts the in-flight query (wired to /stop). */
  abort?: AbortController;
  /** Tools the user chose to "always allow" for this session. */
  sessionAllowedTools: Set<string>;
  /** safe = interactive approval (default); auto = bypass permissions. */
  mode: PermissionMode;
}

export class SessionManager {
  private sessions = new Map<number, Session>();

  get(chatId: number): Session {
    let s = this.sessions.get(chatId);
    if (!s) {
      s = {
        chatId,
        cwd: config.WORKDIR,
        busy: false,
        sessionAllowedTools: new Set(),
        mode: "safe",
      };
      this.sessions.set(chatId, s);
    }
    return s;
  }

  /** Reset conversation context but keep cwd, mode and allow-list. */
  reset(chatId: number): void {
    const s = this.get(chatId);
    s.sessionId = undefined;
  }
}

export const sessions = new SessionManager();
