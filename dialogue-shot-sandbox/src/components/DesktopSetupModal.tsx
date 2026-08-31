import {
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  Download,
  ExternalLink,
  FolderCog,
  FolderOpen,
  LoaderCircle,
  LogIn,
  Music2,
  PlugZap,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { SoundEffectCatalogSnapshot } from "../data/soundEffectCatalog";
import type { MusicCatalogSnapshot } from "../data/musicCatalog";
import type { LarkStatus } from "../lark/client";

interface DesktopSetupModalProps {
  initialStatus: DesktopSetupStatus;
  onClose: () => void;
  onRefreshTrae: () => void;
  larkLoading: boolean;
  larkStatus: LarkStatus | null;
  larkError: string;
  soundEffectCatalog: SoundEffectCatalogSnapshot;
  musicCatalog: MusicCatalogSnapshot;
  dataLoading: boolean;
  dataError: string;
  onChooseLiveDirectory: () => void;
  onChooseConfigDirectory: () => void;
  onAuthorize: () => void;
  onRefreshLark: () => void;
  onSyncSoundEffectCatalog: () => Promise<SoundEffectCatalogSnapshot>;
  onSyncMusicCatalog: () => Promise<MusicCatalogSnapshot>;
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

interface ReleaseNoteBlock {
  kind: "heading" | "item" | "paragraph" | "meta";
  text: string;
}

function parseReleaseNotes(markdown: string): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "---" || line.startsWith("# ")) {
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({ kind: "meta", text: line.slice(2).trim() });
      continue;
    }
    if (line.startsWith("- ")) {
      blocks.push({ kind: "item", text: line.slice(2).trim() });
      continue;
    }
    const previous = blocks.at(-1);
    if (previous && previous.kind !== "heading") {
      previous.text = `${previous.text} ${line}`;
    } else {
      blocks.push({ kind: "paragraph", text: line });
    }
  }
  return blocks;
}

function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = parseReleaseNotes(markdown);
  if (blocks.length === 0) {
    return null;
  }
  return (
    <details className="setup-update__notes">
      <summary>
        <span>查看本次更新内容</span>
        <ChevronDown size={14} />
      </summary>
      <div>
        {blocks.map((block, index) => {
          const text = block.text.replaceAll("`", "");
          if (block.kind === "heading") {
            return <h4 key={`${block.kind}-${index}`}>{text}</h4>;
          }
          if (block.kind === "meta") {
            return <small key={`${block.kind}-${index}`}>{text}</small>;
          }
          return (
            <p
              className={
                block.kind === "item" ? "setup-update__note-item" : undefined
              }
              key={`${block.kind}-${index}`}
            >
              {text}
            </p>
          );
        })}
      </div>
    </details>
  );
}

