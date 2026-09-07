import { describe, expect, it } from "vitest";
import type { UnrealTransform } from "../types";
import { createDirectorInput, DirectorInputSchema } from "../director/contracts";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import { solveGroupCamera } from "../director/shotGeometry";
import {
  sceneGeometryPenalty, scenePathIssues, stagePointToWorld, worldPointToStage, worldBoundsToStage,
  type SceneReference,
} from "./sceneReference";

export function sceneFixture(): SceneReference {
  return {
    version: "scene-reference.v1", dialogueId: "2048", formationClassPath: "/Game/Test.BP_C",
    mapPath: "/Game/Maps/Test", anchor: {
      id: "root", label: "Formation", source: "selected_actor",
      transform: { location: { x: 0, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 }, scale: { x: 1, y: 1, z: 1 } },
    },
    stageOrigin: [0, 0, 0], radiusMeters: 20, capturedAt: "2026-09-06T00:00:00.000Z",
    fingerprint: "a".repeat(64), shareWithDirector: false, warnings: [], truncated: false,
    objects: [{ id: "wall", label: "PRIVATE-WALL", assetPath: "/Game/Wall.Wall", kind: "static_mesh", center: [0, 1, 1.5], size: [1, 2, 0.2] }],
  };
}

describe("scene reference geometry", () => {
  it("converts a 90 degree UE yaw and reverses horizontal stage centering", () => {
    const root: UnrealTransform = {
      location: { x: 1000, y: 2000, z: 100 },
      rotation: { pitch: 0, yaw: 90, roll: 0 }, scale: { x: 1, y: 1, z: 1 },
    };
    const stage = worldPointToStage([1000, 2100, 100], root, [2, 0, -3]);
    expect(stage[0]).toBeCloseTo(-2);
    expect(stage[1]).toBeCloseTo(0);
    expect(stage[2]).toBeCloseTo(2);
    stagePointToWorld(stage, root, [2, 0, -3]).forEach((n, i) => expect(n).toBeCloseTo([1000, 2100, 100][i]));
    const bounds = worldBoundsToStage([1000, 2000, 100], [10, 20, 30], root, [2, 0, -3]);
    bounds.size.forEach((n, i) => expect(n).toBeCloseTo([0.2, 0.6, 0.4][i]));
  });

  it("roundtrips complete transforms and rejects a singular root", () => {
    const root = { ...sceneFixture().anchor.transform, rotation: { pitch: 15, yaw: -63, roll: 20 }, scale: { x: 1.5, y: 0.5, z: 2 } };
    const world = stagePointToWorld([2, 1, -4], root, [3, 0, 5]);
    worldPointToStage(world, root, [3, 0, 5]).forEach((n, i) => expect(n).toBeCloseTo([2, 1, -4][i]));
    expect(() => worldPointToStage(world, { ...root, scale: { x: 0, y: 1, z: 1 } }, [0, 0, 0])).toThrow("不可逆");
  });

  it("distinguishes intersecting and clear sightlines without a hard verdict", () => {
    const scene = sceneFixture();
    expect(sceneGeometryPenalty(scene, [0, 1, 3], [0, 1, 0])).toBeGreaterThan(0);
    expect(sceneGeometryPenalty(scene, [5, 1, 3], [0, 1, 0])).toBe(0);
    expect(sceneGeometryPenalty(undefined, [0, 1, 3], [0, 1, 0])).toBe(0);
    const issues = scenePathIssues(scene, { position: [-3, 1, 3], target: [-3, 1, 0] }, { position: [3, 1, 3], target: [3, 1, 0] });
    expect(issues).toContainEqual(expect.objectContaining({ ruleId: "SCN-BOUNDS", severity: "warning" }));
    expect(issues.every((issue) => issue.severity !== "error")).toBe(true);
  });

  it("reports incomplete scan coverage and out-of-range motion", () => {
    const scene = { ...sceneFixture(), truncated: true };
    const issues = scenePathIssues(scene, { position: [5, 1, 3], target: [0, 1, 0] }, { position: [40, 1, 3], target: [0, 1, 0] });
    expect(issues.map((issue) => issue.ruleId)).toEqual(expect.arrayContaining(["SCN-RANGE", "SCN-PARTIAL"]));
  });

  it("prefers a geometrically valid alternative outside a camera-sized scene box", () => {
    const participants = findDialogueSequence(demoDatabase, "2048").participants;
    const request = {
      participants, lensMm: 38, cameraHeight: 1.72, shotSize: "full" as const,
      composition: { mode: "asymmetrical_balance" as const, visualAnchor: "balanced" as const, negativeSpace: "balanced" as const, transition: "recenter" as const },
    };
    const baseline = solveGroupCamera(request);
    const scene = sceneFixture();
    scene.objects[0] = { ...scene.objects[0], center: baseline.position, size: [0.7, 0.7, 0.7] };
    const candidate = solveGroupCamera({ ...request, sceneReference: scene });
    expect(candidate.position).not.toEqual(baseline.position);
    expect(sceneGeometryPenalty(scene, candidate.position, candidate.target)).toBeLessThan(sceneGeometryPenalty(scene, baseline.position, baseline.target));
  });

  it("withholds scene content without consent but keeps the cache fingerprint", () => {
    const sequence = { ...findDialogueSequence(demoDatabase, "2048"), sceneReference: sceneFixture(), formationOrigin: [2, 0, -3] as const };
    const input = createDirectorInput(sequence);
    expect(JSON.stringify(input)).not.toContain("PRIVATE-WALL");
    expect(input.constraints.scene_reference_fingerprint).toBe(sequence.sceneReference.fingerprint);
    const consented = createDirectorInput({ ...sequence, sceneReference: { ...sequence.sceneReference, shareWithDirector: true } });
    expect(DirectorInputSchema.parse(consented).scene_reference?.objects[0].label).toBe("PRIVATE-WALL");
    expect(consented.formation_origin).toEqual([2, 0, -3]);
  });
});
