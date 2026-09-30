import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useReducedMotionPreference } from "./useReducedMotionPreference";

export type WorkspaceFramePhase =
  | "idle"
  | "pending"
  | "revealing"
  | "settled";

const REVEAL_DURATION_MS = 920;

export function useWorkspaceFrameRevealAttribute(
  targetRef: RefObject<HTMLElement | null>,
  active: boolean,
  initialDelayMs = 0,
): void {
  const { reducedMotion } = useReducedMotionPreference();
  const hasActivated = useRef(false);

  useLayoutEffect(() => {
    let delayTimeoutId: number | null = null;
    let idleRequestId: number | null = null;
    let settleTimeoutId: number | null = null;

    const clearScheduled = () => {
      if (delayTimeoutId !== null) {
        window.clearTimeout(delayTimeoutId);
        delayTimeoutId = null;
      }
      if (idleRequestId !== null) {
        window.cancelIdleCallback(idleRequestId);
        idleRequestId = null;
      }
      if (settleTimeoutId !== null) {
        window.clearTimeout(settleTimeoutId);
        settleTimeoutId = null;
      }
    };
    const setPhase = (phase: WorkspaceFramePhase) => {
      if (targetRef.current) {
        targetRef.current.dataset.framePhase = phase;
      }
    };
    const update = () => {
      clearScheduled();
      if (!active || document.hidden) {
        setPhase("idle");
        return;
      }
      if (reducedMotion) {
        setPhase("settled");
        return;
      }

      setPhase("pending");
      const reveal = () => {
        hasActivated.current = true;
        setPhase("revealing");
        settleTimeoutId = window.setTimeout(
          () => setPhase("settled"),
          REVEAL_DURATION_MS,
        );
      };
      const requestWhenIdle = () => {
        idleRequestId = window.requestIdleCallback(reveal, {
          timeout: 1_200,
        });
      };
      const delay = hasActivated.current
        ? 0
        : Math.max(0, initialDelayMs);
      delayTimeoutId = window.setTimeout(requestWhenIdle, delay);
    };

    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      clearScheduled();
    };
  }, [active, initialDelayMs, reducedMotion, targetRef]);
}

export function useWorkspaceFrameReveal(
  active: boolean,
  initialDelayMs = 0,
): WorkspaceFramePhase {
  const { reducedMotion } = useReducedMotionPreference();
  const [documentVisible, setDocumentVisible] = useState(
    () => !document.hidden,
  );
  const [phase, setPhase] = useState<WorkspaceFramePhase>(() =>
    active && !reducedMotion ? "pending" : "settled",
  );
  const hasActivated = useRef(false);

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useLayoutEffect(() => {
    if (!active || !documentVisible) {
      setPhase("idle");
      return;
    }
    if (reducedMotion) {
      setPhase("settled");
      return;
    }

    setPhase("pending");
    let idleRequestId: number | null = null;
    let settleTimeoutId: number | null = null;
    const reveal = () => {
      hasActivated.current = true;
      setPhase("revealing");
      settleTimeoutId = window.setTimeout(
        () => setPhase("settled"),
        REVEAL_DURATION_MS,
      );
    };
    const requestWhenIdle = () => {
      idleRequestId = window.requestIdleCallback(reveal, {
        timeout: 1_200,
      });
    };
    const delay =
      hasActivated.current ? 0 : Math.max(0, initialDelayMs);
    const delayTimeoutId = window.setTimeout(requestWhenIdle, delay);

    return () => {
      window.clearTimeout(delayTimeoutId);
      if (idleRequestId !== null) {
        window.cancelIdleCallback(idleRequestId);
      }
      if (settleTimeoutId !== null) {
        window.clearTimeout(settleTimeoutId);
      }
    };
  }, [active, documentVisible, initialDelayMs, reducedMotion]);

  return phase;
}
