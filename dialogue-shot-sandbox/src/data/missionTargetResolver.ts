import type {
  DialogueDatabase,
  MissionPositionRow,
  MissionTargetDialogueReference,
  MissionTargetPreviewPlan,
  MissionTargetPreviewTarget,
  NpcProfile,
  UnrealTransform,
} from "../types";
import { getDialogueDatabaseIndex } from "./databaseIndex";

export function sortMissionTargetsByDialogueFrequency(
  database: DialogueDatabase,
  dialogueId: string | null | undefined,
  targets: readonly MissionTargetPreviewTarget[],
): MissionTargetPreviewTarget[] {
  const normalizedDialogueId = dialogueId?.trim() ?? "";
  if (!/^\d{4,}$/.test(normalizedDialogueId)) {
    return [...targets];
  }

  const index = getDialogueDatabaseIndex(database);
  if (!index.dialogueRowsById.has(normalizedDialogueId)) {
    return [...targets];
  }

  const speechCountByNpcId = new Map<number, number>();
  const visited = new Set<string>();
  let currentId: string | null = normalizedDialogueId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const row = index.dialogueRowsById.get(currentId);
    if (!row) {
      break;
    }
    if (
      row.state !== 4 &&
      row.content &&
      row.npcId !== null &&
      row.npcId > 0
    ) {
      speechCountByNpcId.set(
        row.npcId,
        (speechCountByNpcId.get(row.npcId) ?? 0) + 1,
      );
    }
    currentId = row.isEnd ? null : row.nextId;
  }

  return targets
    .map((target, index) => ({
      target,
      index,
      speechCount:
        target.npcId !== null && target.npcId > 0
          ? (speechCountByNpcId.get(target.npcId) ?? 0)
          : 0,
    }))
    .sort(
      (left, right) =>
        right.speechCount - left.speechCount ||
        left.index - right.index,
    )
    .map(({ target }) => target);
}

function parseTargetIds(taskId: string, rawValue: string): string[] {
  const rawIds = rawValue.split(",");
  if (!rawValue.trim()) {
    throw new Error(`任务节点 ${taskId} 没有配置显示目标物`);
  }
  if (
    rawIds.some((value) => {
      const id = value.trim();
      return !/^\d+$/.test(id) || id === "0";
    })
  ) {
    throw new Error(
      `任务节点 ${taskId} 的显示目标物格式无效：${rawValue}`,
    );
  }
  const ids = rawIds.map((value) => value.trim());
  const seenIds = new Set<string>();
  const duplicateIds = Array.from(
    new Set(
      ids.filter((id) => {
        if (seenIds.has(id)) {
          return true;
        }
        seenIds.add(id);
        return false;
      }),
    ),
  );
  if (duplicateIds.length > 0) {
    throw new Error(
      `任务节点 ${taskId} 的显示目标物存在重复 ID：${duplicateIds.join("、")}`,
    );
  }
  return ids;
}

function parseStruct(
  target: MissionPositionRow,
  value: string,
  fields: readonly string[],
  label: string,
): Record<string, number> {
  const matches = Array.from(
    value.matchAll(
      /([A-Za-z]+)\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/g,
    ),
  );
  const values = new Map(
    matches.map((match) => [match[1].toLowerCase(), Number(match[2])]),
  );
  const missing = fields.filter(
    (field) => !Number.isFinite(values.get(field.toLowerCase())),
  );
  if (missing.length > 0) {
    throw new Error(
      `目标物 ${target.id} 的${label}无效：${value || "空值"}`,
    );
  }
  return Object.fromEntries(
    fields.map((field) => [field, values.get(field.toLowerCase())!]),
  );
}

