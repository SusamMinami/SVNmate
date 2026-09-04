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

  constructor(private readonly payload: Record<string, unknown>) {}

  async connect(): Promise<void> {}

  async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ action, args });
    if (action === "script.eval_python_expression") {
      return {
        bSuccess: true,
        Result: `'${JSON.stringify(this.payload)}'`,
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
    expect(expression).not.toContain("open_editor_for_assets");
    expect(expression).not.toContain(
      "/Game/Seria/Editor/BP_FaceConfigHelper",
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
});
