import type {
  SelectedDialogueNodeInfo,
  SelectedDialogueNodeResult,
} from "../../src/types";
import {
  UnrealMcpConnection,
  type UnrealInvoker,
} from "./transport";

export const SELECTED_GRAPH_NODES_ACTION =
  "bp.get_selected_ed_graph_node_infos";

function recordValue(
  record: Record<string, unknown>,
  names: string[],
): unknown {
  const entries = Object.entries(record);
  for (const name of names) {
    const match = entries.find(
      ([key]) => key.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function stringValue(
  record: Record<string, unknown>,
  names: string[],
): string {
  const value = recordValue(record, names);
  return typeof value === "string" ? value.trim() : "";
}

function selectedNodeRecords(value: unknown): Record<string, unknown>[] {
  const candidate =
    Array.isArray(value)
      ? value
      : value && typeof value === "object"
        ? recordValue(value as Record<string, unknown>, [
            "ReturnValue",
            "SelectedNodes",
            "Nodes",
          ])
        : [];
  return Array.isArray(candidate)
    ? candidate.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function uniqueDialogueId(text: string): string | null {
  const matches = Array.from(
    text.matchAll(/(?:^|[^\d])(\d{6})(?!\d)/g),
    (match) => match[1],
  );
  const unique = Array.from(new Set(matches));
  return unique.length === 1 ? unique[0] : null;
}

export function parseSelectedDialogueNodes(
  value: unknown,
): SelectedDialogueNodeInfo[] {
  return selectedNodeRecords(value).map((node) => {
    const nodeClass = stringValue(node, [
      "NodeClass",
      "GraphNodeClass",
      "ClassPath",
    ]);
    const nodeTitle = stringValue(node, ["NodeTitle", "Title"]);
    const nodeComment = stringValue(node, ["NodeComment", "Comment"]);
    const titleId = uniqueDialogueId(nodeTitle);
    const descriptiveId = uniqueDialogueId(
      [nodeTitle, nodeComment, JSON.stringify(node)].join("\n"),
    );
    const isDialogueNode =
      !nodeClass ||
      nodeClass.toLocaleLowerCase().includes("seriaeddialoggraphnode");
    return {
      nodeClass,
      nodeTitle,
      nodeComment,
      dialogueNodeId: isDialogueNode ? titleId ?? descriptiveId : null,
    };
  });
}

export async function readSelectedDialogueNode(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<SelectedDialogueNodeResult> {
  const connection = connectionFactory();
  try {
    await connection.connect();
    const nodes = parseSelectedDialogueNodes(
      await connection.invoke(SELECTED_GRAPH_NODES_ACTION, {}),
    );
    if (nodes.length === 0) {
      return {
        status: "empty",
        dialogueNodeId: null,
        selectedNodeCount: 0,
        nodes,
        message: "UE 当前没有选中图节点",
      };
    }
    if (nodes.length > 1) {
      return {
        status: "multiple",
        dialogueNodeId: null,
        selectedNodeCount: nodes.length,
        nodes,
        message: `UE 当前选中了 ${nodes.length} 个图节点`,
      };
    }
    const dialogueNodeId = nodes[0].dialogueNodeId;
    if (!dialogueNodeId) {
      return {
        status: "unrecognized",
        dialogueNodeId: null,
        selectedNodeCount: 1,
        nodes,
        message: "UE 当前选中项不是可识别的对话节点",
      };
    }
    return {
      status: "selected",
      dialogueNodeId,
      selectedNodeCount: 1,
      nodes,
      message: `已同步 UE 节点 ${dialogueNodeId}`,
    };
  } catch (error) {
    return {
      status: "offline",
      dialogueNodeId: null,
      selectedNodeCount: 0,
      nodes: [],
      message:
        error instanceof Error
          ? `无法读取 UE 当前节点：${error.message}`
          : "无法读取 UE 当前节点",
    };
  } finally {
    connection.close();
  }
}
