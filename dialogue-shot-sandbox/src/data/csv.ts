import Papa from "papaparse";
import type {
  DialogueDatabase,
  DialogueRow,
  DialogueStart,
  MapConfigRow,
  MissionPositionRow,
  MissionTaskRow,
  ModelResource,
  NpcProfile,
} from "../types";

const DIALOGUE_FILENAME = "对话表.csv";
const START_FILENAME = "对话表_开始节点.csv";
const NPC_FILENAME = "NPC表.csv";
const MODEL_FILENAME = "m模型资源表.csv";
const MISSION_FILENAME = "任务表.csv";
const DUNGEON_MISSION_FILENAME = "副本任务表.csv";
const MISSION_POSITION_FILENAME = "m目标物表.csv";
const MAP_CONFIG_FILENAME = "d地图配置表.csv";
const MAP_RESOURCE_FILENAME = "d地图资源表.csv";

type CsvMatrix = string[][];

function parseMatrix(filename: string, text: string): CsvMatrix {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
  });
  if (result.errors.length > 0) {
    const first = result.errors[0];
    const rowNumber = (first.row ?? 0) + 1;
    throw new Error(`${filename} 第 ${rowNumber} 行解析失败：${first.message}`);
  }
  const rows = result.data.map((row) => row.map((cell) => String(cell ?? "")));
  if (rows.length < 2) {
    throw new Error(`${filename} 缺少双表头`);
  }
  return rows;
}

function normalizeMember(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().replace(/^##&/, "");
}

function indexesFor(
  filename: string,
  members: string[],
  required: string[],
): Map<string, number> {
  const normalized = members.map(normalizeMember);
  const indexes = new Map<string, number>();
  for (const member of required) {
    const index = normalized.indexOf(member);
    if (index < 0) {
      throw new Error(`${filename} 缺少必需字段：${member}`);
    }
    indexes.set(member, index);
  }
  return indexes;
}

function valueAt(row: string[], indexes: Map<string, number>, member: string): string {
  return (row[indexes.get(member) ?? -1] ?? "").trim();
}

function optionalIndex(members: string[], member: string): number {
  return members.map(normalizeMember).indexOf(member);
}

function optionalValueAt(row: string[], index: number): string {
  return index < 0 ? "" : (row[index] ?? "").trim();
}

function optionalInteger(value: string): number | null {
  if (!/^-?\d+$/.test(value)) {
    return null;
  }
  return Number.parseInt(value, 10);
}

function optionalBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return null;
}

function firstReference(value: string): string | null {
  return value.match(/(?<!\d)\d+(?!\d)/)?.[0] ?? null;
}

function speakerModelIndex(value: string): number | null {
  const matches = value
    .split(";")
    .flatMap((item, index) =>
      /(?:^|\|)[^,]*,AM_Talk(?:,|$)/i.test(item) ? [index] : [],
    );
  return matches.length === 1 ? matches[0] : null;
}

function parseDialogues(text: string): DialogueRow[] {
  const rows = parseMatrix(DIALOGUE_FILENAME, text);
  const indexes = indexesFor(DIALOGUE_FILENAME, rows[0], [
    "Dialog.id",
    "Dialog.NPCID",
    "Dialog.Content",
    "Dialog.NextID",
    "Dialog.End",
  ]);
  const stateIndex = optionalIndex(rows[0], "Dialog.State");
  const relativeTransformsIndex = optionalIndex(
    rows[0],
    "Dialog.RelativeTransformsString",
  );
  const characterBehaviourIndex = optionalIndex(
    rows[0],
    "Dialog.CharacterBehaviourString",
  );

  return rows.slice(2).flatMap((row, index) => {
    const id = valueAt(row, indexes, "Dialog.id");
    if (!id) {
      return [];
    }
    const state = optionalInteger(optionalValueAt(row, stateIndex));
    return [
      {
        id,
        npcId: optionalInteger(valueAt(row, indexes, "Dialog.NPCID")),
        content: valueAt(row, indexes, "Dialog.Content"),
        nextId: firstReference(valueAt(row, indexes, "Dialog.NextID")),
        isEnd: valueAt(row, indexes, "Dialog.End").toLowerCase() === "true",
        rowNumber: index + 3,
        state,
        speakerSlot: null,
        speakerModelIndex: speakerModelIndex(
          optionalValueAt(row, characterBehaviourIndex),
        ),
        relativeTransformsString: optionalValueAt(
          row,
          relativeTransformsIndex,
        ),
        characterBehaviourString: optionalValueAt(
          row,
          characterBehaviourIndex,
        ),
      },
    ];
  });
}

