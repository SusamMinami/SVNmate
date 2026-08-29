import { describe, expect, it } from "vitest";
import {
  DirectorDecisionSchema,
  DirectorRevisionReflectionSchema,
  DirectorSoundEffectCueSchema,
} from "./contracts";

const baseDecision = {
  dialogue_ids: ["204801"],
  template: "close_up",
  subject: "A",
  look_target: "B",
  lens_mm: 85,
  end_lens_mm: 85,
  lens_intent: "compressed_intimacy",
  depth_of_field: "shallow",
  camera_movement: "static",
  movement_intensity: "none",
  camera_roll_degrees: 0,
  composition_mode: "golden_ratio",
  visual_anchor: "left_golden",
  negative_space: "look_room",
  composition_transition: "progressive_shift",
  coverage_intent: "individual_emphasis",
  camera_height: "eye",
  intent: "强调角色意识到真相的瞬间。",
};

describe("DirectorDecisionSchema camera language", () => {
  it("accepts a coordinated dolly zoom", () => {
    expect(
      DirectorDecisionSchema.safeParse({
        ...baseDecision,
        lens_mm: 85,
        end_lens_mm: 50,
        lens_intent: "compressed_intimacy",
        camera_movement: "dolly_zoom_in",
        movement_intensity: "moderate",
      }).success,
    ).toBe(true);
  });

  it("accepts a fixed-position optical zoom", () => {
    expect(
      DirectorDecisionSchema.safeParse({
        ...baseDecision,
        end_lens_mm: 120,
        camera_movement: "zoom_in",
        movement_intensity: "subtle",
      }).success,
    ).toBe(true);
  });

  it("rejects focal-length changes outside a dolly zoom", () => {
    const parsed = DirectorDecisionSchema.safeParse({
      ...baseDecision,
      end_lens_mm: 50,
    });

    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.some((issue) =>
        issue.message.includes("只有 zoom 或 dolly zoom"),
      ),
    ).toBe(true);
  });

  it("rejects unmotivated movement intensity and accidental roll", () => {
    const parsed = DirectorDecisionSchema.safeParse({
      ...baseDecision,
      movement_intensity: "subtle",
      camera_roll_degrees: 5,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toEqual(
      expect.arrayContaining([
        "movement_intensity",
        "camera_roll_degrees",
      ]),
    );
  });

  it("rejects a lens intent outside its focal range", () => {
    const parsed = DirectorDecisionSchema.safeParse({
      ...baseDecision,
      lens_mm: 28,
      end_lens_mm: 28,
      lens_intent: "compressed_intimacy",
    });

    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.some((issue) => issue.path[0] === "lens_intent"),
    ).toBe(true);
  });
});

describe("DirectorRevisionReflectionSchema", () => {
  it("accepts concise reusable revision conclusions", () => {
    expect(
      DirectorRevisionReflectionSchema.safeParse({
        shot_index: 2,
        summary: "扩大主体前向视线空间",
        root_cause: "视觉落点与注视方向冲突",
        strategy: "将主体移动到反侧三分点",
        applies_when: "普通双人对话近景",
        avoid_when: "明确使用短边压迫构图",
      }).success,
    ).toBe(true);
  });
});

describe("DirectorSoundEffectCueSchema", () => {
  it("accepts runtime catalog assets and rejects incomplete cues", () => {
    expect(
      DirectorSoundEffectCueSchema.safeParse({
        dialogue_id: "204803",
        asset_name: "A_SFX_Dialog_RuntimeAdded",
        category: "action",
        reason: "运行时同步加入的资产。",
      }).success,
    ).toBe(true);
    expect(
      DirectorSoundEffectCueSchema.safeParse({
        dialogue_id: "204803",
        asset_name: "",
        category: "special",
        reason: "资产名为空。",
      }).success,
    ).toBe(false);
  });
});
