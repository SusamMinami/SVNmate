import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isConfigCsvDirectoryReady,
  isLiveCsvDirectoryReady,
  normalizeConfigCsvDirectory,
  normalizeLiveCsvDirectory,
} from "./configDirectory";
import {
  configureConfigDocDirectory,
  configureLiveResDirectory,
  getConfigCsvDirectory,
  getConfigCsvPaths,
  getOptionalConfigDocDirectory,
  getConfigTablePaths,
  readConfiguredMissionTargetPlan,
  restoreDevelopmentConfigDirectories,
} from "./configRepository";
import { scanSelectedNpcRegistration } from "./ueBridge";
import type { UnrealInvoker } from "./ue/transport";

let temporaryRoot = "";

class SelectedActorConnection implements UnrealInvoker {
  async connect(): Promise<void> {}

  async invoke(
    action: string,
    _args: Record<string, unknown>,
  ): Promise<unknown> {
    if (action === "editor.get_current_map_name") {
      return "/Game/Test/Maps/CustomMap";
    }
    if (action === "script.eval_python_expression") {
      return {
        bSuccess: true,
        Result: `'${JSON.stringify([
          {
            actor_ref: "PersistentLevel.BP_CustomNpc_C_0",
            label: "自定义目录 NPC",
            class_path:
              "/Game/Test/NPC/BP_CustomNpc.BP_CustomNpc_C",
            location: [10, 20, 30],
            rotation: [0, 90, 0],
            scale: [1, 1, 1],
          },
        ])}'`,
      };
    }
    throw new Error(`Unexpected action: ${action}`);
  }

  close(): void {}
}

afterEach(async () => {
  configureLiveResDirectory("");
  configureConfigDocDirectory("");
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = "";
  }
});

