import { afterEach, describe, expect, it } from "vitest";
import type { MissionTargetPreviewPlan } from "../src/types";
import {
  buildDialogueModelRegistrationSlots,
  buildDialogueModelsForRegistration,
  buildMissionTargetBlueprintComponents,
  clearMissionTargetPreview,
  compareDialogueModelOrder,
  inspectMissionTargetMap,
  inspectMissionTargetBlueprint,
  inspectUnrealMcpConnection,
  loadMissionTargetPreview,
  populateMissionTargetBlueprint,
  readBlueprintFormation,
  readSelectedLevelActors,
  registerBlueprintDialogueModels,
  resetMissionTargetPreviewState,
} from "./ueBridge";
import {
  configureUnrealMcpPort,
  getUnrealMcpEndpoint,
  type UnrealInvoker,
} from "./ue/transport";

class FakeUnrealConnection implements UnrealInvoker {
  readonly calls: Array<{
    action: string;
    args: Record<string, unknown>;
    options?: { timeoutMs?: number };
  }> = [];
  connected = false;
  closed = false;
  currentMaps: string[];
  dirtyMaps: string[];
  assetExists: boolean;
  blueprintResult: unknown;
  scriptExpressionResult: unknown;
  previewActors: string[];
  deleteVisibilityLagReads: number;
  openLevelError: Error | null;
  pendingDeletedActors = new Set<string>();

