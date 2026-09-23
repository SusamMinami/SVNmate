import { useLayoutEffect, useRef } from "react";
import type { ShotPlan } from "../types";

// Each run owns only the shot array it last published. Manual edits relinquish
// that ownership, so a delayed model response can never replace edited shots.
export function useRuleAdvisorSession(
  shots: ShotPlan[],
  enabled: boolean,
  onStop: () => void,
) {
  const active = useRef<{
    controller: AbortController;
    published: ShotPlan[];
  } | null>(null);
  const stopRef = useRef(onStop);
  stopRef.current = onStop;
  function cancel() {
    if (!active.current) return;
    active.current.controller.abort();
    active.current = null;
    stopRef.current();
  }
  useLayoutEffect(() => {
    if (active.current && (!enabled || shots !== active.current.published)) cancel();
  }, [shots, enabled]);
  useLayoutEffect(() => () => {
    active.current?.controller.abort();
    active.current = null;
  }, []);
  return {
    cancel,
    start(published: ShotPlan[]) {
      cancel();
      const session = { controller: new AbortController(), published };
      active.current = session;
      return {
        signal: session.controller.signal,
        publish(next: ShotPlan[]) { session.published = next; },
        finish() { if (active.current === session) active.current = null; },
      };
    },
  };
}
