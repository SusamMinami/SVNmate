import { afterEach, describe, expect, it } from "vitest";
import type { MissionTargetPreviewPlan } from "../src/types";
import {
  buildDialogueModelRegistrationSlots,
  buildDialogueModelsForRegistration,
  buildMissionTargetBlueprintComponents,
  clearMissionTargetPreview,
  compareDialogueModelOrder,
  configureUnrealMcpPort,
  getUnrealMcpEndpoint,
  inspectMissionTargetMap,
  inspectMissionTargetBlueprint,
  inspectUnrealMcpConnection,
  loadMissionTargetPreview,
  populateMissionTargetBlueprint,
  readBlueprintFormation,
  readSelectedLevelActors,
  registerBlueprintDialogueModels,
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
  scriptExpressionResult: unknown;
  previewActors: string[];

  constructor(options?: {
    currentMaps?: string[];
    dirtyMaps?: string[];
    assetExists?: boolean;
    blueprintResult?: unknown;
    scriptExpressionResult?: unknown;
    previewActors?: string[];
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
    this.scriptExpressionResult = options?.scriptExpressionResult;
    this.previewActors = [...(options?.previewActors ?? [])];
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
      if (
        String(args.Expression ?? "").includes("get_all_level_actors")
      ) {
        return {
          bSuccess: true,
          Result: `'${JSON.stringify(this.previewActors)}'`,
        };
      }
      if (this.scriptExpressionResult !== undefined) {
        return this.scriptExpressionResult;
      }
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
      const actor = `PersistentLevel.${String(args.ActorName)}`;
      this.previewActors.push(actor);
      return actor;
    }
    if (action === "world.delete_actors") {
      const deleted = new Set((args.Actors as string[]) ?? []);
      this.previewActors = this.previewActors.filter(
        (actor) => !deleted.has(actor),
      );
      return true;
    }
    return true;
  }

  close(): void {
    this.closed = true;
  }
}

class FakeBlueprintPopulateConnection implements UnrealInvoker {
  readonly calls: Array<{
    action: string;
    args: Record<string, unknown>;
  }> = [];
  readonly assetPath =
    "/Game/Seria/Task/Mod/MainQuest/Test/BP_Test.BP_Test";
  readonly classPath = `${this.assetPath}_C`;
  readonly components = new Map<
    string,
    {
      componentClass: string;
      childActorClass: string;
    }
  >();
  connected = false;
  closed = false;
  blueprintExists = true;

  constructor(existingComponentName?: string) {
    if (existingComponentName) {
      this.components.set(existingComponentName, {
        componentClass: "/Script/Engine.ChildActorComponent",
        childActorClass:
          "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
      });
    }
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ action, args });
    if (action === "asset.asset_search") {
      return this.blueprintExists
        ? [`BP_Test [${this.assetPath}]`]
        : [];
    }
    if (action === "bp.get_blueprint_by_path") {
      return this.blueprintExists ? "Blueprint_BP_Test" : null;
    }
    if (action === "bp.get_blueprint_basic_info") {
      return {
        GeneratedClass: this.classPath,
        ParentClass:
          "/Game/Seria/Task/Mod/PositionMode/PositionModeBase.PositionModeBase_C",
      };
    }
    if (action === "asset.get_asset_by_path") {
      return "Blueprint_Model";
    }
    if (
      action === "reflect.read_object_property" &&
      args.ThisPtr === `${this.classPath}:SimpleConstructionScript_0` &&
      args.PropertyName === "AllNodes"
    ) {
      return Array.from(this.components.keys()).map(
        (name) => `SCS_Node_${name}`,
      );
    }
    if (action === "reflect.read_object_property") {
      const object = String(args.ThisPtr);
      const propertyName = String(args.PropertyName);
      if (object.startsWith("SCS_Node_")) {
        const name = object.slice("SCS_Node_".length);
        const component = this.components.get(name)!;
        if (propertyName === "InternalVariableName") {
          return name;
        }
        if (propertyName === "ComponentClass") {
          return component.componentClass;
        }
        if (propertyName === "ComponentTemplate") {
          return `Template_${name}`;
        }
      }
      if (
        object.startsWith("Template_") &&
        propertyName === "ChildActorClass"
      ) {
        return this.components.get(
          object.slice("Template_".length),
        )?.childActorClass;
      }
    }
    if (action === "bp.add_component") {
      this.components.set(String(args.ComponentName), {
        componentClass: String(args.ComponentClass),
        childActorClass: "",
      });
      return true;
    }
    if (
      action === "bp.set_component_property" &&
      args.PropertyName === "ChildActorClass"
    ) {
      this.components.get(String(args.ComponentName))!.childActorClass =
        String(args.Value);
      return true;
    }
    if (action === "bp.compile_blueprint") {
      return { bSuccess: true, Errors: [], Warnings: [] };
    }
    if (action === "bp.save_asset_and_capture_log") {
      return { bSuccess: true, Message: "saved" };
    }
    return true;
  }

  close(): void {
    this.closed = true;
  }
}

