import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyDialoguePreviewSchool,
  inspectDialoguePreviewSchool,
} from "./ueBridge";
import type { UnrealInvoker } from "./ue/transport";

class FakePreviewSchoolConnection implements UnrealInvoker {
  readonly dialogueAssetPath =
    "/Game/Seria/Task/dialoggraph/Test/735200.735200";
  previewSchoolId = 401;
  selectedDialogueNodeId = "735200";
  saveResult = true;
  saveAttempted = false;
  connected = false;
  closed = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async invoke(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (action === "script.eval_python_expression") {
      return {
        bSuccess: true,
        Result: `'${JSON.stringify([
          this.dialogueAssetPath,
          this.selectedDialogueNodeId,
        ])}'`,
      };
    }
    if (action === "asset.asset_search") {
      return [
        `735200 (SeriaDialogGraph) [${this.dialogueAssetPath}]`,
      ];
    }
    if (action === "asset.get_asset_by_path") {
      return "DialogGraph_735200";
    }
    if (action === "asset.export_asset_to_text_file") {
      return resolve(
        process.cwd(),
        "server/fixtures/storyboard-dialogue-export.txt",
      );
    }
    if (action === "asset.save_asset") {
      this.saveAttempted = true;
      return this.saveResult;
    }
    if (action === "reflect.write_object_property") {
      if (args.PropertyName === "PreviewSchoolID") {
        this.previewSchoolId = Number(args.Value);
      }
      return true;
    }
    if (action !== "reflect.read_object_property") {
      return true;
    }
    const object = String(args.ThisPtr);
    const property = String(args.PropertyName);
    if (object.endsWith(":Dialog Graph") && property === "Nodes") {
      return [
        "SeriaEdDialogGraphNode_0",
        "SeriaEdDialogGraphNode_1",
        "SeriaEdDialogGraphNode_2",
        "SeriaEdDialogGraphNode_3",
      ];
    }
    if (
      object.includes("SeriaEdDialogGraphNode_") &&
      property === "DialogGraphNodeData"
    ) {
      const nodeIndex = object.match(/_(\d+)$/)?.[1];
      return nodeIndex === "0" ? "StartData" : `ActionData${nodeIndex}`;
    }
    if (object.endsWith("StartData")) {
      if (property === "CommonDialogGraphProperties") {
        return [{ Alias: "id", CurrentUint32: 735200 }];
      }
      if (property === "PreviewSchoolID") {
        return this.previewSchoolId;
      }
    }
    return [];
  }

  close(): void {
    this.closed = true;
  }
}

const request = {
  dialogueId: "7352",
  startId: "735200",
  dialogueNodeId: "735200",
  previewSchoolId: 100,
};

describe("dialogue preview school", () => {
  it("previews and writes PreviewSchoolID on the selected 00 node", async () => {
    const connection = new FakePreviewSchoolConnection();
    const preview = await inspectDialoguePreviewSchool(
      request,
      () => connection,
    );

    expect(preview).toMatchObject({
      existingPreviewSchoolId: 401,
      previewSchoolId: 100,
      changed: true,
      blockedReasons: [],
    });
    await expect(
      applyDialoguePreviewSchool(
        { ...request, reviewToken: preview.reviewToken },
        () => connection,
      ),
    ).resolves.toMatchObject({
      status: "updated",
      previewSchoolId: 100,
      saved: true,
    });
    expect(connection.previewSchoolId).toBe(100);
    expect(connection.saveAttempted).toBe(true);
  });

  it("rejects non-00 nodes and restores PreviewSchoolID after save failure", async () => {
    const invalid = new FakePreviewSchoolConnection();
    await expect(
      inspectDialoguePreviewSchool(
        { ...request, dialogueNodeId: "735201" },
        () => invalid,
      ),
    ).rejects.toThrow("00 配置节点");

    const failedSave = new FakePreviewSchoolConnection();
    const preview = await inspectDialoguePreviewSchool(
      request,
      () => failedSave,
    );
    failedSave.saveResult = false;
    await expect(
      applyDialoguePreviewSchool(
        { ...request, reviewToken: preview.reviewToken },
        () => failedSave,
      ),
    ).rejects.toThrow("已恢复本轮未保存修改");
    expect(failedSave.previewSchoolId).toBe(401);
  });
});
