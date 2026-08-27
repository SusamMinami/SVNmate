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

export const DIALOGUE_FILENAME = "对话表.csv";
export const START_FILENAME = "对话表_开始节点.csv";
export const NPC_FILENAME = "NPC表.csv";
export const MODEL_FILENAME = "m模型资源表.csv";
export const MISSION_FILENAME = "任务表.csv";
export const DUNGEON_MISSION_FILENAME = "副本任务表.csv";
export const MISSION_POSITION_FILENAME = "m目标物表.csv";
export const MAP_CONFIG_FILENAME = "d地图配置表.csv";
export const MAP_RESOURCE_FILENAME = "d地图资源表.csv";

export interface DialogueCsvPayload {
  dialogueText: string;
  startText: string;
  npcText: string;
  sourceName: string;
  modelText: string;
  missionText: string;
  dungeonMissionText: string;
  missionPositionText: string;
  mapConfigText: string;
  mapResourceText: string;
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

interface CsvHeaders {
  members: string[];
  descriptions: string[];
  indexes: Map<string, number>;
}

const CSV_PARSE_CHUNK_SIZE = 256 * 1024;

function forEachCsvDataRow<TContext>(
  filename: string,
  text: string,
  requiredMembers: string[],
  createContext: (headers: CsvHeaders) => TContext,
  visit: (
    row: string[],
    rowNumber: number,
    headers: CsvHeaders,
    context: TContext,
  ) => void,
): void {
  let parsedRowCount = 0;
  let memberHeader: string[] | null = null;
  let headers: CsvHeaders | null = null;
  let context: TContext | null = null;
  let failure: Error | null = null;

  Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
    chunkSize: CSV_PARSE_CHUNK_SIZE,
    chunk(result: Papa.ParseResult<string[]>, parser: Papa.Parser) {
      if (result.errors.length > 0) {
        const first = result.errors[0];
        failure = new Error(
          `${filename} 第 ${(first.row ?? parsedRowCount) + 1} 行解析失败：${first.message}`,
        );
        parser.abort();
        return;
      }

      for (const data of result.data) {
        parsedRowCount += 1;
        const row = data.map((cell: string) => String(cell ?? ""));
        try {
          if (parsedRowCount === 1) {
            memberHeader = row;
            continue;
          }
          if (parsedRowCount === 2) {
            headers = {
              members: memberHeader!,
              descriptions: row,
              indexes: indexesFor(filename, memberHeader!, requiredMembers),
            };
            context = createContext(headers);
            continue;
          }
          visit(row, parsedRowCount, headers!, context!);
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
          parser.abort();
          break;
        }
      }
    },
    complete() {},
  });

  if (failure) {
    throw failure;
  }
  if (parsedRowCount < 2) {
    throw new Error(`${filename} 缺少双表头`);
  }
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
  const rows: DialogueRow[] = [];
  forEachCsvDataRow(
    DIALOGUE_FILENAME,
    text,
    [
      "Dialog.id",
      "Dialog.NPCID",
      "Dialog.Content",
      "Dialog.NextID",
      "Dialog.End",
    ],
    ({ members }) => ({
      stateIndex: optionalIndex(members, "Dialog.State"),
      relativeTransformsIndex: optionalIndex(
        members,
        "Dialog.RelativeTransformsString",
      ),
      characterBehaviourIndex: optionalIndex(
        members,
        "Dialog.CharacterBehaviourString",
      ),
    }),
    (
      row,
      rowNumber,
      { indexes },
      { stateIndex, relativeTransformsIndex, characterBehaviourIndex },
    ) => {
      const id = valueAt(row, indexes, "Dialog.id");
      if (!id) {
        return;
      }
      rows.push({
        id,
        npcId: optionalInteger(valueAt(row, indexes, "Dialog.NPCID")),
        content: valueAt(row, indexes, "Dialog.Content"),
        nextId: firstReference(valueAt(row, indexes, "Dialog.NextID")),
        isEnd: valueAt(row, indexes, "Dialog.End").toLowerCase() === "true",
        rowNumber,
        state: optionalInteger(optionalValueAt(row, stateIndex)),
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
      });
    },
  );
  return rows;
}

function parseStarts(text: string): DialogueStart[] {
  const starts: DialogueStart[] = [];
  forEachCsvDataRow(
    START_FILENAME,
    text,
    ["DialogStart.id", "DialogStart.Outline"],
    ({ members }) => ({
      formationIndex: optionalIndex(members, "DialogStart.Formation"),
      modelIndex: optionalIndex(members, "DialogStart.Model"),
    }),
    (row, rowNumber, { indexes }, { formationIndex, modelIndex }) => {
      const id = valueAt(row, indexes, "DialogStart.id");
      if (!id) {
        return;
      }
      const rawModelNames = optionalValueAt(row, modelIndex);
      starts.push({
        id,
        outline: valueAt(row, indexes, "DialogStart.Outline"),
        rowNumber,
        formationClassPath:
          optionalValueAt(row, formationIndex) || null,
        modelNames: rawModelNames
          ? rawModelNames.split(";").map((value) => value.trim())
          : [],
      });
    },
  );
  return starts;
}