function parseStarts(text: string): DialogueStart[] {
  const rows = parseMatrix(START_FILENAME, text);
  const indexes = indexesFor(START_FILENAME, rows[0], [
    "DialogStart.id",
    "DialogStart.Outline",
  ]);
  const formationIndex = optionalIndex(rows[0], "DialogStart.Formation");
  const modelIndex = optionalIndex(rows[0], "DialogStart.Model");

  return rows.slice(2).flatMap((row, index) => {
    const id = valueAt(row, indexes, "DialogStart.id");
    if (!id) {
      return [];
    }
    const rawModelNames = optionalValueAt(row, modelIndex);
    return [
      {
        id,
        outline: valueAt(row, indexes, "DialogStart.Outline"),
        rowNumber: index + 3,
        formationClassPath:
          optionalValueAt(row, formationIndex) || null,
        modelNames: rawModelNames
          ? rawModelNames.split(";").map((value) => value.trim())
          : [],
      },
    ];
  });
}

function parseNpcs(text: string): Map<number, NpcProfile> {
  const rows = parseMatrix(NPC_FILENAME, text);
  const indexes = indexesFor(NPC_FILENAME, rows[0], [
    "NPC.id",
    "NPC.name",
    "NPC.npcintroduce",
  ]);
  const resourceIndex = optionalIndex(rows[0], "NPC.resource_id");
  const titleIndex = optionalIndex(rows[0], "NPC.title");
  const canTurnIndex = optionalIndex(rows[0], "NPC.ifturn");
  const npcs = new Map<number, NpcProfile>();

  rows.slice(2).forEach((row) => {
    const id = optionalInteger(valueAt(row, indexes, "NPC.id"));
    if (id === null || id <= 0) {
      return;
    }
    npcs.set(id, {
      id,
      name: valueAt(row, indexes, "NPC.name") || `NPC ${id}`,
      note: "",
      introduction: valueAt(row, indexes, "NPC.npcintroduce"),
      resourceId: optionalInteger(optionalValueAt(row, resourceIndex)),
      title: optionalValueAt(row, titleIndex),
      canTurn: optionalBoolean(optionalValueAt(row, canTurnIndex)),
    });
  });
  return npcs;
}

