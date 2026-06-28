import { useEffect, useState } from "react";
import { api } from "../api.ts";

// Whether this deployment is on a flat-rate Claude subscription (Pro/Max), where
// Claude Code usage incurs no extra per-token API cost. When true, the panel
// hides every USD figure, since the SDK's cost estimate is just a "what this
// would have cost on the API" number and reads as a real bill otherwise.
//
// Cached module-level so the many cost-displaying components (Usage, Sessions,
// Workers, Crew) share a single /api/me fetch instead of each hitting it.
let cached: boolean | undefined;
let inflight: Promise<boolean> | undefined;
const listeners = new Set<(v: boolean) => void>();

function load(): Promise<boolean> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (!inflight) {
    inflight = api
      .me()
      .then((m) => {
        cached = Boolean(m.subscriptionPlan);
        listeners.forEach((fn) => fn(cached!));
        return cached;
      })
      .catch(() => false)
      .finally(() => {
        inflight = undefined;
      });
  }
  return inflight;
}

/** True when on a Pro/Max subscription (hide costs). Defaults to false until loaded. */
export function useSubscription(): boolean {
  const [sub, setSub] = useState<boolean>(cached ?? false);
  useEffect(() => {
    let active = true;
    listeners.add(setSub);
    void load().then((v) => {
      if (active) setSub(v);
    });
    return () => {
      active = false;
      listeners.delete(setSub);
    };
  }, []);
  return sub;
}