function parseNpcs(text: string): Map<number, NpcProfile> {
  const npcs = new Map<number, NpcProfile>();
  forEachCsvDataRow(
    NPC_FILENAME,
    text,
    ["NPC.id", "NPC.name", "NPC.npcintroduce"],
    ({ members }) => ({
      resourceIndex: optionalIndex(members, "NPC.resource_id"),
      titleIndex: optionalIndex(members, "NPC.title"),
      canTurnIndex: optionalIndex(members, "NPC.ifturn"),
    }),
    (
      row,
      _rowNumber,
      { indexes },
      { resourceIndex, titleIndex, canTurnIndex },
    ) => {
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
    },
  );
  return npcs;
}

function parseModels(text: string): Map<number, ModelResource> {
  const models = new Map<number, ModelResource>();
  if (!text.trim()) {
    return models;
  }
  forEachCsvDataRow(
    MODEL_FILENAME,
    text,
    ["Model.id"],
    ({ members, descriptions }) => ({
      generatedPathIndex: optionalIndex(members, "Model.path"),
      configuredPathIndex: descriptions.findIndex((value) =>
        value.trim().replace(/^##/, "").startsWith("配置填写在此列"),
      ),
    }),
    (
      row,
      rowNumber,
      { indexes },
      { generatedPathIndex, configuredPathIndex },
    ) => {
      const id = optionalInteger(valueAt(row, indexes, "Model.id"));
      if (id === null || id <= 0 || models.has(id)) {
        return;
      }
      models.set(id, {
        id,
        configuredPath: optionalValueAt(row, configuredPathIndex),
        generatedClassPath: optionalValueAt(row, generatedPathIndex),
        rowNumber,
      });
    },
  );
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
  const missions: MissionTaskRow[] = [];
  forEachCsvDataRow(
    filename,
    text,
    ["Mission.id", "Mission.Name", "Mission.ShowNPC"],
    () => null,
    (row, rowNumber, { indexes }) => {
      const id = valueAt(row, indexes, "Mission.id");
      if (!id) {
        return;
      }
      missions.push({
        id,
        name: valueAt(row, indexes, "Mission.Name"),
        source,
        showTargetIds: valueAt(row, indexes, "Mission.ShowNPC"),
        rowNumber,
      });
    },
  );
  return missions;
}

function parseMissionPositions(text: string): MissionPositionRow[] {
  if (!text.trim()) {
    return [];
  }
  const positions: MissionPositionRow[] = [];
  forEachCsvDataRow(
    MISSION_POSITION_FILENAME,
    text,
    [
      "MissionPosition.ID",
      "MissionPosition.type",
      "MissionPosition.NPCID",
      "MissionPosition.ItemID",
      "MissionPosition.BluePrint",
      "MissionPosition.MapID",
      "MissionPosition.Position",
      "MissionPosition.Rotation",
    ],
    ({ descriptions }) => ({
      descriptionIndex: descriptions.findIndex(
        (value) => value.trim() === "描述",
      ),
    }),
    (row, rowNumber, { indexes }, { descriptionIndex }) => {
      const id = valueAt(row, indexes, "MissionPosition.ID");
      if (!id) {
        return;
      }
      positions.push({
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
        rowNumber,
      });
    },
  );
  return positions;
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
    forEachCsvDataRow(
      MAP_RESOURCE_FILENAME,
      mapResourceText,
      ["Scene.id", "Scene.path"],
      () => null,
      (row, _rowNumber, { indexes }) => {
        const id = valueAt(row, indexes, "Scene.id");
        const path = valueAt(row, indexes, "Scene.path");
        if (id && path && !resourcePaths.has(id)) {
          resourcePaths.set(id, path);
        }
      },
    );
  }

  const maps: MapConfigRow[] = [];
  forEachCsvDataRow(
    MAP_CONFIG_FILENAME,
    mapConfigText,
    ["MapConfig.id", "MapConfig.name", "MapConfig.resourceid"],
    ({ descriptions }) => ({
      commentPathIndex: descriptions.findIndex(
        (value) => value.trim() === "地图资源（注释用）",
      ),
    }),
    (row, rowNumber, { indexes }, { commentPathIndex }) => {
      const id = valueAt(row, indexes, "MapConfig.id");
      if (!id) {
        return;
      }
      const resourceId = valueAt(row, indexes, "MapConfig.resourceid");
      maps.push({
        id,
        name: valueAt(row, indexes, "MapConfig.name"),
        resourceId,
        assetPath:
          resourcePaths.get(resourceId) ||
          optionalValueAt(row, commentPathIndex),
        rowNumber,
      });
    },
  );
  return maps;
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

export function parseDialogueDatabasePayload(
  payload: DialogueCsvPayload,
): DialogueDatabase {
  return parseDialogueDatabase(
    payload.dialogueText,
    payload.startText,
    payload.npcText,
    payload.sourceName,
    payload.modelText,
    payload.missionText,
    payload.dungeonMissionText,
    payload.missionPositionText,
    payload.mapConfigText,
    payload.mapResourceText,
  );
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

export function parseMissionTargetDatabase(
  npcText: string,
  modelText: string,
  missionText: string,
  dungeonMissionText: string,
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
