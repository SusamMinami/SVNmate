import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { NpcSupplementTarget } from "../src/types";
import {
  applyNpcSupplement,
  inspectNpcSupplementPlan,
  scanNpcSupplementTarget,
} from "./npcSupplement";
import type { UnrealInvoker } from "./ue/transport";

const temporaryDirectories: string[] = [];

class FakeSupplementConnection implements UnrealInvoker {
  readonly calls: Array<{
    action: string;
    args: Record<string, unknown>;
  }> = [];
  closed = false;
  private responseIndex = 0;
  private readonly payloads: Record<string, unknown>[];

  constructor(
    payload: Record<string, unknown> | Record<string, unknown>[],
  ) {
    this.payloads = Array.isArray(payload) ? payload : [payload];
  }

  async connect(): Promise<void> {}

  async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ action, args });
    if (action === "script.eval_python_expression") {
      const payload =
        this.payloads[
          Math.min(this.responseIndex, this.payloads.length - 1)
        ] ?? {};
      this.responseIndex += 1;
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
  const directory = await mkdtemp(join(tmpdir(), "npc-supplement-"));
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

function target(
  targetContentDirectory: string,
  overrides: Partial<NpcSupplementTarget> = {},
): NpcSupplementTarget {
  return {
    targetProjectFile: join(
      targetContentDirectory,
      "..",
      "res.uproject",
    ),
    targetContentDirectory,
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
      "/Game/Seria/NPC/N28/Animation/A_N28_Talk.A_N28_Talk",
    ],
    dirtyPackageNames: [],
    warnings: [],
    ...overrides,
  };
}

