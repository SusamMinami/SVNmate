import {
  Bot,
  CircleCheck,
  GripVertical,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DirectorMode } from "../director/contracts";
import type { LarkStatus } from "../lark/client";
import type { TraeCollaborationStatus } from "../trae/client";

interface WorkspaceStatusHubProps {
  mode: DirectorMode;
  traeLoading: boolean;
  traeStatus: TraeCollaborationStatus | null;
  traeError: string;
  larkLoading: boolean;
  larkStatus: LarkStatus | null;
  larkError: string;
  onRefreshTrae: () => void;
  onSetupTrae: () => void;
  onRefreshLark: () => void;
  onAuthorize: () => void;
  onReorderPendingTasks: (requestIds: string[]) => Promise<void>;
  onDeletePendingTask: (requestId: string) => Promise<void>;
  onCancelTask: (requestId: string) => Promise<void>;
  disabled?: boolean;
}

function larkConnectionLabel(
  loading: boolean,
  status: LarkStatus | null,
  error: string,
): string {
  if (loading) {
    return "正在检查飞书";
  }
  if (error) {
    return "飞书桥不可用";
  }
  if (!status?.authorized) {
    return "飞书未登录";
  }
  if (status.missingScopes.length > 0) {
    return `缺少 ${status.missingScopes.length} 项权限`;
  }
  if (!status.miraBot) {
    return "待发现 Mira";
  }
  return `已连接 ${status.miraBot.name}`;
}

