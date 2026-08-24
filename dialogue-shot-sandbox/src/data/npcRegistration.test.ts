import { describe, expect, it } from "vitest";
import type { DialogueDatabase, SelectedLevelActorsResult } from "../types";
import {
  buildNpcRegistrationCandidates,
  formatUnrealRotator,
  formatUnrealVector,
  parseUnrealRotatorText,
  parseUnrealVectorText,
} from "./npcRegistration";

function database(): DialogueDatabase {
  return {
    dialogueRows: [],
    starts: [],
    npcs: new Map([
      [
        101968,
        {
          id: 101968,
          name: "商会安保",
          note: "",
          introduction: "",
          resourceId: 200135,
          title: "安保",
          canTurn: true,
        },
      ],
      [
        101970,
        {
          id: 101970,
          name: "固定守卫",
          note: "",
          introduction: "",
          resourceId: 200135,
          title: "",
          canTurn: false,
        },
      ],
    ]),
    models: new Map([
      [
        200135,
        {
          id: 200135,
          configuredPath: "/Game/Seria/NPC/Guard/BP_Guard",
          generatedClassPath:
            "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
          rowNumber: 3,
        },
      ],
    ]),
    missionRows: [],
    missionPositions: [
      {
        id: "103069",
        type: 1,
        description: "守卫 A",
        npcId: 101968,
        itemId: 0,
        blueprintModelId: null,
        mapId: "1209",
        positionText: "(X=10.000000,Y=20.000000,Z=30.000000)",
        rotationText:
          "(Pitch=0.000000,Yaw=90.000000,Roll=0.000000)",
        rowNumber: 3,
      },
    ],
    mapConfigs: [
      {
        id: "1204",
        name: "上城区",
        resourceId: "100128",
        assetPath:
          "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
        rowNumber: 3,
      },
      {
        id: "1209",
        name: "上城区",
        resourceId: "100128",
        assetPath:
          "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
        rowNumber: 3,
      },
    ],
    sourceName: "test",
  };
}

function selection(): SelectedLevelActorsResult {
  return {
    mapAssetPath:
      "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
    actors: [
      {
        actorRef: "BP_Guard_C_0",
        label: "守卫 A",
        classPath:
          "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
        transform: {
          location: { x: 10, y: 20, z: 30 },
          rotation: { pitch: 0, yaw: 90, roll: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      {
        actorRef: "BP_NewNpc_C_0",
        label: "新角色",
        classPath:
          "/Game/Seria/NPC/New/BP_NewNpc.BP_NewNpc_C",
        transform: {
          location: { x: 40, y: 50, z: 60 },
          rotation: { pitch: 0, yaw: 0, roll: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ],
  };
}

describe("buildNpcRegistrationCandidates", () => {
  it("finds reusable model and NPC records for selected UE actors", () => {
    const candidates = buildNpcRegistrationCandidates(
      database(),
      selection(),
    );

    expect(candidates[0]).toMatchObject({
      mapId: "1209",
      mapName: "上城区",
      mapOptions: [{ id: "1204" }, { id: "1209" }],
      modelOptions: [{ id: 200135 }],
      npcOptions: [
        { id: 101968, title: "安保", canTurn: true },
        { id: 101970, title: "", canTurn: false },
      ],
      positionMatches: [{ id: "103069" }],
      targetMatches: [{ id: "103069", npcId: 101968 }],
    });
    expect(candidates[1]).toMatchObject({
      mapId: null,
      modelOptions: [],
      npcOptions: [],
      positionMatches: [],
      targetMatches: [],
      mapOptions: [{ id: "1204" }, { id: "1209" }],
    });
  });
});

describe("UE transform clipboard parsing", () => {
  it("accepts target-table, editor and plain vector formats", () => {
    expect(parseUnrealVectorText("(X=10,Y=-20.5,Z=3e2)")).toEqual({
      x: 10,
      y: -20.5,
      z: 300,
    });
    expect(parseUnrealVectorText("X=10 Y=-20.5 Z=300")).toEqual({
      x: 10,
      y: -20.5,
      z: 300,
    });
    expect(parseUnrealVectorText("10, -20.5, 300")).toEqual({
      x: 10,
      y: -20.5,
      z: 300,
    });
  });

  it("extracts location and rotation from a copied UE transform", () => {
    const clipboard =
      "(Rotation=(Pitch=1,Yaw=92.5,Roll=-3),Translation=(X=101,Y=202,Z=303),Scale3D=(X=1,Y=1,Z=1))";
    expect(parseUnrealVectorText(clipboard)).toEqual({
      x: 101,
      y: 202,
      z: 303,
    });
    expect(parseUnrealRotatorText(clipboard)).toEqual({
      pitch: 1,
      yaw: 92.5,
      roll: -3,
    });
  });

  it("accepts compact rotator labels and emits table-safe text", () => {
    const rotation = parseUnrealRotatorText("P=1 Y=-90 R=.25");
    expect(rotation).toEqual({ pitch: 1, yaw: -90, roll: 0.25 });
    expect(formatUnrealVector({ x: 1, y: 2.5, z: -3 })).toBe(
      "(X=1.000000,Y=2.500000,Z=-3.000000)",
    );
    expect(formatUnrealRotator(rotation!)).toBe(
      "(Pitch=1.000000,Yaw=-90.000000,Roll=0.250000)",
    );
  });

  it("rejects incomplete values", () => {
    expect(parseUnrealVectorText("X=1,Y=2")).toBeNull();
    expect(parseUnrealRotatorText("Pitch=0,Yaw=90")).toBeNull();
    expect(parseUnrealRotatorText("X=0,Y=0,Z=0")).toBeNull();
  });
});
