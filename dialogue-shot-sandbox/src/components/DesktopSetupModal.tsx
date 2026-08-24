import {
  Check,
  CircleAlert,
  Database,
  Download,
  ExternalLink,
  FolderCog,
  LoaderCircle,
  LogIn,
  PlugZap,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { LarkStatus } from "../lark/client";

interface DesktopSetupModalProps {
  initialStatus: DesktopSetupStatus;
  onClose: () => void;
  onRefreshTrae: () => void;
  larkLoading: boolean;
  larkStatus: LarkStatus | null;
  larkError: string;
  onAuthorize: () => void;
  onRefreshLark: () => void;
}

function updateLabel(snapshot: DesktopUpdateSnapshot): string {
  switch (snapshot.state) {
    case "checking":
      return "正在检查更新";
    case "available":
      return `发现 ${snapshot.version ?? "新版本"}`;
    case "downloading":
      return `正在下载 ${snapshot.percent ?? 0}%`;
    case "downloaded":
      return `${snapshot.version ?? "新版本"} 已就绪`;
    case "current":
      return snapshot.message || "当前已是最新版本";
    case "error":
      return "暂时无法连接更新服务";
    default:
      return "尚未检查更新";
  }
}

export function DesktopSetupModal({
  initialStatus,
  onClose,
  onRefreshTrae,
  larkLoading,
  larkStatus,
  larkError,
  onAuthorize,
  onRefreshLark,
}: DesktopSetupModalProps) {
  const desktop = window.shotSandboxDesktop;
  const [status, setStatus] = useState(initialStatus);
  const [update, setUpdate] = useState<DesktopUpdateSnapshot>({
    state: "idle",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uePort, setUePort] = useState(String(initialStatus.ueMcpPort));
  const baseMissingScopes =
    larkStatus?.baseMissingScopes ?? larkStatus?.missingScopes ?? [];
  const larkReady =
    Boolean(larkStatus?.authorized) && baseMissingScopes.length === 0;

  useEffect(() => {
    if (!desktop) {
      return;
    }
    void desktop.getUpdateSnapshot().then(setUpdate);
    return desktop.onUpdateState(setUpdate);
  }, [desktop]);

  async function installIntegration() {
    if (!desktop) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      setStatus(await desktop.installTraeIntegration());
      onRefreshTrae();
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "无法生成 TRAE 集成配置",
      );
    } finally {
      setBusy(false);
    }
  }

  async function finishSetup() {
    if (!desktop) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      setStatus(await desktop.completeSetup());
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function updateUeConnection() {
    if (!desktop) {
      return;
    }
    const port = Number(uePort);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setError("UE MCP 端口必须是 1-65535 的整数");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nextStatus = await desktop.setUeMcpPort(port);
      setStatus(nextStatus);
      setUePort(String(nextStatus.ueMcpPort));
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "无法更新 UE MCP 端口",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop desktop-setup-backdrop" role="presentation">
      <section
        className="desktop-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-setup-title"
      >
        <header>
          <div>
            <small>{status.firstRun ? "首次启动" : "桌面版设置"}</small>
            <h2 id="desktop-setup-title">运行环境与数据协作</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="关闭"
            aria-label="关闭桌面版设置"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <div className="desktop-setup-modal__body">
          <section className="setup-status-list" aria-label="环境检查">
            <div>
              <Check size={17} />
              <span>
                <strong>应用运行时</strong>
                <small>已内置，无需安装 Node.js 或 npm</small>
              </span>
            </div>
            <div className={status.defaultDataReady ? "" : "is-warning"}>
              {status.defaultDataReady ? (
                <Check size={17} />
              ) : (
                <CircleAlert size={17} />
              )}
              <span>
                <strong>对话数据</strong>
                <small>
                  {status.defaultDataReady
                    ? "已找到 C:\\trunk\\doc\\csvdir"
                    : "未找到默认目录，可进入应用后手动选择 doc 文件夹"}
                </small>
              </span>
            </div>
            <div className={larkReady ? "" : "is-warning"}>
              {larkLoading ? (
                <LoaderCircle className="spin" size={17} />
              ) : larkReady ? (
                <Database size={17} />
              ) : (
                <CircleAlert size={17} />
              )}
              <span>
                <strong>飞书数据</strong>
                <small>
                  {larkLoading
                    ? "正在检查登录和多维表格权限"
                    : larkError
                      ? larkError
                      : larkReady
                        ? `已连接 ${larkStatus?.userName || "当前用户"}，可使用共享方案和返修案例`
                        : larkStatus?.authorized
                          ? `已登录，但缺少 ${baseMissingScopes.length} 项多维表格权限`
                          : "首次使用请登录，用于共享方案和返修案例"}
                </small>
              </span>
              <button
                type="button"
                disabled={larkLoading}
                onClick={larkReady ? onRefreshLark : onAuthorize}
              >
                {larkLoading ? (
                  <LoaderCircle className="spin" size={14} />
                ) : larkReady ? (
                  <RefreshCw size={14} />
                ) : (
                  <LogIn size={14} />
                )}
                {larkReady ? "刷新" : "登录"}
              </button>
            </div>
            <div className={status.traeDetected ? "" : "is-warning"}>
              {status.traeDetected ? (
                <Check size={17} />
              ) : (
                <CircleAlert size={17} />
              )}
              <span>
                <strong>TRAE</strong>
                <small>
                  {status.traeDetected
                    ? "已检测到 TRAE"
                    : "未检测到 TRAE，规则导演仍可独立使用"}
                </small>
              </span>
              {!status.traeDetected && (
                <button
                  type="button"
                  onClick={() => void desktop?.openTraeDownload()}
                >
                  <ExternalLink size={14} />
                  下载
                </button>
              )}
            </div>
            <div className={status.mcpConnected ? "" : "is-warning"}>
              {status.mcpConnected ? (
                <Check size={17} />
              ) : (
                <CircleAlert size={17} />
              )}
              <span>
                <strong>分镜 MCP</strong>
                <small>
                  {status.mcpConnected
                    ? `已连接 v${status.mcpVersion}`
                    : status.integrationInstalled
                      ? `配置已生成，等待 TRAE 启用 v${status.expectedMcpVersion}`
                      : "尚未生成桌面版集成配置"}
                </small>
              </span>
            </div>
            <div className={status.ueConnected ? "" : "is-warning"}>
              {status.ueConnected ? (
                <Check size={17} />
              ) : (
                <CircleAlert size={17} />
              )}
              <span>
                <strong>UE 编辑器</strong>
                <small title={status.ueConnectionMessage}>
                  {status.ueConnected
                    ? status.ueConnectionMessage
                    : `未连接 OmniMcpCore（${status.ueMcpHost}:${status.ueMcpPort}）`}
                </small>
              </span>
              <div className="setup-port-control">
                <input
                  type="number"
                  min={1}
                  max={65_535}
                  value={uePort}
                  aria-label="UE MCP 端口"
                  onChange={(event) => setUePort(event.target.value)}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void updateUeConnection()}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <PlugZap size={14} />
                  )}
                  检测
                </button>
              </div>
            </div>
          </section>

          <section className="setup-instructions">
            <h3>首次配置</h3>
            <ol>
              <li>登录飞书，连接共享方案与返修案例库。</li>
              <li>生成独立的 TRAE 集成目录。</li>
              <li>在 TRAE 中打开该目录，并启用项目 MCP 与 Skill。</li>
              <li>启动 UE 编辑器并确认 OmniMcpCore 端口检测通过。</li>
            </ol>
            <p>应用每次启动都会同步内置 Skill；TRAE 已打开时请重载窗口。</p>
            <code title={status.integrationRoot}>{status.integrationRoot}</code>
            <div className="setup-actions">
              <button
                className="button button--primary"
                type="button"
                disabled={busy}
                onClick={() => void installIntegration()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <FolderCog size={16} />
                )}
                {status.integrationInstalled
                  ? "同步配置与 Skill"
                  : "生成 TRAE 配置"}
              </button>
              <button
                className="button"
                type="button"
                disabled={!status.integrationInstalled}
                onClick={() => void desktop?.openIntegrationFolder()}
              >
                <ExternalLink size={15} />
                打开配置目录
              </button>
            </div>
          </section>

          <section className="setup-update">
            <div>
              <h3>在线升级</h3>
              <p>
                {status.portable
                  ? "便携版可检查新版本并打开下载页；安装版支持下载后重启安装。"
                  : "安装版会定期检查更新，并在下载完成后提示重启安装。"}
              </p>
              <small>{updateLabel(update)}</small>
            </div>
            <button
              className="button"
              type="button"
              disabled={
                update.state === "checking" ||
                update.state === "downloading"
              }
              onClick={() => {
                if (update.state === "downloaded") {
                  void desktop?.installUpdate();
                } else {
                  void desktop?.checkForUpdates();
                }
              }}
            >
              {update.state === "checking" ||
              update.state === "downloading" ? (
                <LoaderCircle className="spin" size={15} />
              ) : update.state === "downloaded" ? (
                <Download size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
              {update.state === "downloaded" ? "重启并安装" : "检查更新"}
            </button>
          </section>

          {error && (
            <div className="inline-error" role="alert">
              <CircleAlert size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer>
          <span>规则导演无需飞书或 TRAE，也可直接使用。</span>
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => void finishSetup()}
          >
            完成设置
          </button>
        </footer>
      </section>
    </div>
  );
}
