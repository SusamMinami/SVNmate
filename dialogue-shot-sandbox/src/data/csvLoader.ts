import type { DialogueDatabase } from "../types";
import {
  DIALOGUE_FILENAME,
  DUNGEON_MISSION_FILENAME,
  MAP_CONFIG_FILENAME,
  MAP_RESOURCE_FILENAME,
  MISSION_FILENAME,
  MISSION_POSITION_FILENAME,
  MODEL_FILENAME,
  NPC_FILENAME,
  START_FILENAME,
  type DialogueCsvPayload,
} from "./csv";

type DialogueCsvWorkerResponse =
  | { ok: true; database: DialogueDatabase }
  | { ok: false; message: string };

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { message?: string };
}

function parseDialogueDatabase(
  payload: DialogueCsvPayload,
): Promise<DialogueDatabase> {
  const worker = new Worker(new URL("./csv.worker.ts", import.meta.url), {
    type: "module",
    name: "dialogue-csv-parser",
  });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<DialogueCsvWorkerResponse>) => {
      worker.terminate();
      if (event.data.ok) {
        resolve(event.data.database);
      } else {
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "CSV 后台解析失败"));
    };
    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error("CSV 后台解析结果无法读取"));
    };
    worker.postMessage(payload);
  });
}

async function readDirectoryFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
) {
  const handle = await directory.getFileHandle(filename);
  return (await handle.getFile()).text();
}

async function readOptionalDirectoryFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
): Promise<string> {
  try {
    return await readDirectoryFile(directory, filename);
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
    readDirectoryFile(csvDirectory, DIALOGUE_FILENAME),
    readDirectoryFile(csvDirectory, START_FILENAME),
    readDirectoryFile(csvDirectory, NPC_FILENAME),
    readOptionalDirectoryFile(csvDirectory, MODEL_FILENAME),
    readOptionalDirectoryFile(csvDirectory, MISSION_FILENAME),
    readOptionalDirectoryFile(csvDirectory, DUNGEON_MISSION_FILENAME),
    readOptionalDirectoryFile(csvDirectory, MISSION_POSITION_FILENAME),
    readOptionalDirectoryFile(csvDirectory, MAP_CONFIG_FILENAME),
    readOptionalDirectoryFile(csvDirectory, MAP_RESOURCE_FILENAME),
  ]);
  return parseDialogueDatabase({
    dialogueText,
    startText,
    npcText,
    sourceName: `${root.name}\\csvdir`,
    modelText,
    missionText,
    dungeonMissionText,
    missionPositionText,
    mapConfigText,
    mapResourceText,
  });
}

export async function loadConfiguredDatabase(): Promise<DialogueDatabase> {
  const response = await fetch("/api/ue/config-data/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const result = (await response.json().catch(() => null)) as
    | ApiEnvelope<DialogueCsvPayload>
    | null;
  if (!response.ok || !result?.ok || !result.data) {
    throw new Error(
      result?.error?.message ||
        `已保存的数据目录读取失败（HTTP ${response.status}）`,
    );
  }
  return parseDialogueDatabase(result.data);
}

export function findDocCsvFile(
  files: File[],
  filename: string,
): File | null {
  const normalizedSuffix = `/csvdir/${filename}`.toLowerCase();
  const directDirectoryPath = `csvdir/${filename}`.toLowerCase();
  const configured = files.find((file) => {
      const relativePath = (file.webkitRelativePath || file.name)
        .replaceAll("\\", "/")
        .toLowerCase();
      return (
        relativePath.endsWith(normalizedSuffix) ||
        relativePath === directDirectoryPath ||
        relativePath === filename.toLowerCase()
      );
    });
  if (configured) {
    return configured;
  }
  return (
    files
      .filter((file) =>
        (file.webkitRelativePath || file.name)
          .replaceAll("\\", "/")
          .toLowerCase()
          .endsWith(`/${filename.toLowerCase()}`),
      )
      .sort(
        (left, right) =>
          (left.webkitRelativePath || left.name).split(/[\\/]/).length -
          (right.webkitRelativePath || right.name).split(/[\\/]/).length,
      )[0] ?? null
  );
}

function fileByName(
  files: File[],
  filename: string,
  required = true,
): File | null {
  const match = findDocCsvFile(files, filename);
  if (!match && required) {
    throw new Error(`选择的目录中未找到 csvdir\\${filename}`);
  }
  return match;
}

export async function loadDocFiles(
  fileList: FileList,
): Promise<DialogueDatabase> {
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
  return parseDialogueDatabase({
    dialogueText,
    startText,
    npcText,
    sourceName: rootName,
    modelText,
    missionText,
    dungeonMissionText,
    missionPositionText,
    mapConfigText,
    mapResourceText,
  });
}
