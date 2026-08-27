import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { MissionTargetPreviewPlan } from "../src/types";
import { parseMissionTargetDatabase } from "../src/data/csv";
import { resolveMissionTargets } from "../src/data/missionTargetResolver";

const DEFAULT_CONFIG_CSV_DIRECTORY = "C:\\trunk\\doc\\csvdir";
let configCsvDirectory = DEFAULT_CONFIG_CSV_DIRECTORY;

export function configureConfigCsvDirectory(directoryPath: string): void {
  const normalized = resolve(directoryPath.trim());
  configCsvDirectory =
    basename(normalized).toLowerCase() === "csvdir"
      ? normalized
      : join(normalized, "csvdir");
}

export function getConfigCsvDirectory(): string {
  return configCsvDirectory;
}

export function getConfigCsvPaths() {
  return {
    npc: join(configCsvDirectory, "NPC表.csv"),
    model: join(configCsvDirectory, "m模型资源表.csv"),
    mission: join(configCsvDirectory, "任务表.csv"),
    dungeonMission: join(configCsvDirectory, "副本任务表.csv"),
    missionTarget: join(configCsvDirectory, "m目标物表.csv"),
    map: join(configCsvDirectory, "d地图配置表.csv"),
    scene: join(configCsvDirectory, "d地图资源表.csv"),
  };
}

export function getConfigTablePaths() {
  const xlsDirectory = join(dirname(configCsvDirectory), "xlsdir");
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