function parseModels(text: string): Map<number, ModelResource> {
  const models = new Map<number, ModelResource>();
  if (!text.trim()) {
    return models;
  }
  const rows = parseMatrix(MODEL_FILENAME, text);
  const indexes = indexesFor(MODEL_FILENAME, rows[0], ["Model.id"]);
  const generatedPathIndex = optionalIndex(rows[0], "Model.path");
  const configuredPathIndex = rows[1].findIndex((value) =>
    value.trim().replace(/^##/, "").startsWith("配置填写在此列"),
  );
  rows.slice(2).forEach((row, index) => {
    const id = optionalInteger(valueAt(row, indexes, "Model.id"));
    if (id === null || id <= 0 || models.has(id)) {
      return;
    }
    models.set(id, {
      id,
      configuredPath: optionalValueAt(row, configuredPathIndex),
      generatedClassPath: optionalValueAt(row, generatedPathIndex),
      rowNumber: index + 3,
    });
  });
  return models;
}

function parseMissions(
  filename: string,
  text: string,
  source: MissionTaskRow["source"],
): MissionTaskRow[] {
  if (!text.trim()) {
    return [];
  }
  const rows = parseMatrix(filename, text);
  const indexes = indexesFor(filename, rows[0], [
    "Mission.id",
    "Mission.Name",
    "Mission.ShowNPC",
  ]);
  return rows.slice(2).flatMap((row, index) => {
    const id = valueAt(row, indexes, "Mission.id");
    if (!id) {
      return [];
    }
    return [{
      id,
      name: valueAt(row, indexes, "Mission.Name"),
      source,
      showTargetIds: valueAt(row, indexes, "Mission.ShowNPC"),
      rowNumber: index + 3,
    }];
  });
}

function parseMissionPositions(text: string): MissionPositionRow[] {
  if (!text.trim()) {
    return [];
  }
  const rows = parseMatrix(MISSION_POSITION_FILENAME, text);
  const indexes = indexesFor(MISSION_POSITION_FILENAME, rows[0], [
    "MissionPosition.ID",
    "MissionPosition.type",
    "MissionPosition.NPCID",
    "MissionPosition.ItemID",
    "MissionPosition.BluePrint",
    "MissionPosition.MapID",
    "MissionPosition.Position",
    "MissionPosition.Rotation",
  ]);
  const descriptionIndex = rows[1].findIndex(
    (value) => value.trim() === "描述",
  );
  return rows.slice(2).flatMap((row, index) => {
    const id = valueAt(row, indexes, "MissionPosition.ID");
    if (!id) {
      return [];
    }
    return [{
      id,
      type: optionalInteger(valueAt(row, indexes, "MissionPosition.type")),
      description: optionalValueAt(row, descriptionIndex),
      npcId: optionalInteger(valueAt(row, indexes, "MissionPosition.NPCID")),
      itemId: optionalInteger(valueAt(row, indexes, "MissionPosition.ItemID")),
      blueprintModelId: optionalInteger(
        valueAt(row, indexes, "MissionPosition.BluePrint"),
      ),
      mapId: valueAt(row, indexes, "MissionPosition.MapID"),
      positionText: valueAt(row, indexes, "MissionPosition.Position"),
      rotationText: valueAt(row, indexes, "MissionPosition.Rotation"),
      rowNumber: index + 3,
    }];
  });
}

function parseMapConfigs(
  mapConfigText: string,
  mapResourceText: string,
): MapConfigRow[] {
  if (!mapConfigText.trim()) {
    return [];
  }
  const resourcePaths = new Map<string, string>();
  if (mapResourceText.trim()) {
    const resourceRows = parseMatrix(MAP_RESOURCE_FILENAME, mapResourceText);
    const resourceIndexes = indexesFor(
      MAP_RESOURCE_FILENAME,
      resourceRows[0],
      ["Scene.id", "Scene.path"],
    );
    for (const row of resourceRows.slice(2)) {
      const id = valueAt(row, resourceIndexes, "Scene.id");
      const path = valueAt(row, resourceIndexes, "Scene.path");
      if (id && path && !resourcePaths.has(id)) {
        resourcePaths.set(id, path);
      }
    }
  }

  const rows = parseMatrix(MAP_CONFIG_FILENAME, mapConfigText);
  const indexes = indexesFor(MAP_CONFIG_FILENAME, rows[0], [
    "MapConfig.id",
    "MapConfig.name",
    "MapConfig.resourceid",
  ]);
  const commentPathIndex = rows[1].findIndex(
    (value) => value.trim() === "地图资源（注释用）",
  );
  return rows.slice(2).flatMap((row, index) => {
    const id = valueAt(row, indexes, "MapConfig.id");
    if (!id) {
      return [];
    }
    const resourceId = valueAt(row, indexes, "MapConfig.resourceid");
    return [{
      id,
      name: valueAt(row, indexes, "MapConfig.name"),
      resourceId,
      assetPath:
        resourcePaths.get(resourceId) ||
        optionalValueAt(row, commentPathIndex),
      rowNumber: index + 3,
    }];
  });
}

export function parseDialogueDatabase(
  dialogueText: string,
  startText: string,
  npcText: string,
  sourceName: string,
  modelText = "",
  missionText = "",
  dungeonMissionText = "",
  missionPositionText = "",
  mapConfigText = "",
  mapResourceText = "",
): DialogueDatabase {
  return {
    dialogueRows: parseDialogues(dialogueText),
    starts: parseStarts(startText),
    npcs: parseNpcs(npcText),
    models: parseModels(modelText),
    missionRows: [
      ...parseMissions(MISSION_FILENAME, missionText, "任务表"),
      ...parseMissions(
        DUNGEON_MISSION_FILENAME,
        dungeonMissionText,
        "副本任务表",
      ),
    ],
    missionPositions: parseMissionPositions(missionPositionText),
    mapConfigs: parseMapConfigs(mapConfigText, mapResourceText),
    sourceName,
  };
}

export function parseNpcRegistrationDatabase(
  npcText: string,
  modelText: string,
  missionPositionText: string,
  mapConfigText: string,
  mapResourceText: string,
  sourceName: string,
): DialogueDatabase {
  return {
    dialogueRows: [],
    starts: [],
    npcs: parseNpcs(npcText),
    models: parseModels(modelText),
    missionRows: [],
    missionPositions: parseMissionPositions(missionPositionText),
    mapConfigs: parseMapConfigs(mapConfigText, mapResourceText),
    sourceName,
  };
}

async function readFile(directory: FileSystemDirectoryHandle, filename: string) {
  const handle = await directory.getFileHandle(filename);
  return (await handle.getFile()).text();
}

async function readOptionalFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
): Promise<string> {
  try {
    return await readFile(directory, filename);
  } catch {
    return "";
  }
}

