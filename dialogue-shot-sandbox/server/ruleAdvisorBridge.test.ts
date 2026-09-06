import { describe, expect, it } from "vitest";
import {
  buildRuleBeatPrompt,
  buildRuleAdvisorPrompt,
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

  it("builds a constrained patch prompt instead of requesting a full plan", () => {
    const input = createDirectorInput(
      findDialogueSequence(demoDatabase, "2048"),
      "advisor-prompt-test",
    );
    const blocking = createDefaultBlocking(input);
    const prompt = buildRuleAdvisorPrompt({
      input,
      baseline: {
        shots: createRuleDecisions(input, blocking),
        analysis: createRuleAnalysis(input),
      },
      candidate_frames: [
        {
          shot_index: 0,
          dialogue_ids: ["2048"],
          image_data_url:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlZl0sAAAAASUVORK5CYII=",
        },
      ],
    });

    expect(prompt).toContain("不是独立导演");
    expect(prompt).toContain("不得修改 dialogue_ids");
    expect(prompt).toContain('"schema_version":"rule-advice.v1"');
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
  });
});
