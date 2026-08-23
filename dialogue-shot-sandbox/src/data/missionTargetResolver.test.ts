import { describe, expect, it } from "vitest";
import { parseDialogueDatabase } from "./csv";
import { resolveMissionTargets } from "./missionTargetResolver";

const dialogues = `##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End
##对话ID,人物,内容,下一ID,结束
100000,1,测试台词,,true`;

const starts = `##&DialogStart.id,DialogStart.Outline
##对话ID,剧情梗概
100000,测试`;

const npcs = `##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id
##id,名称,介绍,资源
1001,守卫,测试 NPC,200001`;

const models = `##&Model.id,,Model.path
##id,配置填写在此列，Model.path保存时自动生成，由程序调用,生成路径
200001,/Game/Seria/NPC/Guard/BP_Guard,/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C
400001,/Game/Seria/Task/BP_Device,/Game/Seria/Task/BP_Device.BP_Device_C`;

const missions = `##&字段标记,Mission.id,Mission.Name,Mission.ShowNPC
##任务类型,任务ID,任务名称,显示目标物
,900001,测试任务,"500001,500002,500003"
,900002,错误地图任务,"500001,500004"`;

const positions = `##&MissionPosition.ID,,,MissionPosition.type,MissionPosition.NPCID,MissionPosition.ItemID,MissionPosition.BluePrint,MissionPosition.MapID,MissionPosition.Position,MissionPosition.Rotation
##ID,类型,描述,坐标类型,NPCID,物品ID,蓝图路径,地图ID,座标,旋转
500001,剧情NPC,守卫,1,1001,0,,1204,"(X=10,Y=20,Z=30)","(Pitch=0,Yaw=90,Roll=0)"
500002,任务物件,装置,4,0,0,400001,1204,"(X=40,Y=50,Z=60)","(Pitch=1,Yaw=2,Roll=3)"
500003,触发器,抵达区域,3,0,0,,1204,"(X=70,Y=80,Z=90)","(Pitch=0,Yaw=0,Roll=0)"
500004,触发器,错误地图,3,0,0,,1205,"(X=1,Y=2,Z=3)","(Pitch=0,Yaw=0,Roll=0)"`;

const maps = `##&MapConfig.id,MapConfig.name,,,MapConfig.resourceid
##ID,地图名称,地图备注,地图资源（注释用）,资源ID
1204,上城区,,/Game/Stale/Path,100128
1205,其他地图,,/Game/Other/Map,100129`;

const scenes = `##&Scene.id,Scene.path
##id,path
100128,/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea
100129,/Game/Seria/Maps/Other/Other`;

function database() {
  return parseDialogueDatabase(
    dialogues,
    starts,
    npcs,
    "test",
    models,
    missions,
    "",
    positions,
    maps,
    scenes,
  );
}

describe("resolveMissionTargets", () => {
  it("resolves NPC and blueprint assets and keeps marker-only targets", () => {
    const plan = resolveMissionTargets(database(), "900001");

    expect(plan).toMatchObject({
      taskId: "900001",
      taskName: "测试任务",
      taskSource: "任务表",
      mapId: "1204",
      mapName: "上城区",
      mapAssetPath:
        "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
    });
    expect(
      plan.targets.map((target) => ({
        id: target.targetId,
        npcId: target.npcId,
        modelId: target.modelId,
        kind: target.previewKind,
      })),
    ).toEqual([
      { id: "500001", npcId: 1001, modelId: 200001, kind: "asset" },
      { id: "500002", npcId: 0, modelId: 400001, kind: "asset" },
      { id: "500003", npcId: 0, modelId: null, kind: "marker" },
    ]);
    expect(plan.targets[0].transform).toEqual({
      location: { x: 10, y: 20, z: 30 },
      rotation: { pitch: 0, yaw: 90, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  it("stops before loading when target MapIDs differ", () => {
    expect(() => resolveMissionTargets(database(), "900002")).toThrow(
      "目标物 MapID 不一致",
    );
  });

  it("rejects malformed target references", () => {
    const brokenMissions = missions.replace(
      '"500001,500002,500003"',
      '"500001,500002500003"',
    );
    const broken = parseDialogueDatabase(
      dialogues,
      starts,
      npcs,
      "test",
      models,
      brokenMissions,
      "",
      positions,
      maps,
      scenes,
    );

    expect(() => resolveMissionTargets(broken, "900001")).toThrow(
      "引用了不存在的目标物 500002500003",
    );
  });
});
