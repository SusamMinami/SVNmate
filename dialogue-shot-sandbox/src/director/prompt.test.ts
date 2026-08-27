import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import { createDefaultBlocking } from "./blockingResolver";
import {
  createDirectorInput,
  type ReadyDirectorResponse,
} from "./contracts";
import { buildDirectorPrompt } from "./prompt";
import { createRuleDecisions } from "./ruleDirector";

describe("buildDirectorPrompt", () => {
  it("preserves BP facing and declares the supported actor turns", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const input = createDirectorInput(sequence, "actor-turn-request", {
      preserveInputFormation: true,
    });
    const prompt = buildDirectorPrompt(input, "Mira AI 导演");

    expect(input.participants[0]).toMatchObject({
      can_turn: true,
      initial_yaw_degrees: expect.any(Number),
    });
    expect(input.constraints.supported_actor_turn_degrees).toEqual([
      -180,
      -90,
      -45,
      45,
      90,
      180,
    ]);
    expect(prompt).toContain("不能假设角色已经精确朝向对话对象");
    expect(prompt).toContain("can_turn=false");
    expect(prompt).toContain("sound_effect_catalog");
    expect(prompt).toContain("A_SFX_Dialog_516918");
    expect(prompt).toContain("目录中没有足够匹配");
  });

  it("separates silent scene actors from dialogue subjects", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const backgroundParticipant = {
      ...sequence.participants[1],
      id: 999_001,
      instanceId: "bp:background:2",
      slot: "C" as const,
      name: "背景守卫",
      modelIndex: 2,
    };
    const input = createDirectorInput(
      {
        ...sequence,
        participants: [...sequence.participants, backgroundParticipant],
      },
      "background-prompt-request",
    );
    const prompt = buildDirectorPrompt(input, "Mira AI 导演");

    expect(input.participants.map((participant) => participant.role)).toEqual([
      "dialogue",
      "dialogue",
      "background",
    ]);
    expect(prompt).toContain("2 位对白角色");
    expect(prompt).toContain("1 位背景 NPC");
    expect(prompt).toContain("背景 NPC 不计入双人主体");
    expect(prompt).toContain("允许的 subject：A, B, both");
  });

  it("includes focused projection feedback for a model revision", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const input = createDirectorInput(sequence, "projection-retry-request");
    const blocking = createDefaultBlocking(input);
    const previousPlan: ReadyDirectorResponse = {
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
      sound_effects: [],
    };

    const prompt = buildDirectorPrompt(input, "Mira AI 导演", {
      previousPlan,
      failures: [
        {
          shotIndex: 2,
          dialogueIds: ["204803", "204804"],
          warnings: ["视线后方空白大于前向视线空间"],
        },
      ],
      referenceCases: [
        {
          caseId: "CASE-LOOKROOM",
          failureSignature: "look_room",
          originalTemplate: "close_up",
          revisedTemplate: "reverse_medium",
          summary: "调整主体落点并扩大前向空间",
          strategy: "改用互补反打并把主体放到反侧三分点",
          appliesWhen: "双人对话的普通视线空间不足",
          avoidWhen: "明确使用短边压迫构图",
        },
      ],
    });

    expect(prompt).toContain("投影验收后的定向返修");
    expect(prompt).toContain("只重新设计失败镜头");
    expect(prompt).toContain("204803");
    expect(prompt).toContain("视线后方空白大于前向视线空间");
    expect(prompt).toContain("上一版完整方案");
    expect(prompt).toContain("CASE-LOOKROOM");
    expect(prompt).toContain("revision_reflections");
    expect(prompt).toContain("不输出推理过程");
    expect(prompt).toContain("保留上一版 sound_effects");
  });
});
