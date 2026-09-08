import {
  Bot,
  CircleAlert,
  Cpu,
  LoaderCircle,
  SlidersHorizontal,
  SquareTerminal,
} from "lucide-react";
import type { DirectorMode } from "../director/contracts";
import type {
  RuleAdvisorRunSummary,
} from "../director/orchestrator";
import type { RuleAdvisorProgress } from "../director/ruleAdvisorContracts";

interface DirectorControlProps {
  mode: DirectorMode;
  appliedMode: DirectorMode;
  designState: "idle" | "existing" | "designed";
  loading: boolean;
  advisorProgress: RuleAdvisorProgress | null;
  advisorSummary: RuleAdvisorRunSummary | null;
  onModeChange: (mode: DirectorMode) => void;
}

function modeLabel(mode: DirectorMode): string {
  if (mode === "trae") {
    return "内部 TRAE";
  }
  if (mode === "mira") {
    return "Mira AI";
  }
  return "规则导演";
}

export function DirectorControl({
  mode,
  appliedMode,
  designState,
  loading,
  advisorProgress,
  advisorSummary,
  onModeChange,
}: DirectorControlProps) {
  const advisorBusy =
    advisorProgress !== null &&
    advisorProgress.stage !== "complete" &&
    advisorProgress.stage !== "unavailable";
  const advisorState =
    advisorProgress?.stage === "unavailable" ||
    advisorSummary?.state === "unavailable"
      ? "unavailable"
      : advisorSummary?.state ?? (advisorBusy ? "working" : null);
  const advisorMessage =
    advisorBusy && advisorProgress
      ? advisorProgress.total > 0
        ? `${advisorProgress.message} · ${advisorProgress.completed}/${advisorProgress.total}`
        : advisorProgress.message
      : advisorSummary?.message ?? advisorProgress?.message;

  return (
    <div className="director-control">
      <div className="section-label">
        <span>导演模式</span>
        <small>
          实际：
          {designState === "idle"
            ? "未设计"
            : designState === "existing"
              ? "UE 已有镜头"
              : modeLabel(appliedMode)}
        </small>
      </div>
      <div className="mode-segment" role="group" aria-label="导演模式">
        <button
          type="button"
          className={mode === "rule" ? "is-active" : ""}
          aria-pressed={mode === "rule"}
          onClick={() => onModeChange("rule")}
          disabled={loading && mode === "rule"}
        >
          <SlidersHorizontal size={15} />
          规则导演
        </button>
        <button
          type="button"
          className={mode === "trae" ? "is-active" : ""}
          aria-pressed={mode === "trae"}
          title={
            mode === "trae" && !loading
              ? "再次提交并重新生成 TRAE 方案"
              : undefined
          }
          onClick={() => onModeChange("trae")}
          disabled={loading}
        >
          <SquareTerminal size={15} />
          TRAE 协作
        </button>
        <button
          type="button"
          className={mode === "mira" ? "is-active" : ""}
          aria-pressed={mode === "mira"}
          onClick={() => onModeChange("mira")}
          disabled={loading}
        >
          <Bot size={15} />
          Mira AI
        </button>
      </div>
      {(advisorMessage || (mode === "rule" && appliedMode === "rule")) && (
        <div
          className="rule-advisor-state"
          data-state={advisorState ?? "idle"}
          role="status"
          aria-live="polite"
        >
          {advisorBusy ? (
            <LoaderCircle className="spin" size={14} />
          ) : advisorState === "unavailable" ? (
            <CircleAlert size={14} />
          ) : (
            <Cpu size={14} />
          )}
          <span>
            <strong>{advisorSummary?.model ?? "端侧 VLM"}</strong>
            <small>{advisorMessage ?? "将在生成时逐镜检查合法机位"}</small>
          </span>
        </div>
      )}
    </div>
  );
}
