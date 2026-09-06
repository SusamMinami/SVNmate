import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import type { ShotComposition } from "../types";
import { DEFAULT_CHARACTER_BODY, characterHeight } from "./characterGeometry";
import { assessProjection, solveSingleCamera, solveGroupCamera, subjectAzimuthDelta } from "./shotGeometry";

const composition: ShotComposition = {
  mode: "center", visualAnchor: "center", negativeSpace: "balanced", transition: "recenter",
};
const base = findDialogueSequence(demoDatabase, "2048").participants[0];

describe("per-character camera geometry", () => {
  it.each([1.005, 2.01, 3.015])("frames a %s metre actor using its own landmarks", (height) => {
    const subject = {
      ...base, position: [0, 2, 0] as const, facingTarget: [0, 2, 2] as const,
      bodyProfile: { ...DEFAULT_CHARACTER_BODY, height, width: 0.68 * height / 2.01, depth: 0.48 * height / 2.01, footOffset: [0, -0.5, 0] as const },
    };
    const result = solveSingleCamera({
      subject, participants: [subject], lensMm: 85,
      cameraHeight: characterHeight(subject, 1.66),
      composition, shotSize: "close-up", coverage: "single",
    });
    expect(result.geometry.position[1]).toBeCloseTo(1.5 + 1.66 * height / 2.01);
    expect(result.assessment.measuredShotSize).toBe("close-up");
    expect(result.assessment.subjectSafeForUltrawide).toBe(true);
    expect(result.assessment.valid).toBe(true);
  });

  it("fits tall and short actors without flattening ground elevation", () => {
    const actors = [
      { ...base, slot: "A" as const, position: [-1, 0, 0] as const, bodyProfile: { ...DEFAULT_CHARACTER_BODY, height: 1.1 } },
      { ...base, slot: "B" as const, position: [1, 0.8, 0] as const, bodyProfile: { ...DEFAULT_CHARACTER_BODY, height: 2.6 } },
    ];
    const camera = solveGroupCamera({ participants: actors, lensMm: 35, cameraHeight: 2, shotSize: "full", composition });
    const assessment = assessProjection(camera, actors[0], actors, 35, "full", "two-shot", composition);
    expect(assessment.visibleParticipantSlots).toEqual(["A", "B"]);
    expect(assessment.issues.filter((issue) => issue.ruleId === "FRM-004")).toEqual([]);
  });

  it("treats a missed triangle as advice but keeps missing subjects as errors", () => {
    const camera = solveGroupCamera({ participants: [base], lensMm: 35, cameraHeight: 1.72, shotSize: "full", composition });
    const advice = assessProjection(camera, base, [base], 35, "full", "group", { ...composition, mode: "triangular" });
    expect(advice.issues).toContainEqual(expect.objectContaining({ ruleId: "GRP-003", severity: "warning" }));
    expect(advice.valid).toBe(true);
    const missing = assessProjection({ position: [0, 2, 5], target: [0, 2, 10] }, base, [base], 85, "close-up", "single", composition);
    expect(missing.valid).toBe(false);
    expect(missing.issues).toContainEqual(expect.objectContaining({ ruleId: "FRM-SUBJECT", severity: "error" }));
  });

  it("measures orbit angle around the subject independently from camera aim", () => {
    const subject = { ...base, position: [0, 0, 0] as const };
    expect(subjectAzimuthDelta(
      { position: [0, 2, 5], target: [0, 1, 0] },
      { position: [5, 2, 0], target: [5, 1, -5] }, subject,
    )).toBeCloseTo(90);
  });
});
