import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { StoryboardExportRequest } from "../src/types";
import {
  appendCharacterActions,
  buildStoryboardCameraMove,
  exportDialogueStoryboard,
  inspectDialogueStoryboardExport,
  readDialogueCharacterActions,
  updateDialogueContent,
  updateDialogueContents,
} from "./ueBridge";
import type { UnrealInvoker } from "./ue/transport";

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
    {
      Alias: "DelayTime",
      CurrentFloat: 0,
    },
    {
      Alias: "SoundEffect",
      CurrentPath: "",
    },
    {
      Alias: "BackgroundMusic",
      CurrentUint32: 1,
    },
    {
      Alias: "DelayBackgroundMusicTime",
      CurrentFloat: 2.5,
    },
  ];
}

function normalizeUnrealReadback(value: unknown): unknown {
  if (typeof value === "number") {
    return Math.fround(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeUnrealReadback);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, normalizeUnrealReadback(child)]),
    );
  }
  return value;
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
  readonly behavioursByData = new Map<string, unknown[]>([
    ["ActionData1", []],
    ["ActionData2", []],
    ["ActionData3", []],
  ]);
  saveResult = true;
  dirtyPackages: string[] = [];
  normalizeMoveReadback = false;
  forcePushBlendOutTime: number | null = null;
  forceDelayTimeAfterWrite: number | null = null;
  failRollbackWrites = false;
  commonWriteCount = 0;
  saveAttempted = false;
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
      if (String(args.Query).startsWith("A_SFX_")) {
        const assetName = String(args.Query);
        return [
          `${assetName} (AkAudioEvent) [/Game/Seria/WwiseSoundData/Events/${assetName}.${assetName}]`,
        ];
      }
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
      this.saveAttempted = true;
      return this.saveResult;
    }
    if (action === "reflect.write_object_property") {
      if (this.saveAttempted && this.failRollbackWrites) {
        throw new Error("模拟恢复写入失败");
      }
      const dataName = String(args.ThisPtr).split(".").at(-1)!;
      if (args.PropertyName === "CommonDialogGraphProperties") {
        this.commonWriteCount += 1;
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
      if (args.PropertyName === "CharacterBehaviours") {
        this.behavioursByData.set(
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
        const common = structuredClone(this.commonByData.get(dataName));
        if (this.commonWriteCount > 0 && this.forceDelayTimeAfterWrite !== null) {
          const delayTime = common?.find(
            (entry) => entry.Alias === "DelayTime",
          );
          if (delayTime) {
            delayTime.CurrentFloat = this.forceDelayTimeAfterWrite;
          }
        }
        return common;
      }
      if (property === "MoveCameras") {
        const moves = structuredClone(this.movesByData.get(dataName));
        if (!this.normalizeMoveReadback) {
          return moves;
        }
        const normalized = normalizeUnrealReadback(moves) as Array<
          Record<string, unknown>
        >;
        for (const move of normalized) {
          move.FutureDefault = 0;
          const push = move.PushCameraArg as
            | Record<string, unknown>
            | undefined;
          if (push && this.forcePushBlendOutTime !== null) {
            push.BlendOutTime = this.forcePushBlendOutTime;
          }
        }
        return normalized;
      }
      if (property === "CharacterBehaviours") {
        return structuredClone(this.behavioursByData.get(dataName));
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
    if (object === "Template_0" && property === "ChildActorClass") {
      return "/Game/Test/BP_Player.BP_Player_C";
    }
    if (object === "Template_1" && property === "ChildActorClass") {
      return "/Game/Test/BP_Npc.BP_Npc_C";
    }
    if (object.includes("Default__") && property === "Montages") {
      return {
        Keys: ["AM_Idle1", "AM_Talk", "AM_TurnRight45", "AM_Wave"],
        Values: [
          "/Game/Test/Animation/AM_Idle1.AM_Idle1",
          "/Game/Test/Animation/AM_Talk.AM_Talk",
          "/Game/Test/Animation/AM_TurnRight45.AM_TurnRight45",
          "/Game/Test/Animation/AM_Wave.AM_Wave",
        ],
      };
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
    expect(preview.nodes.map((node) => node.shotIndex)).toEqual([0, 0, 1]);

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

  it("writes only the requested shot and leaves other nodes unchanged", async () => {
    const connection = new FakeStoryboardExportConnection();
    const fullRequest = exportRequest();
    const request: StoryboardExportRequest = {
      ...fullRequest,
      dialogueIds: ["735203"],
      shots: [fullRequest.shots[1]],
    };
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    const result = await exportDialogueStoryboard(
      { ...request, reviewToken: preview.reviewToken },
      () => connection,
    );

    expect(result.changedNodeCount).toBe(1);
    expect(connection.commonByData.get("ActionData1")?.[1].CurrentString).toBe(
      "",
    );
    expect(connection.commonByData.get("ActionData2")?.[1].CurrentString).toBe(
      "c2",
    );
    expect(connection.commonByData.get("ActionData3")?.[1].CurrentString).toBe(
      "c1",
    );
  });

  it("reports planned actor turns without writing character actions", async () => {
    const connection = new FakeStoryboardExportConnection();
    const request = exportRequest();
    request.shots[0].actorActions = [
      {
        modelIndex: 0,
        montageName: "AM_TurnRight90",
        angleDegrees: 90,
      },
    ];

    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    expect(preview.shots[0].actorActionCount).toBe(1);
    expect(
      connection.calls.some(
        (call) =>
          call.action === "reflect.write_object_property" &&
          call.args.PropertyName === "CharacterBehaviours",
      ),
    ).toBe(false);
  });

  it("rejects camera export with fewer than two Blueprint participants", async () => {
    const request = exportRequest();
    request.participantModelIndexes = [0];

    await expect(
      inspectDialogueStoryboardExport(
        request,
        () => new FakeStoryboardExportConnection(),
      ),
    ).rejects.toThrow("至少两个 UE Blueprint 站位");
  });

  it("reads BP Montages and existing node actions for the editor", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.behavioursByData.set("ActionData1", [
      {
        CharacterBehaviourItems: [
          {
            StartTime: 0.25,
            MontageName: "AM_Wave",
            CharacterBehaviourType: "ENone",
          },
        ],
        bStop: false,
      },
    ]);

    const result = await readDialogueCharacterActions(
      {
        startId: "735200",
        dialogueIds: ["735201"],
        models: [
          {
            modelIndex: 0,
            blueprintClassPath: "/Game/Test/BP_Player.BP_Player_C",
          },
        ],
      },
      () => connection,
    );

    expect(result).toMatchObject({
      dialogueAssetPath: connection.dialogueAssetPath,
      catalogs: [
        {
          modelIndex: 0,
          status: "loaded",
          actions: [
            { name: "AM_Idle1" },
            { name: "AM_Talk" },
            { name: "AM_TurnRight45" },
            { name: "AM_Wave" },
          ],
        },
      ],
      tracks: [
        {
          dialogueId: "735201",
          modelIndex: 0,
          actions: [{ montageName: "AM_Wave", delaySeconds: 0.25 }],
          preservedComplexActionCount: 0,
        },
      ],
    });
  });

  it("appends ordered Montage actions and maps AM_Turn to ERotate", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.behavioursByData.set("ActionData1", [
      {
        CharacterBehaviourItems: [
          {
            StartTime: 0,
            MontageName: "AM_Walk",
            CharacterBehaviourType: "EWalk",
            StartLocation: { X: 1, Y: 2, Z: 3 },
            EndLocation: { X: 4, Y: 5, Z: 6 },
          },
          {
            StartTime: 0,
            MontageName: "AM_Idle1",
            CharacterBehaviourType: "ENone",
          },
        ],
        bStop: true,
      },
    ]);
    const request = exportRequest();
    request.characterActions = [
      {
        dialogueId: "735201",
        modelIndex: 0,
        actions: [
          { montageName: "AM_TurnRight45", delaySeconds: 0.2 },
          { montageName: "AM_Talk", delaySeconds: 0.6 },
        ],
      },
    ];

    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );
    expect(preview.characterActions).toEqual([
      expect.objectContaining({
        dialogueId: "735201",
        modelIndex: 0,
        existingActions: [
          expect.objectContaining({
            montageName: "AM_Walk",
            delaySeconds: 0,
            behaviourType: "EWalk",
          }),
          expect.objectContaining({
            montageName: "AM_Idle1",
            delaySeconds: 0,
            behaviourType: "ENone",
          }),
        ],
        desiredActions: [
          expect.objectContaining({ montageName: "AM_Walk" }),
          expect.objectContaining({ montageName: "AM_Idle1" }),
          expect.objectContaining({
            montageName: "AM_TurnRight45",
            delaySeconds: 0.2,
            behaviourType: "ERotate",
          }),
          expect.objectContaining({
            montageName: "AM_Talk",
            delaySeconds: 0.6,
            behaviourType: "ENone",
          }),
        ],
        preservedComplexActionCount: 0,
        action: "add",
      }),
    ]);

    const result = await exportDialogueStoryboard(
      { ...request, reviewToken: preview.reviewToken },
      () => connection,
    );
    expect(result.changedCharacterActionCount).toBe(1);
    expect(connection.behavioursByData.get("ActionData1")).toEqual([
      expect.objectContaining({
        bStop: true,
        CharacterBehaviourItems: [
          expect.objectContaining({
            MontageName: "AM_Walk",
            CharacterBehaviourType: "EWalk",
          }),
          expect.objectContaining({
            MontageName: "AM_Idle1",
            CharacterBehaviourType: "ENone",
          }),
          expect.objectContaining({
            MontageName: "AM_TurnRight45",
            StartTime: 0.2,
            CharacterBehaviourType: "ERotate",
          }),
          expect.objectContaining({
            MontageName: "AM_Talk",
            StartTime: 0.6,
            CharacterBehaviourType: "ENone",
          }),
        ],
      }),
    ]);
  });

  it("preserves existing items when appending editable actions", () => {
    expect(
      appendCharacterActions(
        [
          {
            CharacterBehaviourItems: [
              {
                MontageName: "AM_Old",
                CharacterBehaviourType: "ENone",
              },
              {
                MontageName: "AM_TurnLeft45",
                CharacterBehaviourType: "ERotate",
              },
            ],
            bStop: true,
          },
        ],
        [
          {
            modelIndex: 0,
            actions: [{ montageName: "AM_Wave", delaySeconds: 0.3 }],
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        bStop: true,
        CharacterBehaviourItems: [
          expect.objectContaining({
            MontageName: "AM_Old",
            CharacterBehaviourType: "ENone",
          }),
          expect.objectContaining({
            MontageName: "AM_TurnLeft45",
            CharacterBehaviourType: "ERotate",
          }),
          expect.objectContaining({
            MontageName: "AM_Wave",
            StartTime: 0.3,
            CharacterBehaviourType: "ENone",
          }),
        ],
      }),
    ]);
  });

  it("accepts UE float32 normalization and additional default fields", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.normalizeMoveReadback = true;
    const request = exportRequest("dolly_in");
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    await expect(
      exportDialogueStoryboard(
        { ...request, reviewToken: preview.reviewToken },
        () => connection,
      ),
    ).resolves.toMatchObject({
      status: "exported",
      saved: true,
    });
  });

  it("reports the exact camera field when UE changes a written value", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.normalizeMoveReadback = true;
    connection.forcePushBlendOutTime = 0;
    const request = exportRequest("dolly_in");
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    await expect(
      exportDialogueStoryboard(
        { ...request, reviewToken: preview.reviewToken },
        () => connection,
      ),
    ).rejects.toThrow(
      "MoveCameras[0].PushCameraArg.BlendOutTime 期望 1，回读 0",
    );
  });

  it("verifies preserved common properties after writing", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.forceDelayTimeAfterWrite = 3;
    const request = exportRequest();
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    await expect(
      exportDialogueStoryboard(
        { ...request, reviewToken: preview.reviewToken },
        () => connection,
      ),
    ).rejects.toThrow("CommonDialogGraphProperties[3].CurrentFloat");
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

  it("blocks character action export when its NPC Blueprint is dirty", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.dirtyPackages = ["/Game/Test/BP_Player"];
    const request = exportRequest();
    request.characterActions = [
      {
        dialogueId: "735201",
        modelIndex: 0,
        actions: [{ montageName: "AM_Wave", delaySeconds: 0 }],
      },
    ];

    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    expect(preview.blockedReasons).toContainEqual(
      expect.stringContaining("角色 BP /Game/Test/BP_Player"),
    );
    expect(preview.globalBlockedReasons).not.toContainEqual(
      expect.stringContaining("角色 BP"),
    );
    expect(preview.characterActionBlockedReasons).toEqual([
      {
        modelIndex: 0,
        reason: expect.stringContaining("角色 BP /Game/Test/BP_Player"),
      },
    ]);
    await expect(
      exportDialogueStoryboard(
        { ...request, reviewToken: preview.reviewToken },
        () => connection,
      ),
    ).rejects.toThrow("角色 BP");
  });

  it("restores in-memory node values when saving fails", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.saveResult = false;
    const request = exportRequest();
    request.characterActions = [
      {
        dialogueId: "735201",
        modelIndex: 0,
        actions: [{ montageName: "AM_Wave", delaySeconds: 0.2 }],
      },
    ];
    const originalCamera = connection.commonByData.get("ActionData1")?.[1]
      .CurrentString;
    const originalBehaviours = structuredClone(
      connection.behavioursByData.get("ActionData1"),
    );
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    await expect(
      exportDialogueStoryboard(
        { ...request, reviewToken: preview.reviewToken },
        () => connection,
      ),
    ).rejects.toThrow("已恢复本轮未保存修改");
    expect(connection.commonByData.get("ActionData1")?.[1].CurrentString).toBe(
      originalCamera,
    );
    expect(connection.movesByData.get("ActionData1")).toEqual([]);
    expect(connection.behavioursByData.get("ActionData1")).toEqual(
      originalBehaviours,
    );
  });

  it("reports when rollback cannot restore UE node values", async () => {
    const connection = new FakeStoryboardExportConnection();
    connection.saveResult = false;
    connection.failRollbackWrites = true;
    const request = exportRequest();
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    await expect(
      exportDialogueStoryboard(
        { ...request, reviewToken: preview.reviewToken },
        () => connection,
      ),
    ).rejects.toThrow("恢复失败，请立即在 UE 中检查");
  });
});

