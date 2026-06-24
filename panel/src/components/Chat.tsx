import { useEffect, useRef, useState } from "react";
import { api, type ChatMessage } from "../api.ts";
import { useChatEvents } from "../lib/useChatEvents.ts";
import { Button } from "./ui.tsx";

export function ChatView({ onAuthError }: { onAuthError: () => void }) {
  const { messages, stream, busy, approval, view, setView } = useChatEvents(onAuthError);
  const [text, setText] = useState("");
  const [editingCwd, setEditingCwd] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stick to the bottom as the conversation grows / streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, stream?.text, approval]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    try {
      await api.sendChat(t);
    } catch {
      setText(t);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const toggleAuto = async () => {
    if (!view?.bypassAllowed) return;
    setView(await api.chatSettings({ auto: !view.auto }));
  };

  const saveCwd = async (cwd: string) => {
    setEditingCwd(false);
    setView(await api.chatSettings({ cwd }));
  };

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col md:h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">Chat</h2>
          {editingCwd ? (
            <input
              autoFocus
              defaultValue={view?.cwd ?? ""}
              onBlur={(e) => void saveCwd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveCwd((e.target as HTMLInputElement).value)}
              className="mono mt-0.5 w-72 max-w-full rounded border border-line bg-input px-1.5 py-0.5 text-xs text-fg outline-none focus:border-accent"
            />
          ) : (
            <button
              onClick={() => setEditingCwd(true)}
              title="Change working directory"
              className="mono mt-0.5 block max-w-full truncate text-xs text-fg-dim hover:text-fg-muted"
            >
              {view?.cwd ?? "…"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAuto}
            disabled={!view?.bypassAllowed}
            title={
              view?.bypassAllowed
                ? "Toggle auto-run (bypass approvals)"
                : "Set PANEL_CHAT_BYPASS=true and restart to unlock"
            }
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              view?.auto
                ? "bg-amber-500/15 text-amber-400"
                : "bg-surface-2 text-fg-dim"
            } ${view?.bypassAllowed ? "" : "cursor-not-allowed opacity-60"}`}
          >
            {view?.auto ? "● auto" : "○ safe"}
          </button>
          <Button
            variant="ghost"
            onClick={async () => view && setView(await api.clearChat())}
            disabled={busy}
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && !stream && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-fg-faint">
            <div className="mono mb-2 text-2xl text-accent">%_</div>
            Talk to the agent. It runs in the directory above
            <br />
            and {view?.auto ? "auto-runs tools." : "asks before risky tools."}
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {stream && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-surface px-4 py-2.5 text-sm">
              {stream.tool && (
                <div className="mono mb-1 text-xs text-fg-dim">⚙ {stream.tool}</div>
              )}
              <div className="whitespace-pre-wrap break-words text-fg">
                {stream.text}
                <span className="ml-0.5 animate-pulse text-accent">▮</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Approval prompt */}
      {approval && (
        <div className="mb-3 rounded-xl border border-accent/40 bg-accent/5 p-3">
          <div className="mb-2 text-sm text-fg">
            Allow <span className="font-semibold text-accent">{approval.tool}</span>
            {approval.arg && <span className="mono text-fg-dim"> · {approval.arg}</span>}?
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void api.approveChat(approval.approvalId, true)}>
              Approve
            </Button>
            <Button variant="danger" onClick={() => void api.approveChat(approval.approvalId, false)}>
              Deny
            </Button>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-line pt-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder="Message the agent…  (Enter to send, Shift+Enter for newline)"
          className="max-h-40 min-h-[42px] flex-1 resize-none rounded-xl border border-line bg-input px-3 py-2.5 text-sm text-fg outline-none focus:border-accent"
        />
        {busy ? (
          <Button variant="danger" onClick={() => void api.stopChat()} className="h-[42px]">
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void send()} disabled={!text.trim()} className="h-[42px]">
            Send
          </Button>
        )}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const user = m.role === "user";
  return (
    <div className={`flex ${user ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm ${
          user
            ? "rounded-tr-sm bg-accent text-accent-fg"
            : m.error
              ? "rounded-tl-sm border border-red-500/30 bg-red-500/5 text-red-400"
              : "rounded-tl-sm bg-surface text-fg"
        }`}
      >
        {m.text || (m.error ? "(failed)" : "")}
      </div>
    </div>
  );
}
