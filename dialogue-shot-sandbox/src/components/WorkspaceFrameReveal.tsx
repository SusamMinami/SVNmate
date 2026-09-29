import { useEffect, useRef, useState } from "react";
import { useReducedMotionPreference } from "../app/useReducedMotionPreference";
import "./workspaceFrameReveal.css";

const frameLines = [
  "top",
  "left-panel",
  "right-panel",
  "viewport-toolbar",
  "bottom",
] as const;

export function WorkspaceFrameReveal({
  active,
  initialDelayMs = 0,
}: {
  active: boolean;
  initialDelayMs?: number;
}) {
  const { reducedMotion } = useReducedMotionPreference();
  const [documentVisible, setDocumentVisible] = useState(
    () => !document.hidden,
  );
  const [playing, setPlaying] = useState(false);
  const hasActivated = useRef(false);

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    setPlaying(false);
    if (!active || reducedMotion || !documentVisible) {
      return;
    }
    let cancelled = false;
    let idleRequestId: number | null = null;
    const start = () => {
      if (!cancelled) {
        setPlaying(true);
      }
    };
    const requestWhenIdle = () => {
      hasActivated.current = true;
      idleRequestId = window.requestIdleCallback(start, { timeout: 1_200 });
    };
    const delay =
      hasActivated.current ? 0 : Math.max(0, initialDelayMs);
    const timeoutId = window.setTimeout(requestWhenIdle, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (idleRequestId !== null) {
        window.cancelIdleCallback(idleRequestId);
      }
    };
  }, [active, documentVisible, initialDelayMs, reducedMotion]);

  return (
    <div
      className="workspace-frame-reveal"
      data-active={playing}
      aria-hidden="true"
    >
      {frameLines.map((line) => (
        <i
          className="workspace-frame-reveal__line"
          data-line={line}
          key={line}
        />
      ))}
    </div>
  );
}
