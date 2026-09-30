import { memo } from "react";
import { Crosshair } from "lucide-react";
import type { MissionTargetPreviewPlan } from "../types";
import { MissionTargetVanishIcon } from "./MissionTargetVanishIcon";

interface MissionTargetRowProps {
  target: MissionTargetPreviewPlan["targets"][number];
  selected: boolean;
  ueSelected: boolean;
  disabled: boolean;
  blueprintIndex: number | undefined;
  modelName: string;
  status: string;
  tone: string;
  onToggle: (targetId: string) => void;
}

/** Query/status updates should not reconcile every unchanged cell in a large result. */
export const MissionTargetRow = memo(function MissionTargetRow({
  target, selected, ueSelected, disabled, blueprintIndex, modelName, status, tone, onToggle,
}: MissionTargetRowProps) {
  const type = target.type === 1 ? "NPC" : target.type === 2 ? "物件"
    : target.type === 3 ? "触发" : target.type === 4 ? "蓝图"
    : target.type === null ? "未配置" : `类型 ${target.type}`;
  const modelLeaf = target.modelClassPath.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const modelAssetName = modelLeaf.split(".")[0] || modelLeaf;
  const locationValues = [
    target.transform.location.x,
    target.transform.location.y,
    target.transform.location.z,
  ].map((value) => value.toFixed(0));
  const rotationValues = [
    target.transform.rotation.pitch,
    target.transform.rotation.yaw,
    target.transform.rotation.roll,
  ].map((value) => value.toFixed(0));
  return (
    <tr className={ueSelected ? "mission-target-row--ue-selected" : undefined}>
      <td className="mission-target-select">
        <input type="checkbox" checked={selected} disabled={disabled}
          onChange={() => onToggle(target.targetId)} aria-label={`选择目标物 ${target.targetId}`} />
      </td>
      <td title={target.description || "未填写描述"}>
        <span className="mission-target-id">
          <strong>{target.targetId}</strong>
          {ueSelected && <span><Crosshair size={10} />UE 已选</span>}
        </span>
        <small>{target.description || "未填写描述"}</small>
      </td>
      <td>
        <span className="mission-target-type">
          <span>{type}</span>
          <MissionTargetVanishIcon value={target.vanish} />
        </span>
      </td>
      <td
        title={target.npcId && target.npcId > 0
          ? `${target.npcName || "未知 NPC"} · ${target.npcId}`
          : "N/A"}
      >
        {target.npcId && target.npcId > 0 ? `${target.npcName || "未知 NPC"} · ${target.npcId}` : "N/A"}
      </td>
      <td title={target.modelClassPath}>{target.modelId ? `${target.modelId} · ${modelAssetName}` : "N/A"}</td>
      <td>
        <div className="mission-target-dialogues">
          {(target.ambientDialogues?.length ?? 0) > 0
            ? target.ambientDialogues?.map(dialogue => (
              <span key={`${dialogue.kind}:${dialogue.dialogueFileId}`}
                className={`mission-target-dialogue mission-target-dialogue--${dialogue.kind}`}
                title={`${dialogue.kind === "bubble" ? "冒泡对话" : "复杂闲话"} ${dialogue.dialogueFileId} · 来源：${dialogue.sources.join("、")}`}>
                <b>{dialogue.kind === "bubble" ? "冒泡" : "闲话"}</b>
                <code>{dialogue.dialogueFileId}</code>
              </span>
            ))
            : <span className="mission-target-dialogues__empty">无</span>}
        </div>
      </td>
      <td title={`X=${locationValues[0]}, Y=${locationValues[1]}, Z=${locationValues[2]}`}>
        <code className="mission-target-transform">
          {locationValues.join(", ")}
        </code>
      </td>
      <td title={`Pitch=${rotationValues[0]}°, Yaw=${rotationValues[1]}°, Roll=${rotationValues[2]}°`}>
        <code className="mission-target-transform">
          {rotationValues.map((value) => `${value}°`).join(", ")}
        </code>
      </td>
      <td><span className={`preview-kind preview-kind--${target.previewKind}`}>
        {target.previewKind === "asset" ? "实际资产" : "定位标记"}
      </span></td>
      <td>
        <span className={`dialogue-model-status dialogue-model-status--${tone}`}>{status}</span>
        <code title={modelName}>{selected && blueprintIndex && blueprintIndex > 0
          ? `BP ${blueprintIndex} · ${modelName}` : modelName}</code>
      </td>
    </tr>
  );
});
