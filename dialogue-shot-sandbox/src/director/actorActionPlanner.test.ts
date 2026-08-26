import { describe, expect, it } from "vitest";
import type { DialogueParticipant, ParticipantSlot, Vec3 } from "../types";
import {
  participantFacingYawDegrees,
  planActorTurns,
} from "./actorActionPlanner";

function participant(
  slot: ParticipantSlot,
  name: string,
  position: Vec3,
  yawDegrees: number,
  canTurn = true,
): DialogueParticipant {
  const radians = (yawDegrees * Math.PI) / 180;
  return {
    id: slot.charCodeAt(0),
    name,
    note: "",
    introduction: "",
    resourceId: null,
    canTurn,
    instanceId: `test:${slot}`,
    slot,
    color: "#ffffff",
    position,
    facingTarget: [
      position[0] + Math.sin(radians) * 2,
      position[1],
      position[2] - Math.cos(radians) * 2,
    ],
    modelIndex: slot.charCodeAt(0) - 65,
    positionSource: "blueprint",
    firstDialogueId: "100001",
    firstDialogueIndex: 0,
    lastDialogueId: "100001",
    lastDialogueIndex: 0,
    entryDialogueId: "100001",
    entryIndex: 0,
    exitDialogueId: null,
    exitIndex: null,
  };
}

describe("actor turn planning", () => {
  it("quantizes a required facing change to supported UE turn actions", () => {
    const result = planActorTurns(
      [
        participant("A", "玩家", [0, 0, 0], 0),
        participant("B", "NPC", [2, 0, 0], 0),
      ],
      {
        kind: "conversation",
        subjectSlot: "A",
        lookTargetSlot: "B",
      },
    );

    expect(result.actions).toEqual([
      expect.objectContaining({
        participantSlot: "A",
        angleDegrees: 90,
        montageName: "AM_TurnRight90",
        target: "B",
      }),
      expect.objectContaining({
        participantSlot: "B",
        angleDegrees: -90,
        montageName: "AM_TurnLeft90",
        target: "A",
      }),
    ]);
    expect(
      participantFacingYawDegrees(result.participants[0]),
    ).toBe(90);
    expect(
      participantFacingYawDegrees(result.participants[1]),
    ).toBe(-90);
  });

  it("keeps a non-turning actor at the BP facing and reports the conflict", () => {
    const result = planActorTurns(
      [
        participant("A", "固定 NPC", [0, 0, 0], 0, false),
        participant("B", "玩家", [2, 0, 0], -90),
      ],
      {
        kind: "conversation",
        subjectSlot: "A",
        lookTargetSlot: "B",
      },
    );

    expect(result.actions.map((action) => action.participantSlot)).not.toContain(
      "A",
    );
    expect(participantFacingYawDegrees(result.participants[0])).toBe(0);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("固定 NPC"),
    );
  });
});
