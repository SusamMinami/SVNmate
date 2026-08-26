import { AudioLines, LoaderCircle, Upload } from "lucide-react";
import type { DirectorSoundEffectRecommendation } from "../director/contracts";
import type { DialogueRow } from "../types";

interface SoundEffectRecommendationsProps {
  recommendations: DirectorSoundEffectRecommendation[];
  dialogueRows: DialogueRow[];
  currentDialogueIds: string[];
  busy: boolean;
  onWrite: () => void;
}

function soundEffectRecommendationKey(
  recommendation: Pick<
    DirectorSoundEffectRecommendation,
    "dialogueId" | "category" | "assetName"
  >,
): string {
  return `${recommendation.dialogueId}:${recommendation.category}:${recommendation.assetName}`;
}

function categoryLabel(
  category: DirectorSoundEffectRecommendation["category"],
): string {
  return {
    environment: "环境",
    footstep: "脚步",
    action: "动作",
    special: "特殊",
  }[category];
}

export function SoundEffectRecommendations({
  recommendations,
  dialogueRows,
  currentDialogueIds,
  busy,
  onWrite,
}: SoundEffectRecommendationsProps) {
  const dialogueById = new Map(dialogueRows.map((row) => [row.id, row]));
  const currentIds = new Set(currentDialogueIds);
  const currentRecommendations = recommendations.filter((recommendation) =>
    currentIds.has(recommendation.dialogueId),
  );

  return (
    <section className="inspector-section sound-effect-analysis">
      <div className="section-label sound-effect-analysis__header">
        <span>已有音效建议</span>
        <small>{currentRecommendations.length} 项</small>
        {currentRecommendations.length > 0 && (
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={onWrite}
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Upload size={14} />
            )}
            {busy ? "正在预检..." : "写入本镜音效"}
          </button>
        )}
      </div>
      {currentRecommendations.length > 0 ? (
        <div className="sound-effect-list">
          {currentRecommendations.map((recommendation) => {
            const row = dialogueById.get(recommendation.dialogueId);
            return (
              <div key={soundEffectRecommendationKey(recommendation)}>
                <AudioLines size={15} />
                <div>
                  <strong>{recommendation.assetName}</strong>
                  <span>
                    {categoryLabel(recommendation.category)} · 节点{" "}
                    {recommendation.dialogueId}
                  </span>
                  {row && <blockquote>{row.content}</blockquote>}
                  <p>{recommendation.reason}</p>
                  <small>{recommendation.description}</small>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p>当前分镜内容没有与现有目录充分匹配的音效。</p>
      )}
    </section>
  );
}