describe("NPC supplement server workflow", () => {
  it("reads an existing NPC Blueprint and resolves both skeletons", async () => {
    const connection = new FakeSupplementConnection({
      target_project_file: "D:/Seria/res/res.uproject",
      target_content_directory: "D:/Seria/res/Content",
      selected_asset_path: "/Game/Seria/NPC/N28/BP_N28.BP_N28",
      selected_asset_name: "BP_N28",
      selected_asset_type: "Blueprint",
      npc_name: "N28",
      skeletal_mesh_asset_path:
        "/Game/Seria/NPC/N28/SK_N28.SK_N28",
      skeleton_asset_path:
        "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
      face_skeletal_mesh_asset_path:
        "/Game/Seria/NPC/N28/SK_N28_Face.SK_N28_Face",
      face_skeleton_asset_path:
        "/Game/Seria/NPC/N28/SKEL_N28_Face.SKEL_N28_Face",
      target_package_path: "/Game/Seria/NPC/N28",
      animation_package_path: "/Game/Seria/NPC/N28/Animation",
      existing_asset_paths: [],
      dirty_package_names: [],
      face_candidate_count: 1,
    });

    await expect(
      scanNpcSupplementTarget(() => connection),
    ).resolves.toMatchObject({
      npcName: "N28",
      selectedAssetType: "Blueprint",
      faceSkeletonAssetPath:
        "/Game/Seria/NPC/N28/SKEL_N28_Face.SKEL_N28_Face",
    });
    expect(String(connection.calls[0].args.Expression)).toContain(
      "get_selected_assets",
    );
    expect(String(connection.calls[0].args.Expression)).toContain(
      "load_blueprint_class",
    );
    expect(String(connection.calls[0].args.Expression)).not.toContain(
      "selected.generated_class()",
    );
    expect(String(connection.calls[0].args.Expression)).toContain(
      "body_meshes_for_skeleton",
    );
    expect(connection.closed).toBe(true);
  });

  it("accepts a Skeleton as the selected supplement target", async () => {
    const connection = new FakeSupplementConnection({
      target_project_file: "D:/Seria/res/res.uproject",
      target_content_directory: "D:/Seria/res/Content",
      selected_asset_path:
        "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
      selected_asset_name: "SKEL_N28",
      selected_asset_type: "Skeleton",
      npc_name: "N28",
      skeletal_mesh_asset_path:
        "/Game/Seria/NPC/N28/SK_N28.SK_N28",
      skeleton_asset_path:
        "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
      face_skeletal_mesh_asset_path: "",
      face_skeleton_asset_path: "",
      target_package_path: "/Game/Seria/NPC/N28",
      animation_package_path: "/Game/Seria/NPC/N28/Animation",
      existing_asset_paths: [],
      dirty_package_names: [],
      face_candidate_count: 0,
    });

    await expect(
      scanNpcSupplementTarget(() => connection),
    ).resolves.toMatchObject({
      selectedAssetName: "SKEL_N28",
      selectedAssetType: "Skeleton",
      skeletalMeshAssetPath:
        "/Game/Seria/NPC/N28/SK_N28.SK_N28",
    });
    expect(connection.closed).toBe(true);
  });

  it("runs the native per-item face automation script", async () => {
    const root = await temporaryDirectory();
    const contentDirectory = join(root, "res", "Content");
    const sourceDirectory = join(root, "Animation", "Face");
    await mkdir(contentDirectory, { recursive: true });
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(
      join(sourceDirectory, "A_N28_Talk_Face.fbx"),
      "face animation",
    );
    const plan = await inspectNpcSupplementPlan({
      kind: "face",
      target: target(contentDirectory),
      sourceDirectory,
    });
    expect(plan.items[0].sourceModifiedTimeMs).toBeGreaterThan(0);
    const connection = new FakeSupplementConnection({
      imported_asset_paths: [
        "/Game/Seria/NPC/N28/Animation/Face/A_N28_Talk_Face.A_N28_Talk_Face",
      ],
      created_montage_asset_paths: [
        "/Game/Seria/NPC/N28/Animation/AM_Talk.AM_Talk",
      ],
      reused_montage_asset_paths: [],
      locked_root_asset_paths: [
        "/Game/Seria/NPC/N28/Animation/Face/A_N28_Talk_Face.A_N28_Talk_Face",
      ],
      curve_copied_body_asset_paths: [
        "/Game/Seria/NPC/N28/Animation/A_N28_Talk.A_N28_Talk",
      ],
      processed_body_asset_paths: [
        "/Game/Seria/NPC/N28/Animation/A_N28_Talk.A_N28_Talk",
      ],
    });

    const result = await applyNpcSupplement(
      { plan, reviewToken: plan.reviewToken },
      () => connection,
    );

    expect(result).toMatchObject({
      kind: "face",
      curveCopiedBodyAssetPaths: [
        "/Game/Seria/NPC/N28/Animation/A_N28_Talk.A_N28_Talk",
      ],
    });
    const expression = String(connection.calls[0].args.Expression);
    expect(expression).toContain("force_root_lock");
    expect(expression).toContain(
      "copy_face_anim_sequence_morph_targets_curve",
    );
    expect(expression).toContain("make_npc_montage_by_anim_sequence");
    expect(expression).toContain("_set_new_montage_slot");
    expect(expression).toMatch(/montage_slot_name.{0,10}IdleSlot/);
    expect(expression).toContain("_restore_reviewed_montage_slots");
    expect(expression).not.toContain("open_editor_for_assets");
    expect(expression).not.toContain(
      "/Game/Seria/Editor/BP_FaceConfigHelper",
    );
    expect(connection.closed).toBe(true);
  });

  it("imports an exact _Face pair after its Body action", async () => {
    const root = await temporaryDirectory();
    const contentDirectory = join(root, "res", "Content");
    const sourceDirectory = join(root, "Animation");
    const faceDirectory = join(sourceDirectory, "Face");
    await mkdir(contentDirectory, { recursive: true });
    await mkdir(faceDirectory, { recursive: true });
    await writeFile(
      join(sourceDirectory, "A_N28_Wave.fbx"),
      "body animation",
    );
    await writeFile(
      join(faceDirectory, "A_N28_Wave_Face.fbx"),
      "face animation",
    );
    const plan = await inspectNpcSupplementPlan({
      kind: "actions",
      target: target(contentDirectory),
      sourceDirectory,
    });
    expect(plan.items[0].pairedFace).toMatchObject({
      sourceAssetName: "A_N28_Wave_Face",
      state: "new",
    });
    const connection = new FakeSupplementConnection([
      {
        imported_asset_paths: [
          "/Game/Seria/NPC/N28/Animation/A_N28_Wave.A_N28_Wave",
        ],
        created_montage_asset_paths: [
          "/Game/Seria/NPC/N28/Animation/AM_Wave.AM_Wave",
        ],
        locked_root_asset_paths: [],
      },
      {
        imported_asset_paths: [
          "/Game/Seria/NPC/N28/Animation/Face/A_N28_Wave_Face.A_N28_Wave_Face",
        ],
        created_montage_asset_paths: [],
        reused_montage_asset_paths: [],
        locked_root_asset_paths: [
          "/Game/Seria/NPC/N28/Animation/Face/A_N28_Wave_Face.A_N28_Wave_Face",
        ],
        curve_copied_body_asset_paths: [
          "/Game/Seria/NPC/N28/Animation/A_N28_Wave.A_N28_Wave",
        ],
        processed_body_asset_paths: [
          "/Game/Seria/NPC/N28/Animation/A_N28_Wave.A_N28_Wave",
        ],
      },
    ]);

    const result = await applyNpcSupplement(
      { plan, reviewToken: plan.reviewToken },
      () => connection,
    );

    expect(result).toMatchObject({
      kind: "actions",
      importedAssetPaths: [
        "/Game/Seria/NPC/N28/Animation/A_N28_Wave.A_N28_Wave",
        "/Game/Seria/NPC/N28/Animation/Face/A_N28_Wave_Face.A_N28_Wave_Face",
      ],
      lockedRootAssetPaths: [
        "/Game/Seria/NPC/N28/Animation/Face/A_N28_Wave_Face.A_N28_Wave_Face",
      ],
      createdMontageAssetPaths: [
        "/Game/Seria/NPC/N28/Animation/AM_Wave.AM_Wave",
      ],
    });
    expect(connection.calls).toHaveLength(2);
    expect(String(connection.calls[1].args.Expression)).toContain(
      "FACE_SUPPLEMENT_REQUEST",
    );
    expect(String(connection.calls[1].args.Expression)).toMatch(
      /make_montage.{0,10}false/,
    );
    expect(String(connection.calls[0].args.Expression)).toMatch(
      /montage_slot_name.{0,10}IdleSlot/,
    );
    expect(String(connection.calls[0].args.Expression)).toContain(
      "make_npc_montage_by_anim_sequence",
    );
    expect(String(connection.calls[0].args.Expression)).toContain(
      "Montage 插槽回读不一致",
    );
    expect(connection.closed).toBe(true);
  });

  it("rejects a changed supplement plan before connecting to UE", async () => {
    const root = await temporaryDirectory();
    const contentDirectory = join(root, "res", "Content");
    const sourceDirectory = join(root, "Animation");
    await mkdir(contentDirectory, { recursive: true });
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(
      join(sourceDirectory, "A_N28_Wave.fbx"),
      "body animation",
    );
    const plan = await inspectNpcSupplementPlan({
      kind: "actions",
      target: target(contentDirectory),
      sourceDirectory,
    });
    plan.items[0].included = false;
    const connection = new FakeSupplementConnection({});

    await expect(
      applyNpcSupplement(
        { plan, reviewToken: plan.reviewToken },
        () => connection,
      ),
    ).rejects.toThrow("增补清单已变化");
    expect(connection.calls).toHaveLength(0);
  });

  it("removes the Python traceback from execution errors", async () => {
    const root = await temporaryDirectory();
    const contentDirectory = join(root, "res", "Content");
    const sourceDirectory = join(root, "Animation");
    await mkdir(contentDirectory, { recursive: true });
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(
      join(sourceDirectory, "A_N28_Wave.fbx"),
      "body animation",
    );
    const plan = await inspectNpcSupplementPlan({
      kind: "actions",
      target: target(contentDirectory),
      sourceDirectory,
    });
    const connection: UnrealInvoker = {
      connect: async () => undefined,
      invoke: async () => {
        throw new Error(
          'Traceback (most recent call last):\n  File "<string>", line 41\nRuntimeError: Seria 原生 Montage 创建失败',
        );
      },
      close: () => undefined,
    };

    await expect(
      applyNpcSupplement(
        { plan, reviewToken: plan.reviewToken },
        () => connection,
      ),
    ).rejects.toThrow(/^Seria 原生 Montage 创建失败$/);
  });
});
