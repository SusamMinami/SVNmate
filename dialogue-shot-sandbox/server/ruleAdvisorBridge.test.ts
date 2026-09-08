import { describe, expect, it } from "vitest";
import {
  buildRuleBeatPrompt,
  buildVisualScorePrompt,
  extractRuleAdvisorJson,
} from "./ruleAdvisorBridge";
import { createDirectorInput } from "../src/director/contracts";
import { createDefaultBlocking } from "../src/director/blockingResolver";
import {
  createRuleAnalysis,
  createRuleDecisions,
} from "../src/director/ruleDirector";
import { demoDatabase } from "../src/data/demo";
import { findDialogueSequence } from "../src/data/dialogueRepository";

describe("rule advisor bridge", () => {
  it("extracts advice from fenced model output", () => {
    expect(
      extractRuleAdvisorJson(
        '说明\n```json\n{"schema_version":"rule-advice.v1","adjustments":[]}\n```',
      ),
    ).toEqual({
      schema_version: "rule-advice.v1",
      adjustments: [],
    });
  });

  it("builds a single-image candidate scoring prompt", () => {
    const input = createDirectorInput(
      findDialogueSequence(demoDatabase, "2048"),
      "advisor-prompt-test",
    );
    const blocking = createDefaultBlocking(input);
    const request = {
      input,
      baseline: {
        shots: createRuleDecisions(input, blocking),
        analysis: createRuleAnalysis(input),
      },
      candidate_frames: [
        {
          candidate_id: "shot-01-camera-01",
          candidate_label: "规则基线",
          shot_index: 0,
          dialogue_ids: ["204801"],
          is_baseline: true,
          legal: true,
          camera: {
            position: [0, 1.6, 3] as [number, number, number],
            target: [0, 1.4, 0] as [number, number, number],
            focal_length: 50,
            shot_size: "medium-close-up" as const,
            coverage: "single" as const,
            visual_anchor: [0.33, 0.33] as [number, number],
            headroom: 0.08,
            look_room: 0.22,
            projection_issues: [],
          },
          image_data_url:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlZl0sAAAAASUVORK5CYII=",
        },
      ],
    };
    const prompt = buildVisualScorePrompt(
      request,
      request.candidate_frames[0],
    );

    expect(prompt).toContain("逐张发送");
    expect(prompt).toContain("规则基线");
    expect(prompt).toContain("不要提出新坐标");
  });

  it("separates narrative beat planning from camera generation", () => {
    const input = createDirectorInput(
      findDialogueSequence(demoDatabase, "2048"),
      "beat-prompt-test",
    );
    const { sound_effect_catalog: _catalog, ...advisorInput } = input;
    const prompt = buildRuleBeatPrompt({ input: advisorInput });

    expect(prompt).toContain("不负责生成摄影机参数");
    expect(prompt).toContain("所有对白必须按原顺序恰好覆盖一次");
    expect(prompt).toContain("relationship_hold");
    expect(prompt).toContain("dialogue_issues");
    expect(prompt).toContain("不直接替换或改写原台词");
  });
});
