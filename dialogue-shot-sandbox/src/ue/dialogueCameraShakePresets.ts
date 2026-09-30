export const DIALOGUE_CAMERA_SHAKE_DIRECTORY =
  "/Game/Seria/Core/CameraShake";

export const DIALOGUE_CAMERA_SHAKE_ASSET_NAMES = [
  "BP_Dialog_CameraShake",
  "BP_Dialog_CameraShake_2",
  "BP_Dialog_CameraShake_3",
  "BP_Dialog_CameraShake_4",
  "BP_Dialog_CameraShake_5",
  "BP_Dialog_CameraShake_6",
  "6015_CameraShake_Slow",
  "6015_CameraShake_Fast",
] as const;

export type DialogueCameraShakeAssetName =
  (typeof DIALOGUE_CAMERA_SHAKE_ASSET_NAMES)[number];

export interface DialogueCameraShakePreset {
  assetName: DialogueCameraShakeAssetName;
  label: string;
  useCase: string;
  intensity: "轻" | "中" | "强";
  durationSeconds: number;
  blendInSeconds: number;
  blendOutSeconds: number;
  motionSummary: string;
  durationLabel?: string;
}

export const DIALOGUE_CAMERA_SHAKE_PRESETS: readonly DialogueCameraShakePreset[] =
  [
    {
      assetName: "BP_Dialog_CameraShake",
      label: "轻微强调",
      useCase: "台词重音、轻微碰撞",
      intensity: "轻",
      durationSeconds: 0.45,
      blendInSeconds: 0.05,
      blendOutSeconds: 0.18,
      motionSummary: "三轴位移 <= 0.35 cm",
    },
    {
      assetName: "BP_Dialog_CameraShake_2",
      label: "横向威压",
      useCase: "近处能量、力量宣告",
      intensity: "强",
      durationSeconds: 0.9,
      blendInSeconds: 0.04,
      blendOutSeconds: 0.28,
      motionSummary: "横向位移 <= 1.8 cm",
    },
    {
      assetName: "BP_Dialog_CameraShake_3",
      label: "纵向冲击",
      useCase: "落地、撞击、突发警报",
      intensity: "中",
      durationSeconds: 0.65,
      blendInSeconds: 0.04,
      blendOutSeconds: 0.22,
      motionSummary: "垂直位移 <= 1.2 cm",
    },
    {
      assetName: "BP_Dialog_CameraShake_4",
      label: "环境震颤",
      useCase: "地面震动、空间异变",
      intensity: "中",
      durationSeconds: 2.5,
      blendInSeconds: 0.25,
      blendOutSeconds: 0.65,
      motionSummary: "低频位移 <= 0.7 cm",
    },
    {
      assetName: "BP_Dialog_CameraShake_5",
      label: "紧张手持",
      useCase: "压迫、眩晕、主观不安",
      intensity: "轻",
      durationSeconds: 1.8,
      blendInSeconds: 0.25,
      blendOutSeconds: 0.55,
      motionSummary: "低频旋转 <= 0.12 deg",
    },
    {
      assetName: "BP_Dialog_CameraShake_6",
      label: "惊讶顿挫",
      useCase: "突然发现、喝止、反应",
      intensity: "中",
      durationSeconds: 0.55,
      blendInSeconds: 0.03,
      blendOutSeconds: 0.2,
      motionSummary: "短促位移 + 旋转",
    },
    {
      assetName: "6015_CameraShake_Slow",
      label: "第一人称·平稳",
      useCase: "静止观察、缓慢呼吸",
      intensity: "轻",
      durationSeconds: 100,
      durationLabel: "持续",
      blendInSeconds: 0.8,
      blendOutSeconds: 1.2,
      motionSummary: "呼吸位移 <= 0.22 cm",
    },
    {
      assetName: "6015_CameraShake_Fast",
      label: "第一人称·紧急",
      useCase: "急促呼吸、紧张逼近",
      intensity: "中",
      durationSeconds: 100,
      durationLabel: "持续",
      blendInSeconds: 0.25,
      blendOutSeconds: 0.65,
      motionSummary: "复合位移 <= 0.55 cm",
    },
  ];

const DIALOGUE_CAMERA_SHAKE_ASSET_NAME_SET = new Set<string>(
  DIALOGUE_CAMERA_SHAKE_ASSET_NAMES,
);

export function dialogueCameraShakeAssetPath(
  assetName: DialogueCameraShakeAssetName,
): string {
  return `${DIALOGUE_CAMERA_SHAKE_DIRECTORY}/${assetName}.${assetName}`;
}

export function dialogueCameraShakeClassPath(
  assetName: DialogueCameraShakeAssetName,
): string {
  return `${dialogueCameraShakeAssetPath(assetName)}_C`;
}

export function dialogueCameraShakeAssetNameFromPath(
  value: string,
): DialogueCameraShakeAssetName | null {
  const match = value.match(
    /(BP_Dialog_CameraShake(?:_[2-6])?|6015_CameraShake_(?:Slow|Fast))(?:_C)?(?:'|$)/,
  );
  const assetName = match?.[1] ?? "";
  return DIALOGUE_CAMERA_SHAKE_ASSET_NAME_SET.has(assetName)
    ? (assetName as DialogueCameraShakeAssetName)
    : null;
}

export function dialogueCameraShakePreset(
  assetName: DialogueCameraShakeAssetName | null | undefined,
): DialogueCameraShakePreset | null {
  return (
    DIALOGUE_CAMERA_SHAKE_PRESETS.find(
      (preset) => preset.assetName === assetName,
    ) ?? null
  );
}
