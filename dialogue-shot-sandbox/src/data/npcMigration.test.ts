import { describe, expect, it } from "vitest";
import {
  buildNpcMigrationPlan,
  buildNpcAnimationRoleAssets,
  buildNpcMontagePlans,
  classifyNpcAnimationFiles,
  deriveAnimalAnimationName,
  deriveNpcMigrationIdentity,
  deriveNpcName,
  inferStandardAbpTemplate,
} from "./npcMigration";
import type {
  NpcMigrationFileOperation,
  NpcMigrationPlanRequest,
  NpcMigrationSourceScan,
} from "../types";

function sourceScan(
  overrides: Partial<NpcMigrationSourceScan> = {},
): NpcMigrationSourceScan {
  return {
    sourceProjectFile: "D:/Seria/Art/Art.uproject",
    sourceContentDirectory: "D:/Seria/Art/Content",
    skeletalMeshName: "SK_N28_Citizen_Male_C",
    skeletalMeshAssetPath:
      "/Game/Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C.SK_N28_Citizen_Male_C",
    skeletalMeshPackageName:
      "/Game/Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C",
    skeletonAssetPath:
      "/Game/Seria/NPC/N28_Citizen_Male_C/SKEL_N28_Citizen_Male_C.SKEL_N28_Citizen_Male_C",
    physicsAssetPath:
      "/Game/Seria/NPC/N28_Citizen_Male_C/PHYS_N28_Citizen_Male_C.PHYS_N28_Citizen_Male_C",
    materialAssetPaths: [
      "/Game/Seria/NPC/N28_Citizen_Male_C/ML_N28_Citizen_Male_C.ML_N28_Citizen_Male_C",
    ],
    dependencyPackageNames: [
      "/Game/Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C",
      "/Game/Seria/NPC/N28_Citizen_Male_C/SKEL_N28_Citizen_Male_C",
    ],
    sourceFiles: [
      {
        packageName:
          "/Game/Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C",
        sourcePath:
          "D:/Seria/Art/Content/Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C.uasset",
        relativePath:
          "Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C.uasset",
        size: 128,
      },
    ],
    dirtyPackageNames: [],
    suggestedNpcName: "N28_Citizen_Male_C",
    suggestedTargetPackagePath:
      "/Game/Seria/NPC/N28_Citizen_Male_C",
    warnings: [],
    ...overrides,
  };
}

function request(
  overrides: Partial<NpcMigrationPlanRequest> = {},
): NpcMigrationPlanRequest {
  return {
    source: sourceScan(),
    targetContentDirectory: "D:/Seria/res/Content",
    animationSourceDirectory:
      "D:/Seria/Art/美术源文件/动作源文件/FBX合集/Npc/N28_Citizen_Male_C/Animation",
    ...overrides,
  };
}

function operation(
  state: NpcMigrationFileOperation["state"] = "ready",
): NpcMigrationFileOperation {
  return {
    packageName:
      "/Game/Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C",
    sourcePath:
      "D:/Seria/Art/Content/Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C.uasset",
    destinationPath:
      "D:/Seria/res/Content/Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C.uasset",
    relativePath:
      "Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C.uasset",
    size: 128,
    state,
  };
}

