import { execFile } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import type {
  SoundEffectCatalogEntry,
  SoundEffectCategory,
} from "../src/data/soundEffectCatalog";

const execFileAsync = promisify(execFile);

export const SOUND_EFFECT_LIBRARY_BASE_TOKEN =
  "TxRLbFH2zalbTSsw4O3cFQUAnkb";
export const SOUND_EFFECT_LIBRARY_TABLE_ID = "tblky7jbQIOlk44n";
export const SOUND_EFFECT_LIBRARY_VIEW_ID = "vewNcXGzda";

export interface RemoteSoundEffectAttachment {
  fileToken: string;
  fileName: string;
  size: number;
}

export interface RemoteSoundEffectEntry {
  recordId: string;
  assetName: string;
  category: string;
  description: string;
  status: string;
  mediaId: string;
  durationSeconds: number | null;
  mediaCount: number;
  attachment: RemoteSoundEffectAttachment | null;
}

interface LarkEnvelope {
  ok?: boolean;
  data?: unknown;
  error?: {
    message?: string;
  };
  [key: string]: unknown;
}

function runtimeRoot(): string {
  return process.env.STORYBOARD_PROJECT_ROOT || process.cwd();
}

export function soundEffectLibraryRecordPath(): string {
  return join(
    runtimeRoot(),
    ".storyboard-data",
    "sound-effect-library.ndjson",
  );
}

function larkCliEntry(): string {
  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error("当前环境缺少 APPDATA，无法定位 lark-cli");
  }
  return join(
    appData,
    "npm",
    "node_modules",
    "@larksuite",
    "cli",
    "scripts",
    "run.js",
  );
}

function parseJsonOutput(text: string): LarkEnvelope {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as LarkEnvelope;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(
        trimmed.slice(firstBrace, lastBrace + 1),
      ) as LarkEnvelope;
    }
    throw new Error("lark-cli 返回了无法解析的内容");
  }
}

async function runLark(
  args: string[],
  timeout = 180_000,
  cwd = runtimeRoot(),
): Promise<LarkEnvelope> {
  try {
    const result = await execFileAsync(
      process.execPath,
      [larkCliEntry(), ...args],
      {
        cwd,
        windowsHide: true,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          ...(process.versions.electron
            ? { ELECTRON_RUN_AS_NODE: "1" }
            : {}),
          LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
          LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
        },
      },
    );
    const envelope = parseJsonOutput(result.stdout);
    if (envelope.ok === false || envelope.error) {
      throw new Error(envelope.error?.message || "飞书请求失败");
    }
    return envelope;
  } catch (error) {
    const commandError = error as {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      code?: string | number;
    };
    const output = commandError.stdout || commandError.stderr || "";
    if (output.trim()) {
      const envelope = parseJsonOutput(output);
      throw new Error(envelope.error?.message || "飞书请求失败");
    }
    if (commandError.killed) {
      throw new Error("lark-cli 调用超时");
    }
    throw error;
  }
}

function categoryLabel(category: SoundEffectCategory): string {
  return {
    environment: "环境",
    footstep: "脚步",
    action: "动作",
    special: "特殊",
  }[category];
}

function parseEntry(record: Record<string, unknown>): RemoteSoundEffectEntry {
  const files = Array.isArray(record["试听文件"])
    ? (record["试听文件"] as Array<Record<string, unknown>>)
    : [];
  const firstFile = files[0];
  const duration = Number(record["事件时长秒"]);
  return {
    recordId: String(record.record_id ?? ""),
    assetName: String(record["资产名"] ?? ""),
    category: Array.isArray(record["分类"])
      ? String(record["分类"][0] ?? "")
      : String(record["分类"] ?? ""),
    description: String(record["描述"] ?? ""),
    status: Array.isArray(record["提取状态"])
      ? String(record["提取状态"][0] ?? "")
      : String(record["提取状态"] ?? ""),
    mediaId: String(record["Wwise媒体ID"] ?? ""),
    durationSeconds: Number.isFinite(duration) ? duration : null,
    mediaCount: Number(record["媒体数量"] ?? 0),
    attachment: firstFile
      ? {
          fileToken: String(firstFile.file_token ?? ""),
          fileName: String(firstFile.name ?? ""),
          size: Number(firstFile.size ?? 0),
        }
      : null,
  };
}

