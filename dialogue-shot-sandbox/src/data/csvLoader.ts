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
} from "./csv";
import type {
  DialogueCsvWorkerRequest,
  DialogueCsvWorkerResponse,
} from "./csvWorkerProtocol";

function parseDialogueDatabase(
  request: DialogueCsvWorkerRequest,
): Promise<DialogueDatabase> {
  const worker = new Worker(new URL("./csv.worker.ts", import.meta.url), {
    type: "module",
    name: "dialogue-csv-parser",
  });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("CSV 后台读取或解析超时，请检查目录后重试"));
    }, 120_000);
    worker.onmessage = (event: MessageEvent<DialogueCsvWorkerResponse>) => {
      cleanup();
      if (event.data.ok) {
        resolve(event.data.database);
      } else {
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "CSV 后台解析失败"));
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(new Error("CSV 后台解析结果无法读取"));
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function readDirectoryFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
) {
  const handle = await directory.getFileHandle(filename);
  return handle.getFile();
}

async function readOptionalDirectoryFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
): Promise<File | undefined> {
  try {
    return await readDirectoryFile(directory, filename);
  } catch {
    return undefined;
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
    kind: "files",
    sourceName: `${root.name}\\csvdir`,
    files: {
      dialogueText, startText, npcText, modelText, missionText,
      dungeonMissionText, missionPositionText, mapConfigText, mapResourceText,
    },
  });
}

export async function loadConfiguredDatabase(): Promise<DialogueDatabase> {
  return parseDialogueDatabase({ kind: "configured" });
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
  const rootName = dialogue.webkitRelativePath.split(/[\\/]/)[0] || "已选目录";
  return parseDialogueDatabase({
    kind: "files",
    sourceName: rootName,
    files: {
      dialogueText: dialogue,
      startText: start,
      npcText: npc,
      modelText: model ?? undefined,
      missionText: mission ?? undefined,
      dungeonMissionText: dungeonMission ?? undefined,
      missionPositionText: missionPosition ?? undefined,
      mapConfigText: mapConfig ?? undefined,
      mapResourceText: mapResource ?? undefined,
    },
  });
}