export function DesktopSetupModal({
  initialStatus,
  onClose,
  onRefreshTrae,
  larkLoading,
  larkStatus,
  larkError,
  soundEffectCatalog: initialSoundEffectCatalog,
  musicCatalog: initialMusicCatalog,
  dataLoading,
  dataError,
  onChooseLiveDirectory,
  onChooseConfigDirectory,
  onAuthorize,
  onRefreshLark,
  onSyncSoundEffectCatalog,
  onSyncMusicCatalog,
}: DesktopSetupModalProps) {
  const desktop = window.shotSandboxDesktop;
  const [status, setStatus] = useState(initialStatus);
  const [update, setUpdate] = useState<DesktopUpdateSnapshot>({
    state: "idle",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uePort, setUePort] = useState(String(initialStatus.ueMcpPort));
  const [soundEffectCatalog, setSoundEffectCatalog] = useState(
    initialSoundEffectCatalog,
  );
  const [musicCatalog, setMusicCatalog] = useState(initialMusicCatalog);
  const [soundEffectCatalogBusy, setSoundEffectCatalogBusy] = useState(false);
  const [soundEffectCatalogStatus, setSoundEffectCatalogStatus] = useState("");
  const [soundEffectCatalogError, setSoundEffectCatalogError] = useState("");
  const [musicCatalogBusy, setMusicCatalogBusy] = useState(false);
  const [musicCatalogStatus, setMusicCatalogStatus] = useState("");
  const [musicCatalogError, setMusicCatalogError] = useState("");
  const baseMissingScopes =
    larkStatus?.baseMissingScopes ?? larkStatus?.missingScopes ?? [];
  const docsMissingScopes =
    larkStatus?.docsMissingScopes ?? larkStatus?.missingScopes ?? [];
  const larkReady =
    Boolean(larkStatus?.authorized) && baseMissingScopes.length === 0;
  const docsReady =
    Boolean(larkStatus?.authorized) && docsMissingScopes.length === 0;

  useEffect(() => {
    if (!desktop) {
      return;
    }
    void desktop.getUpdateSnapshot().then(setUpdate);
    return desktop.onUpdateState(setUpdate);
  }, [desktop]);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    setSoundEffectCatalog(initialSoundEffectCatalog);
  }, [initialSoundEffectCatalog]);

  useEffect(() => {
    setMusicCatalog(initialMusicCatalog);
  }, [initialMusicCatalog]);

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

  async function updateSoundEffectCatalog() {
    if (!docsReady) {
      onAuthorize();
      return;
    }
    setSoundEffectCatalogBusy(true);
    setSoundEffectCatalogStatus("");
    setSoundEffectCatalogError("");
    try {
      const snapshot = await onSyncSoundEffectCatalog();
      setSoundEffectCatalog(snapshot);
      setSoundEffectCatalogStatus(
        `已同步 ${snapshot.entries.length} 项，文档版本 ${snapshot.revisionId}`,
      );
    } catch (catalogSyncError) {
      setSoundEffectCatalogError(
        catalogSyncError instanceof Error
          ? catalogSyncError.message
          : "音效资料库同步失败",
      );
    } finally {
      setSoundEffectCatalogBusy(false);
    }
  }

  async function updateMusicCatalog() {
    setMusicCatalogBusy(true);
    setMusicCatalogStatus("");
    setMusicCatalogError("");
    try {
      const snapshot = await onSyncMusicCatalog();
      setMusicCatalog(snapshot);
      setMusicCatalogStatus(`已同步 ${snapshot.entries.length} 首音乐`);
    } catch (error) {
      setMusicCatalogError(
        error instanceof Error ? error.message : "音乐资料库同步失败",
      );
    } finally {
      setMusicCatalogBusy(false);
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
            <small>桌面版设置</small>
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
            <div className="setup-status-item--wide">
              <Check size={17} />
              <span>
                <strong>应用运行时</strong>
                <small>已内置，无需安装 Node.js 或 npm</small>
              </span>
            </div>
            <div
              className={
                (status.liveDataReady ?? status.defaultDataReady)
                  ? ""
                  : "is-warning"
              }
            >
              {(status.liveDataReady ?? status.defaultDataReady) ? (
                <Check size={17} />
              ) : (
                <CircleAlert size={17} />
              )}
              <span>
                <strong>res 实时数据</strong>
                <small>
                  {status.liveResDirectory ||
                    "选择项目 res 目录，固定读取 Content\\Seria\\Tables\\csvdir"}
                </small>
              </span>
              <button
                type="button"
                aria-label="选择 res 目录"
                disabled={dataLoading}
                onClick={onChooseLiveDirectory}
              >
                {dataLoading ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <FolderOpen size={14} />
                )}
                {dataLoading ? "读取中" : "选择 res"}
              </button>
            </div>
            <div
              className={
                (status.configDataReady ?? status.defaultDataReady)
                  ? ""
                  : "is-warning"
              }
            >
              {(status.configDataReady ?? status.defaultDataReady) ? (
                <Check size={17} />
              ) : (
                <CircleAlert size={17} />
              )}
              <span>
                <strong>doc 配置文档</strong>
                <small>
                  {status.configDocDirectory ||
                    "选择项目 doc 目录，固定读取 csvdir"}
                </small>
                {status.missionTargetTablePath && (
                  <small title={status.missionTargetTablePath}>
                    目标物表：{status.missionTargetTablePath}
                  </small>
                )}
              </span>
              <button
                type="button"
                aria-label="选择 doc 目录"
                disabled={dataLoading}
                onClick={onChooseConfigDirectory}
              >
                {dataLoading ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <FolderOpen size={14} />
                )}
                {dataLoading ? "读取中" : "选择 doc"}
              </button>
            </div>
            <div
              className={`setup-status-item--wide ${
                larkReady ? "" : "is-warning"
              }`}
            >
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
            <div className={docsReady ? "" : "is-warning"}>
              {soundEffectCatalogBusy ? (
                <LoaderCircle className="spin" size={17} />
              ) : docsReady ? (
                <Database size={17} />
              ) : (
                <CircleAlert size={17} />
              )}
              <span>
                <strong>音效资料库</strong>
                <small aria-live="polite">
                  {soundEffectCatalogBusy
                    ? "正在从飞书文档同步"
                    : soundEffectCatalogError
                      ? soundEffectCatalogError
                      : soundEffectCatalogStatus ||
                        `${soundEffectCatalog.entries.length} 项 · ${
                          soundEffectCatalog.source === "lark"
                            ? `飞书版本 ${soundEffectCatalog.revisionId}`
                            : "内置版本"
                        }`}
                </small>
              </span>
              <button
                type="button"
                aria-label={
                  docsReady ? "从飞书同步音效资料库" : "授权音效资料库"
                }
                disabled={soundEffectCatalogBusy || larkLoading}
                onClick={() => void updateSoundEffectCatalog()}
              >
                {soundEffectCatalogBusy ? (
                  <LoaderCircle className="spin" size={14} />
                ) : docsReady ? (
                  <RefreshCw size={14} />
                ) : (
                  <LogIn size={14} />
                )}
                {docsReady ? "同步" : "授权"}
              </button>
            </div>
            <div className={larkReady ? "" : "is-warning"}>
              {musicCatalogBusy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Music2 size={17} />
              )}
              <span>
                <strong>音乐资料库</strong>
                <small aria-live="polite">
                  {musicCatalogBusy
                    ? "正在从飞书多维表格同步"
                    : musicCatalogError
                      ? musicCatalogError
                      : musicCatalogStatus ||
                        `${
                          musicCatalog.entries.length > 0
                            ? `${musicCatalog.entries.length} 首${
                                musicCatalog.analyzedCount > 0
                                  ? ` · ${musicCatalog.analyzedCount} 首已分析`
                                  : ""
                              } · 版本 ${musicCatalog.revision}`
                            : "尚未同步"
                        }${
                          musicCatalog.unmappedCount > 0
                            ? ` · ${musicCatalog.unmappedCount} 条未映射`
                            : ""
                        }`}
                </small>
              </span>
              <button
                type="button"
                aria-label="从飞书同步音乐资料库"
                title={
                  larkReady
                    ? "从飞书多维表格同步音乐资料库"
                    : "需先完成飞书多维表格授权"
                }
                disabled={musicCatalogBusy || !larkReady}
                onClick={() => void updateMusicCatalog()}
              >
                {musicCatalogBusy ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <RefreshCw size={14} />
                )}
                同步
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
            <div
              className={`setup-status-item--wide ${
                status.ueConnected ? "" : "is-warning"
              }`}
            >
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

          <section
            className="setup-instructions"
            aria-label="TRAE 集成"
          >
            <h3>TRAE 集成</h3>
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
            <div className="setup-update__summary">
              <h3>在线升级</h3>
              <p>
                {status.portable
                  ? "便携版会自动下载更新；下载完成后可直接重启并安装。"
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
            {update.releaseNotes && (
              <ReleaseNotes markdown={update.releaseNotes} />
            )}
          </section>

          {(error || dataError) && (
            <div className="inline-error" role="alert">
              <CircleAlert size={16} />
              <span>{dataError || error}</span>
            </div>
          )}
        </div>

        <footer>
          <span>规则导演无需飞书或 TRAE，也可直接使用。</span>
          <button
            className="button button--primary"
            type="button"
            onClick={onClose}
          >
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
