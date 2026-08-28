import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MissionTargetPreviewPlan } from "../src/types";
import { configureConfigCsvDirectory } from "./configRepository";
import {
  appendMissionTargetBlueprint,
  applyBackgroundPropImport,
  inspectBackgroundPropImport,
  inspectMissionTargetBlueprint,
  registerBlueprintDialogueModels,
  syncBlueprintPositionsToMissionTargets,
  updateMissionTargetBlueprintPositions,
} from "./ueBridge";
import type { UnrealInvoker } from "./ue/transport";

let temporaryRoot = "";

function parseVector(value: string) {
  const number = (name: string) =>
    Number(value.match(new RegExp(`${name}=(-?[\\d.]+)`))?.[1] ?? 0);
  return { X: number("X"), Y: number("Y"), Z: number("Z") };
}

function parseRotator(value: string) {
  const number = (name: string) =>
    Number(value.match(new RegExp(`${name}=(-?[\\d.]+)`))?.[1] ?? 0);
  return {
    Pitch: number("Pitch"),
    Yaw: number("Yaw"),
    Roll: number("Roll"),
  };
}

class BlueprintSyncConnection implements UnrealInvoker {
  readonly blueprintAssetPath =
    "/Game/Seria/Task/Mod/Test/BP_735200.BP_735200";
  readonly blueprintClassPath = `${this.blueprintAssetPath}_C`;
  readonly dialogueAssetPath =
    "/Game/Seria/Task/dialoggraph/Test/735200.735200";
  readonly calls: Array<{
    action: string;
    args: Record<string, unknown>;
  }> = [];
  componentLocation = { X: 0, Y: 0, Z: 100 };
  componentRotation = { Pitch: 0, Yaw: 0, Roll: 0 };
  dialogueModels = ["player", "Guard"];
  formationClassPath = this.blueprintClassPath;
  commonProperties: Array<Record<string, unknown>> = [
    { Alias: "Virtual", CurrentBool: false },
    {
      Alias: "PlayerInitPosition",
      CurrentVector: { X: 100, Y: 200, Z: 200 },
    },
    {
      Alias: "PlayerForward",
      CurrentRotator: { Pitch: 0, Yaw: 0, Roll: 0 },
    },
  ];
  specialProperties: Array<Record<string, unknown>> = [
    { Alias: "Virtual", CurrentBool: false },
  ];
  previewLevel = "";
  selectedPlacementActors: Array<Record<string, unknown>> = [];
  levelPlacementActors: Array<Record<string, unknown>> = [];

  async connect(): Promise<void> {}

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
      const expression = String(args.Expression);
      if (expression.includes("get_data_table_row_names")) {
        return {
          bSuccess: true,
          Result: `'${JSON.stringify({
            names: ["Guard"],
            paths: ["/Game/Test/BP_Guard.BP_Guard_C"],
          })}'`,
        };
      }
      if (expression.includes("get_selected_level_actors")) {
        return {
          bSuccess: true,
          Result: `'${JSON.stringify(this.selectedPlacementActors)}'`,
        };
      }
      if (expression.includes("get_all_level_actors")) {
        return {
          bSuccess: true,
          Result: `'${JSON.stringify(this.levelPlacementActors)}'`,
        };
      }
      return { bSuccess: true, Result: "'[]'" };
    }
    if (action === "editor.get_current_map_name") {
      return "/Game/Test/Maps/PlacedMap";
    }
    if (action === "reflect.read_object_property") {
      const object = String(args.ThisPtr);
      const property = String(args.PropertyName);
      if (
        object === `${this.blueprintClassPath}:SimpleConstructionScript_0` &&
        property === "AllNodes"
      ) {
        return ["SCS_Node_0", "SCS_Node_1"];
      }
      if (object.startsWith("SCS_Node_")) {
        const index = Number(object.slice("SCS_Node_".length));
        if (property === "InternalVariableName") {
          return String(index);
        }
        if (property === "ComponentClass") {
          return "/Script/Engine.ChildActorComponent";
        }
        if (property === "ComponentTemplate") {
          return `Template_${index}`;
        }
      }
      if (object.startsWith("Template_")) {
        const index = Number(object.slice("Template_".length));
        if (property === "ChildActorClass") {
          return index === 0
            ? "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C"
            : "/Game/Test/BP_Guard.BP_Guard_C";
        }
        if (property === "RelativeLocation") {
          return index === 0
            ? { X: 0, Y: 0, Z: 100 }
            : this.componentLocation;
        }
        if (property === "RelativeRotation") {
          return index === 0
            ? { Pitch: 0, Yaw: 0, Roll: 0 }
            : this.componentRotation;
        }
        if (property === "RelativeScale3D") {
          return { X: 1, Y: 1, Z: 1 };
        }
      }
      if (object.endsWith(":Dialog Graph") && property === "Nodes") {
        return ["SeriaEdDialogGraphNode_0"];
      }
      if (
        object.endsWith("SeriaEdDialogGraphNode_0") &&
        property === "DialogGraphNodeData"
      ) {
        return "SeriaDialogGraphNodeData_0";
      }
      if (
        object.endsWith("SeriaDialogGraphNodeData_0") &&
        property === "SeriaDialogGraphNodeType"
      ) {
        return "EStart";
      }
      if (object.endsWith("SeriaDialogGraphNodeData_0")) {
        if (property === "DialogModels") {
          return [...this.dialogueModels];
        }
        if (property === "Formation") {
          return this.formationClassPath;
        }
        if (property === "CommonDialogGraphProperties") {
          return structuredClone(this.commonProperties);
        }
        if (property === "SpecialDialogGraphProperties") {
          return structuredClone(this.specialProperties);
        }
        if (property === "PreviewLevel") {
          return this.previewLevel;
        }
      }
    }
    if (action === "bp.set_component_property") {
      if (
        args.ComponentName === "1" &&
        args.PropertyName === "RelativeLocation"
      ) {
        this.componentLocation = parseVector(String(args.Value));
      }
      if (
        args.ComponentName === "1" &&
        args.PropertyName === "RelativeRotation"
      ) {
        this.componentRotation = parseRotator(String(args.Value));
      }
      return true;
    }
    if (action === "reflect.write_object_property") {
      if (args.PropertyName === "DialogModels") {
        this.dialogueModels = [...(args.Value as string[])];
        return true;
      }
      if (args.PropertyName === "Formation") {
        this.formationClassPath = String(args.Value);
        return true;
      }
      if (args.PropertyName === "CommonDialogGraphProperties") {
        this.commonProperties = structuredClone(
          args.Value as Array<Record<string, unknown>>,
        );
      }
      if (args.PropertyName === "SpecialDialogGraphProperties") {
        this.specialProperties = structuredClone(
          args.Value as Array<Record<string, unknown>>,
        );
      }
      if (args.PropertyName === "PreviewLevel") {
        this.previewLevel = String(args.Value);
      }
      return true;
    }
    if (action === "bp.compile_blueprint") {
      return { bSuccess: true };
    }
    if (action === "bp.save_asset_and_capture_log") {
      return { bSuccess: true };
    }
    if (action === "asset.save_asset") {
      return true;
    }
    return true;
  }

  close(): void {}
}