  constructor(options?: {
    currentMaps?: string[];
    dirtyMaps?: string[];
    assetExists?: boolean;
    blueprintResult?: unknown;
    scriptExpressionResult?: unknown;
    previewActors?: string[];
    deleteVisibilityLagReads?: number;
    openLevelError?: Error;
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
    this.deleteVisibilityLagReads = options?.deleteVisibilityLagReads ?? 0;
    this.openLevelError = options?.openLevelError ?? null;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async invoke(
    action: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown> {
    this.calls.push({ action, args, options });
    if (action === "editor.get_current_map_name") {
      return this.currentMaps.shift() ?? "/Game/Seria/Maps/Test/Test";
    }
    if (action === "script.eval_python_expression") {
      const expression = String(args.Expression ?? "");
      if (
        expression.includes("set_selected_level_actors") &&
        expression.includes("destroy_actor")
      ) {
        const results = this.previewActors.map(() => true);
        const deleted = new Set(this.previewActors);
        if (this.deleteVisibilityLagReads > 0) {
          this.pendingDeletedActors = deleted;
        } else {
          this.previewActors = [];
        }
        return {
          bSuccess: true,
          Result: `'${JSON.stringify(results)}'`,
        };
      }
      if (expression.includes("set_selected_level_actors")) {
        return true;
      }
      if (expression.includes("get_all_level_actors")) {
        if (this.pendingDeletedActors.size > 0) {
          if (this.deleteVisibilityLagReads > 0) {
            this.deleteVisibilityLagReads -= 1;
          } else {
            this.previewActors = this.previewActors.filter(
              (actor) => !this.pendingDeletedActors.has(actor),
            );
            this.pendingDeletedActors.clear();
          }
        }
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
    if (action === "world.open_level" && this.openLevelError) {
      throw this.openLevelError;
    }
    if (action === "world.delete_actors") {
      const deleted = new Set((args.Actors as string[]) ?? []);
      if (this.deleteVisibilityLagReads > 0) {
        this.pendingDeletedActors = deleted;
      } else {
        this.previewActors = this.previewActors.filter(
          (actor) => !deleted.has(actor),
        );
      }
      return true;
    }
    return true;
  }

  close(): void {
    this.closed = true;
  }
}

class FakeFormationConnection implements UnrealInvoker {
  closed = false;

  async connect(): Promise<void> {}

  async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (action === "bp.get_blueprint_by_path") {
      return "Blueprint_BP_736300";
    }
    if (action === "asset.asset_search") {
      return [
        "736300 (SeriaDialogGraph) [/Game/Test/736300.736300]",
      ];
    }
    if (action === "asset.get_asset_by_path") {
      return "DialogGraph_736300";
    }
    if (action !== "reflect.read_object_property") {
      return true;
    }
    const object = String(args.ThisPtr);
    const property = String(args.PropertyName);
    if (
      object.endsWith(":SimpleConstructionScript_0") &&
      property === "AllNodes"
    ) {
      return ["SCS_Node_0", "SCS_Node_1"];
    }
    if (object.startsWith("SCS_Node_")) {
      const index = Number(object.at(-1));
      if (property === "InternalVariableName") {
        return String(index);
      }
      if (property === "ComponentClass") {
        return "/Script/Engine.ChildActorComponent";
      }
      if (property === "ComponentTemplate") {
        return `Template_${index}`;
      }
      if (property === "VariableGuid") {
        return `guid-${index}`;
      }
    }
    if (object.startsWith("Template_")) {
      const index = Number(object.at(-1));
      if (property === "RelativeLocation") {
        return { X: index * 100, Y: index * 50, Z: 100 };
      }
      if (property === "RelativeRotation") {
        return { Pitch: 0, Yaw: index === 0 ? 160 : 60, Roll: 0 };
      }
      if (property === "RelativeScale3D") {
        return { X: 1, Y: 1, Z: 1 };
      }
      if (property === "ChildActorClass") {
        return index === 0
          ? "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C"
          : "/Game/Seria/NPC/N103_Ansel/BP_N103_Ansel.BP_N103_Ansel_C";
      }
    }
    if (object.endsWith(":Dialog Graph") && property === "Nodes") {
      return ["SeriaEdDialogGraphNode_0"];
    }
    if (
      object === "SeriaEdDialogGraphNode_0" &&
      property === "DialogGraphNodeData"
    ) {
      return "StartData";
    }
    if (object === "StartData" && property === "SeriaDialogGraphNodeType") {
      return "EStart";
    }
    if (object === "StartData" && property === "DialogModels") {
      return ["player", "N103_Ansel"];
    }
    throw new Error(`Unhandled fake call: ${action} ${object} ${property}`);
  }

  close(): void {
    this.closed = true;
  }
}

class FakeSharedFormationConnection extends FakeFormationConnection {
  readonly sharedBlueprintAssetPath =
    "/Game/Seria/Task/Mod/Shared/BP_SharedFormation.BP_SharedFormation";
  readonly blueprintRequests: string[] = [];

  override async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (action === "asset.asset_search") {
      return String(args.Query).startsWith("BP_")
        ? []
        : ["736300 (SeriaDialogGraph) [/Game/Test/736300.736300]"];
    }
    if (action === "bp.get_blueprint_by_path") {
      const assetPath = String(args.AssetPath);
      this.blueprintRequests.push(assetPath);
      return assetPath === this.sharedBlueprintAssetPath
        ? "Blueprint_BP_SharedFormation"
        : null;
    }
    if (
      action === "reflect.read_object_property" &&
      args.ThisPtr === "StartData" &&
      args.PropertyName === "Formation"
    ) {
      return `BlueprintGeneratedClass'${this.sharedBlueprintAssetPath}_C'`;
    }
    return super.invoke(action, args);
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

class FakeBlueprintPopulateWithDialogueConnection extends FakeBlueprintPopulateConnection {
  readonly dialogueAssetPath =
    "/Game/Seria/Task/dialoggraph/Test/735200.735200";
  dialogueModels = ["player", "Guard", "Unused", "Selected"];
  formationClassPath = "None";
  commonProperties = [
    { Alias: "Virtual", CurrentBool: true },
    {
      Alias: "PlayerInitPosition",
      CurrentVector: { X: 10, Y: 20, Z: -70 },
    },
    {
      Alias: "PlayerForward",
      CurrentRotator: { Pitch: 0, Yaw: 0, Roll: 0 },
    },
  ];
  specialProperties = [{ Alias: "Virtual", CurrentBool: true }];
  previewLevel =
    "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea.08_01_UrbanArea";

  override async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (action === "asset.asset_search" && args.Query === "735200") {
      this.calls.push({ action, args });
      return [`735200 [${this.dialogueAssetPath}]`];
    }
    if (action === "script.eval_python_expression") {
      this.calls.push({ action, args });
      const expression = String(args.Expression);
      if (expression.includes("get_data_table_row_names")) {
        return {
          bSuccess: true,
          Result: `'${JSON.stringify({
            names: ["Guard", "Unused", "Selected"],
            paths: [
              "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
              "/Game/Seria/NPC/Unused/BP_Unused.BP_Unused_C",
              "/Game/Seria/NPC/Selected/BP_Selected.BP_Selected_C",
            ],
          })}'`,
        };
      }
      return { bSuccess: true, Result: "'[]'" };
    }
    if (action === "reflect.read_object_property") {
      const object = String(args.ThisPtr);
      const propertyName = String(args.PropertyName);
      if (object.endsWith(":Dialog Graph") && propertyName === "Nodes") {
        this.calls.push({ action, args });
        return ["SeriaEdDialogGraphNode_0"];
      }
      if (
        object.endsWith("SeriaEdDialogGraphNode_0") &&
        propertyName === "DialogGraphNodeData"
      ) {
        this.calls.push({ action, args });
        return "SeriaDialogGraphNodeData_0";
      }
      if (object.endsWith("SeriaDialogGraphNodeData_0")) {
        this.calls.push({ action, args });
        if (propertyName === "SeriaDialogGraphNodeType") {
          return "EStart";
        }
        if (propertyName === "DialogModels") {
          return [...this.dialogueModels];
        }
        if (propertyName === "Formation") {
          return this.formationClassPath;
        }
        if (propertyName === "CommonDialogGraphProperties") {
          return structuredClone(this.commonProperties);
        }
        if (propertyName === "SpecialDialogGraphProperties") {
          return structuredClone(this.specialProperties);
        }
        if (propertyName === "PreviewLevel") {
          return this.previewLevel;
        }
      }
    }
    if (action === "reflect.write_object_property") {
      this.calls.push({ action, args });
      if (args.PropertyName === "DialogModels") {
        this.dialogueModels = [...(args.Value as string[])];
      }
      if (args.PropertyName === "Formation") {
        this.formationClassPath = String(args.Value);
      }
      if (args.PropertyName === "CommonDialogGraphProperties") {
        this.commonProperties = structuredClone(
          args.Value as typeof this.commonProperties,
        );
      }
      if (args.PropertyName === "SpecialDialogGraphProperties") {
        this.specialProperties = structuredClone(
          args.Value as typeof this.specialProperties,
        );
      }
      if (args.PropertyName === "PreviewLevel") {
        this.previewLevel = String(args.Value);
      }
      return true;
    }
    if (action === "asset.save_asset") {
      this.calls.push({ action, args });
      return true;
    }
    return super.invoke(action, args);
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
  previewLevel = "/Game/Test/Maps/TestMap.TestMap";
  commonProperties = [
    { Alias: "Virtual", CurrentBool: true },
    {
      Alias: "PlayerInitPosition",
      CurrentVector: { X: 10, Y: 20, Z: 30 },
    },
    {
      Alias: "PlayerForward",
      CurrentRotator: { Pitch: 0, Yaw: 90, Roll: 0 },
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
      const query = String(args.Query);
      return query.startsWith("BP_")
        ? [`BP_735200 [${this.blueprintAssetPath}]`]
        : [
            `${query} [/Game/Seria/Task/dialoggraph/Test/${query}.${query}]`,
          ];
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
      if (object.startsWith("Template_") && propertyName === "RelativeLocation") {
        const modelIndex = Number(object.slice("Template_".length));
        return { X: modelIndex * 100, Y: 0, Z: 100 };
      }
      if (object.startsWith("Template_") && propertyName === "RelativeRotation") {
        const modelIndex = Number(object.slice("Template_".length));
        return { Pitch: 0, Yaw: modelIndex * 15, Roll: 0 };
      }
      if (object.startsWith("Template_") && propertyName === "RelativeScale3D") {
        return { X: 1, Y: 1, Z: 1 };
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
        return this.previewLevel;
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
      connection.calls.some(
        (call) =>
          call.action === "script.eval_python_expression" &&
          String(call.args.Expression).includes(
            "set_selected_level_actors(selected)",
          ) &&
          String(call.args.Expression).includes("destroy_actor(actor)"),
      ),
    ).toBe(true);
    expect(
      connection.calls.some((call) => call.action === "world.delete_actors"),
    ).toBe(false);
    expect(connection.previewActors).toEqual([]);
    expect(
      connection.calls.filter(
        (call) =>
          call.action === "script.eval_python_expression" &&
          String(call.args.Expression).includes("[a.get_path_name()"),
      ),
    ).toHaveLength(2);
  });

  it("waits for UE to stop enumerating actors after deletion", async () => {
    const actor =
      "PersistentLevel.ShotSandboxMissionTargetPreview_900001_500001";
    const connection = new FakeUnrealConnection({
      previewActors: [actor],
      deleteVisibilityLagReads: 2,
    });

    await expect(
      clearMissionTargetPreview(() => connection),
    ).resolves.toEqual({ clearedCount: 1 });
    expect(connection.previewActors).toEqual([]);
    expect(
      connection.calls.filter(
        (call) =>
          call.action === "script.eval_python_expression" &&
          String(call.args.Expression).includes("[a.get_path_name()"),
      ),
    ).toHaveLength(4);
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
      connection.calls.find((call) => call.action === "world.open_level")
        ?.options?.timeoutMs,
    ).toBe(180_000);
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

  it("selects dialogue-position preview actors for NPC registration", async () => {
    const plan = previewPlan();
    plan.dialogueTimeline = {
      nodeCount: 4,
      finalDialogueId: "900004",
      adjustedCharacterCount: 1,
      movementActionCount: 2,
      rotationActionCount: 1,
    };
    plan.targets[0].blueprintModelId = 1;
    plan.targets[0].dialogueAdjustment = {
      initialTransform: {
        location: { x: 0, y: 0, z: 30 },
        rotation: { pitch: 0, yaw: 0, roll: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      movementActionCount: 2,
      rotationActionCount: 1,
      positionDelta: 22.361,
      rotationDelta: 90,
      lastAdjustedDialogueId: "900004",
    };
    const connection = new FakeUnrealConnection({
      currentMaps: [plan.mapAssetPath],
    });

    const result = await loadMissionTargetPreview(
      { plan, mapMode: "require-current" },
      () => connection,
    );

    expect(result.selectedActorCount).toBe(1);
    expect(
      connection.calls.some(
        (call) =>
          call.action === "script.eval_python_expression" &&
          String(call.args.Expression).includes(
            "set_selected_level_actors",
          ) &&
          String(call.args.Expression).includes(
            "ShotSandboxMissionTargetPreview_900001_500001",
          ) &&
          !String(call.args.Expression).includes("destroy_actor"),
      ),
    ).toBe(true);
  });

  it("explains that UE may still be loading when the map request disconnects", async () => {
    const connection = new FakeUnrealConnection({
      currentMaps: ["/Game/Seria/Maps/Old/Old"],
      openLevelError: new Error("UE 编辑器连接已关闭"),
    });

    await expect(
      loadMissionTargetPreview(
        { plan: previewPlan(), mapMode: "auto" },
        () => connection,
      ),
    ).rejects.toThrow("加载期间通信暂时不可用");
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

    const deletionCallIndex = connection.calls.findIndex(
      (call) =>
        call.action === "script.eval_python_expression" &&
        String(call.args.Expression).includes(
          "set_selected_level_actors(selected)",
        ) &&
        String(call.args.Expression).includes("destroy_actor(actor)"),
    );
    expect(deletionCallIndex).toBeGreaterThan(-1);
    expect(deletionCallIndex).toBeLessThan(
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

  it("loads dialogue positions into the current map without checking PreviewLevel", async () => {
    const connection = new FakeUnrealConnection({
      currentMaps: ["/Game/Seria/Maps/Current/Current"],
    });
    const plan = previewPlan();
    plan.mapName = "当前 UE 关卡";
    plan.mapAssetPath = "/Game/CurrentLevel";

    const result = await loadMissionTargetPreview(
      { plan, mapMode: "current" },
      () => connection,
    );

    expect(result).toMatchObject({
      mapAssetPath: "/Game/Seria/Maps/Current/Current",
      autoOpenedMap: false,
      spawnedCount: 2,
    });
    expect(
      connection.calls.some((call) => call.action === "world.open_level"),
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

  it("matches a short World_ map name to the configured level asset", async () => {
    const connection = new FakeUnrealConnection({
      currentMaps: ["World_08_01_UrbanArea"],
    });

    await expect(
      inspectMissionTargetMap(
        {
          mapAssetPath:
            "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
        },
        () => connection,
      ),
    ).resolves.toMatchObject({
      currentMapAssetPath: "World_08_01_UrbanArea",
      matches: true,
    });
  });
});

describe("mission target Blueprint creation", () => {
  it("compares selected model order with the dialogue model slots", () => {
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
        ["player", "N111_Aldridge_Sit", "N91_Dolores_sitting"],
        [
          "/Game/N111/BP_N111_Aldridge_Sit.BP_N111_Aldridge_Sit_C",
          "/Game/N91/BP_N91_Dolores_sitting.BP_N91_Dolores_sitting_C",
        ],
      ),
    ).toMatchObject({
      matched: true,
      selectedModels: [
        "n111_aldridge_sit",
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

  it("writes selected targets in request order without changing the task anchor", async () => {
    const plan = previewPlan();
    const unselectedTarget = {
      ...plan.targets[0],
      targetId: "500004",
      modelClassPath:
        "/Game/Seria/NPC/Unused/BP_Unused.BP_Unused_C",
    };
    const selectedTarget = {
      ...plan.targets[0],
      targetId: "500005",
      modelClassPath:
        "/Game/Seria/NPC/Selected/BP_Selected.BP_Selected_C",
      transform: {
        ...plan.targets[0].transform,
        location: { x: 40, y: 55, z: 10 },
      },
    };
    plan.targets = [plan.targets[0], unselectedTarget, selectedTarget];
    const connection = new FakeBlueprintPopulateConnection();

    const result = await populateMissionTargetBlueprint(
      {
        blueprintName: "BP_Test",
        plan,
        selectedTargetIds: ["500005", "500001"],
      },
      () => connection,
    );

    expect(result).toMatchObject({
      targetCount: 2,
      componentNames: ["0", "1", "2", "c1"],
    });
    expect(connection.components.get("1")?.childActorClass).toBe(
      selectedTarget.modelClassPath,
    );
    expect(connection.components.get("2")?.childActorClass).toBe(
      plan.targets[0].modelClassPath,
    );
    expect(
      connection.calls.find(
        (call) =>
          call.action === "bp.set_component_property" &&
          call.args.ComponentName === "1" &&
          call.args.PropertyName === "RelativeLocation",
      )?.args.Value,
    ).toBe("(X=30,Y=35,Z=80)");
    expect(
      connection.calls.find(
        (call) =>
          call.action === "bp.set_component_property" &&
          call.args.ComponentName === "2" &&
          call.args.PropertyName === "RelativeLocation",
      )?.args.Value,
    ).toBe("(X=0,Y=0,Z=100)");
    expect(
      connection.calls.find(
        (call) =>
          call.action === "bp.set_component_property" &&
          call.args.ComponentName === "1" &&
          call.args.PropertyName === "RelativeLocation",
      ),
    ).toBeDefined();
    expect(
      Array.from(connection.components.values()).some(
        (component) =>
          component.childActorClass === unselectedTarget.modelClassPath,
      ),
    ).toBe(false);
  });

  it("rejects duplicate selected target IDs", async () => {
    const plan = previewPlan();
    const connection = new FakeBlueprintPopulateConnection();

    await expect(
      populateMissionTargetBlueprint(
        {
          blueprintName: "BP_Test",
          plan,
          selectedTargetIds: ["500001", "500001"],
        },
        () => connection,
      ),
    ).rejects.toThrow("所选目标物中存在重复 ID");
    expect(connection.connected).toBe(false);
  });

  it("omits unselected targets from both the BP and DialogModels", async () => {
    const plan = previewPlan();
    const unselectedTarget = {
      ...plan.targets[0],
      targetId: "500004",
      modelClassPath:
        "/Game/Seria/NPC/Unused/BP_Unused.BP_Unused_C",
    };
    const selectedTarget = {
      ...plan.targets[0],
      targetId: "500005",
      modelClassPath:
        "/Game/Seria/NPC/Selected/BP_Selected.BP_Selected_C",
    };
    plan.targets = [plan.targets[0], unselectedTarget, selectedTarget];
    const connection = new FakeBlueprintPopulateWithDialogueConnection();

    const result = await populateMissionTargetBlueprint(
      {
        blueprintName:
          "/Game/Seria/Task/Mod/MainQuest/Test/BP_735200.BP_735200",
        plan,
        selectedTargetIds: ["500001", "500005"],
        registerDialogue: true,
      },
      () => connection,
    );

    expect(result).toMatchObject({
      targetCount: 2,
      componentNames: ["0", "1", "2", "c1"],
      dialogueRegistration: {
        dialogueModels: ["player", "Guard", "Selected"],
        registeredCount: 2,
        emptyCount: 0,
      },
    });
    expect(connection.dialogueModels).toEqual([
      "player",
      "Guard",
      "Selected",
    ]);
    expect(connection.dialogueModels).not.toContain("None");
    expect(connection.dialogueModels).not.toContain("Unused");
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

  it("maps an _Npc Blueprint to its unique base DialogNPCTable row name", () => {
    const classPath =
      "/Game/Seria/NPC/N07_Elly/BP_N07_Elly_Npc.BP_N07_Elly_Npc_C";
    const [slot] = buildDialogueModelRegistrationSlots(
      [
        {
          modelIndex: 1,
          targetId: "500001",
          modelClassPath: classPath,
        },
      ],
      ["player", "None"],
      [
        {
          name: "N07_Elly",
          characterClassPath: classPath,
        },
        {
          name: "TransportShip",
          characterClassPath: classPath,
        },
      ],
    );

    expect(slot).toMatchObject({
      status: "available",
      suggestedModelName: "N07_Elly",
      candidateModelNames: ["N07_Elly", "TransportShip"],
    });
  });

  it("inspects populated BP slots and writes selected models to the dialogue", async () => {
    const connection = new FakeDialogueRegistrationConnection();
    const inspection = await inspectMissionTargetBlueprint(
      { blueprintName: "7352" },
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
      dialoguePreviewPlan: undefined,
      dialoguePreviewBlockedReasons: [],
    });
    expect(
      connection.calls.find(
        (call) =>
          call.action === "asset.asset_search" &&
          String(call.args.Query).startsWith("BP_"),
      )?.args.Query,
    ).toBe("BP_735200");
    connection.formationClassPath =
      "/Game/Seria/Task/Mod/Legacy/BP_Old.BP_Old_C";

    const result = await registerBlueprintDialogueModels(
      {
        blueprintName: "7352",
        selectedModelIndexes: [1, 2],
      },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "registered",
      dialogueId: "735200",
      dialogueModels: ["player", "One_Sit", "Two", "None"],
      registeredCount: 2,
      characterCount: 3,
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

  it("does not inspect spatial fields for the four-digit registration flow", async () => {
    const connection = new FakeDialogueRegistrationConnection();
    connection.commonProperties = connection.commonProperties.map(
      (property) =>
        property.Alias === "PlayerInitPosition"
          ? { Alias: "PlayerInitPosition" }
          : property,
    );

    const inspection = await inspectMissionTargetBlueprint(
      { blueprintName: "7352" },
      () => connection,
    );

    expect(inspection.dialoguePreviewPlan).toBeUndefined();
    expect(inspection.dialoguePreviewBlockedReasons).toEqual([]);
    expect(inspection.message).not.toContain("暂不能加载模型");
  });

  it("rejects a six-digit dialogue node in the BP input", async () => {
    const connection = new FakeDialogueRegistrationConnection();

    await expect(
      inspectMissionTargetBlueprint(
        { blueprintName: "735201" },
        () => connection,
      ),
    ).rejects.toThrow("六位对话节点 ID 请填写到展开的对话节点输入框");
  });

  it("applies dialogue actions through the requested six-digit node without requiring PreviewLevel", async () => {
    const connection = new FakeDialogueRegistrationConnection();
    connection.previewLevel = "None";
    const inspection = await inspectMissionTargetBlueprint(
      {
        blueprintName: "7352",
        dialogueId: "735200",
        dialogueTimeline: [
          {
            id: "735200",
            characterBehaviourString: "",
            relativeTransformsString:
              "0|1,0,0,0,0,0,0;1|1,0,0,0,0,0,0",
          },
          {
            id: "735201",
            characterBehaviourString:
              ";0,AM_Walk,2,100,0,100,200,100,100,0|0,AM_TurnRight45,1,0,0,0,0,0,0,0",
            relativeTransformsString:
              "0|1,0,0,0,0,0,0;1|1,0,0,0,0,0,0",
          },
        ],
      },
      () => connection,
    );

    expect(inspection.dialoguePreviewPlan?.dialogueTimeline).toEqual({
      nodeCount: 2,
      finalDialogueId: "735201",
      adjustedCharacterCount: 1,
      movementActionCount: 1,
      rotationActionCount: 1,
    });
    expect(inspection.dialoguePreviewPlan).toMatchObject({
      mapName: "当前 UE 关卡",
      mapAssetPath: "/Game/CurrentLevel",
    });
    expect(inspection.dialoguePreviewPlan?.targets[1]).toMatchObject({
      targetId: "1",
      transform: {
        location: { x: -90, y: 220, z: 130 },
        rotation: { pitch: 0, yaw: 180, roll: 0 },
      },
      dialogueAdjustment: {
        movementActionCount: 1,
        rotationActionCount: 1,
        rotationDelta: 75,
        lastAdjustedDialogueId: "735201",
      },
    });
    expect(
      inspection.dialoguePreviewPlan?.targets[1].dialogueAdjustment
        ?.positionDelta,
    ).toBeCloseTo(141.421, 3);
    expect(
      inspection.dialoguePreviewPlan?.targets[1].dialogueAdjustment
        ?.initialTransform,
    ).toMatchObject({
      location: { x: 10, y: 120, z: 130 },
      rotation: { pitch: 0, yaw: 105, roll: 0 },
    });
    expect(
      connection.calls.find(
        (call) =>
          call.action === "asset.asset_search" &&
          String(call.args.Query).startsWith("BP_"),
      )?.args.Query,
    ).toBe("BP_735200");
  });

  it("uses an explicit dialogue ID when a shared BP belongs to another dialogue", async () => {
    const connection = new FakeDialogueRegistrationConnection();

    const inspection = await inspectMissionTargetBlueprint(
      { blueprintName: "7352", dialogueId: "846500" },
      () => connection,
    );
    const result = await registerBlueprintDialogueModels(
      {
        blueprintName: "7352",
        dialogueId: "846500",
        selectedModelIndexes: [1, 2],
      },
      () => connection,
    );

    expect(inspection).toMatchObject({
      dialogueId: "846500",
      dialogueAssetPath:
        "/Game/Seria/Task/dialoggraph/Test/846500.846500",
    });
    expect(result).toMatchObject({
      dialogueId: "846500",
      dialogueAssetPath:
        "/Game/Seria/Task/dialoggraph/Test/846500.846500",
    });
    expect(
      connection.calls.some(
        (call) =>
          call.action === "asset.asset_search" &&
          call.args.Query === "846500",
      ),
    ).toBe(true);
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
        parent_class_path:
          "/Game/Seria/NPC/Base/NpcBase.NpcBase_C",
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
          parentClassPath:
            "/Game/Seria/NPC/Base/NpcBase.NpcBase_C",
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
  it("falls back to the dialogue Formation when the matching BP name is absent", async () => {
    const connection = new FakeSharedFormationConnection();

    const result = await readBlueprintFormation(
      {
        dialogueId: "7363",
        startId: "736300",
      },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "found",
      snapshot: {
        blueprintAssetPath: connection.sharedBlueprintAssetPath,
        dialogueModels: ["player", "N103_Ansel"],
      },
    });
    expect(connection.blueprintRequests).toContain(
      connection.sharedBlueprintAssetPath,
    );
    expect(connection.closed).toBe(true);
  });

  it("reads numeric slot rotations and dialogue model registration", async () => {
    const connection = new FakeFormationConnection();

    const result = await readBlueprintFormation(
      {
        dialogueId: "7363",
        startId: "736300",
        formationClassPath:
          "/Game/Seria/Task/Mod/MainQuest/Cha9/BP_736300.BP_736300_C",
      },
      () => connection,
    );

    expect(result.snapshot).toMatchObject({
      dialogueModels: ["player", "N103_Ansel"],
      slots: [
        {
          modelIndex: 0,
          transform: { rotation: { pitch: 0, yaw: 160, roll: 0 } },
        },
        {
          modelIndex: 1,
          transform: { rotation: { pitch: 0, yaw: 60, roll: 0 } },
        },
      ],
    });
    expect(connection.closed).toBe(true);
  });

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
