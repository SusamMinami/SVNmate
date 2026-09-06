import { describe, expect, it } from "vitest";
import { demoDatabase } from "../src/data/demo";
import { findDialogueSequence } from "../src/data/dialogueRepository";
import { createDirectorInput } from "../src/director/contracts";
import type { DirectorPreferenceFeedback } from "../src/director/preferenceContracts";
import {
  directorPreferenceFingerprint,
  preferenceShotSummary,
} from "./directorPreferenceLibrary";

function feedback(): DirectorPreferenceFeedback {
  const fullInput = createDirectorInput(
    findDialogueSequence(demoDatabase, "2048"),
    "preference-test",
  );
  const { sound_effect_catalog: _catalog, ...input } = fullInput;
  return {
    input,
    shot_index: 0,
    feedback_type: "accept",
    reason: "关系清楚",
    source: "rule",
    original_shot: {
      template: "master_two_shot",
      framing: "medium",
      subject: "both",
      lensMm: 50,
    },
  };
}

describe("director preference library", () => {
  it("uses one stable identity when a user changes the verdict", () => {
    const accepted = feedback();
    const rejected = {
      ...accepted,
      feedback_type: "reject" as const,
      reason: "节奏不合适",
    };

    expect(directorPreferenceFingerprint(rejected)).toBe(
      directorPreferenceFingerprint(accepted),
    );
  });

  it("summarizes shot semantics without relying on camera coordinates", () => {
    expect(preferenceShotSummary(feedback().original_shot)).toBe(
      "模板 master_two_shot；景别 medium；主体 both；焦段 50mm",
    );
  });
});
