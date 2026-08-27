import type {
  DialogueDatabase,
  DialogueRow,
  DialogueStart,
  MapConfigRow,
  MissionPositionRow,
  MissionTaskRow,
} from "../types";

export interface DialogueDatabaseIndex {
  dialogueRowsById: Map<string, DialogueRow>;
  dialogueRowsByPrefix: Map<string, DialogueRow[]>;
  startsByPrefix: Map<string, DialogueStart[]>;
  searchableDialogueRows: Array<{
    row: DialogueRow;
    normalizedContent: string;
  }>;
  missionRowsById: Map<string, MissionTaskRow[]>;
  missionPositionsById: Map<string, MissionPositionRow[]>;
  mapConfigsById: Map<string, MapConfigRow[]>;
}

const indexCache = new WeakMap<DialogueDatabase, DialogueDatabaseIndex>();

function numericSort(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function append<TKey, TValue>(
  index: Map<TKey, TValue[]>,
  key: TKey,
  value: TValue,
): void {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}

export function getDialogueDatabaseIndex(
  database: DialogueDatabase,
): DialogueDatabaseIndex {
  const cached = indexCache.get(database);
  if (cached) {
    return cached;
  }

  const dialogueRowsById = new Map<string, DialogueRow>();
  const dialogueRowsByPrefix = new Map<string, DialogueRow[]>();
  const searchableDialogueRows: DialogueDatabaseIndex["searchableDialogueRows"] =
    [];
  for (const row of database.dialogueRows) {
    if (!dialogueRowsById.has(row.id)) {
      dialogueRowsById.set(row.id, row);
    }
    append(dialogueRowsByPrefix, row.id.slice(0, 4), row);
    if (row.state !== 4 && row.content && /^\d{4,}$/.test(row.id)) {
      searchableDialogueRows.push({
        row,
        normalizedContent: row.content.toLocaleLowerCase(),
      });
    }
  }
  for (const rows of dialogueRowsByPrefix.values()) {
    rows.sort((left, right) => numericSort(left.id, right.id));
  }

  const startsByPrefix = new Map<string, DialogueStart[]>();
  for (const start of database.starts) {
    append(startsByPrefix, start.id.slice(0, 4), start);
  }
  for (const starts of startsByPrefix.values()) {
    starts.sort((left, right) => numericSort(left.id, right.id));
  }

  const missionRowsById = new Map<string, MissionTaskRow[]>();
  for (const mission of database.missionRows) {
    append(missionRowsById, mission.id, mission);
  }

  const missionPositionsById = new Map<string, MissionPositionRow[]>();
  for (const position of database.missionPositions) {
    append(missionPositionsById, position.id, position);
  }

  const mapConfigsById = new Map<string, MapConfigRow[]>();
  for (const map of database.mapConfigs) {
    append(mapConfigsById, map.id, map);
  }

  const index = {
    dialogueRowsById,
    dialogueRowsByPrefix,
    startsByPrefix,
    searchableDialogueRows,
    missionRowsById,
    missionPositionsById,
    mapConfigsById,
  };
  indexCache.set(database, index);
  return index;
}
