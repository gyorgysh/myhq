import { useEffect, useRef } from "react";
import { openHealthSocket, type WebhookTriggerView } from "../api.ts";

/**
 * Subscribe to live webhook-trigger updates over the shared /ws. The server
 * broadcasts the full list whenever a trigger is created/edited or fires
 * ({ type: "webhook-trigger", triggers }); we hand it to `onUpdate` so the view
 * can replace its state wholesale (keeps fire counts fresh as hooks arrive).
 */
export function useWebhookTriggerEvents(onUpdate: (list: WebhookTriggerView[]) => void): void {
  const retryRef = useRef<ReturnType<typeof setTimeout>>();
  const cbRef = useRef(onUpdate);
  cbRef.current = onUpdate;

  useEffect(() => {
    let closed = false;
    let ws: WebSocket;

    const connect = () => {
      if (closed) return;
      ws = openHealthSocket();
      ws.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          if (parsed.type !== "webhook-trigger") return;
          cbRef.current(parsed.triggers as WebhookTriggerView[]);
        } catch {
          /* ignore non-JSON / unrelated frames */
        }
      };
      ws.onclose = () => {
        if (!closed) retryRef.current = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryRef.current);
      ws?.close();
    };
  }, []);
}