describe("storyboard sound and music export", () => {
  it("previews and writes selected sound and music without changing delays", async () => {
    const connection = new FakeStoryboardExportConnection();
    const request = {
      ...exportRequest(),
      soundEffects: [
        {
          dialogueId: "735201",
          assetName: "A_SFX_Dialog_516918",
        },
      ],
      music: [
        {
          dialogueId: "735201",
          stateId: 13,
          stateName: "Crisis_Breakout",
          musicName: "情绪-危机爆发",
        },
      ],
    };
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );

    expect(preview).toMatchObject({
      soundEffectCount: 1,
      changedSoundEffectCount: 1,
      replacedSoundEffectCount: 0,
      musicCount: 1,
      changedMusicCount: 1,
      replacedMusicCount: 0,
      soundEffects: [
        {
          soundEffectIndex: 0,
          dialogueId: "735201",
          assetName: "A_SFX_Dialog_516918",
          action: "add",
        },
      ],
      music: [
        {
          musicIndex: 0,
          dialogueId: "735201",
          stateId: 13,
          stateName: "Crisis_Breakout",
          existingStateId: 1,
          action: "add",
        },
      ],
    });

    const result = await exportDialogueStoryboard(
      { ...request, reviewToken: preview.reviewToken },
      () => connection,
    );

    expect(result.changedSoundEffectCount).toBe(1);
    expect(result.changedMusicCount).toBe(1);
    const written = connection.commonByData.get("ActionData1") ?? [];
    expect(
      written.find((property) => property.Alias === "SoundEffect")
        ?.CurrentPath,
    ).toBe(
      "/Game/Seria/WwiseSoundData/Events/A_SFX_Dialog_516918.A_SFX_Dialog_516918",
    );
    expect(
      written.find((property) => property.Alias === "DelayTime")
        ?.CurrentFloat,
    ).toBe(0);
    expect(written[1].CurrentString).toBe("c1");
    expect(
      written.find((property) => property.Alias === "BackgroundMusic")
        ?.CurrentUint32,
    ).toBe(13);
    expect(
      written.find(
        (property) => property.Alias === "DelayBackgroundMusicTime",
      )?.CurrentFloat,
    ).toBe(2.5);
  });

  it("allows exporting only selected sound effects", async () => {
    const connection = new FakeStoryboardExportConnection();
    const request: StoryboardExportRequest = {
      ...exportRequest(),
      dialogueIds: [],
      shots: [],
      soundEffects: [
        {
          dialogueId: "735203",
          assetName: "A_SFX_Dialog_516918",
        },
      ],
    };
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );
    const result = await exportDialogueStoryboard(
      { ...request, reviewToken: preview.reviewToken },
      () => connection,
    );

    expect(preview.cameraName).toBe("");
    expect(preview.nodes).toEqual([]);
    expect(result).toMatchObject({
      changedNodeCount: 0,
      changedSoundEffectCount: 1,
      saved: true,
    });
    expect(
      connection.calls.some(
        (call) => call.action === "bp.get_blueprint_by_path",
      ),
    ).toBe(false);
  });

  it("allows exporting only selected music", async () => {
    const connection = new FakeStoryboardExportConnection();
    const request: StoryboardExportRequest = {
      ...exportRequest(),
      dialogueIds: [],
      shots: [],
      music: [
        {
          dialogueId: "735203",
          stateId: 18,
          stateName: "Sincere",
          musicName: "情绪-真诚",
        },
      ],
    };
    const preview = await inspectDialogueStoryboardExport(
      request,
      () => connection,
    );
    const result = await exportDialogueStoryboard(
      { ...request, reviewToken: preview.reviewToken },
      () => connection,
    );

    expect(preview).toMatchObject({
      cameraName: "",
      nodes: [],
      musicCount: 1,
      changedMusicCount: 1,
    });
    expect(result).toMatchObject({
      changedNodeCount: 0,
      changedSoundEffectCount: 0,
      changedMusicCount: 1,
      saved: true,
    });
    expect(
      connection.commonByData
        .get("ActionData3")
        ?.find((property) => property.Alias === "BackgroundMusic")
        ?.CurrentUint32,
    ).toBe(18);
  });

  it("rejects music nodes outside the current dialogue", async () => {
    const connection = new FakeStoryboardExportConnection();
    const request: StoryboardExportRequest = {
      ...exportRequest(),
      dialogueIds: [],
      shots: [],
      music: [
        {
          dialogueId: "999901",
          stateId: 18,
          stateName: "Sincere",
          musicName: "情绪-真诚",
        },
      ],
    };

    await expect(
      inspectDialogueStoryboardExport(request, () => connection),
    ).rejects.toThrow("音乐节点 999901 不属于对话 7352");
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
