import { Bot, SlidersHorizontal, SquareTerminal } from "lucide-react";
import type { DirectorMode } from "../director/contracts";

interface DirectorControlProps {
  mode: DirectorMode;
  appliedMode: DirectorMode;
  loading: boolean;
  onModeChange: (mode: DirectorMode) => void;
}

function modeLabel(mode: DirectorMode): string {
  if (mode === "trae") {
    return "内部 TRAE";
  }
  return mode === "mira" ? "Mira AI" : "规则导演";
}

export function DirectorControl({
  mode,
  appliedMode,
  loading,
  onModeChange,
}: DirectorControlProps) {
  return (
    <div className="director-control">
      <div className="section-label">
        <span>导演模式</span>
        <small>实际：{modeLabel(appliedMode)}</small>
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
    </div>
  );
}
