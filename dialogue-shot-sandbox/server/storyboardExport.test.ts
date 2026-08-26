import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { StoryboardExportRequest } from "../src/types";
import {
  buildStoryboardCameraMove,
  exportDialogueStoryboard,
  inspectDialogueStoryboardExport,
  updateDialogueContent,
  updateDialogueContents,
  type UnrealInvoker,
} from "./ueBridge";

function commonProperties(
  dialogueId: string,
  cameraPosition = "",
  content = `对白 ${dialogueId}`,
) {
  return [
    {
      Alias: "id",
      CurrentUint32: Number(dialogueId),
      CurrentString: "",
    },
    {
      Alias: "CameraPosition",
      CurrentUint32: 0,
      CurrentString: cameraPosition,
    },
    {
      Alias: "Content",
      CurrentUint32: 0,
      CurrentString: content,
    },
  ];
}

class FakeStoryboardExportConnection implements UnrealInvoker {
  readonly calls: Array<{
    action: string;
    args: Record<string, unknown>;
  }> = [];
  readonly dialogueAssetPath =
    "/Game/Seria/Task/dialoggraph/Test/735200.735200";
  readonly formationAssetPath =
    "/Game/Seria/Task/Mod/Test/BP_735200.BP_735200";
  readonly commonByData = new Map<string, ReturnType<typeof commonProperties>>([
    ["ActionData1", commonProperties("735201")],
    ["ActionData2", commonProperties("735202", "c2")],
    ["ActionData3", commonProperties("735203", "old")],
  ]);
  readonly movesByData = new Map<string, unknown[]>([
    ["ActionData1", []],
    ["ActionData2", [{ CameraMoveType: "EPush", FOV: 90 }]],
    ["ActionData3", [{ CameraMoveType: "EPush", FOV: 70 }]],
  ]);
  saveResult = true;
  dirtyPackages: string[] = [];
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
      return [
        `735200 (SeriaDialogGraph) [${this.dialogueAssetPath}]`,
      ];
    }
    if (action === "asset.get_asset_by_path") {
      return "DialogGraph_735200";
    }
    if (action === "asset.export_asset_to_text_file") {
      return resolve(
        process.cwd(),
        "server/fixtures/storyboard-dialogue-export.txt",
      );
    }
    if (action === "bp.get_blueprint_by_path") {
      return "Blueprint_BP_735200";
    }
    if (action === "script.eval_python_expression") {
      return {
        bSuccess: true,
        Result: `'${JSON.stringify(this.dirtyPackages)}'`,
      };
    }
    if (action === "asset.save_asset") {
      return this.saveResult;
    }
    if (action === "reflect.write_object_property") {
      const dataName = String(args.ThisPtr).split(".").at(-1)!;
      if (args.PropertyName === "CommonDialogGraphProperties") {
        this.commonByData.set(
          dataName,
          structuredClone(
            args.Value as ReturnType<typeof commonProperties>,
          ),
        );
      }
      if (args.PropertyName === "MoveCameras") {
        this.movesByData.set(
          dataName,
          structuredClone(args.Value as unknown[]),
        );
      }
      return true;
    }
    if (action !== "reflect.read_object_property") {
      return true;
    }
    const object = String(args.ThisPtr);
    const property = String(args.PropertyName);
    if (object.endsWith(":Dialog Graph") && property === "Nodes") {
      return [
        "SeriaEdDialogGraphNode_0",
        "SeriaEdDialogGraphNode_1",
        "SeriaEdDialogGraphNode_2",
        "SeriaEdDialogGraphNode_3",
      ];
    }
    if (
      object.includes("SeriaEdDialogGraphNode_") &&
      property === "DialogGraphNodeData"
    ) {
      const nodeIndex = object.match(/_(\d+)$/)?.[1];
      return nodeIndex === "0" ? "StartData" : `ActionData${nodeIndex}`;
    }
    if (object.endsWith("StartData")) {
      if (property === "SeriaDialogGraphNodeType") {
        return "EStart";
      }
      if (property === "Formation") {
        return `${this.formationAssetPath}_C`;
      }
    }
    if (object.includes("ActionData")) {
      const dataName = object.split(".").at(-1)!;
      if (property === "SeriaDialogGraphNodeType") {
        return "EAction";
      }
      if (property === "CommonDialogGraphProperties") {
        return structuredClone(this.commonByData.get(dataName));
      }
      if (property === "MoveCameras") {
        return structuredClone(this.movesByData.get(dataName));
      }
    }
    if (
      object.endsWith(":SimpleConstructionScript_0") &&
      property === "AllNodes"
    ) {
      return ["SCS_Node_0", "SCS_Node_1", "SCS_Node_c1"];
    }
    if (object.startsWith("SCS_Node_")) {
      const name = object.slice("SCS_Node_".length);
      if (property === "InternalVariableName") {
        return name;
      }
      if (property === "ComponentClass") {
        return name === "c1"
          ? "/Script/Engine.CameraComponent"
          : "/Script/Engine.ChildActorComponent";
      }
      if (property === "ComponentTemplate") {
        return `Template_${name}`;
      }
    }
    if (object === "Template_0" && property === "RelativeLocation") {
      return { X: -100, Y: -50, Z: 0 };
    }
    if (object === "Template_1" && property === "RelativeLocation") {
      return { X: 100, Y: 50, Z: 0 };
    }
    throw new Error(`Unhandled fake call: ${action} ${object} ${property}`);
  }

  close(): void {
    this.closed = true;
  }
}

