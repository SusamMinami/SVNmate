import { describe, expect, it } from "vitest";
import type {
  MissionTargetPreviewPlan,
  SelectedLevelActor,
  SelectedLevelActorsResult,
} from "../types";
import { classifyMissionTargetSelection } from "./missionTargetSelection";

const MAP_PATH = "/Game/Test/Maps/TestMap";
const NPC_CLASS = "/Game/Test/NPC/BP_Guard.BP_Guard_C";

function target(
  targetId: string,
  x: number,
): MissionTargetPreviewPlan["targets"][number] {
  return {
    targetId,
    type: 1,
    description: `目标物 ${targetId}`,
    npcId: Number(targetId),
    npcName: `NPC ${targetId}`,
    modelId: Number(targetId),
    modelClassPath: NPC_CLASS,
    itemId: null,
    blueprintModelId: null,
    mapId: "1204",
    previewKind: "asset",
    transform: {
      location: { x, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function actor(
  actorRef: string,
  label: string,
  classPath: string,
  x: number,
): SelectedLevelActor {
  return {
    actorRef,
    label,
    classPath,
    transform: {
      location: { x, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function plan(targets: MissionTargetPreviewPlan["targets"]): MissionTargetPreviewPlan {
  return {
    taskId: "900001",
    taskName: "选择测试",
    taskSource: "任务表",
    mapId: "1204",
    mapName: "测试地图",
    mapAssetPath: MAP_PATH,
    targets,
    warnings: [],
  };
}

function selection(actors: SelectedLevelActor[]): SelectedLevelActorsResult {
  return {
    mapAssetPath: `${MAP_PATH}.TestMap`,
    actors,
  };
}

describe("classifyMissionTargetSelection", () => {
  it("prefers the generated preview identity and leaves other actors for background review", () => {
    const previewActor = actor(
      "PersistentLevel.ShotSandboxMissionTargetPreview_900001_500001",
      "任务 NPC",
      NPC_CLASS,
      500,
    );
    const propActor = actor(
      "PersistentLevel.StaticMeshActor_1",
      "场景旗帜",
      "/Script/Engine.StaticMeshActor",
      20,
    );

    expect(
      classifyMissionTargetSelection(
        plan([target("500001", 0), target("500002", 100)]),
        selection([previewActor, propActor]),
      ),
    ).toEqual({
      mapMatches: true,
      matches: [
        {
          actorRef: previewActor.actorRef,
          targetId: "500001",
          method: "preview_identity",
        },
      ],
      matchedTargetIds: ["500001"],
      unmatchedActorRefs: [propActor.actorRef],
    });
  });

  it("uses world-space distance to disambiguate repeated model classes", () => {
    const nearSecond = actor("PersistentLevel.Guard_2", "守卫 B", NPC_CLASS, 95);
    const nearFirst = actor("PersistentLevel.Guard_1", "守卫 A", NPC_CLASS, 5);

    const result = classifyMissionTargetSelection(
      plan([target("500001", 0), target("500002", 100)]),
      selection([nearSecond, nearFirst]),
    );

    expect(result.matches).toEqual([
      {
        actorRef: nearSecond.actorRef,
        targetId: "500002",
        method: "model_distance",
      },
      {
        actorRef: nearFirst.actorRef,
        targetId: "500001",
        method: "model_distance",
      },
    ]);
    expect(result.matchedTargetIds).toEqual(["500001", "500002"]);
    expect(result.unmatchedActorRefs).toEqual([]);
  });

  it("does not match task targets from another map", () => {
    const selectedActor = actor(
      "PersistentLevel.ShotSandboxMissionTargetPreview_900001_500001",
      "任务 NPC",
      NPC_CLASS,
      0,
    );
    const result = classifyMissionTargetSelection(
      plan([target("500001", 0)]),
      {
        mapAssetPath: "/Game/Test/Maps/OtherMap",
        actors: [selectedActor],
      },
    );

    expect(result.mapMatches).toBe(false);
    expect(result.matches).toEqual([]);
    expect(result.unmatchedActorRefs).toEqual([selectedActor.actorRef]);
  });
});
