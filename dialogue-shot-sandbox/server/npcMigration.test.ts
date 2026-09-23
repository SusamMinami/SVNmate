import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type {
  NpcMigrationPlan,
  NpcMigrationSourceScan,
} from "../src/types";
import {
  applyNpcAssetMigration,
  configureNpcMigrationTarget,
  inspectNpcMigrationPlan,
  inspectNpcMigrationTarget,
  scanNpcMigrationSource,
} from "./npcMigration";
import type { UnrealInvoker } from "./ue/transport";

const temporaryDirectories: string[] = [];

class FakeNpcMigrationConnection implements UnrealInvoker {
  readonly calls: Array<{
    action: string;
    args: Record<string, unknown>;
  }> = [];
  closed = false;
  private scriptIndex = 0;
  private readonly scriptPayloads: Record<string, unknown>[];

  constructor(
    scriptPayload:
      | Record<string, unknown>
      | Record<string, unknown>[],
    private readonly assetSearchResult: unknown = [],
  ) {
    this.scriptPayloads = Array.isArray(scriptPayload)
      ? scriptPayload
      : [scriptPayload];
  }

  async connect(): Promise<void> {}

  async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ action, args });
    if (action === "asset.asset_search") {
      return this.assetSearchResult;
    }
    if (action === "script.eval_python_expression") {
      const payload =
        this.scriptPayloads[
          Math.min(this.scriptIndex, this.scriptPayloads.length - 1)
        ];
      this.scriptIndex += 1;
      return {
        bSuccess: true,
        Result: `'${JSON.stringify(payload)}'`,
      };
    }
    return true;
  }

  close(): void {
    this.closed = true;
  }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "npc-migration-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("NPC migration server workflow", () => {
  it("reads a selected Skeletal Mesh and its dependency files from UE", async () => {
    const connection = new FakeNpcMigrationConnection({
      source_project_file: "D:/Seria/Art/Art.uproject",
      source_content_directory: "D:/Seria/Art/Content",
      skeletal_mesh_name: "SK_N28_Citizen_Male_C",
      skeletal_mesh_asset_path:
        "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C.SK_N28_Citizen_Male_C",
      skeletal_mesh_package_name:
        "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C",
      skeleton_asset_path:
        "/Game/Seria/NPC/N28/SKEL_N28_Citizen_Male_C.SKEL_N28_Citizen_Male_C",
      physics_asset_path:
        "/Game/Seria/NPC/N28/PHYS_N28_Citizen_Male_C.PHYS_N28_Citizen_Male_C",
      material_asset_paths: [],
      dependency_package_names: [
        "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C",
      ],
      source_files: [
        {
          package_name:
            "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C",
          source_path:
            "D:/Seria/Art/Content/Seria/NPC/N28/SK_N28_Citizen_Male_C.uasset",
          relative_path:
            "Seria/NPC/N28/SK_N28_Citizen_Male_C.uasset",
          size: 42,
        },
      ],
      dirty_package_names: [],
    });

    await expect(
      scanNpcMigrationSource(() => connection),
    ).resolves.toMatchObject({
      suggestedNpcName: "N28_Citizen_Male_C",
      suggestedTargetPackagePath: "/Game/Seria/NPC/N28",
      sourceFiles: [{ size: 42 }],
    });
    expect(
      String(connection.calls[0].args.Expression),
    ).toContain("get_selected_assets");
    expect(connection.closed).toBe(true);
  });

  it("uses the NPC package root when the selected mesh is inside a body folder", async () => {
    const connection = new FakeNpcMigrationConnection({
      source_project_file: "D:/Seria/Art/Art.uproject",
      source_content_directory: "D:/Seria/Art/Content",
      skeletal_mesh_name: "SK_N132_Nobledog",
      skeletal_mesh_asset_path:
        "/Game/Seria/BioSystems/N132_Nobledog/body/SK_N132_Nobledog.SK_N132_Nobledog",
      skeletal_mesh_package_name:
        "/Game/Seria/BioSystems/N132_Nobledog/body/SK_N132_Nobledog",
      skeleton_asset_path:
        "/Game/Seria/BioSystems/N132_Nobledog/body/SKEL_N132_Nobledog.SKEL_N132_Nobledog",
      physics_asset_path: "",
      material_asset_paths: [],
      dependency_package_names: [
        "/Game/Seria/BioSystems/N132_Nobledog/body/SK_N132_Nobledog",
      ],
      source_files: [
        {
          package_name:
            "/Game/Seria/BioSystems/N132_Nobledog/body/SK_N132_Nobledog",
          source_path:
            "D:/Seria/Art/Content/Seria/BioSystems/N132_Nobledog/body/SK_N132_Nobledog.uasset",
          relative_path:
            "Seria/BioSystems/N132_Nobledog/body/SK_N132_Nobledog.uasset",
          size: 42,
        },
      ],
      dirty_package_names: [],
    });

    await expect(
      scanNpcMigrationSource(() => connection),
    ).resolves.toMatchObject({
      suggestedNpcName: "N132_Nobledog",
      suggestedTargetPackagePath:
        "/Game/Seria/BioSystems/N132_Nobledog",
    });
  });

  it("plans and copies assets without overwriting target files", async () => {
    const root = await temporaryDirectory();
    const sourceContent = join(root, "Art", "Content");
    const targetContent = join(root, "res", "Content");
    const animationDirectory = join(root, "FBX", "Animation");
    const relativeAsset = join(
      "Seria",
      "NPC",
      "N28",
      "SK_N28_Citizen_Male_C.uasset",
    );
    const sourceAsset = join(sourceContent, relativeAsset);
    await mkdir(join(sourceContent, "Seria", "NPC", "N28"), {
      recursive: true,
    });
    await mkdir(targetContent, { recursive: true });
    await mkdir(animationDirectory, { recursive: true });
    await writeFile(sourceAsset, "skeletal mesh");
    await writeFile(
      join(animationDirectory, "A_N28_Citizen_Male_C_Idle.fbx"),
      "fbx",
    );
    const source: NpcMigrationSourceScan = {
      sourceProjectFile: join(root, "Art", "Art.uproject"),
      sourceContentDirectory: sourceContent,
      skeletalMeshName: "SK_N28_Citizen_Male_C",
      skeletalMeshAssetPath:
        "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C.SK_N28_Citizen_Male_C",
      skeletalMeshPackageName:
        "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C",
      skeletonAssetPath:
        "/Game/Seria/NPC/N28/SKEL_N28_Citizen_Male_C.SKEL_N28_Citizen_Male_C",
      physicsAssetPath: "",
      materialAssetPaths: [],
      dependencyPackageNames: [
        "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C",
      ],
      sourceFiles: [
        {
          packageName:
            "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C",
          sourcePath: sourceAsset,
          relativePath: relativeAsset,
          size: 13,
        },
      ],
      dirtyPackageNames: [],
      suggestedNpcName: "N28_Citizen_Male_C",
      suggestedTargetPackagePath: "/Game/Seria/NPC/N28",
      warnings: [],
    };

    const planRequest = {
      source,
      targetContentDirectory: targetContent,
      animationSourceDirectory: animationDirectory,
    };
    const plan = await inspectNpcMigrationPlan(planRequest);
    expect(plan.canMigrate).toBe(true);
    expect(plan.reviewToken).toMatch(/^[a-f0-9]{64}$/);

    const result = await applyNpcAssetMigration({
      plan,
      reviewToken: plan.reviewToken,
    });
    expect(result.copiedFiles).toHaveLength(1);
    await expect(
      readFile(join(targetContent, relativeAsset), "utf8"),
    ).resolves.toBe("skeletal mesh");
    await expect(
      applyNpcAssetMigration({
        plan,
        reviewToken: plan.reviewToken,
      }),
    ).rejects.toThrow("目标文件已存在");

    const resumedPlan = await inspectNpcMigrationPlan(planRequest);
    expect(resumedPlan.canMigrate).toBe(true);
    expect(resumedPlan.fileOperations).toEqual([
      expect.objectContaining({ state: "unchanged" }),
    ]);
    await expect(
      applyNpcAssetMigration({
        plan: resumedPlan,
        reviewToken: resumedPlan.reviewToken,
      }),
    ).resolves.toMatchObject({
      copiedFiles: [],
      reusedFiles: [join(targetContent, relativeAsset)],
      copiedBytes: 0,
    });

    await writeFile(join(targetContent, relativeAsset), "different one");
    const conflictPlan = await inspectNpcMigrationPlan(planRequest);
    expect(conflictPlan.canMigrate).toBe(false);
    expect(conflictPlan.fileOperations).toEqual([
      expect.objectContaining({ state: "conflict" }),
    ]);
    expect(conflictPlan.blockedReasons.join("\n")).toContain(
      "同路径文件与源文件不同",
    );
  });

  it("rejects a stale review token before copying", async () => {
    const plan = {
      reviewToken: "a".repeat(64),
      canMigrate: true,
      source: { sourceFiles: [] },
    } as unknown as NpcMigrationPlan;

    await expect(
      applyNpcAssetMigration({
        plan,
        reviewToken: "a".repeat(64),
      }),
    ).rejects.toThrow("迁移计划已变化");
  });

  it("distinguishes the Art UE from another incorrect target project", async () => {
    const plan = {
      reviewToken: "",
      targetContentDirectory: "D:/Seria/res/Content",
      targetPackagePath: "/Game/Seria/NPC/N28",
      animationPackagePath: "/Game/Seria/NPC/N28/Animation",
      blueprintName: "BP_N28",
      animationBlueprintName: "ABP_N28",
      source: {
        skeletalMeshAssetPath: "/Game/Seria/NPC/N28/SK_N28.SK_N28",
        skeletonAssetPath: "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
      },
    } as NpcMigrationPlan;
    const inspectedPlan = await inspectNpcMigrationPlan({
      source: {
        sourceProjectFile: "D:/Seria/Art/Art.uproject",
        sourceContentDirectory: "D:/Seria/Art/Content",
        skeletalMeshName: "SK_N28",
        skeletalMeshAssetPath: plan.source.skeletalMeshAssetPath,
        skeletalMeshPackageName: "/Game/Seria/NPC/N28/SK_N28",
        skeletonAssetPath: plan.source.skeletonAssetPath,
        physicsAssetPath: "",
        materialAssetPaths: [],
        dependencyPackageNames: ["/Game/Seria/NPC/N28/SK_N28"],
        sourceFiles: [],
        dirtyPackageNames: [],
        suggestedNpcName: "N28",
        suggestedTargetPackagePath: "/Game/Seria/NPC/N28",
        warnings: [],
      },
      targetContentDirectory: "D:/missing/Content",
      animationSourceDirectory: "D:/missing/Animation",
    });
    const artConnection = new FakeNpcMigrationConnection({
      target_project_file: "D:/Seria/Art/Art.uproject",
      target_content_directory: "D:/Seria/Art/Content",
      skeletal_mesh_found: true,
      skeleton_found: true,
      skeletal_mesh_skeleton_asset_path:
        "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
      npc_base_class_found: true,
      animation_blueprint_parent_class_found: true,
      existing_asset_paths: [],
    });
    const otherConnection = new FakeNpcMigrationConnection({
      target_project_file: "E:/Other/Other.uproject",
      target_content_directory: "E:/Other/Content",
      skeletal_mesh_found: true,
      skeleton_found: true,
      skeletal_mesh_skeleton_asset_path:
        "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
      npc_base_class_found: true,
      animation_blueprint_parent_class_found: true,
      existing_asset_paths: [],
    });

    const artResult = await inspectNpcMigrationTarget(
      {
        plan: inspectedPlan,
        reviewToken: inspectedPlan.reviewToken,
        npcBaseClassPath: "/Game/Seria/BP_NPCBase.BP_NPCBase_C",
        animationBlueprintParentClassPath:
          "/Script/Seria.SeriaNPCAnimInstance",
      },
      () => artConnection,
    );
    const otherResult = await inspectNpcMigrationTarget(
      {
        plan: inspectedPlan,
        reviewToken: inspectedPlan.reviewToken,
        npcBaseClassPath: "/Game/Seria/BP_NPCBase.BP_NPCBase_C",
        animationBlueprintParentClassPath:
          "/Script/Seria.SeriaNPCAnimInstance",
      },
      () => otherConnection,
    );

    expect(artResult.blockedReasons).toContain(
      "当前连接的是美术 Art UE；请关闭 Art UE，打开目标 Res UE 并启动 OmniMcpCore，然后重新校验资产",
    );
    expect(otherResult.blockedReasons).toContain(
      "当前连接的 UE 与目标 Res 工程不一致；请打开迁移计划对应的 Res UE 并启动 OmniMcpCore，然后重新校验资产",
    );
    expect(artConnection.closed).toBe(true);
    expect(otherConnection.closed).toBe(true);
  });

  it.each([
    {
      template: "male" as const,
      templateNpcName: "N16_Villager_Male_A",
      templateRoot: "/Game/Seria/NPC/N16",
    },
    {
      template: "female" as const,
      templateNpcName: "N18_Villager_Female_A",
      templateRoot: "/Game/Seria/NPC/N18",
    },
  ])("configures the $template standard NPC pipeline with readback checks", async ({
    template,
    templateNpcName,
    templateRoot,
  }) => {
    const root = await temporaryDirectory();
    const sourceContent = join(root, "Art", "Content");
    const targetContent = join(root, "res", "Content");
    const animationDirectory = join(root, "FBX", "Animation");
    const templateAbpName = `ABP_${templateNpcName}`;
    const templateAnimationBlueprintAssetPath =
      `${templateRoot}/${templateAbpName}.${templateAbpName}`;
    const templateLookBlendSpaceAssetPath =
      `${templateRoot}/BS_${templateNpcName}_Look.BS_${templateNpcName}_Look`;
    const templateIdleStandAssetPath =
      `${templateRoot}/A_${templateNpcName}_Idlestand.A_${templateNpcName}_Idlestand`;
    const templateImpactAssetPath =
      `${templateRoot}/A_${templateNpcName}_Impact.A_${templateNpcName}_Impact`;
    const templateInteractAssetPath =
      `${templateRoot}/A_${templateNpcName}_Interact.A_${templateNpcName}_Interact`;
    const relativeAsset = join("Seria", "NPC", "N28", "SK_N28.uasset");
    const sourceAsset = join(sourceContent, relativeAsset);
    await mkdir(join(sourceContent, "Seria", "NPC", "N28"), {
      recursive: true,
    });
    await mkdir(targetContent, { recursive: true });
    await mkdir(animationDirectory, { recursive: true });
    await writeFile(sourceAsset, "mesh");
    await writeFile(
      join(animationDirectory, "A_N28_Idle.fbx"),
      "animation",
    );
    for (const action of [
      "LookD",
      "LookF",
      "LookU",
      "Idlestand",
      "Impact",
      "Interact",
    ]) {
      await writeFile(
        join(animationDirectory, `A_N28_${action}.fbx`),
        "animation",
      );
    }
    const plan = await inspectNpcMigrationPlan({
      source: {
        sourceProjectFile: join(root, "Art", "Art.uproject"),
        sourceContentDirectory: sourceContent,
        skeletalMeshName: "SK_N28",
        skeletalMeshAssetPath: "/Game/Seria/NPC/N28/SK_N28.SK_N28",
        skeletalMeshPackageName: "/Game/Seria/NPC/N28/SK_N28",
        skeletonAssetPath: "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
        physicsAssetPath: "",
        materialAssetPaths: [],
        dependencyPackageNames: ["/Game/Seria/NPC/N28/SK_N28"],
        sourceFiles: [
          {
            packageName: "/Game/Seria/NPC/N28/SK_N28",
            sourcePath: sourceAsset,
            relativePath: relativeAsset,
            size: 4,
          },
        ],
        dirtyPackageNames: [],
        suggestedNpcName: "N28",
        suggestedTargetPackagePath: "/Game/Seria/NPC/N28",
        warnings: [],
      },
      targetContentDirectory: targetContent,
      animationSourceDirectory: animationDirectory,
      npcName: "N28",
      configureStandardAbp: true,
      standardAbpTemplate: template,
    });
    expect(plan).toMatchObject({
      standardAbpTemplate: template,
      canConfigure: true,
      animationRoleAssets: {
        lookDown: "A_N28_LookD",
        lookForward: "A_N28_LookF",
        lookUp: "A_N28_LookU",
        idleStand: "A_N28_Idlestand",
        impact: "A_N28_Impact",
        interact: "A_N28_Interact",
      },
    });
    expect(
      plan.steps.find((step) => step.id === "animation_blueprint")?.detail,
    ).toContain(templateAbpName);
    const estimate = {
      radius: 42,
      half_height: 91,
      mesh_offset_z: -89,
      bounds_origin: [0, 0, 89],
      bounds_extent: [40, 20, 89],
    };
    const connection = new FakeNpcMigrationConnection([
      {
        target_project_file: join(root, "res", "res.uproject"),
        target_content_directory: targetContent,
        skeletal_mesh_found: true,
        skeleton_found: true,
        skeletal_mesh_skeleton_asset_path:
          "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
        npc_base_class_found: true,
        animation_blueprint_parent_class_found: true,
        capsule_estimate: estimate,
        turn_curve_found: true,
        turn_curve_property_path: "turn.turn_curve",
        turn_curve_property_candidates: ["turn.turn_curve"],
        montage_automation_available: true,
        template_animation_blueprint_asset_path:
          templateAnimationBlueprintAssetPath,
        template_animation_assets: {
          look_blend_space:
            templateLookBlendSpaceAssetPath,
          idle_stand:
            templateIdleStandAssetPath,
          impact:
            templateImpactAssetPath,
          interact:
            templateInteractAssetPath,
        },
        standard_abp_automation_available: true,
        look_blend_space_automation_available: true,
        existing_asset_paths: [],
      },
      {
        imported: [
          "/Game/Seria/NPC/N28/Animation/A_N28_Idle",
          "/Game/Seria/NPC/N28/Animation/A_N28_Idlestand",
          "/Game/Seria/NPC/N28/Animation/A_N28_Impact",
          "/Game/Seria/NPC/N28/Animation/A_N28_Interact",
          "/Game/Seria/NPC/N28/Animation/A_N28_LookD",
          "/Game/Seria/NPC/N28/Animation/A_N28_LookF",
          "/Game/Seria/NPC/N28/Animation/A_N28_LookU",
        ],
        blueprint_asset_path: "/Game/Seria/NPC/N28/BP_N28.BP_N28",
        animation_blueprint_asset_path:
          "/Game/Seria/NPC/N28/Animation/ABP_N28.ABP_N28",
        capsule_estimate: estimate,
        turn_curve_property_path: "turn.turn_curve",
        template_animation_blueprint_asset_path:
          templateAnimationBlueprintAssetPath,
        look_blend_space_asset_path:
          "/Game/Seria/NPC/N28/Animation/BS_N28_Look.BS_N28_Look",
        animation_blueprint_override_asset_paths: [
          "/Game/Seria/NPC/N28/Animation/BS_N28_Look.BS_N28_Look",
          "/Game/Seria/NPC/N28/Animation/A_N28_Idlestand.A_N28_Idlestand",
          "/Game/Seria/NPC/N28/Animation/A_N28_Impact.A_N28_Impact",
          "/Game/Seria/NPC/N28/Animation/A_N28_Interact.A_N28_Interact",
        ],
        created_montages: [
          {
            asset_path:
              "/Game/Seria/NPC/N28/Animation/AM_Idle1.AM_Idle1",
            slot_name: "IdleSlot",
            source_asset_name: "A_N28_Idle",
          },
          {
            asset_path:
              "/Game/Seria/NPC/N28/Animation/AM_Impact.AM_Impact",
            slot_name: "IdleSlot",
            source_asset_name: "A_N28_Impact",
          },
          {
            asset_path:
              "/Game/Seria/NPC/N28/Animation/AM_Interact.AM_Interact",
            slot_name: "IdleSlot",
            source_asset_name: "A_N28_Interact",
          },
        ],
      },
    ], [
      `${templateAbpName} [${templateAnimationBlueprintAssetPath}]`,
    ]);

    const result = await configureNpcMigrationTarget(
      {
        plan,
        reviewToken: plan.reviewToken,
        npcBaseClassPath: "/Game/Seria/BP_NPCBase.BP_NPCBase_C",
        animationBlueprintParentClassPath:
          "/Script/Seria.SeriaNPCAnimInstance",
        turnCurveAssetPath:
          "/Game/Seria/NPC/Animation/Npc_head_turn.Npc_head_turn",
      },
      () => connection,
    );

    expect(result).toMatchObject({
      capsuleEstimate: {
        radius: 42,
        halfHeight: 91,
        meshOffsetZ: -89,
      },
      turnCurvePropertyPath: "turn.turn_curve",
      createdMontageAssetPaths: [
        "/Game/Seria/NPC/N28/Animation/AM_Idle1.AM_Idle1",
        "/Game/Seria/NPC/N28/Animation/AM_Impact.AM_Impact",
        "/Game/Seria/NPC/N28/Animation/AM_Interact.AM_Interact",
      ],
      templateAnimationBlueprintAssetPath:
        templateAnimationBlueprintAssetPath,
      lookBlendSpaceAssetPath:
        "/Game/Seria/NPC/N28/Animation/BS_N28_Look.BS_N28_Look",
      animationBlueprintOverrideAssetPaths: [
        "/Game/Seria/NPC/N28/Animation/BS_N28_Look.BS_N28_Look",
        "/Game/Seria/NPC/N28/Animation/A_N28_Idlestand.A_N28_Idlestand",
        "/Game/Seria/NPC/N28/Animation/A_N28_Impact.A_N28_Impact",
        "/Game/Seria/NPC/N28/Animation/A_N28_Interact.A_N28_Interact",
      ],
    });
    const scripts = connection.calls
      .filter((call) => call.action === "script.eval_python_expression")
      .map((call) => String(call.args.Expression));
    expect(scripts[0]).toContain("get_imported_bounds");
    expect(scripts[1]).toContain("capsule_radius");
    expect(scripts[1]).toContain("assign_property_path");
    expect(scripts[1]).toContain("AnimMontageFactory");
    expect(scripts[1]).toContain(
      "make_npc_montage_by_anim_sequence",
    );
    expect(scripts[1]).toContain("IdleSlot");
    expect(scripts[1]).toContain("BlendSpaceFactory1D");
    expect(scripts[1]).toContain("duplicate_asset");
    expect(scripts[1]).toContain("ObjectIterator");
    expect(
      connection.calls
        .filter((call) => call.action === "bp.compile_blueprint")
        .every(
          (call) =>
            call.args.Bp === true &&
            !Object.prototype.hasOwnProperty.call(
              call.args,
              "BlueprintPath",
            ),
        ),
    ).toBe(true);
    expect(
      connection.calls
        .filter((call) => call.action === "asset.save_asset")
        .map((call) => call.args),
    ).toEqual([
      { Asset: true },
      { Asset: true },
    ]);
    expect(connection.closed).toBe(true);
  });

  it("duplicates the E05 animal templates with fixed paths and capsule values", async () => {
    const root = await temporaryDirectory();
    const sourceContent = join(root, "Art", "Content");
    const targetContent = join(root, "res", "Content");
    const animationDirectory = join(root, "FBX", "Animation");
    const relativeAsset = join(
      "Seria",
      "BioSystems",
      "E05_Cat",
      "SK_E05_Cat02.uasset",
    );
    const sourceAsset = join(sourceContent, relativeAsset);
    await mkdir(dirname(sourceAsset), { recursive: true });
    await mkdir(targetContent, { recursive: true });
    await mkdir(animationDirectory, { recursive: true });
    await writeFile(sourceAsset, "mesh");
    await writeFile(
      join(animationDirectory, "A_E05_Cat_Idlestand.fbx"),
      "animation",
    );
    await writeFile(
      join(animationDirectory, "A_E05_Cat_Walk.fbx"),
      "animation",
    );
    const plan = await inspectNpcMigrationPlan({
      source: {
        sourceProjectFile: join(root, "Art", "Art.uproject"),
        sourceContentDirectory: sourceContent,
        skeletalMeshName: "SK_E05_Cat02",
        skeletalMeshAssetPath:
          "/Game/Seria/BioSystems/E05_Cat/SK_E05_Cat02.SK_E05_Cat02",
        skeletalMeshPackageName:
          "/Game/Seria/BioSystems/E05_Cat/SK_E05_Cat02",
        skeletonAssetPath:
          "/Game/Seria/BioSystems/E05_Cat/SKEL_E05_Cat02.SKEL_E05_Cat02",
        physicsAssetPath:
          "/Game/Seria/BioSystems/E05_Cat/PHYS_E05_Cat.PHYS_E05_Cat",
        materialAssetPaths: [],
        dependencyPackageNames: [
          "/Game/Seria/BioSystems/E05_Cat/SK_E05_Cat02",
        ],
        sourceFiles: [
          {
            packageName:
              "/Game/Seria/BioSystems/E05_Cat/SK_E05_Cat02",
            sourcePath: sourceAsset,
            relativePath: relativeAsset,
            size: 4,
          },
        ],
        dirtyPackageNames: [],
        suggestedNpcName: "E05_Cat02",
        suggestedTargetPackagePath:
          "/Game/Seria/BioSystems/E05_Cat",
        warnings: [],
      },
      targetContentDirectory: targetContent,
      animationSourceDirectory: animationDirectory,
      configureStandardAbp: true,
      standardAbpTemplate: "animal",
    });
    const estimate = {
      radius: 40,
      half_height: 40,
      mesh_offset_z: -35,
      bounds_origin: [0, -4.4, 27.2],
      bounds_extent: [9.3, 42.4, 27.2],
    };
    const inspectionPayload = {
      target_project_file: join(root, "res", "res.uproject"),
      target_content_directory: targetContent,
      skeletal_mesh_found: true,
      skeleton_found: true,
      skeletal_mesh_skeleton_asset_path:
        "/Game/Seria/BioSystems/E05_Cat/SKEL_E05_Cat02.SKEL_E05_Cat02",
      npc_base_class_found: true,
      animation_blueprint_parent_class_found: true,
      capsule_estimate: estimate,
      turn_curve_found: true,
      turn_curve_property_path: "rotate_head_x_speed",
      turn_curve_property_candidates: ["rotate_head_x_speed"],
      montage_automation_available: true,
      template_blueprint_asset_path:
        "/Game/Seria/NPC/E05_Cat/BP_E05_CAT01_NPC.BP_E05_CAT01_NPC",
      template_animation_blueprint_asset_path:
        "/Game/Seria/NPC/E05_Cat/ABP_E05_CAT01_NPC.ABP_E05_CAT01_NPC",
      template_skeleton_asset_path:
        "/Game/Seria/BioSystems/E05_Cat/SKEL_E05_Cat.SKEL_E05_Cat",
      template_animation_assets: {
        look_blend_space: "",
        idle_stand:
          "/Game/Seria/BioSystems/E05_Cat/Animation/A_E05_Cat_Idlestand.A_E05_Cat_Idlestand",
        impact: "",
        interact: "",
        walk:
          "/Game/Seria/BioSystems/E05_Cat/Animation/A_E05_Cat_Walk.A_E05_Cat_Walk",
        sleep_montage:
          "/Game/Seria/NPC/E05_Cat/Animation/AM_Sleep.AM_Sleep",
      },
      standard_abp_automation_available: true,
      look_blend_space_automation_available: true,
      existing_asset_paths: [],
    };
    const connection = new FakeNpcMigrationConnection(
      [
        inspectionPayload,
        {
          imported: [
            "/Game/Seria/BioSystems/E05_Cat/Animation/A_E05_Cat_Idlestand",
            "/Game/Seria/BioSystems/E05_Cat/Animation/A_E05_Cat_Walk",
          ],
          blueprint_asset_path:
            "/Game/Seria/NPC/E05_Cat/BP_E05_CAT02_NPC.BP_E05_CAT02_NPC",
          animation_blueprint_asset_path:
            "/Game/Seria/NPC/E05_Cat/ABP_E05_CAT02_NPC.ABP_E05_CAT02_NPC",
          capsule_estimate: estimate,
          turn_curve_property_path: "rotate_head_x_speed",
          created_montages: [],
          template_blueprint_asset_path:
            inspectionPayload.template_blueprint_asset_path,
          template_animation_blueprint_asset_path:
            inspectionPayload.template_animation_blueprint_asset_path,
          look_blend_space_asset_path: "",
          animation_blueprint_override_asset_paths: [
            "/Game/Seria/BioSystems/E05_Cat/Animation/A_E05_Cat_Idlestand.A_E05_Cat_Idlestand",
            "/Game/Seria/BioSystems/E05_Cat/Animation/A_E05_Cat_Walk.A_E05_Cat_Walk",
          ],
        },
      ],
      [
        "BP_E05_CAT01_NPC [/Game/Seria/NPC/E05_Cat/BP_E05_CAT01_NPC.BP_E05_CAT01_NPC]",
        "ABP_E05_CAT01_NPC [/Game/Seria/NPC/E05_Cat/ABP_E05_CAT01_NPC.ABP_E05_CAT01_NPC]",
      ],
    );

    const result = await configureNpcMigrationTarget(
      {
        plan,
        reviewToken: plan.reviewToken,
        npcBaseClassPath: "BP_NPCBase",
        animationBlueprintParentClassPath: "SeriaNPCAnimInstance",
        turnCurveAssetPath:
          "/Game/Seria/NPC/Curves/Npc_head_turn.Npc_head_turn",
      },
      () => connection,
    );

    expect(result).toMatchObject({
      blueprintAssetPath:
        "/Game/Seria/NPC/E05_Cat/BP_E05_CAT02_NPC.BP_E05_CAT02_NPC",
      animationBlueprintAssetPath:
        "/Game/Seria/NPC/E05_Cat/ABP_E05_CAT02_NPC.ABP_E05_CAT02_NPC",
      capsuleEstimate: {
        radius: 40,
        halfHeight: 40,
        meshOffsetZ: -35,
      },
      templateBlueprintAssetPath:
        inspectionPayload.template_blueprint_asset_path,
      templateAnimationBlueprintAssetPath:
        inspectionPayload.template_animation_blueprint_asset_path,
      animationBlueprintOverrideAssetPaths: [
        "/Game/Seria/BioSystems/E05_Cat/Animation/A_E05_Cat_Idlestand.A_E05_Cat_Idlestand",
        "/Game/Seria/BioSystems/E05_Cat/Animation/A_E05_Cat_Walk.A_E05_Cat_Walk",
      ],
    });
    const scripts = connection.calls
      .filter((call) => call.action === "script.eval_python_expression")
      .map((call) => String(call.args.Expression));
    expect(scripts[0]).toContain("capsule_estimate(mesh, True)");
    expect(scripts[1]).toContain(
      "BP_E05_CAT01_NPC.BP_E05_CAT01_NPC",
    );
    expect(scripts[1]).toContain("animation_blueprint_root");
    expect(scripts[1]).toContain("capsule_estimate(mesh, True)");
    expect(scripts[1]).toContain(
      "SKEL_E05_Cat02.SKEL_E05_Cat02",
    );
  });
});