class BackgroundPropConnection extends BlueprintSyncConnection {
  backgroundComponents = new Map<
    string,
    {
      componentClass: string;
      assetPath: string;
      location: { X: number; Y: number; Z: number };
      rotation: { Pitch: number; Yaw: number; Roll: number };
      scale: { X: number; Y: number; Z: number };
    }
  >();

  override async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const object = String(args.ThisPtr ?? "");
    const property = String(args.PropertyName ?? "");
    if (
      action === "reflect.read_object_property" &&
      object === `${this.blueprintClassPath}:SimpleConstructionScript_0` &&
      property === "AllNodes"
    ) {
      this.calls.push({ action, args });
      return [
        "SCS_Node_0",
        "SCS_Node_1",
        ...Array.from(this.backgroundComponents.keys()).map(
          (name) => `SCS_Node_BG_${name}`,
        ),
      ];
    }
    if (
      action === "reflect.read_object_property" &&
      object.startsWith("SCS_Node_BG_")
    ) {
      this.calls.push({ action, args });
      const name = object.slice("SCS_Node_BG_".length);
      const component = this.backgroundComponents.get(name)!;
      if (property === "InternalVariableName") {
        return name;
      }
      if (property === "ComponentClass") {
        return component.componentClass;
      }
      if (property === "ComponentTemplate") {
        return `Template_BG_${name}`;
      }
    }
    if (
      action === "reflect.read_object_property" &&
      object.startsWith("Template_BG_")
    ) {
      this.calls.push({ action, args });
      const name = object.slice("Template_BG_".length);
      const component = this.backgroundComponents.get(name)!;
      if (property === "SkeletalMesh" || property === "StaticMesh") {
        return component.assetPath;
      }
      if (property === "ChildActorClass") {
        return component.assetPath;
      }
      if (property === "RelativeLocation") {
        return component.location;
      }
      if (property === "RelativeRotation") {
        return component.rotation;
      }
      if (property === "RelativeScale3D") {
        return component.scale;
      }
    }
    if (action === "bp.add_component") {
      this.calls.push({ action, args });
      this.backgroundComponents.set(String(args.ComponentName), {
        componentClass: String(args.ComponentClass),
        assetPath: "",
        location: { X: 0, Y: 0, Z: 0 },
        rotation: { Pitch: 0, Yaw: 0, Roll: 0 },
        scale: { X: 1, Y: 1, Z: 1 },
      });
      return true;
    }
    if (
      action === "bp.set_component_property" &&
      this.backgroundComponents.has(String(args.ComponentName))
    ) {
      this.calls.push({ action, args });
      const component = this.backgroundComponents.get(
        String(args.ComponentName),
      )!;
      if (
        property === "SkeletalMesh" ||
        property === "StaticMesh" ||
        property === "ChildActorClass"
      ) {
        component.assetPath = String(args.Value);
      }
      if (property === "RelativeLocation") {
        component.location = parseVector(String(args.Value));
      }
      if (property === "RelativeRotation") {
        component.rotation = parseRotator(String(args.Value));
      }
      if (property === "RelativeScale3D") {
        component.scale = parseVector(String(args.Value));
      }
      return true;
    }
    return super.invoke(action, args);
  }
}

