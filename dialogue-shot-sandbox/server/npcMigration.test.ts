import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

    const plan = await inspectNpcMigrationPlan({
      source,
      targetContentDirectory: targetContent,
      animationSourceDirectory: animationDirectory,
    });
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

  it("blocks target configuration when the connected UE project differs", async () => {
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
    const connection = new FakeNpcMigrationConnection({
      target_project_file: "E:/Other/Other.uproject",
      target_content_directory: "E:/Other/Content",
      skeletal_mesh_found: true,
      skeleton_found: true,
      npc_base_class_found: true,
      animation_blueprint_parent_class_found: true,
      existing_asset_paths: [],
    });

    const result = await inspectNpcMigrationTarget(
      {
        plan: inspectedPlan,
        reviewToken: inspectedPlan.reviewToken,
        npcBaseClassPath: "/Game/Seria/BP_NPCBase.BP_NPCBase_C",
        animationBlueprintParentClassPath:
          "/Script/Seria.SeriaNPCAnimInstance",
      },
      () => connection,
    );

    expect(result.blockedReasons).toContain(
      "当前连接的 UE 不是迁移计划中的目标工程",
    );
    expect(connection.closed).toBe(true);
  });

  it("writes capsule, turn curve and planned montages with readback checks", async () => {
    const root = await temporaryDirectory();
    const sourceContent = join(root, "Art", "Content");
    const targetContent = join(root, "res", "Content");
    const animationDirectory = join(root, "FBX", "Animation");
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
      standardAbpTemplate: "female",
    });
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
        npc_base_class_found: true,
        animation_blueprint_parent_class_found: true,
        capsule_estimate: estimate,
        turn_curve_found: true,
        turn_curve_property_path: "turn.turn_curve",
        turn_curve_property_candidates: ["turn.turn_curve"],
        montage_automation_available: true,
        template_animation_blueprint_asset_path:
          "/Game/Seria/NPC/N18/ABP_N18_Villager_Female_A.ABP_N18_Villager_Female_A",
        template_animation_assets: {
          look_blend_space:
            "/Game/Seria/NPC/N18/BS_N18_Villager_Female_A_Look.BS_N18_Villager_Female_A_Look",
          idle_stand:
            "/Game/Seria/NPC/N18/A_N18_Villager_Female_A_Idlestand.A_N18_Villager_Female_A_Idlestand",
          impact:
            "/Game/Seria/NPC/N18/A_N18_Villager_Female_A_Impact.A_N18_Villager_Female_A_Impact",
          interact:
            "/Game/Seria/NPC/N18/A_N18_Villager_Female_A_Interact.A_N18_Villager_Female_A_Interact",
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
          "/Game/Seria/NPC/N18/ABP_N18_Villager_Female_A.ABP_N18_Villager_Female_A",
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
        ],
      },
    ], [
      "ABP_N18_Villager_Female_A [/Game/Seria/NPC/N18/ABP_N18_Villager_Female_A.ABP_N18_Villager_Female_A]",
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
      ],
      templateAnimationBlueprintAssetPath:
        "/Game/Seria/NPC/N18/ABP_N18_Villager_Female_A.ABP_N18_Villager_Female_A",
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
    expect(connection.closed).toBe(true);
  });
});
