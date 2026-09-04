import { describe, expect, it } from "vitest";
import type {
  NpcSupplementPlanRequest,
  NpcSupplementTarget,
} from "../types";
import { buildNpcSupplementPlan } from "./npcSupplement";

function target(
  overrides: Partial<NpcSupplementTarget> = {},
): NpcSupplementTarget {
  return {
    targetProjectFile: "D:/Seria/res/res.uproject",
    targetContentDirectory: "D:/Seria/res/Content",
    selectedAssetPath: "/Game/Seria/NPC/N28/BP_N28.BP_N28",
    selectedAssetName: "BP_N28",
    selectedAssetType: "Blueprint",
    npcName: "N28",
    skeletalMeshAssetPath: "/Game/Seria/NPC/N28/SK_N28.SK_N28",
    skeletonAssetPath: "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
    faceSkeletalMeshAssetPath:
      "/Game/Seria/NPC/N28/SK_N28_Face.SK_N28_Face",
    faceSkeletonAssetPath:
      "/Game/Seria/NPC/N28/SKEL_N28_Face.SKEL_N28_Face",
    targetPackagePath: "/Game/Seria/NPC/N28",
    animationPackagePath: "/Game/Seria/NPC/N28/Animation",
    existingAssetPaths: [
      "/Game/Seria/NPC/N28/Animation/A_N28_Idle.A_N28_Idle",
      "/Game/Seria/NPC/N28/Animation/A_N28_Talk.A_N28_Talk",
    ],
    dirtyPackageNames: [],
    warnings: [],
    ...overrides,
  };
}

function request(
  kind: NpcSupplementPlanRequest["kind"],
  overrides: Partial<NpcSupplementPlanRequest> = {},
): NpcSupplementPlanRequest {
  return {
    kind,
    target: target(),
    sourceDirectory: "D:/FBX/N28/Animation",
    ...overrides,
  };
}

describe("NPC supplement planning", () => {
  it("classifies new and updated body actions and plans standard montages", () => {
    const plan = buildNpcSupplementPlan(request("actions"), [
      "D:/FBX/N28/Animation/A_N28_Idle.fbx",
      "D:/FBX/N28/Animation/A_N28_TurnL.fbx",
      "D:/FBX/N28/Animation/Face/A_N28_Talk_Face.fbx",
    ]);

    expect(plan.canApply).toBe(true);
    expect(plan.items).toMatchObject([
      {
        actionName: "Idle",
        state: "update",
        montageName: "AM_Idle1",
        montageState: "create",
        makeMontage: true,
      },
      {
        actionName: "TurnL",
        state: "new",
        montageName: "AM_TurnLeft90",
        montageState: "create",
      },
    ]);
  });

  it("matches face actions to body actions and blocks missing pairs", () => {
    const plan = buildNpcSupplementPlan(request("face"), [
      "D:/FBX/N28/Animation/Face/A_N28_Talk_Face.fbx",
      "D:/FBX/N28/Animation/Face/A_N28_Wave_Face.fbx",
    ]);

    expect(plan.items).toMatchObject([
      {
        actionName: "Talk",
        bodyAssetPath: "/Game/Seria/NPC/N28/Animation/A_N28_Talk",
        montageName: "AM_Talk",
        copyFaceCurves: true,
        makeMontage: true,
        state: "new",
        included: true,
      },
      {
        actionName: "Wave",
        state: "blocked",
        included: false,
      },
    ]);
    expect(plan.canApply).toBe(true);
  });

  it("blocks face preparation without a face skeleton", () => {
    const plan = buildNpcSupplementPlan(
      request("face", {
        target: target({
          faceSkeletonAssetPath: "",
        }),
      }),
      ["D:/FBX/N28/Animation/Face/A_N28_Talk_Face.fbx"],
    );

    expect(plan.canApply).toBe(false);
    expect(plan.blockedReasons).toEqual([
      "未找到 NPC 的 Face Skeletal Mesh 或 Face Skeleton",
    ]);
  });

  it("uses the helper table defaults for curve and montage decisions", () => {
    const plan = buildNpcSupplementPlan(request("face"), [
      "D:/FBX/N28/Animation/Face/A_N28_LookF_Face.fbx",
      "D:/FBX/N28/Animation/Face/A_N28_TurnL_Face.fbx",
      "D:/FBX/N28/Animation/Face/A_N28_Idle1_Face.fbx",
      "D:/FBX/N28/Animation/Face/A_N28_Talk_Face.fbx",
    ]);

    expect(
      plan.items.map((item) => ({
        action: item.actionName,
        curves: item.copyFaceCurves,
        montage: item.makeMontage,
      })),
    ).toEqual([
      { action: "Idle1", curves: true, montage: true },
      { action: "LookF", curves: false, montage: false },
      { action: "Talk", curves: true, montage: true },
      { action: "TurnL", curves: true, montage: false },
    ]);
  });

  it("requires a refreshed review after the included set changes", () => {
    const plan = buildNpcSupplementPlan(
      request("actions", {
        includedSourceFiles: [
          "D:/FBX/N28/Animation/A_N28_TurnL.fbx",
        ],
      }),
      [
        "D:/FBX/N28/Animation/A_N28_Idle.fbx",
        "D:/FBX/N28/Animation/A_N28_TurnL.fbx",
      ],
    );

    expect(plan.items.map((item) => item.included)).toEqual([false, true]);
    expect(plan.canApply).toBe(true);
  });
});
