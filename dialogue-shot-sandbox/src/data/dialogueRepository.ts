import type {
  AdjacentDialogueContext,
  DialogueCameraKeyframe,
  DialogueDatabase,
  DialogueParticipant,
  DialogueRow,
  DialogueSequence,
  NpcProfile,
  Vec3,
} from "../types";
import {
  MAX_DIALOGUE_PARTICIPANTS,
  PARTICIPANT_SLOTS,
} from "../types";

export const PARTICIPANT_COLORS = [
  "#e85d47",
  "#268bd2",
  "#2f9d68",
  "#d69024",
  "#8a63c7",
  "#16a0a5",
  "#cc4f87",
  "#64748b",
  "#a06b3b",
  "#4f72c4",
  "#6f8f32",
  "#b94a5b",
] as const;

function numericSort(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function profileFor(database: DialogueDatabase, npcId: number): NpcProfile {
  if (npcId === 1) {
    return {
      id: 1,
      name: "玩家",
      note: "玩家角色",
      introduction: "由玩家控制的对话参与者",
      resourceId: null,
    };
  }
  return (
    database.npcs.get(npcId) ?? {
      id: npcId,
      name: `NPC ${npcId}`,
      note: "未在 NPC 表中找到",
      introduction: "",
      resourceId: null,
    }
  );
}

function positionFor(index: number, total: number): Vec3 {
  if (total === 2) {
    return index === 0 ? [-1.35, 0, 0] : [1.35, 0, 0];
  }
  const width = Math.min(7.6, Math.max(3.2, (total - 1) * 1.35));
  const x = -width / 2 + (width * index) / (total - 1);
  const normalizedX = Math.abs((x * 2) / width);
  const z = -0.72 + normalizedX * 0.92;
  return [
    Number(x.toFixed(2)),
    0,
    Number(z.toFixed(2)),
  ];
}

function followDialogueChain(
  database: DialogueDatabase,
  startId: string,
  prefix: string,
): {
  rows: DialogueRow[];
  cameraKeyframes: DialogueCameraKeyframe[];
  warnings: string[];
} {
  const rowsById = new Map<string, DialogueRow>();
  database.dialogueRows.forEach((row) => {
    if (!rowsById.has(row.id)) {
      rowsById.set(row.id, row);
    }
  });

  const timeline: DialogueRow[] = [];
  const warnings: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = startId;

  while (currentId) {
    if (visited.has(currentId)) {
      warnings.push(`检测到 NextID 循环：${currentId}`);
      break;
    }
    visited.add(currentId);
    const row = rowsById.get(currentId);
    if (!row) {
      warnings.push(`NextID ${currentId} 在对话表中不存在`);
      break;
    }
    if (
      row.nodeKind === "camera_keyframe" ||
      (row.content && row.npcId !== null && row.npcId > 0)
    ) {
      timeline.push(row);
    }
    if (row.isEnd || !row.nextId) {
      break;
    }
    currentId = row.nextId;
  }

  let result = splitDialogueTimeline(timeline);
  if (result.rows.length === 0) {
    const fallbackTimeline = database.dialogueRows
      .filter(
        (row) =>
          row.id.startsWith(prefix) &&
          (row.nodeKind === "camera_keyframe" ||
            (row.content && row.npcId !== null && row.npcId > 0)),
      )
      .sort((left, right) => numericSort(left.id, right.id));
    const fallback = splitDialogueTimeline(fallbackTimeline);
    if (fallback.rows.length > 0) {
      warnings.push("开始节点无法形成链路，已按对话 ID 顺序预览");
      result = fallback;
    }
  }

  return { ...result, warnings };
}

function splitDialogueTimeline(rows: DialogueRow[]): {
  rows: DialogueRow[];
  cameraKeyframes: DialogueCameraKeyframe[];
} {
  const dialogueRows: DialogueRow[] = [];
  const cameraKeyframes: DialogueCameraKeyframe[] = [];
  let previousDialogueId: string | null = null;
  let pendingKeyframes: DialogueCameraKeyframe[] = [];

  for (const row of rows) {
    if (row.nodeKind === "camera_keyframe") {
      const keyframe: DialogueCameraKeyframe = {
        dialogueId: row.id,
        rowNumber: row.rowNumber,
        previousDialogueId,
        nextDialogueId: null,
        hasCameraInstruction: Boolean(
          row.cameraPosition || row.cameraMoveString,
        ),
        hasCharacterAction: Boolean(row.characterBehaviourString),
      };
      cameraKeyframes.push(keyframe);
      pendingKeyframes.push(keyframe);
      continue;
    }
    if (!row.content || row.npcId === null || row.npcId <= 0) {
      continue;
    }
    for (const keyframe of pendingKeyframes) {
      keyframe.nextDialogueId = row.id;
    }
    pendingKeyframes = [];
    dialogueRows.push(row);
    previousDialogueId = row.id;
  }

  return { rows: dialogueRows, cameraKeyframes };
}

function adjacentPrefix(prefix: string, offset: -1 | 1): string | null {
  const value = Number.parseInt(prefix, 10) + offset;
  if (value < 0 || value > 9_999) {
    return null;
  }
  return String(value).padStart(4, "0");
}

function contextForPrefix(
  database: DialogueDatabase,
  prefix: string | null,
): AdjacentDialogueContext | null {
  if (!prefix) {
    return null;
  }
  const start = database.starts
    .filter((item) => item.id.startsWith(prefix))
    .sort((left, right) => numericSort(left.id, right.id))[0];
  const fallbackStart = database.dialogueRows
    .filter((row) => row.id.startsWith(prefix))
    .sort((left, right) => numericSort(left.id, right.id))[0];
  const startId = start?.id ?? fallbackStart?.id;
  if (!startId) {
    return null;
  }
  const chain = followDialogueChain(database, startId, prefix);
  if (chain.rows.length === 0) {
    return null;
  }
  return {
    prefix,
    startId,
    outline: start?.outline ?? "",
    dialogue: chain.rows.map((row) => {
      const profile = profileFor(database, row.npcId!);
      return {
        dialogueId: row.id,
        npcId: profile.id,
        speakerName: profile.name,
        content: row.content,
      };
    }),
  };
}

export function findDialogueSequence(
  database: DialogueDatabase,
  rawPrefix: string,
): DialogueSequence {
  const prefix = rawPrefix.trim();
  if (!/^\d{4}$/.test(prefix)) {
    throw new Error("请输入四位数对话 ID");
  }

  const starts = database.starts
    .filter((start) => start.id.startsWith(prefix))
    .sort((left, right) => numericSort(left.id, right.id));
  const fallbackStart = database.dialogueRows
    .filter((row) => row.id.startsWith(prefix))
    .sort((left, right) => numericSort(left.id, right.id))[0];
  const startId = starts[0]?.id ?? fallbackStart?.id;
  if (!startId) {
    throw new Error(`没有找到对话 ID ${prefix}`);
  }

  const chain = followDialogueChain(database, startId, prefix);
  if (chain.rows.length === 0) {
    throw new Error(`对话 ${prefix} 没有可用于分镜的台词`);
  }

  const participantIds = Array.from(
    new Set(chain.rows.map((row) => row.npcId).filter((id): id is number => id !== null)),
  );
  const warnings = [...chain.warnings];
  if (chain.cameraKeyframes.length > 0) {
    warnings.push(
      `已识别 ${chain.cameraKeyframes.length} 个关闭对话框 UI 镜头关键帧；其隐藏文本不参与台词分析，原有镜头配置将在导出时保留`,
    );
  }
  if (starts.length > 1) {
    warnings.push(`同一前缀存在 ${starts.length} 个开始节点，当前使用 ${startId}`);
  }
  if (participantIds.length > MAX_DIALOGUE_PARTICIPANTS) {
    warnings.push(
      `检测到 ${participantIds.length} 位说话人，当前最多展示前 ${MAX_DIALOGUE_PARTICIPANTS} 位`,
    );
  }

  const selectedIds = participantIds.slice(0, MAX_DIALOGUE_PARTICIPANTS);
  if (selectedIds.length === 1 && selectedIds[0] !== 1) {
    selectedIds.push(1);
    warnings.push("仅检测到一位说话人，已补充玩家作为对景角色");
  }
  if (selectedIds.length < 2) {
    throw new Error(`对话 ${prefix} 至少需要两位可识别的对话参与者`);
  }

  const participants: DialogueParticipant[] = selectedIds.map((npcId, index) => {
    const slot = PARTICIPANT_SLOTS[index];
    const firstDialogueIndex = chain.rows.findIndex(
      (row) => row.npcId === npcId,
    );
    const lastDialogueIndex = chain.rows.reduce(
      (lastIndex, row, rowIndex) =>
        row.npcId === npcId ? rowIndex : lastIndex,
      -1,
    );
    const entryIndex = firstDialogueIndex <= 1 ? 0 : firstDialogueIndex;
    return {
      ...profileFor(database, npcId),
      instanceId: `npc:${npcId}`,
      slot,
      color: PARTICIPANT_COLORS[index],
      position: positionFor(index, selectedIds.length),
      facingTarget: [0, 0, -0.2],
      modelIndex: null,
      positionSource: "generated",
      firstDialogueId: chain.rows[firstDialogueIndex].id,
      firstDialogueIndex,
      lastDialogueId: chain.rows[lastDialogueIndex].id,
      lastDialogueIndex,
      entryDialogueId: chain.rows[entryIndex].id,
      entryIndex,
      exitDialogueId: null,
      exitIndex: null,
    };
  });
  const participantByNpcId = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  const sequenceRows = chain.rows
    .filter((row) => selectedIds.includes(row.npcId ?? -1))
    .map((row) => ({
      ...row,
      speakerSlot:
        row.npcId === null
          ? null
          : (participantByNpcId.get(row.npcId)?.slot ?? null),
    }));

  return {
    prefix,
    startId,
    outline: starts[0]?.outline ?? "",
    rows: sequenceRows,
    cameraKeyframes: chain.cameraKeyframes,
    participants,
    adjacentContext: {
      previous: contextForPrefix(
        database,
        adjacentPrefix(prefix, -1),
      ),
      next: contextForPrefix(database, adjacentPrefix(prefix, 1)),
    },
    warnings,
    formation:
      starts[0]?.formationClassPath || starts[0]?.modelNames.length
        ? {
            classPath: starts[0]?.formationClassPath ?? "",
            modelNames: starts[0]?.modelNames ?? [],
          }
        : null,
  };
}