describe("NPC migration planning", () => {
  it("derives the NPC name and separates body and face FBX files", () => {
    expect(deriveNpcName("SK_N28_Citizen_Male_C")).toBe(
      "N28_Citizen_Male_C",
    );
    expect(
      classifyNpcAnimationFiles([
        "D:/Anim/A_N28_Citizen_Male_C_LookF.fbx",
        "D:/Anim/Face/A_N28_Citizen_Male_C_Idle1_Face.FBX",
        "D:/Anim/readme.txt",
      ]),
    ).toEqual({
      body: ["D:/Anim/A_N28_Citizen_Male_C_LookF.fbx"],
      face: [
        "D:/Anim/Face/A_N28_Citizen_Male_C_Idle1_Face.FBX",
      ],
    });
    expect(inferStandardAbpTemplate("N28_Citizen_Male_C")).toBe("male");
    expect(inferStandardAbpTemplate("N18_Villager_Female_A")).toBe(
      "female",
    );
    expect(inferStandardAbpTemplate("N99_Robot")).toBe("female");
    expect(inferStandardAbpTemplate("E05_Cat01")).toBe("animal");
    expect(deriveAnimalAnimationName("E05_Cat01")).toBe("E05_Cat");
  });

  it("derives the animal BP, ABP, action prefix and split asset roots", () => {
    expect(
      deriveNpcMigrationIdentity(
        "E05_Cat01",
        "/Game/Seria/BioSystems/E05_Cat",
        "animal",
      ),
    ).toEqual({
      animationName: "E05_Cat",
      animationPrefix: "A_E05_Cat_",
      blueprintName: "BP_E05_CAT01_NPC",
      animationBlueprintName: "ABP_E05_CAT01_NPC",
      blueprintPackagePath: "/Game/Seria/NPC/E05_Cat",
      animationPackagePath:
        "/Game/Seria/BioSystems/E05_Cat/Animation",
      animationBlueprintPackagePath: "/Game/Seria/NPC/E05_Cat",
      montagePackagePath: "/Game/Seria/NPC/E05_Cat/Animation",
    });
  });

  it("maps playable actions to montage names and semantic slots", () => {
    expect(
      buildNpcMontagePlans("N28_Citizen_Male_C", [
        "D:/Anim/A_N28_Citizen_Male_C_Idle.fbx",
        "D:/Anim/A_N28_Citizen_Male_C_Idle3.fbx",
        "D:/Anim/A_N28_Citizen_Male_C_TurnL.fbx",
        "D:/Anim/A_N28_Citizen_Male_C_TurnRight90.fbx",
        "D:/Anim/A_N28_Citizen_Male_C_TurnLeft180.fbx",
        "D:/Anim/A_N28_Citizen_Male_C_Walk.fbx",
        "D:/Anim/A_N28_Citizen_Male_C_Wave.fbx",
        "D:/Anim/A_N28_Citizen_Male_C_AM_Emotion_Anger.fbx",
      ]).montages,
    ).toMatchObject([
      { montageName: "AM_Idle1", slotName: "IdleSlot" },
      { montageName: "AM_Idle3", slotName: "IdleSlot" },
      { montageName: "AM_TurnLeft90", slotName: "TurnSlot" },
      { montageName: "AM_TurnRight90", slotName: "TurnSlot" },
      { montageName: "AM_TurnLeft180", slotName: "TurnSlot" },
      { montageName: "AM_Walk", slotName: "TurnSlot" },
      { montageName: "AM_Wave", slotName: "IdleSlot" },
      { montageName: "AM_Anger", slotName: "IdleSlot" },
    ]);
  });

  it("maps the six standard ABP replacement roles", () => {
    const result = buildNpcAnimationRoleAssets("N28_Guard_A", [
      "D:/Anim/A_N28_Guard_A_LookD.fbx",
      "D:/Anim/A_N28_Guard_A_LookF.fbx",
      "D:/Anim/A_N28_Guard_A_LookU.fbx",
      "D:/Anim/A_N28_Guard_A_Idlestand.fbx",
      "D:/Anim/A_N28_Guard_A_Impact.fbx",
      "D:/Anim/A_N28_Guard_A_Interact.fbx",
    ]);

    expect(result.missingRoles).toEqual([]);
    expect(result.duplicateRoles).toEqual([]);
    expect(result.assets).toMatchObject({
      lookDown: "A_N28_Guard_A_LookD",
      lookForward: "A_N28_Guard_A_LookF",
      lookUp: "A_N28_Guard_A_LookU",
      idleStand: "A_N28_Guard_A_Idlestand",
      impact: "A_N28_Guard_A_Impact",
      interact: "A_N28_Guard_A_Interact",
    });
  });

  it("builds the documented migration and configuration steps", () => {
    const plan = buildNpcMigrationPlan(request(), {
      animationFiles: [
        "D:/Anim/A_N28_Citizen_Male_C_Idle.fbx",
        "D:/Anim/A_N28_Citizen_Male_C_TurnL.fbx",
        "D:/Anim/Face/A_N28_Citizen_Male_C_Idle_Face.fbx",
      ],
      fileOperations: [operation()],
      targetDirectoryReady: true,
      animationDirectoryReady: true,
    });

    expect(plan).toMatchObject({
      npcName: "N28_Citizen_Male_C",
      targetPackagePath:
        "/Game/Seria/NPC/N28_Citizen_Male_C",
      animationPackagePath:
        "/Game/Seria/NPC/N28_Citizen_Male_C/Animation",
      blueprintName: "BP_N28_Citizen_Male_C",
      animationBlueprintName: "ABP_N28_Citizen_Male_C",
      montages: [
        { montageName: "AM_Idle1", slotName: "IdleSlot" },
        { montageName: "AM_TurnLeft90", slotName: "TurnSlot" },
      ],
      canMigrate: true,
      canConfigure: true,
    });
    expect(plan.steps.map((step) => step.id)).toEqual([
      "source",
      "migration",
      "animations",
      "blueprint",
      "animation_blueprint",
      "look_blend_space",
      "montages",
      "face",
      "visual_review",
      "finalize",
    ]);
    expect(plan.steps.find((step) => step.id === "visual_review")?.mode).toBe(
      "assisted",
    );
    expect(plan.warnings.join("\n")).toContain("BP_FaceConfigHelper");
  });

  it("blocks two source actions that map to the same montage name", () => {
    const plan = buildNpcMigrationPlan(request(), {
      animationFiles: [
        "D:/Anim/A_N28_Citizen_Male_C_TurnL.fbx",
        "D:/Anim/A_N28_Citizen_Male_C_TurnLeft90.fbx",
      ],
      fileOperations: [operation()],
      targetDirectoryReady: true,
      animationDirectoryReady: true,
    });

    expect(plan.canConfigure).toBe(false);
    expect(plan.blockedReasons).toContain(
      "多个动作会生成同名 Montage：AM_TurnLeft90",
    );
  });

  it("derives BP and ABP names from the confirmed NPC name", () => {
    const plan = buildNpcMigrationPlan(request({ npcName: "N28_Guard_A" }), {
      animationFiles: ["D:/Anim/A_N28_Guard_A_Idle2.fbx"],
      fileOperations: [operation()],
      targetDirectoryReady: true,
      animationDirectoryReady: true,
    });

    expect(plan).toMatchObject({
      npcName: "N28_Guard_A",
      blueprintName: "BP_N28_Guard_A",
      animationBlueprintName: "ABP_N28_Guard_A",
      montages: [{ montageName: "AM_Idle2" }],
    });
  });

  it("requires all template replacement actions when standard ABP is enabled", () => {
    const plan = buildNpcMigrationPlan(
      request({
        npcName: "N28_Guard_A",
        configureStandardAbp: true,
        standardAbpTemplate: "female",
      }),
      {
        animationFiles: [
          "D:/Anim/A_N28_Guard_A_LookD.fbx",
          "D:/Anim/A_N28_Guard_A_LookF.fbx",
          "D:/Anim/A_N28_Guard_A_LookU.fbx",
          "D:/Anim/A_N28_Guard_A_Idlestand.fbx",
          "D:/Anim/A_N28_Guard_A_Impact.fbx",
        ],
        fileOperations: [operation()],
        targetDirectoryReady: true,
        animationDirectoryReady: true,
      },
    );

    expect(plan.configureStandardAbp).toBe(true);
    expect(plan.standardAbpTemplate).toBe("female");
    expect(plan.lookBlendSpaceName).toBe("BS_N28_Guard_A_Look");
    expect(plan.canConfigure).toBe(false);
    expect(plan.blockedReasons).toContain(
      "标准 ABP 缺少动作：interact",
    );
  });

  it("builds an animal plan from the E05 cat template contract", () => {
    const plan = buildNpcMigrationPlan(
      request({
        source: sourceScan({
          skeletalMeshName: "SK_E05_Cat01",
          skeletalMeshAssetPath:
            "/Game/Seria/BioSystems/E05_Cat/SK_E05_Cat01.SK_E05_Cat01",
          skeletalMeshPackageName:
            "/Game/Seria/BioSystems/E05_Cat/SK_E05_Cat01",
          skeletonAssetPath:
            "/Game/Seria/BioSystems/E05_Cat/SKEL_E05_Cat01.SKEL_E05_Cat01",
          suggestedNpcName: "E05_Cat01",
          suggestedTargetPackagePath:
            "/Game/Seria/BioSystems/E05_Cat",
        }),
        configureStandardAbp: true,
        standardAbpTemplate: "animal",
      }),
      {
        animationFiles: [
          "D:/Anim/A_E05_Cat_Idlestand.fbx",
          "D:/Anim/A_E05_Cat_Walk.fbx",
          "D:/Anim/A_E05_Cat_sleep.fbx",
        ],
        fileOperations: [operation()],
        targetDirectoryReady: true,
        animationDirectoryReady: true,
      },
    );

    expect(plan).toMatchObject({
      npcName: "E05_Cat01",
      animationName: "E05_Cat",
      animationPrefix: "A_E05_Cat_",
      targetPackagePath: "/Game/Seria/BioSystems/E05_Cat",
      blueprintPackagePath: "/Game/Seria/NPC/E05_Cat",
      animationPackagePath:
        "/Game/Seria/BioSystems/E05_Cat/Animation",
      animationBlueprintPackagePath: "/Game/Seria/NPC/E05_Cat",
      montagePackagePath: "/Game/Seria/NPC/E05_Cat/Animation",
      blueprintName: "BP_E05_CAT01_NPC",
      animationBlueprintName: "ABP_E05_CAT01_NPC",
      standardAbpTemplate: "animal",
      bodyAnimationFiles: [],
      montages: [],
      canConfigure: true,
    });
    expect(plan.blockedReasons).toEqual([]);
    expect(plan.warnings.join("\n")).toContain("R40 / H40");
    expect(plan.warnings.join("\n")).toContain(
      "SKEL_E05_Cat01.SKEL_E05_Cat01",
    );
    expect(plan.warnings.join("\n")).toContain("绑定所选 Mesh 自带的 Skeleton");
  });

  it("reuses identical target files without blocking migration", () => {
    const plan = buildNpcMigrationPlan(
      request(),
      {
        animationFiles: [
          "D:/Anim/A_N28_Citizen_Male_C_Idle.fbx",
        ],
        fileOperations: [operation("unchanged")],
        targetDirectoryReady: true,
        animationDirectoryReady: true,
      },
    );

    expect(plan.canMigrate).toBe(true);
    expect(plan.blockedReasons).toEqual([]);
    expect(plan.warnings.join("\n")).toContain(
      "已有 1 个内容一致的文件，将直接复用",
    );
    expect(plan.steps.find((step) => step.id === "migration")).toMatchObject({
      state: "ready",
      detail: "复制 0 个，复用 1 个",
    });
  });

  it("blocks dirty source packages, target conflicts and missing body FBX", () => {
    const plan = buildNpcMigrationPlan(
      request({
        source: sourceScan({
          dirtyPackageNames: [
            "/Game/Seria/NPC/N28_Citizen_Male_C/SK_N28_Citizen_Male_C",
          ],
        }),
      }),
      {
        animationFiles: [],
        fileOperations: [operation("conflict")],
        targetDirectoryReady: true,
        animationDirectoryReady: true,
      },
    );

    expect(plan.canMigrate).toBe(false);
    expect(plan.canConfigure).toBe(false);
    expect(plan.blockedReasons.join("\n")).toContain("尚未保存");
    expect(plan.blockedReasons.join("\n")).toContain(
      "同路径文件与源文件不同",
    );
    expect(plan.blockedReasons.join("\n")).toContain("Body FBX");
  });
});
