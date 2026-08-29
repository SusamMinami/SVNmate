import {
  ArrowRight,
  BookOpen,
  Move3d,
  Undo2,
} from "lucide-react";
import { participantSlotLabel } from "../data/dialogueRoles";
import type {
  DirectorBlocking,
  DirectorSceneAnalysis,
} from "../director/contracts";
import type { DialogueSequence } from "../types";

interface StoryBriefModalProps {
  sequence: DialogueSequence;
  analysis: DirectorSceneAnalysis;
  blocking: DirectorBlocking;
  source?: "generated" | "local-cache" | "shared-library";
  onContinue: () => void;
  onKeepCurrent: () => void;
}

const FORMATION_LABELS: Record<DirectorBlocking["formation"], string> = {
  arc: "浅弧展开",
  triangle: "三角关系",
  cluster: "集中群组",
  opposed_groups: "对峙分组",
  leader_front: "主导者前置",
};

type BlockingPosition = DirectorBlocking["placements"][number]["position"];

const POSITION_LABELS: Record<BlockingPosition, string> = {
  front_center: "前排中央",
  front_left: "前排左侧",
  front_right: "前排右侧",
  mid_center: "中排中央",
  mid_left: "中排左侧",
  mid_right: "中排右侧",
  back_center: "后排中央",
  back_left: "后排左侧",
  back_right: "后排右侧",
  far_left: "外围左侧",
  far_right: "外围右侧",
  rear_center: "纵深后方",
};

export function StoryBriefModal({
  sequence,
  analysis,
  blocking,
  source,
  onContinue,
  onKeepCurrent,
}: StoryBriefModalProps) {
  const participantNames = new Map(
    sequence.participants.map((participant) => [
      participant.slot,
      participant.name,
    ]),
  );

  return (
    <div className="modal-backdrop story-brief-backdrop" role="presentation">
      <section
        className="story-brief-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-brief-title"
      >
        <header>
          <div className="story-brief-modal__title">
            <span>
              <BookOpen size={17} />
            </span>
            <div>
              <small>
                {source === "shared-library"
                  ? "已命中飞书共享方案"
                  : source === "local-cache"
                    ? "已命中本地缓存"
                    : "AI 导演分析完成 · 包含占位建议"}
              </small>
              <h2 id="story-brief-title">分镜与占位方案</h2>
            </div>
          </div>
          <code>{sequence.prefix}</code>
        </header>

        <div className="story-brief-modal__body">
          <section className="story-brief-modal__outline">
            <p>{sequence.outline || analysis.dramaticGoal}</p>
            <div className="story-brief-modal__cast" aria-label="本场角色">
              {sequence.participants.map((participant) => (
                <span key={participant.instanceId}>
                  <i style={{ backgroundColor: participant.color }}>
                    {participantSlotLabel(participant)}
                  </i>
                  <b>{participant.name}</b>
                  <small>
                    登场 {participant.entryDialogueId} · 离场{" "}
                    {participant.exitDialogueId ?? "本场结束"}
                  </small>
                </span>
              ))}
            </div>
          </section>

          <dl className="story-brief-modal__analysis">
            <div>
              <dt>戏剧目标</dt>
              <dd>{analysis.dramaticGoal}</dd>
            </div>
            <div>
              <dt>情绪推进</dt>
              <dd>{analysis.emotionalProgression}</dd>
            </div>
            <div>
              <dt>视觉策略</dt>
              <dd>{analysis.visualStrategy}</dd>
            </div>
          </dl>

          <section className="story-brief-modal__blocking">
            <div>
              <Move3d size={16} />
              <span>AI 占位建议</span>
              <strong>{FORMATION_LABELS[blocking.formation]}</strong>
            </div>
            <p>{blocking.intent}</p>
            <div className="story-brief-modal__placements">
              {blocking.placements.map((placement) => (
                <span key={placement.subject}>
                  <b>
                    {participantNames.get(placement.subject) ??
                      placement.subject}
                  </b>
                  <small>
                    {POSITION_LABELS[placement.position]} · 面向{" "}
                    {placement.facing === "group_center"
                      ? "群体中心"
                      : participantNames.get(placement.facing) ??
                        placement.facing}
                  </small>
                </span>
              ))}
            </div>
          </section>
        </div>

        <footer>
          <span>
            {sequence.rows.length} 条台词
            {sequence.ignoredDialogueNodeCount > 0
              ? ` · 已忽略 ${sequence.ignoredDialogueNodeCount} 个关闭 UI 节点`
              : ""}{" "}
            · {sequence.participants.length} 位角色
          </span>
          <div>
            <button className="button" type="button" onClick={onKeepCurrent}>
              <Undo2 size={15} />
              保留当前占位
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={onContinue}
            >
              采用 AI 占位
              <ArrowRight size={16} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
