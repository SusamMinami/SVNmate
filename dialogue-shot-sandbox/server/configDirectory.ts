import { access } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const REQUIRED_LIVE_FILENAMES = [
  "对话表.csv",
  "对话表_开始节点.csv",
  "任务表.csv",
];

const REQUIRED_CONFIG_FILENAMES = [
  "NPC表.csv",
  "m模型资源表.csv",
  "m目标物表.csv",
  "d地图配置表.csv",
  "d地图资源表.csv",
];

export function normalizeConfigCsvDirectory(directoryPath: string): string {
  const selected = directoryPath.trim();
  if (!selected) {
    return "";
  }
  const normalized = resolve(selected);
  return basename(normalized).toLowerCase() === "csvdir"
    ? normalized
    : join(normalized, "csvdir");
}

async function hasRequiredFiles(
  directoryPath: string,
  filenames: string[],
): Promise<boolean> {
  if (!directoryPath.trim()) {
    return false;
  }
  try {
    await Promise.all(
      filenames.map((filename) =>
        access(join(directoryPath, filename)),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

export async function isLiveCsvDirectoryReady(
  directoryPath: string,
): Promise<boolean> {
  return hasRequiredFiles(directoryPath, REQUIRED_LIVE_FILENAMES);
}

export async function isConfigCsvDirectoryReady(
  directoryPath: string,
): Promise<boolean> {
  return hasRequiredFiles(directoryPath, REQUIRED_CONFIG_FILENAMES);
}
