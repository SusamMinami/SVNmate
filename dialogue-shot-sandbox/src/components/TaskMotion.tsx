import { FileSearch } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { isReducedMotionEnabled, useReducedMotionPreference } from "../app/useReducedMotionPreference";
import type { TaskPhase } from "../taskFeedback";
import "./taskMotion.css";

const MotionContext = createContext(true);
const TaskScopeActiveContext = createContext(true);
const TaskNoticeHostContext = createContext<HTMLElement | null>(null);
const settleTiming = { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };

export function TaskNoticeHostProvider({ host, children }: {
  host: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <TaskNoticeHostContext.Provider value={host}>
      {children}
    </TaskNoticeHostContext.Provider>
  );
}

/** Animate the action's own icon; no extra spinner or animation-driven completion. */
export function OperationIcon({ kind, busy, children }: {
  kind: "search" | "document-search" | "read" | "write"; busy: boolean; children: ReactNode;
}) {
  const active = useContext(MotionContext);
  const { reducedMotion } = useReducedMotionPreference();
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!busy || !active || reducedMotion) { setVisible(false); return; }
    let intersecting = false;
    const update = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      update();
    });
    if (ref.current) observer.observe(ref.current);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [busy, active, reducedMotion]);
  return <span ref={ref} className="operation-icon" data-kind={kind}
    data-busy={busy} data-running={busy && active && visible && !reducedMotion} aria-hidden="true">
    {children}
  </span>;
}

export function DocumentSearchIcon({ size = 18 }: { size?: number }) {
  return (
    <FileSearch
      className="operation-icon__document-search"
      size={size}
      aria-hidden="true"
    />
  );
}

/** One document listener per workspace. Hidden workspaces retain data, not animation. */
export function TaskMotionScope({ active, children }: { active: boolean; children: ReactNode }) {
  const [visible, setVisible] = useState(() => !document.hidden);
  const { reducedMotion } = useReducedMotionPreference();
  useEffect(() => {
    const visibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <TaskScopeActiveContext.Provider value={active}>
      <MotionContext.Provider value={active && visible && !reducedMotion}>
        {children}
      </MotionContext.Provider>
    </TaskScopeActiveContext.Provider>
  );
}

function canSettle(element: HTMLElement) {
  return !document.hidden && !isReducedMotionEnabled()
    && !element.closest('[data-navigation-input="keyboard"]');
}

function settle(element: HTMLElement) {
  // No fill mode or animationend business callback: the real result is already visible.
  return element.animate([
    { opacity: 0.55, transform: "scale(1.12)" },
    { opacity: 1, transform: "scale(1)" },
  ], settleTiming);
}

/** Fixed-size, aria-hidden decoration. The caller owns the accessible state text. */
export function TaskGlyph({ phase, runId, variant = "frame", active = true }: {
  phase: TaskPhase;
  runId: string | number;
  variant?: "frame" | "signal" | "nodes";
  active?: boolean;
}) {
  const enabled = useContext(MotionContext) && active;
  const ref = useRef<HTMLSpanElement>(null);
  const [intersecting, setIntersecting] = useState(false);
  const previous = useRef({ phase, runId, enabled });
  const animation = useRef<Animation | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { phase, runId, enabled };
    animation.current?.cancel();
    if (ref.current && enabled && before.enabled && intersecting && canSettle(ref.current)
      && before.runId === runId && before.phase === "running"
      && (phase === "success" || phase === "ready")) {
      animation.current = settle(ref.current);
    }
    return () => animation.current?.cancel();
  }, [phase, runId, enabled, intersecting]);
  const symbol = phase === "success" ? "M7 12l3 3 7-7"
    : phase === "failed" ? "M8 8l8 8m0-8-8 8"
    : phase === "cancelled" ? "M8 12h8"
    : phase === "warning" || phase === "uncertain" ? "M12 7v6m0 3v.2"
    : phase === "ready" ? "M8 8h8v8H8z"
    : variant === "nodes" ? "M8 9l8 6M8 15l8-6M5 6h3v3H5zm11 0h3v3h-3zM5 15h3v3H5zm11 0h3v3h-3z"
    : variant === "signal" ? "M8 10v4m4-7v10m4-7v4"
    : "M9 12h6m-3-3v6";
  return <span ref={ref} className="task-glyph" data-phase={phase} data-variant={variant}
    data-running={phase === "running" && enabled && intersecting} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path className="task-glyph__corners" d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />
      <path className="task-glyph__symbol" d={symbol} />
      {phase === "running" && variant !== "nodes" && <path className="task-glyph__sweep" d="M6 7h12" />}
    </svg>
  </span>;
}

/** Stable feedback location: only this glyph animates during a workspace operation. */
export function TaskNotice({ phase, runId, children, className = "npc-migration-message", animate = true }: {
  phase: TaskPhase; runId: string | number; children: ReactNode; className?: string; animate?: boolean;
}) {
  const host = useContext(TaskNoticeHostContext);
  const scopeActive = useContext(TaskScopeActiveContext);
  const notice = (
    <div
      className={`${className} task-notice${host ? " app-header-task-notice" : ""}`}
      data-phase={phase}
      role={phase === "failed" || phase === "uncertain" ? "alert" : "status"}
      title={typeof children === "string" ? children : undefined}
    >
      <TaskGlyph phase={phase} runId={runId} active={animate} />
      <span>{children}</span>
    </div>
  );
  if (!host) {
    return notice;
  }
  return scopeActive ? createPortal(notice, host) : null;
}

/** Determinate only: done includes attempted items, including failed reads. */
export function TaskProgress({ done, total, phase, active = true }: {
  done: number; total: number; phase: TaskPhase; active?: boolean;
}) {
  const enabled = useContext(MotionContext) && active;
  const value = Math.max(0, Math.min(done, total));
  return <div className="task-progress" role="progressbar" aria-label="动画配置扫描进度"
    aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}
    aria-valuetext={`已处理 ${value} / ${total}，含失败项`}
    data-phase={phase} data-motion={enabled}>
    <span style={{ transform: `scaleX(${total > 0 ? value / total : 0})` }} />
  </div>;
}

/** Watch adoption events at the stable list owner, including ASR rows that move on adoption. */
export function useTaskReceipts(ref: RefObject<HTMLElement | null>, identity: string,
  adopted: Record<string, boolean>, active: boolean) {
  const enabled = useContext(MotionContext) && active;
  const previous = useRef({ identity, adopted, enabled });
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { identity, adopted, enabled };
    const root = ref.current;
    if (!root || !enabled || !before.enabled || before.identity !== identity || !canSettle(root)) return;
    const animations: Animation[] = [];
    for (const receipt of root.querySelectorAll<HTMLElement>("[data-task-receipt]")) {
      const key = receipt.dataset.taskReceipt!;
      if (!adopted[key] || before.adopted[key]) continue;
      const rect = receipt.getBoundingClientRect();
      const clip = root.closest(".animation-voice__scroll")?.getBoundingClientRect();
      if (clip && (rect.bottom <= clip.top || rect.top >= clip.bottom)) continue;
      animations.push(settle(receipt));
    }
    return () => animations.forEach((animation) => animation.cancel());
  }, [ref, identity, adopted, enabled]);
}
