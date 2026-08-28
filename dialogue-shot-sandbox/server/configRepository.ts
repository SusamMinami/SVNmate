import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MissionTargetPreviewPlan } from "../src/types";
import { parseMissionTargetDatabase } from "../src/data/csv";
import { resolveMissionTargets } from "../src/data/missionTargetResolver";
import {
  isConfigCsvDirectoryReady,
  normalizeConfigCsvDirectory,
} from "./configDirectory";

let configCsvDirectory = "";

export function configureConfigCsvDirectory(directoryPath: string): void {
  configCsvDirectory = normalizeConfigCsvDirectory(directoryPath);
}

export function getConfigCsvDirectory(): string {
  if (!configCsvDirectory) {
    throw new Error("尚未选择 doc 文件夹");
  }
  return configCsvDirectory;
}

export function getOptionalConfigCsvDirectory(): string | null {
  return configCsvDirectory || null;
}

export async function restoreDevelopmentConfigCsvDirectory(
  options: {
    environmentDirectory?: string;
    appDataDirectory?: string;
  } = {},
): Promise<string | null> {
  const candidates: string[] = [];
  if (options.environmentDirectory?.trim()) {
    candidates.push(options.environmentDirectory);
  }
  if (options.appDataDirectory?.trim()) {
    try {
      const state = JSON.parse(
        await readFile(
          join(
            options.appDataDirectory,
            "Shot Sandbox",
            "desktop-state.json",
          ),
          "utf8",
        ),
      ) as { dataCsvDirectory?: unknown };
      if (
        typeof state.dataCsvDirectory === "string" &&
        state.dataCsvDirectory.trim()
      ) {
        candidates.push(state.dataCsvDirectory);
      }
    } catch {
      // A development server can still run without persisted desktop state.
    }
  }
  for (const candidate of candidates) {
    const normalized = normalizeConfigCsvDirectory(candidate);
    if (await isConfigCsvDirectoryReady(normalized)) {
      configureConfigCsvDirectory(normalized);
      return normalized;
    }
  }
  return null;
}

export function getConfigCsvPaths() {
  const directory = getConfigCsvDirectory();
  return {
    npc: join(directory, "NPC表.csv"),
    model: join(directory, "m模型资源表.csv"),
    mission: join(directory, "任务表.csv"),
    dungeonMission: join(directory, "副本任务表.csv"),
    missionTarget: join(directory, "m目标物表.csv"),
    map: join(directory, "d地图配置表.csv"),
    scene: join(directory, "d地图资源表.csv"),
  };
}

export function getConfigTablePaths() {
  const xlsDirectory = join(dirname(getConfigCsvDirectory()), "xlsdir");
  return {
    missionTarget: join(xlsDirectory, "r任务剧情", "m目标物表.xlsm"),
    npc: join(xlsDirectory, "NPC表.xlsm"),
    model: join(xlsDirectory, "m模型资源表.xlsm"),
  };
}

async function readOptionalConfigFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function readConfiguredMissionTargetPlan(
  taskId: string,
): Promise<MissionTargetPreviewPlan> {
  const paths = getConfigCsvPaths();
  const [
    npcText,
    modelText,
    missionText,
    dungeonMissionText,
    missionTargetText,
    mapText,
    sceneText,
  ] = await Promise.all([
    readFile(paths.npc, "utf8"),
    readFile(paths.model, "utf8"),
    readFile(paths.mission, "utf8"),
    readOptionalConfigFile(paths.dungeonMission),
    readFile(paths.missionTarget, "utf8"),
    readFile(paths.map, "utf8"),
    readFile(paths.scene, "utf8"),
  ]);
  const database = parseMissionTargetDatabase(
    npcText,
    modelText,
    missionText,
    dungeonMissionText,
    missionTargetText,
    mapText,
    sceneText,
    configCsvDirectory,
  );
  return resolveMissionTargets(database, taskId);
}
