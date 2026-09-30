import { CircleHelp, Eye, PersonStanding } from "lucide-react";

interface MissionTargetVanishIconProps {
  value?: string;
}

export function MissionTargetVanishIcon({
  value,
}: MissionTargetVanishIconProps) {
  const normalizedValue = value?.trim() ?? "";
  const label = normalizedValue || "未配置";
  const mode =
    normalizedValue === "瞬间消失"
      ? "instant"
      : normalizedValue === "超视距消失"
        ? "distance"
        : normalizedValue === "不消失"
          ? "persistent"
          : "unknown";
  const Icon =
    mode === "distance"
      ? Eye
      : mode === "unknown"
        ? CircleHelp
        : PersonStanding;

  return (
    <span
      className={`mission-target-vanish-icon mission-target-vanish-icon--${mode}`}
      role="img"
      aria-label={`消失方式：${label}`}
      title={`消失方式：${label}`}
      data-vanish-mode={mode}
    >
      <Icon size={14} aria-hidden="true" />
    </span>
  );
}