class FakeDialogueRegistrationConnection implements UnrealInvoker {
  readonly calls: Array<{
    action: string;
    args: Record<string, unknown>;
  }> = [];
  readonly blueprintAssetPath =
    "/Game/Seria/Task/Mod/MainQuest/Test/BP_735200.BP_735200";
  readonly blueprintClassPath = `${this.blueprintAssetPath}_C`;
  readonly dialogueAssetPath =
    "/Game/Seria/Task/dialoggraph/Test/735200.735200";
  dialogueModels = ["player", "One_Sit", "None", "OldThree"];
  formationClassPath = this.blueprintClassPath;
  commonProperties = [
    { Alias: "Virtual", CurrentBool: true },
    {
      Alias: "PlayerInitPosition",
      CurrentVector: { X: 10, Y: 20, Z: 30 },
    },
    {
      Alias: "PlayerForward",
      CurrentRotator: { Pitch: 0, Yaw: 0, Roll: 0 },
    },
  ];
  connected = false;
  closed = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ action, args });
    if (action === "asset.asset_search") {
      return String(args.Query).startsWith("BP_")
        ? [`BP_735200 [${this.blueprintAssetPath}]`]
        : [`735200 [${this.dialogueAssetPath}]`];
    }
    if (action === "bp.get_blueprint_by_path") {
      return "Blueprint_BP_735200";
    }
    if (action === "bp.get_blueprint_basic_info") {
      return {
        GeneratedClass: this.blueprintClassPath,
        ParentClass:
          "/Game/Seria/Task/Mod/PositionMode/PositionModeBase.PositionModeBase_C",
      };
    }
    if (action === "asset.get_asset_by_path") {
      return String(args.AssetPath).includes("dialoggraph")
        ? "DialogGraph_735200"
        : "Blueprint_Model";
    }
    if (action === "script.eval_python_expression") {
      return {
        bSuccess: true,
        Result: `'${JSON.stringify({
          names: ["One", "One_Sit", "Two"],
          paths: [
            "/Game/Test/BP_One.BP_One_C",
            "/Game/Test/BP_One.BP_One_C",
            "/Game/Test/BP_Two.BP_Two_C",
          ],
        })}'`,
      };
    }
    if (action === "reflect.read_object_property") {
      const object = String(args.ThisPtr);
      const propertyName = String(args.PropertyName);
      if (
        object === `${this.blueprintClassPath}:SimpleConstructionScript_0` &&
        propertyName === "AllNodes"
      ) {
        return ["SCS_Node_0", "SCS_Node_1", "SCS_Node_2", "SCS_Node_3"];
      }
      if (object.startsWith("SCS_Node_")) {
        const modelIndex = Number(object.slice("SCS_Node_".length));
        if (propertyName === "InternalVariableName") {
          return String(modelIndex);
        }
        if (propertyName === "ComponentClass") {
          return "/Script/Engine.ChildActorComponent";
        }
        if (propertyName === "ComponentTemplate") {
          return `Template_${modelIndex}`;
        }
      }
      if (object.startsWith("Template_") && propertyName === "ChildActorClass") {
        return [
          "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
          "/Game/Test/BP_One.BP_One_C",
          "/Game/Test/BP_Two.BP_Two_C",
          "/Game/Test/BP_Three.BP_Three_C",
        ][Number(object.slice("Template_".length))];
      }
      if (object.endsWith(":Dialog Graph") && propertyName === "Nodes") {
        return ["SeriaEdDialogGraphNode_0", "EdGraphNode_Comment_0"];
      }
      if (
        object.endsWith("SeriaEdDialogGraphNode_0") &&
        propertyName === "DialogGraphNodeData"
      ) {
        return "SeriaDialogGraphNodeData_0";
      }
      if (
        object.endsWith("SeriaDialogGraphNodeData_0") &&
        propertyName === "SeriaDialogGraphNodeType"
      ) {
        return "EStart";
      }
      if (
        object.endsWith("SeriaDialogGraphNodeData_0") &&
        propertyName === "DialogModels"
      ) {
        return [...this.dialogueModels];
      }
      if (
        object.endsWith("SeriaDialogGraphNodeData_0") &&
        propertyName === "Formation"
      ) {
        return this.formationClassPath;
      }
      if (
        object.endsWith("SeriaDialogGraphNodeData_0") &&
        propertyName === "CommonDialogGraphProperties"
      ) {
        return this.commonProperties;
      }
      if (
        object.endsWith("SeriaDialogGraphNodeData_0") &&
        propertyName === "SpecialDialogGraphProperties"
      ) {
        return [{ Alias: "Virtual", CurrentBool: true }];
      }
      if (
        object.endsWith("SeriaDialogGraphNodeData_0") &&
        propertyName === "PreviewLevel"
      ) {
        return "/Game/Test/Maps/TestMap.TestMap";
      }
    }
    if (
      action === "reflect.write_object_property" &&
      args.PropertyName === "DialogModels"
    ) {
      this.dialogueModels = [...(args.Value as string[])];
      return true;
    }
    if (
      action === "reflect.write_object_property" &&
      args.PropertyName === "Formation"
    ) {
      this.formationClassPath = String(args.Value);
      return true;
    }
    if (action === "asset.save_asset") {
      return true;
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
  configureUnrealMcpPort(12031);
});

