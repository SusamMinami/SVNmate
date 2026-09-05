import { describe, expect, it } from "vitest";
import {
  applyDialogNpcTableRegistration,
  buildDialogNpcRegistrationDrafts,
  dialogNpcRowNameFromClassPath,
  inspectDialogNpcTableRegistration,
  type DialogNpcRegistryRow,
} from "./dialogNpcTable";
import type { UnrealInvoker } from "./ue/transport";

const characterPath =
  "/Game/Test/NPC/N200_Test/BP_N200_Test_Npc.BP_N200_Test_Npc_C";
const animPath =
  "/Game/Test/NPC/N200_Test/ABP_N200_Test.ABP_N200_Test_C";
const cameraPath =
  "/Game/Seria/Task/Mod/CameraMode/Camera_Normal_Male.Camera_Normal_Male_C";
const meshPath =
  "/Game/Test/NPC/N200_Test/SK_N200_Test.SK_N200_Test";

const existingRows: DialogNpcRegistryRow[] = [
  {
    rowName: "Existing",
    characterClassPath:
      "/Game/Test/NPC/Existing/BP_Existing.BP_Existing_C",
    animClassPath: animPath,
    cameraClassPath: cameraPath,
    meshPath,
  },
];

function pythonResult(value: unknown): unknown {
  return {
    bSuccess: true,
    Result: `'${JSON.stringify(value)}'`,
  };
}

class FakeDialogNpcTableConnection implements UnrealInvoker {
  readonly calls: Array<{
    action: string;
    args: Record<string, unknown>;
  }> = [];
  connected = false;
  closed = false;
  rows = [...existingRows];
  readbackMismatch = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ action, args });
    if (action === "asset.save_asset") {
      return true;
    }
    if (action !== "script.eval_python_expression") {
      return true;
    }
    const expression = String(args.Expression ?? "");
    if (expression.includes("get_dirty_content_packages")) {
      return pythonResult({ dirty: false });
    }
    if (
      expression.includes("default_object") &&
      expression.includes("mesh_component")
    ) {
      return pythonResult([
        {
          character_class_path: characterPath,
          anim_class_path: animPath,
          mesh_path: meshPath,
          error: "",
        },
      ]);
    }
    if (
      expression.includes("if not unreal.load_class") &&
      expression.includes("_result = [")
    ) {
      return pythonResult([]);
    }
    if (expression.includes("reload_packages")) {
      this.rows = [...existingRows];
      return pythonResult({ reloaded: true, message: "" });
    }
    if (expression.includes("fill_data_table_from_csv_string")) {
      this.rows = [
        ...existingRows,
        {
          rowName: this.readbackMismatch ? "Wrong_Row" : "N200_Test",
          characterClassPath: characterPath,
          animClassPath: animPath,
          cameraClassPath: cameraPath,
          meshPath,
        },
      ];
      return pythonResult({ ok: true });
    }
    if (expression.includes("get_data_table_row_names")) {
      return pythonResult({
        names: this.rows.map((row) => row.rowName),
        character_paths: this.rows.map(
          (row) => row.characterClassPath,
        ),
        anim_paths: this.rows.map((row) => row.animClassPath),
        camera_paths: this.rows.map((row) => row.cameraClassPath),
        mesh_paths: this.rows.map((row) => row.meshPath),
      });
    }
    throw new Error(`Unexpected expression: ${expression}`);
  }

  close(): void {
    this.closed = true;
  }
}

