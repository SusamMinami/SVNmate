import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import {
  characterBody,
  characterHeight,
  characterPoint,
  characterProxyScales,
  DEFAULT_CHARACTER_BODY,
} from "./characterGeometry";

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

  it("keeps the rendered head isotropic under non-uniform body scaling", () => {
    const scales = characterProxyScales({
      ...DEFAULT_CHARACTER_BODY,
      source: "mesh_bounds",
      height: 1.3,
      width: 0.9,
      depth: 0.36,
    });
    const worldHeadScale = scales.bodyScale.map(
      (scale, index) => scale * scales.headCorrection[index],
    );
    expect(worldHeadScale[0]).toBeCloseTo(worldHeadScale[1]);
    expect(worldHeadScale[1]).toBeCloseTo(worldHeadScale[2]);
    expect(scales.bodyScale[0]).not.toBeCloseTo(scales.bodyScale[1]);
  });

  it("caps attachment-heavy mesh bounds to humanoid proxy proportions", () => {
    const participant = {
      ...actor,
      bodyProfile: {
        ...DEFAULT_CHARACTER_BODY,
        source: "mesh_bounds" as const,
        height: 1.8,
        width: 2.4,
        depth: 1.6,
      },
    };
    const body = characterBody(participant);
    expect(body.width).toBeCloseTo(1.8 * 0.42);
    expect(body.depth).toBeCloseTo(1.8 * 0.32);
    expect(characterProxyScales(body).bodyScale[0]).toBeLessThan(1.12);
  });

  it("rejects invalid dimensions rather than producing NaN camera coordinates", () => {
    expect(characterBody({ bodyProfile: { ...DEFAULT_CHARACTER_BODY, height: NaN } })).toEqual(DEFAULT_CHARACTER_BODY);
    expect(characterBody({ bodyProfile: { ...DEFAULT_CHARACTER_BODY, width: 0 } })).toEqual(DEFAULT_CHARACTER_BODY);
  });
});
