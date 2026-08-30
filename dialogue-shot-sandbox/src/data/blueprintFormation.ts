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

export interface MissingBlueprintNpcModel {
  npcId: number;
  npcName: string;
  dialogueIds: string[];
  resourceId: number | null;
  expectedModelClassPath: string;
  reason: string;
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

interface ResolvedFormationSlot {
  slot: BlueprintFormationSnapshot["slots"][number];
  profile: NpcProfile;
  required: boolean;
}

function npcProfile(
  database: DialogueDatabase,
  sequence: DialogueSequence,
  npcId: number,
): NpcProfile | undefined {
  return (
    sequence.participants.find((participant) => participant.id === npcId) ??
    database.npcs.get(npcId)
  );
}

function profileMatchesSlot(
  database: DialogueDatabase,
  profile: NpcProfile,
  slot: BlueprintFormationSnapshot["slots"][number],
): boolean {
  if (profile.id === 1) {
    return slot.modelIndex === 0;
  }
  return matchesResource(
    slot.modelClassPath,
    profile.resourceId === null
      ? undefined
      : database.models.get(profile.resourceId),
  );
}

export function findMissingBlueprintNpcModels(
  database: DialogueDatabase,
  sequence: DialogueSequence,
  snapshot: BlueprintFormationSnapshot,
): MissingBlueprintNpcModel[] {
  const modelNames =
    snapshot.dialogueModels && snapshot.dialogueModels.length > 0
      ? snapshot.dialogueModels
      : sequence.formation?.modelNames ?? [];
  const activeSlots = snapshot.slots.filter((slot) => {
    if (modelNames.length === 0 || slot.modelIndex === 0) {
      return true;
    }
    const modelName = (modelNames[slot.modelIndex] ?? "").toLowerCase();
    return !["", "none", "null"].includes(modelName);
  });
  const rowsByNpcId = new Map<number, string[]>();
  for (const row of sequence.rows) {
    if (row.npcId === null || row.npcId === 1) {
      continue;
    }
    rowsByNpcId.set(row.npcId, [
      ...(rowsByNpcId.get(row.npcId) ?? []),
      row.id,
    ]);
  }
  return Array.from(rowsByNpcId, ([npcId, dialogueIds]) => {
    const profile = npcProfile(database, sequence, npcId);
    const resource =
      profile?.resourceId === null || profile?.resourceId === undefined
        ? undefined
        : database.models.get(profile.resourceId);
    const expectedModelClassPath =
      resource?.generatedClassPath.trim() ||
      resource?.configuredPath.trim() ||
      "";
    const issue = (reason: string): MissingBlueprintNpcModel => ({
      npcId,
      npcName: profile?.name ?? `NPC ${npcId}`,
      dialogueIds,
      resourceId: profile?.resourceId ?? null,
      expectedModelClassPath,
      reason,
    });
    if (!profile || !database.npcs.has(npcId)) {
      return issue("NPC 表中没有该角色");
    }
    if (profile.resourceId === null) {
      return issue("NPC 未配置模型资源 ID");
    }
    if (!resource) {
      return issue(`模型资源表中没有 ID ${profile.resourceId}`);
    }
    const explicitModelIndexes = new Set(
      sequence.rows.flatMap((row) =>
        row.npcId === npcId && row.speakerModelIndex !== null
          ? [row.speakerModelIndex]
          : [],
      ),
    );
    for (const modelIndex of explicitModelIndexes) {
      const explicitSlot = activeSlots.find(
        (slot) => slot.modelIndex === modelIndex,
      );
      if (
        explicitSlot &&
        !profileMatchesSlot(database, profile, explicitSlot)
      ) {
        return issue(
          `AM_Talk 指向 BP 槽位 ${modelIndex}，但该槽模型与 NPC 不一致`,
        );
      }
    }
    if (
      activeSlots.some((slot) =>
        profileMatchesSlot(database, profile, slot),
      )
    ) {
      return null;
    }
    return issue("当前 BP 没有对应的角色模型槽");
  }).filter((issue): issue is MissingBlueprintNpcModel => issue !== null);
}

function distanceSquared(
  left: BlueprintFormationSnapshot["slots"][number],
  right: BlueprintFormationSnapshot["slots"][number],
): number {
  const dx = left.transform.location.x - right.transform.location.x;
  const dy = left.transform.location.y - right.transform.location.y;
  const dz = left.transform.location.z - right.transform.location.z;
  return dx * dx + dy * dy + dz * dz;
}

function selectFormationSlots(
  resolvedSlots: ResolvedFormationSlot[],
  warnings: string[],
): ResolvedFormationSlot[] {
  if (resolvedSlots.length <= MAX_DIALOGUE_PARTICIPANTS) {
    return resolvedSlots;
  }

  const required = resolvedSlots.filter((item) => item.required);
  if (required.length > MAX_DIALOGUE_PARTICIPANTS) {
    throw new Error(
      `BP 中需要保留 ${required.length} 个对话角色实例，超过当前支持的 ${MAX_DIALOGUE_PARTICIPANTS} 位上限`,
    );
  }
  const background = resolvedSlots
    .filter((item) => !item.required)
    .map((item) => ({
      item,
      distance: Math.min(
        ...required.map((anchor) => distanceSquared(item.slot, anchor.slot)),
      ),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.item.slot.modelIndex - right.item.slot.modelIndex,
    );
  const selected = [
    ...required,
    ...background
      .slice(0, MAX_DIALOGUE_PARTICIPANTS - required.length)
      .map(({ item }) => item),
  ].sort((left, right) => left.slot.modelIndex - right.slot.modelIndex);
  const omittedCount = resolvedSlots.length - selected.length;
  warnings.push(
    `BP 有 ${resolvedSlots.length} 个有效角色槽，已优先保留 ${required.length} 个对话角色槽和距离最近的 ${selected.length - required.length} 个背景槽；省略 ${omittedCount} 个背景槽`,
  );
  return selected;
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
    .sort((left, right) => left.modelIndex - right.modelIndex);
  const playerSlot = activeSlots.find((slot) => slot.modelIndex === 0);
  if (!playerSlot) {
    throw new Error("Formation BP 缺少固定的 0 号玩家槽位");
  }
  const activeSlotByIndex = new Map(
    activeSlots.map((slot) => [slot.modelIndex, slot]),
  );
  const requiredProfiles = new Map<number, NpcProfile>();
  for (const row of sequence.rows) {
    if (row.npcId === null || requiredProfiles.has(row.npcId)) {
      continue;
    }
    const profile = npcProfile(database, sequence, row.npcId);
    if (!profile) {
      throw new Error(
        `对话节点 ${row.id} 的 NPC ${row.npcId} 在 NPC 表中不存在，无法校验 BP 角色`,
      );
    }
    requiredProfiles.set(row.npcId, profile);
  }

  const requiredProfileByModelIndex = new Map<number, NpcProfile>();
  requiredProfileByModelIndex.set(
    0,
    npcProfile(database, sequence, 1) ??
      profileCandidates(
        database,
        sequence,
        0,
        modelNames[0] ?? "",
        playerSlot.modelClassPath,
      )[0],
  );
  for (const [modelIndex, npcIds] of explicitNpcIds) {
    if (npcIds.size !== 1) {
      throw new Error(
        `BP 槽位 ${modelIndex} 同时被多个 NPC 的 AM_Talk 引用，无法确认说话角色`,
      );
    }
    const slot = activeSlotByIndex.get(modelIndex);
    const npcId = Array.from(npcIds)[0];
    const profile = npcProfile(database, sequence, npcId);
    if (!slot) {
      warnings.push(
        `对话 NPC ${profile?.name ?? npcId}（${npcId}）的 AM_Talk 槽位 ${modelIndex} 在当前 BP 中不可用，已改按模型路径匹配`,
      );
      continue;
    }
    if (!profile || !profileMatchesSlot(database, profile, slot)) {
      throw new Error(
        `对话 NPC ${profile?.name ?? npcId}（${npcId}）与 AM_Talk 指向的 BP 槽位 ${modelIndex} 模型不一致`,
      );
    }
    requiredProfileByModelIndex.set(modelIndex, profile);
  }

  for (const profile of requiredProfiles.values()) {
    if (
      Array.from(requiredProfileByModelIndex.values()).some(
        (candidate) => candidate.id === profile.id,
      )
    ) {
      continue;
    }
    const matchingSlots = activeSlots.filter(
      (slot) =>
        !requiredProfileByModelIndex.has(slot.modelIndex) &&
        profileMatchesSlot(database, profile, slot),
    );
    if (matchingSlots.length === 0) {
      throw new Error(
        `BP 未找到与对话 NPC ${profile.name}（${profile.id}）模型一致的角色槽`,
      );
    }
    const sameModelProfiles = Array.from(requiredProfiles.values()).filter(
      (candidate) =>
        candidate.id !== profile.id &&
        matchingSlots.some((slot) =>
          profileMatchesSlot(database, candidate, slot),
        ) &&
        !Array.from(requiredProfileByModelIndex.values()).some(
          (assigned) => assigned.id === candidate.id,
        ),
    );
    if (sameModelProfiles.length > 0) {
      throw new Error(
        `对话 NPC ${[profile, ...sameModelProfiles]
          .map((candidate) => `${candidate.name}（${candidate.id}）`)
          .join("、")} 共用同一模型且没有 AM_Talk 槽位，无法安全区分`,
      );
    }
    const selectedSlot = matchingSlots[0];
    requiredProfileByModelIndex.set(selectedSlot.modelIndex, profile);
    if (matchingSlots.length > 1) {
      warnings.push(
        `对话 NPC ${profile.name}（${profile.id}）的模型对应多个 BP 槽位（${matchingSlots
          .map((slot) => slot.modelIndex)
          .join("、")}），未配置 AM_Talk 时使用 ${selectedSlot.modelIndex} 号槽`,
      );
    }
  }

  const unresolvedRequiredProfiles = Array.from(requiredProfiles.values()).filter(
    (profile) =>
      !Array.from(requiredProfileByModelIndex.values()).some(
        (candidate) => candidate.id === profile.id,
      ),
  );
  if (unresolvedRequiredProfiles.length > 0) {
    throw new Error(
      `BP 无法绑定对话角色：${unresolvedRequiredProfiles
        .map((profile) => `${profile.name}（${profile.id}）`)
        .join("、")}`,
    );
  }

  const resolvedSlots = activeSlots.map((slot): ResolvedFormationSlot => {
    const modelName = modelNames[slot.modelIndex] ?? "";
    const requiredProfile = requiredProfileByModelIndex.get(slot.modelIndex);
    const backgroundCandidates = requiredProfile
      ? []
      : profileCandidates(
          database,
          sequence,
          slot.modelIndex,
          modelName,
          slot.modelClassPath,
        ).filter((candidate) => !speakingNpcIds.has(candidate.id));
    const profile =
      requiredProfile ??
      (backgroundCandidates.length === 1
        ? backgroundCandidates[0]
        : undefined) ??
      placeholderProfile(slot.modelIndex, modelName, slot.modelClassPath);
    return {
      slot,
      profile,
      required: requiredProfile !== undefined,
    };
  });
  const mapped = selectFormationSlots(resolvedSlots, warnings);
  for (const { slot, profile } of mapped) {
    if (profile.id >= 2_000_000_000) {
      const modelName = modelNames[slot.modelIndex] ?? "";
      warnings.push(
        `BP 槽位 ${slot.modelIndex}（${modelName || slot.modelClassPath}）无法映射 NPC 表，已作为场内未识别角色保留`,
      );
    }
  }

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
    if (row.npcId !== null && !participant) {
      throw new Error(
        `对话节点 ${row.id} 的 NPC ${row.npcId} 未绑定到 BP 角色槽`,
      );
    }
    if (participant && row.npcId !== null) {
      lastSpeakerByNpcId.set(row.npcId, participant);
    }
    return {
      ...row,
      speakerSlot: participant?.slot ?? null,
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
