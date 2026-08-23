import type {
  BlueprintFormationSnapshot,
  DialogueDatabase,
  DialogueParticipant,
  DialogueSequence,
  ModelResource,
  NpcProfile,
  ParticipantSlot,
  Vec3,
} from "../types";
import {
  MAX_DIALOGUE_PARTICIPANTS,
  PARTICIPANT_SLOTS,
} from "../types";
import { PARTICIPANT_COLORS } from "./dialogueRepository";

export interface AppliedBlueprintFormation {
  sequence: DialogueSequence;
  activeSlotCount: number;
  mappedSlotCount: number;
}

function normalizedAssetPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").toLowerCase();
  const withoutClass = normalized.endsWith("_c")
    ? normalized.slice(0, -2)
    : normalized;
  const [packagePath] = withoutClass.split(".");
  return packagePath;
}

function matchesResource(
  modelName: string,
  modelClassPath: string,
  resource: ModelResource | undefined,
): boolean {
  const classPath = normalizedAssetPath(modelClassPath);
  if (resource) {
    const configuredPath = normalizedAssetPath(resource.configuredPath);
    const generatedPath = normalizedAssetPath(resource.generatedClassPath);
    if (
      (configuredPath && classPath === configuredPath) ||
      (generatedPath && classPath === generatedPath)
    ) {
      return true;
    }
  }
  const token = modelName.trim().toLowerCase();
  return Boolean(
    token &&
      (classPath.includes(`/${token}/`) ||
        classPath.endsWith(`/${token}`) ||
        classPath.includes(`/bp_${token}`)),
  );
}

function uePositionToStage(
  location: BlueprintFormationSnapshot["slots"][number]["transform"]["location"],
): Vec3 {
  return [location.y / 100, 0, -location.x / 100];
}

function ueFacingTarget(
  position: Vec3,
  yawDegrees: number,
): Vec3 {
  const yaw = (yawDegrees * Math.PI) / 180;
  return [
    position[0] + Math.sin(yaw) * 2,
    position[1],
    position[2] - Math.cos(yaw) * 2,
  ];
}

function profileCandidates(
  database: DialogueDatabase,
  sequence: DialogueSequence,
  modelName: string,
  modelClassPath: string,
): NpcProfile[] {
  if (modelName.trim().toLowerCase() === "player") {
    return sequence.participants.filter((participant) => participant.id === 1);
  }
  return sequence.participants.filter((participant) =>
    matchesResource(
      modelName,
      modelClassPath,
      participant.resourceId === null
        ? undefined
        : database.models.get(participant.resourceId),
    ),
  );
}

function explicitNpcIdsByModelIndex(
  sequence: DialogueSequence,
): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>();
  for (const row of sequence.rows) {
    if (row.npcId === null || row.speakerModelIndex === null) {
      continue;
    }
    const ids = result.get(row.speakerModelIndex) ?? new Set<number>();
    ids.add(row.npcId);
    result.set(row.speakerModelIndex, ids);
  }
  return result;
}

