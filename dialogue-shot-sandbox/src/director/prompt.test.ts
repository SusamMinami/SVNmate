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
    });

    expect(prompt).toContain("投影验收后的定向返修");
    expect(prompt).toContain("只重新设计失败镜头");
    expect(prompt).toContain("204803");
    expect(prompt).toContain("视线后方空白大于前向视线空间");
    expect(prompt).toContain("上一版完整方案");
  });
});
