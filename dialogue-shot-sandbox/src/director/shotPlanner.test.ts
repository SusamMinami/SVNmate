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

  it("balances relationship coverage with motivated singles", () => {
    expect(shots.slice(0, 3).some((shot) => shot.kind === "master")).toBe(
      true,
    );
    expect(
      shots.filter((shot) =>
        ["two-shot", "group", "group-medium"].includes(
          shot.projection.coverage,
        ),
      ),
    ).toHaveLength(2);
    expect(
      shots.filter((shot) => shot.projection.coverage === "single"),
    ).toHaveLength(2);
    expect(
      shots
        .filter((shot) => shot.projection.coverage === "single")
        .every((shot) =>
          [
            "individual_perspective",
            "individual_emphasis",
            "reaction",
          ].includes(shot.coverageIntent),
        ),
    ).toBe(true);
  });

  it("turns pauses into reaction close-ups", () => {
    const reaction = shots.find((shot) => shot.content.includes("……"));
    expect(reaction?.kind).toBe("reaction");
    expect(reaction?.focalLength).toBeGreaterThan(70);
  });

  it("uses restrained movement only for motivated emotional beats", () => {
    const pushIn = shots.find(
      (shot) => shot.cameraMovement === "dolly_in",
    );
    const pauseReaction = shots.find((shot) =>
      shot.content.includes("……"),
    );
    const distanceToTarget = (
      position: readonly [number, number, number],
      target: readonly [number, number, number],
    ) =>
      Math.hypot(
        position[0] - target[0],
        position[1] - target[1],
        position[2] - target[2],
      );

    expect(pushIn?.movementIntensity).toBe("subtle");
    expect(pushIn?.lensIntent).toBe("compressed_intimacy");
    expect(pushIn?.depthOfField).toBe("shallow");
    expect(
      distanceToTarget(
        pushIn!.cameraEndPosition,
        pushIn!.cameraEndTarget,
      ),
    ).toBeLessThan(
      distanceToTarget(pushIn!.cameraPosition, pushIn!.cameraTarget),
    );

    expect(pauseReaction?.cameraMovement).toBe("static");
    expect(pauseReaction?.compositionPlan.negativeSpace).toBe(
      "look_room",
    );

    const isolatedInput = createDirectorInput(
      sequence,
      "motivated-isolation-test",
    );
    isolatedInput.dialogue[4].content = "……只剩我一个人。";
    const isolatedDecision = createRuleDecisions(isolatedInput).find(
      (decision) => decision.dialogue_ids.includes("204805"),
    );
    expect(isolatedDecision?.camera_movement).toBe("dolly_out");
    expect(isolatedDecision?.movement_intensity).toBe("subtle");
    expect(isolatedDecision?.negative_space).toBe("isolation");
    expect(
      shots
        .filter((shot) => shot.cameraMovement === "static")
        .every(
          (shot) =>
            shot.movementIntensity === "none" &&
            shot.focalLength === shot.endFocalLength,
        ),
    ).toBe(true);
  });

  it("keeps dolly zoom movement and focal changes coupled", () => {
    const input = createDirectorInput(sequence, "dolly-zoom-test");
    const blocking = createDefaultBlocking(input);
    const participants = resolveBlocking(
      sequence.participants,
      blocking,
      sequence.rows.map((row) => row.id),
    );
    const decisions = createRuleDecisions(input, blocking);
    const source = decisions.find(
      (decision) => decision.template === "close_up",
    );
    expect(source).toBeDefined();
    source!.camera_movement = "dolly_zoom_in";
    source!.movement_intensity = "moderate";
    source!.lens_mm = 85;
    source!.end_lens_mm = 50;
    source!.lens_intent = "compressed_intimacy";
    const resolved = resolveShotDecisions(
      { ...sequence, participants },
      decisions,
    );
    const dollyZoom = resolved.find(
      (shot) => shot.cameraMovement === "dolly_zoom_in",
    );

    expect(dollyZoom?.endFocalLength).toBe(50);
    expect(
      Math.hypot(
        dollyZoom!.cameraEndPosition[0] - dollyZoom!.cameraEndTarget[0],
        dollyZoom!.cameraEndPosition[1] - dollyZoom!.cameraEndTarget[1],
        dollyZoom!.cameraEndPosition[2] - dollyZoom!.cameraEndTarget[2],
      ),
    ).toBeLessThan(
      Math.hypot(
        dollyZoom!.cameraPosition[0] - dollyZoom!.cameraTarget[0],
        dollyZoom!.cameraPosition[1] - dollyZoom!.cameraTarget[1],
        dollyZoom!.cameraPosition[2] - dollyZoom!.cameraTarget[2],
      ),
    );
    expect(
      dollyZoom?.projection.warnings.some((warning) =>
        warning.includes("Dolly zoom"),
      ),
    ).toBe(false);
  });

  it("solves clean singles from actor-local facing and validates projection", () => {
    const singleShots = shots.filter(
      (shot) => shot.projection.coverage === "single",
    );

    expect(singleShots.map((shot) => shot.visualSubjectSlot)).toEqual([
      "B",
      "A",
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
    expect(shots.at(-1)?.label).toBe("双人关系全景");
    expect(shots.at(-1)?.coverageIntent).toBe("relationship");
  });

  it("keeps adjacent 2048 camera directions at least 30 degrees apart", () => {
    for (let index = 1; index < shots.length; index += 1) {
      const delta = horizontalViewDelta(
        {
          position: shots[index - 1].cameraEndPosition,
          target: shots[index - 1].cameraEndTarget,
        },
        {
          position: shots[index].cameraPosition,
          target: shots[index].cameraTarget,
        },
      );
      expect(delta).toBeGreaterThanOrEqual(30);
    }
  });

  it("selects narrative composition modes and validates screen anchors", () => {
    expect(shots.map((shot) => shot.compositionPlan.mode)).toEqual([
      "symmetry",
      "golden_ratio",
      "golden_ratio",
      "asymmetrical_balance",
    ]);
    expect(shots[0].compositionPlan.transition).toBe("recenter");
    expect(shots.at(-1)?.compositionPlan.transition).toBe("match_eye_trace");

    for (const shot of shots) {
      expect(shot.projection.anchorDistance).toBeLessThanOrEqual(0.18);
      expect(Math.abs(shot.projection.visualWeightBias)).toBeLessThanOrEqual(
        0.42,
      );
    }
    for (const shot of shots.filter(
      (candidate) => candidate.compositionPlan.negativeSpace === "look_room",
    )) {
      expect(shot.projection.lookRoom).toBeGreaterThanOrEqual(0.14);
      expect(shot.projection.lookRoom).toBeGreaterThanOrEqual(
        (shot.projection.backRoom ?? 0) - 0.04,
      );
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
    const decisions = createRuleDecisions(input).map((decision, index) => {
      const lens = index % 2 === 0 ? 24 : 135;
      return {
        ...decision,
        lens_mm: lens,
        end_lens_mm: lens,
        lens_intent:
          lens === 24
            ? ("spatial_context" as const)
            : ("compressed_intimacy" as const),
      };
    });
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
    expect(groupShots.slice(0, 3).every((shot) => shot.kind === "master"))
      .toBe(true);
    expect(groupShots.map((shot) => shot.coverageIntent)).toEqual([
      "establish_geography",
      "reestablish_geography",
      "reestablish_geography",
    ]);
    expect(groupPreview.sequence.participants.map((participant) => participant.entryIndex))
      .toEqual([0, 0, 2, 3]);
    const participantCEntry = groupShots.find((shot) =>
      shot.dialogueIds.includes("309903"),
    );
    const participantDEntry = groupShots.find((shot) =>
      shot.dialogueIds.includes("309904"),
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
    const input = createDirectorInput(groupSequence, "group-axis-test");
    const blocking = createDefaultBlocking(input);
    for (const placement of blocking.placements) {
      placement.entry_dialogue_id = input.dialogue[0].dialogue_id;
    }
    const participants = resolveBlocking(
      groupSequence.participants,
      blocking,
      groupSequence.rows.map((row) => row.id),
    );
    const groupShots = resolveShotDecisions(
      { ...groupSequence, participants },
      createRuleDecisions(input, blocking),
    );
    const relationshipShots = groupShots.filter(
      (shot) => shot.axis.kind === "relationship",
    );

    expect(relationshipShots.map((shot) => shot.axis.id)).toEqual([
      "C-D",
      "A-D",
    ]);
    expect(
      relationshipShots.every(
        (shot) => shot.projection.coverage === "group-medium",
      ),
    ).toBe(true);
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
      resolveShotDecisions(
        stagedSequence,
        createRuleDecisions(input, blocking),
      ),
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
    const departureShots = resolveShotDecisions(
      stagedSequence,
      createRuleDecisions(input, blocking),
    );
    const shotAfterExit = departureShots.find((shot) =>
      shot.dialogueIds.includes("309904"),
    );
    expect(shotAfterExit?.kind).toBe("master");
    expect(shotAfterExit?.coverageIntent).toBe("reestablish_geography");
    expect(shotAfterExit?.projection.visibleParticipantSlots).toEqual([
      "A",
      "B",
      "D",
    ]);
  });
});
