import { Boxes, Check, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { BlueprintFormationSnapshot, DialogueSequence, ShotPlan } from "../types";
import { StageView } from "./StageView";

export type FormationOptionId = "blueprint" | "generated" | "ai";

export interface FormationOption {
  sequence: DialogueSequence;
  shots: ShotPlan[];
}

interface BlueprintFormationModalProps {
  blueprint: FormationOption;
  generated: FormationOption;
  ai?: FormationOption;
  aiLabel?: string;
  snapshot: BlueprintFormationSnapshot;
  mappedSlotCount: number;
  initialChoice: FormationOptionId;
  mode: "initial" | "switch";
  onChoose: (choice: FormationOptionId) => void;
  onClose: () => void;
}

function averageDistance(sequence: DialogueSequence): number {
  if (sequence.participants.length < 2) {
    return 0;
  }
  let total = 0;
  let pairs = 0;
  sequence.participants.forEach((left, leftIndex) => {
    sequence.participants.slice(leftIndex + 1).forEach((right) => {
      total += Math.hypot(
        left.position[0] - right.position[0],
        left.position[2] - right.position[2],
      );
      pairs += 1;
    });
  });
  return pairs === 0 ? 0 : total / pairs;
}

export function BlueprintFormationModal({
  blueprint,
  generated,
  ai,
  aiLabel,
  snapshot,
  mappedSlotCount,
  initialChoice,
  mode,
  onChoose,
  onClose,
}: BlueprintFormationModalProps) {
  const [selected, setSelected] =
    useState<FormationOptionId>(initialChoice);
  const option =
    selected === "blueprint"
      ? blueprint
      : selected === "ai" && ai
        ? ai
        : generated;
  const shot = option.shots[0];
  const spacing = useMemo(
    () => averageDistance(option.sequence),
    [option.sequence],
  );

  return (
    <div className="modal-backdrop formation-compare-backdrop" role="presentation">
      <section
        className="formation-compare-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="formation-compare-title"
      >
        <header>
          <div>
            <small>
              {mode === "initial"
                ? "检测到 UE Blueprint 初始占位"
                : "当前对话已有多个占位方案"}
            </small>
            <h2 id="formation-compare-title">
              {mode === "initial" ? "选择镜头分析使用的占位" : "切换占位方案"}
            </h2>
          </div>
          <div className="formation-compare-header-actions">
            <code>{blueprint.sequence.startId}</code>
            {mode === "switch" && (
              <button
                className="icon-button"
                type="button"
                title="关闭"
                aria-label="关闭占位方案切换"
                onClick={onClose}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </header>

        <div className="formation-compare-toolbar">
          <div className="mode-segment" role="group" aria-label="占位方案">
            <button
              type="button"
              className={selected === "blueprint" ? "is-active" : ""}
              aria-pressed={selected === "blueprint"}
              onClick={() => setSelected("blueprint")}
            >
              <Boxes size={15} />
              {snapshot.blueprintAssetPath
                .split("/")
                .at(-1)
                ?.split(".")[0] ?? "BP 占位"}
            </button>
            <button
              type="button"
              className={selected === "generated" ? "is-active" : ""}
              aria-pressed={selected === "generated"}
              onClick={() => setSelected("generated")}
            >
              <Sparkles size={15} />
              规则占位
            </button>
            {ai && (
              <button
                type="button"
                className={selected === "ai" ? "is-active" : ""}
                aria-pressed={selected === "ai"}
                onClick={() => setSelected("ai")}
              >
                <Sparkles size={15} />
                {aiLabel ?? "AI 占位"}
              </button>
            )}
          </div>
          <dl className="formation-compare-metrics">
            <div>
              <dt>参与角色</dt>
              <dd>{option.sequence.participants.length}</dd>
            </div>
            <div>
              <dt>BP 角色槽</dt>
              <dd>{mappedSlotCount}</dd>
            </div>
            <div>
              <dt>平均间距</dt>
              <dd>{spacing.toFixed(1)} m</dd>
            </div>
          </dl>
        </div>

        <div className="formation-compare-stage">
          <StageView participants={option.sequence.participants} shot={shot} />
        </div>

        <div className="formation-compare-summary">
          <strong>
            {selected === "blueprint"
              ? "保留 UE 初始位置与朝向，镜头按需规划 45° / 90° / 180° 转身"
              : selected === "ai"
                ? "采用 AI 返回的角色占位、朝向关系与分镜"
                : "使用规则导演自动安排的角色占位"}
          </strong>
          <span title={snapshot.blueprintAssetPath}>
            {selected === "blueprint"
              ? snapshot.blueprintAssetPath
              : selected === "ai"
                ? aiLabel ?? "AI 占位"
                : "规则导演占位"}
          </span>
        </div>

        <footer>
          <span>
            {mode === "initial"
              ? "确认后将按该占位生成关系轴与全部镜头。"
              : "切换后将载入该占位对应的完整分镜，无需重新分析。"}
          </span>
          <button
            className="button button--primary"
            type="button"
            onClick={() => onChoose(selected)}
          >
            <Check size={16} />
            使用此占位
          </button>
        </footer>
      </section>
    </div>
  );
}