function exportRequest(
  cameraMovement: StoryboardExportRequest["shots"][number]["cameraMovement"] =
    "static",
): StoryboardExportRequest {
  return {
    dialogueId: "7352",
    startId: "735200",
    dialogueIds: ["735201", "735202", "735203"],
    participantModelIndexes: [0, 1],
    usesBlueprintFormation: true,
    shots: [
      {
        dialogueId: "735201",
        dialogueIds: ["735201", "735202"],
        cameraPosition: [2, 1.5, 3],
        cameraTarget: [0, 1.2, 0],
        cameraEndPosition: [2, 1.5, 3],
        cameraEndTarget: [0, 1.2, 0],
        focalLength: 35,
        endFocalLength: 35,
        cameraMovement: "static",
        movementIntensity: "none",
        cameraRollDegrees: 0,
        projectionValid: true,
      },
      {
        dialogueId: "735203",
        dialogueIds: ["735203"],
        cameraPosition: [-2, 1.6, 2],
        cameraTarget: [0, 1.3, 0],
        cameraEndPosition: [-1.5, 1.6, 1.5],
        cameraEndTarget: [0, 1.3, 0],
        focalLength: 50,
        endFocalLength: cameraMovement.includes("zoom") ? 70 : 50,
        cameraMovement,
        movementIntensity:
          cameraMovement === "static" ? "none" : "moderate",
        cameraRollDegrees: 0,
        projectionValid: false,
      },
    ],
  };
}

describe("dialogue storyboard export", () => {
  it("maps centered stage coordinates to an UE push camera", () => {
    const move = buildStoryboardCameraMove(exportRequest().shots[0], {
      centerX: 10,
      centerY: -20,
    });

    expect(move).toMatchObject({
      CameraMoveType: "EPush",
      PushCameraArg: {
        Velocity: 0,
        StartPoint: { X: -290, Y: 180, Z: 150 },
        EndPoint: { X: -290, Y: 180, Z: 150 },
      },
      FOV: 53.130102,
    });
  });

  it("previews every overwrite and writes only after token confirmation", async () => {
    const connection = new FakeStoryboardExportConnection();
    const request = exportRequest("dolly_in");
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    expect(preview).toMatchObject({
      dialogueId: "7352",
      startId: "735200",
      cameraName: "c1",
      shotCount: 2,
      changedNodeCount: 3,
      overwrittenNodeCount: 1,
      clearedNodeCount: 1,
      invalidShotCount: 1,
      blockedReasons: [],
    });
    expect(preview.nodes.map((node) => node.action)).toEqual([
      "create",
      "clear",
      "replace",
    ]);

    const result = await exportDialogueStoryboard(
      { ...request, reviewToken: preview.reviewToken },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "exported",
      changedNodeCount: 3,
      saved: true,
    });
    expect(connection.commonByData.get("ActionData1")?.[1].CurrentString).toBe(
      "c1",
    );
    expect(connection.commonByData.get("ActionData2")?.[1].CurrentString).toBe(
      "",
    );
    expect(connection.commonByData.get("ActionData3")?.[1].CurrentString).toBe(
      "c1",
    );
    expect(connection.movesByData.get("ActionData2")).toEqual([]);
    expect(
      connection.calls.some((call) => call.action === "asset.save_asset"),
    ).toBe(true);
  });

  it("blocks focal-length animation instead of silently losing it", async () => {
    const connection = new FakeStoryboardExportConnection();
    const request = exportRequest("zoom_in");
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    expect(preview.blockedReasons).toHaveLength(1);
    await expect(
      exportDialogueStoryboard(
        { ...request, reviewToken: preview.reviewToken },
        () => connection,
      ),
    ).rejects.toThrow("焦距连续变化");
    expect(
      connection.calls.some(
        (call) => call.action === "reflect.write_object_property",
      ),
    ).toBe(false);
  });

  it("blocks saving over unrelated dirty UE asset changes", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.dirtyPackages = [
      "/Game/Seria/Task/dialoggraph/Test/735200",
    ];
    const request = exportRequest();
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    expect(preview.blockedReasons).toContainEqual(
      expect.stringContaining("存在未保存修改"),
    );
    await expect(
      exportDialogueStoryboard(
        { ...request, reviewToken: preview.reviewToken },
        () => connection,
      ),
    ).rejects.toThrow("存在未保存修改");
    expect(
      connection.calls.some(
        (call) => call.action === "reflect.write_object_property",
      ),
    ).toBe(false);
  });

  it("restores in-memory node values when saving fails", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.saveResult = false;
    const request = exportRequest();
    const originalCamera = connection.commonByData.get("ActionData1")?.[1]
      .CurrentString;
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    await expect(
      exportDialogueStoryboard(
        { ...request, reviewToken: preview.reviewToken },
        () => connection,
      ),
    ).rejects.toThrow("已尝试恢复本轮未保存修改");
    expect(connection.commonByData.get("ActionData1")?.[1].CurrentString).toBe(
      originalCamera,
    );
    expect(connection.movesByData.get("ActionData1")).toEqual([]);
  });
});

