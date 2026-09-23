import { describe, expect, it } from "vitest";
import type {
  DialogueParticipant,
  DialogueRow,
} from "../types";
import {
  behaviourTypeForMontageName,
  dialogueCharacterActionTracks,
  dialogueParticipantsByModelIndex,
  mergeDialogueCharacterActionTracks,
  parseDialogueCharacterBehaviourString,
  parseDialogueRelativeTransformsString,
  resolveDialogueCharacterStage,
  resolveDialogueFinalTransforms,
  turnDegreesFromMontageName,
} from "./characterActions";

describe("character actions", () => {
  it("maps AM_Turn actions to ERotate and signed yaw deltas", () => {
    expect(behaviourTypeForMontageName("AM_TurnRight45")).toBe("ERotate");
    expect(turnDegreesFromMontageName("AM_TurnRight45")).toBe(45);
    expect(turnDegreesFromMontageName("AM_TurnLeft160")).toBe(-160);
    expect(turnDegreesFromMontageName("AM_TurnRight90_Bird")).toBe(90);
    expect(turnDegreesFromMontageName("AM_C_TurnRight45")).toBe(45);
    expect(turnDegreesFromMontageName("AM_TurnLeft_90")).toBe(-90);
    expect(turnDegreesFromMontageName("AM_TurnR45")).toBe(45);
    expect(turnDegreesFromMontageName("AM_TrunLeft180")).toBe(-180);
    expect(turnDegreesFromMontageName("AM_TurnRight90_2")).toBe(90);
    expect(turnDegreesFromMontageName("AM_TurnLeft2_45")).toBe(-45);
  });

  it("keeps other Montage names as ordinary actions", () => {
    expect(behaviourTypeForMontageName("AM_Wave")).toBe("ENone");
    expect(turnDegreesFromMontageName("AM_Wave")).toBeNull();
  });

  it("uses a unique configured model match for compact role labels", () => {
    const participant = {
      id: 101968,
      name: "商会安保",
      note: "",
      introduction: "",
      resourceId: 200135,
      instanceId: "generated:101968",
      slot: "A" as const,
      color: "#fff",
      position: [0, 0, 0] as const,
      facingTarget: [0, 0, -2] as const,
      modelIndex: null,
      positionSource: "generated" as const,
      firstDialogueId: "735001",
      firstDialogueIndex: 0,
      lastDialogueId: "735001",
      lastDialogueIndex: 0,
      entryDialogueId: "735001",
      entryIndex: 0,
      exitDialogueId: null,
      exitIndex: null,
    };
    const models = new Map([
      [200135, {
        id: 200135,
        configuredPath: "/Game/Test/BP_N36_Commerce_Guard",
        generatedClassPath:
          "/Game/Test/BP_N36_Commerce_Guard.BP_N36_Commerce_Guard_C",
        rowNumber: 3,
      }],
    ]);
    const catalogs = [{
      modelIndex: 1,
      blueprintClassPath:
        "/Game/Test/BP_N36_Commerce_Guard.BP_N36_Commerce_Guard_C",
      characterLabel: "BP_N36_Commerce_Guard",
      status: "loaded" as const,
      message: "",
      actions: [],
    }];

    expect(
      dialogueParticipantsByModelIndex(
        [participant],
        [],
        catalogs,
        models,
      ).get(1)?.name,
    ).toBe("商会安保");

    const ambiguous = {
      ...participant,
      id: 101969,
      name: "另一名安保",
      instanceId: "generated:101969",
    };
    expect(
      dialogueParticipantsByModelIndex(
        [participant, ambiguous],
        [],
        catalogs,
        models,
      ).has(1),
    ).toBe(false);
  });

  it("respects a legacy nonzero player slot and resolves an unnamed NPC alias", () => {
    const participant = (
      id: number,
      name: string,
      resourceId: number | null,
      slot: DialogueParticipant["slot"],
    ): DialogueParticipant => ({
      id,
      name,
      note: "",
      introduction: "",
      resourceId,
      instanceId: `generated:${id}`,
      slot,
      color: "#fff",
      position: [0, 0, 0],
      facingTarget: [0, 0, -2],
      modelIndex: null,
      positionSource: "generated",
      firstDialogueId: "733602",
      firstDialogueIndex: 0,
      lastDialogueId: "733638",
      lastDialogueIndex: 1,
      entryDialogueId: "733602",
      entryIndex: 0,
      exitDialogueId: null,
      exitIndex: null,
    });
    const participants = [
      participant(1, "玩家", null, "A"),
      participant(101928, "？？？", 200172, "B"),
      participant(101917, "阿尔德里奇", 200478, "C"),
      participant(101916, "爱莲娜", 200172, "D"),
    ];
    const models = new Map([
      [200172, {
        id: 200172,
        configuredPath:
          "/Game/Seria/NPC/N25_Citizen_Female_A01/BP_N25_Citizen_Female_A01",
        generatedClassPath:
          "/Game/Seria/NPC/N25_Citizen_Female_A01/BP_N25_Citizen_Female_A01.BP_N25_Citizen_Female_A01_C",
        rowNumber: 1,
      }],
      [200478, {
        id: 200478,
        configuredPath:
          "/Game/Seria/NPC/N111_Aldridge/BP_N111_Aldridge",
        generatedClassPath:
          "/Game/Seria/NPC/N111_Aldridge/BP_N111_Aldridge.BP_N111_Aldridge_C",
        rowNumber: 2,
      }],
    ]);
    const catalogs = [
      {
        modelIndex: 0,
        blueprintClassPath:
          "/Game/Seria/NPC/N111_Aldridge/BP_N111_Aldridge.BP_N111_Aldridge_C",
        characterLabel: "N111_Aldridge",
        status: "loaded" as const,
        message: "",
        actions: [],
      },
      {
        modelIndex: 1,
        blueprintClassPath:
          "/Game/Seria/NPC/N25_Citizen_Female_A01/BP_N25_Citizen_Female_A01.BP_N25_Citizen_Female_A01_C",
        characterLabel: "N25_Citizen_Female_A01",
        status: "loaded" as const,
        message: "",
        actions: [],
      },
      {
        modelIndex: 2,
        blueprintClassPath:
          "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
        characterLabel: "player",
        status: "loaded" as const,
        message: "",
        actions: [],
      },
    ];

    const byModelIndex = dialogueParticipantsByModelIndex(
      participants,
      [],
      catalogs,
      models,
    );
    expect(byModelIndex.get(0)?.name).toBe("阿尔德里奇");
    expect(byModelIndex.get(1)?.name).toBe("爱莲娜");
    expect(byModelIndex.get(2)?.name).toBe("玩家");

    const rows: DialogueRow[] = [{
      id: "733602",
      npcId: 101928,
      content: "测试",
      nextId: null,
      isEnd: true,
      rowNumber: 1,
      state: 0,
      speakerSlot: "B",
      speakerModelIndex: null,
      relativeTransformsString: "",
      characterBehaviourString: "",
    }];
    const stage = resolveDialogueCharacterStage(
      participants,
      rows,
      0,
      [],
      [{
        dialogueId: "733602",
        modelIndex: 0,
        actions: [{
          montageName: "AM_TurnRight90",
          delaySeconds: 0,
        }],
      }],
      catalogs,
      models,
    );
    expect(stage.affectedParticipantSlots).toEqual(new Set(["C"]));
  });

  it("parses rotate, walk, and state-machine walk actions by model slot", () => {
    expect(
      parseDialogueCharacterBehaviourString(
        [
          "0.200000,AM_TurnRight90,1,0,0,0,0,0,0,0",
          [
            "0.000000,AM_Talk,0,0,0,0,0,0,0,0",
            "0.500000,AM_Walk,2,100,200,5,300,500,5,0",
          ].join("|"),
          "0.000000,None,3,300,500,5,200,400,5,0",
        ].join(";"),
      ),
    ).toEqual([
      {
        modelIndex: 0,
        montageName: "AM_TurnRight90",
        delaySeconds: 0.2,
        behaviourType: "ERotate",
        startLocation: { x: 0, y: 0, z: 0 },
        endLocation: { x: 0, y: 0, z: 0 },
      },
      {
        modelIndex: 1,
        montageName: "AM_Talk",
        delaySeconds: 0,
        behaviourType: "ENone",
        startLocation: { x: 0, y: 0, z: 0 },
        endLocation: { x: 0, y: 0, z: 0 },
      },
      {
        modelIndex: 1,
        montageName: "AM_Walk",
        delaySeconds: 0.5,
        behaviourType: "EWalk",
        startLocation: { x: 100, y: 200, z: 5 },
        endLocation: { x: 300, y: 500, z: 5 },
      },
      {
        modelIndex: 2,
        montageName: "None",
        delaySeconds: 0,
        behaviourType: "EStateMachineWalk",
        startLocation: { x: 300, y: 500, z: 5 },
        endLocation: { x: 200, y: 400, z: 5 },
      },
    ]);
  });

  it("ignores malformed or unsupported serialized actions", () => {
    expect(
      parseDialogueCharacterBehaviourString(
        "broken;0,AM_Walk,2,0,0,0,nope,10,0,0;0,AM_Walk,9,0,0,0,1,1,1,0",
      ),
    ).toEqual([]);
  });

  it("builds local read-only tracks without exposing AM_Talk", () => {
    const tracks = dialogueCharacterActionTracks([
      {
        id: "100001",
        characterBehaviourString:
          ";0,AM_Talk,0,0,0,0,0,0,0,0|0.2,AM_TurnRight45,1,0,0,0,0,0,0,0",
      },
    ]);
    expect(tracks).toEqual([
      {
        dialogueId: "100001",
        modelIndex: 1,
        actions: [
          expect.objectContaining({
            montageName: "AM_TurnRight45",
            behaviourType: "ERotate",
            delaySeconds: 0.2,
          }),
        ],
        preservedComplexActionCount: 0,
      },
    ]);
    expect(
      mergeDialogueCharacterActionTracks(tracks, [
        {
          dialogueId: "100001",
          modelIndex: 1,
          actions: [
            {
              montageName: "AM_TurnRight45",
              behaviourType: "ERotate",
              delaySeconds: 0.2,
            },
            {
              montageName: "AM_Wave",
              behaviourType: "ENone",
              delaySeconds: 0,
            },
          ],
          preservedComplexActionCount: 1,
        },
      ])[0],
    ).toMatchObject({
      actions: [
        { montageName: "AM_TurnRight45" },
        { montageName: "AM_Wave" },
      ],
      preservedComplexActionCount: 1,
    });
  });

  it("parses explicit and Blueprint-relative node transforms", () => {
    expect(
      parseDialogueRelativeTransformsString(
        "0|1,0,0,0,0,0,0;3|0,1,70,-2,110,220,5",
      ),
    ).toEqual([
      {
        modelIndex: 0,
        useBlueprintTransform: true,
        transform: {
          location: { x: 0, y: 0, z: 0 },
          rotation: { pitch: 0, yaw: 0, roll: 0 },
        },
      },
      {
        modelIndex: 3,
        useBlueprintTransform: false,
        transform: {
          location: { x: 110, y: 220, z: 5 },
          rotation: { pitch: 1, yaw: 70, roll: -2 },
        },
      },
    ]);
  });

  it("resolves the final local Transform from node overrides and actions", () => {
    const states = resolveDialogueFinalTransforms(
      [{
        modelIndex: 1,
        transform: {
          location: { x: 10, y: 20, z: 0 },
          rotation: { pitch: 0, yaw: 10, roll: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      }],
      [
        {
          id: "100001",
          relativeTransformsString: "1|1,0,0,0,0,0,0",
          characterBehaviourString:
            ";0,AM_Walk,2,10,20,0,110,220,0,0",
        },
        {
          id: "100002",
          relativeTransformsString: "1|0,0,70,0,110,220,0",
          characterBehaviourString:
            ";0,AM_TurnLeft45,1,0,0,0,0,0,0,0",
        },
        {
          id: "100003",
          relativeTransformsString: "",
          characterBehaviourString:
            ";0,None,3,110,220,0,60,320,0,0",
        },
      ],
    );

    expect(states.get(1)).toMatchObject({
      transform: {
        location: { x: 60, y: 320, z: 0 },
        rotation: { pitch: 0, roll: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      movementActionCount: 2,
      rotationActionCount: 1,
      lastAdjustedDialogueId: "100003",
    });
    expect(states.get(1)!.transform.rotation.yaw).toBeCloseTo(
      116.565,
      3,
    );
  });

  it("applies dialogue actions when rule placement has no BP model index", () => {
    const participant: DialogueParticipant = {
      id: 101,
      name: "测试角色",
      note: "",
      introduction: "",
      resourceId: null,
      instanceId: "bp:test:1",
      slot: "A",
      color: "#fff",
      position: [1, 0, 2],
      facingTarget: [1, 0, 0],
      modelIndex: null,
      positionSource: "generated",
      firstDialogueId: "100001",
      firstDialogueIndex: 0,
      lastDialogueId: "100003",
      lastDialogueIndex: 2,
      entryDialogueId: "100001",
      entryIndex: 0,
      exitDialogueId: null,
      exitIndex: null,
    };
    const row = (
      id: string,
      characterBehaviourString: string,
    ): DialogueRow => ({
      id,
      npcId: 101,
      content: id,
      nextId: null,
      isEnd: false,
      rowNumber: 1,
      state: 0,
      speakerSlot: "A",
      speakerModelIndex: 1,
      relativeTransformsString: "",
      characterBehaviourString,
    });
    const rows = [
      row(
        "100001",
        ";0,AM_TurnRight90,1,0,0,0,0,0,0,0",
      ),
      row(
        "100002",
        ";0,AM_Walk,2,100,200,0,300,500,0,0",
      ),
      row(
        "100003",
        ";0,None,3,300,500,0,200,400,0,0",
      ),
    ];

    const rotateStage = resolveDialogueCharacterStage(
      [participant],
      rows,
      0,
    );
    const afterRotate = rotateStage.participants[0];
    expect(rotateStage.affectedParticipantSlots).toEqual(new Set(["A"]));
    expect(afterRotate.position).toEqual([1, 0, 2]);
    expect(afterRotate.facingTarget[0]).toBeCloseTo(3);
    expect(afterRotate.facingTarget[2]).toBeCloseTo(2);

    const afterWalk = resolveDialogueCharacterStage(
      [participant],
      rows,
      1,
    ).participants[0];
    expect(afterWalk.position).toEqual([4, 0, 0]);
    expect(afterWalk.facingTarget[0]).toBeCloseTo(5.6641, 3);
    expect(afterWalk.facingTarget[2]).toBeCloseTo(-1.1094, 3);

    const afterMachineWalk = resolveDialogueCharacterStage(
      [participant],
      rows,
      2,
    ).participants[0];
    expect(afterMachineWalk.position).toEqual([3, 0, 1]);
    expect(afterMachineWalk.facingTarget[0]).toBeCloseTo(1.5858, 3);
    expect(afterMachineWalk.facingTarget[2]).toBeCloseTo(2.4142, 3);
  });

  it("deduplicates UE actions already present in the dialogue string", () => {
    const participant = {
      id: 101,
      name: "测试角色",
      note: "",
      introduction: "",
      resourceId: null,
      instanceId: "bp:test:1",
      slot: "A" as const,
      color: "#fff",
      position: [0, 0, 0] as const,
      facingTarget: [0, 0, -2] as const,
      modelIndex: 1,
      modelClassPath: "/Game/Test/BP_Test.BP_Test_C",
      positionSource: "blueprint" as const,
      firstDialogueId: "100001",
      firstDialogueIndex: 0,
      lastDialogueId: "100001",
      lastDialogueIndex: 0,
      entryDialogueId: "100001",
      entryIndex: 0,
      exitDialogueId: null,
      exitIndex: null,
    };
    const rows: DialogueRow[] = [{
      id: "100001",
      npcId: 101,
      content: "测试",
      nextId: null,
      isEnd: true,
      rowNumber: 1,
      state: 0,
      speakerSlot: "A",
      speakerModelIndex: 1,
      relativeTransformsString: "",
      characterBehaviourString:
        ";0,AM_TurnRight90,1,0,0,0,0,0,0,0",
    }];
    const stage = resolveDialogueCharacterStage(
      [participant],
      rows,
      0,
      [{
        dialogueId: "100001",
        modelIndex: 1,
        actions: [
          {
            montageName: "AM_TurnRight90",
            delaySeconds: 0,
            behaviourType: "ERotate",
          },
          {
            montageName: "AM_TurnLeft45",
            delaySeconds: 0.2,
            behaviourType: "ERotate",
          },
        ],
      }],
      [{
        dialogueId: "100001",
        modelIndex: 1,
        actions: [{
          montageName: "AM_TurnRight45",
          delaySeconds: 0.4,
        }],
      }],
    );

    expect(stage.participants[0].facingTarget[0]).toBeCloseTo(2);
    expect(stage.participants[0].facingTarget[2]).toBeCloseTo(0);
  });

  it("previews a replacement draft without replaying the existing actions", () => {
    const participant: DialogueParticipant = {
      id: 101,
      name: "测试角色",
      note: "",
      introduction: "",
      resourceId: null,
      instanceId: "bp:test:1",
      slot: "A",
      color: "#fff",
      position: [0, 0, 0],
      facingTarget: [0, 0, -2],
      modelIndex: 1,
      modelClassPath: "/Game/Test/BP_Test.BP_Test_C",
      positionSource: "blueprint",
      firstDialogueId: "100001",
      firstDialogueIndex: 0,
      lastDialogueId: "100001",
      lastDialogueIndex: 0,
      entryDialogueId: "100001",
      entryIndex: 0,
      exitDialogueId: null,
      exitIndex: null,
    };
    const rows: DialogueRow[] = [{
      id: "100001",
      npcId: 101,
      content: "测试",
      nextId: null,
      isEnd: true,
      rowNumber: 1,
      state: 0,
      speakerSlot: "A",
      speakerModelIndex: 1,
      relativeTransformsString: "",
      characterBehaviourString: "",
    }];

    const stage = resolveDialogueCharacterStage(
      [participant],
      rows,
      0,
      [{
        dialogueId: "100001",
        modelIndex: 1,
        actions: [{
          montageName: "AM_TurnRight90",
          delaySeconds: 0,
          behaviourType: "ERotate",
        }],
      }],
      [{
        dialogueId: "100001",
        modelIndex: 1,
        editMode: "replace_editable",
        actions: [{
          montageName: "AM_TurnLeft45",
          delaySeconds: 0.2,
          behaviourType: "ERotate",
        }],
      }],
    );

    expect(stage.participants[0].facingTarget[0]).toBeCloseTo(-Math.SQRT2);
    expect(stage.participants[0].facingTarget[2]).toBeCloseTo(-Math.SQRT2);
  });
});
