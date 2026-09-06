import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import { createDefaultBlocking } from "./blockingResolver";
import { createDirectorInput } from "./contracts";
import { applyRuleAdvice } from "./ruleAdvisor";
import {
  createRuleAnalysis,
  createRuleDecisions,
} from "./ruleDirector";

describe("rule advisor", () => {
  it("applies valid high-confidence patches without changing dialogue coverage", () => {
    const input = createDirectorInput(
      findDialogueSequence(demoDatabase, "2048"),
      "rule-advisor-test",
    );
    const blocking = createDefaultBlocking(input);
    const decisions = createRuleDecisions(input, blocking);
    const analysis = createRuleAnalysis(input);
    const result = applyRuleAdvice(input, { decisions, analysis }, {
      schema_version: "rule-advice.v1",
      request_id: input.request_id,
      summary: "收紧关键反应",
      visual_scores: [
        {
          shot_index: 1,
          composition: 84,
          subject_readability: 90,
          occlusion: 86,
          continuity: 80,
          overall: 85,
          issues: [],
        },
      ],
      adjustments: [
        {
          shot_index: 1,
          confidence: 0.9,
          reason: "此处是明确的情绪反应",
          changes: {
            lens_mm: 85,
            depth_of_field: "shallow",
            movement_intensity: "subtle",
          },
        },
      ],
    });

    expect(result.appliedAdjustmentCount).toBe(1);
    expect(result.decisions[1].dialogue_ids).toEqual(
      decisions[1].dialogue_ids,
    );
    expect(result.decisions[1].lens_mm).toBe(85);
    expect(result.decisions[1].end_lens_mm).toBe(85);
    expect(result.decisions[1].lens_intent).toBe("subject_isolation");
    expect(result.decisions[1].movement_intensity).toBe(
      decisions[1].movement_intensity,
    );
    expect(result.analysis.visualStrategy).toContain("SHOT 02 85，均分 85");
  });

  it("rejects low-confidence and internally invalid patches", () => {
    const input = createDirectorInput(
      findDialogueSequence(demoDatabase, "2048"),
      "rule-advisor-reject-test",
    );
    const blocking = createDefaultBlocking(input);
    const decisions = createRuleDecisions(input, blocking);
    const analysis = createRuleAnalysis(input);
    const result = applyRuleAdvice(input, { decisions, analysis }, {
      schema_version: "rule-advice.v1",
      request_id: input.request_id,
      summary: "无可用调整",
      visual_scores: [
        {
          shot_index: 0,
          composition: 80,
          subject_readability: 80,
          occlusion: 80,
          continuity: 80,
          overall: 80,
          issues: [],
        },
      ],
      adjustments: [
        {
          shot_index: 0,
          confidence: 0.4,
          reason: "置信度不足",
          changes: { camera_height: "high" },
        },
        {
          shot_index: 1,
          confidence: 0.9,
          reason: "运动参数不完整",
          changes: {
            camera_movement: "static",
            movement_intensity: "strong",
          },
        },
      ],
    });

    expect(result.appliedAdjustmentCount).toBe(0);
    expect(result.decisions).toEqual(decisions);
  });
});