export async function loadSoundEffectLibrary(
  path = soundEffectLibraryRecordPath(),
): Promise<RemoteSoundEffectEntry[]> {
  try {
    return (await readFile(path, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => parseEntry(JSON.parse(line) as Record<string, unknown>))
      .filter((entry) => entry.recordId && entry.assetName);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function refreshSoundEffectLibrary(): Promise<
  RemoteSoundEffectEntry[]
> {
  const output = soundEffectLibraryRecordPath();
  await mkdir(dirname(output), { recursive: true });
  const root = runtimeRoot();
  const relativeOutput = `./${relative(root, output).replaceAll("\\", "/")}`;
  await runLark(
    [
      "base",
      "+record-list",
      "--base-token",
      SOUND_EFFECT_LIBRARY_BASE_TOKEN,
      "--table-id",
      SOUND_EFFECT_LIBRARY_TABLE_ID,
      "--limit",
      "2000",
      "--format",
      "ndjson",
      "--output",
      relativeOutput,
      "--overwrite",
      "--as",
      "user",
    ],
    120_000,
    root,
  );
  return loadSoundEffectLibrary(output);
}

export async function ensureSoundEffectLibraryRecords(
  entries: readonly SoundEffectCatalogEntry[],
): Promise<RemoteSoundEffectEntry[]> {
  let remoteEntries = await refreshSoundEffectLibrary();
  const byAsset = new Map(
    remoteEntries.map((entry) => [entry.assetName, entry]),
  );
  const uniqueEntries = Array.from(
    new Map(entries.map((entry) => [entry.assetName, entry])).values(),
  );
  const missing = uniqueEntries.filter(
    (entry) => !byAsset.has(entry.assetName),
  );
  if (missing.length > 0) {
    const payload = {
      create_records: missing.map((entry) => ({
        资产名: entry.assetName,
        分类: [categoryLabel(entry.category)],
        描述: entry.description,
        提取状态: ["引擎缺失"],
        同步说明: "等待从 UE/Wwise 生成数据提取试听文件",
      })),
    };
    const root = runtimeRoot();
    const payloadPath = join(
      root,
      ".storyboard-data",
      "sound-effect-library-create.json",
    );
    await mkdir(dirname(payloadPath), { recursive: true });
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(payloadPath, JSON.stringify(payload), "utf8"),
    );
    try {
      await runLark(
        [
          "base",
          "+record-batch-create",
          "--base-token",
          SOUND_EFFECT_LIBRARY_BASE_TOKEN,
          "--table-id",
          SOUND_EFFECT_LIBRARY_TABLE_ID,
          "--json",
          `@${relative(root, payloadPath).replaceAll("\\", "/")}`,
          "--as",
          "user",
          "--format",
          "json",
        ],
        120_000,
        root,
      );
    } finally {
      await import("node:fs/promises").then(({ rm }) =>
        rm(payloadPath, { force: true }),
      );
    }
    remoteEntries = await refreshSoundEffectLibrary();
  }
  return remoteEntries;
}

export async function downloadRemoteSoundEffect(
  entry: RemoteSoundEffectEntry,
  outputPath: string,
): Promise<void> {
  if (!entry.attachment) {
    throw new Error("远端音效记录没有试听附件");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const root = runtimeRoot();
  await runLark(
    [
      "base",
      "+record-download-attachment",
      "--base-token",
      SOUND_EFFECT_LIBRARY_BASE_TOKEN,
      "--table-id",
      SOUND_EFFECT_LIBRARY_TABLE_ID,
      "--record-id",
      entry.recordId,
      "--file-token",
      entry.attachment.fileToken,
      "--output",
      `./${relative(root, outputPath).replaceAll("\\", "/")}`,
      "--overwrite",
      "--as",
      "user",
    ],
    240_000,
    root,
  );
}

export async function updateRemoteSoundEffectMetadata(
  recordId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const root = runtimeRoot();
  const payloadPath = join(
    root,
    ".storyboard-data",
    "sound-effect-library-update.json",
  );
  await mkdir(dirname(payloadPath), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      payloadPath,
      JSON.stringify({ update_records: { [recordId]: fields } }),
      "utf8",
    ),
  );
  try {
    await runLark(
      [
        "base",
        "+record-batch-update",
        "--base-token",
        SOUND_EFFECT_LIBRARY_BASE_TOKEN,
        "--table-id",
        SOUND_EFFECT_LIBRARY_TABLE_ID,
        "--json",
        `@${relative(root, payloadPath).replaceAll("\\", "/")}`,
        "--as",
        "user",
        "--format",
        "json",
      ],
      120_000,
      root,
    );
  } finally {
    await import("node:fs/promises").then(({ rm }) =>
      rm(payloadPath, { force: true }),
    );
  }
}

export async function uploadRemoteSoundEffect(
  entry: RemoteSoundEffectEntry,
  filePath: string,
): Promise<void> {
  const fileInfo = await stat(filePath);
  if (fileInfo.size <= 44) {
    throw new Error("本地音效试听缓存为空");
  }
  const root = runtimeRoot();
  await runLark(
    [
      "base",
      "+record-upload-attachment",
      "--base-token",
      SOUND_EFFECT_LIBRARY_BASE_TOKEN,
      "--table-id",
      SOUND_EFFECT_LIBRARY_TABLE_ID,
      "--record-id",
      entry.recordId,
      "--field-id",
      "试听文件",
      "--file",
      `./${relative(root, filePath).replaceAll("\\", "/")}`,
      "--as",
      "user",
      "--format",
      "json",
    ],
    300_000,
    root,
  );
}
