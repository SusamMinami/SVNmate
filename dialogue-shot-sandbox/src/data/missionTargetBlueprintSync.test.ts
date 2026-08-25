import { describe, expect, it } from "vitest";
import type {
  MissionTargetPreviewTarget,
  UnrealTransform,
} from "../types";
import {
  buildMissionTargetBlueprintSync,
  missionTargetBlueprintRootForCreation,
} from "./missionTargetBlueprintSync";

function target(
  targetId: string,
  modelClassPath: string,
  x: number,
  y: number,
  z: number,
  yaw = 0,
): MissionTargetPreviewTarget {
  return {
    targetId,
    type: 1,
    description: targetId,
    npcId: 1,
    npcName: targetId,
    modelId: 1,
    modelClassPath,
    itemId: null,
    blueprintModelId: null,
    mapId: "1204",
    previewKind: "asset",
    transform: {
      location: { x, y, z },
      rotation: { pitch: 0, yaw, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function slot(
  modelIndex: number,
  modelClassPath: string,
  transform: Partial<UnrealTransform> = {},
) {
  return {
    modelIndex,
    modelClassPath,
    transform: {
      location: transform.location ?? { x: 0, y: 0, z: 100 },
      rotation: transform.rotation ?? { pitch: 0, yaw: 0, roll: 0 },
      scale: transform.scale ?? { x: 1, y: 1, z: 1 },
    },
  };
}

describe("mission target and Blueprint position mapping", () => {
  it("maps reordered models by class instead of task order", () => {
    const sync = buildMissionTargetBlueprintSync(
      [
        target("500001", "/Game/Test/BP_A.BP_A_C", 100, 200, 300),
        target("500002", "/Game/Test/BP_B.BP_B_C", 400, 500, 600),
      ],
      [
        slot(1, "/Game/Test/BP_B.BP_B_C"),
        slot(2, "/Game/Test/BP_A.BP_A_C"),
      ],
      {
        explicit: true,
        transform: {
          location: { x: 0, y: 0, z: 0 },
          rotation: { pitch: 0, yaw: 0, roll: 0 },
        },
      },
      "test",
    );

    expect(
      sync.mappings.map((mapping) => [
        mapping.modelIndex,
        mapping.targetId,
      ]),
    ).toEqual([
      [1, "500002"],
      [2, "500001"],
    ]);
  });

  it("uses the explicit BP root to disambiguate duplicate models", () => {
    const sync = buildMissionTargetBlueprintSync(
      [target("500001", "/Game/Test/BP_A.BP_A_C", 110, 100, 100)],
      [
        slot(3, "/Game/Test/BP_A.BP_A_C", {
          location: { x: 10, y: 0, z: 100 },
        }),
        slot(12, "/Game/Test/BP_A.BP_A_C", {
          location: { x: 500, y: 0, z: 100 },
        }),
      ],
      {
        explicit: true,
        transform: {
          location: { x: 100, y: 100, z: 0 },
          rotation: { pitch: 0, yaw: 0, roll: 0 },
        },
      },
      "test",
    );

    expect(sync.mappings).toHaveLength(1);
    expect(sync.mappings[0].modelIndex).toBe(3);
    expect(sync.unmatchedModelIndexes).toEqual([12]);
  });

  it("infers a missing root for target-to-BP updates but blocks reverse writes", () => {
    const sync = buildMissionTargetBlueprintSync(
      [
        target("500001", "/Game/Test/BP_A.BP_A_C", 1000, 2000, 3000),
        target("500002", "/Game/Test/BP_B.BP_B_C", 1100, 2000, 3000),
      ],
      [
        slot(1, "/Game/Test/BP_A.BP_A_C"),
        slot(2, "/Game/Test/BP_B.BP_B_C", {
          location: { x: 100, y: 0, z: 100 },
        }),
      ],
      {
        explicit: false,
        transform: {
          location: { x: 0, y: 0, z: 0 },
          rotation: { pitch: 0, yaw: 0, roll: 0 },
        },
      },
      "test",
    );

    expect(sync.rootTransform.location).toEqual({
      x: 1000,
      y: 2000,
      z: 2900,
    });
    expect(sync.canUpdateBlueprint).toBe(true);
    expect(sync.canUpdateTargets).toBe(false);
  });

  it("converts Blueprint local transforms back to target world transforms", () => {
    const sync = buildMissionTargetBlueprintSync(
      [target("500001", "/Game/Test/BP_A.BP_A_C", 100, 10, 100, 90)],
      [
        slot(1, "/Game/Test/BP_A.BP_A_C", {
          location: { x: 10, y: 0, z: 100 },
          rotation: { pitch: 0, yaw: 0, roll: 0 },
        }),
      ],
      {
        explicit: true,
        transform: {
          location: { x: 100, y: 0, z: 0 },
          rotation: { pitch: 0, yaw: 90, roll: 0 },
        },
      },
      "test",
    );

    expect(sync.mappings[0].blueprintWorldTransform).toEqual({
      location: { x: 100, y: 10, z: 100 },
      rotation: { pitch: 0, yaw: 90, roll: 0 },
    });
    expect(sync.mappings[0].positionDelta).toBe(0);
    expect(sync.mappings[0].rotationDelta).toBe(0);
  });

  it("derives the new BP root from the generated anchor convention", () => {
    expect(
      missionTargetBlueprintRootForCreation(
        target("500001", "/Game/Test/BP_A.BP_A_C", 10, 20, 130),
      ),
    ).toEqual({
      location: { x: 10, y: 20, z: 30 },
      rotation: { pitch: 0, yaw: 0, roll: 0 },
    });
  });
});
