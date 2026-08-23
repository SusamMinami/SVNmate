import {
  AlertTriangle,
  Bot,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  LocateFixed,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { DesktopSetupModal } from "./components/DesktopSetupModal";
import { DirectorControl } from "./components/DirectorControl";
import { SharedPlanCompareModal } from "./components/SharedPlanCompareModal";
import { StageView } from "./components/StageView";
import { StoryBriefModal } from "./components/StoryBriefModal";
import { TraeCollaborationModal } from "./components/TraeCollaborationModal";
import { loadDocDirectory, loadDocFiles } from "./data/csv";
import { demoDatabase } from "./data/demo";
import { findDialogueSequence } from "./data/dialogueRepository";
import type {
  DirectorBlocking,
  DirectorMode,
  DirectorSceneAnalysis,
} from "./director/contracts";
import {
  createSharedPlanPreview,
  designShots,
  type DirectorRunResult,
} from "./director/orchestrator";
import { createShotPreview } from "./director/shotPlanner";
import {
  discoverMira,
  finishLarkAuthorization,
  getLarkStatus,
  startLarkAuthorization,
  type LarkAuthChallenge,
  type LarkStatus,
} from "./lark/client";
import {
  getTraeMcpConfig,
  getTraeStatus,
  resolveSharedStoryboardConflict,
  type TraeCollaborationStatus,
  type TraeMcpConfig,
} from "./trae/client";
import type {
  CameraMovement,
  DepthOfField,
  DialogueDatabase,
  DialogueSequence,
  CompositionMode,
  CompositionTransition,
  CoverageIntent,
  LensIntent,
  MovementIntensity,
  ShotCoverage,
  ShotPlan,
  ShotSize,
} from "./types";

function buildSequence(database: DialogueDatabase, prefix: string) {
  const sequence = findDialogueSequence(database, prefix);
  return createShotPreview(sequence);
}

const initial = buildSequence(demoDatabase, "2048");

interface PendingDirectorPresentation {
  sequence: DialogueSequence;
  result: DirectorRunResult;
}

interface SharedComparisonPresentation {
  recordId: string;
  local: PendingDirectorPresentation;
  shared: PendingDirectorPresentation;
}

function directorLabel(mode: DirectorMode): string {
  if (mode === "trae") {
    return "内部 TRAE";
  }
  return mode === "mira" ? "Mira AI" : "规则导演";
}

function formationLabel(formation: DirectorBlocking["formation"]): string {
  const labels: Record<DirectorBlocking["formation"], string> = {
    arc: "浅弧展开",
    triangle: "三角关系",
    cluster: "集中群组",
    opposed_groups: "对峙分组",
    leader_front: "主导者前置",
  };
  return labels[formation];
}

function shotSizeLabel(shotSize: ShotSize): string {
  const labels: Record<ShotSize, string> = {
    full: "全景",
    "medium-full": "中全景",
    medium: "中景",
    "medium-close-up": "中近景",
    "close-up": "近景",
    "extreme-close-up": "特写",
  };
  return labels[shotSize];
}

function shotCoverageLabel(coverage: ShotCoverage): string {
  const labels: Record<ShotCoverage, string> = {
    single: "洁净单人",
    "over-the-shoulder": "过肩",
    "two-shot": "双人",
    group: "群像",
    "group-medium": "带群",
  };
  return labels[coverage];
}

function compositionModeLabel(mode: CompositionMode): string {
  const labels: Record<CompositionMode, string> = {
    center: "中心构图",
    rule_of_thirds: "三分法",
    golden_ratio: "黄金分割",
    symmetry: "对称构图",
    asymmetrical_balance: "不对称平衡",
    triangular: "三角构图",
    negative_space: "负空间",
    layered_depth: "纵深层次",
  };
  return labels[mode];
}

function compositionTransitionLabel(
  transition: CompositionTransition,
): string {
  const labels: Record<CompositionTransition, string> = {
    recenter: "重建中心",
    match_eye_trace: "注视点匹配",
    mirror_reverse: "左右互补",
    progressive_shift: "渐进转移",
    contrast: "对比切换",
  };
  return labels[transition];
}

function coverageIntentLabel(intent: CoverageIntent): string {
  const labels: Record<CoverageIntent, string> = {
    establish_geography: "建立空间",
    reestablish_geography: "重建空间",
    relationship: "人物关系",
    shared_reaction: "共同反应",
    individual_perspective: "个人视角",
    individual_emphasis: "个人强调",
    reaction: "关键反应",
  };
  return labels[intent];
}

function cameraMovementLabel(movement: CameraMovement): string {
  const labels: Record<CameraMovement, string> = {
    static: "固定机位",
    pan: "水平摇摄",
    tracking: "跟随移动",
    dolly_in: "推近",
    dolly_out: "拉远",
    zoom_in: "光学拉近",
    zoom_out: "光学拉远",
    dolly_zoom_in: "推进变焦",
    dolly_zoom_out: "后拉变焦",
  };
  return labels[movement];
}

function movementIntensityLabel(intensity: MovementIntensity): string {
  const labels: Record<MovementIntensity, string> = {
    none: "无",
    subtle: "轻微",
    moderate: "中等",
    strong: "强烈",
  };
  return labels[intensity];
}

function lensIntentLabel(intent: LensIntent): string {
  const labels: Record<LensIntent, string> = {
    spatial_context: "空间交代",
    natural_perspective: "自然透视",
    subject_isolation: "主体分离",
    compressed_intimacy: "压缩亲密",
    perspective_distortion: "透视夸张",
  };
  return labels[intent];
}

function depthOfFieldLabel(depthOfField: DepthOfField): string {
  const labels: Record<DepthOfField, string> = {
    deep: "深景深",
    moderate: "中等景深",
    shallow: "浅景深",
  };
  return labels[depthOfField];
}

function negativeSpaceLabel(
  mode: ShotPlan["compositionPlan"]["negativeSpace"],
): string {
  const labels: Record<
    ShotPlan["compositionPlan"]["negativeSpace"],
    string
  > = {
    balanced: "均衡空间",
    look_room: "前向视线空间",
    isolation: "孤立留白",
    pressure: "短边压迫",
  };
  return labels[mode];
}

function blockingPositionLabel(
  position: DirectorBlocking["placements"][number]["position"],
): string {
  const labels: Record<
    DirectorBlocking["placements"][number]["position"],
    string
  > = {
    front_center: "前排中央",
    front_left: "前排左侧",
    front_right: "前排右侧",
    mid_center: "中排中央",
    mid_left: "中排左侧",
    mid_right: "中排右侧",
    back_center: "后排中央",
    back_left: "后排左侧",
    back_right: "后排右侧",
    far_left: "外围左侧",
    far_right: "外围右侧",
    rear_center: "纵深后方",
  };
  return labels[position];
}

export default function App() {
  const [database, setDatabase] = useState(demoDatabase);
  const [query, setQuery] = useState("2048");
  const [sequence, setSequence] = useState<DialogueSequence>(initial.sequence);
  const [shots, setShots] = useState<ShotPlan[]>(initial.shots);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [directorMode, setDirectorMode] = useState<DirectorMode>("rule");
  const [appliedDirector, setAppliedDirector] =
    useState<DirectorMode>("rule");
  const [directorLoading, setDirectorLoading] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [directorAnalysis, setDirectorAnalysis] =
    useState<DirectorSceneAnalysis | undefined>(initial.analysis);
  const [directorBlocking, setDirectorBlocking] =
    useState<DirectorBlocking>(initial.blocking);
  const [pendingDirectorResult, setPendingDirectorResult] =
    useState<PendingDirectorPresentation | null>(null);
  const [sharedComparison, setSharedComparison] =
    useState<SharedComparisonPresentation | null>(null);
  const [sharedComparisonBusy, setSharedComparisonBusy] = useState(false);
  const [sharedComparisonError, setSharedComparisonError] = useState("");
  const [desktopSetup, setDesktopSetup] =
    useState<DesktopSetupStatus | null>(null);
  const [showDesktopSetup, setShowDesktopSetup] = useState(false);
  const [traeStatus, setTraeStatus] =
    useState<TraeCollaborationStatus | null>(null);
  const [traeLoading, setTraeLoading] = useState(false);
  const [traeError, setTraeError] = useState("");
  const [traeConfig, setTraeConfig] = useState<TraeMcpConfig | null>(null);
  const [larkStatus, setLarkStatus] = useState<LarkStatus | null>(null);
  const [larkLoading, setLarkLoading] = useState(false);
  const [larkError, setLarkError] = useState("");
  const [authStart, setAuthStart] = useState<LarkAuthChallenge | null>(null);
  const [authFinishing, setAuthFinishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directorRunRef = useRef(0);
  const authFinishingRef = useRef(false);

  const activeShot = shots[activeIndex] ?? shots[0];
  const sourceStats = useMemo(
    () => ({
      dialogues: database.dialogueRows.length,
      npcs: database.npcs.size,
    }),
    [database],
  );
  const participantColorsBySlot = useMemo(
    () =>
      new Map(
        sequence.participants.map((participant) => [
          participant.slot,
          participant.color,
        ]),
      ),
    [sequence.participants],
  );

  useEffect(() => {
    void refreshTraeConnection();
    void refreshLarkConnection(false);
    if (window.shotSandboxDesktop) {
      void window.shotSandboxDesktop.getSetupStatus().then((status) => {
        setDesktopSetup(status);
        setShowDesktopSetup(status.firstRun);
      });
    }
  }, []);

  async function refreshTraeConnection() {
    setTraeLoading(true);
    setTraeError("");
    try {
      setTraeStatus(await getTraeStatus());
    } catch (connectionError) {
      setTraeError(
        connectionError instanceof Error
          ? connectionError.message
          : "TRAE 连接检查失败",
      );
    } finally {
      setTraeLoading(false);
    }
  }

  async function setupTrae() {
    setTraeLoading(true);
    setTraeError("");
    try {
      setTraeConfig(await getTraeMcpConfig());
    } catch (configError) {
      setTraeError(
        configError instanceof Error
          ? configError.message
          : "无法读取内部 TRAE MCP 配置",
      );
    } finally {
      setTraeLoading(false);
    }
  }

  async function refreshLarkConnection(discover: boolean) {
    setLarkLoading(true);
    setLarkError("");
    try {
      const status = await getLarkStatus();
      if (
        discover &&
        status.authorized &&
        status.missingScopes.length === 0
      ) {
        const discovery = await discoverMira();
        status.miraBot = discovery.selected;
      }
      setLarkStatus(status);
    } catch (connectionError) {
      setLarkError(
        connectionError instanceof Error
          ? connectionError.message
          : "飞书连接检查失败",
      );
    } finally {
      setLarkLoading(false);
    }
  }

  async function applySequence(
    nextSequence: DialogueSequence,
    requestedMode: DirectorMode,
  ) {
    const runId = ++directorRunRef.current;
    const preview = createShotPreview(nextSequence);
    setSequence(preview.sequence);
    setShots(preview.shots);
    setAppliedDirector("rule");
    setFallbackReason(null);
    setDirectorAnalysis(preview.analysis);
    setDirectorBlocking(preview.blocking);
    setPendingDirectorResult(null);
    setSharedComparison(null);
    setSharedComparisonError("");
    setActiveIndex(0);
    setError("");

    if (requestedMode === "rule") {
      setDirectorLoading(false);
      return;
    }

    setDirectorLoading(true);
    try {
      const result = await designShots(nextSequence, requestedMode);
      if (runId !== directorRunRef.current) {
        return;
      }
      if (
        result.appliedMode === "trae" &&
        result.sharedConflict &&
        result.rawPlan
      ) {
        try {
          const shared = createSharedPlanPreview(
            result.sharedConflict.input,
            result.sharedConflict.plan,
          );
          setSharedComparison({
            recordId: result.sharedConflict.recordId,
            local: {
              sequence: {
                ...nextSequence,
                participants: result.participants,
              },
              result,
            },
            shared,
          });
        } catch {
          setPendingDirectorResult({ sequence: nextSequence, result });
          setError("共享方案与当前对话结构不兼容，已保留本地方案");
        }
      } else if (
        result.appliedMode === requestedMode &&
        result.analysis
      ) {
        setPendingDirectorResult({ sequence: nextSequence, result });
      } else {
        applyDirectorResult(nextSequence, result);
      }
      if (requestedMode === "mira") {
        void refreshLarkConnection(result.appliedMode === "mira");
      } else if (requestedMode === "trae") {
        void refreshTraeConnection();
      }
    } finally {
      if (runId === directorRunRef.current) {
        setDirectorLoading(false);
      }
    }
  }

  function applyDirectorResult(
    sourceSequence: DialogueSequence,
    result: DirectorRunResult,
  ) {
    setSequence({
      ...sourceSequence,
      participants: result.participants,
    });
    setShots(result.shots);
    setAppliedDirector(result.appliedMode);
    setFallbackReason(result.fallbackReason);
    setDirectorAnalysis(result.analysis);
    setDirectorBlocking(result.blocking);
    setActiveIndex(0);
    setError("");
  }

  async function chooseSharedPlan(choice: "local" | "shared") {
    if (!sharedComparison) {
      return;
    }
    const selected =
      choice === "local" ? sharedComparison.local : sharedComparison.shared;
    if (!selected.result.rawPlan) {
      setSharedComparisonError("选中方案缺少可保存的原始数据");
      return;
    }
    setSharedComparisonBusy(true);
    setSharedComparisonError("");
    try {
      await resolveSharedStoryboardConflict(
        choice,
        sharedComparison.recordId,
        selected.result.input,
        selected.result.rawPlan,
      );
      applyDirectorResult(selected.sequence, selected.result);
      setSharedComparison(null);
    } catch (selectionError) {
      setSharedComparisonError(
        selectionError instanceof Error
          ? selectionError.message
          : "无法保存共享方案选择",
      );
    } finally {
      setSharedComparisonBusy(false);
    }
  }

  async function applySearch(
    nextDatabase: DialogueDatabase,
    prefix: string,
    requestedMode = directorMode,
  ) {
    const nextSequence = findDialogueSequence(nextDatabase, prefix);
    await applySequence(nextSequence, requestedMode);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    void applySearch(database, query).catch((searchError) => {
      setError(searchError instanceof Error ? searchError.message : "查询失败");
      setDirectorLoading(false);
    });
  }

  async function useDatabase(nextDatabase: DialogueDatabase) {
    const firstPrefix = nextDatabase.starts[0]?.id.slice(0, 4);
    if (!firstPrefix) {
      throw new Error("开始节点表中没有可用的四位数对话 ID");
    }
    setDatabase(nextDatabase);
    setQuery(firstPrefix);
    await applySearch(nextDatabase, firstPrefix);
  }

  function changeDirectorMode(mode: DirectorMode) {
    setDirectorMode(mode);
    setFallbackReason(null);
    if (mode === "mira") {
      void refreshLarkConnection(true);
    } else if (mode === "trae") {
      void refreshTraeConnection();
    } else {
      void applySequence(sequence, "rule");
    }
  }

  async function beginAuthorization() {
    setLarkLoading(true);
    setLarkError("");
    try {
      const result = await startLarkAuthorization();
      if ("alreadyAuthorized" in result) {
        setLarkStatus(result.status);
        setAuthStart(null);
        return;
      }
      setAuthStart(result);
    } catch (authorizationError) {
      setLarkError(
        authorizationError instanceof Error
          ? authorizationError.message
          : "无法发起飞书授权",
      );
    } finally {
      setLarkLoading(false);
    }
  }

  async function finishAuthorization() {
    if (authFinishingRef.current) {
      return;
    }
    authFinishingRef.current = true;
    setAuthFinishing(true);
    try {
      const status = await finishLarkAuthorization();
      const discovery =
        status.missingScopes.length === 0 ? await discoverMira() : null;
      status.miraBot = discovery?.selected ?? null;
      setLarkStatus(status);
      setLarkError("");
      setAuthStart(null);
    } catch (authorizationError) {
      const message =
        authorizationError instanceof Error
          ? authorizationError.message
          : "飞书授权尚未完成";
      if (/授权码已失效|device_code is invalid/i.test(message)) {
        setAuthStart(null);
        await beginAuthorization();
        setLarkError("旧授权码已失效，已生成新的二维码，请重新扫码");
      } else {
        setLarkError(message);
      }
    } finally {
      authFinishingRef.current = false;
      setAuthFinishing(false);
    }
  }

  async function chooseDirectory() {
    if (!window.showDirectoryPicker) {
      fileInputRef.current?.click();
      return;
    }
    setLoading(true);
    try {
      const handle = await window.showDirectoryPicker({
        id: "dialogue-doc-root",
        mode: "read",
      });
      await useDatabase(await loadDocDirectory(handle));
    } catch (directoryError) {
      if (
        directoryError instanceof DOMException &&
        directoryError.name === "AbortError"
      ) {
        return;
      }
      setError(
        directoryError instanceof Error
          ? directoryError.message
          : "无法读取所选目录",
      );
    } finally {
      setLoading(false);
    }
  }

  async function importDirectory(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    setLoading(true);
    try {
      await useDatabase(await loadDocFiles(files));
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "目录读取失败");
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function moveShot(offset: number) {
    setActiveIndex((current) =>
      Math.min(shots.length - 1, Math.max(0, current + offset)),
    );
  }

  return (
    <main className="app-shell">
      <input
        ref={(element) => {
          fileInputRef.current = element;
          element?.setAttribute("webkitdirectory", "");
          element?.setAttribute("directory", "");
        }}
        className="visually-hidden"
        type="file"
        multiple
        onChange={(event) => void importDirectory(event.target.files)}
      />

      <header className="app-header">
        <div className="brand">
          <span className="brand__mark">
            <Clapperboard size={20} strokeWidth={2} />
          </span>
          <div>
            <h1>镜头沙盘</h1>
          </div>
          <span className="version">v0.15.1</span>
        </div>

        <div className="source-status">
          <span className="source-status__dot" />
          <div>
            <small>当前数据源</small>
            <strong>{database.sourceName}</strong>
          </div>
        </div>

        <div className="header-actions">
          {desktopSetup && (
            <button
              className="icon-button"
              type="button"
              title="桌面版设置与更新"
              aria-label="桌面版设置与更新"
              onClick={() => {
                void window.shotSandboxDesktop
                  ?.getSetupStatus()
                  .then((status) => {
                    setDesktopSetup(status);
                    setShowDesktopSetup(true);
                  });
              }}
            >
              <Settings size={18} />
            </button>
          )}

          <button
            className="button button--primary"
            type="button"
            onClick={() => void chooseDirectory()}
            disabled={loading}
          >
            <FolderOpen size={17} />
            {loading ? "读取中..." : "选择 doc 文件夹"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="left-panel">
          <section className="panel-section query-section">
            <div className="section-label">
              <span>对话定位</span>
              <small>
                {sourceStats.dialogues.toLocaleString()} 条台词 ·{" "}
                {sourceStats.npcs.toLocaleString()} 个 NPC
              </small>
            </div>
            <form className="query-form" onSubmit={submitSearch}>
              <label htmlFor="dialogue-id">四位数对话 ID</label>
              <div className="input-row">
                <input
                  id="dialogue-id"
                  inputMode="numeric"
                  maxLength={4}
                  value={query}
                  onChange={(event) =>
                    setQuery(event.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="例如 1001"
                />
                <button
                  className="icon-button"
                  type="submit"
                  title="查找并生成分镜"
                  aria-label="查找并生成分镜"
                  disabled={directorLoading}
                >
                  {directorLoading ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Search size={18} />
                  )}
                </button>
              </div>
            </form>
            <DirectorControl
              mode={directorMode}
              appliedMode={appliedDirector}
              loading={directorLoading}
              traeLoading={traeLoading}
              traeStatus={traeStatus}
              traeError={traeError}
              larkLoading={larkLoading}
              larkStatus={larkStatus}
              larkError={larkError}
              onModeChange={changeDirectorMode}
              onRefreshTrae={() => void refreshTraeConnection()}
              onSetupTrae={() => void setupTrae()}
              onRefreshLark={() => void refreshLarkConnection(true)}
              onAuthorize={() => void beginAuthorization()}
            />
            {error && (
              <div className="inline-error" role="alert">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}
            {fallbackReason && (
              <div className="fallback-notice" role="status">
                <Bot size={16} />
                <span>
                  {directorLabel(directorMode)} 未生效，已自动使用规则导演：
                  {fallbackReason}
                </span>
              </div>
            )}
            {directorMode === "trae" && traeError && !fallbackReason && (
              <div className="inline-error" role="status">
                <AlertTriangle size={16} />
                <span>{traeError}</span>
              </div>
            )}
            {directorMode === "mira" && larkError && !fallbackReason && (
              <div className="inline-error" role="alert">
                <AlertTriangle size={16} />
                <span>{larkError}</span>
              </div>
            )}
          </section>

          <section className="panel-section story-section">
            <div className="section-label">
              <span>剧情梗概</span>
              <small>开始节点 {sequence.startId}</small>
            </div>
            <p>{sequence.outline || "该对话没有填写剧情梗概。"}</p>
            <div className="cast-list">
              {sequence.participants.map((participant) => (
                <div className="cast-row" key={participant.id}>
                  <span
                    className="cast-row__slot"
                    style={{ backgroundColor: participant.color }}
                  >
                    {participant.slot}
                  </span>
                  <div>
                    <strong>{participant.name}</strong>
                    <small>
                      NPC {participant.id} · 登场 {participant.entryDialogueId} ·{" "}
                      离场 {participant.exitDialogueId ?? "本场结束"}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="shot-list-section">
            <div className="section-label section-label--sticky">
              <span>镜头列表</span>
              <small>
                {shots.length} 镜 ·{" "}
                {directorLoading && directorMode !== "rule"
                  ? "本地预览"
                  : directorLabel(appliedDirector)}
                {fallbackReason ? "（已降级）" : ""}
              </small>
            </div>
            <div className="shot-list">
              {shots.map((shot, index) => (
                <button
                  className={`shot-row ${index === activeIndex ? "is-active" : ""}`}
                  type="button"
                  key={shot.id}
                  onClick={() => setActiveIndex(index)}
                >
                  <span className="shot-row__number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className="shot-row__speaker"
                    data-slot={shot.speakerSlot}
                    style={{
                      backgroundColor: participantColorsBySlot.get(
                        shot.speakerSlot,
                      ),
                    }}
                  >
                    {shot.speakerSlot}
                  </span>
                  <span className="shot-row__body">
                    <strong>{shot.label}</strong>
                    <small>{shot.content}</small>
                  </span>
                  <span className="shot-row__time">{shot.duration}s</span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="viewport-panel">
          <div className="viewport-toolbar">
            <div>
              <Camera size={16} />
              <span>镜头 {String(activeIndex + 1).padStart(2, "0")}</span>
              <small>台词节点 {activeShot.dialogueId}</small>
            </div>
            <div className="axis-status">
              <LocateFixed size={15} />
              <span>
                {activeShot.axis.kind === "relationship"
                  ? `关系轴 ${activeShot.axis.id}`
                  : activeShot.axis.kind === "direction"
                    ? `视线轴 ${activeShot.axis.id}`
                    : "群像总轴"}
              </span>
            </div>
          </div>
          <StageView
            participants={sequence.participants}
            shot={activeShot}
          />
          {directorLoading && (
            <div className="director-loading" role="status">
              <LoaderCircle className="spin" size={20} />
              <div>
                <strong>
                  {directorMode === "rule"
                    ? "规则导演正在编排镜头"
                    : directorMode === "trae"
                      ? "已提交，等待内部 TRAE 处理"
                      : "Mira AI 正在分析剧情"}
                </strong>
                <small>
                  {directorMode === "trae"
                    ? "对话与本地分镜已显示，可继续浏览"
                    : directorMode === "mira"
                      ? "本地分镜已显示，AI 完成后将展示故事梗概"
                    : "正在维护动态关系轴与视线连续"}
                </small>
              </div>
            </div>
          )}
          <div className="dialogue-strip">
            <span
              className="dialogue-strip__slot"
              data-slot={activeShot.speakerSlot}
              style={{
                backgroundColor: participantColorsBySlot.get(
                  activeShot.speakerSlot,
                ),
              }}
            >
              {activeShot.speakerSlot}
            </span>
            <div>
              <strong>{activeShot.speakerName}</strong>
              <p>{activeShot.content}</p>
            </div>
          </div>
        </section>

        <aside className="right-panel">
          <section className="inspector-header">
            <div>
              <small>当前镜头</small>
              <h2>{activeShot.label}</h2>
            </div>
            <div className="shot-nav">
              <button
                className="icon-button"
                type="button"
                title="上一个镜头"
                aria-label="上一个镜头"
                disabled={activeIndex === 0}
                onClick={() => moveShot(-1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                type="button"
                title="下一个镜头"
                aria-label="下一个镜头"
                disabled={activeIndex === shots.length - 1}
                onClick={() => moveShot(1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-label">
              <span>摄影参数</span>
            </div>
            <dl className="parameter-grid">
              <div>
                <dt>镜头类型</dt>
                <dd>{activeShot.label}</dd>
              </div>
              <div>
                <dt>焦距</dt>
                <dd>
                  {activeShot.endFocalLength === activeShot.focalLength
                    ? `${activeShot.focalLength} mm`
                    : `${activeShot.focalLength} → ${activeShot.endFocalLength} mm`}
                </dd>
              </div>
              <div>
                <dt>焦段意图</dt>
                <dd>{lensIntentLabel(activeShot.lensIntent)}</dd>
              </div>
              <div>
                <dt>景深</dt>
                <dd>{depthOfFieldLabel(activeShot.depthOfField)}</dd>
              </div>
              <div>
                <dt>镜内运动</dt>
                <dd>
                  {cameraMovementLabel(activeShot.cameraMovement)}
                  {activeShot.movementIntensity === "none"
                    ? ""
                    : ` · ${movementIntensityLabel(activeShot.movementIntensity)}`}
                </dd>
              </div>
              <div>
                <dt>横滚角</dt>
                <dd>{activeShot.cameraRollDegrees.toFixed(0)}°</dd>
              </div>
              <div>
                <dt>预计时长</dt>
                <dd>{activeShot.duration} s</dd>
              </div>
              <div>
                <dt>主体</dt>
                <dd>{activeShot.speakerName}</dd>
              </div>
              <div>
                <dt>对话对象</dt>
                <dd>
                  {activeShot.lookTargetSlot
                    ? sequence.participants.find(
                        (participant) =>
                          participant.slot === activeShot.lookTargetSlot,
                      )?.name ?? activeShot.lookTargetSlot
                    : "群体中心"}
                </dd>
              </div>
              <div>
                <dt>当前轴线</dt>
                <dd>{activeShot.axis.id}</dd>
              </div>
              <div>
                <dt>实测景别</dt>
                <dd>{shotSizeLabel(activeShot.projection.measuredShotSize)}</dd>
              </div>
              <div>
                <dt>正面偏角</dt>
                <dd>
                  {activeShot.projection.subjectFaceAngle === null
                    ? "群像"
                    : `${activeShot.projection.subjectFaceAngle.toFixed(1)}°`}
                </dd>
              </div>
              <div>
                <dt>画面构成</dt>
                <dd>{shotCoverageLabel(activeShot.projection.coverage)}</dd>
              </div>
              <div>
                <dt>覆盖意图</dt>
                <dd>{coverageIntentLabel(activeShot.coverageIntent)}</dd>
              </div>
              <div>
                <dt>构图原则</dt>
                <dd>{compositionModeLabel(activeShot.compositionPlan.mode)}</dd>
              </div>
              <div>
                <dt>构图衔接</dt>
                <dd>
                  {compositionTransitionLabel(
                    activeShot.compositionPlan.transition,
                  )}
                </dd>
              </div>
              <div>
                <dt>空间策略</dt>
                <dd>
                  {negativeSpaceLabel(
                    activeShot.compositionPlan.negativeSpace,
                  )}
                </dd>
              </div>
              <div>
                <dt>视线前/后</dt>
                <dd>
                  {activeShot.projection.lookRoom === null ||
                  activeShot.projection.backRoom === null
                    ? "不适用"
                    : `${activeShot.projection.lookRoom.toFixed(2)} / ${activeShot.projection.backRoom.toFixed(2)}`}
                </dd>
              </div>
              <div>
                <dt>视觉落点</dt>
                <dd>
                  {activeShot.projection.visualAnchor
                    .map((value) => value.toFixed(2))
                    .join(", ")}
                </dd>
              </div>
              <div>
                <dt>注视点偏移</dt>
                <dd>
                  {activeShot.projection.eyeTraceDelta === null
                    ? "首镜"
                    : activeShot.projection.eyeTraceDelta.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt>投影验收</dt>
                <dd>{activeShot.projection.valid ? "通过" : "需复核"}</dd>
              </div>
            </dl>
          </section>

          <section className="inspector-section">
            <div className="section-label">
              <span>构图说明</span>
            </div>
            <p>{activeShot.composition}</p>
          </section>

          <section className="inspector-section">
            <div className="section-label">
              <span>导演意图</span>
            </div>
            <p>{activeShot.rationale}</p>
          </section>

          {activeShot.projection.warnings.length > 0 && (
            <section className="inspector-section warning-section">
              <div className="section-label">
                <span>镜头验收提示</span>
              </div>
              {activeShot.projection.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </section>
          )}

          {directorAnalysis && (
            <section className="inspector-section director-analysis">
              <div className="section-label">
                <span>全场导演分析</span>
                <small>
                  {directorLabel(appliedDirector)}
                </small>
              </div>
              <dl>
                <div>
                  <dt>戏剧目标</dt>
                  <dd>{directorAnalysis.dramaticGoal}</dd>
                </div>
                <div>
                  <dt>情绪推进</dt>
                  <dd>{directorAnalysis.emotionalProgression}</dd>
                </div>
                <div>
                  <dt>视觉策略</dt>
                  <dd>{directorAnalysis.visualStrategy}</dd>
                </div>
              </dl>
            </section>
          )}

          <section className="inspector-section blocking-analysis">
            <div className="section-label">
              <span>站位调度</span>
              <small>{formationLabel(directorBlocking.formation)}</small>
            </div>
            <p>{directorBlocking.intent}</p>
            <div className="blocking-roster">
              {directorBlocking.placements.map((placement) => {
                const participant = sequence.participants.find(
                  (item) => item.slot === placement.subject,
                );
                return (
                  <div key={placement.subject}>
                    <span
                      style={{ backgroundColor: participant?.color }}
                    >
                      {placement.subject}
                    </span>
                    <strong>{participant?.name ?? placement.subject}</strong>
                    <small title={placement.intent}>
                      {blockingPositionLabel(placement.position)} ·{" "}
                      登场 {placement.entry_dialogue_id} ·{" "}
                      离场 {placement.exit_dialogue_id ?? "本场结束"} ·{" "}
                      {placement.intent}
                    </small>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-label">
              <span>UE4 参考</span>
            </div>
            <div className="ue-reference">
              <div>
                <span>Camera</span>
                <code>
                  {activeShot.cameraPosition.map((value) => value.toFixed(2)).join(", ")}
                </code>
              </div>
              <div>
                <span>Target</span>
                <code>
                  {activeShot.cameraTarget.map((value) => value.toFixed(2)).join(", ")}
                </code>
              </div>
              {activeShot.cameraMovement !== "static" && (
                <>
                  <div>
                    <span>End Camera</span>
                    <code>
                      {activeShot.cameraEndPosition
                        .map((value) => value.toFixed(2))
                        .join(", ")}
                    </code>
                  </div>
                  <div>
                    <span>End Target</span>
                    <code>
                      {activeShot.cameraEndTarget
                        .map((value) => value.toFixed(2))
                        .join(", ")}
                    </code>
                  </div>
                </>
              )}
              <small>原型坐标为相对站位，用于构图参考，不直接等同于 UE4 世界坐标。</small>
            </div>
          </section>

          {sequence.warnings.length > 0 && (
            <section className="inspector-section warning-section">
              <div className="section-label">
                <span>数据提示</span>
              </div>
              {sequence.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </section>
          )}

          <footer className="inspector-footer">
            <Users size={15} />
            <span>支持 2-12 人动态进出场、群像站位与动态关系轴</span>
          </footer>
        </aside>
      </div>

      {sharedComparison && (
        <SharedPlanCompareModal
          local={sharedComparison.local}
          shared={sharedComparison.shared}
          busy={sharedComparisonBusy}
          error={sharedComparisonError}
          onChoose={(choice) => void chooseSharedPlan(choice)}
        />
      )}

      {pendingDirectorResult?.result.analysis && !sharedComparison && (
        <StoryBriefModal
          sequence={{
            ...pendingDirectorResult.sequence,
            participants: pendingDirectorResult.result.participants,
          }}
          analysis={pendingDirectorResult.result.analysis}
          blocking={pendingDirectorResult.result.blocking}
          source={pendingDirectorResult.result.sharedSource}
          onContinue={() => {
            applyDirectorResult(
              pendingDirectorResult.sequence,
              pendingDirectorResult.result,
            );
            setPendingDirectorResult(null);
          }}
        />
      )}

      {showDesktopSetup && desktopSetup && (
        <DesktopSetupModal
          initialStatus={desktopSetup}
          onClose={() => setShowDesktopSetup(false)}
          onRefreshTrae={() => void refreshTraeConnection()}
        />
      )}

      {traeConfig && (
        <TraeCollaborationModal
          config={traeConfig}
          onClose={() => {
            setTraeConfig(null);
            void refreshTraeConnection();
          }}
          onRefresh={() => {
            setTraeConfig(null);
            void refreshTraeConnection();
          }}
        />
      )}

      {authStart && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
          >
            <header>
              <div>
                <small>飞书增量授权</small>
                <h2 id="auth-title">连接 Mira AI 导演</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                title="关闭"
                aria-label="关闭飞书授权"
                onClick={() => setAuthStart(null)}
                disabled={authFinishing}
              >
                <X size={17} />
              </button>
            </header>
            <div className="auth-modal__body">
              <img src={authStart.qrDataUrl} alt="飞书授权二维码" />
              <div>
                <p>
                  使用飞书扫码，只授权搜索机器人和以当前用户身份发送镜头分析请求。
                </p>
                <a
                  href={authStart.verificationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  在浏览器打开授权页
                  <ExternalLink size={14} />
                </a>
                {larkError && (
                  <div className="inline-error" role="alert">
                    <AlertTriangle size={16} />
                    <span>{larkError}</span>
                  </div>
                )}
              </div>
            </div>
            <footer>
              <button
                className="button"
                type="button"
                onClick={() => setAuthStart(null)}
                disabled={authFinishing}
              >
                稍后处理
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void finishAuthorization()}
                disabled={authFinishing}
              >
                {authFinishing ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Bot size={16} />
                )}
                {authFinishing ? "正在确认..." : "我已完成授权"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
