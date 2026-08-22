import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import {
  createDefaultBlocking,
  resolveBlocking,
} from "./blockingResolver";
import { createDirectorInput } from "./contracts";
import { createRuleDecisions } from "./ruleDirector";
import { horizontalViewDelta } from "./shotGeometry";
import { resolveShotDecisions } from "./shotResolver";
import { createShotPlan, createShotPreview } from "./shotPlanner";
import { estimateDialogueDuration } from "./shotTiming";

describe("createShotPlan", () => {
  const sequence = findDialogueSequence(demoDatabase, "2048");
  const shots = createShotPlan(sequence);

  it("opens with a master shot and stays on one side of each relationship axis", () => {
    expect(shots[0].kind).toBe("master");
    expect(shots.every((shot) => shot.axis.id === "A-B")).toBe(true);
    expect(shots.every((shot) => shot.axis.cameraSide === 1)).toBe(true);
  });

  it("does not cut only because the speaker changes", () => {
    expect(shots[0].dialogueIds).toEqual(["204801", "204802"]);
    expect(shots[1].dialogueIds).toEqual(["204803", "204804"]);
    expect(shots[0].duration).toBeGreaterThanOrEqual(4);
    expect(shots[1].duration).toBeGreaterThanOrEqual(4);
  });

  it("turns pauses into reaction close-ups", () => {
    const reaction = shots.find((shot) => shot.content.includes("……"));
    expect(reaction?.kind).toBe("reaction");
    expect(reaction?.focalLength).toBeGreaterThan(70);
  });

  it("solves clean singles from actor-local facing and validates projection", () => {
    const singleShots = shots.filter(
      (shot) => shot.projection.coverage === "single",
    );

    expect(singleShots.map((shot) => shot.visualSubjectSlot)).toEqual([
      "B",
      "A",
      "B",
    ]);
    for (const shot of singleShots) {
      expect(shot.projection.subjectFaceAngle).toBeLessThanOrEqual(45);
      expect(shot.projection.measuredShotSize).toBe(
        shot.projection.expectedShotSize,
      );
      expect(shot.projection.visibleParticipantSlots).toEqual([
        shot.visualSubjectSlot,
      ]);
      expect(shot.projection.subjectSafeForUltrawide).toBe(true);
      expect(shot.projection.valid).toBe(true);
    }
    expect(shots.at(-1)?.label).toBe("B 反打中近景");
    expect(shots.at(-1)?.speakerSlot).toBe("B");
  });

  it("keeps adjacent 2048 camera directions at least 30 degrees apart", () => {
    for (let index = 1; index < shots.length; index += 1) {
      const delta = horizontalViewDelta(
        {
          position: shots[index - 1].cameraPosition,
          target: shots[index - 1].cameraTarget,
        },
        {
          position: shots[index].cameraPosition,
          target: shots[index].cameraTarget,
        },
      );
      expect(delta).toBeGreaterThanOrEqual(30);
    }
  });

  it("keeps the requested framing across the supported lens range", () => {
    const input = createDirectorInput(sequence, "lens-range-test");
    const blocking = createDefaultBlocking(input);
    const participants = resolveBlocking(
      sequence.participants,
      blocking,
      sequence.rows.map((row) => row.id),
    );
    const decisions = createRuleDecisions(input).map((decision, index) => ({
      ...decision,
      lens_mm: index % 2 === 0 ? 24 : 100,
    }));
    const resolved = resolveShotDecisions(
      { ...sequence, participants },
      decisions,
    );

    for (const shot of resolved) {
      expect(shot.projection.measuredShotSize).toBe(
        shot.projection.expectedShotSize,
      );
      expect(shot.projection.subjectSafeForUltrawide).toBe(true);
    }
  });

  it("estimates dialogue time from sentence length and retains short lines", () => {
    expect(estimateDialogueDuration("我在听。")).toBeLessThan(
      estimateDialogueDuration("先离开这里，巡逻队马上就会回来。"),
    );
    expect(shots.length).toBeLessThan(sequence.rows.length);

    const shortLineShot = shots.find((shot) =>
      shot.dialogueIds.includes("204806"),
    );
    expect(shortLineShot?.dialogueIds).toEqual(["204805", "204806"]);
    expect(shortLineShot?.duration).toBeGreaterThanOrEqual(4);
    expect(shortLineShot?.rationale).toContain("避免随说话人频繁切换");
  });

  it("introduces additional characters at their entry dialogue", () => {
    const groupSequence = findDialogueSequence(demoDatabase, "3099");
    const groupPreview = createShotPreview(groupSequence);
    const groupShots = groupPreview.shots;

    expect(groupShots[0].kind).toBe("master");
    expect(groupShots[0].label).toBe("双人建立镜头");
    expect(groupShots.slice(1).some((shot) => shot.kind === "group-medium"))
      .toBe(true);
    expect(groupPreview.sequence.participants.map((participant) => participant.entryIndex))
      .toEqual([0, 0, 2, 3]);
    const participantCEntry = groupShots.find(
      (shot) => shot.speakerSlot === "C",
    );
    const participantDEntry = groupShots.find(
      (shot) => shot.speakerSlot === "D",
    );
    expect(participantCEntry?.rationale).toContain("新角色");
    expect(participantDEntry?.rationale).toContain("新角色");
    expect(groupShots[0].dialogueIds).toEqual(["309901", "309902"]);
    const sortedX = groupPreview.sequence.participants
      .map((participant) => participant.position[0])
      .sort((left, right) => left - right);
    expect(
      sortedX.every(
        (value, index) =>
          index === 0 || value - sortedX[index - 1] >= 0.9,
      ),
    ).toBe(true);
  });

  it("changes relationship axes through a shared pivot in group dialogue", () => {
    const groupSequence = findDialogueSequence(demoDatabase, "3099");
    const groupShots = createShotPreview(groupSequence).shots;
    const relationshipShots = groupShots.filter(
      (shot) => shot.axis.kind === "relationship",
    );

    expect(relationshipShots.map((shot) => shot.axis.id)).toEqual([
      "A-B",
      "B-C",
      "C-D",
      "A-D",
    ]);
    for (let index = 1; index < relationshipShots.length; index += 1) {
      expect(
        relationshipShots[index - 1].axis.participantSlots.some((slot) =>
          relationshipShots[index].axis.participantSlots.includes(slot),
        ),
      ).toBe(true);
    }
    for (const shot of relationshipShots.filter(
      (candidate) => candidate.visualSubjectSlot !== null,
    )) {
      expect(shot.lookTargetSlot).not.toBeNull();
      expect(shot.lookTargetSlot).not.toBe(shot.visualSubjectSlot);
      expect(shot.facingOverrides[shot.visualSubjectSlot!]).toBeDefined();
    }
  });

  it("keeps a departing character in the exit shot and removes it afterward", () => {
    const groupSequence = findDialogueSequence(demoDatabase, "3099");
    const input = createDirectorInput(groupSequence, "departure-test");
    const blocking = createDefaultBlocking(input);
    blocking.placements[2].exit_dialogue_id = "309903";
    const participants = resolveBlocking(
      groupSequence.participants,
      blocking,
      groupSequence.rows.map((row) => row.id),
    );
    const stagedSequence = { ...groupSequence, participants };

    expect(participants[2].exitIndex).toBe(2);
    expect(() =>
      resolveShotDecisions(stagedSequence, createRuleDecisions(input)),
    ).not.toThrow();
    expect(
      participants.filter(
        (participant) =>
          participant.entryIndex <= 2 &&
          (participant.exitIndex === null || participant.exitIndex >= 2),
      ).map((participant) => participant.slot),
    ).toEqual(["A", "B", "C"]);
    expect(
      participants.filter(
        (participant) =>
          participant.entryIndex <= 3 &&
          (participant.exitIndex === null || participant.exitIndex >= 3),
      ).map((participant) => participant.slot),
    ).toEqual(["A", "B", "D"]);
  });
});
