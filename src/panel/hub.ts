import type { WebSocket } from "ws";
import { getHealth } from "../core/health.js";

const HEALTH_PUSH_MS = 2000;

/** Public view of one connected panel device, broadcast in presence frames. */
export interface PresenceClient {
  /** Stable per-device id (browser localStorage); multiple tabs may share it. */
  clientId: string;
  /** Human-readable device label, e.g. "Chrome on macOS". */
  label: string;
  /** When this socket connected (epoch ms). */
  since: number;
}

interface ClientMeta {
  clientId: string;
  label: string;
  since: number;
}

/**
 * Fan-out hub for all panel WebSocket clients. Pushes a health frame on an
 * interval (only while at least one client is connected) and lets other
 * subsystems (the worker manager) broadcast events to every client.
 *
 * Each socket also carries presence metadata (set via {@link register} once the
 * client sends its `hello`), so the panel can show how many devices are
 * connected and warn when more than one is active at once.
 */
export class PanelHub {
  private clients = new Map<WebSocket, ClientMeta>();
  private timer?: ReturnType<typeof setInterval>;

  add(socket: WebSocket): void {
    this.clients.set(socket, { clientId: "", label: "", since: Date.now() });
    // Send an immediate health frame so a fresh client isn't blank for 2s.
    void this.sendHealth(socket);
    if (!this.timer) this.startHealth();
    const drop = () => this.remove(socket);
    socket.on("close", drop);
    socket.on("error", drop);
  }

  /** Attach device metadata to a socket (from its `hello` frame) and announce. */
  register(socket: WebSocket, info: { clientId: string; label: string }): void {
    const meta = this.clients.get(socket);
    if (!meta) return;
    meta.clientId = String(info.clientId || "").slice(0, 64);
    meta.label = String(info.label || "").slice(0, 80) || "Unknown device";
    this.broadcastPresence();
  }

  remove(socket: WebSocket): void {
    const had = this.clients.delete(socket);
    if (this.clients.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (had) this.broadcastPresence();
  }

  /** Connected devices (deduped by clientId; multiple tabs collapse to one). */
  presenceList(): PresenceClient[] {
    const byId = new Map<string, PresenceClient>();
    for (const meta of this.clients.values()) {
      if (!meta.clientId) continue;
      const existing = byId.get(meta.clientId);
      if (!existing || meta.since < existing.since) {
        byId.set(meta.clientId, { clientId: meta.clientId, label: meta.label, since: meta.since });
      }
    }
    return [...byId.values()].sort((a, b) => a.since - b.since);
  }

  private broadcastPresence(): void {
    this.broadcast({ type: "presence", clients: this.presenceList() });
  }

  /** Send a JSON message to every connected client. */
  broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    for (const c of this.clients.keys()) {
      try {
        c.send(data);
      } catch {
        /* client went away mid-send */
      }
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const c of this.clients.keys()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  private startHealth(): void {
    this.timer = setInterval(() => {
      void getHealth().then((data) => this.broadcast({ type: "health", data }));
    }, HEALTH_PUSH_MS);
    this.timer.unref?.();
  }

  private async sendHealth(socket: WebSocket): Promise<void> {
    try {
      socket.send(JSON.stringify({ type: "health", data: await getHealth() }));
    } catch {
      /* ignore */
    }
  }
}
