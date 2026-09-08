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
const SERIA_DIALOG_SELECTION_ACTION = "script.eval_python_expression";
const SERIA_DIALOG_SELECTION_EXPRESSION =
  "__import__('json').dumps(list(unreal.get_editor_subsystem(unreal.SeriaDialogEditorSubsystem).get_current_selected_dialog_node_info()))";
const SERIA_DIALOG_SUBSYSTEM_CLASS =
  "/Script/SeriaDialogEditor.SeriaDialogEditorSubsystem";

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

function pythonJsonResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("UE 对话编辑器没有返回有效的节点选择");
  }
  const result = value as {
    bSuccess?: unknown;
    Result?: unknown;
    Message?: unknown;
  };
  if (result.bSuccess === false) {
    throw new Error(
      typeof result.Message === "string" && result.Message.trim()
        ? result.Message
        : "UE 对话编辑器节点选择接口不可用",
    );
  }
  if (typeof result.Result !== "string") {
    throw new Error("UE 对话编辑器没有返回有效的节点选择");
  }
  const raw = result.Result.trim();
  const serialized =
    raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw;
  return JSON.parse(serialized);
}

function seriaDialogueNodeId(
  assetPath: string,
  localNodeId: string,
): string | null {
  const directId = uniqueDialogueId(localNodeId);
  if (directId) {
    return directId;
  }
  const assetId = uniqueDialogueId(assetPath);
  const localIdMatch = localNodeId.match(/^\d{1,2}$/);
  if (!assetId || !localIdMatch) {
    return null;
  }
  return `${assetId.slice(0, 4)}${localNodeId.padStart(2, "0")}`;
}

function objectReference(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dialogueIdFromCommonProperties(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const idProperty = value.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      String(recordValue(entry as Record<string, unknown>, ["Alias"]))
        .trim()
        .toLocaleLowerCase() === "id",
  ) as Record<string, unknown> | undefined;
  const dialogueId = String(
    idProperty
      ? recordValue(idProperty, ["CurrentUint32", "Value"])
      : "",
  ).trim();
  return /^\d{6}$/.test(dialogueId) ? dialogueId : null;
}

async function selectedDialogueIdFromNodeData(
  connection: UnrealInvoker,
): Promise<string | null> {
  const subsystem = objectReference(
    await connection.invoke("editor.get_editor_subsystem", {
      SubsystemClass: SERIA_DIALOG_SUBSYSTEM_CLASS,
    }),
  );
  if (!subsystem) {
    return null;
  }
  const selectionCount = Number(
    await connection.invoke("reflect.read_object_property", {
      ThisPtr: subsystem,
      PropertyName: "CurrentDialogGraphSelectionCount",
    }),
  );
  if (selectionCount !== 1) {
    return null;
  }
  const selectedNode = objectReference(
    await connection.invoke("reflect.read_object_property", {
      ThisPtr: subsystem,
      PropertyName: "CurrentSelectedDialogNode",
    }),
  );
  if (!selectedNode) {
    return null;
  }
  const nodeData = objectReference(
    await connection.invoke("reflect.read_object_property", {
      ThisPtr: selectedNode,
      PropertyName: "DialogGraphNodeData",
    }),
  );
  if (!nodeData) {
    return null;
  }
  return dialogueIdFromCommonProperties(
    await connection.invoke("reflect.read_object_property", {
      ThisPtr: nodeData,
      PropertyName: "CommonDialogGraphProperties",
    }),
  );
}