describe("DialogNPCTable registration", () => {
  it("derives a stable row name from a generated NPC class path", () => {
    expect(dialogNpcRowNameFromClassPath(characterPath)).toBe("N200_Test");
  });

  it("deduplicates slots and suggests the camera from matching mesh and anim", () => {
    const drafts = buildDialogNpcRegistrationDrafts(
      existingRows,
      [
        {
          characterClassPath: characterPath,
          animClassPath: animPath,
          meshPath,
          error: "",
        },
      ],
      [
        { modelIndex: 1, targetId: "500001", modelClassPath: characterPath },
        { modelIndex: 3, targetId: "500003", modelClassPath: characterPath },
      ],
    );

    expect(drafts).toEqual([
      expect.objectContaining({
        rowName: "N200_Test",
        modelIndexes: [1, 3],
        targetIds: ["500001", "500003"],
        cameraClassPath: cameraPath,
        cameraSuggestionSource: "matching_mesh_and_anim",
        blockedReasons: [],
      }),
    ]);
  });

  it("reports row-name conflicts without guessing a replacement", () => {
    const drafts = buildDialogNpcRegistrationDrafts(
      [
        ...existingRows,
        {
          ...existingRows[0],
          rowName: "N200_Test",
        },
      ],
      [
        {
          characterClassPath: characterPath,
          animClassPath: animPath,
          meshPath,
          error: "",
        },
      ],
      [{ modelIndex: 2, targetId: null, modelClassPath: characterPath }],
    );

    expect(drafts[0].blockedReasons).toContain(
      "行名 N200_Test 已被其他模型使用",
    );
  });

  it("inspects, rewrites, verifies and saves without calling the crashing helper", async () => {
    const connection = new FakeDialogNpcTableConnection();
    const review = await inspectDialogNpcTableRegistration(
      {
        slots: [
          {
            modelIndex: 2,
            targetId: "500002",
            modelClassPath: characterPath,
          },
        ],
      },
      () => connection,
    );

    expect(review.rows[0]).toMatchObject({
      rowName: "N200_Test",
      cameraClassPath: cameraPath,
      blockedReasons: [],
    });

    const result = await applyDialogNpcTableRegistration(
      {
        reviewToken: review.reviewToken,
        rows: review.rows.map((row) => ({
          rowName: row.rowName,
          characterClassPath: row.characterClassPath,
          animClassPath: row.animClassPath,
          cameraClassPath: row.cameraClassPath,
          meshPath: row.meshPath,
        })),
      },
      () => connection,
    );

    expect(result).toEqual({
      status: "registered",
      tableAssetPath: "/Game/Seria/Task/Mod/DialogNPCTable",
      registeredRowNames: ["N200_Test"],
      saved: true,
    });
    expect(
      connection.calls.some((call) =>
        String(call.args.Expression ?? "").includes("data_table_add_row"),
      ),
    ).toBe(false);
    expect(
      connection.calls.some((call) =>
        String(call.args.Expression ?? "").includes(
          "fill_data_table_from_csv_string",
        ),
      ),
    ).toBe(true);
    expect(
      connection.calls.some((call) => call.action === "asset.save_asset"),
    ).toBe(true);
    expect(connection.closed).toBe(true);
  });

  it("reloads the package and does not save when full-table readback differs", async () => {
    const connection = new FakeDialogNpcTableConnection();
    const review = await inspectDialogNpcTableRegistration(
      {
        slots: [
          {
            modelIndex: 2,
            targetId: "500002",
            modelClassPath: characterPath,
          },
        ],
      },
      () => connection,
    );
    connection.readbackMismatch = true;

    await expect(
      applyDialogNpcTableRegistration(
        {
          reviewToken: review.reviewToken,
          rows: review.rows.map((row) => ({
            rowName: row.rowName,
            characterClassPath: row.characterClassPath,
            animClassPath: row.animClassPath,
            cameraClassPath: row.cameraClassPath,
            meshPath: row.meshPath,
          })),
        },
        () => connection,
      ),
    ).rejects.toThrow("全表回读不一致");

    expect(
      connection.calls.some((call) =>
        String(call.args.Expression ?? "").includes("reload_packages"),
      ),
    ).toBe(true);
    expect(
      connection.calls.some((call) => call.action === "asset.save_asset"),
    ).toBe(false);
    expect(connection.rows).toEqual(existingRows);
  });
});
