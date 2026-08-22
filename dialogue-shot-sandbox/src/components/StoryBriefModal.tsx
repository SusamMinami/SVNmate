import { ArrowRight, BookOpen, Move3d } from "lucide-react";
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
}

const FORMATION_LABELS: Record<DirectorBlocking["formation"], string> = {
  arc: "浅弧展开",
  triangle: "三角关系",
  cluster: "集中群组",
  opposed_groups: "对峙分组",
  leader_front: "主导者前置",
};

export function StoryBriefModal({
  sequence,
  analysis,
  blocking,
  source,
  onContinue,
}: StoryBriefModalProps) {
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
                    : "AI 导演分析完成"}
              </small>
              <h2 id="story-brief-title">故事梗概</h2>
            </div>
          </div>
          <code>{sequence.prefix}</code>
        </header>

        <div className="story-brief-modal__body">
          <section className="story-brief-modal__outline">
            <p>{sequence.outline || analysis.dramaticGoal}</p>
            <div className="story-brief-modal__cast" aria-label="本场角色">
              {sequence.participants.map((participant) => (
                <span key={participant.id}>
                  <i style={{ backgroundColor: participant.color }}>
                    {participant.slot}
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
              <span>站位策略</span>
              <strong>{FORMATION_LABELS[blocking.formation]}</strong>
            </div>
            <p>{blocking.intent}</p>
          </section>
        </div>

        <footer>
          <span>
            {sequence.rows.length} 条台词 · {sequence.participants.length} 位角色
          </span>
          <button
            className="button button--primary"
            type="button"
            onClick={onContinue}
          >
            进入分镜
            <ArrowRight size={16} />
          </button>
        </footer>
      </section>
    </div>
  );
}
