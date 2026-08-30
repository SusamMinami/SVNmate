import type {
  AdjacentDialogueContext,
  DialogueContentSearchResult,
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
import { getDialogueDatabaseIndex } from "./databaseIndex";

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
      canTurn: true,
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
  if (total <= 1) {
    return [0, 0, 0];
  }
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
  timelineRows: DialogueRow[];
  ignoredDialogueNodeCount: number;
  warnings: string[];
} {
  const index = getDialogueDatabaseIndex(database);

  const rows: DialogueRow[] = [];
  const timelineRows: DialogueRow[] = [];
  let ignoredDialogueNodeCount = 0;
  const warnings: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = startId;

  while (currentId) {
    if (visited.has(currentId)) {
      warnings.push(`检测到 NextID 循环：${currentId}`);
      break;
    }
    visited.add(currentId);
    const row = index.dialogueRowsById.get(currentId);
    if (!row) {
      warnings.push(`NextID ${currentId} 在对话表中不存在`);
      break;
    }
    timelineRows.push(row);
    if (row.state === 4) {
      ignoredDialogueNodeCount += 1;
    } else if (row.content && row.npcId !== null && row.npcId > 0) {
      rows.push(row);
    }
    if (row.isEnd || !row.nextId) {
      break;
    }
    currentId = row.nextId;
  }

  if (rows.length === 0) {
    const fallback = (index.dialogueRowsByPrefix.get(prefix) ?? [])
      .filter(
        (row) =>
          row.state !== 4 &&
          row.content &&
          row.npcId !== null &&
          row.npcId > 0,
      );
    if (fallback.length > 0) {
      warnings.push("开始节点无法形成链路，已按对话 ID 顺序预览");
      const fallbackTimeline =
        index.dialogueRowsByPrefix.get(prefix) ?? [];
      ignoredDialogueNodeCount = fallbackTimeline.filter(
        (row) => row.state === 4,
      ).length;
      return {
        rows: fallback,
        timelineRows: fallbackTimeline,
        ignoredDialogueNodeCount,
        warnings,
      };
    }
  }

  return { rows, timelineRows, ignoredDialogueNodeCount, warnings };
}

