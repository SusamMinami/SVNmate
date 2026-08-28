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
  return false;
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
  modelIndex: number,
  modelName: string,
  modelClassPath: string,
): NpcProfile[] {
  if (
    modelIndex === 0 ||
    modelName.trim().toLowerCase() === "player" ||
    normalizedAssetPath(modelClassPath).endsWith(
      "/seria/characters/eric/bp_eric",
    )
  ) {
    return [
      sequence.participants.find((participant) => participant.id === 1) ??
        database.npcs.get(1) ?? {
          id: 1,
          name: "玩家",
          note: "玩家角色",
          introduction: "由玩家控制的对话参与者",
          resourceId: null,
          canTurn: true,
        },
    ];
  }
  const speakingIds = new Set(
    sequence.participants.map((participant) => participant.id),
  );
  const profiles = new Map<number, NpcProfile>(
    Array.from(database.npcs.entries()),
  );
  for (const participant of sequence.participants) {
    profiles.set(participant.id, participant);
  }
  return Array.from(profiles.values())
    .filter((participant) =>
      matchesResource(
        modelClassPath,
        participant.resourceId === null
          ? undefined
          : database.models.get(participant.resourceId),
      ),
    )
    .sort(
      (left, right) =>
        Number(speakingIds.has(right.id)) -
          Number(speakingIds.has(left.id)) ||
        left.id - right.id,
    );
}

function placeholderProfile(
  modelIndex: number,
  modelName: string,
  modelClassPath: string,
): NpcProfile {
  const className =
    normalizedAssetPath(modelClassPath).split("/").at(-1) ?? "";
  const fallbackName = className.replace(/^bp_/i, "") || `槽位 ${modelIndex}`;
  return {
    id: 2_000_000_000 + modelIndex,
    name:
      modelName && modelName.toLowerCase() !== "none"
        ? modelName
        : fallbackName,
    note: `BP 槽位 ${modelIndex} 尚未映射 NPC 表`,
    introduction: "该角色来自 Formation BP，当前没有可用的 NPC 资料",
    resourceId: null,
    canTurn: true,
  };
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
  const modelNames =
    snapshot.dialogueModels && snapshot.dialogueModels.length > 0
      ? snapshot.dialogueModels
      : sequence.formation?.modelNames ?? [];
  const explicitNpcIds = explicitNpcIdsByModelIndex(sequence);
  const speakingNpcIds = new Set(
    sequence.participants.map((participant) => participant.id),
  );
  const warnings = [...sequence.warnings, ...snapshot.warnings];
  const activeSlots = snapshot.slots
    .filter((slot) => {
      if (modelNames.length === 0 || slot.modelIndex === 0) {
        return true;
      }
      const modelName = (modelNames[slot.modelIndex] ?? "").toLowerCase();
      return !["", "none", "null"].includes(modelName);
    })
    .sort((left, right) => left.modelIndex - right.modelIndex)
    .slice(0, MAX_DIALOGUE_PARTICIPANTS);
  if (!activeSlots.some((slot) => slot.modelIndex === 0)) {
    throw new Error("Formation BP 缺少固定的 0 号玩家槽位");
  }
  if (snapshot.slots.length > MAX_DIALOGUE_PARTICIPANTS) {
    warnings.push(
      `BP 包含 ${snapshot.slots.length} 个数字角色槽，当前最多读取前 ${MAX_DIALOGUE_PARTICIPANTS} 个`,
    );
  }
  const mapped = activeSlots.map((slot) => {
    const modelName = modelNames[slot.modelIndex] ?? "";
    const candidates = profileCandidates(
      database,
      sequence,
      slot.modelIndex,
      modelName,
      slot.modelClassPath,
    );
    const explicitIds = explicitNpcIds.get(slot.modelIndex);
    const explicitCandidates = explicitIds
      ? Array.from(explicitIds).flatMap((npcId) => {
          const profile =
            sequence.participants.find(
              (participant) => participant.id === npcId,
            ) ?? database.npcs.get(npcId);
          return profile ? [profile] : [];
        })
      : [];
    const speakingCandidates = candidates.filter((candidate) =>
      speakingNpcIds.has(candidate.id),
    );
    const profile =
      explicitCandidates[0] ??
      (speakingCandidates.length === 1
        ? speakingCandidates[0]
        : candidates.length === 1
          ? candidates[0]
          : undefined) ??
      placeholderProfile(slot.modelIndex, modelName, slot.modelClassPath);
    if (profile.id >= 2_000_000_000) {
      warnings.push(
        `BP 槽位 ${slot.modelIndex}（${modelName || slot.modelClassPath}）无法映射 NPC 表，已作为场内未识别角色保留`,
      );
    }
    return { slot, profile };
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
        modelClassPath: formationSlot.modelClassPath,
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
