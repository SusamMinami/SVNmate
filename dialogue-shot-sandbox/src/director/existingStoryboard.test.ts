import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import type { ExistingDialogueStoryboardResult } from "../types";
import { createExistingStoryboardPreview } from "./existingStoryboard";

describe("existing storyboard preview", () => {
  const sequence = findDialogueSequence(demoDatabase, "2048");

  it("returns no storyboard when UE has no camera data", () => {
    expect(
      createExistingStoryboardPreview(sequence, {
        status: "empty",
        dialogueAssetPath: "/Game/Test/204800.204800",
        nodes: [],
        warnings: [],
        message: "empty",
      }),
    ).toBeNull();
  });

  it("uses UE camera nodes as shot boundaries without invoking AI", () => {
    const snapshot: ExistingDialogueStoryboardResult = {
      status: "found",
      dialogueAssetPath: "/Game/Test/204800.204800",
      warnings: [],
      message: "loaded",
      nodes: [
        {
          dialogueId: "204801",
          cameraName: "c1",
          moveType: "EPush",
          cameraPosition: [1, 1.6, 3],
          cameraTarget: [0, 1.4, 0],
          cameraEndPosition: [1, 1.6, 3],
          cameraEndTarget: [0, 1.4, 0],
          focalLength: 50,
          cameraRollDegrees: 0,
          cameraMovement: "static",
          movementIntensity: "none",
        },
        {
          dialogueId: "204803",
          cameraName: "c2",
          moveType: "EPush",
          cameraPosition: [-1, 1.7, 2.8],
          cameraTarget: [0, 1.5, 0],
          cameraEndPosition: [-0.8, 1.7, 2.6],
          cameraEndTarget: [0, 1.5, 0],
          focalLength: 42,
          cameraRollDegrees: 2,
          cameraMovement: "tracking",
          movementIntensity: "subtle",
        },
      ],
    };

    const preview = createExistingStoryboardPreview(sequence, snapshot);
    expect(preview?.shots).toHaveLength(2);
    expect(preview?.shots[0]).toMatchObject({
      dialogueId: "204801",
      dialogueIds: ["204801", "204802"],
      cameraPosition: [1, 1.6, 3],
      focalLength: 50,
      label: "已有镜头 · c1",
    });
    expect(preview?.shots[1]).toMatchObject({
      dialogueId: "204803",
      dialogueIds: ["204803", "204804", "204805", "204806", "204807"],
      cameraMovement: "tracking",
      cameraRollDegrees: 2,
    });
  });
});