export function applyBlueprintFormation(
  database: DialogueDatabase,
  sequence: DialogueSequence,
  snapshot: BlueprintFormationSnapshot,
): AppliedBlueprintFormation {
  const modelNames = sequence.formation?.modelNames ?? [];
  const explicitNpcIds = explicitNpcIdsByModelIndex(sequence);
  const activeSlots = snapshot.slots
    .filter((slot) => {
      if (modelNames.length === 0) {
        return true;
      }
      const modelName = modelNames[slot.modelIndex];
      return modelName && modelName.toLowerCase() !== "none";
    })
    .sort((left, right) => left.modelIndex - right.modelIndex)
    .slice(0, MAX_DIALOGUE_PARTICIPANTS);
  const warnings = [...sequence.warnings, ...snapshot.warnings];
  const mapped = activeSlots.flatMap((slot) => {
    const modelName = modelNames[slot.modelIndex] ?? "";
    const candidates = profileCandidates(
      database,
      sequence,
      modelName,
      slot.modelClassPath,
    );
    const explicitIds = explicitNpcIds.get(slot.modelIndex);
    const explicitCandidates = explicitIds
      ? candidates.filter((candidate) => explicitIds.has(candidate.id))
      : [];
    const profile = explicitCandidates[0] ?? candidates[0];
    if (!profile) {
      warnings.push(
        `BP 槽位 ${slot.modelIndex}（${modelName}）无法映射到当前对话 NPC`,
      );
      return [];
    }
    return [{ slot, profile }];
  });

  if (mapped.length < 2) {
    throw new Error("BP 中可映射到当前对话的有效角色不足两位");
  }

  const rawPositions = mapped.map(({ slot }) =>
    uePositionToStage(slot.transform.location),
  );
  const centerX =
    rawPositions.reduce((total, position) => total + position[0], 0) /
    rawPositions.length;
  const centerZ =
    rawPositions.reduce((total, position) => total + position[2], 0) /
    rawPositions.length;
  const duplicateCount = new Map<number, number>();
  for (const { profile } of mapped) {
    duplicateCount.set(profile.id, (duplicateCount.get(profile.id) ?? 0) + 1);
  }
  const duplicateOrdinal = new Map<number, number>();

  const participants: DialogueParticipant[] = mapped.map(
    ({ slot: formationSlot, profile }, index) => {
      const positionValue = rawPositions[index];
      const position: Vec3 = [
        Number((positionValue[0] - centerX).toFixed(4)),
        0,
        Number((positionValue[2] - centerZ).toFixed(4)),
      ];
      const ordinal = (duplicateOrdinal.get(profile.id) ?? 0) + 1;
      duplicateOrdinal.set(profile.id, ordinal);
      const name =
        (duplicateCount.get(profile.id) ?? 0) > 1
          ? `${profile.name} ${ordinal}`
          : profile.name;
      return {
        ...profile,
        name,
        instanceId: `bp:${snapshot.blueprintAssetPath}:${formationSlot.modelIndex}`,
        slot: PARTICIPANT_SLOTS[index] as ParticipantSlot,
        color: PARTICIPANT_COLORS[index],
        position,
        facingTarget: ueFacingTarget(
          position,
          formationSlot.transform.rotation.yaw,
        ),
        modelIndex: formationSlot.modelIndex,
        positionSource: "blueprint",
        firstDialogueId: sequence.rows[0].id,
        firstDialogueIndex: 0,
        lastDialogueId: sequence.rows.at(-1)!.id,
        lastDialogueIndex: sequence.rows.length - 1,
        entryDialogueId: sequence.rows[0].id,
        entryIndex: 0,
        exitDialogueId: null,
        exitIndex: null,
      };
    },
  );

  const participantByModelIndex = new Map(
    participants.map((participant) => [participant.modelIndex, participant]),
  );
  const participantsByNpcId = new Map<number, DialogueParticipant[]>();
  for (const participant of participants) {
    const values = participantsByNpcId.get(participant.id) ?? [];
    values.push(participant);
    participantsByNpcId.set(participant.id, values);
  }
  const lastSpeakerByNpcId = new Map<number, DialogueParticipant>();
  const rows = sequence.rows.map((row) => {
    const explicit =
      row.speakerModelIndex === null
        ? undefined
        : participantByModelIndex.get(row.speakerModelIndex);
    const candidates =
      row.npcId === null ? [] : (participantsByNpcId.get(row.npcId) ?? []);
    const participant =
      explicit?.id === row.npcId
        ? explicit
        : row.npcId === null
          ? undefined
          : (lastSpeakerByNpcId.get(row.npcId) ?? candidates[0]);
    if (participant && row.npcId !== null) {
      lastSpeakerByNpcId.set(row.npcId, participant);
    }
    return {
      ...row,
      speakerSlot: participant?.slot ?? row.speakerSlot,
    };
  });

  const participantRows = new Map<ParticipantSlot, number[]>();
  rows.forEach((row, index) => {
    if (row.speakerSlot) {
      const indexes = participantRows.get(row.speakerSlot) ?? [];
      indexes.push(index);
      participantRows.set(row.speakerSlot, indexes);
    }
  });
  const timedParticipants = participants.map((participant) => {
    const indexes = participantRows.get(participant.slot) ?? [];
    if (indexes.length === 0) {
      return participant;
    }
    const firstDialogueIndex = indexes[0];
    const lastDialogueIndex = indexes.at(-1)!;
    return {
      ...participant,
      firstDialogueId: rows[firstDialogueIndex].id,
      firstDialogueIndex,
      lastDialogueId: rows[lastDialogueIndex].id,
      lastDialogueIndex,
      entryDialogueId: rows[0].id,
      entryIndex: 0,
    };
  });

  warnings.push(
    `已读取 ${snapshot.blueprintAssetPath} 的 ${mapped.length} 个有效角色站位`,
  );
  return {
    sequence: {
      ...sequence,
      rows,
      participants: timedParticipants,
      warnings,
    },
    activeSlotCount: activeSlots.length,
    mappedSlotCount: mapped.length,
  };
}