function transformFor(target: MissionPositionRow): UnrealTransform {
  const position = parseStruct(
    target,
    target.positionText,
    ["x", "y", "z"],
    "坐标",
  );
  const rotation = parseStruct(
    target,
    target.rotationText,
    ["pitch", "yaw", "roll"],
    "旋转",
  );
  return {
    location: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    rotation: {
      pitch: rotation.pitch,
      yaw: rotation.yaw,
      roll: rotation.roll,
    },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function generatedClassPath(configuredPath: string): string {
  const path = configuredPath.trim().replaceAll("\\", "/");
  if (!path || path.endsWith("_C")) {
    return path;
  }
  if (path.includes(".")) {
    return `${path}_C`;
  }
  const assetName = path.split("/").at(-1);
  return assetName ? `${path}.${assetName}_C` : "";
}

function ambientDialoguesFor(
  target: MissionPositionRow,
  npc: NpcProfile | undefined,
): MissionTargetDialogueReference[] {
  const references = new Map<string, MissionTargetDialogueReference>();
  const addReferences = (
    kind: MissionTargetDialogueReference["kind"],
    dialogueIds: readonly string[],
    source: MissionTargetDialogueReference["sources"][number],
  ) => {
    for (const dialogueId of dialogueIds) {
      const dialogueFileId = dialogueId.slice(0, 4);
      const key = `${kind}:${dialogueFileId}`;
      const existing = references.get(key);
      if (existing) {
        if (!existing.sources.includes(source)) {
          existing.sources.push(source);
        }
        continue;
      }
      references.set(key, {
        kind,
        dialogueFileId,
        sources: [source],
      });
    }
  };

  addReferences(
    "complex_chat",
    npc?.complexChatDialogueIds ?? [],
    "NPC.npcchat2",
  );
  addReferences(
    "complex_chat",
    target.complexChatDialogueIds ?? [],
    "MissionPosition.npcchat2",
  );
  addReferences(
    "bubble",
    npc?.bubbleDialogueIds ?? [],
    "NPC.npcchat3",
  );
  return Array.from(references.values());
}

export function resolveMissionTargets(
  database: DialogueDatabase,
  rawTaskId: string,
): MissionTargetPreviewPlan {
  const taskId = rawTaskId.trim();
  if (!/^\d+$/.test(taskId)) {
    throw new Error("请输入有效的数字任务节点 ID");
  }
  if (
    database.missionRows.length === 0 ||
    database.missionPositions.length === 0 ||
    database.mapConfigs.length === 0
  ) {
    throw new Error(
      "当前数据源缺少任务表、目标物表或地图配置表，请重新选择完整 doc 目录",
    );
  }

  const index = getDialogueDatabaseIndex(database);
  const taskMatches = index.missionRowsById.get(taskId) ?? [];
  if (taskMatches.length === 0) {
    throw new Error(`没有找到任务节点 ${taskId}`);
  }
  if (taskMatches.length > 1) {
    const sources = taskMatches.map((task) => task.source).join("、");
    throw new Error(
      `任务节点 ${taskId} 同时存在于 ${sources}，已停止加载`,
    );
  }
  const task = taskMatches[0];
  const targetIds = parseTargetIds(taskId, task.showTargetIds);
  const targets = targetIds.map((targetId) => {
    const matches = index.missionPositionsById.get(targetId) ?? [];
    if (matches.length === 0) {
      throw new Error(
        `任务节点 ${taskId} 引用了不存在的目标物 ${targetId}`,
      );
    }
    if (matches.length > 1) {
      throw new Error(`目标物 ${targetId} 存在重复配置，已停止加载`);
    }
    return matches[0];
  });

  const invalidMapTarget = targets.find(
    (target) => !/^\d+$/.test(target.mapId) || target.mapId === "0",
  );
  if (invalidMapTarget) {
    throw new Error(
      `目标物 ${invalidMapTarget.id} 的 MapID 无效，已停止加载`,
    );
  }
  const mapIds = Array.from(new Set(targets.map((target) => target.mapId)));
  if (mapIds.length !== 1) {
    const details = targets
      .map((target) => `${target.id}:${target.mapId || "空"}`)
      .join("，");
    throw new Error(
      `任务节点 ${taskId} 的目标物 MapID 不一致（${details}），请检查配置后重试`,
    );
  }

  const mapId = mapIds[0];
  const mapMatches = index.mapConfigsById.get(mapId) ?? [];
  if (mapMatches.length === 0) {
    throw new Error(`MapID ${mapId} 在地图配置表中不存在`);
  }
  if (mapMatches.length > 1) {
    throw new Error(`MapID ${mapId} 在地图配置表中存在重复配置`);
  }
  const map = mapMatches[0];
  if (!map.assetPath.startsWith("/Game/")) {
    throw new Error(
      `MapID ${mapId} 没有可用于打开关卡的地图资源路径`,
    );
  }

  const warnings: string[] = [];
  const resolvedTargets = targets.map((target) => {
    const npc =
      target.npcId !== null && target.npcId > 0
        ? database.npcs.get(target.npcId)
        : undefined;
    if (target.npcId !== null && target.npcId > 0 && !npc) {
      warnings.push(
        `目标物 ${target.id} 引用了不存在的 NPC ${target.npcId}，将使用定位标记`,
      );
    }
    const modelId =
      target.blueprintModelId !== null && target.blueprintModelId > 0
        ? target.blueprintModelId
        : npc?.resourceId ?? null;
    const model =
      modelId !== null && modelId > 0
        ? database.models.get(modelId)
        : undefined;
    if (modelId !== null && modelId > 0 && !model) {
      warnings.push(
        `目标物 ${target.id} 引用了不存在的模型资源 ${modelId}，将使用定位标记`,
      );
    }
    const modelClassPath = model
      ? model.generatedClassPath ||
        generatedClassPath(model.configuredPath)
      : "";
    if (target.type === 1 && !modelClassPath) {
      warnings.push(
        `NPC 目标物 ${target.id} 没有可加载的模型资源，将使用定位标记`,
      );
    }
    return {
      targetId: target.id,
      type: target.type,
      description: target.description,
      npcId: target.npcId,
      npcName: npc?.name ?? "",
      modelId,
      modelClassPath,
      itemId: target.itemId,
      blueprintModelId: target.blueprintModelId,
      mapId: target.mapId,
      previewKind: modelClassPath ? "asset" as const : "marker" as const,
      transform: transformFor(target),
      ambientDialogues: ambientDialoguesFor(target, npc),
    };
  });

  return {
    taskId: task.id,
    taskName: task.name,
    taskSource: task.source,
    mapId,
    mapName: map.name,
    mapAssetPath: map.assetPath,
    targets: resolvedTargets,
    warnings,
  };
}