export function parseSeriaSelectedDialogueNode(
  value: unknown,
  selectedDialogueId?: string | null,
): SelectedDialogueNodeInfo | null {
  const selected = pythonJsonResult(value);
  if (!Array.isArray(selected) || selected.length < 2) {
    return null;
  }
  const assetPath = String(selected[0] ?? "").trim();
  const localNodeId = String(selected[1] ?? "").trim();
  if (!assetPath || !localNodeId) {
    return null;
  }
  const dialogueNodeId =
    selectedDialogueId ?? seriaDialogueNodeId(assetPath, localNodeId);
  if (!dialogueNodeId) {
    return null;
  }
  return {
    nodeClass: "/Script/SeriaDialogEditor.SeriaEdDialogGraphNode",
    nodeTitle: localNodeId,
    nodeComment: assetPath,
    dialogueNodeId,
  };
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

export async function readSelectedDialogueNodesFromConnection(
  connection: UnrealInvoker,
): Promise<{
  nodes: SelectedDialogueNodeInfo[];
  seriaSelectionAvailable: boolean;
}> {
  let seriaSelectionAvailable = false;
  try {
    const rawSelection = await connection.invoke(
      SERIA_DIALOG_SELECTION_ACTION,
      {
        Expression: SERIA_DIALOG_SELECTION_EXPRESSION,
      },
    );
    const reflectedDialogueId =
      await selectedDialogueIdFromNodeData(connection).catch(() => null);
    const selectedNode = parseSeriaSelectedDialogueNode(
      rawSelection,
      reflectedDialogueId,
    );
    seriaSelectionAvailable = true;
    if (selectedNode) {
      return { nodes: [selectedNode], seriaSelectionAvailable };
    }
  } catch {
    // Older projects may not expose the Seria dialogue editor subsystem.
  }

  const rawFallbackSelection = await connection.invoke(
    SELECTED_GRAPH_NODES_ACTION,
    {},
  );
  const fallbackNodes = parseSelectedDialogueNodes(rawFallbackSelection);
  return {
    nodes: fallbackNodes,
    seriaSelectionAvailable,
  };
}

function offlineSelectionResult(error: unknown): SelectedDialogueNodeResult {
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
}

async function readSelectedDialogueNodeFromConnection(
  connection: UnrealInvoker,
): Promise<SelectedDialogueNodeResult> {
  const { nodes, seriaSelectionAvailable } =
    await readSelectedDialogueNodesFromConnection(connection);
  if (nodes.length === 0) {
    return {
      status: "empty",
      dialogueNodeId: null,
      selectedNodeCount: 0,
      nodes,
      message: seriaSelectionAvailable
        ? "请在 UE 对话图中只选中一个节点"
        : "UE 当前没有选中图节点",
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
}

export async function readSelectedDialogueNode(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<SelectedDialogueNodeResult> {
  const connection = connectionFactory();
  try {
    await connection.connect();
    return await readSelectedDialogueNodeFromConnection(connection);
  } catch (error) {
    return offlineSelectionResult(error);
  } finally {
    connection.close();
  }
}

const DEFAULT_PERSISTENT_SELECTION_IDLE_TIMEOUT_MS = 15_000;

export class PersistentDialogueSelectionReader {
  private connection: UnrealInvoker | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingReads = 0;

  constructor(
    private readonly connectionFactory: () => UnrealInvoker = () =>
      new UnrealMcpConnection(),
    private readonly idleTimeoutMs =
      DEFAULT_PERSISTENT_SELECTION_IDLE_TIMEOUT_MS,
  ) {}

  read(): Promise<SelectedDialogueNodeResult> {
    this.clearIdleTimer();
    this.pendingReads += 1;
    const operation = this.operationQueue.then(
      () => this.readOnce(),
      () => this.readOnce(),
    );
    this.operationQueue = operation.then(() => undefined, () => undefined);
    const finishRead = () => {
      this.pendingReads -= 1;
      if (this.pendingReads === 0) {
        this.scheduleIdleRelease();
      }
    };
    void operation.then(finishRead, finishRead);
    return operation;
  }

  dispose(): void {
    this.clearIdleTimer();
    this.releaseConnection();
  }

  private async readOnce(): Promise<SelectedDialogueNodeResult> {
    let connection = this.connection;
    if (!connection) {
      try {
        connection = this.connectionFactory();
        await connection.connect();
        this.connection = connection;
      } catch (error) {
        connection?.close();
        return offlineSelectionResult(error);
      }
    }
    try {
      return await readSelectedDialogueNodeFromConnection(connection);
    } catch (error) {
      if (this.connection === connection) {
        this.connection = null;
      }
      connection.close();
      return offlineSelectionResult(error);
    }
  }

  private scheduleIdleRelease(): void {
    if (!this.connection || this.idleTimeoutMs <= 0) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.releaseConnection();
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private releaseConnection(): void {
    const connection = this.connection;
    this.connection = null;
    connection?.close();
  }
}

const persistentDialogueSelectionReader =
  new PersistentDialogueSelectionReader();

export function readSelectedDialogueNodePersistent(): Promise<SelectedDialogueNodeResult> {
  return persistentDialogueSelectionReader.read();
}
