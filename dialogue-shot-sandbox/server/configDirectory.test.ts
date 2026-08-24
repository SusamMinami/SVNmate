import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureConfigCsvDirectory,
  getConfigCsvDirectory,
  getConfigTablePaths,
  scanSelectedNpcRegistration,
  type UnrealInvoker,
} from "./ueBridge";

const DEFAULT_CSV_DIRECTORY = "C:\\trunk\\doc\\csvdir";
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
  configureConfigCsvDirectory(DEFAULT_CSV_DIRECTORY);
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = "";
  }
});

describe("config data directory", () => {
  it("scans NPC registration data from the selected doc directory", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "shot-sandbox-doc-"));
    const csvDirectory = join(temporaryRoot, "csvdir");
    await mkdir(csvDirectory, { recursive: true });
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

    configureConfigCsvDirectory(temporaryRoot);
    const result = await scanSelectedNpcRegistration(
      () => new SelectedActorConnection(),
    );

    expect(getConfigCsvDirectory()).toBe(csvDirectory);
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
  });
});
