import { Boxes, Check, MapPin, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { BlueprintFormationSnapshot, DialogueSequence, ShotPlan } from "../types";
import { StageView } from "./StageView";

export type FormationOptionId = "blueprint" | "generated" | "ai";
export type FormationSelectionId = FormationOptionId | "current";

export interface FormationOption {
  sequence: DialogueSequence;
  shots: ShotPlan[];
}

interface BlueprintFormationModalProps {
  blueprint?: FormationOption;
  generated?: FormationOption;
  current?: FormationOption;
  currentLabel?: string;
  currentDetail?: string;
  currentUsesBlueprint?: boolean;
  ai?: FormationOption;
  aiLabel?: string;
  aiSource?: "generated" | "local-cache" | "shared-library";
  snapshot?: BlueprintFormationSnapshot;
  mappedSlotCount?: number;
  initialChoice: FormationSelectionId;
  mode: "initial" | "switch" | "ai-review";
  onChoose: (choice: FormationSelectionId) => void;
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
  current,
  currentLabel,
  currentDetail,
  currentUsesBlueprint = false,
  ai,
  aiLabel,
  aiSource,
  snapshot,
  mappedSlotCount = 0,
  initialChoice,
  mode,
  onChoose,
  onClose,
}: BlueprintFormationModalProps) {
  const [selected, setSelected] =
    useState<FormationSelectionId>(initialChoice);
  const option =
    selected === "current"
      ? current
      : selected === "blueprint"
      ? blueprint
      : selected === "ai" && ai
        ? ai
        : generated;
  const shot = option?.shots[0];
  const spacing = useMemo(
    () => (option ? averageDistance(option.sequence) : 0),
    [option],
  );
  if (!option || !shot) {
    return null;
  }

  const isAiReview = mode === "ai-review";
  const sourceLabel =
    aiSource === "shared-library"
      ? "飞书共享方案"
      : aiSource === "local-cache"
        ? "本地缓存方案"
        : "AI 导演新方案";

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
              {isAiReview
                ? `${sourceLabel} · 先确认角色占位`
                : mode === "initial"
                ? "检测到 UE Blueprint 初始占位"
                : "当前对话已有多个占位方案"}
            </small>
            <h2 id="formation-compare-title">
              {isAiReview
                ? "对比 AI 与当前占位"
                : mode === "initial"
                  ? "选择镜头分析使用的占位"
                  : "切换占位方案"}
            </h2>
          </div>
          <div className="formation-compare-header-actions">
            <code>{option.sequence.startId}</code>
            {!isAiReview && (
              <button
                className="icon-button"
                type="button"
                title="关闭"
                aria-label={
                  mode === "initial" ? "关闭占位选择" : "关闭占位方案切换"
                }
                onClick={onClose}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </header>

        <div className="formation-compare-toolbar">
          <div className="mode-segment" role="group" aria-label="占位方案">
            {isAiReview ? (
              <>
                <button
                  type="button"
                  className={selected === "current" ? "is-active" : ""}
                  aria-pressed={selected === "current"}
                  onClick={() => setSelected("current")}
                >
                  {currentUsesBlueprint ? (
                    <Boxes size={15} />
                  ) : (
                    <MapPin size={15} />
                  )}
                  {currentLabel ?? "当前占位"}
                </button>
                <button
                  type="button"
                  className={selected === "ai" ? "is-active" : ""}
                  aria-pressed={selected === "ai"}
                  onClick={() => setSelected("ai")}
                >
                  <Sparkles size={15} />
                  {aiLabel ?? "AI 占位"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={selected === "blueprint" ? "is-active" : ""}
                  aria-pressed={selected === "blueprint"}
                  onClick={() => setSelected("blueprint")}
                >
                  <Boxes size={15} />
                  {snapshot?.blueprintAssetPath
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
              </>
            )}
          </div>
          <dl className="formation-compare-metrics">
            <div>
              <dt>参与角色</dt>
              <dd>{option.sequence.participants.length}</dd>
            </div>
            <div>
              <dt>{isAiReview ? "当前预览" : "BP 角色槽"}</dt>
              <dd>
                {isAiReview
                  ? selected === "ai"
                    ? "AI"
                    : "当前"
                  : mappedSlotCount}
              </dd>
            </div>
            <div>
              <dt>平均间距</dt>
              <dd>{spacing.toFixed(1)} m</dd>
            </div>
          </dl>
        </div>

        <div className="formation-compare-stage">
          <StageView
            participants={option.sequence.participants}
            shot={shot}
            applyShotFacingOverrides={
              selected !== "blueprint" &&
              !(selected === "current" && currentUsesBlueprint)
            }
          />
        </div>

        <div className="formation-compare-summary">
          <strong>
            {selected === "current"
              ? currentUsesBlueprint
                ? "保留当前 BP 位置与朝向，由 AI 重新规划镜头"
                : "保留当前角色占位，由 AI 重新规划镜头"
              : selected === "blueprint"
              ? "保留 UE 初始位置与朝向，镜头按需规划 45° / 90° / 180° 转身"
              : selected === "ai"
                ? "采用 AI 返回的角色占位、朝向关系与分镜"
                : "使用规则导演自动安排的角色占位"}
          </strong>
          <span
            title={
              selected === "current"
                ? currentDetail
                : selected === "blueprint"
                  ? snapshot?.blueprintAssetPath
                  : undefined
            }
          >
            {selected === "current"
              ? currentDetail ?? currentLabel ?? "当前占位"
              : selected === "blueprint"
              ? snapshot?.blueprintAssetPath
              : selected === "ai"
                ? aiLabel ?? "AI 占位"
                : "规则导演占位"}
          </span>
        </div>

        <footer>
          <span>
            {isAiReview
              ? selected === "current"
                ? "先进入这版 AI 分镜，后台将按当前占位重新生成。"
                : "直接进入 AI 已生成的分镜方案。"
              : mode === "initial"
              ? "确认后将按该占位生成关系轴与全部镜头。"
              : "切换后将载入该占位对应的完整分镜，无需重新分析。"}
          </span>
          <button
            className="button button--primary"
            type="button"
            onClick={() => onChoose(selected)}
          >
            <Check size={16} />
            {isAiReview
              ? selected === "current"
                ? "按当前占位重新生成"
                : "采用 AI 占位"
              : "使用此占位"}
          </button>
        </footer>
      </section>
    </div>
  );
}
