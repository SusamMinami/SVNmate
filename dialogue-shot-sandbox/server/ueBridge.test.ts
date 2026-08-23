import { afterEach, describe, expect, it } from "vitest";
import type { MissionTargetPreviewPlan } from "../src/types";
import {
  loadMissionTargetPreview,
  readBlueprintFormation,
  resetMissionTargetPreviewState,
  type UnrealInvoker,
} from "./ueBridge";

class FakeUnrealConnection implements UnrealInvoker {
  readonly calls: Array<{
    action: string;
    args: Record<string, unknown>;
  }> = [];
  connected = false;
  closed = false;
  currentMaps: string[];
  dirtyMaps: string[];
  assetExists: boolean;
  blueprintResult: unknown;

  constructor(options?: {
    currentMaps?: string[];
    dirtyMaps?: string[];
    assetExists?: boolean;
    blueprintResult?: unknown;
  }) {
    this.currentMaps = options?.currentMaps ?? [
      "/Game/Seria/Maps/Test/Test",
    ];
    this.dirtyMaps = options?.dirtyMaps ?? [];
    this.assetExists = options?.assetExists ?? true;
    this.blueprintResult =
      options && "blueprintResult" in options
        ? options.blueprintResult
        : true;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ action, args });
    if (action === "editor.get_current_map_name") {
      return this.currentMaps.shift() ?? "/Game/Seria/Maps/Test/Test";
    }
    if (action === "script.eval_python_expression") {
      return {
        bSuccess: true,
        Result: `'${JSON.stringify(this.dirtyMaps)}'`,
      };
    }
    if (action === "asset.get_asset_by_path") {
      return this.assetExists ? "Blueprint_Test" : null;
    }
    if (action === "bp.get_blueprint_by_path") {
      return this.blueprintResult;
    }
    if (action === "world.spawn_actor") {
      return `Actor_${String(args.ActorName)}`;
    }
    return true;
  }

  close(): void {
    this.closed = true;
  }
}

function previewPlan(): MissionTargetPreviewPlan {
  return {
    taskId: "900001",
    taskName: "测试任务",
    taskSource: "任务表",
    mapId: "1204",
    mapName: "上城区",
    mapAssetPath:
      "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
    warnings: [],
    targets: [
      {
        targetId: "500001",
        type: 1,
        description: "守卫",
        npcId: 1001,
        npcName: "守卫",
        modelId: 200001,
        modelClassPath:
          "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
        itemId: 0,
        blueprintModelId: null,
        mapId: "1204",
        previewKind: "asset",
        transform: {
          location: { x: 10, y: 20, z: 30 },
          rotation: { pitch: 0, yaw: 90, roll: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      {
        targetId: "500002",
        type: 3,
        description: "触发区域",
        npcId: 0,
        npcName: "",
        modelId: null,
        modelClassPath: "",
        itemId: 0,
        blueprintModelId: null,
        mapId: "1204",
        previewKind: "marker",
        transform: {
          location: { x: 40, y: 50, z: 60 },
          rotation: { pitch: 0, yaw: 0, roll: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ],
  };
}

afterEach(() => {
  resetMissionTargetPreviewState();
});

describe("mission target UE preview", () => {
  it("rejects mixed MapIDs before connecting to Unreal", async () => {
    const plan = previewPlan();
    plan.targets[1].mapId = "1205";
    let createdConnection = false;

    await expect(
      loadMissionTargetPreview(plan, () => {
        createdConnection = true;
        return new FakeUnrealConnection();
      }),
    ).rejects.toThrow("目标物 MapID 不一致");
    expect(createdConnection).toBe(false);
  });

  it("stops before opening another map when the current map is dirty", async () => {
    const connection = new FakeUnrealConnection({
      currentMaps: ["/Game/Seria/Maps/Old/Old"],
      dirtyMaps: ["/Game/Seria/Maps/Old/Old"],
    });

    await expect(
      loadMissionTargetPreview(previewPlan(), () => connection),
    ).rejects.toThrow("当前关卡存在未保存修改");
    expect(
      connection.calls.some((call) => call.action === "world.open_level"),
    ).toBe(false);
    expect(
      connection.calls.some((call) => call.action === "world.spawn_actor"),
    ).toBe(false);
  });

  it("checks every model asset before changing maps", async () => {
    const connection = new FakeUnrealConnection({
      currentMaps: ["/Game/Seria/Maps/Old/Old"],
      assetExists: false,
    });

    await expect(
      loadMissionTargetPreview(previewPlan(), () => connection),
    ).rejects.toThrow("模型资产不存在");
    expect(
      connection.calls.some((call) => call.action === "world.open_level"),
    ).toBe(false);
    expect(
      connection.calls.some((call) => call.action === "world.spawn_actor"),
    ).toBe(false);
  });

  it("opens the configured map and loads asset and marker previews", async () => {
    const expectedMap =
      "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea";
    const connection = new FakeUnrealConnection({
      currentMaps: ["/Game/Seria/Maps/Old/Old", expectedMap],
    });

    const result = await loadMissionTargetPreview(
      previewPlan(),
      () => connection,
    );

    expect(result).toMatchObject({
      status: "loaded",
      autoOpenedMap: true,
      spawnedCount: 2,
      assetCount: 1,
      markerCount: 1,
    });
    expect(
      connection.calls.find((call) => call.action === "world.open_level")
        ?.args,
    ).toEqual({ LevelName: expectedMap });
    expect(
      connection.calls
        .filter((call) => call.action === "world.spawn_actor")
        .map((call) => call.args.ClassPath),
    ).toEqual([
      "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
      "/Script/Engine.TargetPoint",
    ]);
    expect(
      connection.calls.filter(
        (call) => call.action === "reflect.write_object_property",
      ),
    ).toHaveLength(2);
  });
});

describe("Blueprint formation lookup", () => {
  it.each(["", "None", "null", "nullptr", "0", null, false])(
    "treats Unreal empty object value %p as a missing Blueprint",
    async (blueprintResult) => {
      const connection = new FakeUnrealConnection({ blueprintResult });

      const result = await readBlueprintFormation(
        {
          dialogueId: "7350",
          startId: "735000",
          formationClassPath:
            "/Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000.BP_735000_C",
        },
        () => connection,
      );

      expect(result).toMatchObject({
        status: "not_found",
        message: expect.stringContaining("UE 中未找到"),
      });
      expect(
        connection.calls.some(
          (call) => call.action === "reflect.read_object_property",
        ),
      ).toBe(false);
      expect(connection.closed).toBe(true);
    },
  );
});
