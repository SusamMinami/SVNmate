import {
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  HardDrive,
  LoaderCircle,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DirectorRunResult } from "../director/orchestrator";
import type { DialogueSequence } from "../types";
import { StageView } from "./StageView";

interface PlanOption {
  sequence: DialogueSequence;
  result: DirectorRunResult;
}

interface SharedPlanCompareModalProps {
  local: PlanOption;
  shared: PlanOption;
  busy: boolean;
  error: string;
  onChoose: (choice: "local" | "shared") => void;
}

function metrics(option: PlanOption) {
  const shots = option.result.shots;
  const totalDuration = shots.reduce(
    (total, shot) => total + shot.duration,
    0,
  );
  return {
    shots: shots.length,
    linesPerShot: option.sequence.rows.length / shots.length,
    averageDuration: totalDuration / shots.length,
    singleLineShots: shots.filter((shot) => shot.dialogueIds.length === 1)
      .length,
  };
}

export function SharedPlanCompareModal({
  local,
  shared,
  busy,
  error,
  onChoose,
}: SharedPlanCompareModalProps) {
  const [selected, setSelected] = useState<"local" | "shared">("local");
  const [shotIndex, setShotIndex] = useState(0);
  const option = selected === "local" ? local : shared;
  const planMetrics = useMemo(() => metrics(option), [option]);
  const shot = option.result.shots[shotIndex] ?? option.result.shots[0];

  useEffect(() => {
    setShotIndex((current) =>
      Math.min(current, Math.max(0, option.result.shots.length - 1)),
    );
  }, [option.result.shots.length]);

  return (
    <div className="modal-backdrop shared-compare-backdrop" role="presentation">
      <section
        className="shared-compare-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shared-compare-title"
      >
        <header>
          <div>
            <small>共享库存在其他方案</small>
            <h2 id="shared-compare-title">预览并选择分镜方案</h2>
          </div>
          <code>{option.sequence.prefix}</code>
        </header>

        <div className="shared-compare-toolbar">
          <div className="mode-segment" role="group" aria-label="对比方案">
            <button
              type="button"
              className={selected === "shared" ? "is-active" : ""}
              aria-pressed={selected === "shared"}
              onClick={() => setSelected("shared")}
            >
              <Cloud size={15} />
              共享方案
            </button>
            <button
              type="button"
              className={selected === "local" ? "is-active" : ""}
              aria-pressed={selected === "local"}
              onClick={() => setSelected("local")}
            >
              <HardDrive size={15} />
              本地方案
            </button>
          </div>
          <dl className="shared-compare-metrics">
            <div>
              <dt>镜头</dt>
              <dd>{planMetrics.shots}</dd>
            </div>
            <div>
              <dt>句/镜</dt>
              <dd>{planMetrics.linesPerShot.toFixed(1)}</dd>
            </div>
            <div>
              <dt>平均时长</dt>
              <dd>{planMetrics.averageDuration.toFixed(1)}s</dd>
            </div>
            <div>
              <dt>单句镜头</dt>
              <dd>{planMetrics.singleLineShots}</dd>
            </div>
          </dl>
        </div>

        <div className="shared-compare-body">
          <div className="shared-compare-stage">
            <StageView participants={option.result.participants} shot={shot} />
          </div>
          <aside className="shared-compare-shots">
            <div className="shared-compare-shots__head">
              <strong>{shot.label}</strong>
              <span>
                {shotIndex + 1} / {option.result.shots.length}
              </span>
            </div>
            <p>{shot.content}</p>
            <small>{shot.rationale}</small>
            <div className="shot-nav">
              <button
                className="icon-button"
                type="button"
                title="上一个镜头"
                aria-label="对比上一个镜头"
                disabled={shotIndex === 0}
                onClick={() => setShotIndex((current) => current - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="icon-button"
                type="button"
                title="下一个镜头"
                aria-label="对比下一个镜头"
                disabled={shotIndex === option.result.shots.length - 1}
                onClick={() => setShotIndex((current) => current + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </aside>
        </div>

        {error && <p className="inline-error">{error}</p>}

        <footer>
          <span>
            {selected === "local"
              ? "选中后覆盖共享库中的原方案"
              : "选中后保留共享库中的现有方案"}
          </span>
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => onChoose(selected)}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : selected === "local" ? (
              <UploadCloud size={16} />
            ) : (
              <Check size={16} />
            )}
            {selected === "local" ? "采用并覆盖共享库" : "采用共享方案"}
          </button>
        </footer>
      </section>
    </div>
  );
}
