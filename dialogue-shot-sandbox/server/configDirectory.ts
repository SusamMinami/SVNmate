import { access } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const REQUIRED_CONFIG_FILENAMES = [
  "对话表.csv",
  "对话表_开始节点.csv",
  "NPC表.csv",
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

export async function isConfigCsvDirectoryReady(
  directoryPath: string,
): Promise<boolean> {
  if (!directoryPath.trim()) {
    return false;
  }
  try {
    await Promise.all(
      REQUIRED_CONFIG_FILENAMES.map((filename) =>
        access(join(directoryPath, filename)),
      ),
    );
    return true;
  } catch {
    return false;
  }
}
