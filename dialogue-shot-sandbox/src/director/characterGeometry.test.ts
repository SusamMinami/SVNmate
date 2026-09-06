import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import { characterBody, characterHeight, characterPoint, DEFAULT_CHARACTER_BODY } from "./characterGeometry";

describe("character geometry", () => {
  const actor = findDialogueSequence(demoDatabase, "2048").participants[0];

  it("keeps legacy profiles explicitly estimated", () => {
    expect(characterBody(actor)).toEqual(DEFAULT_CHARACTER_BODY);
  });

  it("combines root elevation and foot offset before scaling landmarks", () => {
    const small = {
      ...actor,
      position: [2, 1.2, 3] as const,
      bodyProfile: { ...DEFAULT_CHARACTER_BODY, source: "mesh_bounds" as const, height: 1.005, footOffset: [0, -0.5, 0] as const },
    };
    expect(characterHeight(small, 0)).toBeCloseTo(0.7);
    expect(characterHeight(small, 1.74)).toBeCloseTo(1.57);
    expect(characterHeight(small, 2.01)).toBeCloseTo(1.705);
  });

  it("rotates local offsets with facing without scaling root position", () => {
    const rotated = {
      ...actor,
      position: [10, 2, 5] as const,
      facingTarget: [12, 2, 5] as const,
      bodyProfile: { ...DEFAULT_CHARACTER_BODY, footOffset: [0.1, -0.9, 0.2] as const },
    };
    const point = characterPoint(rotated, 0);
    expect(point[0]).toBeCloseTo(10.2);
    expect(point[1]).toBeCloseTo(1.1);
    expect(point[2]).toBeCloseTo(4.9);
  });

  it("rejects invalid dimensions rather than producing NaN camera coordinates", () => {
    expect(characterBody({ bodyProfile: { ...DEFAULT_CHARACTER_BODY, height: NaN } })).toEqual(DEFAULT_CHARACTER_BODY);
    expect(characterBody({ bodyProfile: { ...DEFAULT_CHARACTER_BODY, width: 0 } })).toEqual(DEFAULT_CHARACTER_BODY);
  });
});
