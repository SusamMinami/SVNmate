import type {
  DialogueSequence,
  ExistingDialogueStoryboardResult,
  ShotPlan,
} from "../types";
import { assessProjection } from "./shotGeometry";
import { createShotPreview } from "./shotPlanner";
import { estimateShotDuration } from "./shotTiming";

export function createExistingStoryboardPreview(
  sequence: DialogueSequence,
  snapshot: ExistingDialogueStoryboardResult,
): ReturnType<typeof createShotPreview> | null {
  if (snapshot.status !== "found" || snapshot.nodes.length === 0) {
    return null;
  }
  const baseline = createShotPreview(sequence, {
    soundEffectCatalog: [],
  });
  const rowIndexById = new Map(
    sequence.rows.map((row, index) => [row.id, index]),
  );
  const cameraNodes = snapshot.nodes
    .flatMap((node) => {
      const rowIndex = rowIndexById.get(node.dialogueId);
      return rowIndex === undefined ? [] : [{ node, rowIndex }];
    })
    .sort((left, right) => left.rowIndex - right.rowIndex);
  const participantsBySlot = new Map(
    sequence.participants.map((participant) => [
      participant.slot,
      participant,
    ]),
  );
  const shots = cameraNodes.flatMap(({ node, rowIndex }, index): ShotPlan[] => {
    const nextRowIndex =
      cameraNodes[index + 1]?.rowIndex ?? sequence.rows.length;
    const rows = sequence.rows.slice(rowIndex, nextRowIndex);
    const sourceShot =
      baseline.shots.find((shot) =>
        shot.dialogueIds.includes(node.dialogueId),
      ) ?? baseline.shots[0];
    const firstRow = rows[0];
    const subject =
      (firstRow.speakerSlot
        ? participantsBySlot.get(firstRow.speakerSlot)
        : undefined) ??
      sequence.participants[0];
    if (!sourceShot || !firstRow || !subject) {
      return [];
    }
    const dialogueEndIndex = nextRowIndex - 1;
    const visibleParticipants = sequence.participants.filter(
      (participant) =>
        participant.entryIndex <= dialogueEndIndex &&
        (participant.exitIndex === null ||
          participant.exitIndex >= rowIndex),
    );
    const lookTarget = sourceShot.lookTargetSlot
      ? participantsBySlot.get(sourceShot.lookTargetSlot)
      : undefined;
    const assessment = assessProjection(
      {
        position: node.cameraPosition,
        target: node.cameraTarget,
      },
      subject,
      visibleParticipants,
      node.focalLength,
      sourceShot.projection.expectedShotSize,
      sourceShot.projection.coverage,
      sourceShot.compositionPlan,
      lookTarget,
      node.cameraRollDegrees,
    );
    const content = rows
      .map((row) => {
        const participant = row.speakerSlot
          ? participantsBySlot.get(row.speakerSlot)
          : undefined;
        return `${participant?.name ?? "未知"}：${row.content}`;
      })
      .join(" ");
    return [{
      ...sourceShot,
      id: `ue-shot-${String(index + 1).padStart(2, "0")}`,
      index,
      dialogueId: node.dialogueId,
      dialogueIds: rows.map((row) => row.id),
      dialogueEndIndex,
      speakerId: subject.id,
      speakerSlot: subject.slot,
      speakerName: subject.name,
      content,
      label: `已有镜头 · ${node.cameraName || node.moveType}`,
      focalLength: node.focalLength,
      endFocalLength: node.focalLength,
      duration: estimateShotDuration(rows.map((row) => row.content)),
      cameraPosition: node.cameraPosition,
      cameraTarget: node.cameraTarget,
      cameraEndPosition: node.cameraEndPosition,
      cameraEndTarget: node.cameraEndTarget,
      cameraMovement: node.cameraMovement,
      movementIntensity: node.movementIntensity,
      cameraRollDegrees: node.cameraRollDegrees,
      composition: `从 UE 节点 ${node.dialogueId} 读取 ${node.cameraName || node.moveType} 镜头配置。`,
      rationale: "已有 UE 镜头，只执行读取与投影验收。",
      visualSubjectSlot: subject.slot,
      actorActions: [],
      projection: {
        ...assessment,
        expectedShotSize: sourceShot.projection.expectedShotSize,
        coverage: sourceShot.projection.coverage,
        eyeTraceDelta: null,
      },
      advisorReview: undefined,
    }];
  });
  if (shots.length === 0) {
    return null;
  }
  return {
    ...baseline,
    sequence,
    shots,
    soundEffects: [],
  };
}