describe("config data directory", () => {
  it("rejects config access until the user selects a doc directory", () => {
    configureConfigDocDirectory("");

    expect(getOptionalConfigDocDirectory()).toBeNull();
    expect(() => getConfigCsvDirectory()).toThrow("尚未选择配置文档目录");
    expect(() => getConfigCsvPaths()).toThrow("尚未选择配置文档目录");
    expect(() => getConfigTablePaths()).toThrow("尚未选择配置文档目录");
  });

  it("derives the fixed CSV paths from res and doc roots", () => {
    expect(normalizeLiveCsvDirectory("F:\\project-data\\Game\\res")).toBe(
      join(
        "F:\\project-data\\Game\\res",
        "Content",
        "Seria",
        "Tables",
        "csvdir",
      ),
    );
    expect(normalizeConfigCsvDirectory("F:\\project-data\\doc")).toBe(
      join("F:\\project-data\\doc", "csvdir"),
    );
    expect(normalizeLiveCsvDirectory("")).toBe("");
    expect(normalizeConfigCsvDirectory("")).toBe("");
  });

  it("validates live and stable config directories independently", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "shot-sandbox-ready-"));
    const csvDirectory = join(temporaryRoot, "csvdir");
    await mkdir(csvDirectory, { recursive: true });
    await writeFile(join(csvDirectory, "对话表.csv"), "", "utf8");
    expect(await isLiveCsvDirectoryReady(csvDirectory)).toBe(false);
    expect(await isConfigCsvDirectoryReady(csvDirectory)).toBe(false);

    await Promise.all([
      writeFile(join(csvDirectory, "对话表_开始节点.csv"), "", "utf8"),
      writeFile(join(csvDirectory, "任务表.csv"), "", "utf8"),
    ]);
    expect(await isLiveCsvDirectoryReady(csvDirectory)).toBe(true);

    await Promise.all(
      [
        "NPC表.csv",
        "m模型资源表.csv",
        "m目标物表.csv",
        "d地图配置表.csv",
        "d地图资源表.csv",
      ].map((filename) => writeFile(join(csvDirectory, filename), "", "utf8")),
    );
    expect(await isConfigCsvDirectoryReady(csvDirectory)).toBe(true);
  });

  it("restores the development server directory from desktop state", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "shot-sandbox-state-"));
    const docDirectory = join(temporaryRoot, "project", "doc");
    const configCsvDirectory = join(docDirectory, "csvdir");
    const resDirectory = join(temporaryRoot, "project", "Game", "res");
    const liveCsvDirectory = normalizeLiveCsvDirectory(resDirectory);
    const appDataDirectory = join(temporaryRoot, "app-data");
    await Promise.all([
      mkdir(configCsvDirectory, { recursive: true }),
      mkdir(liveCsvDirectory, { recursive: true }),
      mkdir(join(appDataDirectory, "Shot Sandbox"), {
        recursive: true,
      }),
    ]);
    await Promise.all([
      ...["对话表.csv", "对话表_开始节点.csv", "任务表.csv"].map(
        (filename) => writeFile(join(liveCsvDirectory, filename), "", "utf8"),
      ),
      ...[
        "NPC表.csv",
        "m模型资源表.csv",
        "m目标物表.csv",
        "d地图配置表.csv",
        "d地图资源表.csv",
      ].map(
        (filename) => writeFile(join(configCsvDirectory, filename), "", "utf8"),
      ),
      writeFile(
        join(appDataDirectory, "Shot Sandbox", "desktop-state.json"),
        JSON.stringify({
          liveResDirectory: resDirectory,
          configDocDirectory: docDirectory,
        }),
        "utf8",
      ),
    ]);

    expect(
      await restoreDevelopmentConfigDirectories({
        appDataDirectory,
      }),
    ).toEqual({
      liveResDirectory: resDirectory,
      configDocDirectory: docDirectory,
    });
    expect(getConfigCsvDirectory()).toBe(configCsvDirectory);
  });

  it("scans NPC registration data from the selected doc directory", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "shot-sandbox-doc-"));
    const csvDirectory = join(temporaryRoot, "csvdir");
    const liveResDirectory = join(temporaryRoot, "engine", "res");
    const liveCsvDirectory = normalizeLiveCsvDirectory(liveResDirectory);
    await Promise.all([
      mkdir(csvDirectory, { recursive: true }),
      mkdir(liveCsvDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(csvDirectory, "NPC表.csv"),
        [
          "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
          "##id,名称,介绍,资源",
          "700001,自定义 NPC,测试,200777",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(csvDirectory, "m模型资源表.csv"),
        [
          "##&Model.id,,Model.path",
          "##id,配置填写在此列，Model.path保存时自动生成，由程序调用,生成路径",
          "200777,/Game/Test/NPC/BP_CustomNpc,/Game/Test/NPC/BP_CustomNpc.BP_CustomNpc_C",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(csvDirectory, "m目标物表.csv"),
        [
          "##&MissionPosition.ID,,,MissionPosition.type,MissionPosition.NPCID,MissionPosition.ItemID,MissionPosition.BluePrint,MissionPosition.MapID,MissionPosition.Position,MissionPosition.Rotation",
          "##ID,类型,描述,坐标类型,NPCID,物品ID,蓝图路径,地图ID,座标,旋转",
          '500001,剧情 NPC,自定义 NPC,1,700001,0,,9901,"(X=10,Y=20,Z=30)","(Pitch=0,Yaw=90,Roll=0)"',
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(liveCsvDirectory, "任务表.csv"),
        [
          "##&字段标记,Mission.id,Mission.Name,Mission.ShowNPC",
          "##任务类型,任务ID,任务名称,显示目标物",
          ",900001,自定义任务,500001",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(csvDirectory, "d地图配置表.csv"),
        [
          "##&MapConfig.id,MapConfig.name,,,MapConfig.resourceid",
          "##ID,地图名称,地图备注,地图资源（注释用）,资源ID",
          "9901,测试地图,,,990001",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(csvDirectory, "d地图资源表.csv"),
        [
          "##&Scene.id,Scene.path",
          "##id,path",
          "990001,/Game/Test/Maps/CustomMap",
        ].join("\n"),
        "utf8",
      ),
    ]);

    configureLiveResDirectory(liveResDirectory);
    configureConfigDocDirectory(temporaryRoot);
    const result = await scanSelectedNpcRegistration(
      () => new SelectedActorConnection(),
    );

    expect(getConfigCsvDirectory()).toBe(csvDirectory);
    expect(getConfigCsvPaths()).toMatchObject({
      mission: join(liveCsvDirectory, "任务表.csv"),
      npc: join(csvDirectory, "NPC表.csv"),
      missionTarget: join(csvDirectory, "m目标物表.csv"),
    });
    expect(getConfigTablePaths()).toEqual({
      missionTarget: join(
        temporaryRoot,
        "xlsdir",
        "r任务剧情",
        "m目标物表.xlsm",
      ),
      npc: join(temporaryRoot, "xlsdir", "NPC表.xlsm"),
      model: join(temporaryRoot, "xlsdir", "m模型资源表.xlsm"),
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      modelOptions: [{ id: 200777 }],
      npcOptions: [{ id: 700001, name: "自定义 NPC" }],
      mapId: "9901",
    });

    const firstPlan = await readConfiguredMissionTargetPlan("900001");
    expect(firstPlan.targets[0].transform.location).toEqual({
      x: 10,
      y: 20,
      z: 30,
    });

    await writeFile(
      join(csvDirectory, "m目标物表.csv"),
      [
        "##&MissionPosition.ID,,,MissionPosition.type,MissionPosition.NPCID,MissionPosition.ItemID,MissionPosition.BluePrint,MissionPosition.MapID,MissionPosition.Position,MissionPosition.Rotation",
        "##ID,类型,描述,坐标类型,NPCID,物品ID,蓝图路径,地图ID,座标,旋转",
        '500001,剧情 NPC,自定义 NPC,1,700001,0,,9901,"(X=40,Y=50,Z=60)","(Pitch=0,Yaw=45,Roll=0)"',
      ].join("\n"),
      "utf8",
    );
    const refreshedPlan = await readConfiguredMissionTargetPlan("900001");
    expect(refreshedPlan.targets[0].transform).toMatchObject({
      location: { x: 40, y: 50, z: 60 },
      rotation: { pitch: 0, yaw: 45, roll: 0 },
    });
  });
});
