import {
  Bot,
  CircleCheck,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  SquareTerminal,
} from "lucide-react";
import type { DirectorMode } from "../director/contracts";
import type { LarkStatus } from "../lark/client";
import type { TraeCollaborationStatus } from "../trae/client";

interface DirectorControlProps {
  mode: DirectorMode;
  appliedMode: DirectorMode;
  loading: boolean;
  traeLoading: boolean;
  traeStatus: TraeCollaborationStatus | null;
  traeError: string;
  larkLoading: boolean;
  larkStatus: LarkStatus | null;
  larkError: string;
  onModeChange: (mode: DirectorMode) => void;
  onRefreshTrae: () => void;
  onSetupTrae: () => void;
  onRefreshLark: () => void;
  onAuthorize: () => void;
}

function connectionLabel(
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

function modeLabel(mode: DirectorMode): string {
  if (mode === "trae") {
    return "内部 TRAE";
  }
  return mode === "mira" ? "Mira AI" : "规则导演";
}

export function DirectorControl({
  mode,
  appliedMode,
  loading,
  traeLoading,
  traeStatus,
  traeError,
  larkLoading,
  larkStatus,
  larkError,
  onModeChange,
  onRefreshTrae,
  onSetupTrae,
  onRefreshLark,
  onAuthorize,
}: DirectorControlProps) {
  const needsAuthorization =
    !larkStatus?.authorized || (larkStatus?.missingScopes.length ?? 0) > 0;
  const traeConnected = Boolean(traeStatus?.connected);
  const isReady =
    Boolean(larkStatus?.authorized) &&
    larkStatus?.missingScopes.length === 0 &&
    Boolean(larkStatus?.miraBot);

  return (
    <div className="director-control">
      <div className="section-label">
        <span>导演模式</span>
        <small>实际：{modeLabel(appliedMode)}</small>
      </div>
      <div className="mode-segment" role="group" aria-label="导演模式">
        <button
          type="button"
          className={mode === "rule" ? "is-active" : ""}
          aria-pressed={mode === "rule"}
          onClick={() => onModeChange("rule")}
          disabled={loading}
        >
          <SlidersHorizontal size={15} />
          规则导演
        </button>
        <button
          type="button"
          className={mode === "trae" ? "is-active" : ""}
          aria-pressed={mode === "trae"}
          onClick={() => onModeChange("trae")}
          disabled={loading}
        >
          <SquareTerminal size={15} />
          TRAE 协作
        </button>
        <button
          type="button"
          className={mode === "mira" ? "is-active" : ""}
          aria-pressed={mode === "mira"}
          onClick={() => onModeChange("mira")}
          disabled={loading}
        >
          <Bot size={15} />
          Mira AI
        </button>
      </div>

      {mode === "trae" && (
        <div
          className={`mira-status ${traeConnected ? "is-ready" : ""}`}
        >
          <span className="mira-status__icon">
            {traeLoading ? (
              <LoaderCircle className="spin" size={15} />
            ) : traeConnected ? (
              <CircleCheck size={15} />
            ) : (
              <ShieldAlert size={15} />
            )}
          </span>
          <div>
            <strong>
              {traeLoading
                ? "正在检查内部 TRAE MCP"
                : traeError
                  ? "TRAE 本地桥不可用"
                  : traeConnected
                    ? "内部 TRAE MCP 已连接"
                    : traeStatus?.versionMismatch
                      ? "MCP 版本已更新，需要重启"
                    : traeStatus?.configured
                      ? "MCP 配置已发现，等待连接"
                      : "尚未检测到内部 TRAE MCP"}
            </strong>
            <small>
              {traeConnected
                ? `待处理 ${traeStatus?.stats.pending ?? 0} · 处理中 ${traeStatus?.stats.processing ?? 0}`
                : traeStatus?.versionMismatch
                  ? `当前 ${traeStatus.serverVersion ?? "旧版"} · 需要 ${traeStatus.expectedVersion}`
                : traeStatus?.configured
                  ? "请在当前 TRAE 启用该 MCP"
                  : "仍可先提交任务，再启动 MCP 处理"}
            </small>
          </div>
          <button
            type="button"
            className="mira-status__action"
            title={traeConnected ? "刷新协作状态" : "查看 MCP 配置"}
            aria-label={
              traeConnected
                ? "刷新内部 TRAE 协作状态"
                : "配置内部 TRAE MCP"
            }
            onClick={traeConnected ? onRefreshTrae : onSetupTrae}
            disabled={traeLoading}
          >
            {traeConnected ? <RefreshCw size={14} /> : "配置"}
          </button>
        </div>
      )}

      {mode === "mira" && (
        <div className={`mira-status ${isReady ? "is-ready" : ""}`}>
          <span className="mira-status__icon">
            {larkLoading ? (
              <LoaderCircle className="spin" size={15} />
            ) : isReady ? (
              <CircleCheck size={15} />
            ) : (
              <ShieldAlert size={15} />
            )}
          </span>
          <div>
            <strong>
              {connectionLabel(larkLoading, larkStatus, larkError)}
            </strong>
            <small>
              {isReady
                ? `飞书用户：${larkStatus?.userName || "已授权用户"}`
                : "不可用时会自动降级到规则导演"}
            </small>
          </div>
          <button
            type="button"
            className="mira-status__action"
            title={needsAuthorization ? "授权飞书" : "刷新连接"}
            aria-label={needsAuthorization ? "授权飞书" : "刷新飞书连接"}
            onClick={needsAuthorization ? onAuthorize : onRefreshLark}
            disabled={larkLoading}
          >
            {needsAuthorization ? "授权" : <RefreshCw size={14} />}
          </button>
        </div>
      )}
    </div>
  );
}
