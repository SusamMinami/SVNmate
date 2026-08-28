import { afterEach, describe, expect, it, vi } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import type { DialogueSequence, Vec3 } from "../types";
import { createDefaultBlocking } from "./blockingResolver";
import {
  createDirectorInput,
  type ReadyDirectorResponse,
} from "./contracts";
import {
  createSharedPlanPreview,
  designShots,
  inspectDirectorProjection,
} from "./orchestrator";
import { createRuleDecisions } from "./ruleDirector";

const sequence = findDialogueSequence(demoDatabase, "2048");

function facingTargetAt(position: Vec3, angleDegrees: number): Vec3 {
  const radians = (angleDegrees * Math.PI) / 180;
  return [
    position[0] + Math.cos(radians) * 2,
    position[1],
    position[2] + Math.sin(radians) * 2,
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("designShots", () => {
  it("degrades to the rule director when Mira fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "MIRA_TIMEOUT",
            message: "Mira 超时",
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await designShots(sequence, "mira");

    expect(result.requestedMode).toBe("mira");
    expect(result.appliedMode).toBe("rule");
    expect(result.fallbackReason).toContain("Mira 超时");
    expect(result.shots.length).toBeLessThan(sequence.rows.length);
  });

  it("degrades to the rule director when internal TRAE collaboration fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "TRAE_COLLABORATION_ERROR",
            message: "内部 TRAE 协作超时",
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await designShots(sequence, "trae");

    expect(result.requestedMode).toBe("trae");
    expect(result.appliedMode).toBe("rule");
    expect(result.fallbackReason).toContain("内部 TRAE 协作超时");
    expect(result.shots.length).toBeLessThan(sequence.rows.length);
  });

  it("bypasses the TRAE cache when regeneration is explicitly requested", async () => {
    let requestedUrl = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "TRAE_COLLABORATION_ERROR",
            message: "测试结束请求",
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    await designShots(sequence, "trae", { forceRegenerate: true });

    expect(requestedUrl).toBe("/api/director/trae?force=1");
  });

  it("applies a schema-valid Mira plan", async () => {
    let sentInput:
      | {
          request_id: string;
          adjacent_context: {
            previous: { dialogue_prefix: string } | null;
            next: { dialogue_prefix: string } | null;
          };
        }
      | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const input = JSON.parse(String(init?.body)) as typeof sentInput;
      sentInput = input;
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            schema_version: "shot-plan.v5",
            request_id: input!.request_id,
            status: "ready",
            scene_analysis: {
              dramatic_goal: "逼迫对方承认拿走钥匙",
              emotional_progression: "试探逐步升级为短暂合作",
              visual_strategy: "建立镜头后穿插高低机位",
            },
            blocking: {
              formation: "opposed_groups",
              intent: "让两人保持清晰对景关系。",
              placements: [
                {
                  subject: "A",
                  position: "mid_left",
                  facing: "B",
                  entry_dialogue_id: "204801",
                  exit_dialogue_id: null,
                  intent: "A 主动逼问并面向 B。",
                },
                {
                  subject: "B",
                  position: "mid_right",
                  facing: "A",
                  entry_dialogue_id: "204801",
                  exit_dialogue_id: null,
                  intent: "B 承受压力并面向 A。",
                },
              ],
            },
            sound_effects: [
              {
                dialogue_id: "204803",
                asset_name: "A_SFX_Dialog_516918",
                category: "special",
                reason: "系统异常时使用报警提示。",
              },
            ],
            shots: sequence.rows.map((row, index) => ({
              dialogue_ids: [row.id],
              template:
                index === 0
                  ? "master_two_shot"
                  : index === 4
                    ? "low_angle_closeup"
                    : "reverse_medium",
              subject:
                index === 0
                  ? "both"
                  : sequence.participants.find(
                        (participant) => participant.id === row.npcId,
                      )?.slot,
              look_target:
                index === 0
                  ? "group_center"
                  : row.npcId === sequence.participants[0].id
                    ? "B"
                    : "A",
              lens_mm: index === 0 ? 35 : 50,
              end_lens_mm: index === 0 ? 35 : 50,
              lens_intent:
                index === 0
                  ? "spatial_context"
                  : "subject_isolation",
              depth_of_field: index === 0 ? "deep" : "moderate",
              camera_movement: "static",
              movement_intensity: "none",
              camera_roll_degrees: 0,
              composition_mode:
                index === 0 ? "symmetry" : "rule_of_thirds",
              visual_anchor:
                index === 0
                  ? "balanced"
                  : row.npcId === sequence.participants[0].id
                    ? "left_third"
                    : "right_third",
              negative_space: index === 0 ? "balanced" : "look_room",
              composition_transition:
                index === 0 ? "recenter" : "mirror_reverse",
              coverage_intent:
                index === 0
                  ? "establish_geography"
                  : "individual_perspective",
              camera_height: index === 4 ? "low" : "eye",
              intent: `测试镜头 ${index + 1}`,
            })),
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const result = await designShots(sequence, "mira");

    expect(result.appliedMode).toBe("mira");
    expect(result.fallbackReason).toBeNull();
    expect(sentInput?.adjacent_context.previous?.dialogue_prefix).toBe(
      "2047",
    );
    expect(sentInput?.adjacent_context.next?.dialogue_prefix).toBe("2049");
    expect(result.shots[4].kind).toBe("low-angle");
    expect(result.analysis?.dramaticGoal).toContain("钥匙");
    expect(result.soundEffects).toEqual([
      expect.objectContaining({
        dialogueId: "204803",
        assetName: "A_SFX_Dialog_516918",
        description: expect.stringContaining("报警"),
      }),
    ]);
    expect(result.participants[0].position).toEqual([-2.05, 0, -0.18]);
    expect(result.participants[0].facingTarget).toEqual([
      2.05,
      0,
      -0.18,
    ]);
  });

  it("reports an unsolved axis crossing as a revisable projection failure", () => {
    const blueprintSequence: DialogueSequence = {
      ...sequence,
      participants: sequence.participants.map((participant, index) => ({
        ...participant,
        canTurn: false,
        modelIndex: index,
        positionSource: "blueprint" as const,
        firstDialogueId: sequence.rows[0].id,
        firstDialogueIndex: 0,
        entryDialogueId: sequence.rows[0].id,
        entryIndex: 0,
        facingTarget: facingTargetAt(
          participant.position,
          participant.slot === "A" ? -90 : 180,
        ),
      })),
    };
    const input = createDirectorInput(
      blueprintSequence,
      "axis-projection-failure-test",
    );
    const blocking = createDefaultBlocking(input);
    const plan = {
      schema_version: "shot-plan.v5",
      request_id: input.request_id,
      status: "ready",
      scene_analysis: {
        dramatic_goal: "验证关系轴失败可返修",
        emotional_progression: "保持测试对话节奏",
        visual_strategy: "先建立空间，再切单人镜头",
      },
      blocking,
      shots: createRuleDecisions(input, blocking),
      sound_effects: [],
    } satisfies ReadyDirectorResponse;

    const failures = inspectDirectorProjection(input, plan);
    const axisFailure = failures.find((failure) =>
      failure.warnings.includes("越过了关系轴 A-B"),
    );

    expect(axisFailure).toMatchObject({
      shotIndex: 2,
      dialogueIds: ["204803", "204804"],
    });
  });

  it("preserves Blueprint class paths in shared plan previews", () => {
    const blueprintSequence: DialogueSequence = {
      ...sequence,
      participants: sequence.participants.map((participant, index) => ({
        ...participant,
        modelIndex: index,
        modelClassPath: `/Game/Test/BP_${participant.slot}.BP_${participant.slot}_C`,
        positionSource: "blueprint" as const,
        firstDialogueId: sequence.rows[0].id,
        firstDialogueIndex: 0,
        lastDialogueId: sequence.rows.at(-1)!.id,
        lastDialogueIndex: sequence.rows.length - 1,
        entryDialogueId: sequence.rows[0].id,
        entryIndex: 0,
        exitDialogueId: null,
        exitIndex: null,
      })),
    };
    const input = createDirectorInput(
      blueprintSequence,
      "shared-blueprint-path-test",
    );
    const blocking = createDefaultBlocking(input);
    const plan = {
      schema_version: "shot-plan.v5",
      request_id: input.request_id,
      status: "ready",
      scene_analysis: {
        dramatic_goal: "验证共享方案保留 BP 路径",
        emotional_progression: "保持测试对话节奏",
        visual_strategy: "沿用当前站位",
      },
      blocking,
      shots: createRuleDecisions(input, blocking),
      sound_effects: [],
    } satisfies ReadyDirectorResponse;

    const shared = createSharedPlanPreview(input, plan);

    expect(shared.sequence.participants.map((item) => item.modelClassPath))
      .toEqual(blueprintSequence.participants.map((item) => item.modelClassPath));
  });
});
