import { describe, expect, it } from "vitest";
import { parseDialogueDatabase } from "./csv";
import {
  resolveMissionTargets,
  sortMissionTargetsByDialogueFrequency,
} from "./missionTargetResolver";

const dialogues = `##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End
##对话ID,人物,内容,下一ID,结束
100000,1,测试台词,,true`;

const starts = `##&DialogStart.id,DialogStart.Outline
##对话ID,剧情梗概
100000,测试`;

const npcs = `##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id,NPC.npcchat2,NPC.npcchat3
##id,名称,介绍,资源,复杂闲话,冒泡对白
1001,守卫,测试 NPC,200001,704000,704100`;

const models = `##&Model.id,,Model.path
##id,配置填写在此列，Model.path保存时自动生成，由程序调用,生成路径
200001,/Game/Seria/NPC/Guard/BP_Guard,/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C
400001,/Game/Seria/Task/BP_Device,/Game/Seria/Task/BP_Device.BP_Device_C`;

const missions = `##&字段标记,Mission.id,Mission.Name,Mission.ShowNPC
##任务类型,任务ID,任务名称,显示目标物
,900001,测试任务,"500001,500002,500003"
,900002,错误地图任务,"500001,500004"`;

const positions = `##&MissionPosition.ID,,,MissionPosition.type,MissionPosition.NPCID,MissionPosition.ItemID,MissionPosition.BluePrint,MissionPosition.MapID,MissionPosition.Position,MissionPosition.Rotation,MissionPosition.npcchat2,MissionPosition.Vanish
##ID,类型,描述,坐标类型,NPCID,物品ID,蓝图路径,地图ID,座标,旋转,复杂闲话,消失方式
500001,剧情NPC,守卫,1,1001,0,,1204,"(X=10,Y=20,Z=30)","(Pitch=0,Yaw=90,Roll=0)",704200,瞬间消失
500002,任务物件,装置,4,0,0,400001,1204,"(X=40,Y=50,Z=60)","(Pitch=1,Yaw=2,Roll=3)",704300,超视距消失
500003,触发器,抵达区域,3,0,0,,1204,"(X=70,Y=80,Z=90)","(Pitch=0,Yaw=0,Roll=0)",,不消失
500004,触发器,错误地图,3,0,0,,1205,"(X=1,Y=2,Z=3)","(Pitch=0,Yaw=0,Roll=0)",,`;

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
        vanish: target.vanish,
      })),
    ).toEqual([
      {
        id: "500001",
        npcId: 1001,
        modelId: 200001,
        kind: "asset",
        vanish: "瞬间消失",
      },
      {
        id: "500002",
        npcId: 0,
        modelId: 400001,
        kind: "asset",
        vanish: "超视距消失",
      },
      {
        id: "500003",
        npcId: 0,
        modelId: null,
        kind: "marker",
        vanish: "不消失",
      },
    ]);
    expect(plan.targets[0].transform).toEqual({
      location: { x: 10, y: 20, z: 30 },
      rotation: { pitch: 0, yaw: 90, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(plan.targets[0].ambientDialogues).toEqual([
      {
        kind: "complex_chat",
        dialogueFileId: "7040",
        sources: ["NPC.npcchat2"],
      },
      {
        kind: "complex_chat",
        dialogueFileId: "7042",
        sources: ["MissionPosition.npcchat2"],
      },
      {
        kind: "bubble",
        dialogueFileId: "7041",
        sources: ["NPC.npcchat3"],
      },
    ]);
    expect(plan.targets[1].ambientDialogues).toEqual([
      {
        kind: "complex_chat",
        dialogueFileId: "7043",
        sources: ["MissionPosition.npcchat2"],
      },
    ]);
    expect(plan.targets[2].ambientDialogues).toEqual([]);
  });

  it("diagnoses a model resource ID entered in the NPCID column", () => {
    const source = database();
    source.missionRows[0].showTargetIds = "500001";
    source.missionPositions[0].npcId = 200001;

    const plan = resolveMissionTargets(source, "900001");

    expect(plan.warnings).toEqual([
      "目标物 500001 疑似 NPC ID 配置错误：NPCID 200001 在 NPC 表中不存在，但模型资源表中存在同号 ID。请将目标物表的 NPCID 改为该模型对应的 NPC ID；当前将使用定位标记",
    ]);
    expect(plan.targets[0]).toMatchObject({
      npcId: 200001,
      npcName: "",
      modelId: null,
      modelClassPath: "",
      previewKind: "marker",
    });
  });

  it("keeps the generic warnings for a genuinely missing NPC", () => {
    const source = database();
    source.missionRows[0].showTargetIds = "500001";
    source.missionPositions[0].npcId = 999999;

    expect(resolveMissionTargets(source, "900001").warnings).toEqual([
      "目标物 500001 引用了不存在的 NPC 999999，将使用定位标记",
      "NPC 目标物 500001 没有可加载的模型资源，将使用定位标记",
    ]);
  });

  it("stops before loading when target MapIDs differ", () => {
    expect(() => resolveMissionTargets(database(), "900002")).toThrow(
      "目标物 MapID 不一致",
    );
  });

  it("merges duplicate complex-chat files while retaining every source", () => {
    const source = database();
    source.missionPositions[0].complexChatDialogueIds = ["704000"];

    expect(
      resolveMissionTargets(source, "900001").targets[0].ambientDialogues,
    ).toContainEqual({
      kind: "complex_chat",
      dialogueFileId: "7040",
      sources: ["NPC.npcchat2", "MissionPosition.npcchat2"],
    });
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

  it("lists the duplicated target IDs in the error", () => {
    const brokenMissions = missions.replace(
      '"500001,500002,500003"',
      '"500001,500002,500001,500002,500001"',
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
      "任务节点 900001 的显示目标物存在重复 ID：500001、500002",
    );
  });

  it("orders BP targets by visible dialogue frequency and keeps ties stable", () => {
    const source = database();
    const row = source.dialogueRows[0];
    source.starts = [{ ...source.starts[0], id: "735000" }];
    source.dialogueRows = [
      {
        ...row,
        id: "735000",
        npcId: 1002,
        nextId: "735001",
        isEnd: false,
      },
      {
        ...row,
        id: "735001",
        npcId: 1003,
        nextId: "735002",
        isEnd: false,
      },
      {
        ...row,
        id: "735002",
        npcId: 1002,
        nextId: "735003",
        isEnd: false,
      },
      {
        ...row,
        id: "735003",
        npcId: 1001,
        nextId: null,
        isEnd: true,
        state: 4,
      },
    ];
    const plan = resolveMissionTargets(source, "900001");
    const guard = plan.targets[0];
    const item = plan.targets[1];
    const targets = [
      item,
      { ...guard, targetId: "500011", npcId: 1003 },
      { ...guard, targetId: "500010", npcId: 1002 },
      { ...guard, targetId: "500012", npcId: 1001 },
    ];

    expect(
      sortMissionTargetsByDialogueFrequency(
        source,
        "735000",
        targets,
      ).map((target) => target.targetId),
    ).toEqual(["500010", "500011", "500002", "500012"]);
    expect(
      sortMissionTargetsByDialogueFrequency(source, null, targets),
    ).toEqual(targets);
  });
});
