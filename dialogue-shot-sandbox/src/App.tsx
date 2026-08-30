import {
  AlertTriangle,
  ArrowLeftRight,
  AudioLines,
  Bot,
  Boxes,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  LoaderCircle,
  LocateFixed,
  MapPinned,
  Maximize2,
  PanelRightClose,
  Pencil,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  Square,
  Upload,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import {
  FormEvent,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import packageMetadata from "../package.json";
import {
  useCharacterActionEditor,
  type CharacterActionEditorController,
} from "./app/useCharacterActionEditor";
import { useCollaborationConnections } from "./app/useCollaborationConnections";
import { useStoryboardExport } from "./app/useStoryboardExport";
import { useWorkspaceNavigation } from "./app/useWorkspaceNavigation";
import type {
  FormationOptionId,
  FormationSelectionId,
} from "./components/BlueprintFormationModal";
import type { DialogueTextEditorItem } from "./components/DialogueTextEditorModal";
import { AudioLibraryBrowser } from "./components/AudioLibraryBrowser";
import { CharacterActionEditor } from "./components/CharacterActionEditor";
import { DataSourceStatus } from "./components/DataSourceStatus";
import { DirectorControl } from "./components/DirectorControl";
import { LaunchScreen } from "./components/LaunchScreen";
import { MissingNpcModelModal } from "./components/MissingNpcModelModal";
import { MissionTargetModal } from "./components/MissionTargetModal";
import { NpcRegistrationModal } from "./components/NpcRegistrationModal";
import { MusicRecommendations } from "./components/MusicRecommendations";
import { SoundEffectRecommendations } from "./components/SoundEffectRecommendations";
import { StageView } from "./components/StageView";
import { WorkspaceStatusHub } from "./components/WorkspaceStatusHub";
import {
  findDocCsvFile,
  loadConfiguredDatabase,
  loadDocDirectory,
  loadDocFiles,
} from "./data/csvLoader";
import {
  applyBlueprintFormation,
  findMissingBlueprintNpcModels,
  type MissingBlueprintNpcModel,
} from "./data/blueprintFormation";
import { resolveDialogueCharacterStage } from "./data/characterActions";
import { demoDatabase } from "./data/demo";
import {
  participantSlotLabel,
  splitDialogueParticipants,
} from "./data/dialogueRoles";
import {
  bundledSoundEffectCatalog,
  type SoundEffectCatalogEntry,
  type SoundEffectCatalogSnapshot,
} from "./data/soundEffectCatalog";
import {
  recommendMusic,
  type MusicCatalogEntry,
  type MusicCatalogSnapshot,
  type MusicRecommendation,
} from "./data/musicCatalog";
import {
  findDialogueSequence,
  searchDialogueContent,
} from "./data/dialogueRepository";
import type {
  DirectorBlocking,
  DirectorInput,
  DirectorMode,
  DirectorSceneAnalysis,
  DirectorSoundEffectRecommendation,
} from "./director/contracts";
import {
  createSharedPlanPreview,
  designShots,
  type DirectorRunResult,
} from "./director/orchestrator";
import { participantFacingYawDegrees } from "./director/actorActionPlanner";
import { createShotPreview } from "./director/shotPlanner";
import { estimateShotDuration } from "./director/shotTiming";
import {
  getMusicCatalog,
  getSoundEffectCatalog,
  syncMusicCatalog,
  syncSoundEffectCatalog,
} from "./lark/client";
import {
  resolveSharedStoryboardConflict,
} from "./trae/client";
import {
  getBlueprintFormation,
  updateDialogueContent,
  updateDialogueContents,
} from "./ue/client";
import type {
  BlueprintFormationSnapshot,
  CameraMovement,
  DepthOfField,
  DialogueContentUpdateRequest,
  DialogueContentSearchContext,
  DialogueContentSearchResult,
  DialogueDatabase,
  DialogueRow,
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

const LazyBlueprintFormationModal = lazy(() =>
  import("./components/BlueprintFormationModal").then((module) => ({
    default: module.BlueprintFormationModal,
  })),
);
const LazyDesktopFirstRunModal = lazy(() =>
  import("./components/DesktopFirstRunModal").then((module) => ({
    default: module.DesktopFirstRunModal,
  })),
);
const LazyDesktopSetupModal = lazy(() =>
  import("./components/DesktopSetupModal").then((module) => ({
    default: module.DesktopSetupModal,
  })),
);
const LazyDialogueTextEditorModal = lazy(() =>
  import("./components/DialogueTextEditorModal").then((module) => ({
    default: module.DialogueTextEditorModal,
  })),
);
const LazySharedPlanCompareModal = lazy(() =>
  import("./components/SharedPlanCompareModal").then((module) => ({
    default: module.SharedPlanCompareModal,
  })),
);
const LazyStoryboardExportModal = lazy(() =>
  import("./components/StoryboardExportModal").then((module) => ({
    default: module.StoryboardExportModal,
  })),
);
const LazyTraeCollaborationModal = lazy(() =>
  import("./components/TraeCollaborationModal").then((module) => ({
    default: module.TraeCollaborationModal,
  })),
);
const MemoizedMissionTargetModal = memo(MissionTargetModal);
const MemoizedNpcRegistrationModal = memo(NpcRegistrationModal);

function buildSequence(
  database: DialogueDatabase,
  prefix: string,
  soundEffectCatalog = bundledSoundEffectCatalog().entries,
) {
  const sequence = findDialogueSequence(database, prefix);
  return createShotPreview(sequence, { soundEffectCatalog });
}

const initialSoundEffectCatalog = bundledSoundEffectCatalog();
const initial = buildSequence(
  demoDatabase,
  "2048",
  initialSoundEffectCatalog.entries,
);
const emptySequence: DialogueSequence = {
  prefix: "",
  startId: "",
  outline: "",
  rows: [],
  ignoredDialogueNodeCount: 0,
  participants: [],
  adjacentContext: {
    previous: null,
    next: null,
  },
  warnings: [],
  formation: null,
};
const APP_VERSION = `v${packageMetadata.version}`;
const LAUNCH_SCREEN_STORAGE_KEY = "shot-sandbox.launch-screen-seen";

function rootDirectoryFromFile(
  filePath: string,
  relativeFilePath: string,
): string {
  const normalizedPath = filePath.replaceAll("/", "\\");
  const normalizedSuffix = `\\${relativeFilePath.replaceAll("/", "\\")}`;
  if (
    !normalizedPath.toLowerCase().endsWith(normalizedSuffix.toLowerCase())
  ) {
    throw new Error(`所选目录不符合项目结构：缺少 ${relativeFilePath}`);
  }
  return normalizedPath.slice(0, -normalizedSuffix.length);
}

interface PendingDirectorPresentation {
  sequence: DialogueSequence;
  result: DirectorRunResult;
  reviewFormation?: boolean;
}

interface SharedComparisonPresentation {
  recordId: string;
  local: PendingDirectorPresentation;
  shared: PendingDirectorPresentation;
}

interface FormationChoicePresentation {
  blueprint: ReturnType<typeof createShotPreview>;
  blueprintPlayerLocked: ReturnType<typeof createShotPreview>;
  generated: ReturnType<typeof createShotPreview>;
  ai?: PendingDirectorPresentation;
  snapshot: BlueprintFormationSnapshot;
  mappedSlotCount: number;
  requestedMode: DirectorMode;
  sourceSequence: DialogueSequence;
  playerPositionLocked: boolean;
  ignoredNpcCount: number;
}

interface MissingNpcModelReview {
  database: DialogueDatabase;
  sourceSequence: DialogueSequence;
  snapshot: BlueprintFormationSnapshot;
  requestedMode: DirectorMode;
  issues: MissingBlueprintNpcModel[];
  ignoredNpcIds: Set<number>;
  error: string;
}

function createFormationChoice(
  database: DialogueDatabase,
  sourceSequence: DialogueSequence,
  snapshot: BlueprintFormationSnapshot,
  requestedMode: DirectorMode,
  soundEffectCatalog: SoundEffectCatalogSnapshot["entries"],
  ai?: PendingDirectorPresentation,
  playerPositionLocked = false,
  ignoredNpcIds: ReadonlySet<number> = new Set(),
): FormationChoicePresentation {
  const imported = applyBlueprintFormation(
    database,
    sourceSequence,
    snapshot,
    { ignoredNpcIds },
  );
  return {
    blueprint: createShotPreview(imported.sequence, {
      preserveInputPositions: true,
      lockPlayerPosition: false,
      soundEffectCatalog,
    }),
    blueprintPlayerLocked: createShotPreview(imported.sequence, {
      preserveInputPositions: true,
      lockPlayerPosition: true,
      soundEffectCatalog,
    }),
    generated: createShotPreview(sourceSequence, { soundEffectCatalog }),
    ai,
    snapshot,
    mappedSlotCount: imported.mappedSlotCount,
    requestedMode,
    sourceSequence,
    playerPositionLocked,
    ignoredNpcCount: ignoredNpcIds.size,
  };
}

interface ApplySequenceOptions {
  preserveInputPositions?: boolean;
  lockPlayerPosition?: boolean;
  fallbackPreserveInputPositions?: boolean;
  keepCurrentPreview?: boolean;
  forceRegenerate?: boolean;
  preserveActiveShot?: boolean;
  keepBackgroundRequest?: boolean;
  applyResultImmediately?: boolean;
}

type InspectorTab = "direction" | "shot" | "audio" | "ue";

interface CachedStoryboard {
  sequence: DialogueSequence;
  shots: ShotPlan[];
  appliedDirector: DirectorMode;
  directorAnalysis: DirectorSceneAnalysis | undefined;
  soundEffects: DirectorSoundEffectRecommendation[];
  directorBlocking: DirectorBlocking;
  activeFormationSource: "blueprint" | "generated";
  activeFormationVariant: FormationOptionId;
  formationStatus: string;
  formationChoice: FormationChoicePresentation | null;
}

function refreshShotDialogueText(
  sequence: DialogueSequence,
  shots: ShotPlan[],
): ShotPlan[] {
  const rowsById = new Map(sequence.rows.map((row) => [row.id, row]));
  const participantNames = new Map(
    sequence.participants.map((participant) => [
      participant.id,
      participant.name,
    ]),
  );
  return shots.map((shot) => {
    const rows = shot.dialogueIds.flatMap((dialogueId) => {
      const row = rowsById.get(dialogueId);
      return row ? [row] : [];
    });
    if (rows.length === 0) {
      return shot;
    }
    return {
      ...shot,
      content: rows
        .map(
          (row) =>
            `${participantNames.get(row.npcId ?? -1) ?? "未知"}：${row.content}`,
        )
        .join(" "),
      duration: estimateShotDuration(rows.map((row) => row.content)),
    };
  });
}

function withUpdatedDialogueContent(
  sequence: DialogueSequence,
  dialogueNodeId: string,
  content: string,
): DialogueSequence {
  return withUpdatedDialogueContents(
    sequence,
    new Map([[dialogueNodeId, content]]),
  );
}

function withUpdatedDialogueContents(
  sequence: DialogueSequence,
  updates: ReadonlyMap<string, string>,
): DialogueSequence {
  const updateRow = (row: DialogueRow) =>
    updates.has(row.id)
      ? { ...row, content: updates.get(row.id)! }
      : row;
  const updateAdjacent = (
    context: DialogueSequence["adjacentContext"]["previous"],
  ) =>
    context
      ? {
          ...context,
          dialogue: context.dialogue.map((row) =>
            updates.has(row.dialogueId)
              ? { ...row, content: updates.get(row.dialogueId)! }
              : row,
          ),
        }
      : null;
  return {
    ...sequence,
    rows: sequence.rows.map(updateRow),
    adjacentContext: {
      previous: updateAdjacent(sequence.adjacentContext.previous),
      next: updateAdjacent(sequence.adjacentContext.next),
    },
  };
}

function HighlightedDialogueText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
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

function skippedBlueprintMessage(message: string): string {
  return message.includes("自动站位")
    ? message
    : `${message}，已跳过 BP 并使用自动站位`;
}

function blueprintDisplayName(assetPath: string): string {
  return (
    assetPath
      .replaceAll("\\", "/")
      .split("/")
      .at(-1)
      ?.split(".")[0] || "BP 占位"
  );
}

function blueprintFormationStatus(
  playerPositionLocked: boolean,
  ignoredNpcCount = 0,
): string {
  const base = playerPositionLocked
    ? "保留 UE Formation 的全部初始位置与朝向，0 号玩家固定"
    : "保留 UE Formation 的其他角色位置，0 号玩家由导演调整";
  return ignoredNpcCount > 0
    ? `${base}；${ignoredNpcCount} 位缺失模型角色使用规则临时占位`
    : base;
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

function actorTurnLabel(angleDegrees: number): string {
  if (Math.abs(angleDegrees) === 180) {
    return "转身 180°";
  }
  return `${angleDegrees > 0 ? "右转" : "左转"} ${Math.abs(angleDegrees)}°`;
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

interface ShotInspectorProps {
  shot: ShotPlan;
  sequence: DialogueSequence;
  activeDialogueId: string;
  directorAnalysis: DirectorSceneAnalysis | undefined;
  soundEffects: DirectorSoundEffectRecommendation[];
  soundEffectCatalog: SoundEffectCatalogSnapshot;
  musicRecommendations: MusicRecommendation[];
  musicCatalog: MusicCatalogSnapshot;
  directorBlocking: DirectorBlocking;
  appliedDirector: DirectorMode;
  activeIndex: number;
  shotCount: number;
  tab: InspectorTab;
  canExport: boolean;
  exportBusy: boolean;
  exportError: string;
  exportButtonLabel: string;
  exportUnavailableReason: string;
  backgroundGenerationActive: boolean;
  configurationMode: boolean;
  configurationModeBusy: boolean;
  characterActionEditor: CharacterActionEditorController;
  onMove: (offset: number) => void;
  onTabChange: (tab: InspectorTab) => void;
  onConfigurationModeChange: (enabled: boolean) => void;
  onExport: () => void;
  onExportSoundEffects: () => void;
  onChangeSoundEffect: (
    recommendation: DirectorSoundEffectRecommendation,
    update: Pick<
      DirectorSoundEffectRecommendation,
      "dialogueId" | "delaySeconds"
    >,
  ) => void;
  onApplySoundEffect: (
    entry: SoundEffectCatalogEntry,
    dialogueId: string,
  ) => void;
  onApplyMusic: (entry: MusicCatalogEntry, dialogueId: string) => void;
}

function ShotInspector({
  shot,
  sequence,
  activeDialogueId,
  directorAnalysis,
  soundEffects,
  soundEffectCatalog,
  musicRecommendations,
  musicCatalog,
  directorBlocking,
  appliedDirector,
  activeIndex,
  shotCount,
  tab,
  canExport,
  exportBusy,
  exportError,
  exportButtonLabel,
  exportUnavailableReason,
  backgroundGenerationActive,
  configurationMode,
  configurationModeBusy,
  characterActionEditor,
  onMove,
  onTabChange,
  onConfigurationModeChange,
  onExport,
  onExportSoundEffects,
  onChangeSoundEffect,
  onApplySoundEffect,
  onApplyMusic,
}: ShotInspectorProps) {
  const [expandedOutlinePrefix, setExpandedOutlinePrefix] = useState<
    string | null
  >(null);
  const storyOutlineExpanded = expandedOutlinePrefix === sequence.prefix;
  const slotLabelsBySlot = new Map(
    sequence.participants.map((participant) => [
      participant.slot,
      participantSlotLabel(participant),
    ]),
  );

  const tabs: Array<{
    id: InspectorTab;
    label: string;
    icon: typeof Camera;
  }> = [
    { id: "direction", label: "导演", icon: Clapperboard },
    { id: "shot", label: "镜头", icon: Camera },
    { id: "audio", label: "音频", icon: AudioLines },
    { id: "ue", label: "UE", icon: Boxes },
  ];
  const visibleTabs = configurationMode
    ? tabs.filter(({ id }) => id === "audio" || id === "ue")
    : tabs;

  return (
    <>
      <section className="inspector-header">
        <div>
          <small>
            SHOT {String(activeIndex + 1).padStart(2, "0")} /{" "}
            {String(shotCount).padStart(2, "0")}
          </small>
          <h2>{shot.label}</h2>
        </div>
        <div className="shot-nav">
          <button
            className="icon-button configuration-mode-toggle"
            type="button"
            title={configurationMode ? "返回完整窗口" : "进入配置小窗"}
            aria-label={configurationMode ? "返回完整窗口" : "进入配置小窗"}
            aria-pressed={configurationMode}
            disabled={configurationModeBusy}
            onClick={() => onConfigurationModeChange(!configurationMode)}
          >
            {configurationModeBusy ? (
              <LoaderCircle className="spin" size={17} />
            ) : configurationMode ? (
              <Maximize2 size={17} />
            ) : (
              <PanelRightClose size={17} />
            )}
          </button>
          <button
            className="icon-button"
            type="button"
            title="上一个镜头"
            aria-label="上一个镜头"
            disabled={activeIndex === 0}
            onClick={() => onMove(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="下一个镜头"
            aria-label="下一个镜头"
            disabled={activeIndex === shotCount - 1}
            onClick={() => onMove(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </section>

      <nav className="inspector-tabs" aria-label="镜头检查器" role="tablist">
        {visibleTabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="shot-inspector-panel"
            className={tab === id ? "is-active" : ""}
            key={id}
            onClick={() => onTabChange(id)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div
        className="inspector-tab-panel"
        id="shot-inspector-panel"
        role="tabpanel"
        key={`${shot.id}-${tab}`}
      >
        {tab === "shot" && (
          <>
            <section className="inspector-section">
              <div className="section-label">
                <span>摄影参数</span>
              </div>
              <div className="inspector-summary">
                <div>
                  <small>FOCAL</small>
                  <strong>
                    {shot.endFocalLength === shot.focalLength
                      ? shot.focalLength
                      : `${shot.focalLength}-${shot.endFocalLength}`}
                    <span> mm</span>
                  </strong>
                </div>
                <div>
                  <small>DURATION</small>
                  <strong>
                    {shot.duration}
                    <span> s</span>
                  </strong>
                </div>
                <div>
                  <small>CHECK</small>
                  <strong
                    className={
                      shot.projection.valid
                        ? "projection-status--valid"
                        : "projection-status--invalid"
                    }
                  >
                    {shot.projection.valid ? "通过" : "未通过"}
                  </strong>
                </div>
              </div>
              <dl className="parameter-grid parameter-grid--inspector">
                <div>
                  <dt>镜头类型</dt>
                  <dd>{shot.label}</dd>
                </div>
                <div>
                  <dt>焦段意图</dt>
                  <dd>{lensIntentLabel(shot.lensIntent)}</dd>
                </div>
                <div>
                  <dt>景深</dt>
                  <dd>{depthOfFieldLabel(shot.depthOfField)}</dd>
                </div>
                <div>
                  <dt>镜内运动</dt>
                  <dd>
                    {cameraMovementLabel(shot.cameraMovement)}
                    {shot.movementIntensity === "none"
                      ? ""
                      : ` · ${movementIntensityLabel(shot.movementIntensity)}`}
                  </dd>
                </div>
                <div>
                  <dt>主体</dt>
                  <dd>{shot.speakerName}</dd>
                </div>
                <div>
                  <dt>对话对象</dt>
                  <dd>
                    {shot.lookTargetSlot
                      ? sequence.participants.find(
                          (participant) =>
                            participant.slot === shot.lookTargetSlot,
                        )?.name ?? shot.lookTargetSlot
                      : "群体中心"}
                  </dd>
                </div>
                <div>
                  <dt>当前轴线</dt>
                  <dd>{shot.axis.id}</dd>
                </div>
                <div>
                  <dt>横滚角</dt>
                  <dd>{shot.cameraRollDegrees.toFixed(0)}°</dd>
                </div>
                <div>
                  <dt>实测景别</dt>
                  <dd>{shotSizeLabel(shot.projection.measuredShotSize)}</dd>
                </div>
                <div>
                  <dt>正面偏角</dt>
                  <dd>
                    {shot.projection.subjectFaceAngle === null
                      ? "群像"
                      : `${shot.projection.subjectFaceAngle.toFixed(1)}°`}
                  </dd>
                </div>
              </dl>
            </section>
            <section className="inspector-section">
              <div className="section-label">
                <span>构图策略</span>
              </div>
              <dl className="parameter-grid parameter-grid--inspector">
                <div>
                  <dt>画面构成</dt>
                  <dd>{shotCoverageLabel(shot.projection.coverage)}</dd>
                </div>
                <div>
                  <dt>覆盖意图</dt>
                  <dd>{coverageIntentLabel(shot.coverageIntent)}</dd>
                </div>
                <div>
                  <dt>构图原则</dt>
                  <dd>{compositionModeLabel(shot.compositionPlan.mode)}</dd>
                </div>
                <div>
                  <dt>构图衔接</dt>
                  <dd>
                    {compositionTransitionLabel(
                      shot.compositionPlan.transition,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>空间策略</dt>
                  <dd>
                    {negativeSpaceLabel(shot.compositionPlan.negativeSpace)}
                  </dd>
                </div>
                <div>
                  <dt>视线前/后</dt>
                  <dd>
                    {shot.projection.lookRoom === null ||
                    shot.projection.backRoom === null
                      ? "不适用"
                      : `${shot.projection.lookRoom.toFixed(2)} / ${shot.projection.backRoom.toFixed(2)}`}
                  </dd>
                </div>
                <div>
                  <dt>视觉落点</dt>
                  <dd>
                    {shot.projection.visualAnchor
                      .map((value) => value.toFixed(2))
                      .join(", ")}
                  </dd>
                </div>
                <div>
                  <dt>注视点偏移</dt>
                  <dd>
                    {shot.projection.eyeTraceDelta === null
                      ? "首镜"
                      : shot.projection.eyeTraceDelta.toFixed(2)}
                  </dd>
                </div>
              </dl>
            </section>
            <section className="inspector-section">
              <div className="section-label">
                <span>构图说明</span>
              </div>
              <p>{shot.composition}</p>
            </section>
            {shot.projection.warnings.length > 0 && (
              <section className="inspector-section warning-section">
                <div className="section-label">
                  <span>镜头验收提示</span>
                </div>
                {shot.projection.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </section>
            )}
          </>
        )}

        {tab === "direction" && (
          <>
            <section className="inspector-section story-outline">
              <button
                className="story-outline__toggle"
                type="button"
                aria-expanded={storyOutlineExpanded}
                aria-controls="story-outline-content"
                onClick={() =>
                  setExpandedOutlinePrefix((expandedPrefix) =>
                    expandedPrefix === sequence.prefix
                      ? null
                      : sequence.prefix,
                  )
                }
              >
                <span>
                  <strong>剧情梗概</strong>
                  <small>开始节点 {sequence.startId}</small>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              {storyOutlineExpanded && (
                <p id="story-outline-content">
                  {sequence.outline || "该对话没有填写剧情梗概。"}
                </p>
              )}
            </section>
            <section className="inspector-section actor-actions">
              <div className="section-label">
                <span>演员动作</span>
                <small>{shot.actorActions.length} 项</small>
              </div>
              {shot.actorActions.length > 0 ? (
                <div className="actor-action-list">
                  {shot.actorActions.map((action) => (
                    <div
                      key={`${action.participantSlot}-${action.angleDegrees}`}
                    >
                      <RotateCw
                        className={
                          action.angleDegrees < 0 ? "is-counterclockwise" : ""
                        }
                        size={15}
                      />
                      <strong>
                        {slotLabelsBySlot.get(action.participantSlot) ?? "?"}{" "}
                        {action.participantName}
                      </strong>
                      <span>{actorTurnLabel(action.angleDegrees)}</span>
                      <small>
                        <code>{action.montageName}</code> · {action.reason}
                      </small>
                    </div>
                  ))}
                </div>
              ) : (
                <p>本镜沿用上一镜角色朝向，无需新增转身动作。</p>
              )}
            </section>
            <section className="inspector-section">
              <div className="section-label">
                <span>导演意图</span>
              </div>
              <p>{shot.rationale}</p>
            </section>
            {directorAnalysis && (
              <section className="inspector-section director-analysis">
                <div className="section-label">
                  <span>全场导演分析</span>
                  <small>{directorLabel(appliedDirector)}</small>
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
                      <span style={{ backgroundColor: participant?.color }}>
                        {participant
                          ? participantSlotLabel(participant)
                          : "?"}
                      </span>
                      <strong>{participant?.name ?? placement.subject}</strong>
                      <small title={placement.intent}>
                        {blockingPositionLabel(placement.position)} · 登场{" "}
                        {placement.entry_dialogue_id} · 离场{" "}
                        {placement.exit_dialogue_id ?? "本场结束"} ·{" "}
                        {placement.intent}
                      </small>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {tab === "audio" && (
          <>
            <SoundEffectRecommendations
              recommendations={soundEffects}
              dialogueRows={sequence.rows}
              currentDialogueIds={shot.dialogueIds}
              busy={exportBusy}
              onWrite={onExportSoundEffects}
              onChange={onChangeSoundEffect}
            />
            <MusicRecommendations
              recommendations={musicRecommendations}
              dialogueOrder={sequence.rows.map((row) => row.id)}
              currentDialogueIds={shot.dialogueIds}
            />
            <AudioLibraryBrowser
              soundEffectCatalog={soundEffectCatalog}
              musicCatalog={musicCatalog}
              dialogueRows={sequence.rows}
              currentDialogueIds={shot.dialogueIds}
              activeDialogueId={activeDialogueId}
              appliedSoundEffects={soundEffects}
              appliedMusic={musicRecommendations}
              onApplySoundEffect={onApplySoundEffect}
              onApplyMusic={onApplyMusic}
            />
          </>
        )}

        {tab === "ue" && (
          <>
            <CharacterActionEditor
              controller={characterActionEditor}
              sequence={sequence}
              dialogueIds={shot.dialogueIds}
              busy={exportBusy}
            />
            <section className="inspector-section">
              <div className="section-label">
                <span>UE4 参考</span>
              </div>
              <div className="ue-reference">
                <div>
                  <span>Camera</span>
                  <code>
                    {shot.cameraPosition
                      .map((value) => value.toFixed(2))
                      .join(", ")}
                  </code>
                </div>
                <div>
                  <span>Target</span>
                  <code>
                    {shot.cameraTarget
                      .map((value) => value.toFixed(2))
                      .join(", ")}
                  </code>
                </div>
                {shot.cameraMovement !== "static" && (
                  <>
                    <div>
                      <span>End Camera</span>
                      <code>
                        {shot.cameraEndPosition
                          .map((value) => value.toFixed(2))
                          .join(", ")}
                      </code>
                    </div>
                    <div>
                      <span>End Target</span>
                      <code>
                        {shot.cameraEndTarget
                          .map((value) => value.toFixed(2))
                          .join(", ")}
                      </code>
                    </div>
                  </>
                )}
                <small>
                  原型坐标为相对站位，用于构图参考，不直接等同于 UE4
                  世界坐标。
                </small>
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
          </>
        )}
      </div>

      <footer className="inspector-footer inspector-footer--export">
        <div>
          {exportError || exportUnavailableReason ? (
            <AlertTriangle size={15} />
          ) : (
            <Users size={15} />
          )}
          <span>
            {exportUnavailableReason ||
              exportError ||
              `${shotCount} 镜已绑定 BP 站位${
                backgroundGenerationActive
                  ? " · AI 后台生成中，可导出当前方案"
                  : ""
              }`}
          </span>
        </div>
        <button
          className="button button--primary"
          type="button"
          title={
            exportUnavailableReason ||
            (exportBusy
              ? "正在预检当前分镜"
              : "预检并导出当前分镜到 UE Dialog Graph")
          }
          disabled={!canExport || exportBusy}
          onClick={onExport}
        >
          {exportBusy ? (
            <LoaderCircle className="spin" size={16} />
          ) : exportUnavailableReason ? (
            <AlertTriangle size={16} />
          ) : (
            <Upload size={16} />
          )}
          {exportBusy ? "正在检查 UE" : exportButtonLabel}
        </button>
      </footer>
    </>
  );
}

export default function App() {
  const [showLaunchScreen, setShowLaunchScreen] = useState(
    () =>
      window.sessionStorage.getItem(LAUNCH_SCREEN_STORAGE_KEY) !== "1",
  );
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
  const [directorLoadingMode, setDirectorLoadingMode] = useState<
    Exclude<DirectorMode, "rule"> | null
  >(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [directorAnalysis, setDirectorAnalysis] =
    useState<DirectorSceneAnalysis | undefined>(initial.analysis);
  const [soundEffectCatalog, setSoundEffectCatalog] =
    useState<SoundEffectCatalogSnapshot>(initialSoundEffectCatalog);
  const [soundEffects, setSoundEffects] = useState<
    DirectorSoundEffectRecommendation[]
  >(initial.soundEffects);
  const [musicCatalog, setMusicCatalog] = useState<MusicCatalogSnapshot>({
    entries: [],
    revision: 0,
    syncedAt: null,
    unmappedCount: 0,
    missingAttachmentCount: 0,
    analyzedCount: 0,
  });
  const [musicOverridesByDialogueId, setMusicOverridesByDialogueId] =
    useState<Map<string, MusicRecommendation>>(() => new Map());
  const [directorBlocking, setDirectorBlocking] =
    useState<DirectorBlocking>(initial.blocking);
  const [pendingDirectorResult, setPendingDirectorResult] =
    useState<PendingDirectorPresentation | null>(null);
  const [sharedComparison, setSharedComparison] =
    useState<SharedComparisonPresentation | null>(null);
  const [sharedComparisonBusy, setSharedComparisonBusy] = useState(false);
  const [sharedComparisonError, setSharedComparisonError] = useState("");
  const [formationChoice, setFormationChoice] =
    useState<FormationChoicePresentation | null>(null);
  const [formationChoiceMode, setFormationChoiceMode] = useState<
    "initial" | "switch" | "director-request" | null
  >(null);
  const [missingNpcModelReview, setMissingNpcModelReview] =
    useState<MissingNpcModelReview | null>(null);
  const [formationChecking, setFormationChecking] = useState(false);
  const [formationStatus, setFormationStatus] = useState("");
  const [activeFormationSource, setActiveFormationSource] = useState<
    "blueprint" | "generated"
  >("generated");
  const [activeFormationVariant, setActiveFormationVariant] =
    useState<FormationOptionId>("generated");
  const [desktopSetup, setDesktopSetup] =
    useState<DesktopSetupStatus | null>(null);
  const [showDesktopFirstRun, setShowDesktopFirstRun] = useState(false);
  const [showDesktopSetup, setShowDesktopSetup] = useState(false);
  const {
    activeWorkspace,
    outgoingWorkspace,
    workspaceDirection,
    switchWorkspace,
    closeToolWorkspace,
  } = useWorkspaceNavigation();
  const {
    traeStatus,
    traeLoading,
    traeError,
    traeConfig,
    larkStatus,
    larkLoading,
    larkError,
    authStart,
    authFinishing,
    collectRevisionCases,
    refreshTraeConnection,
    setupTrae,
    refreshLarkConnection,
    beginAuthorization,
    finishAuthorization,
    changeCaseCollection,
    closeTraeConfig,
    closeAuthorization,
    reorderPendingTasks,
    deletePendingTask,
    cancelActiveTraeTask,
  } = useCollaborationConnections();
  const [traeCancelBusy, setTraeCancelBusy] = useState(false);
  const [activeTraeRequestId, setActiveTraeRequestId] = useState("");
  const activeTraeRequestRef = useRef<DirectorInput | null>(null);
  const activeTraeAbortRef = useRef<AbortController | null>(null);
  const [contentSearch, setContentSearch] =
    useState<DialogueContentSearchResult | null>(null);
  const [designedStoryboards, setDesignedStoryboards] = useState<
    Map<string, CachedStoryboard>
  >(
    () =>
      new Map([
        [
          initial.sequence.prefix,
          {
            sequence: initial.sequence,
            shots: initial.shots,
            appliedDirector: "rule",
            directorAnalysis: initial.analysis,
            soundEffects: initial.soundEffects,
            directorBlocking: initial.blocking,
            activeFormationSource: "generated",
            activeFormationVariant: "generated",
            formationStatus: "",
            formationChoice: null,
          },
        ],
      ]),
  );
  const [selectedDialogueId, setSelectedDialogueId] = useState(
    initial.shots[0]?.dialogueId ?? initial.sequence.rows[0]?.id ?? "",
  );
  const [editingDialogueId, setEditingDialogueId] = useState<string | null>(
    null,
  );
  const [dialogueDraft, setDialogueDraft] = useState("");
  const [dialogueSaveBusy, setDialogueSaveBusy] = useState(false);
  const [dialogueSaveError, setDialogueSaveError] = useState("");
  const [dialogueSaveStatus, setDialogueSaveStatus] = useState("");
  const [showDialogueTextEditor, setShowDialogueTextEditor] =
    useState(false);
  const [inspectorTab, setInspectorTab] =
    useState<InspectorTab>("direction");
  const [configurationMode, setConfigurationMode] = useState(false);
  const [configurationModeBusy, setConfigurationModeBusy] = useState(false);
  const [configurationModeTransition, setConfigurationModeTransition] =
    useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directorySelectionKindRef = useRef<"live" | "config">("live");
  const dialogueEditorRef = useRef<HTMLDivElement>(null);
  const directorRunRef = useRef(0);
  const formationRunRef = useRef(0);
  const traeForceRegenerateRef = useRef(false);
  const activeIndexRef = useRef(activeIndex);
  const directorModeRef = useRef(directorMode);
  const sequenceRef = useRef(sequence);
  const appliedDirectorRef = useRef(appliedDirector);
  const activeFormationSourceRef = useRef(activeFormationSource);
  const playerPositionLockedRef = useRef(true);
  const soundEffectCatalogRef = useRef(soundEffectCatalog);
  const soundEffectCatalogLoadRef =
    useRef<Promise<SoundEffectCatalogSnapshot> | null>(null);
  activeIndexRef.current = activeIndex;
  directorModeRef.current = directorMode;
  sequenceRef.current = sequence;
  appliedDirectorRef.current = appliedDirector;
  activeFormationSourceRef.current = activeFormationSource;
  playerPositionLockedRef.current =
    formationChoice?.playerPositionLocked ?? true;
  soundEffectCatalogRef.current = soundEffectCatalog;

  const activeShot: ShotPlan | undefined = shots[activeIndex] ?? shots[0];
  const characterActionEditor = useCharacterActionEditor({
    sequence,
    enabled:
      activeWorkspace === "storyboard" &&
      inspectorTab === "ue" &&
      Boolean(activeShot),
  });
  const characterActionStage = useMemo(() => {
    if (!activeShot) {
      return {
        participants: sequence.participants,
        affectedModelIndexes: new Set<number>(),
      };
    }
    return resolveDialogueCharacterStage(
      sequence.participants,
      sequence.rows,
      activeShot.dialogueEndIndex,
      characterActionEditor.existingTracks,
      characterActionEditor.tracks,
    );
  }, [
    activeShot,
    characterActionEditor.existingTracks,
    characterActionEditor.tracks,
    sequence.participants,
    sequence.rows,
  ]);
  const stageShot = useMemo(() => {
    if (
      !activeShot ||
      characterActionStage.affectedModelIndexes.size === 0
    ) {
      return undefined;
    }
    const facingOverrides = { ...activeShot.facingOverrides };
    for (const participant of characterActionStage.participants) {
      if (
        participant.modelIndex === null ||
        !characterActionStage.affectedModelIndexes.has(
          participant.modelIndex,
        )
      ) {
        continue;
      }
      facingOverrides[participant.slot] = participant.facingTarget;
    }
    return { ...activeShot, facingOverrides };
  }, [
    activeShot,
    characterActionStage,
  ]);
  const generatedMusicRecommendations = useMemo(
    () =>
      recommendMusic(
        sequence,
        musicCatalog.entries,
        directorAnalysis?.emotionalProgression,
      ),
    [directorAnalysis?.emotionalProgression, musicCatalog.entries, sequence],
  );
  const musicRecommendations = useMemo(() => {
    const dialogueOrder = new Map(
      sequence.rows.map((row, index) => [row.id, index]),
    );
    const byDialogueId = new Map(
      generatedMusicRecommendations.map((item) => [item.dialogueId, item]),
    );
    for (const [dialogueId, item] of musicOverridesByDialogueId) {
      if (dialogueOrder.has(dialogueId)) {
        byDialogueId.set(dialogueId, item);
      }
    }
    return [...byDialogueId.values()].sort(
      (left, right) =>
        (dialogueOrder.get(left.dialogueId) ?? Number.MAX_SAFE_INTEGER) -
        (dialogueOrder.get(right.dialogueId) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [
    generatedMusicRecommendations,
    musicOverridesByDialogueId,
    sequence.rows,
  ]);
  const {
    preview: storyboardExportPreview,
    request: storyboardExportRequest,
    mode: storyboardExportMode,
    currentShotNumber: storyboardExportShotNumber,
    busy: storyboardExportBusy,
    busyLabel: storyboardExportBusyLabel,
    error: storyboardExportError,
    result: storyboardExportResult,
    canExport: canExportStoryboard,
    exportButtonLabel: storyboardExportButtonLabel,
    exportUnavailableReason: storyboardExportUnavailableReason,
    previewCurrent: previewStoryboardExport,
    previewCurrentSoundEffects: previewCurrentSoundEffectExport,
    previewAll: previewAllStoryboardExport,
    refresh: refreshStoryboardExportPreview,
    confirm: confirmStoryboardExport,
    close: closeStoryboardExport,
  } = useStoryboardExport({
    sequence,
    shots,
    characterActions: characterActionEditor.exportActions,
    soundEffects,
    musicRecommendations,
    activeShot,
    onCharacterActionsExported: characterActionEditor.commitExported,
  });
  const activeDialogueId =
    activeShot
      ? activeShot.dialogueIds.includes(selectedDialogueId)
        ? selectedDialogueId
        : activeShot.dialogueId
      : selectedDialogueId;
  const activeDialogueRow = sequence.rows.find(
    (row) => row.id === activeDialogueId,
  );
  const hasLoadedDialogue = sequence.rows.length > 0;
  const queryIsDialogueId = /^\d{4}$/.test(query.trim());
  const dialogueSummary = `${sequence.rows.length} 句台词${
    sequence.ignoredDialogueNodeCount > 0
      ? ` · 已忽略 ${sequence.ignoredDialogueNodeCount} 个关闭 UI 节点`
      : ""
  }`;
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
  const participantNamesBySlot = useMemo(
    () =>
      new Map(
        sequence.participants.map((participant) => [
          participant.slot,
          participant.name,
        ]),
      ),
    [sequence.participants],
  );
  const participantSlotLabelsBySlot = useMemo(
    () =>
      new Map(
        sequence.participants.map((participant) => [
          participant.slot,
          participantSlotLabel(participant),
        ]),
      ),
    [sequence.participants],
  );
  const participantRoles = useMemo(
    () => splitDialogueParticipants(sequence.participants, sequence.rows),
    [sequence.participants, sequence.rows],
  );
  const dialogueParticipantSlotSet = useMemo(
    () =>
      new Set(
        participantRoles.dialogue.map((participant) => participant.slot),
      ),
    [participantRoles],
  );
  const dialogueTextEditorItems = useMemo<DialogueTextEditorItem[]>(() => {
    if (!contentSearch) {
      return activeDialogueRow
        ? [
            {
              dialogueId: sequence.prefix,
              startId: sequence.startId,
              dialogueNodeId: activeDialogueRow.id,
              speakerName:
                activeDialogueRow.speakerSlot
                  ? participantNamesBySlot.get(
                      activeDialogueRow.speakerSlot,
                    ) ?? "未知角色"
                  : "未知角色",
              content: activeDialogueRow.content,
            },
          ]
        : [];
    }
    const seen = new Set<string>();
    return contentSearch.contexts.flatMap((context) => {
      const participants = new Map(
        context.sequence.participants.map((participant) => [
          participant.slot,
          participant.name,
        ]),
      );
      return context.matchedDialogueIds.flatMap((dialogueNodeId) => {
        if (seen.has(dialogueNodeId)) {
          return [];
        }
        const row = context.sequence.rows.find(
          (candidate) => candidate.id === dialogueNodeId,
        );
        if (!row) {
          return [];
        }
        seen.add(dialogueNodeId);
        return [
          {
            dialogueId: context.prefix,
            startId: context.sequence.startId,
            dialogueNodeId,
            speakerName: row.speakerSlot
              ? participants.get(row.speakerSlot) ?? "未知角色"
              : "未知角色",
            content: row.content,
          },
        ];
      });
    });
  }, [
    activeDialogueRow,
    contentSearch,
    participantNamesBySlot,
    sequence.prefix,
    sequence.startId,
  ]);
  const activeFormationName =
    activeFormationVariant === "blueprint" && formationChoice
      ? blueprintDisplayName(formationChoice.snapshot.blueprintAssetPath)
      : activeFormationVariant === "ai"
        ? `${directorLabel(
            formationChoice?.ai?.result.appliedMode ?? appliedDirector,
          )} 占位`
        : "规则导演占位";
  const availableFormationOptionCount = formationChoice
    ? 2 + Number(Boolean(formationChoice.ai))
    : 1;
  const shotPreparationMessage = !hasLoadedDialogue
    ? "请输入对话 ID 或对白内容"
    : formationChecking
      ? "正在查询 UE Blueprint 站位"
      : formationChoiceMode === "initial"
        ? "BP 占位已读取，等待选择"
        : formationChoiceMode === "director-request"
          ? "请选择 TRAE 占位策略"
        : directorLoading
          ? `${directorLabel(directorLoadingMode ?? directorMode)}正在生成镜头`
          : "镜头方案尚未生成";
  const traeWaitHeading =
    (traeStatus?.stats.processing ?? 0) > 0
      ? "TRAE 正在生成分镜"
      : (traeStatus?.stats.pending ?? 0) > 0
        ? "协作任务已排队，等待模型可用"
        : "已提交，等待内部 TRAE 接收";
  const browsingPreviousAiPlan =
    directorLoading &&
    directorLoadingMode !== null &&
    appliedDirector === directorLoadingMode;
  const traeWaitDetail =
    browsingPreviousAiPlan
      ? "当前 AI 分镜仍可浏览，完成后自动应用新方案"
      : (traeStatus?.stats.processing ?? 0) > 0
        ? "对话与规则分镜保持可用，完成后自动应用所选占位策略"
      : "模型繁忙时会继续排队，不会立即判定协作失败";

  const dismissLaunchScreen = useCallback(() => {
    window.sessionStorage.setItem(LAUNCH_SCREEN_STORAGE_KEY, "1");
    setShowLaunchScreen(false);
  }, []);

  function replaceSoundEffectRecommendations(
    recommendations: DirectorSoundEffectRecommendation[],
  ) {
    setSoundEffects(recommendations);
  }

  function updateSoundEffectRecommendation(
    recommendation: DirectorSoundEffectRecommendation,
    update: Pick<
      DirectorSoundEffectRecommendation,
      "dialogueId" | "delaySeconds"
    >,
  ) {
    setSoundEffects((current) => {
      const sourceIndex = current.findIndex(
        (item) =>
          item === recommendation ||
          (item.dialogueId === recommendation.dialogueId &&
            item.assetName === recommendation.assetName),
      );
      if (sourceIndex < 0) {
        return current;
      }
      const updated = { ...current[sourceIndex], ...update };
      const dialogueOrder = new Map(
        sequence.rows.map((row, index) => [row.id, index]),
      );
      return current
        .filter(
          (item, index) =>
            index !== sourceIndex &&
            item.dialogueId !== updated.dialogueId,
        )
        .concat(updated)
        .sort(
          (left, right) =>
            (dialogueOrder.get(left.dialogueId) ??
              Number.MAX_SAFE_INTEGER) -
            (dialogueOrder.get(right.dialogueId) ??
              Number.MAX_SAFE_INTEGER),
        );
    });
  }

  function applySoundEffectFromLibrary(
    entry: SoundEffectCatalogEntry,
    dialogueId: string,
  ) {
    if (!dialogueId) {
      return;
    }
    setSoundEffects((current) => {
      const existing = current.find(
        (item) => item.dialogueId === dialogueId,
      );
      const next = current
        .filter((item) => item.dialogueId !== dialogueId)
        .concat({
          dialogueId,
          assetName: entry.assetName,
          category: entry.category,
          reason: "手动从资料库选择。",
          description: entry.description,
          delaySeconds: existing?.delaySeconds ?? 0,
        });
      const dialogueOrder = new Map(
        sequence.rows.map((row, index) => [row.id, index]),
      );
      return next.sort(
        (left, right) =>
          (dialogueOrder.get(left.dialogueId) ??
            Number.MAX_SAFE_INTEGER) -
          (dialogueOrder.get(right.dialogueId) ??
            Number.MAX_SAFE_INTEGER),
      );
    });
  }

  function applyMusicFromLibrary(
    entry: MusicCatalogEntry,
    dialogueId: string,
  ) {
    if (!dialogueId) {
      return;
    }
    setMusicOverridesByDialogueId((current) => {
      const next = new Map(current);
      next.set(dialogueId, {
        dialogueId,
        stateId: entry.stateId,
        stateName: entry.stateName,
        musicName: entry.name,
        reason: "手动从资料库选择。",
        fileToken: entry.fileToken,
        fileName: entry.fileName,
        recordId: entry.recordId,
        audioSummary: entry.analysis?.summary ?? null,
      });
      return next;
    });
  }

  useEffect(() => {
    const getConfigurationWindowMode =
      window.shotSandboxDesktop?.getConfigurationWindowMode;
    if (!getConfigurationWindowMode) {
      return;
    }
    let active = true;
    void getConfigurationWindowMode()
      .then((enabled) => {
        if (!active || !enabled) {
          return;
        }
        setInspectorTab("audio");
        setConfigurationMode(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void refreshTraeConnection();
    void refreshLarkConnection(false);
    void getMusicCatalog().then(setMusicCatalog).catch(() => undefined);
    const catalogRequest = getSoundEffectCatalog();
    soundEffectCatalogLoadRef.current = catalogRequest;
    void catalogRequest
      .then((snapshot) => {
        soundEffectCatalogRef.current = snapshot;
        setSoundEffectCatalog(snapshot);
        if (snapshot.source === "lark") {
          setDesignedStoryboards(new Map());
          if (appliedDirectorRef.current === "rule") {
            replaceSoundEffectRecommendations(
              createShotPreview(sequenceRef.current, {
                preserveInputPositions:
                  activeFormationSourceRef.current === "blueprint",
                lockPlayerPosition: playerPositionLockedRef.current,
                soundEffectCatalog: snapshot.entries,
              }).soundEffects,
            );
          }
        }
      })
      .catch(() => undefined);
    if (window.shotSandboxDesktop) {
      void window.shotSandboxDesktop.getSetupStatus().then((status) => {
        const needsDataSetup =
          !status.setupCompleted || !status.defaultDataReady;
        setDesktopSetup(status);
        setShowDesktopFirstRun(needsDataSetup);
        setShowDesktopSetup(!needsDataSetup && status.firstRun);
        if (status.liveDataReady && status.configDataReady) {
          setLoading(true);
          void loadConfiguredDatabase()
            .then(useDatabase)
            .catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "已保存的数据目录读取失败",
              );
            })
            .finally(() => setLoading(false));
        }
      });
    }
  }, []);

  useEffect(() => {
    if (!directorLoading || directorLoadingMode !== "trae") {
      return;
    }
    const interval = window.setInterval(() => {
      void refreshTraeConnection(false);
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [directorLoading, directorLoadingMode]);

  useEffect(() => {
    if (shots.length === 0) {
      return;
    }
    setDesignedStoryboards((current) => {
      const cached = current.get(sequence.prefix);
      if (
        cached?.sequence === sequence &&
        cached.shots === shots &&
        cached.appliedDirector === appliedDirector &&
        cached.directorAnalysis === directorAnalysis &&
        cached.soundEffects === soundEffects &&
        cached.directorBlocking === directorBlocking &&
        cached.activeFormationSource === activeFormationSource &&
        cached.activeFormationVariant === activeFormationVariant &&
        cached.formationChoice === formationChoice &&
        cached.formationStatus === formationStatus
      ) {
        return current;
      }
      const next = new Map(current);
      next.set(sequence.prefix, {
        sequence,
        shots,
        appliedDirector,
        directorAnalysis,
        soundEffects,
        directorBlocking,
        activeFormationSource,
        activeFormationVariant,
        formationStatus,
        formationChoice,
      });
      return next;
    });
  }, [
    activeFormationSource,
    activeFormationVariant,
    appliedDirector,
    directorAnalysis,
    directorBlocking,
    formationStatus,
    formationChoice,
    sequence,
    shots,
    soundEffects,
  ]);

  useEffect(() => {
    if (!editingDialogueId) {
      return;
    }
    const cancelOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !dialogueEditorRef.current?.contains(event.target)
      ) {
        cancelDialogueEdit();
      }
    };
    document.addEventListener("pointerdown", cancelOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", cancelOnOutsidePointer);
  }, [dialogueSaveBusy, editingDialogueId]);

  async function refreshSoundEffectCatalogFromLark() {
    const snapshot = await syncSoundEffectCatalog();
    directorRunRef.current += 1;
    setDirectorLoading(false);
    setDirectorLoadingMode(null);
    soundEffectCatalogRef.current = snapshot;
    setSoundEffectCatalog(snapshot);
    setDesignedStoryboards(new Map());
    replaceSoundEffectRecommendations([]);
    await refreshLarkConnection(false);
    return snapshot;
  }

  async function refreshMusicCatalogFromLark() {
    const snapshot = await syncMusicCatalog();
    setMusicCatalog(snapshot);
    return snapshot;
  }

  async function applySequence(
    nextSequence: DialogueSequence,
    requestedMode: DirectorMode,
    options: ApplySequenceOptions = {},
  ) {
    if (requestedMode !== "rule" && soundEffectCatalogLoadRef.current) {
      await soundEffectCatalogLoadRef.current.catch(() => undefined);
    }
    const {
      preserveInputPositions = false,
      lockPlayerPosition = true,
      keepCurrentPreview = false,
    } = options;
    const activeSoundEffectCatalog = soundEffectCatalogRef.current;
    const keepsBackgroundRequest =
      requestedMode === "rule" && options.keepBackgroundRequest === true;
    const runId = keepsBackgroundRequest
      ? directorRunRef.current
      : ++directorRunRef.current;
    const preview = createShotPreview(nextSequence, {
      preserveInputPositions,
      lockPlayerPosition,
      soundEffectCatalog: activeSoundEffectCatalog.entries,
    });
    setFallbackReason(null);
    if (!keepsBackgroundRequest) {
      setPendingDirectorResult(null);
      setSharedComparison(null);
      setSharedComparisonError("");
    }
    setError("");
    if (!keepCurrentPreview || requestedMode === "rule") {
      setSequence(preview.sequence);
      setShots(preview.shots);
      setAppliedDirector("rule");
      setDirectorAnalysis(preview.analysis);
      replaceSoundEffectRecommendations(preview.soundEffects);
      setDirectorBlocking(preview.blocking);
      focusPlanShot(
        preview.shots,
        preview.sequence,
        options.preserveActiveShot === true,
      );
    }

    if (requestedMode === "rule") {
      if (!keepsBackgroundRequest) {
        setDirectorLoading(false);
        setDirectorLoadingMode(null);
      }
      return;
    }

    setDirectorLoading(true);
    setDirectorLoadingMode(requestedMode);
    const traeAbortController =
      requestedMode === "trae" ? new AbortController() : null;
    if (traeAbortController) {
      activeTraeRequestRef.current = null;
      setActiveTraeRequestId("");
      activeTraeAbortRef.current = traeAbortController;
    }
    try {
      const result = await designShots(nextSequence, requestedMode, {
        preserveInputPositions,
        lockPlayerPosition,
        fallbackPreserveInputPositions:
          options.fallbackPreserveInputPositions,
        collectRevisionCases,
        soundEffectCatalog: activeSoundEffectCatalog.entries,
        forceRegenerate: options.forceRegenerate,
        signal: traeAbortController?.signal,
        onRequestCreated:
          requestedMode === "trae"
            ? (input) => {
                if (runId === directorRunRef.current) {
                  activeTraeRequestRef.current = input;
                  setActiveTraeRequestId(input.request_id);
                }
              }
            : undefined,
      });
      if (runId !== directorRunRef.current) {
        return;
      }
      if (result.appliedMode !== "rule" && result.analysis) {
        setFormationChoice((current) =>
          current
            ? {
                ...current,
                ai: { sequence: nextSequence, result },
              }
            : current,
        );
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
          setPendingDirectorResult({
            sequence: nextSequence,
            result,
            reviewFormation:
              requestedMode === "trae" ? false : undefined,
          });
          setError("共享方案与当前对话结构不兼容，已保留本地方案");
        }
      } else if (
        result.appliedMode === requestedMode &&
        result.analysis
      ) {
        if (options.applyResultImmediately) {
          if (directorModeRef.current === requestedMode) {
            applyDirectorResult(nextSequence, result);
          } else {
            setPendingDirectorResult({
              sequence: nextSequence,
              result,
              reviewFormation: false,
            });
          }
        } else if (
          requestedMode === "trae" &&
          (result.sharedSource === "local-cache" ||
            result.sharedSource === "shared-library") &&
          directorModeRef.current === requestedMode
        ) {
          applyDirectorResult(nextSequence, result);
        } else {
          setPendingDirectorResult({ sequence: nextSequence, result });
        }
      } else {
        applyDirectorResult(nextSequence, result);
      }
      if (requestedMode === "mira") {
        void refreshLarkConnection(result.appliedMode === "mira");
      } else if (requestedMode === "trae") {
        void refreshTraeConnection();
      }
    } catch (directorError) {
      if (!traeAbortController?.signal.aborted) {
        throw directorError;
      }
    } finally {
      if (runId === directorRunRef.current) {
        setDirectorLoading(false);
        setDirectorLoadingMode(null);
        activeTraeRequestRef.current = null;
        setActiveTraeRequestId("");
        activeTraeAbortRef.current = null;
      }
    }
  }

  function finishLocalTraeCancellation() {
    directorRunRef.current += 1;
    activeTraeAbortRef.current?.abort();
    activeTraeAbortRef.current = null;
    activeTraeRequestRef.current = null;
    setActiveTraeRequestId("");
    setDirectorLoading(false);
    setDirectorLoadingMode(null);
    setDirectorMode("rule");
    setFormationChoice((current) =>
      current ? { ...current, requestedMode: "rule" } : current,
    );
    setPendingDirectorResult(null);
    setSharedComparison(null);
    setFallbackReason(null);
    setFormationStatus("TRAE 分析已中断，当前占位和分镜已保留");
  }

  async function interruptTraeAnalysis(
    confirmInterruption = true,
  ): Promise<boolean> {
    const input = activeTraeRequestRef.current;
    if (
      directorLoadingMode !== "trae" ||
      !input ||
      traeCancelBusy
    ) {
      return false;
    }
    if (
      confirmInterruption &&
      !window.confirm(
        `确定中断对话 ${input.dialogue_prefix} 的 TRAE 分析吗？\n当前已显示的占位和分镜会保留。`,
      )
    ) {
      return false;
    }
    setTraeCancelBusy(true);
    setError("");
    finishLocalTraeCancellation();
    try {
      await cancelActiveTraeTask(
        input.request_id,
        input,
        "用户在镜头沙盘中断了 TRAE 分镜分析",
      );
      return true;
    } catch (cancelError) {
      setError(
        `本地等待已停止，但服务端任务取消失败：${
          cancelError instanceof Error
            ? cancelError.message
            : "未知错误"
        }`,
      );
      return false;
    } finally {
      setTraeCancelBusy(false);
    }
  }

  async function cancelTraeTaskFromStatus(requestId: string) {
    const isCurrentTask =
      activeTraeRequestRef.current?.request_id === requestId;
    if (isCurrentTask) {
      finishLocalTraeCancellation();
    }
    await cancelActiveTraeTask(requestId);
  }

  function focusPlanShot(
    nextShots: ShotPlan[],
    nextSequence: DialogueSequence,
    preserveCurrent: boolean,
  ) {
    const nextIndex =
      preserveCurrent && nextShots.length > 0
        ? Math.min(activeIndexRef.current, nextShots.length - 1)
        : 0;
    setActiveIndex(nextIndex);
    setSelectedDialogueId(
      nextShots[nextIndex]?.dialogueId ??
        nextShots[0]?.dialogueId ??
        nextSequence.rows[0]?.id ??
        "",
    );
  }

  function applyDirectorResult(
    sourceSequence: DialogueSequence,
    result: DirectorRunResult,
  ) {
    const preservesInputFormation =
      result.input.constraints.preserve_input_formation === true;
    const usesBlueprintFormation =
      preservesInputFormation &&
      result.participants.some(
        (participant) => participant.positionSource === "blueprint",
      );
    const playerPositionLocked =
      result.input.constraints.lock_player_position !== false;
    setSequence({
      ...sourceSequence,
      participants: result.participants,
    });
    setShots(result.shots);
    setAppliedDirector(result.appliedMode);
    setFallbackReason(result.fallbackReason);
    setDirectorAnalysis(result.analysis);
    replaceSoundEffectRecommendations(result.soundEffects);
    setDirectorBlocking(result.blocking);
    setActiveFormationSource(
      usesBlueprintFormation ? "blueprint" : "generated",
    );
    setActiveFormationVariant(
      result.appliedMode === "rule"
        ? usesBlueprintFormation
          ? "blueprint"
          : "generated"
        : "ai",
    );
    setFormationChoice((current) =>
      current && result.appliedMode !== "rule"
        ? {
            ...current,
            ai: { sequence: sourceSequence, result },
            ...(preservesInputFormation ? { playerPositionLocked } : {}),
          }
        : current,
    );
    setFormationStatus(
      result.appliedMode === "rule"
        ? usesBlueprintFormation
          ? blueprintFormationStatus(
              playerPositionLocked,
              formationChoice?.ignoredNpcCount,
            )
          : "使用规则导演自动安排的角色位置"
        : usesBlueprintFormation
          ? `${directorLabel(result.appliedMode)} 分镜沿用 BP 占位，0 号玩家${
              playerPositionLocked ? "固定" : "可调整"
            }`
          : preservesInputFormation
            ? `${directorLabel(result.appliedMode)} 分镜沿用当前占位`
          : `使用 ${directorLabel(result.appliedMode)} 返回的角色占位`,
    );
    focusPlanShot(result.shots, sourceSequence, true);
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
      setDirectorMode(selected.result.appliedMode);
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
    setContentSearch(null);
    cancelDialogueEdit();
    setDialogueSaveStatus("");
    const formationRunId = ++formationRunRef.current;
    directorRunRef.current += 1;
    traeForceRegenerateRef.current = false;
    setSequence(nextSequence);
    setShots([]);
    setActiveIndex(0);
    setSelectedDialogueId(nextSequence.rows[0]?.id ?? "");
    setFormationChoice(null);
    setFormationChoiceMode(null);
    setMissingNpcModelReview(null);
    setPendingDirectorResult(null);
    setSharedComparison(null);
    setDirectorLoading(false);
    setDirectorLoadingMode(null);
    setDirectorAnalysis(undefined);
    replaceSoundEffectRecommendations([]);
    setMusicOverridesByDialogueId(new Map());
    setFallbackReason(null);
    setError("");
    setActiveFormationSource("generated");
    setActiveFormationVariant("generated");
    setFormationStatus("正在检查 UE Blueprint 站位...");
    if (nextDatabase.sourceName === "内置演示数据") {
      setFormationStatus("使用规则导演自动安排的角色位置");
      await applySequence(nextSequence, requestedMode, {
        applyResultImmediately: requestedMode === "trae",
      });
      return;
    }

    setFormationChecking(true);
    const slowFormationNotice = window.setTimeout(() => {
      if (formationRunId === formationRunRef.current) {
        setFormationStatus(
          "BP 结构较复杂，UE 仍在读取站位与对话模型...",
        );
      }
    }, 8_000);
    let lookup: Awaited<ReturnType<typeof getBlueprintFormation>>;
    try {
      lookup = await getBlueprintFormation({
        dialogueId: prefix,
        startId: nextSequence.startId,
        formationClassPath: nextSequence.formation?.classPath,
      });
    } catch (formationError) {
      if (formationRunId !== formationRunRef.current) {
        return;
      }
      setFormationStatus(
        skippedBlueprintMessage(
          formationError instanceof Error
            ? formationError.message
            : "BP 站位读取失败",
        ),
      );
      await applySequence(nextSequence, requestedMode, {
        applyResultImmediately: requestedMode === "trae",
      });
      return;
    } finally {
      window.clearTimeout(slowFormationNotice);
      if (formationRunId === formationRunRef.current) {
        setFormationChecking(false);
      }
    }
    if (formationRunId !== formationRunRef.current) {
      return;
    }
    if (lookup.status === "found" && lookup.snapshot) {
      const missingModels = findMissingBlueprintNpcModels(
        nextDatabase,
        nextSequence,
        lookup.snapshot,
      );
      if (missingModels.length > 0) {
        setMissingNpcModelReview({
          database: nextDatabase,
          sourceSequence: nextSequence,
          snapshot: lookup.snapshot,
          requestedMode,
          issues: missingModels,
          ignoredNpcIds: new Set(),
          error: "",
        });
        setFormationStatus(
          `检测到 ${missingModels.length} 个对话 NPC 缺少可用 BP 模型，等待确认`,
        );
        return;
      }
      try {
        const choice = createFormationChoice(
          nextDatabase,
          nextSequence,
          lookup.snapshot,
          requestedMode,
          soundEffectCatalog.entries,
        );
        setFormationStatus(lookup.message);
        setFormationChoice(choice);
        setFormationChoiceMode(
          requestedMode === "trae" ? "director-request" : "initial",
        );
      } catch (mappingError) {
        setFormationStatus(
          skippedBlueprintMessage(
            mappingError instanceof Error
              ? mappingError.message
              : "BP 角色与对话 NPC 不匹配",
          ),
        );
        await applySequence(nextSequence, requestedMode, {
          applyResultImmediately: requestedMode === "trae",
        });
      }
      return;
    }
    setFormationStatus(skippedBlueprintMessage(lookup.message));
    await applySequence(nextSequence, requestedMode, {
      applyResultImmediately: requestedMode === "trae",
    });
  }

  function toggleIgnoredMissingNpc(npcId: number) {
    setMissingNpcModelReview((current) => {
      if (!current) {
        return current;
      }
      const ignoredNpcIds = new Set(current.ignoredNpcIds);
      if (ignoredNpcIds.has(npcId)) {
        ignoredNpcIds.delete(npcId);
      } else {
        ignoredNpcIds.add(npcId);
      }
      return { ...current, ignoredNpcIds, error: "" };
    });
  }

  function toggleAllMissingNpcs() {
    setMissingNpcModelReview((current) => {
      if (!current) {
        return current;
      }
      const allIgnored = current.issues.every((issue) =>
        current.ignoredNpcIds.has(issue.npcId),
      );
      return {
        ...current,
        ignoredNpcIds: allIgnored
          ? new Set()
          : new Set(current.issues.map((issue) => issue.npcId)),
        error: "",
      };
    });
  }

  function continueWithoutMissingNpcModels() {
    const review = missingNpcModelReview;
    if (
      !review ||
      review.issues.some(
        (issue) => !review.ignoredNpcIds.has(issue.npcId),
      )
    ) {
      return;
    }
    try {
      const choice = createFormationChoice(
        review.database,
        review.sourceSequence,
        review.snapshot,
        review.requestedMode,
        soundEffectCatalog.entries,
        undefined,
        false,
        review.ignoredNpcIds,
      );
      setMissingNpcModelReview(null);
      setFormationChoice(choice);
      setFormationChoiceMode(
        review.requestedMode === "trae"
          ? "director-request"
          : "initial",
      );
      setFormationStatus(
        `已忽略 ${review.issues.length} 个缺失 BP 模型的 NPC，请选择 BP 或规则占位`,
      );
    } catch (mappingError) {
      setMissingNpcModelReview((current) =>
        current
          ? {
              ...current,
              error:
                mappingError instanceof Error
                  ? mappingError.message
                  : "无法生成忽略缺失角色后的 BP 占位",
            }
          : current,
      );
    }
  }

  async function refreshMissingNpcModels() {
    const review = missingNpcModelReview;
    if (!review || formationChecking) {
      return;
    }
    const formationRunId = ++formationRunRef.current;
    setFormationChecking(true);
    setFormationStatus("正在重新读取 UE Blueprint 站位与模型...");
    setMissingNpcModelReview((current) =>
      current ? { ...current, error: "" } : current,
    );
    try {
      const lookup = await getBlueprintFormation({
        dialogueId: review.sourceSequence.prefix,
        startId: review.sourceSequence.startId,
        formationClassPath: review.sourceSequence.formation?.classPath,
      });
      if (formationRunId !== formationRunRef.current) {
        return;
      }
      if (lookup.status !== "found" || !lookup.snapshot) {
        setMissingNpcModelReview((current) =>
          current
            ? {
                ...current,
                error: lookup.message,
              }
            : current,
        );
        setFormationStatus(skippedBlueprintMessage(lookup.message));
        return;
      }
      const refreshedSnapshot = lookup.snapshot;
      const issues = findMissingBlueprintNpcModels(
        review.database,
        review.sourceSequence,
        refreshedSnapshot,
      );
      if (issues.length > 0) {
        setMissingNpcModelReview((current) =>
          current
            ? {
                ...current,
                snapshot: refreshedSnapshot,
                issues,
                ignoredNpcIds: new Set(
                  issues
                    .filter((issue) =>
                      current.ignoredNpcIds.has(issue.npcId),
                    )
                    .map((issue) => issue.npcId),
                ),
                error: "",
              }
            : current,
        );
        setFormationStatus(
          `刷新后仍有 ${issues.length} 个对话 NPC 缺少可用 BP 模型`,
        );
        return;
      }
      try {
        const choice = createFormationChoice(
          review.database,
          review.sourceSequence,
          lookup.snapshot,
          review.requestedMode,
          soundEffectCatalog.entries,
        );
        setMissingNpcModelReview(null);
        setFormationChoice(choice);
        setFormationStatus(`${lookup.message}，缺失模型已补齐`);
        setFormationChoiceMode(
          review.requestedMode === "trae"
            ? "director-request"
            : "initial",
        );
      } catch (mappingError) {
        setMissingNpcModelReview(null);
        setFormationStatus(
          skippedBlueprintMessage(
            mappingError instanceof Error
              ? mappingError.message
              : "BP 角色与对话 NPC 不匹配",
          ),
        );
        await applySequence(
          review.sourceSequence,
          review.requestedMode,
          {
            applyResultImmediately: review.requestedMode === "trae",
          },
        );
      }
    } catch (formationError) {
      if (formationRunId !== formationRunRef.current) {
        return;
      }
      setMissingNpcModelReview((current) =>
        current
          ? {
              ...current,
              error:
                formationError instanceof Error
                  ? formationError.message
                  : "BP 站位重新读取失败",
            }
          : current,
      );
    } finally {
      if (formationRunId === formationRunRef.current) {
        setFormationChecking(false);
      }
    }
  }

  async function refreshBlueprintFormation() {
    if (!formationChoice || formationChecking || traeCancelBusy) {
      return;
    }
    let requestedMode = formationChoice.requestedMode;
    if (directorLoading) {
      if (
        directorLoadingMode !== "trae" ||
        !(await interruptTraeAnalysis())
      ) {
        return;
      }
      requestedMode = "rule";
    }
    if (!sequence.prefix) {
      return;
    }
    const formationRunId = ++formationRunRef.current;
    setFormationChecking(true);
    setFormationStatus("正在重新读取 UE Blueprint 站位...");
    setError("");
    const slowFormationNotice = window.setTimeout(() => {
      if (formationRunId === formationRunRef.current) {
        setFormationStatus(
          "BP 结构较复杂，UE 仍在读取最新站位与对话模型...",
        );
      }
    }, 8_000);
    try {
      const sourceSequence = findDialogueSequence(database, sequence.prefix);
      const lookup = await getBlueprintFormation({
        dialogueId: sourceSequence.prefix,
        startId: sourceSequence.startId,
        formationClassPath: sourceSequence.formation?.classPath,
      });
      if (formationRunId !== formationRunRef.current) {
        return;
      }
      if (lookup.status !== "found" || !lookup.snapshot) {
        setFormationStatus(skippedBlueprintMessage(lookup.message));
        return;
      }
      try {
        const choice = createFormationChoice(
          database,
          sourceSequence,
          lookup.snapshot,
          requestedMode,
          soundEffectCatalog.entries,
          formationChoice.ai,
          formationChoice.playerPositionLocked,
        );
        setFormationChoice(choice);
        setFormationStatus(`${lookup.message}，请确认是否采用最新位置`);
        setFormationChoiceMode("switch");
      } catch (mappingError) {
        setFormationChoice(null);
        setFormationChoiceMode(null);
        setFormationStatus(
          skippedBlueprintMessage(
            mappingError instanceof Error
              ? mappingError.message
              : "BP 角色与对话 NPC 不匹配",
          ),
        );
        await applySequence(sourceSequence, requestedMode, {
          applyResultImmediately: requestedMode === "trae",
        });
      }
    } catch (formationError) {
      if (formationRunId !== formationRunRef.current) {
        return;
      }
      setFormationStatus(
        skippedBlueprintMessage(
          formationError instanceof Error
            ? formationError.message
            : "BP 站位重新读取失败",
        ),
      );
    } finally {
      window.clearTimeout(slowFormationNotice);
      if (formationRunId === formationRunRef.current) {
        setFormationChecking(false);
      }
    }
  }

  function chooseFormation(
    choice: FormationOptionId,
    playerPositionLocked: boolean,
  ) {
    if (!formationChoice) {
      return;
    }
    const selectionMode = formationChoiceMode;
    const nextFormationChoice = {
      ...formationChoice,
      playerPositionLocked,
      requestedMode:
        selectionMode === "director-request"
          ? ("trae" as const)
          : formationChoice.requestedMode,
    };
    setFormationChoice(nextFormationChoice);
    setFormationChoiceMode(null);
    const useBlueprint = choice === "blueprint";
    const blueprintPreview = playerPositionLocked
      ? nextFormationChoice.blueprintPlayerLocked
      : nextFormationChoice.blueprint;
    if (selectionMode === "director-request") {
      const existingTraePlan = nextFormationChoice.ai;
      const existingMatchesStrategy =
        existingTraePlan?.result.appliedMode === "trae" &&
        existingTraePlan.result.input.constraints
          .preserve_input_formation === useBlueprint &&
        (!useBlueprint ||
          (existingTraePlan.result.input.constraints.lock_player_position !==
            false) === playerPositionLocked);
      if (
        existingMatchesStrategy &&
        !traeForceRegenerateRef.current &&
        existingTraePlan
      ) {
        applyDirectorResult(
          existingTraePlan.sequence,
          existingTraePlan.result,
        );
        return;
      }

      const selectedSequence =
        nextFormationChoice.blueprintPlayerLocked.sequence;
      setActiveFormationSource(useBlueprint ? "blueprint" : "generated");
      setActiveFormationVariant(useBlueprint ? "blueprint" : "generated");
      setFormationStatus(
        useBlueprint
          ? blueprintFormationStatus(
              playerPositionLocked,
              nextFormationChoice.ignoredNpcCount,
            )
          : "TRAE 将自主设计全部角色占位",
      );
      void applySequence(selectedSequence, "trae", {
        preserveInputPositions: useBlueprint,
        lockPlayerPosition: playerPositionLocked,
        fallbackPreserveInputPositions: useBlueprint,
        forceRegenerate: traeForceRegenerateRef.current,
        preserveActiveShot: true,
        applyResultImmediately: true,
      });
      return;
    }
    if (selectionMode === "switch") {
      setPendingDirectorResult(null);
      setSharedComparison(null);
      setFallbackReason(null);
      setError("");
      if (choice === "ai" && formationChoice.ai) {
        applyDirectorResult(
          formationChoice.ai.sequence,
          formationChoice.ai.result,
        );
        return;
      }
      const selectedPreview =
        choice === "blueprint"
          ? blueprintPreview
          : nextFormationChoice.generated;
      setSequence(selectedPreview.sequence);
      setShots(selectedPreview.shots);
      setAppliedDirector("rule");
      setDirectorAnalysis(selectedPreview.analysis);
      replaceSoundEffectRecommendations(selectedPreview.soundEffects);
      setDirectorBlocking(selectedPreview.blocking);
      setActiveFormationSource(
        choice === "blueprint" ? "blueprint" : "generated",
      );
      setActiveFormationVariant(choice);
      setFormationStatus(
        choice === "blueprint"
          ? blueprintFormationStatus(
              playerPositionLocked,
              nextFormationChoice.ignoredNpcCount,
            )
          : "使用规则导演自动安排的角色位置",
      );
      focusPlanShot(selectedPreview.shots, selectedPreview.sequence, true);
      return;
    }
    const selected = useBlueprint
      ? nextFormationChoice.blueprintPlayerLocked.sequence
      : nextFormationChoice.requestedMode === "trae"
        ? nextFormationChoice.blueprintPlayerLocked.sequence
        : nextFormationChoice.sourceSequence;
    setActiveFormationSource(useBlueprint ? "blueprint" : "generated");
    setActiveFormationVariant(choice);
    setFormationStatus(
      useBlueprint
        ? blueprintFormationStatus(
            playerPositionLocked,
            nextFormationChoice.ignoredNpcCount,
          )
        : nextFormationChoice.requestedMode === "trae"
          ? "TRAE 将自主设计全部角色占位"
          : "使用规则导演自动安排的角色位置",
    );
    void applySequence(selected, nextFormationChoice.requestedMode, {
      preserveInputPositions: useBlueprint,
      lockPlayerPosition: playerPositionLocked,
      fallbackPreserveInputPositions: useBlueprint,
      applyResultImmediately:
        nextFormationChoice.requestedMode === "trae",
    });
  }

  function choosePendingDirectorFormation(choice: FormationSelectionId) {
    if (
      !pendingDirectorResult ||
      (choice !== "current" && choice !== "ai")
    ) {
      return;
    }
    const currentFormationSequence = sequence;
    const pending = pendingDirectorResult;
    applyDirectorResult(pending.sequence, pending.result);
    setDirectorMode(pending.result.appliedMode);
    setPendingDirectorResult(null);
    if (choice === "ai") {
      return;
    }
    void applySequence(currentFormationSequence, pending.result.appliedMode, {
      preserveInputPositions: true,
      lockPlayerPosition:
        formationChoice?.playerPositionLocked ?? true,
      fallbackPreserveInputPositions: true,
      keepCurrentPreview: true,
      forceRegenerate: true,
      preserveActiveShot: true,
      applyResultImmediately: true,
    });
  }

  function openContentSearchContext(
    context: DialogueContentSearchContext,
    dialogueNodeId: string,
  ) {
    formationRunRef.current += 1;
    directorRunRef.current += 1;
    const cached = designedStoryboards.get(context.prefix);
    const nextSequence = cached?.sequence ?? context.sequence;
    const nextShots = cached?.shots ?? [];
    const shotIndex = nextShots.findIndex((shot) =>
      shot.dialogueIds.includes(dialogueNodeId),
    );
    setSequence(nextSequence);
    setShots(nextShots);
    setActiveIndex(Math.max(0, shotIndex));
    setSelectedDialogueId(dialogueNodeId);
    setFormationChoice(cached?.formationChoice ?? null);
    setFormationChoiceMode(null);
    setMissingNpcModelReview(null);
    setPendingDirectorResult(null);
    setSharedComparison(null);
    setFormationChecking(false);
    setDirectorLoading(false);
    setDirectorLoadingMode(null);
    setFallbackReason(null);
    setAppliedDirector(cached?.appliedDirector ?? "rule");
    setDirectorAnalysis(cached?.directorAnalysis);
    replaceSoundEffectRecommendations(cached?.soundEffects ?? []);
    if (cached) {
      setDirectorBlocking(cached.directorBlocking);
    }
    setActiveFormationSource(cached?.activeFormationSource ?? "generated");
    setActiveFormationVariant(
      cached?.activeFormationVariant ?? "generated",
    );
    setFormationStatus(cached?.formationStatus ?? "");
    setError("");
    setDialogueSaveStatus("");
    cancelDialogueEdit();
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (/^\d+$/.test(normalizedQuery)) {
      if (!/^\d{4}$/.test(normalizedQuery)) {
        setError("请输入四位数对话 ID，或输入对白文字");
        return;
      }
      void applySearch(database, normalizedQuery).catch((searchError) => {
        setError(
          searchError instanceof Error ? searchError.message : "查询失败",
        );
        setDirectorLoading(false);
        setDirectorLoadingMode(null);
      });
      return;
    }
    try {
      const result = searchDialogueContent(database, normalizedQuery);
      if (result.contexts.length === 0) {
        throw new Error(`没有找到包含“${normalizedQuery}”的对白`);
      }
      setContentSearch(result);
      const firstContext = result.contexts[0];
      openContentSearchContext(
        firstContext,
        firstContext.matchedDialogueIds[0],
      );
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "查询失败");
    }
  }

  function useDatabase(nextDatabase: DialogueDatabase) {
    if (!nextDatabase.starts.some((start) => /^\d{4}/.test(start.id))) {
      throw new Error("开始节点表中没有可用的四位数对话 ID");
    }
    setDatabase(nextDatabase);
    setContentSearch(null);
    setDesignedStoryboards(new Map());
    setQuery("");
    setSequence(emptySequence);
    setShots([]);
    setActiveIndex(0);
    setSelectedDialogueId("");
    setFormationChoice(null);
    setFormationChoiceMode(null);
    setMissingNpcModelReview(null);
    setFormationChecking(false);
    setFormationStatus("");
    setPendingDirectorResult(null);
    setSharedComparison(null);
    setDirectorLoading(false);
    setDirectorLoadingMode(null);
    setFallbackReason(null);
    setDirectorAnalysis(undefined);
    replaceSoundEffectRecommendations([]);
    setActiveFormationSource("generated");
    setActiveFormationVariant("generated");
    setAppliedDirector("rule");
    setError("");
  }

  function changeDirectorMode(mode: DirectorMode) {
    const forceRegenerate =
      mode === "trae" && directorMode === "trae";
    if (mode === directorMode && mode !== "trae") {
      return;
    }
    setDirectorMode(mode);
    setFallbackReason(null);
    if (formationChecking && mode === "rule") {
      formationRunRef.current += 1;
      setFormationChecking(false);
      setFormationChoice(null);
      setFormationChoiceMode(null);
      void applySequence(sequence, "rule", {
        preserveInputPositions: activeFormationSource === "blueprint",
        lockPlayerPosition:
          formationChoice?.playerPositionLocked ?? true,
        preserveActiveShot: true,
      });
      return;
    }
    if (contentSearch) {
      if (mode === "mira") {
        void refreshLarkConnection(true);
      } else if (mode === "trae") {
        void refreshTraeConnection();
      }
      return;
    }
    if (
      mode !== "rule" &&
      pendingDirectorResult?.reviewFormation === false &&
      pendingDirectorResult.result.appliedMode === mode
    ) {
      applyDirectorResult(
        pendingDirectorResult.sequence,
        pendingDirectorResult.result,
      );
      setPendingDirectorResult(null);
      return;
    }
    if (mode === "mira") {
      void refreshLarkConnection(true);
    } else if (mode === "trae") {
      void refreshTraeConnection();
      if (
        formationChoice &&
        query === sequence.prefix &&
        !formationChecking &&
        !formationChoiceMode &&
        !directorLoading
      ) {
        traeForceRegenerateRef.current = forceRegenerate;
        setFormationChoiceMode("director-request");
        return;
      }
      if (
        query === sequence.prefix &&
        !formationChecking &&
        !formationChoiceMode &&
        !directorLoading
      ) {
        void applySequence(sequence, "trae", {
          keepCurrentPreview: true,
          preserveInputPositions: false,
          fallbackPreserveInputPositions: true,
          forceRegenerate,
          applyResultImmediately: true,
        });
      }
    } else {
      setActiveFormationVariant(
        activeFormationSource === "blueprint"
          ? "blueprint"
          : "generated",
      );
      setFormationStatus(
        activeFormationSource === "blueprint"
          ? blueprintFormationStatus(
              formationChoice?.playerPositionLocked ?? true,
              formationChoice?.ignoredNpcCount,
            )
          : "使用规则导演自动安排的角色位置",
      );
      void applySequence(sequence, "rule", {
        preserveInputPositions: activeFormationSource === "blueprint",
        lockPlayerPosition:
          formationChoice?.playerPositionLocked ?? true,
        preserveActiveShot: true,
        keepBackgroundRequest: directorLoading,
      });
    }
  }

  async function changeConfigurationMode(enabled: boolean) {
    if (configurationModeBusy) {
      return;
    }
    const rightPanelBounds = document
      .querySelector<HTMLElement>(".right-panel")
      ?.getBoundingClientRect();
    const headerBounds = document
      .querySelector<HTMLElement>(".app-header")
      ?.getBoundingClientRect();
    const contentSize =
      enabled && rightPanelBounds
        ? {
            width: Math.round(rightPanelBounds.width),
            height: Math.round(
              rightPanelBounds.height + (headerBounds?.height ?? 54),
            ),
          }
        : undefined;
    setConfigurationModeBusy(true);
    setConfigurationModeTransition(true);
    setError("");
    try {
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      await window.shotSandboxDesktop?.setConfigurationWindowMode?.(
        enabled,
        contentSize,
      );
      if (enabled && inspectorTab !== "audio" && inspectorTab !== "ue") {
        setInspectorTab("audio");
      }
      setConfigurationMode(enabled);
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => resolve()),
        ),
      );
    } catch (windowError) {
      if (!enabled) {
        setConfigurationMode(false);
      }
      setError(
        windowError instanceof Error
          ? windowError.message
          : "无法切换配置小窗",
      );
    } finally {
      setConfigurationModeTransition(false);
      setConfigurationModeBusy(false);
    }
  }

  async function openStoryboardExport() {
    if (configurationMode) {
      await changeConfigurationMode(false);
    }
    await previewStoryboardExport();
  }

  async function chooseDirectory(
    kind: "live" | "config" = "live",
  ) {
    setError("");
    const desktop = window.shotSandboxDesktop;
    if (desktop?.chooseDataDirectory) {
      const previousSetup = desktopSetup ?? await desktop.getSetupStatus();
      setLoading(true);
      try {
        const setup = await desktop.chooseDataDirectory(kind);
        if (!setup) {
          return;
        }
        setDesktopSetup(setup);
        if (setup.defaultDataReady) {
          useDatabase(await loadConfiguredDatabase());
        }
      } catch (directoryError) {
        if (previousSetup && desktop.restoreDataDirectories) {
          try {
            setDesktopSetup(
              await desktop.restoreDataDirectories(
                previousSetup.liveResDirectory,
                previousSetup.configDocDirectory,
              ),
            );
          } catch {
            // Preserve the original selection or parse error shown below.
          }
        }
        setError(
          directoryError instanceof Error
            ? directoryError.message
            : "无法读取所选目录",
        );
      } finally {
        setLoading(false);
      }
      return;
    }
    if (desktop) {
      directorySelectionKindRef.current = kind;
      fileInputRef.current?.click();
      return;
    }
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

  async function openDesktopSetup() {
    const desktop = window.shotSandboxDesktop;
    if (!desktop) {
      return;
    }
    setError("");
    try {
      const status = await desktop.getSetupStatus();
      setDesktopSetup(status);
      setShowDesktopSetup(true);
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "无法读取桌面版设置",
      );
    }
  }

  async function completeDesktopFirstRun() {
    const desktop = window.shotSandboxDesktop;
    if (!desktop || !desktopSetup?.defaultDataReady) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const status = await desktop.completeSetup();
      setDesktopSetup(status);
      setShowDesktopFirstRun(false);
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "无法保存首次启动设置",
      );
    } finally {
      setLoading(false);
    }
  }

  async function importDirectory(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    const desktop = window.shotSandboxDesktop;
    let previousSetup = desktopSetup;
    let shouldRestoreDirectories = false;
    setLoading(true);
    try {
      if (desktop) {
        if (
          !desktop.setLiveResDirectory ||
          !desktop.setConfigDocDirectory
        ) {
          throw new Error("当前桌面版不支持 res/doc 双目录设置");
        }
        previousSetup ??= await desktop.getSetupStatus();
        const selectionKind = directorySelectionKindRef.current;
        const representativeFile = findDocCsvFile(
          Array.from(files),
          selectionKind === "live" ? "对话表.csv" : "NPC表.csv",
        );
        if (!representativeFile) {
          throw new Error(
            selectionKind === "live"
              ? "选择的目录中未找到对话表.csv"
              : "选择的目录中未找到 NPC表.csv",
          );
        }
        const filePath = desktop.getPathForFile(representativeFile);
        const rootDirectory =
          selectionKind === "live"
            ? rootDirectoryFromFile(
                filePath,
                "Content\\Seria\\Tables\\csvdir\\对话表.csv",
              )
            : rootDirectoryFromFile(
                filePath,
                "csvdir\\NPC表.csv",
              );
        const setup =
          selectionKind === "live"
            ? await desktop.setLiveResDirectory(rootDirectory)
            : await desktop.setConfigDocDirectory(rootDirectory);
        shouldRestoreDirectories = true;
        setDesktopSetup(setup);
        if (setup.defaultDataReady) {
          useDatabase(await loadConfiguredDatabase());
        }
      } else {
        useDatabase(await loadDocFiles(files));
      }
    } catch (fileError) {
      if (
        shouldRestoreDirectories &&
        previousSetup &&
        desktop?.restoreDataDirectories
      ) {
        try {
          setDesktopSetup(
            await desktop.restoreDataDirectories(
              previousSetup.liveResDirectory,
              previousSetup.configDocDirectory,
            ),
          );
        } catch {
          // Preserve the original parse/load error shown below.
        }
      }
      setError(fileError instanceof Error ? fileError.message : "目录读取失败");
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function selectShot(nextIndex: number) {
    setActiveIndex(nextIndex);
    setSelectedDialogueId(shots[nextIndex]?.dialogueId ?? "");
    setDialogueSaveStatus("");
    cancelDialogueEdit();
  }

  function moveShot(offset: number) {
    selectShot(
      Math.min(shots.length - 1, Math.max(0, activeIndex + offset)),
    );
  }

  function beginDialogueEdit() {
    if (!activeDialogueRow || database.sourceName === "内置演示数据") {
      return;
    }
    setEditingDialogueId(activeDialogueRow.id);
    setDialogueDraft(activeDialogueRow.content);
    setDialogueSaveError("");
    setDialogueSaveStatus("");
  }

  function cancelDialogueEdit() {
    if (dialogueSaveBusy) {
      return;
    }
    setEditingDialogueId(null);
    setDialogueDraft("");
    setDialogueSaveError("");
  }

  async function saveDialogueEdit() {
    if (
      !activeDialogueRow ||
      editingDialogueId !== activeDialogueRow.id ||
      dialogueSaveBusy
    ) {
      return;
    }
    const content = dialogueDraft.trim();
    if (!content) {
      setDialogueSaveError("对白内容不能为空");
      return;
    }
    setDialogueSaveBusy(true);
    setDialogueSaveError("");
    setDialogueSaveStatus("");
    try {
      const result = await updateDialogueContent({
        dialogueId: sequence.prefix,
        startId: sequence.startId,
        dialogueNodeId: activeDialogueRow.id,
        previousContent: activeDialogueRow.content,
        content,
      });
      const nextDatabase = {
        ...database,
        dialogueRows: database.dialogueRows.map((row) =>
          row.id === activeDialogueRow.id ? { ...row, content } : row,
        ),
      };
      const nextSequence = withUpdatedDialogueContent(
        sequence,
        activeDialogueRow.id,
        content,
      );
      const nextShots = refreshShotDialogueText(nextSequence, shots);
      setDatabase(nextDatabase);
      setSequence(nextSequence);
      setShots(nextShots);
      setDesignedStoryboards((current) => {
        const next = new Map(current);
        for (const [prefix, cached] of next) {
          if (
            !cached.sequence.rows.some(
              (row) => row.id === activeDialogueRow.id,
            )
          ) {
            continue;
          }
          const cachedSequence = withUpdatedDialogueContent(
            cached.sequence,
            activeDialogueRow.id,
            content,
          );
          next.set(prefix, {
            ...cached,
            sequence: cachedSequence,
            shots: refreshShotDialogueText(cachedSequence, cached.shots),
          });
        }
        return next;
      });
      setQuery(sequence.prefix);
      setContentSearch(null);
      setDialogueSaveStatus(
        result.status === "unchanged"
          ? `节点 ${activeDialogueRow.id} 已与 UE 一致`
          : `节点 ${activeDialogueRow.id} 已写入并保存`,
      );
      setEditingDialogueId(null);
      setDialogueDraft("");
    } catch (saveError) {
      setDialogueSaveError(
        saveError instanceof Error ? saveError.message : "对白保存失败",
      );
    } finally {
      setDialogueSaveBusy(false);
    }
  }

  async function saveDialogueTextChanges(
    items: DialogueContentUpdateRequest[],
  ) {
    if (items.length === 0 || dialogueSaveBusy) {
      return;
    }
    const assetCount = new Set(items.map((item) => item.startId)).size;
    if (
      !window.confirm(
        `将修改 ${items.length} 条对白，涉及 ${assetCount} 个对话资产。` +
          "\n写入前会校验 UE 原文，成功后保存对应资产。" +
          "\n\n是否继续？",
      )
    ) {
      return;
    }
    setDialogueSaveBusy(true);
    setDialogueSaveError("");
    setDialogueSaveStatus("");
    try {
      const result = await updateDialogueContents({ items });
      const updates = new Map(
        result.items.map((item) => [
          item.dialogueNodeId,
          item.content,
        ]),
      );
      const nextDatabase = {
        ...database,
        dialogueRows: database.dialogueRows.map((row) =>
          updates.has(row.id)
            ? { ...row, content: updates.get(row.id)! }
            : row,
        ),
      };
      setDatabase(nextDatabase);
      const nextSequence = withUpdatedDialogueContents(sequence, updates);
      setSequence(nextSequence);
      setShots((current) =>
        refreshShotDialogueText(nextSequence, current),
      );
      setContentSearch((current) => {
        if (!current) {
          return current;
        }
        const refreshed = searchDialogueContent(
          nextDatabase,
          current.query,
        );
        return refreshed.contexts.length > 0 ? refreshed : null;
      });
      setDesignedStoryboards((current) => {
        const next = new Map(current);
        for (const [prefix, cached] of next) {
          if (
            !cached.sequence.rows.some((row) => updates.has(row.id))
          ) {
            continue;
          }
          const cachedSequence = withUpdatedDialogueContents(
            cached.sequence,
            updates,
          );
          next.set(prefix, {
            ...cached,
            sequence: cachedSequence,
            shots: refreshShotDialogueText(
              cachedSequence,
              cached.shots,
            ),
          });
        }
        return next;
      });
      setShowDialogueTextEditor(false);
      setDialogueSaveStatus(
        `已修改 ${result.updatedCount} 条对白并保存 ${result.savedAssetCount} 个对话资产`,
      );
    } catch (saveError) {
      setDialogueSaveError(
        saveError instanceof Error
          ? saveError.message
          : "批量对白保存失败",
      );
    } finally {
      setDialogueSaveBusy(false);
    }
  }

  return (
    <main
      className="app-shell"
      data-ark-theme="endfield"
      data-ark-depth="moderate"
      data-workspace-direction={workspaceDirection}
      data-configuration-mode={configurationMode}
      data-configuration-transition={configurationModeTransition}
    >
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

      <nav className="app-rail" aria-label="全局工具">
        <div className="app-rail__brand" aria-hidden="true">
          <Clapperboard size={22} strokeWidth={2} />
          <span>
            镜头沙盘 <small>{APP_VERSION}</small>
          </span>
        </div>
        <div className="app-rail__tools">
          <button
            className={`app-rail__button ${
              activeWorkspace === "storyboard" ? "is-active" : ""
            }`}
            type="button"
            aria-current={
              activeWorkspace === "storyboard" ? "page" : undefined
            }
            title="分镜工作台"
            onClick={() => switchWorkspace("storyboard")}
          >
            <Camera size={19} />
            <span>分镜工作台</span>
          </button>
          <button
            className={`app-rail__button ${
              activeWorkspace === "npc" ? "is-active" : ""
            }`}
            type="button"
            aria-current={activeWorkspace === "npc" ? "page" : undefined}
            title="注册 NPC"
            onClick={() => switchWorkspace("npc")}
          >
            <UserRoundPlus size={19} />
            <span>注册 NPC</span>
          </button>
          <button
            className={`app-rail__button ${
              activeWorkspace === "targets" ? "is-active" : ""
            }`}
            type="button"
            aria-current={
              activeWorkspace === "targets" ? "page" : undefined
            }
            title="任务目标物"
            onClick={() => switchWorkspace("targets")}
          >
            <MapPinned size={19} />
            <span>任务目标物</span>
          </button>
        </div>
        <div className="app-rail__tools app-rail__tools--bottom">
          <button
            className="app-rail__button app-rail__button--primary"
            type="button"
            title={
              window.shotSandboxDesktop
                ? "桌面版设置与更新"
                : "选择数据目录"
            }
            aria-label={
              window.shotSandboxDesktop
                ? "桌面版设置与更新"
                : "选择数据目录"
            }
            disabled={loading}
            onClick={() =>
              window.shotSandboxDesktop
                ? void openDesktopSetup()
                : void chooseDirectory()
            }
          >
            {loading ? (
              <LoaderCircle className="spin" size={19} />
            ) : (
              <Settings size={19} />
            )}
            <span>{loading ? "读取中..." : "设置与更新"}</span>
          </button>
        </div>
      </nav>

      <header className="app-header">
        <div
          className="brand workspace-identity"
          key={activeWorkspace}
        >
          <span className="workspace-identity__mark" aria-hidden="true">
            {activeWorkspace === "storyboard" ? (
              <Camera size={18} />
            ) : activeWorkspace === "npc" ? (
              <UserRoundPlus size={18} />
            ) : (
              <MapPinned size={18} />
            )}
          </span>
          <div>
            <h1>
              {activeWorkspace === "storyboard"
                ? "分镜工作台"
                : activeWorkspace === "npc"
                  ? "注册 NPC"
                  : "任务目标物"}
            </h1>
            <p>
              {activeWorkspace === "storyboard"
                ? "DIALOGUE CAMERA SYSTEM"
                : activeWorkspace === "npc"
                  ? "UE SELECTION REGISTRATION"
                  : "MISSION TARGET & BLUEPRINT"}
            </p>
          </div>
        </div>

        <div className="app-header__status">
          {activeWorkspace === "storyboard" && (
            <WorkspaceStatusHub
              mode={directorMode}
              traeLoading={traeLoading}
              traeStatus={traeStatus}
              traeError={traeError}
              larkLoading={larkLoading}
              larkStatus={larkStatus}
              larkError={larkError}
              onRefreshTrae={() => void refreshTraeConnection()}
              onSetupTrae={() => void setupTrae()}
              onRefreshLark={() => void refreshLarkConnection(true)}
              onAuthorize={() => void beginAuthorization()}
              onReorderPendingTasks={reorderPendingTasks}
              onDeletePendingTask={deletePendingTask}
              onCancelTask={cancelTraeTaskFromStatus}
              disabled={configurationMode || configurationModeBusy}
            />
          )}
          <DataSourceStatus
            sourceName={database.sourceName}
            dialogueCount={sourceStats.dialogues}
            npcCount={sourceStats.npcs}
            setupStatus={desktopSetup}
            larkLoading={larkLoading}
            larkStatus={larkStatus}
            larkError={larkError}
            collectRevisionCases={collectRevisionCases}
            onRefreshLark={() => void refreshLarkConnection(true)}
            onAuthorize={() => void beginAuthorization()}
            onCollectRevisionCasesChange={changeCaseCollection}
            disabled={configurationMode || configurationModeBusy}
            onOpenSettings={
              window.shotSandboxDesktop
                ? () => void openDesktopSetup()
                : undefined
            }
          />
        </div>
      </header>

      <div
        className="workspace"
        data-workspace-state={
          activeWorkspace === "storyboard"
            ? outgoingWorkspace
              ? "entering"
              : "active"
            : outgoingWorkspace === "storyboard"
              ? "exiting"
              : "inactive"
        }
        hidden={
          activeWorkspace !== "storyboard" &&
          outgoingWorkspace !== "storyboard"
        }
        aria-hidden={activeWorkspace !== "storyboard" || undefined}
        inert={activeWorkspace !== "storyboard" || undefined}
      >
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
              <label htmlFor="dialogue-id">四位数对话 ID 或对白内容</label>
              <div className="input-row">
                <input
                  id="dialogue-id"
                  maxLength={120}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="例如 7352 或台词关键词"
                  disabled={loading}
                />
                <button
                  className="button button--primary query-analysis-button"
                  type="submit"
                  title={
                    queryIsDialogueId
                      ? "分析对话与站位"
                      : "搜索对白内容"
                  }
                  aria-label={
                    queryIsDialogueId
                      ? "分析对话与站位"
                      : "搜索对白内容"
                  }
                  disabled={
                    loading ||
                    directorLoading ||
                    formationChecking ||
                    query.trim().length === 0
                  }
                >
                  {directorLoading || formationChecking ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Search size={18} />
                  )}
                  <span>{queryIsDialogueId ? "分析" : "搜索"}</span>
                </button>
              </div>
            </form>
            {(formationStatus || formationChoice) && (
              <div
                className={`formation-status formation-status--${activeFormationSource}`}
                role="status"
              >
                <Boxes size={15} />
                <div className="formation-status__content">
                  <small>占位方案</small>
                  {activeFormationVariant === "blueprint" &&
                  formationChoiceMode !== "initial" &&
                  formationChoice ? (
                    <button
                      className="formation-status__reload"
                      type="button"
                      title={
                        directorLoadingMode === "trae"
                          ? `中断 TRAE 并重新读取 ${activeFormationName} 位置`
                          : `重新读取 ${activeFormationName} 位置`
                      }
                      aria-label={`重新读取 ${activeFormationName} 位置`}
                      disabled={
                        formationChecking ||
                        traeCancelBusy ||
                        (directorLoading && directorLoadingMode !== "trae")
                      }
                      onClick={() => void refreshBlueprintFormation()}
                    >
                      <strong>
                        {formationChecking ? "正在读取 BP" : activeFormationName}
                      </strong>
                      {formationChecking ? (
                        <LoaderCircle className="spin" size={13} />
                      ) : (
                        <RefreshCw size={13} />
                      )}
                    </button>
                  ) : (
                    <strong>
                      {formationChecking
                        ? "正在读取 BP"
                        : formationChoiceMode === "initial"
                          ? "等待选择"
                          : activeFormationName}
                    </strong>
                  )}
                  {formationStatus && <span>{formationStatus}</span>}
                </div>
                {formationChoice &&
                  formationChoiceMode !== "initial" &&
                  availableFormationOptionCount > 1 && (
                    <button
                      className="icon-button formation-status__switch"
                      type="button"
                      title={`切换占位方案，共 ${availableFormationOptionCount} 个可用方案`}
                      aria-label="切换占位方案"
                      disabled={directorLoading || formationChecking}
                      onClick={() => setFormationChoiceMode("switch")}
                    >
                      <ArrowLeftRight size={15} />
                    </button>
                  )}
              </div>
            )}
            {!activeShot && dialogueSaveStatus && (
              <div
                className="formation-status formation-status--blueprint"
                role="status"
              >
                <Check size={15} />
                <span>{dialogueSaveStatus}</span>
              </div>
            )}
            <DirectorControl
              mode={directorMode}
              appliedMode={appliedDirector}
              loading={directorLoading || formationChecking}
              onModeChange={changeDirectorMode}
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
                  {directorMode === "trae"
                    ? "TRAE 协作本次未完成，当前显示规则导演结果："
                    : `${directorLabel(directorMode)} 未生效，已自动使用规则导演：`}
                  {fallbackReason}
                </span>
              </div>
            )}
          </section>

          {!activeShot && hasLoadedDialogue && (
            <section className="panel-section cast-section">
              <div className="section-label">
                <span>场景角色</span>
                <small>{sequence.participants.length} 位</small>
              </div>
              <div className="cast-list">
                {sequence.participants.map((participant) => (
                  <div className="cast-row" key={participant.instanceId}>
                    <span
                      className="cast-row__slot"
                      style={{ backgroundColor: participant.color }}
                    >
                      {participantSlotLabel(participant)}
                    </span>
                    <div>
                      <strong>{participant.name}</strong>
                      <small>
                        {dialogueParticipantSlotSet.has(participant.slot)
                          ? "对白角色 · "
                          : "背景 NPC · "}
                        {participant.positionSource === "blueprint"
                          ? `BP ${participant.modelIndex ?? "?"} · 初始朝向 ${participantFacingYawDegrees(participant).toFixed(0)}° · `
                          : `NPC ${participant.id} · `}
                        登场 {participant.entryDialogueId} · 离场{" "}
                        {participant.exitDialogueId ?? "本场结束"}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section
            className={`shot-list-section ${
              contentSearch ? "has-floating-action" : ""
            }`}
          >
            <div className="section-label section-label--sticky">
              <span>
                {contentSearch
                  ? "文字搜索"
                  : activeShot
                    ? "镜头列表"
                    : hasLoadedDialogue
                      ? "对话文本"
                      : "等待查询"}
              </span>
              <small>
                {contentSearch ? (
                  <>
                    {contentSearch.totalMatchCount} 处命中 ·{" "}
                    {contentSearch.totalContextCount} 组对话
                    {contentSearch.truncated ? " · 仅显示前 100 组" : ""}
                  </>
                ) : activeShot ? (
                  <>
                    {shots.length} 镜 ·{" "}
                    {directorLoading && directorMode !== "rule"
                      ? browsingPreviousAiPlan
                        ? `${directorLabel(appliedDirector)} 已出方案`
                        : "本地预览"
                      : directorLabel(appliedDirector)}
                    {fallbackReason ? "（已降级）" : ""}
                    {sequence.ignoredDialogueNodeCount > 0
                      ? ` · 已忽略 ${sequence.ignoredDialogueNodeCount} 个关闭 UI 节点`
                      : ""}
                  </>
                ) : hasLoadedDialogue ? (
                  `${dialogueSummary} · ${shotPreparationMessage}`
                ) : (
                  "目录已就绪"
                )}
              </small>
            </div>
            <div className="shot-list">
              {!contentSearch && activeShot && (
                <span
                  className={`shot-list__selection ${
                    activeShot.projection.valid ? "" : "is-invalid"
                  }`}
                  style={{
                    transform: `translateY(${activeIndex * 62}px)`,
                  }}
                  aria-hidden="true"
                />
              )}
              {contentSearch
                ? contentSearch.contexts.map((context) => {
                    const cached = designedStoryboards.get(context.prefix);
                    const contextRows = context.sequence.rows.filter((row) =>
                      context.contextDialogueIds.includes(row.id),
                    );
                    const participantsBySlot = new Map(
                      context.sequence.participants.map((participant) => [
                        participant.slot,
                        participant,
                      ]),
                    );
                    return (
                      <section
                        className="dialogue-search-context"
                        key={context.prefix}
                      >
                        <header>
                          <strong>对话 {context.prefix}</strong>
                          <span>{cached ? "已有分镜" : "仅文本"}</span>
                        </header>
                        {contextRows.map((row) => {
                          const cachedShot = cached?.shots.find((shot) =>
                            shot.dialogueIds.includes(row.id),
                          );
                          const participant = row.speakerSlot
                            ? participantsBySlot.get(row.speakerSlot)
                            : undefined;
                          const matched =
                            context.matchedDialogueIds.includes(row.id);
                          const selected =
                            sequence.prefix === context.prefix &&
                            activeDialogueId === row.id;
                          return (
                            <button
                              className={`dialogue-search-row ${matched ? "is-match" : ""} ${selected ? "is-active" : ""}`}
                              type="button"
                              key={row.id}
                              aria-label={`对话 ${context.prefix} 节点 ${row.id} ${row.content}`}
                              onClick={() =>
                                openContentSearchContext(context, row.id)
                              }
                            >
                              <span
                                className="shot-row__speaker"
                                data-slot={row.speakerSlot ?? undefined}
                                style={{
                                  backgroundColor: participant?.color,
                                }}
                              >
                                {participant
                                  ? participantSlotLabel(participant)
                                  : "?"}
                              </span>
                              <span className="shot-row__body">
                                <strong>
                                  {participant?.name ?? "未知角色"} · {row.id}
                                </strong>
                                <small>
                                  <HighlightedDialogueText
                                    text={row.content}
                                    query={contentSearch.query}
                                  />
                                </small>
                              </span>
                              <span
                                className={`dialogue-search-row__status ${cachedShot ? "is-designed" : ""}`}
                              >
                                {cachedShot && <Clapperboard size={12} />}
                                {cachedShot?.label ?? "文本"}
                              </span>
                            </button>
                          );
                        })}
                      </section>
                    );
                  })
                : activeShot
                ? shots.map((shot, index) => (
                    <button
                      className={`shot-row ${index === activeIndex ? "is-active" : ""} ${shot.projection.valid ? "" : "is-invalid"}`}
                      type="button"
                      key={shot.id}
                      onClick={() => selectShot(index)}
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
                        {participantSlotLabelsBySlot.get(shot.speakerSlot) ??
                          "?"}
                      </span>
                      <span className="shot-row__body">
                        <strong>{shot.label}</strong>
                        <small>{shot.content}</small>
                      </span>
                      <span
                        className="shot-row__time"
                        title={
                          shot.projection.valid
                            ? undefined
                            : "投影验收未通过"
                        }
                      >
                        {!shot.projection.valid && (
                          <AlertTriangle
                            aria-label="投影验收未通过"
                            size={13}
                          />
                        )}
                        {shot.duration}s
                      </span>
                    </button>
                  ))
                : sequence.rows.map((row, index) => (
                    <div className="dialogue-row" key={row.id}>
                      <span className="shot-row__number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className="shot-row__speaker"
                        data-slot={row.speakerSlot ?? undefined}
                        style={{
                          backgroundColor: row.speakerSlot
                            ? participantColorsBySlot.get(row.speakerSlot)
                            : undefined,
                        }}
                      >
                        {row.speakerSlot
                          ? participantSlotLabelsBySlot.get(row.speakerSlot) ??
                            "?"
                          : "?"}
                      </span>
                      <span className="shot-row__body">
                        <strong>
                          {row.speakerSlot
                            ? participantNamesBySlot.get(row.speakerSlot)
                            : "未知角色"}
                        </strong>
                        <small>{row.content}</small>
                      </span>
                      <span className="dialogue-row__id">{row.id}</span>
                    </div>
                  ))}
            </div>
          </section>
          {contentSearch &&
            database.sourceName !== "内置演示数据" &&
            dialogueTextEditorItems.length > 0 && (
              <button
                className="icon-button dialogue-search-edit-fab"
                type="button"
                title="编辑搜索结果"
                aria-label="编辑搜索结果"
                onClick={() => {
                  setDialogueSaveError("");
                  setDialogueSaveStatus("");
                  setShowDialogueTextEditor(true);
                }}
              >
                <Pencil size={17} />
              </button>
            )}
        </aside>

        <section className="viewport-panel">
          {activeShot ? (
            <>
              <div className="viewport-toolbar">
              <div>
                  <Camera size={16} />
                  <span>镜头 {String(activeIndex + 1).padStart(2, "0")}</span>
                  <small>
                    台词节点 {activeDialogueRow?.id ?? activeShot.dialogueId}
                  </small>
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
                participants={characterActionStage.participants}
                dialogueParticipantSlots={dialogueParticipantSlotSet}
                showCastRoster
                shot={stageShot ?? activeShot}
                shotIndex={activeIndex}
                shotCount={shots.length}
                active={activeWorkspace === "storyboard"}
              />
              {directorLoading && (
                <div className="director-loading" role="status">
                  <LoaderCircle className="spin" size={20} />
                  <div>
                    <strong>
                      {directorLoadingMode === "trae"
                          ? traeWaitHeading
                          : directorLoadingMode === "mira"
                            ? "Mira AI 正在分析剧情"
                            : "导演正在编排镜头"}
                    </strong>
                    <small>
                      {directorLoadingMode === "trae"
                        ? traeWaitDetail
                        : directorLoadingMode === "mira"
                          ? browsingPreviousAiPlan
                            ? "当前 AI 分镜仍可浏览，完成后自动切换到新方案"
                            : "本地分镜已显示，AI 完成后将先对比角色占位"
                          : "正在维护动态关系轴与视线连续"}
                    </small>
                  </div>
                  {directorLoadingMode === "trae" && (
                    <button
                      className="director-loading__cancel"
                      type="button"
                      disabled={
                        traeCancelBusy || !activeTraeRequestId
                      }
                      title={
                        activeTraeRequestId
                          ? "中断当前 TRAE 分镜分析"
                          : "正在创建 TRAE 任务"
                      }
                      onClick={() => void interruptTraeAnalysis()}
                    >
                      {traeCancelBusy ? (
                        <LoaderCircle className="spin" size={13} />
                      ) : (
                        <Square size={12} fill="currentColor" />
                      )}
                      {traeCancelBusy ? "中断中" : "中断分析"}
                    </button>
                  )}
                </div>
              )}
              <div
                className={`dialogue-strip ${editingDialogueId ? "is-editing" : ""}`}
                ref={dialogueEditorRef}
              >
                <span
                  className="dialogue-strip__slot"
                  data-slot={
                    activeDialogueRow?.speakerSlot ?? activeShot.speakerSlot
                  }
                  style={{
                    backgroundColor: participantColorsBySlot.get(
                      activeDialogueRow?.speakerSlot ?? activeShot.speakerSlot,
                    ),
                  }}
                >
                  {participantSlotLabelsBySlot.get(
                    activeDialogueRow?.speakerSlot ?? activeShot.speakerSlot,
                  ) ?? "?"}
                </span>
                <div className="dialogue-strip__content">
                  <strong>
                    {activeDialogueRow?.speakerSlot
                      ? participantNamesBySlot.get(
                          activeDialogueRow.speakerSlot,
                        )
                      : activeShot.speakerName}
                    <small>
                      节点 {activeDialogueRow?.id ?? activeShot.dialogueId}
                    </small>
                  </strong>
                  {editingDialogueId === activeDialogueRow?.id ? (
                    <textarea
                      autoFocus
                      aria-label={`编辑节点 ${activeDialogueRow.id} 的对白`}
                      value={dialogueDraft}
                      onChange={(event) => setDialogueDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          cancelDialogueEdit();
                        }
                      }}
                    />
                  ) : (
                    <p>{activeDialogueRow?.content ?? activeShot.content}</p>
                  )}
                  {dialogueSaveError && (
                    <small className="dialogue-strip__message is-error">
                      {dialogueSaveError}
                    </small>
                  )}
                  {dialogueSaveStatus && (
                    <small
                      className="dialogue-strip__message is-success"
                      role="status"
                    >
                      {dialogueSaveStatus}
                    </small>
                  )}
                </div>
                <div className="dialogue-strip__actions">
                  {editingDialogueId === activeDialogueRow?.id ? (
                    <>
                      <button
                        className="icon-button"
                        type="button"
                        title="保存对白到 UE"
                        aria-label="保存对白"
                        disabled={dialogueSaveBusy || !dialogueDraft.trim()}
                        onClick={() => void saveDialogueEdit()}
                      >
                        {dialogueSaveBusy ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <Check size={16} />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        title="取消编辑"
                        aria-label="取消编辑"
                        disabled={dialogueSaveBusy}
                        onClick={cancelDialogueEdit}
                      >
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <button
                      className="icon-button"
                      type="button"
                      title={
                        database.sourceName === "内置演示数据"
                          ? "内置演示数据不能写入 UE"
                          : "编辑当前对白"
                      }
                      aria-label="编辑当前对白"
                      disabled={
                        !activeDialogueRow ||
                        database.sourceName === "内置演示数据"
                      }
                      onClick={beginDialogueEdit}
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="viewport-toolbar">
                <div>
                  <Camera size={16} />
                  <span>
                    {hasLoadedDialogue
                      ? `对话 ${sequence.prefix}`
                      : "等待选择对话"}
                  </span>
                  <small>
                    {hasLoadedDialogue ? `${dialogueSummary}已加载` : "数据目录已就绪"}
                  </small>
                </div>
                <div className="axis-status">
                  {formationChecking || directorLoading ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Boxes size={15} />
                  )}
                  <span>{shotPreparationMessage}</span>
                </div>
              </div>
              <div className="dialogue-preview" role="status">
                {hasLoadedDialogue ? (
                  sequence.rows.map((row) => (
                    <div className="dialogue-preview__row" key={row.id}>
                      <span
                        className="dialogue-strip__slot"
                        data-slot={row.speakerSlot ?? undefined}
                        style={{
                          backgroundColor: row.speakerSlot
                            ? participantColorsBySlot.get(row.speakerSlot)
                            : undefined,
                        }}
                      >
                        {row.speakerSlot
                          ? participantSlotLabelsBySlot.get(row.speakerSlot) ??
                            "?"
                          : "?"}
                      </span>
                      <div>
                        <strong>
                          {row.speakerSlot
                            ? participantNamesBySlot.get(row.speakerSlot)
                            : "未知角色"}
                        </strong>
                        <p>{row.content}</p>
                      </div>
                      <small>{row.id}</small>
                    </div>
                  ))
                ) : (
                  <div className="dialogue-preview__empty">
                    <Search size={22} />
                    <strong>等待对话</strong>
                    <small>数据目录已就绪</small>
                  </div>
                )}
              </div>
              <div className="dialogue-preparation-status">
                {formationChecking || directorLoading ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Boxes size={16} />
                )}
                <span>{shotPreparationMessage}</span>
              </div>
            </>
          )}
        </section>

        <aside className="right-panel">
          {activeShot ? (
            <>
              <ShotInspector
                shot={activeShot}
                sequence={sequence}
                activeDialogueId={activeDialogueId}
                directorAnalysis={directorAnalysis}
                soundEffects={soundEffects}
                soundEffectCatalog={soundEffectCatalog}
                musicRecommendations={musicRecommendations}
                musicCatalog={musicCatalog}
                directorBlocking={directorBlocking}
                appliedDirector={appliedDirector}
                activeIndex={activeIndex}
                shotCount={shots.length}
                tab={inspectorTab}
                canExport={canExportStoryboard}
                exportBusy={
                  storyboardExportBusy ||
                  formationChecking ||
                  configurationModeBusy
                }
                exportError={storyboardExportError}
                exportButtonLabel={storyboardExportButtonLabel}
                exportUnavailableReason={storyboardExportUnavailableReason}
                backgroundGenerationActive={directorLoading}
                configurationMode={configurationMode}
                configurationModeBusy={configurationModeBusy}
                characterActionEditor={characterActionEditor}
                onMove={moveShot}
                onTabChange={setInspectorTab}
                onConfigurationModeChange={(enabled) =>
                  void changeConfigurationMode(enabled)
                }
                onExport={() => void openStoryboardExport()}
                onExportSoundEffects={() =>
                  void previewCurrentSoundEffectExport()
                }
                onChangeSoundEffect={updateSoundEffectRecommendation}
                onApplySoundEffect={applySoundEffectFromLibrary}
                onApplyMusic={applyMusicFromLibrary}
              />
            </>
          ) : (
            <>
              <section className="inspector-header">
                <div>
                  <small>当前进度</small>
                  <h2>{hasLoadedDialogue ? "对话已加载" : "等待对话"}</h2>
                </div>
              </section>
              <section className="inspector-section">
                <div className="section-label">
                  <span>镜头准备</span>
                  <small>{hasLoadedDialogue ? dialogueSummary : "尚未选择"}</small>
                </div>
                <p>{shotPreparationMessage}</p>
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
                <span>
                  {hasLoadedDialogue
                    ? `${participantRoles.dialogue.length} 位对白角色${
                        participantRoles.background.length > 0
                          ? ` · ${participantRoles.background.length} 位背景 NPC`
                          : ""
                      }`
                    : "等待加载角色"}
                </span>
              </footer>
            </>
          )}
        </aside>
      </div>

      <section
        className="tool-workspace"
        data-workspace-state={
          activeWorkspace === "npc"
            ? outgoingWorkspace
              ? "entering"
              : "active"
            : outgoingWorkspace === "npc"
              ? "exiting"
              : "inactive"
        }
        hidden={activeWorkspace !== "npc" && outgoingWorkspace !== "npc"}
        aria-hidden={activeWorkspace !== "npc" || undefined}
        inert={activeWorkspace !== "npc" || undefined}
        aria-label="NPC 注册工作区"
      >
        <MemoizedNpcRegistrationModal
          embedded
          onClose={closeToolWorkspace}
        />
      </section>

      <section
        className="tool-workspace"
        data-workspace-state={
          activeWorkspace === "targets"
            ? outgoingWorkspace
              ? "entering"
              : "active"
            : outgoingWorkspace === "targets"
              ? "exiting"
              : "inactive"
        }
        hidden={
          activeWorkspace !== "targets" &&
          outgoingWorkspace !== "targets"
        }
        aria-hidden={activeWorkspace !== "targets" || undefined}
        inert={activeWorkspace !== "targets" || undefined}
        aria-label="任务目标物工作区"
      >
        <MemoizedMissionTargetModal
          embedded
          database={database}
          onClose={closeToolWorkspace}
        />
      </section>

      <Suspense fallback={null}>
        {showDialogueTextEditor && dialogueTextEditorItems.length > 0 && (
          <LazyDialogueTextEditorModal
            key={`${contentSearch?.query ?? ""}:${activeDialogueId ?? ""}`}
            query={contentSearch?.query ?? ""}
            items={dialogueTextEditorItems}
            activeDialogueNodeId={activeDialogueId ?? ""}
            busy={dialogueSaveBusy}
            error={dialogueSaveError}
            onClose={() => {
              if (!dialogueSaveBusy) {
                setShowDialogueTextEditor(false);
                setDialogueSaveError("");
              }
            }}
            onApply={(items) => void saveDialogueTextChanges(items)}
          />
        )}

        {storyboardExportPreview && storyboardExportRequest && (
          <LazyStoryboardExportModal
            preview={storyboardExportPreview}
            mode={storyboardExportMode}
            currentShotNumber={storyboardExportShotNumber}
            busy={storyboardExportBusy}
            busyLabel={storyboardExportBusyLabel}
            error={storyboardExportError}
            result={storyboardExportResult}
            onClose={closeStoryboardExport}
            onShowAll={() => void previewAllStoryboardExport()}
            onRefresh={() => void refreshStoryboardExportPreview()}
            onConfirm={(
              selectedShotIndexes,
              selectedCharacterActionIndexes,
              selectedSoundEffectIndexes,
              selectedMusicIndexes,
            ) =>
              void confirmStoryboardExport(
                selectedShotIndexes,
                selectedCharacterActionIndexes,
                selectedSoundEffectIndexes,
                selectedMusicIndexes,
              )
            }
          />
        )}

        {sharedComparison && (
          <LazySharedPlanCompareModal
            local={sharedComparison.local}
            shared={sharedComparison.shared}
            busy={sharedComparisonBusy}
            error={sharedComparisonError}
            onChoose={(choice) => void chooseSharedPlan(choice)}
          />
        )}

        {missingNpcModelReview && !sharedComparison && (
          <MissingNpcModelModal
            issues={missingNpcModelReview.issues}
            ignoredNpcIds={missingNpcModelReview.ignoredNpcIds}
            busy={formationChecking}
            status={formationStatus}
            error={missingNpcModelReview.error}
            onToggle={toggleIgnoredMissingNpc}
            onToggleAll={toggleAllMissingNpcs}
            onRefresh={() => void refreshMissingNpcModels()}
            onContinue={() => void continueWithoutMissingNpcModels()}
            onClose={() => {
              setMissingNpcModelReview(null);
              setFormationStatus("已取消缺失模型确认");
            }}
          />
        )}

        {formationChoice && formationChoiceMode && !sharedComparison && (
          <LazyBlueprintFormationModal
            blueprint={formationChoice.blueprint}
            blueprintPlayerLocked={formationChoice.blueprintPlayerLocked}
            generated={formationChoice.generated}
            ai={
              formationChoice.ai
                ? {
                    sequence: {
                      ...formationChoice.ai.sequence,
                      participants: formationChoice.ai.result.participants,
                    },
                    shots: formationChoice.ai.result.shots,
                  }
                : undefined
            }
            aiLabel={
              formationChoice.ai
                ? `${directorLabel(formationChoice.ai.result.appliedMode)} 占位`
                : undefined
            }
            snapshot={formationChoice.snapshot}
            mappedSlotCount={formationChoice.mappedSlotCount}
            initialChoice={
              formationChoiceMode === "initial" ||
              formationChoiceMode === "director-request"
                ? "blueprint"
                : activeFormationVariant
            }
            initialPlayerPositionLocked={
              formationChoice.playerPositionLocked
            }
            mode={formationChoiceMode}
            onChoose={(choice, playerPositionLocked) => {
              if (choice !== "current") {
                chooseFormation(choice, playerPositionLocked);
              }
            }}
            onClose={() => {
              traeForceRegenerateRef.current = false;
              if (
                formationChoiceMode === "director-request" &&
                appliedDirector !== "trae"
              ) {
                setDirectorMode(appliedDirector);
              }
              setFormationChoiceMode(null);
            }}
          />
        )}

        {pendingDirectorResult?.result.analysis &&
          pendingDirectorResult.result.appliedMode !== "trae" &&
          pendingDirectorResult.reviewFormation !== false &&
          !sharedComparison &&
          !storyboardExportBusy &&
          !storyboardExportPreview &&
          !formationChoiceMode && (
            <LazyBlueprintFormationModal
              current={{ sequence, shots }}
              currentLabel={`当前 · ${activeFormationName}`}
              currentDetail={
                activeFormationSource === "blueprint" && formationChoice
                  ? formationChoice.snapshot.blueprintAssetPath
                  : activeFormationName
              }
              currentUsesBlueprint={activeFormationSource === "blueprint"}
              ai={{
                sequence: {
                  ...pendingDirectorResult.sequence,
                  participants: pendingDirectorResult.result.participants,
                },
                shots: pendingDirectorResult.result.shots,
              }}
              aiLabel={`${directorLabel(
                pendingDirectorResult.result.appliedMode,
              )} 建议占位`}
              aiSource={pendingDirectorResult.result.sharedSource}
              initialChoice="ai"
              initialPlayerPositionLocked={
                formationChoice?.playerPositionLocked ?? true
              }
              mode="ai-review"
              onChoose={(choice) =>
                choosePendingDirectorFormation(choice)
              }
              onClose={() => undefined}
            />
          )}

        {showDesktopFirstRun && desktopSetup && (
          <LazyDesktopFirstRunModal
            status={desktopSetup}
            busy={loading}
            error={error}
            onChooseLiveDirectory={() => void chooseDirectory("live")}
            onChooseConfigDirectory={() => void chooseDirectory("config")}
            onComplete={() => void completeDesktopFirstRun()}
            onSkip={() => setShowDesktopFirstRun(false)}
          />
        )}

        {showDesktopSetup && desktopSetup && (
          <LazyDesktopSetupModal
            initialStatus={desktopSetup}
            onClose={() => setShowDesktopSetup(false)}
            onRefreshTrae={() => void refreshTraeConnection()}
            larkLoading={larkLoading}
            larkStatus={larkStatus}
            larkError={larkError}
            soundEffectCatalog={soundEffectCatalog}
            musicCatalog={musicCatalog}
            dataLoading={loading}
            dataError={error}
            onChooseLiveDirectory={() => void chooseDirectory("live")}
            onChooseConfigDirectory={() => void chooseDirectory("config")}
            onAuthorize={() => void beginAuthorization()}
            onRefreshLark={() => void refreshLarkConnection(false)}
            onSyncSoundEffectCatalog={refreshSoundEffectCatalogFromLark}
            onSyncMusicCatalog={refreshMusicCatalogFromLark}
          />
        )}

        {traeConfig && (
          <LazyTraeCollaborationModal
            config={traeConfig}
            onClose={closeTraeConfig}
            onRefresh={closeTraeConfig}
          />
        )}
      </Suspense>

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
                <h2 id="auth-title">连接飞书数据与 Mira</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                title="关闭"
                aria-label="关闭飞书授权"
                onClick={closeAuthorization}
                disabled={authFinishing}
              >
                <X size={17} />
              </button>
            </header>
            <div className="auth-modal__body">
              <img src={authStart.qrDataUrl} alt="飞书授权二维码" />
              <div>
                <p>
                  使用飞书扫码，授权共享分镜、返修案例库以及 Mira
                  消息所需的最小权限。
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
                onClick={closeAuthorization}
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

      {showLaunchScreen && (
        <LaunchScreen
          sourceName={database.sourceName}
          version={APP_VERSION}
          onComplete={dismissLaunchScreen}
        />
      )}
    </main>
  );
}
