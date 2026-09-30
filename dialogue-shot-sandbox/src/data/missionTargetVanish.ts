import type { MissionTargetVanishMode } from "../types";

export const MISSION_TARGET_VANISH_MODES = [
  "瞬间消失",
  "超视距消失",
  "不消失",
] as const satisfies readonly MissionTargetVanishMode[];

export function isMissionTargetVanishMode(
  value: string,
): value is MissionTargetVanishMode {
  return MISSION_TARGET_VANISH_MODES.includes(
    value as MissionTargetVanishMode,
  );
}
