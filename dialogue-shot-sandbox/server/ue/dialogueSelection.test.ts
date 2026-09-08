import { describe, expect, it, vi } from "vitest";
import {
  parseSelectedDialogueNodes,
  parseSeriaSelectedDialogueNode,
  readSelectedDialogueNode,
  SELECTED_GRAPH_NODES_ACTION,
} from "./dialogueSelection";
import type { UnrealInvoker } from "./transport";

function invoker(result: unknown): UnrealInvoker & {
  connect: ReturnType<typeof vi.fn>;
  invoke: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    connect: vi.fn(async () => undefined),
    invoke: vi.fn(async () => result),
    close: vi.fn(),
  };
}

describe("UE dialogue graph selection", () => {
  it("reads the selected node from the Seria dialogue editor subsystem", () => {
    expect(
      parseSeriaSelectedDialogueNode({
        bSuccess: true,
        Result:
          "'[\"/Game/Seria/Task/dialoggraph/1009-Cha08/734000.734000\", \"1\"]'",
      }),
    ).toEqual({
      nodeClass: "/Script/SeriaDialogEditor.SeriaEdDialogGraphNode",
      nodeTitle: "1",
      nodeComment:
        "/Game/Seria/Task/dialoggraph/1009-Cha08/734000.734000",
      dialogueNodeId: "734001",
    });
  });

  it("parses a dialogue id from the selected node title", () => {
    expect(
      parseSelectedDialogueNodes([
        {
          NodeClass: "/Script/SeriaEditor.SeriaEdDialogGraphNode",
          NodeTitle: "735201 · 玩家：你来了。",
          NodeComment: "",
          Pins: [],
        },
      ]),
    ).toEqual([
      {
        nodeClass: "/Script/SeriaEditor.SeriaEdDialogGraphNode",
        nodeTitle: "735201 · 玩家：你来了。",
        nodeComment: "",
        dialogueNodeId: "735201",
      },
    ]);
  });

  it("falls back to a unique six-digit id in the node details", () => {
    expect(
      parseSelectedDialogueNodes({
        ReturnValue: [
          {
            nodeClass: "SeriaEdDialogGraphNode",
            nodeTitle: "对白节点",
            nodeComment: "",
            pins: [{ Name: "ID", DefaultValue: "735202" }],
          },
        ],
      })[0].dialogueNodeId,
    ).toBe("735202");
  });

  it("does not treat another graph type with a numeric title as dialogue", () => {
    expect(
      parseSelectedDialogueNodes([
        {
          NodeClass: "/Script/BlueprintGraph.K2Node_CallFunction",
          NodeTitle: "Debug 735201",
        },
      ])[0].dialogueNodeId,
    ).toBeNull();
  });

  it("returns the single selected dialogue node", async () => {
    const connection = invoker([
      {
        NodeClass: "SeriaEdDialogGraphNode",
        NodeTitle: "节点 735201",
      },
    ]);

    await expect(
      readSelectedDialogueNode(() => connection),
    ).resolves.toMatchObject({
      status: "selected",
      dialogueNodeId: "735201",
      selectedNodeCount: 1,
    });
    expect(connection.invoke).toHaveBeenCalledWith(
      SELECTED_GRAPH_NODES_ACTION,
      {},
    );
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it("prefers the Seria dialogue editor selection over Blueprint selection", async () => {
    const connection = invoker([]);
    connection.invoke.mockImplementation(async (action) => {
      if (action === "script.eval_python_expression") {
        return {
          bSuccess: true,
          Result:
            "'[\"/Game/Seria/Task/dialoggraph/1009-Cha08/734000.734000\", \"1\"]'",
        };
      }
      return [];
    });

    await expect(
      readSelectedDialogueNode(() => connection),
    ).resolves.toMatchObject({
      status: "selected",
      dialogueNodeId: "734001",
      selectedNodeCount: 1,
    });
    expect(connection.invoke).not.toHaveBeenCalledWith(
      SELECTED_GRAPH_NODES_ACTION,
      {},
    );
  });

  it("asks for one dialogue node when the Seria editor has no exact selection", async () => {
    const connection = invoker([]);
    connection.invoke.mockImplementation(async (action) =>
      action === "script.eval_python_expression"
        ? {
            bSuccess: true,
            Result: "'[\"\", \"\"]'",
          }
        : [],
    );

    await expect(
      readSelectedDialogueNode(() => connection),
    ).resolves.toMatchObject({
      status: "empty",
      message: "请在 UE 对话图中只选中一个节点",
    });
  });

  it("rejects ambiguous multi-selection without choosing a node", async () => {
    const connection = invoker([
      { NodeTitle: "节点 735201" },
      { NodeTitle: "节点 735202" },
    ]);

    await expect(
      readSelectedDialogueNode(() => connection),
    ).resolves.toMatchObject({
      status: "multiple",
      dialogueNodeId: null,
      selectedNodeCount: 2,
    });
  });

  it("reports an unavailable editor without throwing into the poller", async () => {
    const connection = invoker([]);
    connection.connect.mockRejectedValueOnce(new Error("连接 UE 编辑器超时"));

    await expect(
      readSelectedDialogueNode(() => connection),
    ).resolves.toMatchObject({
      status: "offline",
      dialogueNodeId: null,
      message: expect.stringContaining("连接 UE 编辑器超时"),
    });
    expect(connection.close).toHaveBeenCalledOnce();
  });
});
