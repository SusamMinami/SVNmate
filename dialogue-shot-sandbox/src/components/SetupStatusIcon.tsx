import { Check, Circle, CircleAlert, CircleX, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useReducedMotionPreference } from "../app/useReducedMotionPreference";
import "./setupStatusIcon.css";

const INTRO_STORAGE_KEY = "shot-sandbox.settings-status-intro.v1";
const INTRO_DURATION_MS = 1250;
let introSeenInWindow = false;

export function useSetupStatusIntro() {
  const { reducedMotion } = useReducedMotionPreference();
  const [intro, setIntro] = useState(() => {
    if (introSeenInWindow) return false;
    try {
      return localStorage.getItem(INTRO_STORAGE_KEY) !== "seen" &&
        !reducedMotion;
    } catch {
      return !reducedMotion;
    }
  });
  const finishIntro = useCallback(() => {
    setIntro(false);
    if (introSeenInWindow) return;
    introSeenInWindow = true;
    try {
      localStorage.setItem(INTRO_STORAGE_KEY, "seen");
    } catch {
      // A blocked store still remembers completion for this window.
    }
  }, []);

  useEffect(() => {
    if (!intro) {
      finishIntro();
      return;
    }
    if (reducedMotion) {
      finishIntro();
      return;
    }
    const timer = window.setTimeout(finishIntro, INTRO_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [intro, finishIntro, reducedMotion]);

  return { intro, finishIntro };
}

type SetupStatus = "ready" | "warning" | "loading" | "error";

const STATUS_LABELS: Record<SetupStatus, string> = {
  ready: "已就绪",
  warning: "待配置",
  loading: "处理中",
  error: "异常",
};

export function SetupStatusIcon({
  name,
  ready,
  loading = false,
  error = false,
  index,
  detail,
}: {
  name: string;
  ready: boolean;
  loading?: boolean;
  error?: boolean;
  index: number;
  detail?: string;
}) {
  const state: SetupStatus = loading ? "loading" : error ? "error" : ready ? "ready" : "warning";
  const Icon = state === "loading" ? LoaderCircle
    : state === "error" ? CircleX : state === "ready" ? Check : CircleAlert;
  const label = detail || STATUS_LABELS[state];
  return (
    <span
      className="setup-status-icon"
      role="img"
      tabIndex={0}
      aria-label={`${name}：${label}`}
      title={`${name}：${label}`}
      data-label={label}
      data-state={state}
      style={{ "--setup-status-delay": `${240 + index * 65}ms` } as CSSProperties}
    >
      <Circle className="setup-status-icon__pending" size={17} aria-hidden="true" />
      <span className="setup-status-icon__result" aria-hidden="true">
        <Icon className={loading ? "spin" : undefined} size={17} />
      </span>
    </span>
  );
}
