import { describe, expect, it } from "vitest";
import { demoDatabase } from "../src/data/demo";
import { findDialogueSequence } from "../src/data/dialogueRepository";
import { createDefaultBlocking } from "../src/director/blockingResolver";
import {
  createDirectorInput,
  type ReadyDirectorResponse,
} from "../src/director/contracts";
import type { DirectorProjectionFailure } from "../src/director/orchestrator";
import { createRuleDecisions } from "../src/director/ruleDirector";
import {
  buildRevisionCaseDrafts,
  failureSignature,
  failureTags,
} from "./storyboardCaseLibrary";

function testPlan(): {
  input: ReturnType<typeof createDirectorInput>;
  plan: ReadyDirectorResponse;
} {
  const sequence = findDialogueSequence(demoDatabase, "2048");
  const input = createDirectorInput(sequence, "case-library-test");
  const blocking = createDefaultBlocking(input);
  return {
    input,
    plan: {
      schema_version: "shot-plan.v5",
      request_id: input.request_id,
      status: "ready",
      scene_analysis: {
        dramatic_goal: "测试目标",
        emotional_progression: "测试推进",
        visual_strategy: "测试策略",
      },
      blocking,
      shots: createRuleDecisions(input, blocking),
    },
  };
}

describe("storyboard case library", () => {
  it("normalizes projection warnings into stable failure tags", () => {
    const warnings = [
      "主体前向视线空间不足，脸后空间过大",
      "角色轮廓发生重叠，21:9 安全框裁切头顶",
    ];

    expect(failureTags(warnings)).toEqual([
      "headroom",
      "look_room",
      "overlap",
      "safe_frame",
    ]);
    expect(failureSignature(warnings)).toBe(
      "headroom+look_room+overlap+safe_frame",
    );
  });

  it("builds a pending case from the before and after decisions", () => {
    const { input, plan } = testPlan();
    const before = plan.shots[0];
    const after = {
      ...before,
      lens_mm: 50,
      end_lens_mm: 50,
      lens_intent: "natural_perspective" as const,
      intent: "扩大视线空间并保持关系可读。",
    };
    const revisedPlan: ReadyDirectorResponse = {
      ...plan,
      shots: [after, ...plan.shots.slice(1)],
      revision_reflections: [
        {
          shot_index: 1,
          summary: "扩大主体前向空间",
          root_cause: "主体落点与注视方向冲突",
          strategy: "调整焦段和视觉落点",
          applies_when: "双人普通对话",
          avoid_when: "短边压迫构图",
        },
      ],
    };
    const failure: DirectorProjectionFailure = {
      shotIndex: 1,
      dialogueIds: [...before.dialogue_ids],
      warnings: ["主体前向视线空间不足"],
      decision: before,
    };

    const cases = buildRevisionCaseDrafts(
      input,
      plan,
      revisedPlan,
      [failure],
      [],
    );

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      shotIndex: 1,
      failureSignature: "look_room",
      outcome: "通过",
      beforeErrorCount: 1,
      afterErrorCount: 0,
    });
    expect(cases[0].reflection.strategy).toBe("调整焦段和视觉落点");
    expect(cases[0].fingerprint).toHaveLength(64);
  });

  it("keeps failed retries as negative cases", () => {
    const { input, plan } = testPlan();
    const failure: DirectorProjectionFailure = {
      shotIndex: 1,
      dialogueIds: [...plan.shots[0].dialogue_ids],
      warnings: ["主体前向视线空间不足"],
      decision: plan.shots[0],
    };
    const revisedFailure: DirectorProjectionFailure = {
      ...failure,
      warnings: ["主体前向视线空间不足", "头部空间不足"],
    };

    const cases = buildRevisionCaseDrafts(
      input,
      plan,
      plan,
      [failure],
      [revisedFailure],
    );

    expect(cases[0].outcome).toBe("恶化");
    expect(cases[0].afterErrorCount).toBe(2);
  });
});
