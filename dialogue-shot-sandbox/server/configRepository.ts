import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MissionTargetPreviewPlan } from "../src/types";
import {
  parseMissionTargetDatabase,
  type DialogueCsvPayload,
} from "../src/data/csv";
import { resolveMissionTargets } from "../src/data/missionTargetResolver";
import {
  isConfigCsvDirectoryReady,
  isLiveCsvDirectoryReady,
  normalizeConfigCsvDirectory,
} from "./configDirectory";

let liveCsvDirectory = "";
let configCsvDirectory = "";

export function configureLiveCsvDirectory(directoryPath: string): void {
  liveCsvDirectory = directoryPath.trim();
}

export function configureConfigCsvDirectory(directoryPath: string): void {
  configCsvDirectory = normalizeConfigCsvDirectory(directoryPath);
}

export function getLiveCsvDirectory(): string {
  if (!liveCsvDirectory) {
    throw new Error("尚未选择实时数据目录");
  }
  return liveCsvDirectory;
}

export function getConfigCsvDirectory(): string {
  if (!configCsvDirectory) {
    throw new Error("尚未选择配置文档目录");
  }
  return configCsvDirectory;
}

export function getOptionalLiveCsvDirectory(): string | null {
  return liveCsvDirectory || null;
}

export function getOptionalConfigCsvDirectory(): string | null {
  return configCsvDirectory || null;
}

export async function restoreDevelopmentConfigDirectories(
  options: {
    environmentLiveDirectory?: string;
    environmentConfigDirectory?: string;
    appDataDirectory?: string;
  } = {},
): Promise<{ liveCsvDirectory: string; configCsvDirectory: string } | null> {
  let liveCandidate = options.environmentLiveDirectory?.trim() ?? "";
  let configCandidate = options.environmentConfigDirectory?.trim() ?? "";
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
      ) as {
        liveCsvDirectory?: unknown;
        configCsvDirectory?: unknown;
      };
      if (
        !liveCandidate &&
        typeof state.liveCsvDirectory === "string"
      ) {
        liveCandidate = state.liveCsvDirectory.trim();
      }
      if (
        !configCandidate &&
        typeof state.configCsvDirectory === "string"
      ) {
        configCandidate = state.configCsvDirectory.trim();
      }
    } catch {
      // A development server can still run without persisted desktop state.
    }
  }
  const normalizedConfig = normalizeConfigCsvDirectory(configCandidate);
  if (
    !(await isLiveCsvDirectoryReady(liveCandidate)) ||
    !(await isConfigCsvDirectoryReady(normalizedConfig))
  ) {
    return null;
  }
  configureLiveCsvDirectory(liveCandidate);
  configureConfigCsvDirectory(normalizedConfig);
  return {
    liveCsvDirectory: liveCandidate,
    configCsvDirectory: normalizedConfig,
  };
}

export async function restoreDevelopmentConfigCsvDirectory(
  options: {
    environmentDirectory?: string;
    appDataDirectory?: string;
  } = {},
): Promise<string | null> {
  const restored = await restoreDevelopmentConfigDirectories({
    environmentLiveDirectory: options.environmentDirectory,
    environmentConfigDirectory: options.environmentDirectory,
    appDataDirectory: options.appDataDirectory,
  });
  return restored?.configCsvDirectory ?? null;
}

export function getConfigCsvPaths() {
  const configDirectory = getConfigCsvDirectory();
  const liveDirectory = liveCsvDirectory || configDirectory;
  return {
    dialogue: join(liveDirectory, "对话表.csv"),
    start: join(liveDirectory, "对话表_开始节点.csv"),
    mission: join(liveDirectory, "任务表.csv"),
    dungeonMission: join(liveDirectory, "副本任务表.csv"),
    npc: join(configDirectory, "NPC表.csv"),
    model: join(configDirectory, "m模型资源表.csv"),
    missionTarget: join(configDirectory, "m目标物表.csv"),
    map: join(configDirectory, "d地图配置表.csv"),
    scene: join(configDirectory, "d地图资源表.csv"),
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

export async function readConfiguredDialogueCsvPayload(): Promise<DialogueCsvPayload> {
  const paths = getConfigCsvPaths();
  const [
    dialogueText,
    startText,
    npcText,
    modelText,
    missionText,
    dungeonMissionText,
    missionTargetText,
    mapText,
    sceneText,
  ] = await Promise.all([
    readFile(paths.dialogue, "utf8"),
    readFile(paths.start, "utf8"),
    readFile(paths.npc, "utf8"),
    readFile(paths.model, "utf8"),
    readFile(paths.mission, "utf8"),
    readOptionalConfigFile(paths.dungeonMission),
    readFile(paths.missionTarget, "utf8"),
    readFile(paths.map, "utf8"),
    readFile(paths.scene, "utf8"),
  ]);
  return {
    dialogueText,
    startText,
    npcText,
    sourceName: `${liveCsvDirectory} + ${configCsvDirectory}`,
    modelText,
    missionText,
    dungeonMissionText,
    missionPositionText: missionTargetText,
    mapConfigText: mapText,
    mapResourceText: sceneText,
  };
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
    `${liveCsvDirectory} + ${configCsvDirectory}`,
  );
  return resolveMissionTargets(database, taskId);
}