export function findDialogueTimeline(
  database: DialogueDatabase,
  rawDialogueId: string,
): DialogueRow[] {
  const dialogueId = rawDialogueId.trim();
  if (!/^\d{4,}$/.test(dialogueId)) {
    return [];
  }
  const prefix = dialogueId.slice(0, 4);
  const index = getDialogueDatabaseIndex(database);
  const starts = index.startsByPrefix.get(prefix) ?? [];
  const startId =
    starts.find((start) => start.id === dialogueId)?.id ??
    starts[0]?.id ??
    index.dialogueRowsById.get(dialogueId)?.id ??
    index.dialogueRowsByPrefix.get(prefix)?.[0]?.id;
  return startId
    ? followDialogueChain(database, startId, prefix).timelineRows
    : [];
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
  const index = getDialogueDatabaseIndex(database);
  const start = index.startsByPrefix.get(prefix)?.[0];
  const fallbackStart = index.dialogueRowsByPrefix.get(prefix)?.[0];
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

function buildDialogueSequence(
  database: DialogueDatabase,
  rawPrefix: string,
  requireTwoParticipants: boolean,
): DialogueSequence {
  const prefix = rawPrefix.trim();
  if (!/^\d{4}$/.test(prefix)) {
    throw new Error("请输入四位数对话 ID");
  }

  const index = getDialogueDatabaseIndex(database);
  const starts = index.startsByPrefix.get(prefix) ?? [];
  const fallbackStart = index.dialogueRowsByPrefix.get(prefix)?.[0];
  const startId = starts[0]?.id ?? fallbackStart?.id;
  if (!startId) {
    throw new Error(`没有找到对话 ID ${prefix}`);
  }

  const chain = followDialogueChain(database, startId, prefix);
  if (chain.rows.length === 0) {
    throw new Error(`对话 ${prefix} 没有可用于分镜的台词`);
  }

  const speakingParticipantIds = Array.from(
    new Set(chain.rows.map((row) => row.npcId).filter((id): id is number => id !== null)),
  );
  const participantIds = [
    1,
    ...speakingParticipantIds.filter((npcId) => npcId !== 1),
  ];
  const warnings = [...chain.warnings];
  if (chain.ignoredDialogueNodeCount > 0) {
    warnings.push(
      `已忽略 ${chain.ignoredDialogueNodeCount} 个关闭对话框 UI 节点；其隐藏内容不参与台词分析`,
    );
  }
  if (starts.length > 1) {
    warnings.push(`同一前缀存在 ${starts.length} 个开始节点，当前使用 ${startId}`);
  }
  if (participantIds.length > MAX_DIALOGUE_PARTICIPANTS) {
    throw new Error(
      `对话 ${prefix} 包含 ${participantIds.length} 位场内角色候选（含固定玩家），超过当前支持的 ${MAX_DIALOGUE_PARTICIPANTS} 位上限`,
    );
  }

  const selectedIds = participantIds;
  if (!speakingParticipantIds.includes(1)) {
    warnings.push("对话表没有玩家台词，已按固定 0 号角色补充玩家");
  }
  if (requireTwoParticipants && selectedIds.length < 2) {
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
    const speaksInDialogue = firstDialogueIndex >= 0;
    const resolvedFirstDialogueIndex = speaksInDialogue
      ? firstDialogueIndex
      : 0;
    const resolvedLastDialogueIndex = speaksInDialogue
      ? lastDialogueIndex
      : chain.rows.length - 1;
    const entryIndex =
      resolvedFirstDialogueIndex <= 1 ? 0 : resolvedFirstDialogueIndex;
    return {
      ...profileFor(database, npcId),
      instanceId: `npc:${npcId}`,
      slot,
      color: PARTICIPANT_COLORS[index],
      position: positionFor(index, selectedIds.length),
      facingTarget: [0, 0, -0.2],
      modelIndex: null,
      positionSource: "generated",
      firstDialogueId: chain.rows[resolvedFirstDialogueIndex].id,
      firstDialogueIndex: resolvedFirstDialogueIndex,
      lastDialogueId: chain.rows[resolvedLastDialogueIndex].id,
      lastDialogueIndex: resolvedLastDialogueIndex,
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
    ignoredDialogueNodeCount: chain.ignoredDialogueNodeCount,
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

export function findDialogueSequence(
  database: DialogueDatabase,
  rawPrefix: string,
): DialogueSequence {
  return buildDialogueSequence(database, rawPrefix, true);
}

export function searchDialogueContent(
  database: DialogueDatabase,
  rawQuery: string,
  maximumContexts = 100,
): DialogueContentSearchResult {
  const query = rawQuery.trim();
  if (!query) {
    throw new Error("请输入对话 ID 或对白内容");
  }
  const normalizedQuery = query.toLocaleLowerCase();
  const matches = getDialogueDatabaseIndex(database).searchableDialogueRows.flatMap(
    ({ row, normalizedContent }) =>
      normalizedContent.includes(normalizedQuery) ? [row] : [],
  );
  const matchesByPrefix = new Map<string, DialogueRow[]>();
  for (const row of matches) {
    const prefix = row.id.slice(0, 4);
    const prefixMatches = matchesByPrefix.get(prefix) ?? [];
    prefixMatches.push(row);
    matchesByPrefix.set(prefix, prefixMatches);
  }

  const contexts = Array.from(matchesByPrefix.entries())
    .sort(([left], [right]) => numericSort(left, right))
    .flatMap(([prefix, prefixMatches]) => {
      let sequence: DialogueSequence;
      try {
        sequence = buildDialogueSequence(database, prefix, false);
      } catch {
        return [];
      }
      const sequenceIds = new Set(sequence.rows.map((row) => row.id));
      const matchedDialogueIds = prefixMatches
        .map((row) => row.id)
        .filter((dialogueId) => sequenceIds.has(dialogueId));
      if (matchedDialogueIds.length === 0) {
        return [];
      }
      const contextDialogueIds = new Set<string>();
      for (const dialogueId of matchedDialogueIds) {
        const index = sequence.rows.findIndex((row) => row.id === dialogueId);
        for (
          let contextIndex = Math.max(0, index - 1);
          contextIndex <= Math.min(sequence.rows.length - 1, index + 1);
          contextIndex += 1
        ) {
          contextDialogueIds.add(sequence.rows[contextIndex].id);
        }
      }
      return [
        {
          prefix,
          sequence,
          matchedDialogueIds,
          contextDialogueIds: sequence.rows
            .filter((row) => contextDialogueIds.has(row.id))
            .map((row) => row.id),
        },
      ];
    });
  const normalizedMaximum = Math.max(1, Math.floor(maximumContexts));

  return {
    query,
    totalMatchCount: contexts.reduce(
      (total, context) => total + context.matchedDialogueIds.length,
      0,
    ),
    totalContextCount: contexts.length,
    truncated: contexts.length > normalizedMaximum,
    contexts: contexts.slice(0, normalizedMaximum),
  };
}
