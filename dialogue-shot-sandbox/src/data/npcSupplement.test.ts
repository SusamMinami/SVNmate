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
    const plan = buildNpcSupplementPlan(
      request("actions"),
      [
        "D:/FBX/N28/Animation/A_N28_Idle.fbx",
        "D:/FBX/N28/Animation/A_N28_TurnL.fbx",
        "D:/FBX/N28/Animation/Face/A_N28_Idle_Face.fbx",
      ],
      new Map([
        ["D:/FBX/N28/Animation/A_N28_Idle.fbx", 1_725_900_000_000],
        ["D:/FBX/N28/Animation/A_N28_TurnL.fbx", 1_725_800_000_000],
        [
          "D:/FBX/N28/Animation/Face/A_N28_Idle_Face.fbx",
          1_725_900_100_000,
        ],
      ]),
    );

    expect(plan.canApply).toBe(true);
    expect(plan.items).toMatchObject([
      {
        actionName: "Idle",
        sourceModifiedTimeMs: 1_725_900_000_000,
        state: "update",
        montageName: "AM_Idle1",
        montageState: "create",
        montageSlotName: "IdleSlot",
        makeMontage: true,
        pairedFace: {
          sourceAssetName: "A_N28_Idle_Face",
          sourceModifiedTimeMs: 1_725_900_100_000,
          state: "new",
          copyFaceCurves: true,
        },
      },
      {
        actionName: "TurnL",
        sourceModifiedTimeMs: 1_725_800_000_000,
        state: "new",
        montageName: "AM_TurnLeft90",
        montageState: "create",
      },
    ]);
    expect(plan.warnings).toContain(
      "已自动匹配 1 个同名 _Face FBX，将在 Body 导入后连续处理且不重建 Montage",
    );
  });

  it("blocks an automatic face pair when the target has no face skeleton", () => {
    const plan = buildNpcSupplementPlan(
      request("actions", {
        target: target({
          faceSkeletalMeshAssetPath: "",
          faceSkeletonAssetPath: "",
        }),
      }),
      [
        "D:/FBX/N28/Animation/A_N28_Wave.fbx",
        "D:/FBX/N28/Animation/A_N28_Wave_Face.fbx",
      ],
    );

    expect(plan.items[0]).toMatchObject({
      actionName: "Wave",
      state: "blocked",
      included: false,
      pairedFace: {
        sourceAssetName: "A_N28_Wave_Face",
        state: "blocked",
      },
    });
    expect(plan.items[0].blockedReason).toContain("缺少 Face Skeletal Mesh");
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
        montageSlotName: "IdleSlot",
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

  it("reuses a same-named Montage outside the animation root", () => {
    const plan = buildNpcSupplementPlan(
      request("face", {
        target: target({
          existingAssetPaths: [
            "/Game/Seria/NPC/N28/Animation/A_N28_Talk.A_N28_Talk",
            "/Game/Seria/NPC/N28/Animation/Montages/AM_Talk.AM_Talk",
          ],
        }),
      }),
      ["D:/FBX/N28/Animation/Face/A_N28_Talk_Face.fbx"],
    );

    expect(plan.items[0]).toMatchObject({
      montageName: "AM_Talk",
      montageAssetPath:
        "/Game/Seria/NPC/N28/Animation/Montages/AM_Talk",
      montageState: "reuse",
    });
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