class AppendBlueprintConnection extends BlueprintSyncConnection {
  appendedComponents = new Map<
    string,
    {
      componentClass: string;
      childActorClass: string;
      location: { X: number; Y: number; Z: number };
      rotation: { Pitch: number; Yaw: number; Roll: number };
      scale: { X: number; Y: number; Z: number };
    }
  >();

  override async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const object = String(args.ThisPtr ?? "");
    const property = String(args.PropertyName ?? "");
    if (
      action === "reflect.read_object_property" &&
      object === `${this.blueprintClassPath}:SimpleConstructionScript_0` &&
      property === "AllNodes"
    ) {
      this.calls.push({ action, args });
      return [
        "SCS_Node_0",
        "SCS_Node_1",
        ...Array.from(this.appendedComponents.keys()).map(
          (name) => `SCS_Node_Append_${name}`,
        ),
      ];
    }
    if (
      action === "reflect.read_object_property" &&
      object.startsWith("SCS_Node_Append_")
    ) {
      this.calls.push({ action, args });
      const name = object.slice("SCS_Node_Append_".length);
      const component = this.appendedComponents.get(name)!;
      if (property === "InternalVariableName") {
        return name;
      }
      if (property === "ComponentClass") {
        return component.componentClass;
      }
      if (property === "ComponentTemplate") {
        return `Template_Append_${name}`;
      }
    }
    if (
      action === "reflect.read_object_property" &&
      object.startsWith("Template_Append_")
    ) {
      this.calls.push({ action, args });
      const name = object.slice("Template_Append_".length);
      const component = this.appendedComponents.get(name)!;
      if (property === "ChildActorClass") {
        return component.childActorClass;
      }
      if (property === "RelativeLocation") {
        return component.location;
      }
      if (property === "RelativeRotation") {
        return component.rotation;
      }
      if (property === "RelativeScale3D") {
        return component.scale;
      }
    }
    if (action === "script.eval_python_expression") {
      const expression = String(args.Expression);
      if (expression.includes("get_data_table_row_names")) {
        this.calls.push({ action, args });
        return {
          bSuccess: true,
          Result: `'${JSON.stringify({
            names: ["Guard", "Added"],
            paths: [
              "/Game/Test/BP_Guard.BP_Guard_C",
              "/Game/Test/BP_Added.BP_Added_C",
            ],
          })}'`,
        };
      }
    }
    if (action === "bp.add_component") {
      this.calls.push({ action, args });
      this.appendedComponents.set(String(args.ComponentName), {
        componentClass: String(args.ComponentClass),
        childActorClass: "",
        location: { X: 0, Y: 0, Z: 0 },
        rotation: { Pitch: 0, Yaw: 0, Roll: 0 },
        scale: { X: 1, Y: 1, Z: 1 },
      });
      return true;
    }
    if (
      action === "bp.set_component_property" &&
      this.appendedComponents.has(String(args.ComponentName))
    ) {
      this.calls.push({ action, args });
      const component = this.appendedComponents.get(
        String(args.ComponentName),
      )!;
      if (property === "ChildActorClass") {
        component.childActorClass = String(args.Value);
      }
      if (property === "RelativeLocation") {
        component.location = parseVector(String(args.Value));
      }
      if (property === "RelativeRotation") {
        component.rotation = parseRotator(String(args.Value));
      }
      if (property === "RelativeScale3D") {
        component.scale = parseVector(String(args.Value));
      }
      return true;
    }
    return super.invoke(action, args);
  }
}

class AlternateSpatialShapeConnection extends BlueprintSyncConnection {
  override async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (
      action === "reflect.read_object_property" &&
      args.PropertyName === "Formation"
    ) {
      return {
        ObjectPath: await super.invoke(action, args),
      };
    }
    if (
      action === "reflect.read_object_property" &&
      args.PropertyName === "PreviewLevel"
    ) {
      const value = String(await super.invoke(action, args));
      return {
        AssetPathName: value.split(".")[0],
      };
    }
    return super.invoke(action, args);
  }
}

class VirtualGatedBlueprintSyncConnection extends BlueprintSyncConnection {
  override async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (
      action === "reflect.write_object_property" &&
      args.PropertyName === "CommonDialogGraphProperties"
    ) {
      const virtualWasEnabled = this.commonProperties.some(
        (property) =>
          property.Alias === "Virtual" &&
          property.CurrentBool === true,
      );
      if (!virtualWasEnabled) {
        const gatedValue = structuredClone(
          args.Value as Array<Record<string, unknown>>,
        );
        for (const property of gatedValue) {
          if (property.Alias === "PlayerInitPosition") {
            delete property.CurrentVector;
          }
          if (property.Alias === "PlayerForward") {
            delete property.CurrentRotator;
          }
        }
        return super.invoke(action, { ...args, Value: gatedValue });
      }
    }
    return super.invoke(action, args);
  }
}

