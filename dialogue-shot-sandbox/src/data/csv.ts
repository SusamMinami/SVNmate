import Papa from "papaparse";
import type {
  DialogueDatabase,
  DialogueRow,
  DialogueStart,
  NpcProfile,
} from "../types";

const DIALOGUE_FILENAME = "对话表.csv";
const START_FILENAME = "对话表_开始节点.csv";
const NPC_FILENAME = "NPC表.csv";

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

function optionalInteger(value: string): number | null {
  if (!/^-?\d+$/.test(value)) {
    return null;
  }
  return Number.parseInt(value, 10);
}

function firstReference(value: string): string | null {
  return value.match(/(?<!\d)\d+(?!\d)/)?.[0] ?? null;
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

  return rows.slice(2).flatMap((row, index) => {
    const id = valueAt(row, indexes, "Dialog.id");
    if (!id) {
      return [];
    }
    return [
      {
        id,
        npcId: optionalInteger(valueAt(row, indexes, "Dialog.NPCID")),
        content: valueAt(row, indexes, "Dialog.Content"),
        nextId: firstReference(valueAt(row, indexes, "Dialog.NextID")),
        isEnd: valueAt(row, indexes, "Dialog.End").toLowerCase() === "true",
        rowNumber: index + 3,
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

  return rows.slice(2).flatMap((row, index) => {
    const id = valueAt(row, indexes, "DialogStart.id");
    if (!id) {
      return [];
    }
    return [
      {
        id,
        outline: valueAt(row, indexes, "DialogStart.Outline"),
        rowNumber: index + 3,
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
    });
  });
  return npcs;
}

export function parseDialogueDatabase(
  dialogueText: string,
  startText: string,
  npcText: string,
  sourceName: string,
): DialogueDatabase {
  return {
    dialogueRows: parseDialogues(dialogueText),
    starts: parseStarts(startText),
    npcs: parseNpcs(npcText),
    sourceName,
  };
}

async function readFile(directory: FileSystemDirectoryHandle, filename: string) {
  const handle = await directory.getFileHandle(filename);
  return (await handle.getFile()).text();
}

export async function loadDocDirectory(
  root: FileSystemDirectoryHandle,
): Promise<DialogueDatabase> {
  const csvDirectory =
    root.name.toLowerCase() === "csvdir"
      ? root
      : await root.getDirectoryHandle("csvdir");
  const [dialogueText, startText, npcText] = await Promise.all([
    readFile(csvDirectory, DIALOGUE_FILENAME),
    readFile(csvDirectory, START_FILENAME),
    readFile(csvDirectory, NPC_FILENAME),
  ]);
  return parseDialogueDatabase(
    dialogueText,
    startText,
    npcText,
    `${root.name}\\csvdir`,
  );
}

function fileByName(files: File[], filename: string): File {
  const normalizedSuffix = `/csvdir/${filename}`.toLowerCase();
  const match = files.find((file) => {
    const relativePath = (file.webkitRelativePath || file.name)
      .replaceAll("\\", "/")
      .toLowerCase();
    return (
      relativePath.endsWith(normalizedSuffix) ||
      relativePath === filename.toLowerCase()
    );
  });
  if (!match) {
    throw new Error(`选择的目录中未找到 csvdir\\${filename}`);
  }
  return match;
}

export async function loadDocFiles(fileList: FileList): Promise<DialogueDatabase> {
  const files = Array.from(fileList);
  const dialogue = fileByName(files, DIALOGUE_FILENAME);
  const start = fileByName(files, START_FILENAME);
  const npc = fileByName(files, NPC_FILENAME);
  const [dialogueText, startText, npcText] = await Promise.all([
    dialogue.text(),
    start.text(),
    npc.text(),
  ]);
  const rootName = dialogue.webkitRelativePath.split(/[\\/]/)[0] || "已选目录";
  return parseDialogueDatabase(dialogueText, startText, npcText, rootName);
}
