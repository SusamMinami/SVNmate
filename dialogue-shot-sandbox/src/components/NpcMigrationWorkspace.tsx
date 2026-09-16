import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileBox,
  FolderOpen,
  LayoutGrid,
  LoaderCircle,
  PackageCheck,
  PersonStanding,
  Play,
  RefreshCw,
  ScanFace,
  ScanSearch,
  Settings2,
  Sparkles,
  UserRoundPlus,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  NpcMigrationPlan,
  NpcMigrationSourceScan,
  NpcMigrationStandardAbpTemplate,
  NpcMigrationStep,
  NpcMigrationStepId,
  NpcMigrationTargetInspection,
  NpcMigrationTargetRequest,
  NpcMigrationTargetResult,
} from "../types";
import {
  applyNpcAssetMigration,
  configureNpcMigrationTarget,
  inspectNpcMigrationPlan,
  inspectNpcMigrationTarget,
  scanNpcMigrationSource,
} from "../ue/client";
import {
  deriveNpcMigrationIdentity,
  inferStandardAbpTemplate,
} from "../data/npcMigration";
import { NpcSupplementWorkspace } from "./NpcSupplementWorkspace";

interface NpcMigrationWorkspaceProps {
  onClose: () => void;
}

type BusyAction =
  | "source"
  | "plan"
  | "migrate"
  | "target"
  | "configure"
  | null;
type AnimationSourceOrigin = "library" | "manual" | null;
type WorkflowNoticeTone = "blocked" | "action" | "note";

interface WorkflowNotice {
  text: string;
  tone: WorkflowNoticeTone;
}

function workflowStepForNotice(message: string): NpcMigrationStepId {
  if (/Face|脸部|表情/.test(message)) {
    return "face";
  }
  if (/Montage|蒙太奇|IdleSlot|TurnSlot/.test(message)) {
    return "montages";
  }
  if (/Skeleton|ABP|动画蓝图|状态机|Look/.test(message)) {
    return "animation_blueprint";
  }
  if (/胶囊体|Mesh|转头|正面|后期处理/.test(message)) {
    return "visual_review";
  }
  if (/动作|FBX|Animation/.test(message)) {
    return "animations";
  }
  if (/Content|同路径|复制|源工程与目标工程/.test(message)) {
    return "migration";
  }
  if (/源 UE|源资产|Skeletal Mesh 与依赖/.test(message)) {
    return "source";
  }
  if (/NPC 名称|NPC BP|BP 名称|BP\/ABP 目录/.test(message)) {
    return "blueprint";
  }
  return "finalize";
}

function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function compactPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function templateLabel(
  template: NpcMigrationStandardAbpTemplate,
): string {
  return template === "animal"
    ? "动物"
    : template === "male"
      ? "男性"
      : "女性";
}