async function writeConfigFixture() {
  temporaryRoot = await mkdtemp(join(tmpdir(), "shot-sandbox-sync-"));
  const csvDirectory = join(temporaryRoot, "csvdir");
  await mkdir(csvDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(csvDirectory, "NPC表.csv"),
      [
        "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
        "##id,名称,介绍,资源",
        "700001,守卫,测试,200777",
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      join(csvDirectory, "m模型资源表.csv"),
      [
        "##&Model.id,,Model.path",
        "##id,配置路径,生成路径",
        "200777,/Game/Test/BP_Guard,/Game/Test/BP_Guard.BP_Guard_C",
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      join(csvDirectory, "任务表.csv"),
      [
        "##&字段标记,Mission.id,Mission.Name,Mission.ShowNPC",
        "##任务类型,任务ID,任务名称,显示目标物",
        ",900001,同步任务,500001",
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      join(csvDirectory, "m目标物表.csv"),
      [
        "##&MissionPosition.ID,,,MissionPosition.type,MissionPosition.NPCID,MissionPosition.ItemID,MissionPosition.BluePrint,MissionPosition.MapID,MissionPosition.Position,MissionPosition.Rotation",
        "##ID,类型,描述,坐标类型,NPCID,物品ID,蓝图路径,地图ID,座标,旋转",
        '500001,剧情 NPC,守卫,1,700001,0,,1204,"(X=110,Y=220,Z=330)","(Pitch=0,Yaw=90,Roll=0)"',
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      join(csvDirectory, "d地图配置表.csv"),
      [
        "##&MapConfig.id,MapConfig.name,,,MapConfig.resourceid",
        "##ID,地图名称,地图备注,地图资源（注释用）,资源ID",
        "1204,测试地图,,,100128",
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      join(csvDirectory, "d地图资源表.csv"),
      [
        "##&Scene.id,Scene.path",
        "##id,path",
        "100128,/Game/Test/Maps/TestMap",
      ].join("\n"),
      "utf8",
    ),
  ]);
  configureConfigCsvDirectory(temporaryRoot);
}

function appendPlan(): MissionTargetPreviewPlan {
  return {
    taskId: "900001",
    taskName: "追加任务",
    taskSource: "任务表",
    mapId: "1204",
    mapName: "测试地图",
    mapAssetPath: "/Game/Test/Maps/TestMap",
    warnings: [],
    targets: [
      {
        targetId: "500001",
        type: 1,
        description: "已有守卫",
        npcId: 700001,
        npcName: "守卫",
        modelId: 200777,
        modelClassPath: "/Game/Test/BP_Guard.BP_Guard_C",
        itemId: 0,
        blueprintModelId: null,
        mapId: "1204",
        previewKind: "asset",
        transform: {
          location: { x: 100, y: 200, z: 300 },
          rotation: { pitch: 0, yaw: 0, roll: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      {
        targetId: "500002",
        type: 1,
        description: "新增 NPC",
        npcId: 700002,
        npcName: "新增 NPC",
        modelId: 200778,
        modelClassPath: "/Game/Test/BP_Added.BP_Added_C",
        itemId: 0,
        blueprintModelId: null,
        mapId: "1204",
        previewKind: "asset",
        transform: {
          location: { x: 140, y: 260, z: 360 },
          rotation: { pitch: 0, yaw: 45, roll: 0 },
          scale: { x: 1.2, y: 1.2, z: 1.2 },
        },
      },
    ],
  };
}

beforeEach(() => {
  configureConfigCsvDirectory("F:\\ProjectData\\doc");
});

afterEach(async () => {
  configureConfigCsvDirectory("");
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = "";
  }
});

describe("mission target Blueprint synchronization", () => {
  it("lists append candidates after existing BP slots", async () => {
    const connection = new AppendBlueprintConnection();

    const inspection = await inspectMissionTargetBlueprint(
      {
        blueprintName: "BP_735200",
        plan: appendPlan(),
      },
      () => connection,
    );

    expect(inspection.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelIndex: 0 }),
        expect.objectContaining({
          modelIndex: 1,
          targetId: "500001",
        }),
      ]),
    );
    expect(inspection.appendSlots).toEqual([
      expect.objectContaining({
        modelIndex: 2,
        targetId: "500002",
        suggestedModelName: "Added",
      }),
    ]);
  });

  it("appends selected targets after existing slots and registers all models", async () => {
    const connection = new AppendBlueprintConnection();

    const result = await appendMissionTargetBlueprint(
      {
        blueprintName: "BP_735200",
        plan: appendPlan(),
        selectedTargetIds: ["500002"],
      },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "appended",
      addedTargetIds: ["500002"],
      addedModelIndexes: [2],
      componentNames: ["2"],
      dialogueRegistration: {
        dialogueModels: ["player", "Guard", "Added"],
        registeredCount: 2,
        emptyCount: 0,
      },
    });
    expect(connection.appendedComponents.get("2")).toEqual({
      componentClass: "/Script/Engine.ChildActorComponent",
      childActorClass: "/Game/Test/BP_Added.BP_Added_C",
      location: { X: 40, Y: 60, Z: 160 },
      rotation: { Pitch: 0, Yaw: 45, Roll: 0 },
      scale: { X: 1.2, Y: 1.2, Z: 1.2 },
    });
    expect(connection.dialogueModels).toEqual([
      "player",
      "Guard",
      "Added",
    ]);
    expect(
      connection.calls.some(
        (call) =>
          call.action === "bp.set_component_property" &&
          call.args.ComponentName === "1",
      ),
    ).toBe(false);
  });

  it("rejects appending a target already mapped to the BP", async () => {
    const connection = new AppendBlueprintConnection();

    await expect(
      appendMissionTargetBlueprint(
        {
          blueprintName: "BP_735200",
          plan: appendPlan(),
          selectedTargetIds: ["500001"],
        },
        () => connection,
      ),
    ).rejects.toThrow("所选目标物已存在于 BP：500001");
    expect(
      connection.calls.some((call) => call.action === "bp.add_component"),
    ).toBe(false);
  });

  it("refreshes the task plan, detects both directions and updates BP metadata", async () => {
    await writeConfigFixture();
    const connection = new BlueprintSyncConnection();

    const inspection = await inspectMissionTargetBlueprint(
      { blueprintName: "BP_735200", taskId: "900001" },
      () => connection,
    );

    expect(inspection.refreshedPlan?.targets[0].transform.location).toEqual({
      x: 110,
      y: 220,
      z: 330,
    });
    expect(inspection.sync).toMatchObject({
      hasExplicitRoot: true,
      canUpdateBlueprint: true,
      canUpdateTargets: true,
      mappings: [
        {
          modelIndex: 1,
          targetId: "500001",
        },
      ],
    });
    expect(inspection.sync?.mappings[0].positionDelta).toBeCloseTo(
      37.416574,
    );

    const result = await updateMissionTargetBlueprintPositions(
      {
        blueprintName: "BP_735200",
        taskId: "900001",
        targetOverrides: [
          {
            targetId: "500001",
            transform: {
              location: { x: 120, y: 230, z: 340 },
              rotation: { pitch: 0, yaw: 95, roll: 0 },
            },
          },
        ],
      },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "updated",
      updatedModelIndexes: [1],
      blueprintSaved: true,
      dialogueSaved: true,
    });
    expect(connection.componentLocation).toEqual({
      X: 20,
      Y: 30,
      Z: 140,
    });
    expect(connection.componentRotation).toEqual({
      Pitch: 0,
      Yaw: 95,
      Roll: 0,
    });
    expect(connection.previewLevel).toBe(
      "/Game/Test/Maps/TestMap.TestMap",
    );
    expect(connection.commonProperties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Alias: "Virtual", CurrentBool: true }),
        expect.objectContaining({
          Alias: "PlayerInitPosition",
          CurrentVector: { X: 100, Y: 200, Z: 200 },
        }),
      ]),
    );
    expect(connection.specialProperties[0]).toMatchObject({
      Alias: "Virtual",
      CurrentBool: true,
    });
  });

  it("converts BP component transforms to world coordinates before Excel write", async () => {
    await writeConfigFixture();
    const connection = new BlueprintSyncConnection();
    connection.componentLocation = { X: 25, Y: 30, Z: 140 };
    connection.componentRotation = { Pitch: 0, Yaw: 100, Roll: 0 };
    let request: {
      items: Array<Record<string, unknown>>;
      targetPath: string;
    } | null = null;

    const result = await syncBlueprintPositionsToMissionTargets(
      { blueprintName: "BP_735200", taskId: "900001" },
      () => connection,
      async (rawRequest) => {
        request = rawRequest as typeof request;
        return {
          updatedTargets: [{ targetId: "500001", rowNumber: 3 }],
          unchangedTargetIds: [],
          openedWorkbooks: ["target.xlsm"],
        };
      },
    );

    expect(result.updatedTargets).toEqual([
      { targetId: "500001", rowNumber: 3 },
    ]);
    expect(request).toMatchObject({
      items: [
        {
          targetId: "500001",
          mapId: "1204",
          originalTransform: {
            location: { x: 110, y: 220, z: 330 },
            rotation: { pitch: 0, yaw: 90, roll: 0 },
          },
          transform: {
            location: { x: 125, y: 230, z: 340 },
            rotation: { pitch: 0, yaw: 100, roll: 0 },
          },
        },
      ],
    });
  });

  it.each([
    ["selected_actor", true],
    ["level_scan", false],
  ] as const)(
    "fills missing dialogue spatial metadata from %s",
    async (expectedSource, selected) => {
      await writeConfigFixture();
      const connection = new BlueprintSyncConnection();
      connection.commonProperties = [
        { Alias: "Virtual", CurrentBool: false },
        { Alias: "PlayerInitPosition" },
        { Alias: "PlayerForward" },
      ];
      connection.previewLevel = "";
      const actor = {
        actor_ref: "PersistentLevel.BP_735200_C_0",
        label: "BP_735200",
        class_path: connection.blueprintClassPath,
        location: [700, 800, 900],
        rotation: [0, 35, 0],
        scale: [1.25, 0.75, 2],
      };
      if (selected) {
        connection.selectedPlacementActors = [actor];
        connection.levelPlacementActors = [
          {
            ...actor,
            actor_ref: "PersistentLevel.BP_735200_C_ignored",
            location: [1, 2, 3],
          },
        ];
      } else {
        connection.levelPlacementActors = [actor];
      }

      const result = await registerBlueprintDialogueModels(
        {
          blueprintName: "BP_735200",
          selectedModelIndexes: [1],
        },
        () => connection,
      );

      expect(result).toMatchObject({
        spatialStatus: "configured",
        spatialSource: expectedSource,
        spatialMapAssetPath:
          "/Game/Test/Maps/PlacedMap.PlacedMap",
      });
      expect(connection.commonProperties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Alias: "Virtual",
            CurrentBool: true,
          }),
          expect.objectContaining({
            Alias: "PlayerInitPosition",
            CurrentVector: { X: 700, Y: 800, Z: 900 },
          }),
          expect.objectContaining({
            Alias: "PlayerForward",
            CurrentRotator: { Pitch: 0, Yaw: 35, Roll: 0 },
          }),
        ]),
      );
      expect(connection.previewLevel).toBe(
        "/Game/Test/Maps/PlacedMap.PlacedMap",
      );
    },
  );

  it("enables Virtual before writing the BP actor transform", async () => {
    await writeConfigFixture();
    const connection = new VirtualGatedBlueprintSyncConnection();
    connection.commonProperties = [
      { Alias: "Virtual", CurrentBool: false },
      { Alias: "PlayerInitPosition" },
      { Alias: "PlayerForward" },
    ];
    connection.selectedPlacementActors = [
      {
        actor_ref: "PersistentLevel.BP_735200_C_0",
        label: "BP_735200",
        class_path: connection.blueprintClassPath,
        location: [700, 800, 900],
        rotation: [0, 35, 0],
        scale: [1, 1, 1],
      },
    ];

    const result = await registerBlueprintDialogueModels(
      {
        blueprintName: "BP_735200",
        selectedModelIndexes: [1],
      },
      () => connection,
    );

    expect(result).toMatchObject({
      spatialStatus: "configured",
      spatialSource: "selected_actor",
    });
    expect(connection.commonProperties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Alias: "Virtual",
          CurrentBool: true,
        }),
        expect.objectContaining({
          Alias: "PlayerInitPosition",
          CurrentVector: { X: 700, Y: 800, Z: 900 },
        }),
        expect.objectContaining({
          Alias: "PlayerForward",
          CurrentRotator: { Pitch: 0, Yaw: 35, Roll: 0 },
        }),
      ]),
    );
    const commonWrites = connection.calls.filter(
      (call) =>
        call.action === "reflect.write_object_property" &&
        call.args.PropertyName === "CommonDialogGraphProperties",
    );
    expect(commonWrites).toHaveLength(2);
    expect(
      (commonWrites[0].args.Value as Array<Record<string, unknown>>).find(
        (property) => property.Alias === "PlayerInitPosition",
      ),
    ).not.toHaveProperty("CurrentVector");
    expect(
      (commonWrites[1].args.Value as Array<Record<string, unknown>>).find(
        (property) => property.Alias === "PlayerInitPosition",
      ),
    ).toHaveProperty("CurrentVector", { X: 700, Y: 800, Z: 900 });
  });

  it("blocks automatic registration when the map contains multiple BP instances", async () => {
    await writeConfigFixture();
    const connection = new BlueprintSyncConnection();
    connection.commonProperties = [
      { Alias: "Virtual", CurrentBool: false },
      { Alias: "PlayerInitPosition" },
      { Alias: "PlayerForward" },
    ];
    const actor = {
      label: "BP_735200",
      class_path: connection.blueprintClassPath,
      location: [700, 800, 900],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    connection.levelPlacementActors = [
      { ...actor, actor_ref: "PersistentLevel.BP_735200_C_0" },
      { ...actor, actor_ref: "PersistentLevel.BP_735200_C_1" },
    ];

    await expect(
      registerBlueprintDialogueModels(
        {
          blueprintName: "BP_735200",
          selectedModelIndexes: [1],
        },
        () => connection,
      ),
    ).rejects.toThrow("找到 2 个 BP_735200 实例");
    expect(
      connection.calls.some(
        (call) => call.action === "reflect.write_object_property",
      ),
    ).toBe(false);
  });

  it("keeps model registration available when no placed BP can provide spatial data", async () => {
    await writeConfigFixture();
    const connection = new BlueprintSyncConnection();
    connection.commonProperties = [
      { Alias: "Virtual", CurrentBool: false },
      { Alias: "PlayerInitPosition" },
      { Alias: "PlayerForward" },
    ];

    const result = await registerBlueprintDialogueModels(
      {
        blueprintName: "BP_735200",
        selectedModelIndexes: [1],
      },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "unchanged",
      spatialStatus: "not_configured",
    });
    expect(connection.previewLevel).toBe("");
  });

  it("uses the current map when only Preview Level and Virtual are missing", async () => {
    await writeConfigFixture();
    const connection = new BlueprintSyncConnection();
    connection.previewLevel = "";

    const result = await registerBlueprintDialogueModels(
      {
        blueprintName: "BP_735200",
        selectedModelIndexes: [],
        taskId: "900001",
        preserveModels: true,
      },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "registered",
      dialogueModels: ["player", "Guard"],
      spatialStatus: "configured",
      spatialMapAssetPath:
        "/Game/Test/Maps/PlacedMap.PlacedMap",
    });
    expect(connection.previewLevel).toBe(
      "/Game/Test/Maps/PlacedMap.PlacedMap",
    );
    expect(connection.commonProperties[0]).toMatchObject({
      Alias: "Virtual",
      CurrentBool: true,
    });
    expect(
      connection.calls.some(
        (call) =>
          call.action === "reflect.write_object_property" &&
          call.args.PropertyName === "DialogModels",
      ),
    ).toBe(false);
  });

  it("accepts UE string booleans, lowercase structs and wrapped object paths on readback", async () => {
    await writeConfigFixture();
    const connection = new AlternateSpatialShapeConnection();
    connection.commonProperties = [
      { Alias: "Virtual", current_bool: "False" },
      {
        Alias: "PlayerInitPosition",
        current_vector: { x: 100, y: 200, z: 200 },
      },
      {
        Alias: "PlayerForward",
        current_rotator: { pitch: 0, yaw: 0, roll: 0 },
      },
    ];
    connection.specialProperties = [
      { Alias: "Virtual", current_bool: 0 },
    ];
    connection.previewLevel = "";

    const result = await registerBlueprintDialogueModels(
      {
        blueprintName: "BP_735200",
        selectedModelIndexes: [],
        preserveModels: true,
      },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "registered",
      dialogueModels: ["player", "Guard"],
      spatialStatus: "configured",
    });
    expect(connection.commonProperties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Alias: "Virtual",
          current_bool: true,
        }),
        expect.objectContaining({
          Alias: "PlayerInitPosition",
          current_vector: { x: 100, y: 200, z: 200 },
        }),
      ]),
    );
    expect(connection.specialProperties[0]).toMatchObject({
      current_bool: true,
    });
  });
});