export function WorkspaceStatusHub({
  mode,
  traeLoading,
  traeStatus,
  traeError,
  larkLoading,
  larkStatus,
  larkError,
  onRefreshTrae,
  onSetupTrae,
  onRefreshLark,
  onAuthorize,
  onReorderPendingTasks,
  onDeletePendingTask,
  onCancelTask,
  disabled = false,
}: WorkspaceStatusHubProps) {
  const [open, setOpen] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueError, setQueueError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const activeTasks =
    traeStatus?.tasks ??
    (traeStatus?.queue ?? []).map((task) => ({
      ...task,
      status: "pending" as const,
    }));
  const pendingTasks = activeTasks.filter(
    (task) => task.status !== "processing",
  );
  const miraMissingScopes =
    larkStatus?.miraMissingScopes ?? larkStatus?.missingScopes ?? [];
  const traeConnected = Boolean(traeStatus?.connected);
  const miraReady =
    Boolean(larkStatus?.authorized) &&
    miraMissingScopes.length === 0 &&
    Boolean(larkStatus?.miraBot);
  const providerIsTrae = mode !== "mira";
  const needsAuthorization =
    !larkStatus?.authorized || (larkStatus?.missingScopes.length ?? 0) > 0;
  const providerLoading = providerIsTrae ? traeLoading : larkLoading;
  const providerReady = providerIsTrae ? traeConnected : miraReady;
  const providerLabel =
    providerIsTrae
      ? traeLoading
        ? "正在检查内部 TRAE MCP"
        : traeError
          ? "TRAE 本地桥不可用"
          : traeConnected
            ? "内部 TRAE MCP 已连接"
            : traeStatus?.versionMismatch
              ? "MCP 仍在运行旧版本"
              : traeStatus?.configured
                ? "MCP 配置已发现，等待连接"
                : "尚未检测到内部 TRAE MCP"
      : larkConnectionLabel(larkLoading, larkStatus, larkError);
  const providerDetail =
    providerIsTrae
      ? traeConnected
        ? `待处理 ${traeStatus?.stats.pending ?? 0} · 处理中 ${traeStatus?.stats.processing ?? 0}`
        : traeStatus?.versionMismatch
          ? `当前 ${traeStatus.serverVersion ?? "旧版"} · 需要 ${traeStatus.expectedVersion}；请在 TRAE 中停用后重新启用`
          : traeStatus?.configured
            ? "请在当前 TRAE 启用该 MCP"
            : "仍可先提交任务，再启动 MCP 处理"
      : miraReady
        ? `飞书用户：${larkStatus?.userName || "已授权用户"}`
        : "不可用时会自动降级到规则导演";
  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function movePendingTask(targetRequestId: string) {
    if (
      !draggingTaskId ||
      draggingTaskId === targetRequestId ||
      queueBusy
    ) {
      setDraggingTaskId(null);
      return;
    }
    const requestIds = pendingTasks.map((task) => task.requestId);
    const sourceIndex = requestIds.indexOf(draggingTaskId);
    const targetIndex = requestIds.indexOf(targetRequestId);
    if (sourceIndex < 0 || targetIndex < 0) {
      setDraggingTaskId(null);
      return;
    }
    const [moved] = requestIds.splice(sourceIndex, 1);
    requestIds.splice(targetIndex, 0, moved);
    setQueueBusy(true);
    setQueueError("");
    try {
      await onReorderPendingTasks(requestIds);
    } catch (error) {
      setQueueError(
        error instanceof Error ? error.message : "无法更新待处理顺序",
      );
    } finally {
      setQueueBusy(false);
      setDraggingTaskId(null);
    }
  }

  async function removeTask(
    requestId: string,
    dialogueId: string,
    processing: boolean,
  ) {
    if (
      queueBusy ||
      !window.confirm(
        processing
          ? `确定中断正在处理的分镜 ${dialogueId} 吗？\n当前 TRAE 结果将被丢弃。`
          : `确定删除待处理分镜 ${dialogueId} 吗？\n删除后 TRAE 将不会处理该任务。`,
      )
    ) {
      return;
    }
    setQueueBusy(true);
    setQueueError("");
    try {
      if (processing) {
        await onCancelTask(requestId);
      } else {
        await onDeletePendingTask(requestId);
      }
    } catch (error) {
      setQueueError(
        error instanceof Error ? error.message : "无法删除待处理分镜",
      );
    } finally {
      setQueueBusy(false);
    }
  }

  return (
    <div className="workspace-status-hub" ref={rootRef}>
      <button
        className="workspace-status-icon"
        data-state={
          providerLoading ? "loading" : providerReady ? "ready" : "warning"
        }
        type="button"
        aria-label="协作连接状态"
        aria-haspopup="dialog"
        aria-expanded={!disabled && open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {providerLoading ? (
          <LoaderCircle className="spin" size={17} />
        ) : providerIsTrae ? (
          <SquareTerminal size={17} />
        ) : (
          <Bot size={17} />
        )}
        <span className="workspace-status-tooltip">{providerLabel}</span>
      </button>

      {open && !disabled && (
        <section
          className="workspace-status-popover"
          role="dialog"
          aria-label="协作连接状态"
        >
          <header>
            <span>
              {providerReady ? (
                <CircleCheck size={17} />
              ) : (
                <ShieldAlert size={17} />
              )}
            </span>
            <div>
              <small>协作连接</small>
              <strong>{providerLabel}</strong>
            </div>
          </header>

          <p>{providerDetail}</p>
          {providerIsTrae && (
            <section
              className="workspace-status-queue"
              aria-label="TRAE 协作任务"
              aria-busy={queueBusy}
            >
              <header>
                <strong>协作任务</strong>
                <small>{activeTasks.length} 项</small>
              </header>
              {activeTasks.length === 0 ? (
                <p>当前没有等待或处理中的分镜</p>
              ) : (
                <ol>
                  {activeTasks.map((task) => {
                    const processing = task.status === "processing";
                    return (
                    <li
                      className={
                        `${draggingTaskId === task.requestId ? "is-dragging" : ""} ${
                          processing ? "is-processing" : ""
                        }`
                      }
                      draggable={!queueBusy && !processing}
                      key={task.requestId}
                      onDragStart={(event) => {
                        if (processing) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", task.requestId);
                        setDraggingTaskId(task.requestId);
                      }}
                      onDragOver={(event) => {
                        if (!queueBusy) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!processing) {
                          void movePendingTask(task.requestId);
                        }
                      }}
                      onDragEnd={() => setDraggingTaskId(null)}
                    >
                      {processing ? (
                        <LoaderCircle
                          className="workspace-status-queue__handle spin"
                          size={14}
                          aria-hidden="true"
                        />
                      ) : (
                        <GripVertical
                          className="workspace-status-queue__handle"
                          size={14}
                          aria-hidden="true"
                        />
                      )}
                      <div>
                        <strong>
                          对话 {task.dialogueId}
                          <em>{processing ? "处理中" : "等待中"}</em>
                        </strong>
                        <span>{task.outline || task.firstLine}</span>
                        <small>
                          {task.dialogueCount} 句 ·{" "}
                          {task.participantNames.join("、")}
                        </small>
                      </div>
                      <button
                        className="workspace-status-queue__delete"
                        type="button"
                        title={
                          processing
                            ? `中断正在处理分镜 ${task.dialogueId}`
                            : `删除待处理分镜 ${task.dialogueId}`
                        }
                        aria-label={
                          processing
                            ? `中断正在处理分镜 ${task.dialogueId}`
                            : `删除待处理分镜 ${task.dialogueId}`
                        }
                        disabled={queueBusy}
                        onClick={() =>
                          void removeTask(
                            task.requestId,
                            task.dialogueId,
                            processing,
                          )
                        }
                      >
                        <X size={13} />
                      </button>
                    </li>
                    );
                  })}
                </ol>
              )}
              {queueError && (
                <p className="workspace-status-queue__error" role="alert">
                  {queueError}
                </p>
              )}
            </section>
          )}
          <button
            className="button"
            type="button"
            title={
              providerIsTrae
                ? traeConnected
                  ? "刷新协作状态"
                  : traeStatus?.versionMismatch
                    ? "查看 MCP 重启步骤"
                    : "查看 MCP 配置"
                : needsAuthorization
                  ? "授权飞书"
                  : "刷新连接"
            }
            aria-label={
              providerIsTrae
                ? traeConnected
                  ? "刷新内部 TRAE 协作状态"
                  : "配置内部 TRAE MCP"
                : needsAuthorization
                  ? "授权飞书"
                  : "刷新飞书连接"
            }
            onClick={
              providerIsTrae
                ? traeConnected
                  ? onRefreshTrae
                  : onSetupTrae
                : needsAuthorization
                  ? onAuthorize
                  : onRefreshLark
            }
            disabled={providerLoading}
          >
            <RefreshCw size={14} />
            {providerIsTrae
              ? traeConnected
                ? "刷新状态"
                : "查看配置"
              : needsAuthorization
                ? "授权飞书"
                : "刷新状态"}
          </button>
        </section>
      )}
    </div>
  );
}