describe("dialogue content update", () => {
  it("updates one Content property, verifies it and saves the dialogue asset", async () => {
    const connection = new FakeStoryboardExportConnection();

    const result = await updateDialogueContent(
      {
        dialogueId: "7352",
        startId: "735200",
        dialogueNodeId: "735201",
        previousContent: "对白 735201",
        content: "修改后的对白",
      },
      () => connection,
    );

    expect(result).toMatchObject({
      status: "updated",
      dialogueNodeId: "735201",
      content: "修改后的对白",
      saved: true,
    });
    expect(connection.commonByData.get("ActionData1")?.[2].CurrentString).toBe(
      "修改后的对白",
    );
    expect(
      connection.calls.filter(
        (call) => call.action === "reflect.write_object_property",
      ),
    ).toHaveLength(1);
    expect(
      connection.calls.some((call) => call.action === "asset.save_asset"),
    ).toBe(true);
  });

  it("blocks stale or dirty dialogue content before writing", async () => {
    const stale = new FakeStoryboardExportConnection();

    await expect(
      updateDialogueContent(
        {
          dialogueId: "7352",
          startId: "735200",
          dialogueNodeId: "735201",
          previousContent: "过期内容",
          content: "修改后的对白",
        },
        () => stale,
      ),
    ).rejects.toThrow("UE 内容已发生变化");
    expect(
      stale.calls.some(
        (call) => call.action === "reflect.write_object_property",
      ),
    ).toBe(false);

    const dirty = new FakeStoryboardExportConnection();
    dirty.dirtyPackages = [
      "/Game/Seria/Task/dialoggraph/Test/735200",
    ];
    await expect(
      updateDialogueContent(
        {
          dialogueId: "7352",
          startId: "735200",
          dialogueNodeId: "735201",
          previousContent: "对白 735201",
          content: "修改后的对白",
        },
        () => dirty,
      ),
    ).rejects.toThrow("存在未保存修改");
    expect(
      dirty.calls.some(
        (call) => call.action === "reflect.write_object_property",
      ),
    ).toBe(false);
  });

  it("restores the original Content property when saving fails", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.saveResult = false;

    await expect(
      updateDialogueContent(
        {
          dialogueId: "7352",
          startId: "735200",
          dialogueNodeId: "735201",
          previousContent: "对白 735201",
          content: "修改后的对白",
        },
        () => connection,
      ),
    ).rejects.toThrow("已尝试恢复本轮未保存修改");
    expect(connection.commonByData.get("ActionData1")?.[2].CurrentString).toBe(
      "对白 735201",
    );
  });

  it("updates multiple nodes and saves their dialogue asset once", async () => {
    const connection = new FakeStoryboardExportConnection();

    const result = await updateDialogueContents(
      {
        items: [
          {
            dialogueId: "7352",
            startId: "735200",
            dialogueNodeId: "735201",
            previousContent: "对白 735201",
            content: "统一术语一",
          },
          {
            dialogueId: "7352",
            startId: "735200",
            dialogueNodeId: "735202",
            previousContent: "对白 735202",
            content: "统一术语二",
          },
        ],
      },
      () => connection,
    );

    expect(result).toMatchObject({
      updatedCount: 2,
      unchangedCount: 0,
      savedAssetCount: 1,
    });
    expect(connection.commonByData.get("ActionData1")?.[2].CurrentString).toBe(
      "统一术语一",
    );
    expect(connection.commonByData.get("ActionData2")?.[2].CurrentString).toBe(
      "统一术语二",
    );
    expect(
      connection.calls.filter(
        (call) => call.action === "asset.save_asset",
      ),
    ).toHaveLength(1);
  });

  it("preflights every batch item before writing any node", async () => {
    const connection = new FakeStoryboardExportConnection();

    await expect(
      updateDialogueContents(
        {
          items: [
            {
              dialogueId: "7352",
              startId: "735200",
              dialogueNodeId: "735201",
              previousContent: "对白 735201",
              content: "第一条修改",
            },
            {
              dialogueId: "7352",
              startId: "735200",
              dialogueNodeId: "735202",
              previousContent: "已经过期",
              content: "第二条修改",
            },
          ],
        },
        () => connection,
      ),
    ).rejects.toThrow("节点 735202 的 UE 内容已发生变化");
    expect(
      connection.calls.some(
        (call) => call.action === "reflect.write_object_property",
      ),
    ).toBe(false);
  });
});
