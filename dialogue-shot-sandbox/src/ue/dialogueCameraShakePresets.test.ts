import { describe, expect, it } from "vitest";
import {
  DIALOGUE_CAMERA_SHAKE_PRESETS,
  dialogueCameraShakeAssetNameFromPath,
  dialogueCameraShakeClassPath,
} from "./dialogueCameraShakePresets";

describe("dialogue camera shake presets", () => {
  it("keeps eight distinct, bounded dialogue presets", () => {
    expect(DIALOGUE_CAMERA_SHAKE_PRESETS).toHaveLength(8);
    expect(
      new Set(DIALOGUE_CAMERA_SHAKE_PRESETS.map(({ assetName }) => assetName))
        .size,
    ).toBe(8);
    for (const preset of DIALOGUE_CAMERA_SHAKE_PRESETS) {
      expect(preset.durationSeconds).toBeGreaterThan(0);
      expect(preset.blendInSeconds).toBeGreaterThan(0);
      expect(preset.blendOutSeconds).toBeGreaterThan(0);
      expect(preset.blendInSeconds + preset.blendOutSeconds).toBeLessThan(
        preset.durationSeconds,
      );
    }
  });

  it("round-trips Blueprint class paths and rejects unrelated shakes", () => {
    for (const preset of DIALOGUE_CAMERA_SHAKE_PRESETS) {
      expect(
        dialogueCameraShakeAssetNameFromPath(
          dialogueCameraShakeClassPath(preset.assetName),
        ),
      ).toBe(preset.assetName);
    }
    expect(
      dialogueCameraShakeAssetNameFromPath(
        "/Game/Seria/Core/CameraShake/BP_CameraShake_Boss.BP_CameraShake_Boss_C",
      ),
    ).toBeNull();
  });
});