describe("background prop import", () => {
  it("writes a selected Skeletal Mesh with its asset name and scale", async () => {
    await writeConfigFixture();
    const connection = new BackgroundPropConnection();
    connection.commonProperties[0].CurrentBool = true;
    connection.specialProperties[0].CurrentBool = true;
    connection.previewLevel =
      "/Game/Test/Maps/PlacedMap.PlacedMap";
    connection.selectedPlacementActors = [
      {
        actor_ref: "PersistentLevel.SkeletalMeshActor_1",
        label: "旗帜",
        class_path: "/Script/Engine.SkeletalMeshActor",
        skeletal_mesh_path:
          "/Game/Test/Props/SK_Banner.SK_Banner",
        static_mesh_path: "",
        location: [130, 260, 340],
        rotation: [0, 45, 0],
        scale: [1.5, 0.75, 2],
      },
      {
        actor_ref: "PersistentLevel.BP_BackgroundNpc_C_0",
        label: "背景 NPC",
        class_path:
          "/Game/Test/NPC/BP_BackgroundNpc.BP_BackgroundNpc_C",
        skeletal_mesh_path:
          "/Game/Test/NPC/SK_BackgroundNpc.SK_BackgroundNpc",
        static_mesh_path: "",
        location: [90, 180, 300],
        rotation: [0, -20, 0],
        scale: [0.9, 0.9, 0.9],
      },
    ];

    const preview = await inspectBackgroundPropImport(
      { blueprintName: "BP_735200" },
      () => connection,
    );

    expect(preview.blockedReasons).toEqual([]);
    expect(preview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorLabel: "旗帜",
        assetKind: "skeletal_mesh",
        assetPath: "/Game/Test/Props/SK_Banner.SK_Banner",
        componentName: "SK_Banner",
        componentClass: "/Script/Engine.SkeletalMeshComponent",
        assetPropertyName: "SkeletalMesh",
        action: "create",
        relativeTransform: {
          location: { x: 30, y: 60, z: 140 },
          rotation: { pitch: 0, yaw: 45, roll: 0 },
          scale: { x: 1.5, y: 0.75, z: 2 },
        },
      }),
      expect.objectContaining({
        actorLabel: "背景 NPC",
        assetKind: "blueprint_actor",
        assetPath:
          "/Game/Test/NPC/BP_BackgroundNpc.BP_BackgroundNpc",
        componentName: "BP_BackgroundNpc",
        componentClass: "/Script/Engine.ChildActorComponent",
        assetPropertyName: "ChildActorClass",
        action: "create",
        relativeTransform: {
          location: { x: -10, y: -20, z: 100 },
          rotation: { pitch: 0, yaw: -20, roll: 0 },
          scale: { x: 0.9, y: 0.9, z: 0.9 },
        },
      }),
    ]));

    const result = await applyBackgroundPropImport(
      {
        blueprintName: "BP_735200",
        reviewToken: preview.reviewToken,
        selectedActorRefs: [
          "PersistentLevel.SkeletalMeshActor_1",
          "PersistentLevel.BP_BackgroundNpc_C_0",
        ],
      },
      () => connection,
    );

    expect(result).toEqual({
      status: "updated",
      blueprintAssetPath: connection.blueprintAssetPath,
      createdComponentNames: ["SK_Banner", "BP_BackgroundNpc"],
      updatedComponentNames: [],
      saved: true,
    });
    expect(connection.backgroundComponents.get("SK_Banner")).toEqual({
      componentClass: "/Script/Engine.SkeletalMeshComponent",
      assetPath: "/Game/Test/Props/SK_Banner.SK_Banner",
      location: { X: 30, Y: 60, Z: 140 },
      rotation: { Pitch: 0, Yaw: 45, Roll: 0 },
      scale: { X: 1.5, Y: 0.75, Z: 2 },
    });
    expect(
      connection.backgroundComponents.get("BP_BackgroundNpc"),
    ).toEqual({
      componentClass: "/Script/Engine.ChildActorComponent",
      assetPath:
        "/Game/Test/NPC/BP_BackgroundNpc.BP_BackgroundNpc_C",
      location: { X: -10, Y: -20, Z: 100 },
      rotation: { Pitch: 0, Yaw: -20, Roll: 0 },
      scale: { X: 0.9, Y: 0.9, Z: 0.9 },
    });
  });

  it("reviews and imports only the requested unmatched Actor subset", async () => {
    await writeConfigFixture();
    const connection = new BackgroundPropConnection();
    connection.commonProperties[0].CurrentBool = true;
    connection.specialProperties[0].CurrentBool = true;
    connection.previewLevel = "/Game/Test/Maps/PlacedMap.PlacedMap";
    connection.selectedPlacementActors = [
      {
        actor_ref:
          "PersistentLevel.ShotSandboxMissionTargetPreview_900001_500001",
        label: "任务 NPC",
        class_path: "/Game/Test/BP_Guard.BP_Guard_C",
        skeletal_mesh_path: "",
        static_mesh_path: "",
        location: [110, 220, 330],
        rotation: [0, 90, 0],
        scale: [1, 1, 1],
      },
      {
        actor_ref: "PersistentLevel.SkeletalMeshActor_1",
        label: "旗帜",
        class_path: "/Script/Engine.SkeletalMeshActor",
        skeletal_mesh_path: "/Game/Test/Props/SK_Banner.SK_Banner",
        static_mesh_path: "",
        location: [130, 260, 340],
        rotation: [0, 45, 0],
        scale: [1.5, 0.75, 2],
      },
    ];
    const reviewedActorRefs = ["PersistentLevel.SkeletalMeshActor_1"];

    const preview = await inspectBackgroundPropImport(
      {
        blueprintName: "BP_735200",
        actorRefs: reviewedActorRefs,
      },
      () => connection,
    );

    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({
      actorRef: "PersistentLevel.SkeletalMeshActor_1",
      actorLabel: "旗帜",
      componentName: "SK_Banner",
    });

    const result = await applyBackgroundPropImport(
      {
        blueprintName: "BP_735200",
        reviewToken: preview.reviewToken,
        selectedActorRefs: reviewedActorRefs,
        reviewedActorRefs,
      },
      () => connection,
    );

    expect(result.createdComponentNames).toEqual(["SK_Banner"]);
    expect(
      connection.backgroundComponents.has("BP_Guard"),
    ).toBe(false);
  });

  it("fills missing dialogue metadata without changing DialogModels before import", async () => {
    await writeConfigFixture();
    const connection = new BackgroundPropConnection();
    connection.formationClassPath = "None";
    connection.commonProperties = [
      { Alias: "Virtual", CurrentBool: false },
      { Alias: "PlayerInitPosition" },
      { Alias: "PlayerForward" },
    ];
    connection.specialProperties = [
      { Alias: "Virtual", CurrentBool: false },
    ];
    connection.previewLevel = "";
    connection.selectedPlacementActors = [
      {
        actor_ref: "PersistentLevel.BP_735200_C_0",
        label: "BP_735200",
        class_path: connection.blueprintClassPath,
        skeletal_mesh_path: "",
        static_mesh_path: "",
        location: [700, 800, 900],
        rotation: [0, 35, 0],
        scale: [1, 1, 1],
      },
      {
        actor_ref: "PersistentLevel.BP_BackgroundNpc_C_0",
        label: "背景 NPC",
        class_path:
          "/Game/Test/NPC/BP_BackgroundNpc.BP_BackgroundNpc_C",
        skeletal_mesh_path: "",
        static_mesh_path: "",
        location: [740, 810, 920],
        rotation: [0, 50, 0],
        scale: [1, 1, 1],
      },
    ];

    const blockedPreview = await inspectBackgroundPropImport(
      { blueprintName: "BP_735200" },
      () => connection,
    );
    expect(blockedPreview.blockedReasons).toEqual(
      expect.arrayContaining([
        "对话 Formation 尚未指向当前 BP",
        "对话尚未配置主角初始坐标",
        "对话尚未配置主角朝向",
        "对话尚未启用虚拟场景",
        "对话尚未配置 Preview Level",
      ]),
    );

    const result = await registerBlueprintDialogueModels(
      {
        blueprintName: "BP_735200",
        selectedModelIndexes: [],
        preserveModels: true,
      },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "registered",
      dialogueModels: ["player", "Guard"],
      spatialStatus: "configured",
      spatialSource: "selected_actor",
    });
    expect(
      connection.calls.some(
        (call) =>
          call.action === "reflect.write_object_property" &&
          call.args.PropertyName === "DialogModels",
      ),
    ).toBe(false);
    expect(connection.formationClassPath).toBe(
      connection.blueprintClassPath,
    );
    expect(connection.previewLevel).toBe(
      "/Game/Test/Maps/PlacedMap.PlacedMap",
    );

    const readyPreview = await inspectBackgroundPropImport(
      { blueprintName: "BP_735200" },
      () => connection,
    );
    expect(readyPreview.blockedReasons).toEqual([]);
    expect(
      readyPreview.items.find(
        (item) => item.actorLabel === "背景 NPC",
      ),
    ).toMatchObject({
      action: "create",
      relativeTransform: {
        location: expect.any(Object),
        rotation: expect.any(Object),
        scale: { x: 1, y: 1, z: 1 },
      },
    });
  });
});
