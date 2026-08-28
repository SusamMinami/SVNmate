import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import Papa from "papaparse";
import type {
  MusicAudioAnalysis,
  MusicCatalogEntry,
  MusicCatalogSnapshot,
} from "../src/data/musicCatalog";
import { getConfigCsvDirectory } from "./configRepository";

const MUSIC_STATE_FILENAME = "d对话音乐状态映射表.csv";

function root(): string {
  return process.env.STORYBOARD_PROJECT_ROOT || process.cwd();
}

export function musicCatalogRecordPath(): string {
  return join(root(), ".storyboard-data", "music-catalog.ndjson");
}

export function musicAnalysisRecordPath(): string {
  return join(root(), ".storyboard-data", "music-analysis.ndjson");
}

export function musicAttachmentPath(
  fileToken: string,
  fileName: string,
): string {
  const safeToken = fileToken.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeName = fileName.replace(/[<>:"/\\|?*]/g, "_");
  return join(
    root(),
    ".storyboard-data",
    "music",
    `${safeToken}-${safeName}`,
  );
}

export function parseMusicStateMap(text: string): Map<string, number> {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(
      `${MUSIC_STATE_FILENAME} 第 ${(first.row ?? 0) + 1} 行解析失败：${first.message}`,
    );
  }
  const members = parsed.data[0]?.map((cell) =>
    String(cell ?? "").replace(/^\uFEFF/, "").trim().replace(/^##&/, ""),
  );
  const idIndex = members?.indexOf("DialogMusicState.id") ?? -1;
  const stateIndex =
    members?.indexOf("DialogMusicState.WwiseState") ?? -1;
  if (idIndex < 0 || stateIndex < 0) {
    throw new Error(
      `${MUSIC_STATE_FILENAME} 缺少 DialogMusicState.id 或 DialogMusicState.WwiseState 字段`,
    );
  }
  const result = new Map<string, number>();
  for (const row of parsed.data.slice(2)) {
    const idText = String(row[idIndex] ?? "").trim();
    const stateName = String(row[stateIndex] ?? "").trim();
    if (!/^\d+$/.test(idText) || !stateName) {
      continue;
    }
    const stateId = Number(idText);
    const existing = result.get(stateName);
    if (existing !== undefined && existing !== stateId) {
      throw new Error(
        `${MUSIC_STATE_FILENAME} 中音乐状态 ${stateName} 对应多个 ID`,
      );
    }
    result.set(stateName, stateId);
  }
  return result;
}

async function musicStateMap(
  candidates = [
    join(getConfigCsvDirectory(), MUSIC_STATE_FILENAME),
    join("C:\\trunk\\doc\\csvdir", MUSIC_STATE_FILENAME),
    join(root(), "doc", "csvdir", MUSIC_STATE_FILENAME),
  ],
): Promise<Map<string, number>> {
  for (const path of candidates) {
    try {
      return parseMusicStateMap(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      continue;
    }
  }
  throw new Error(`未找到音乐状态映射表 ${MUSIC_STATE_FILENAME}`);
}

async function loadMusicAnalysis(
  path: string,
): Promise<Map<string, { fileToken: string; analysis: MusicAudioAnalysis }>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
  const result = new Map<
    string,
    { fileToken: string; analysis: MusicAudioAnalysis }
  >();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const record = JSON.parse(line) as Record<string, unknown>;
    const value = (localName: string, baseName: string) =>
      record[localName] ?? record[baseName];
    const stateName = String(value("state_name", "资源标识") ?? "").trim();
    const rawStatus = value("analysis_status", "分析状态");
    const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
    if (!stateName || !["ready", "完成"].includes(String(status))) {
      continue;
    }
    const numberValue = (
      localName: string,
      baseName: string,
      fallback = 0,
    ) => {
      const parsed = Number(value(localName, baseName));
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const nullableNumber = (localName: string, baseName: string) => {
      const raw = value(localName, baseName);
      const parsed = Number(raw);
      return raw !== null && raw !== undefined && Number.isFinite(parsed)
        ? parsed
        : null;
    };
    result.set(stateName, {
      fileToken: String(value("file_token", "文件Token") ?? ""),
      analysis: {
        estimatedBpm: nullableNumber("estimated_bpm", "估算BPM"),
        bpmSource: String(value("bpm_source", "BPM来源") ?? ""),
        tempoConfidence: numberValue("tempo_confidence", "节奏置信度"),
        integratedLufs: nullableNumber("integrated_lufs", "综合响度LUFS"),
        loudnessRangeLu: nullableNumber("loudness_range_lu", "响度范围LU"),
        truePeakDbfs: nullableNumber("true_peak_dbfs", "真峰值dBFS"),
        dynamicRangeDb: numberValue("dynamic_range_db", "动态范围dB"),
        spectralCentroidHz: numberValue(
          "spectral_centroid_hz",
          "频谱重心Hz",
        ),
        lowFrequencyRatio: numberValue("low_frequency_ratio", "低频占比"),
        midFrequencyRatio: numberValue("mid_frequency_ratio", "中频占比"),
        highFrequencyRatio: numberValue("high_frequency_ratio", "高频占比"),
        tempoLevel: String(value("tempo_level", "速度等级") ?? "未知"),
        energyLevel: String(value("energy_level", "能量等级") ?? "未知"),
        brightness: String(value("brightness", "音色明暗") ?? "未知"),
        summary: String(value("analysis_summary", "音频特征摘要") ?? ""),
      },
    });
  }
  return result;
}

export async function loadMusicCatalog(
  revision?: number,
  paths: {
    records?: string;
    stateMaps?: string[];
    analysis?: string;
  } = {},
): Promise<MusicCatalogSnapshot> {
  const recordsPath = paths.records ?? musicCatalogRecordPath();
  let text: string;
  try {
    text = await readFile(recordsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        entries: [],
        revision: revision ?? 0,
        syncedAt: null,
        unmappedCount: 0,
        missingAttachmentCount: 0,
        analyzedCount: 0,
      };
    }
    throw error;
  }
  const [stateMap, analysis, fileInfo] = await Promise.all([
    musicStateMap(paths.stateMaps),
    loadMusicAnalysis(paths.analysis ?? musicAnalysisRecordPath()),
    stat(recordsPath),
  ]);
  const records = text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        throw new Error(`音乐目录第 ${index + 1} 行不是有效 JSON`);
      }
    });
  let unmappedCount = 0;
  const entries: MusicCatalogEntry[] = records.flatMap((record) => {
    const stateName = String(record["资源标识"] ?? "").trim();
    const stateId = stateMap.get(stateName);
    if (!stateName || stateId === undefined) {
      unmappedCount += 1;
      return [];
    }
    const files = Array.isArray(record["BGM文件"])
      ? (record["BGM文件"] as Array<Record<string, unknown>>)
      : [];
    const fileToken = files[0]
      ? String(files[0].file_token ?? "") || null
      : null;
    const cachedAnalysis = analysis.get(stateName);
    return [{
      recordId: String(record.record_id),
      name: String(record["BGM名称"] ?? stateName),
      stateName,
      stateId,
      tags: Array.isArray(record["标签"]) ? record["标签"].map(String) : [],
      notes: String(record["备注"] ?? ""),
      fileToken,
      fileName: files[0] ? String(files[0].name ?? "") || null : null,
      analysis:
        cachedAnalysis?.fileToken === fileToken
          ? cachedAnalysis.analysis
          : undefined,
    }];
  });
  let storedRevision = 0;
  if (revision === undefined) {
    try {
      const manifestPath = recordsPath.replace(/\.ndjson$/i, ".manifest.json");
      const manifest = JSON.parse(
        await readFile(manifestPath, "utf8"),
      ) as { rev?: unknown };
      storedRevision = Number(manifest.rev ?? 0);
    } catch {
      storedRevision = 0;
    }
  }
  return {
    entries,
    revision: revision ?? storedRevision,
    syncedAt: fileInfo.mtime.toISOString(),
    unmappedCount,
    missingAttachmentCount: entries.filter(
      (entry) => !entry.fileToken || !entry.fileName,
    ).length,
    analyzedCount: entries.filter((entry) => entry.analysis).length,
  };
}

export async function ensureMusicDirectories(): Promise<void> {
  await mkdir(dirname(musicCatalogRecordPath()), { recursive: true });
  await mkdir(join(root(), ".storyboard-data", "music"), { recursive: true });
}