describe("UE editor connection settings", () => {
  it("updates the configured port and verifies the OmniMcpCore protocol", async () => {
    configureUnrealMcpPort(12045);
    const connection = new FakeUnrealConnection();

    const result = await inspectUnrealMcpConnection(() => connection);

    expect(getUnrealMcpEndpoint()).toEqual({
      host: "127.0.0.1",
      port: 12045,
    });
    expect(result).toMatchObject({
      connected: true,
      port: 12045,
      message: expect.stringContaining("当前关卡"),
    });
    expect(connection.closed).toBe(true);
  });

  it("rejects invalid port values", () => {
    expect(() => configureUnrealMcpPort(Number.NaN)).toThrow("1-65535");
    expect(() => configureUnrealMcpPort(65536)).toThrow("1-65535");
  });
});

describe("mission target UE preview", () => {
  it("rediscovers and clears preview actors after server state is lost", async () => {
    const actors = [
      "PersistentLevel.ShotSandboxMissionTargetPreview_900001_500001",
      "PersistentLevel.ShotSandboxMissionTargetPreview_900001_500002",
    ];
    const connection = new FakeUnrealConnection({
      previewActors: actors,
    });

    await expect(
      clearMissionTargetPreview(() => connection),
    ).resolves.toEqual({ clearedCount: 2 });
    expect(
      connection.calls.find((call) => call.action === "world.delete_actors")
        ?.args,
    ).toEqual({ Actors: actors });
    expect(connection.previewActors).toEqual([]);
    expect(
      connection.calls.filter(
        (call) =>
          call.action === "script.eval_python_expression" &&
          String(call.args.Expression).includes("get_all_level_actors"),
      ),
    ).toHaveLength(2);
  });

  it("rejects mixed MapIDs before connecting to Unreal", async () => {
    const plan = previewPlan();
    plan.targets[1].mapId = "1205";
    let createdConnection = false;

    await expect(
      loadMissionTargetPreview(
        { plan, mapMode: "auto" },
        () => {
          createdConnection = true;
          return new FakeUnrealConnection();
        },
      ),
    ).rejects.toThrow("目标物 MapID 不一致");
    expect(createdConnection).toBe(false);
  });

  it("stops before opening another map when the current map is dirty", async () => {
    const connection = new FakeUnrealConnection({
      currentMaps: ["/Game/Seria/Maps/Old/Old"],
      dirtyMaps: ["/Game/Seria/Maps/Old/Old"],
    });

    await expect(
      loadMissionTargetPreview(
        { plan: previewPlan(), mapMode: "auto" },
        () => connection,
      ),
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
      loadMissionTargetPreview(
        { plan: previewPlan(), mapMode: "auto" },
        () => connection,
      ),
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
      { plan: previewPlan(), mapMode: "auto" },
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

  it("removes rediscovered previews before loading replacements", async () => {
    const expectedMap =
      "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea";
    const staleActor =
      "PersistentLevel.ShotSandboxMissionTargetPreview_899999_499999";
    const connection = new FakeUnrealConnection({
      currentMaps: [expectedMap],
      previewActors: [staleActor],
    });

    await loadMissionTargetPreview(
      { plan: previewPlan(), mapMode: "require-current" },
      () => connection,
    );

    expect(
      connection.calls.find((call) => call.action === "world.delete_actors")
        ?.args,
    ).toEqual({ Actors: [staleActor] });
    expect(
      connection.calls.findIndex(
        (call) => call.action === "world.delete_actors",
      ),
    ).toBeLessThan(
      connection.calls.findIndex(
        (call) => call.action === "world.spawn_actor",
      ),
    );
  });

  it("waits for a manual map switch without opening the level", async () => {
    const connection = new FakeUnrealConnection({
      currentMaps: ["/Game/Seria/Maps/Old/Old"],
    });

    await expect(
      loadMissionTargetPreview(
        { plan: previewPlan(), mapMode: "require-current" },
        () => connection,
      ),
    ).rejects.toThrow("UE 尚未切换");
    expect(
      connection.calls.some((call) => call.action === "world.open_level"),
    ).toBe(false);
    expect(
      connection.calls.some((call) => call.action === "world.spawn_actor"),
    ).toBe(false);
  });

  it("reports whether the current UE map matches the target map", async () => {
    const connection = new FakeUnrealConnection({
      currentMaps: ["/Game/Seria/Maps/Old/Old"],
    });

    await expect(
      inspectMissionTargetMap(
        {
          mapAssetPath:
            "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
        },
        () => connection,
      ),
    ).resolves.toEqual({
      currentMapAssetPath: "/Game/Seria/Maps/Old/Old",
      expectedMapAssetPath:
        "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
      matches: false,
    });
  });
});

describe("mission target Blueprint creation", () => {
  it("compares selected model order with the dialogue model slots", () => {
    expect(
      compareDialogueModelOrder(
        ["player", "N111_Aldridge_Sit", "N91_Dolores_sitting"],
        [
          "/Game/N111/BP_N111_Aldridge_Sit.BP_N111_Aldridge_Sit_C",
          "/Game/N91/BP_N91_Dolores_sitting.BP_N91_Dolores_sitting_C",
        ],
      ),
    ).toMatchObject({ matched: true });

    const mismatch = compareDialogueModelOrder(
      ["player", "N111_Aldridge_Sit", "N91_Dolores_sitting"],
      [
        "/Game/N91/BP_N91_Dolores_sitting.BP_N91_Dolores_sitting_C",
        "/Game/N111/BP_N111_Aldridge_Sit.BP_N111_Aldridge_Sit_C",
      ],
    );
    expect(mismatch.matched).toBe(false);
    expect(mismatch.message).toContain("所选目标物顺序");

    expect(
      compareDialogueModelOrder(
        ["player", "N111_Aldridge_Sit", "None", "N91_Dolores_sitting"],
        [
          "/Game/N111/BP_N111_Aldridge_Sit.BP_N111_Aldridge_Sit_C",
          "/Game/N000/BP_Unused.BP_Unused_C",
          "/Game/N91/BP_N91_Dolores_sitting.BP_N91_Dolores_sitting_C",
        ],
        new Set([1, 3]),
      ),
    ).toMatchObject({
      matched: true,
      selectedModels: [
        "n111_aldridge_sit",
        "none",
        "n91_dolores_sitting",
      ],
    });
  });

  it("builds player, ordered targets and camera around the first target", () => {
    const plan = previewPlan();
    const secondTarget = {
      ...plan.targets[0],
      targetId: "500004",
      modelClassPath:
        "/Game/Seria/NPC/Guard/BP_Guard_2.BP_Guard_2_C",
      transform: {
        ...plan.targets[0].transform,
        location: { x: 40, y: 55, z: 10 },
        rotation: { pitch: 1, yaw: 25, roll: 3 },
      },
    };

    const components = buildMissionTargetBlueprintComponents([
      plan.targets[0],
      secondTarget,
    ]);

    expect(components.map((component) => component.componentName)).toEqual([
      "0",
      "1",
      "2",
      "c1",
    ]);
    expect(components[0]).toMatchObject({
      childActorClass:
        "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
      transform: { location: { x: 0, y: 0, z: 100 } },
    });
    expect(components[1].transform.location).toEqual({
      x: 0,
      y: 0,
      z: 100,
    });
    expect(components[2].transform).toMatchObject({
      location: { x: 30, y: 35, z: 80 },
      rotation: { pitch: 1, yaw: 25, roll: 3 },
    });
    expect(components[3]).toMatchObject({
      componentName: "c1",
      componentClass: "/Script/Engine.CameraComponent",
      transform: {
        location: { x: 0, y: 0, z: 99 },
        rotation: { pitch: 0, yaw: -90, roll: 0 },
      },
    });
  });

  it("keeps original model indexes when only some target rows are selected", () => {
    const plan = previewPlan();
    const secondTarget = {
      ...plan.targets[0],
      targetId: "500004",
    };

    const components = buildMissionTargetBlueprintComponents(
      [plan.targets[0], secondTarget],
      [1, 3],
    );

    expect(components.map((component) => component.componentName)).toEqual([
      "0",
      "1",
      "3",
      "c1",
    ]);
  });

  it("populates an existing empty PositionMode Blueprint and saves it", async () => {
    const plan = previewPlan();
    plan.targets = [plan.targets[0]];
    const connection = new FakeBlueprintPopulateConnection();

    const result = await populateMissionTargetBlueprint(
      { blueprintName: "BP_Test", plan },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "created",
      blueprintAssetPath: connection.assetPath,
      targetCount: 1,
      componentNames: ["0", "1", "c1"],
    });
    expect(
      connection.calls
        .filter((call) => call.action === "bp.add_component")
        .map((call) => call.args.ComponentName),
    ).toEqual(["0", "1", "c1"]);
    expect(
      connection.calls.find(
        (call) =>
          call.action === "bp.set_component_property" &&
          call.args.ComponentName === "1" &&
          call.args.PropertyName === "RelativeLocation",
      )?.args.Value,
    ).toBe("(X=0,Y=0,Z=100)");
    expect(
      connection.calls.find(
        (call) => call.action === "bp.save_asset_and_capture_log",
      )?.args.AssetPath,
    ).toBe(connection.assetPath);
    expect(connection.closed).toBe(true);
  });

  it("rejects a missing or already populated Blueprint before writing", async () => {
    const plan = previewPlan();
    plan.targets = [plan.targets[0]];
    const missing = new FakeBlueprintPopulateConnection();
    missing.blueprintExists = false;

    await expect(
      populateMissionTargetBlueprint(
        { blueprintName: "BP_Missing", plan },
        () => missing,
      ),
    ).rejects.toThrow("BP 文件不存在");
    expect(
      missing.calls.some((call) => call.action === "bp.add_component"),
    ).toBe(false);

    const occupied = new FakeBlueprintPopulateConnection("0");
    await expect(
      populateMissionTargetBlueprint(
        { blueprintName: "BP_Test", plan },
        () => occupied,
      ),
    ).rejects.toThrow("BP 已包含站位组件 0");
    expect(
      occupied.calls.some((call) => call.action === "bp.add_component"),
    ).toBe(false);
  });
});

describe("dialogue model registration", () => {
  it("uses DialogNPCTable names, preserves registered aliases and keeps gaps", () => {
    const slots = buildDialogueModelRegistrationSlots(
      [
        {
          modelIndex: 0,
          targetId: null,
          modelClassPath:
            "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
        },
        {
          modelIndex: 1,
          targetId: "500001",
          modelClassPath: "/Game/Test/BP_One.BP_One_C",
        },
        {
          modelIndex: 2,
          targetId: "500002",
          modelClassPath: "/Game/Test/BP_Two.BP_Two_C",
        },
        {
          modelIndex: 3,
          targetId: "500003",
          modelClassPath: "/Game/Test/BP_Missing.BP_Missing_C",
        },
      ],
      ["player", "One_Sit", "None", "None"],
      [
        {
          name: "One",
          characterClassPath: "/Game/Test/BP_One.BP_One_C",
        },
        {
          name: "One_Sit",
          characterClassPath: "/Game/Test/BP_One.BP_One_C",
        },
        {
          name: "Two",
          characterClassPath: "/Game/Test/BP_Two.BP_Two_C",
        },
      ],
    );

    expect(slots.map((slot) => slot.status)).toEqual([
      "registered",
      "registered",
      "available",
      "unmapped",
    ]);
    expect(
      buildDialogueModelsForRegistration(slots, new Set([1, 3])),
    ).toEqual({
      dialogueModels: ["player", "One_Sit", "None", "None"],
      unresolvedIndexes: [3],
    });
  });

  it("inspects populated BP slots and writes selected models to the dialogue", async () => {
    const connection = new FakeDialogueRegistrationConnection();
    const inspection = await inspectMissionTargetBlueprint(
      { blueprintName: "BP_735200" },
      () => connection,
    );

    expect(inspection).toMatchObject({
      blueprintState: "populated",
      dialogueId: "735200",
      slots: [
        { modelIndex: 0, status: "registered" },
        {
          modelIndex: 1,
          existingModelName: "One_Sit",
          status: "registered",
        },
        {
          modelIndex: 2,
          suggestedModelName: "Two",
          status: "available",
        },
        {
          modelIndex: 3,
          existingModelName: "OldThree",
          status: "unmapped",
        },
      ],
    });
    connection.formationClassPath =
      "/Game/Seria/Task/Mod/Legacy/BP_Old.BP_Old_C";

    const result = await registerBlueprintDialogueModels(
      {
        blueprintName: "BP_735200",
        selectedModelIndexes: [1, 2],
      },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "registered",
      dialogueId: "735200",
      dialogueModels: ["player", "One_Sit", "Two", "None"],
      registeredCount: 2,
      emptyCount: 1,
      unresolvedIndexes: [],
      spatialStatus: "unchanged",
      spatialMapAssetPath: "/Game/Test/Maps/TestMap.TestMap",
    });
    expect(
      connection.calls.find(
        (call) => call.action === "reflect.write_object_property",
      )?.args.Value,
    ).toEqual(["player", "One_Sit", "Two", "None"]);
    expect(
      connection.calls.some((call) => call.action === "asset.save_asset"),
    ).toBe(true);
    expect(connection.formationClassPath).toBe(connection.blueprintClassPath);
    expect(
      connection.calls.some(
        (call) =>
          call.action === "script.eval_python_expression" &&
          String(call.args.Expression).includes(
            "get_selected_level_actors",
          ),
      ),
    ).toBe(false);
    expect(connection.closed).toBe(true);
  });
});

describe("UE editor selection", () => {
  it("returns selected actor classes and world transforms", async () => {
    const selectedActors = JSON.stringify([
      {
        actor_ref: "BP_Guard_C_0",
        label: "守卫 A",
        class_path:
          "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
        location: [10, 20, 30],
        rotation: [1, 90, 2],
        scale: [1, 1, 1],
      },
    ]);
    const connection = new FakeUnrealConnection({
      currentMaps: ["/Game/Seria/Maps/Test/Test"],
      scriptExpressionResult: {
        bSuccess: true,
        Result: `'${selectedActors}'`,
      },
    });

    const result = await readSelectedLevelActors(() => connection);

    expect(result).toEqual({
      mapAssetPath: "/Game/Seria/Maps/Test/Test",
      actors: [
        {
          actorRef: "BP_Guard_C_0",
          label: "守卫 A",
          classPath:
            "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
          assetKind: "blueprint_actor",
          assetPath:
            "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard",
          transform: {
            location: { x: 10, y: 20, z: 30 },
            rotation: { pitch: 1, yaw: 90, roll: 2 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ],
    });
    expect(connection.closed).toBe(true);
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
