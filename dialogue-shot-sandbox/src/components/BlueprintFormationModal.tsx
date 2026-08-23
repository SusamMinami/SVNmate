import { Boxes, Check, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { BlueprintFormationSnapshot, DialogueSequence, ShotPlan } from "../types";
import { StageView } from "./StageView";

interface FormationOption {
  sequence: DialogueSequence;
  shots: ShotPlan[];
}

interface BlueprintFormationModalProps {
  blueprint: FormationOption;
  generated: FormationOption;
  snapshot: BlueprintFormationSnapshot;
  mappedSlotCount: number;
  onChoose: (choice: "blueprint" | "generated") => void;
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
  snapshot,
  mappedSlotCount,
  onChoose,
}: BlueprintFormationModalProps) {
  const [selected, setSelected] = useState<"blueprint" | "generated">(
    "blueprint",
  );
  const option = selected === "blueprint" ? blueprint : generated;
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
            <small>检测到 UE Blueprint 初始站位</small>
            <h2 id="formation-compare-title">选择镜头分析使用的站位</h2>
          </div>
          <code>{blueprint.sequence.startId}</code>
        </header>

        <div className="formation-compare-toolbar">
          <div className="mode-segment" role="group" aria-label="站位来源">
            <button
              type="button"
              className={selected === "blueprint" ? "is-active" : ""}
              aria-pressed={selected === "blueprint"}
              onClick={() => setSelected("blueprint")}
            >
              <Boxes size={15} />
              BP 站位
            </button>
            <button
              type="button"
              className={selected === "generated" ? "is-active" : ""}
              aria-pressed={selected === "generated"}
              onClick={() => setSelected("generated")}
            >
              <Sparkles size={15} />
              导演重新排位
            </button>
          </div>
          <dl className="formation-compare-metrics">
            <div>
              <dt>参与角色</dt>
              <dd>{option.sequence.participants.length}</dd>
            </div>
            <div>
              <dt>BP 已映射</dt>
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
              ? "保留 UE 中已有的位置和朝向"
              : "允许当前导演重新安排角色位置"}
          </strong>
          <span title={snapshot.blueprintAssetPath}>
            {snapshot.blueprintAssetPath}
          </span>
        </div>

        <footer>
          <span>确认后将按该站位重新计算关系轴与全部镜头。</span>
          <button
            className="button button--primary"
            type="button"
            onClick={() => onChoose(selected)}
          >
            <Check size={16} />
            使用此站位
          </button>
        </footer>
      </section>
    </div>
  );
}