export async function loadDocDirectory(
  root: FileSystemDirectoryHandle,
): Promise<DialogueDatabase> {
  const csvDirectory =
    root.name.toLowerCase() === "csvdir"
      ? root
      : await root.getDirectoryHandle("csvdir");
  const [
    dialogueText,
    startText,
    npcText,
    modelText,
    missionText,
    dungeonMissionText,
    missionPositionText,
    mapConfigText,
    mapResourceText,
  ] = await Promise.all([
    readFile(csvDirectory, DIALOGUE_FILENAME),
    readFile(csvDirectory, START_FILENAME),
    readFile(csvDirectory, NPC_FILENAME),
    readOptionalFile(csvDirectory, MODEL_FILENAME),
    readOptionalFile(csvDirectory, MISSION_FILENAME),
    readOptionalFile(csvDirectory, DUNGEON_MISSION_FILENAME),
    readOptionalFile(csvDirectory, MISSION_POSITION_FILENAME),
    readOptionalFile(csvDirectory, MAP_CONFIG_FILENAME),
    readOptionalFile(csvDirectory, MAP_RESOURCE_FILENAME),
  ]);
  return parseDialogueDatabase(
    dialogueText,
    startText,
    npcText,
    `${root.name}\\csvdir`,
    modelText,
    missionText,
    dungeonMissionText,
    missionPositionText,
    mapConfigText,
    mapResourceText,
  );
}

function fileByName(files: File[], filename: string, required = true): File | null {
  const normalizedSuffix = `/csvdir/${filename}`.toLowerCase();
  const directDirectoryPath = `csvdir/${filename}`.toLowerCase();
  const match = files.find((file) => {
    const relativePath = (file.webkitRelativePath || file.name)
      .replaceAll("\\", "/")
      .toLowerCase();
    return (
      relativePath.endsWith(normalizedSuffix) ||
      relativePath === directDirectoryPath ||
      relativePath === filename.toLowerCase()
    );
  });
  if (!match && required) {
    throw new Error(`选择的目录中未找到 csvdir\\${filename}`);
  }
  return match ?? null;
}

export async function loadDocFiles(fileList: FileList): Promise<DialogueDatabase> {
  const files = Array.from(fileList);
  const dialogue = fileByName(files, DIALOGUE_FILENAME)!;
  const start = fileByName(files, START_FILENAME)!;
  const npc = fileByName(files, NPC_FILENAME)!;
  const model = fileByName(files, MODEL_FILENAME, false);
  const mission = fileByName(files, MISSION_FILENAME, false);
  const dungeonMission = fileByName(
    files,
    DUNGEON_MISSION_FILENAME,
    false,
  );
  const missionPosition = fileByName(
    files,
    MISSION_POSITION_FILENAME,
    false,
  );
  const mapConfig = fileByName(files, MAP_CONFIG_FILENAME, false);
  const mapResource = fileByName(files, MAP_RESOURCE_FILENAME, false);
  const [
    dialogueText,
    startText,
    npcText,
    modelText,
    missionText,
    dungeonMissionText,
    missionPositionText,
    mapConfigText,
    mapResourceText,
  ] = await Promise.all([
    dialogue.text(),
    start.text(),
    npc.text(),
    model?.text() ?? "",
    mission?.text() ?? "",
    dungeonMission?.text() ?? "",
    missionPosition?.text() ?? "",
    mapConfig?.text() ?? "",
    mapResource?.text() ?? "",
  ]);
  const rootName = dialogue.webkitRelativePath.split(/[\\/]/)[0] || "已选目录";
  return parseDialogueDatabase(
    dialogueText,
    startText,
    npcText,
    rootName,
    modelText,
    missionText,
    dungeonMissionText,
    missionPositionText,
    mapConfigText,
    mapResourceText,
  );
}
