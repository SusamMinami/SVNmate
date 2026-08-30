import { MoveRight } from "lucide-react";
import type {
  MissionTargetPreviewPlan,
  MissionTargetPreviewTarget,
} from "../types";

interface MissionTargetDialoguePreviewProps {
  plan: MissionTargetPreviewPlan;
}

interface PreviewPoint {
  x: number;
  y: number;
}

const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 300;
const VIEW_PADDING = 34;
const SLOT_COLORS = [
  "#e85d47",
  "#268bd2",
  "#2f9d68",
  "#d69024",
  "#8a63c7",
  "#16a0a5",
  "#cc4f87",
  "#64748b",
] as const;

function topViewPoint(
  target: MissionTargetPreviewTarget,
  initial: boolean,
): PreviewPoint {
  const transform =
    initial && target.dialogueAdjustment
      ? target.dialogueAdjustment.initialTransform
      : target.transform;
  return {
    x: transform.location.y,
    y: -transform.location.x,
  };
}

function formatDistance(value: number): string {
  return value >= 100
    ? `${(value / 100).toFixed(2)} m`
    : `${value.toFixed(0)} cm`;
}

export function MissionTargetDialoguePreview({
  plan,
}: MissionTargetDialoguePreviewProps) {
  const timeline = plan.dialogueTimeline;
  const targets = plan.targets.filter(
    (target) => target.blueprintModelId !== null,
  );
  if (!timeline || targets.length === 0) {
    return null;
  }

  const worldPoints = targets.flatMap((target) => [
    topViewPoint(target, true),
    topViewPoint(target, false),
  ]);
  const minX = Math.min(...worldPoints.map((point) => point.x));
  const maxX = Math.max(...worldPoints.map((point) => point.x));
  const minY = Math.min(...worldPoints.map((point) => point.y));
  const maxY = Math.max(...worldPoints.map((point) => point.y));
  const spanX = Math.max(100, maxX - minX);
  const spanY = Math.max(100, maxY - minY);
  const scale = Math.min(
    (VIEW_WIDTH - VIEW_PADDING * 2) / spanX,
    (VIEW_HEIGHT - VIEW_PADDING * 2) / spanY,
  );
  const offsetX =
    VIEW_PADDING + (VIEW_WIDTH - VIEW_PADDING * 2 - spanX * scale) / 2;
  const offsetY =
    VIEW_PADDING + (VIEW_HEIGHT - VIEW_PADDING * 2 - spanY * scale) / 2;
  const project = (point: PreviewPoint): PreviewPoint => ({
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (point.y - minY) * scale,
  });

  return (
    <section
      className="mission-target-dialogue-preview"
      aria-label="对话最终站位俯视图"
    >
      <header>
        <span>
          <strong>对话最终站位</strong>
          <small>
            节点 {timeline.finalDialogueId} · {timeline.nodeCount} 个节点
          </small>
        </span>
        <span>
          {timeline.adjustedCharacterCount} 位变化 ·{" "}
          {timeline.movementActionCount} 次走位 ·{" "}
          {timeline.rotationActionCount} 次旋转
        </span>
      </header>

      <div className="mission-target-dialogue-preview__map">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`对话 ${plan.taskId} 最终站位俯视图`}
        >
          <defs>
            <pattern
              id="dialogue-position-grid"
              width="28"
              height="28"
              patternUnits="userSpaceOnUse"
            >
              <path d="M 28 0 L 0 0 0 28" fill="none" />
            </pattern>
            <marker
              id="dialogue-position-arrow"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M0,0 L7,3.5 L0,7 Z" />
            </marker>
          </defs>
          <rect
            className="mission-target-dialogue-preview__grid"
            width={VIEW_WIDTH}
            height={VIEW_HEIGHT}
          />
          {targets.map((target, index) => {
            const initial = project(topViewPoint(target, true));
            const final = project(topViewPoint(target, false));
            const adjustment = target.dialogueAdjustment;
            const moved = (adjustment?.positionDelta ?? 0) > 0.01;
            const color = SLOT_COLORS[index % SLOT_COLORS.length];
            const yawRadians =
              (target.transform.rotation.yaw * Math.PI) / 180;
            return (
              <g
                key={target.targetId}
                data-target-id={target.targetId}
                data-position-delta={adjustment?.positionDelta ?? 0}
              >
                {moved && (
                  <>
                    <circle
                      className="mission-target-dialogue-preview__origin"
                      cx={initial.x}
                      cy={initial.y}
                      r="7"
                      style={{ stroke: color }}
                    />
                    <line
                      className="mission-target-dialogue-preview__path"
                      x1={initial.x}
                      y1={initial.y}
                      x2={final.x}
                      y2={final.y}
                      style={{ stroke: color }}
                      markerEnd="url(#dialogue-position-arrow)"
                    />
                  </>
                )}
                <circle
                  className="mission-target-dialogue-preview__destination"
                  cx={final.x}
                  cy={final.y}
                  r="13"
                  style={{ fill: color }}
                />
                <line
                  className="mission-target-dialogue-preview__facing"
                  x1={final.x + Math.sin(yawRadians) * 10}
                  y1={final.y - Math.cos(yawRadians) * 10}
                  x2={final.x + Math.sin(yawRadians) * 28}
                  y2={final.y - Math.cos(yawRadians) * 28}
                />
                <text
                  className="mission-target-dialogue-preview__slot"
                  x={final.x}
                  y={final.y}
                  dominantBaseline="central"
                  textAnchor="middle"
                >
                  {target.blueprintModelId}
                </text>
              </g>
            );
          })}
        </svg>
        <span className="mission-target-dialogue-preview__axis">TOP · UE X/Y</span>
      </div>

      <div
        className="mission-target-dialogue-preview__list"
        role="list"
      >
        {targets.map((target, index) => {
          const adjustment = target.dialogueAdjustment;
          const positionChanged =
            (adjustment?.positionDelta ?? 0) > 0.01;
          const rotationChanged =
            (adjustment?.rotationDelta ?? 0) > 0.01;
          const changed = positionChanged || rotationChanged;
          const actionSummary =
            `${adjustment?.movementActionCount ?? 0} 次走位 · ` +
            `${adjustment?.rotationActionCount ?? 0} 次旋转`;
          return (
            <div
              key={target.targetId}
              role="listitem"
              data-changed={changed}
            >
              <i
                style={{
                  backgroundColor: SLOT_COLORS[index % SLOT_COLORS.length],
                }}
              >
                {target.blueprintModelId}
              </i>
              <span title={target.modelClassPath}>
                <strong>{target.npcName}</strong>
                <small>
                  X {target.transform.location.x.toFixed(0)} · Y{" "}
                  {target.transform.location.y.toFixed(0)} · Yaw{" "}
                  {target.transform.rotation.yaw.toFixed(0)}°
                </small>
              </span>
              <span>
                {changed ? (
                  <>
                    <MoveRight size={13} />
                    <strong>
                      {positionChanged
                        ? `位移 ${formatDistance(adjustment?.positionDelta ?? 0)}`
                        : `朝向变化 ${(adjustment?.rotationDelta ?? 0).toFixed(0)}°`}
                    </strong>
                    <small>{actionSummary}</small>
                  </>
                ) : (
                  <small>
                    {(adjustment?.movementActionCount ?? 0) > 0 ||
                    (adjustment?.rotationActionCount ?? 0) > 0
                      ? `最终回到 BP 原位 · ${actionSummary}`
                      : "保持 BP 原位"}
                  </small>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