export function NpcMigrationWorkspace({
  onClose,
}: NpcMigrationWorkspaceProps) {
  const [mode, setMode] = useState<"new" | "actions" | "face" | null>(null);
  const [source, setSource] = useState<NpcMigrationSourceScan | null>(null);
  const [targetContentDirectory, setTargetContentDirectory] = useState("");
  const [animationSourceDirectory, setAnimationSourceDirectory] = useState("");
  const [animationSourceOrigin, setAnimationSourceOrigin] =
    useState<AnimationSourceOrigin>(null);
  const [npcName, setNpcName] = useState("");
  const [targetPackagePath, setTargetPackagePath] = useState("");
  const [npcBaseClassPath, setNpcBaseClassPath] = useState("BP_NPCBase");
  const [
    animationBlueprintParentClassPath,
    setAnimationBlueprintParentClassPath,
  ] = useState("SeriaNPCAnimInstance");
  const [turnCurveAssetPath, setTurnCurveAssetPath] = useState(
    "/Game/Seria/NPC/Curves/Npc_head_turn.Npc_head_turn",
  );
  const [autoFitCapsule, setAutoFitCapsule] = useState(true);
  const [bindTurnCurve, setBindTurnCurve] = useState(true);
  const [createMontages, setCreateMontages] = useState(true);
  const [configureStandardAbp, setConfigureStandardAbp] = useState(true);
  const [standardAbpTemplate, setStandardAbpTemplate] =
    useState<NpcMigrationStandardAbpTemplate>("female");
  const [plan, setPlan] = useState<NpcMigrationPlan | null>(null);
  const [migrated, setMigrated] = useState(false);
  const [targetInspection, setTargetInspection] =
    useState<NpcMigrationTargetInspection | null>(null);
  const [result, setResult] = useState<NpcMigrationTargetResult | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sourceExpanded, setSourceExpanded] = useState(true);
  const [parametersExpanded, setParametersExpanded] = useState(true);
  const migrationIdentity = useMemo(
    () =>
      deriveNpcMigrationIdentity(
        npcName,
        targetPackagePath,
        standardAbpTemplate,
      ),
    [npcName, standardAbpTemplate, targetPackagePath],
  );
  const blueprintName = npcName ? migrationIdentity.blueprintName : "";
  const animationBlueprintName = npcName
    ? migrationIdentity.animationBlueprintName
    : "";

  const totalBytes = useMemo(
    () =>
      plan?.fileOperations.reduce(
        (total, operation) =>
          operation.state === "ready"
            ? total + operation.size
            : total,
        0,
      ) ?? 0,
    [plan],
  );
  const fileOperationCounts = useMemo(
    () => ({
      ready:
        plan?.fileOperations.filter(
          (operation) => operation.state === "ready",
        ).length ?? 0,
      unchanged:
        plan?.fileOperations.filter(
          (operation) => operation.state === "unchanged",
        ).length ?? 0,
      conflict:
        plan?.fileOperations.filter(
          (operation) => operation.state === "conflict",
        ).length ?? 0,
    }),
    [plan],
  );
  const workflowSteps = useMemo(() => {
    const baseSteps: NpcMigrationStep[] = plan?.steps ?? [
      {
        id: "source",
        label: "采集 Skeletal Mesh 与依赖",
        mode: "automatic",
        state: source ? "ready" : "blocked",
        detail: source ? source.skeletalMeshName : "等待读取源资产",
      },
    ];
    const noticesByStep = new Map<
      NpcMigrationStepId,
      Map<string, WorkflowNotice>
    >();
    const tonePriority: Record<WorkflowNoticeTone, number> = {
      blocked: 0,
      action: 1,
      note: 2,
    };
    const addNotices = (
      messages: readonly string[],
      tone: WorkflowNoticeTone,
    ) => {
      for (const text of messages) {
        const stepId = workflowStepForNotice(text);
        const current =
          noticesByStep.get(stepId) ??
          new Map<string, WorkflowNotice>();
        const existing = current.get(text);
        if (!existing || tonePriority[tone] < tonePriority[existing.tone]) {
          current.set(text, { text, tone });
        }
        noticesByStep.set(stepId, current);
      }
    };
    addNotices(plan?.blockedReasons ?? [], "blocked");
    addNotices(plan?.warnings ?? [], "note");
    addNotices(targetInspection?.blockedReasons ?? [], "blocked");
    addNotices(targetInspection?.warnings ?? [], "note");
    addNotices(result?.manualChecks ?? [], "action");
    return baseSteps
      .map((step, sequence) => {
        const notices = Array.from(
          noticesByStep.get(step.id)?.values() ?? [],
        ).sort(
          (left, right) =>
            tonePriority[left.tone] - tonePriority[right.tone],
        );
        const blocked =
          step.state === "blocked" ||
          notices.some((notice) => notice.tone === "blocked");
        const actionRequired = notices.some(
          (notice) => notice.tone === "action",
        );
        return {
          step,
          sequence,
          notices,
          blocked,
          actionRequired,
          priority: blocked ? 0 : actionRequired ? 1 : 2,
        };
      })
      .sort(
        (left, right) =>
          left.priority - right.priority ||
          left.sequence - right.sequence,
      );
  }, [plan, result, source, targetInspection]);

  function clearFeedback(): void {
    setError("");
    setStatus("");
  }

  async function readSource(): Promise<void> {
    clearFeedback();
    setBusy("source");
    try {
      const next = await scanNpcMigrationSource();
      setSource(next);
      setNpcName(next.suggestedNpcName);
      setTargetPackagePath(next.suggestedTargetPackagePath);
      setAnimationSourceDirectory("");
      setAnimationSourceOrigin(null);
      const inferredTemplate = inferStandardAbpTemplate(
        next.suggestedNpcName,
      );
      setStandardAbpTemplate(inferredTemplate);
      if (inferredTemplate === "animal") {
        setConfigureStandardAbp(true);
        setAutoFitCapsule(true);
      }
      setPlan(null);
      setMigrated(false);
      setTargetInspection(null);
      setResult(null);
      setSourceExpanded(true);
      setParametersExpanded(true);
      let animationStatus = "动作库未匹配，可手动选择目录";
      const resolver =
        window.shotSandboxDesktop?.resolveNpcAnimationDirectory;
      if (resolver) {
        try {
          const resolution = await resolver(next.suggestedNpcName);
          if (resolution.directoryPath) {
            setAnimationSourceDirectory(resolution.directoryPath);
            setAnimationSourceOrigin("library");
            animationStatus =
              `动作库自动匹配 ${resolution.matchedFileCount} 个 Body FBX` +
              (resolution.candidateDirectories.length > 1
                ? `，已从 ${resolution.candidateDirectories.length} 个候选中选择最佳目录`
                : "");
          }
        } catch {
          animationStatus = "动作库自动匹配失败，可手动选择目录";
        }
      }
      setStatus(
        `已读取 ${next.skeletalMeshName}，共 ${next.dependencyPackageNames.length} 个依赖包；${animationStatus}`,
      );
    } catch (scanError) {
      setError(
        scanError instanceof Error ? scanError.message : "源资产扫描失败",
      );
    } finally {
      setBusy(null);
    }
  }

  async function chooseDirectory(
    kind: "target-content" | "animations",
  ): Promise<void> {
    const chooser = window.shotSandboxDesktop?.chooseNpcMigrationDirectory;
    if (!chooser) {
      return;
    }
    const selected = await chooser(kind);
    if (!selected) {
      return;
    }
    if (kind === "target-content") {
      setTargetContentDirectory(selected);
    } else {
      setAnimationSourceDirectory(selected);
      setAnimationSourceOrigin("manual");
    }
    setPlan(null);
    setTargetInspection(null);
    setResult(null);
  }

  async function buildPlan(
    overrides: {
      template?: NpcMigrationStandardAbpTemplate;
      useStandardTemplate?: boolean;
    } = {},
  ): Promise<void> {
    if (!source) {
      setError("请先读取美术 UE 中选中的 Skeletal Mesh");
      return;
    }
    clearFeedback();
    setBusy("plan");
    try {
      const next = await inspectNpcMigrationPlan({
        source,
        targetContentDirectory,
        animationSourceDirectory,
        targetPackagePath,
        npcName,
        configureStandardAbp:
          overrides.useStandardTemplate ?? configureStandardAbp,
        standardAbpTemplate:
          overrides.template ?? standardAbpTemplate,
      });
      setPlan(next);
      setMigrated(false);
      setTargetInspection(null);
      setResult(null);
      setSourceExpanded(false);
      setParametersExpanded(false);
      setStatus(
        next.blockedReasons.length > 0
          ? `计划已生成，存在 ${next.blockedReasons.length} 个阻断项`
          : `计划已就绪：复制 ${
              next.fileOperations.filter(
                (operation) => operation.state === "ready",
              ).length
            } 个、复用 ${
              next.fileOperations.filter(
                (operation) => operation.state === "unchanged",
              ).length
            } 个资产文件，${next.bodyAnimationFiles.length + next.faceAnimationFiles.length} 个动作`,
      );
    } catch (planError) {
      setError(
        planError instanceof Error ? planError.message : "迁移计划生成失败",
      );
    } finally {
      setBusy(null);
    }
  }

  function selectNpcType(
    template: NpcMigrationStandardAbpTemplate,
  ): void {
    const shouldRebuild = Boolean(plan);
    setStandardAbpTemplate(template);
    setConfigureStandardAbp(true);
    if (template === "animal") {
      setAutoFitCapsule(true);
    }
    setPlan(null);
    setTargetInspection(null);
    setResult(null);
    if (shouldRebuild) {
      void buildPlan({
        template,
        useStandardTemplate: true,
      });
    }
  }

  async function migrateAssets(): Promise<void> {
    if (
      !plan ||
      !window.confirm(
        `将 ${fileOperationCounts.ready} 个文件复制到策划工程 Content，复用 ${fileOperationCounts.unchanged} 个内容一致的文件，且不覆盖 ${fileOperationCounts.conflict} 个内容不同的文件。继续吗？`,
      )
    ) {
      return;
    }
    clearFeedback();
    setBusy("migrate");
    try {
      const copyResult = await applyNpcAssetMigration(plan);
      setMigrated(true);
      setStatus(
        `基础资产迁移完成：复制 ${copyResult.copiedFiles.length} 个，复用 ${copyResult.reusedFiles.length} 个文件，共写入 ${fileSize(copyResult.copiedBytes)}`,
      );
    } catch (migrationError) {
      setError(
        migrationError instanceof Error
          ? migrationError.message
          : "基础资产迁移失败",
      );
    } finally {
      setBusy(null);
    }
  }

  function targetRequest(): NpcMigrationTargetRequest | null {
    return plan
      ? {
          plan,
          reviewToken: plan.reviewToken,
          npcBaseClassPath,
          animationBlueprintParentClassPath,
          turnCurveAssetPath: turnCurveAssetPath.trim() || undefined,
          autoFitCapsule,
          bindTurnCurve,
          createMontages,
          createFaceComponent: plan.faceAnimationFiles.length > 0,
        }
      : null;
  }

  async function inspectTarget(): Promise<void> {
    const request = targetRequest();
    if (!request) {
      return;
    }
    clearFeedback();
    setBusy("target");
    try {
      const inspection = await inspectNpcMigrationTarget(request);
      setTargetInspection(inspection);
      setResult(null);
      setStatus(
        inspection.blockedReasons.length > 0
          ? `资产校验完成，存在 ${inspection.blockedReasons.length} 个阻断项`
          : "资产校验通过，可以配置 BP 文件",
      );
    } catch (inspectionError) {
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : "资产校验失败",
      );
    } finally {
      setBusy(null);
    }
  }

  async function configureTarget(): Promise<void> {
    const request = targetRequest();
    if (
      !request ||
      !window.confirm(
        `将在目标 Res UE 导入 ${plan!.bodyAnimationFiles.length + plan!.faceAnimationFiles.length} 个动作并创建 ${plan!.blueprintName} / ${plan!.animationBlueprintName}${
          plan!.configureStandardAbp
            ? `，套用${templateLabel(plan!.standardAbpTemplate)}标准模板`
            : ""
        }。继续吗？`,
      )
    ) {
      return;
    }
    clearFeedback();
    setBusy("configure");
    try {
      const configured = await configureNpcMigrationTarget(request);
      setResult(configured);
      setStatus(
        `BP 文件配置完成：导入 ${configured.importedAnimationAssetPaths.length} 个动作，创建 ${configured.createdMontageAssetPaths.length} 个 Montage`,
      );
    } catch (configurationError) {
      setError(
        configurationError instanceof Error
          ? configurationError.message
          : "BP 文件配置失败",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!mode) {
    return (
      <div className="npc-migration-workspace npc-migration-mode-workspace">
        <div className="npc-migration-mode-shell">
          <header>
            <div>
              <strong>选择处理类型</strong>
              <small>NPC WORKFLOW</small>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={onClose}
              title="返回分镜工作台"
              aria-label="返回分镜工作台"
            >
              <ArrowLeft size={17} />
            </button>
          </header>
          <div className="npc-migration-mode-grid">
            <button
              type="button"
              className="npc-migration-mode-option is-primary"
              onClick={() => setMode("new")}
            >
              <span className="npc-migration-mode-option__icon">
                <UserRoundPlus size={42} strokeWidth={1.5} />
              </span>
              <span>
                <strong>全新 NPC</strong>
                <small>完整迁移</small>
              </span>
              <em>01</em>
            </button>
            <button
              type="button"
              className="npc-migration-mode-option"
              onClick={() => setMode("actions")}
            >
              <span className="npc-migration-mode-option__icon">
                <PersonStanding size={42} strokeWidth={1.5} />
              </span>
              <span>
                <strong>动作补充与修改</strong>
                <small>BODY + AUTO FACE</small>
              </span>
              <em>02</em>
            </button>
            <button
              type="button"
              className="npc-migration-mode-option"
              onClick={() => setMode("face")}
            >
              <span className="npc-migration-mode-option__icon">
                <ScanFace size={42} strokeWidth={1.5} />
              </span>
              <span>
                <strong>面部补充</strong>
                <small>FACE PIPELINE</small>
              </span>
              <em>03</em>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "actions" || mode === "face") {
    return (
      <NpcSupplementWorkspace
        kind={mode}
        onBack={() => setMode(null)}
      />
    );
  }

  return (
    <div className="npc-migration-workspace">
      {(error || status) && (
        <div
          className={`npc-migration-message ${error ? "is-error" : "is-success"}`}
          role={error ? "alert" : "status"}
        >
          {error ? (
            <AlertTriangle size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          <span>{error || status}</span>
        </div>
      )}

      <div className="npc-migration-layout">
        <aside className="npc-migration-steps" aria-label="迁移流程">
          {workflowSteps.map(
            ({
              step,
              sequence,
              notices,
              blocked,
              actionRequired,
            }) => {
              return (
                <div
                  className={`npc-migration-step ${
                    blocked ? "is-blocked" : ""
                  } ${actionRequired ? "is-action-required" : ""}`}
                  key={step.id}
                >
                  <span>{String(sequence + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                    {notices.length > 0 && (
                      <ul className="npc-migration-step__notices">
                        {notices.map((notice) => (
                          <li
                            className={`is-${notice.tone}`}
                            key={notice.text}
                          >
                            {notice.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <em>
                    {blocked
                      ? "阻断"
                      : actionRequired
                        ? "待处理"
                        : step.mode === "automatic"
                          ? "自动"
                          : step.mode === "assisted"
                            ? "辅助"
                            : "人工"}
                  </em>
                </div>
              );
            },
          )}
        </aside>

        <section className="npc-migration-editor">
          <div
            className="npc-migration-section"
            data-collapsed={!sourceExpanded}
          >
            <header className="npc-migration-section__header">
              <button
                className="npc-migration-section__toggle"
                type="button"
                aria-expanded={sourceExpanded}
                onClick={() => setSourceExpanded((current) => !current)}
              >
                <ScanSearch size={17} />
                <span>
                  <strong>源资产</strong>
                  <small>
                    {source?.skeletalMeshName ?? "ART UE / CONTENT BROWSER"}
                  </small>
                </span>
                <ChevronDown size={15} />
              </button>
              <div className="npc-migration-section__actions">
                <button
                  className="button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void readSource()}
                  title="读取美术 UE 内容浏览器中选中的 Skeletal Mesh"
                >
                  {busy === "source" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  读取源资产
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setMode(null)}
                  title="返回模块选择"
                  aria-label="返回模块选择"
                >
                  <LayoutGrid size={17} />
                </button>
              </div>
            </header>
            {sourceExpanded &&
              (source ? (
                <dl className="npc-migration-summary">
                  <div>
                    <dt>Skeletal Mesh</dt>
                    <dd>{source.skeletalMeshName}</dd>
                  </div>
                  <div>
                    <dt>Skeleton</dt>
                    <dd title={source.skeletonAssetPath}>
                      {compactPath(source.skeletonAssetPath)}
                    </dd>
                  </div>
                  <div>
                    <dt>依赖</dt>
                    <dd>
                      {source.dependencyPackageNames.length} 包 /{" "}
                      {source.sourceFiles.length} 文件
                    </dd>
                  </div>
                  <div>
                    <dt>源工程</dt>
                    <dd title={source.sourceProjectFile}>
                      {compactPath(source.sourceProjectFile)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="npc-migration-empty">
                  <FileBox size={25} />
                  <strong>未读取源资产</strong>
                  <small>在美术 UE 内容浏览器中只选择一个 SK_ 资产</small>
                </div>
              ))}
          </div>

          <div
            className="npc-migration-section"
            data-collapsed={!parametersExpanded}
          >
            <header className="npc-migration-section__header">
              <button
                className="npc-migration-section__toggle"
                type="button"
                aria-expanded={parametersExpanded}
                onClick={() =>
                  setParametersExpanded((current) => !current)
                }
              >
                <Settings2 size={17} />
                <span>
                  <strong>迁移参数</strong>
                  <small>
                    {plan
                      ? `${plan.npcName} · ${plan.bodyAnimationFiles.length + plan.faceAnimationFiles.length} 个动作`
                      : "PATHS & NAMING"}
                  </small>
                </span>
                <ChevronDown size={15} />
              </button>
            </header>
            {parametersExpanded && (
            <div className="npc-migration-form">
              <div className="npc-migration-form__paths">
                <label>
                  <span>目标工程 Content</span>
                  <div>
                    <input
                      aria-label="目标工程 Content"
                      value={targetContentDirectory}
                      onChange={(event) => {
                        setTargetContentDirectory(event.target.value);
                        setPlan(null);
                      }}
                      placeholder="D:\...\res\Content"
                    />
                    <button
                      className="icon-button"
                      type="button"
                      title="选择目标工程 Content 目录"
                      aria-label="选择目标工程 Content 目录"
                      onClick={() => void chooseDirectory("target-content")}
                    >
                      <FolderOpen size={16} />
                    </button>
                  </div>
                </label>
                <label>
                  <span>
                    动作 FBX 目录
                    {animationSourceOrigin === "library" && (
                      <em>动作库自动匹配</em>
                    )}
                    {standardAbpTemplate === "animal" ? "（可留空）" : ""}
                  </span>
                  <div>
                    <input
                      aria-label="动作 FBX 目录"
                      value={animationSourceDirectory}
                      readOnly={animationSourceOrigin === "library"}
                      title={animationSourceDirectory}
                      onChange={(event) => {
                        setAnimationSourceDirectory(event.target.value);
                        setAnimationSourceOrigin("manual");
                        setPlan(null);
                      }}
                      placeholder="...\FBX合集\Npc\NXX_XXX\Animation"
                    />
                    <button
                      className="icon-button"
                      type="button"
                      title={
                        animationSourceOrigin === "library"
                          ? "更换自动匹配的动作目录"
                          : "选择动作 FBX 目录"
                      }
                      aria-label="选择动作 FBX 目录"
                      onClick={() => void chooseDirectory("animations")}
                    >
                      <FolderOpen size={16} />
                    </button>
                  </div>
                </label>
              </div>
              <div className="npc-migration-form__row">
                <label>
                  <span>NPC 名称</span>
                  <input
                    value={npcName}
                    onChange={(event) => {
                      setNpcName(event.target.value);
                      setPlan(null);
                    }}
                    placeholder="N28_Citizen_Male_C"
                  />
                </label>
                <div className="npc-migration-derived">
                  <span>目标资产目录</span>
                  <code title={targetPackagePath}>
                    {targetPackagePath || "读取 SK 后自动确定"}
                  </code>
                </div>
              </div>
              <div className="npc-migration-derived-names">
                <div>
                  <span>NPC BP</span>
                  <code>{blueprintName || "BP_..."}</code>
                </div>
                <div>
                  <span>动画 BP</span>
                  <code>{animationBlueprintName || "ABP_..."}</code>
                </div>
                {standardAbpTemplate === "animal" && npcName && (
                  <>
                    <div>
                      <span>动作前缀</span>
                      <code>{migrationIdentity.animationPrefix}</code>
                    </div>
                    <div>
                      <span>BP / ABP 目录</span>
                      <code title={migrationIdentity.blueprintPackagePath}>
                        {migrationIdentity.blueprintPackagePath}
                      </code>
                    </div>
                  </>
                )}
              </div>
              <button
                className="button button--primary npc-migration-plan-button"
                type="button"
                disabled={!source || busy !== null}
                onClick={() => void buildPlan()}
              >
                {busy === "plan" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <ClipboardCheck size={16} />
                )}
                检查迁移计划
              </button>
            </div>
            )}
          </div>

          <div className="npc-migration-section">
            <header>
              <Sparkles size={17} />
              <div>
                <strong>策划 UE 配置</strong>
                <small>NPC PROFILE</small>
              </div>
            </header>
            <div className="npc-migration-type-choice">
              <div>
                <strong>NPC 类型</strong>
                <small>
                  选择要创建的角色类型，模板与胶囊体规则会同步切换
                </small>
              </div>
              <div
                className="mode-segment npc-migration-template-segment"
                role="group"
                aria-label="NPC 类型"
              >
                <button
                  type="button"
                  className={standardAbpTemplate === "male" ? "is-active" : ""}
                  aria-pressed={standardAbpTemplate === "male"}
                  disabled={busy !== null}
                  onClick={() => selectNpcType("male")}
                >
                  男性
                </button>
                <button
                  type="button"
                  className={standardAbpTemplate === "female" ? "is-active" : ""}
                  aria-pressed={standardAbpTemplate === "female"}
                  disabled={busy !== null}
                  onClick={() => selectNpcType("female")}
                >
                  女性
                </button>
                <button
                  type="button"
                  className={standardAbpTemplate === "animal" ? "is-active" : ""}
                  aria-pressed={standardAbpTemplate === "animal"}
                  disabled={busy !== null}
                  title="使用 BP_E05_CAT01_NPC / ABP_E05_CAT01_NPC"
                  onClick={() => selectNpcType("animal")}
                >
                  动物
                </button>
              </div>
            </div>
            <details className="npc-migration-advanced">
              <summary>
                <Settings2 size={15} />
                <span>
                  <strong>高级配置</strong>
                  <small>默认值适用于标准 NPC 管线</small>
                </span>
                <ChevronDown size={15} />
              </summary>
              <div className="npc-migration-form">
                <div className="npc-migration-form__row">
                  <label>
                    <span>NPCBase</span>
                    <input
                      value={npcBaseClassPath}
                      onChange={(event) => {
                        setNpcBaseClassPath(event.target.value);
                        setTargetInspection(null);
                      }}
                    />
                  </label>
                  <label>
                    <span>AnimInstance 父类</span>
                    <input
                      value={animationBlueprintParentClassPath}
                      disabled={configureStandardAbp}
                      onChange={(event) => {
                        setAnimationBlueprintParentClassPath(event.target.value);
                        setTargetInspection(null);
                      }}
                    />
                  </label>
                </div>
                <label className="npc-migration-template-toggle">
                  <input
                    type="checkbox"
                    checked={configureStandardAbp}
                    disabled={standardAbpTemplate === "animal"}
                    title={
                      standardAbpTemplate === "animal"
                        ? "动物管线必须使用 BP_E05_CAT01_NPC 模板"
                        : undefined
                    }
                    onChange={(event) => {
                      setConfigureStandardAbp(event.target.checked);
                      setPlan(null);
                      setTargetInspection(null);
                    }}
                  />
                  <span>使用标准 NPC ABP 模板</span>
                </label>
                <label>
                  <span>转头曲线</span>
                  <input
                    value={turnCurveAssetPath}
                    disabled={!bindTurnCurve}
                    onChange={(event) => {
                      setTurnCurveAssetPath(event.target.value);
                      setTargetInspection(null);
                    }}
                  />
                </label>
                <div className="npc-migration-options">
                  <label>
                    <input
                      type="checkbox"
                      checked={autoFitCapsule}
                      onChange={(event) => {
                        setAutoFitCapsule(event.target.checked);
                        setTargetInspection(null);
                      }}
                    />
                    <span>
                      {standardAbpTemplate === "animal"
                        ? "套用模板胶囊体"
                        : "自动估算胶囊体"}
                    </span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={bindTurnCurve}
                      onChange={(event) => {
                        setBindTurnCurve(event.target.checked);
                        setTargetInspection(null);
                      }}
                    />
                    <span>自动绑定转头曲线</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={createMontages}
                      onChange={(event) => {
                        setCreateMontages(event.target.checked);
                        setTargetInspection(null);
                      }}
                    />
                    <span>自动创建 Idle / Turn Montage</span>
                  </label>
                </div>
              </div>
            </details>
          </div>
        </section>

        <aside className="npc-migration-review">
          <header>
            <PackageCheck size={18} />
            <div>
              <strong>执行审核</strong>
              <small>REVIEW & APPLY</small>
            </div>
          </header>
          {plan ? (
            <>
              <dl className="npc-migration-metrics">
                <div>
                  <dt>复制 / 复用</dt>
                  <dd
                    title={`待复制 ${fileOperationCounts.ready} 个（${fileSize(totalBytes)}），内容一致 ${fileOperationCounts.unchanged} 个，冲突 ${fileOperationCounts.conflict} 个`}
                  >
                    {fileOperationCounts.ready} / {fileOperationCounts.unchanged}
                  </dd>
                </div>
                <div>
                  <dt>Body</dt>
                  <dd>{plan.bodyAnimationFiles.length}</dd>
                </div>
                <div>
                  <dt>Montage</dt>
                  <dd>{plan.montages.length}</dd>
                </div>
                <div>
                  <dt>Face</dt>
                  <dd>{plan.faceAnimationFiles.length}</dd>
                </div>
              </dl>
              {plan.montages.length > 0 && (
                <div className="npc-migration-montage-list">
                  <strong>Montage 计划</strong>
                  {plan.montages.map((montage) => (
                    <div key={`${montage.montageName}:${montage.sourceFile}`}>
                      <code>{montage.montageName}</code>
                      <span>{montage.sourceAssetName}</span>
                      <em>{montage.slotName}</em>
                    </div>
                  ))}
                </div>
              )}
              <button
                className="button button--primary"
                type="button"
                disabled={!plan.canMigrate || busy !== null || migrated}
                onClick={() => void migrateAssets()}
              >
                {busy === "migrate" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : migrated ? (
                  <Check size={16} />
                ) : (
                  <PackageCheck size={16} />
                )}
                {migrated ? "基础资产已迁移" : "迁移基础资产"}
              </button>
              <div className="npc-migration-target-actions">
                <button
                  className="button"
                  type="button"
                  disabled={!migrated || busy !== null}
                  onClick={() => void inspectTarget()}
                >
                  {busy === "target" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ScanSearch size={16} />
                  )}
                  校验资产
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  disabled={
                    busy !== null ||
                    !targetInspection ||
                    targetInspection.blockedReasons.length > 0 ||
                    Boolean(result)
                  }
                  onClick={() => void configureTarget()}
                >
                  {busy === "configure" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : result ? (
                    <Check size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                  {result ? "BP 文件已配置" : "配置 BP 文件"}
                </button>
              </div>
              {targetInspection && (
                <div
                  className={`npc-migration-target-state ${
                    targetInspection.blockedReasons.length > 0
                      ? "is-blocked"
                      : "is-ready"
                  }`}
                >
                  <strong>
                    {targetInspection.blockedReasons.length > 0
                      ? "资产校验未通过"
                      : "目标资产已就绪"}
                  </strong>
                  <small title={targetInspection.targetProjectFile}>
                    {compactPath(targetInspection.targetProjectFile)}
                  </small>
                </div>
              )}
              {result && (
                <div className="npc-migration-result">
                  <div className="npc-migration-result__summary">
                    {result.capsuleEstimate && (
                      <span>
                        胶囊体 R{result.capsuleEstimate.radius} / H
                        {result.capsuleEstimate.halfHeight}
                      </span>
                    )}
                    {result.turnCurvePropertyPath && (
                      <span>曲线 {result.turnCurvePropertyPath}</span>
                    )}
                    {result.lookBlendSpaceAssetPath && (
                      <span>Look {plan.lookBlendSpaceName}</span>
                    )}
                    <span>
                      Montage {result.createdMontageAssetPaths.length}
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="npc-migration-empty">
              <ClipboardCheck size={25} />
              <strong>等待迁移计划</strong>
              <small>完成源资产与路径设置后执行检查</small>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
