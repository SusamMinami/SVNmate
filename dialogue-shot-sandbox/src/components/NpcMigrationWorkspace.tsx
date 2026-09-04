import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileBox,
  FolderOpen,
  LoaderCircle,
  PackageCheck,
  Play,
  RefreshCw,
  ScanSearch,
  Settings2,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  NpcMigrationPlan,
  NpcMigrationSourceScan,
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
import { inferStandardAbpTemplate } from "../data/npcMigration";

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

export function NpcMigrationWorkspace({
  onClose,
}: NpcMigrationWorkspaceProps) {
  const [source, setSource] = useState<NpcMigrationSourceScan | null>(null);
  const [targetContentDirectory, setTargetContentDirectory] = useState("");
  const [animationSourceDirectory, setAnimationSourceDirectory] = useState("");
  const [npcName, setNpcName] = useState("");
  const [targetPackagePath, setTargetPackagePath] = useState("");
  const [npcBaseClassPath, setNpcBaseClassPath] = useState("BP_NPCBase");
  const [
    animationBlueprintParentClassPath,
    setAnimationBlueprintParentClassPath,
  ] = useState("SeriaNPCAnimInstance");
  const [turnCurveAssetPath, setTurnCurveAssetPath] = useState(
    "/Game/Seria/NPC/Animation/Npc_head_turn.Npc_head_turn",
  );
  const [autoFitCapsule, setAutoFitCapsule] = useState(true);
  const [bindTurnCurve, setBindTurnCurve] = useState(true);
  const [createMontages, setCreateMontages] = useState(true);
  const [configureStandardAbp, setConfigureStandardAbp] = useState(true);
  const [standardAbpTemplate, setStandardAbpTemplate] = useState<
    "male" | "female"
  >("female");
  const [plan, setPlan] = useState<NpcMigrationPlan | null>(null);
  const [migrated, setMigrated] = useState(false);
  const [targetInspection, setTargetInspection] =
    useState<NpcMigrationTargetInspection | null>(null);
  const [result, setResult] = useState<NpcMigrationTargetResult | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const blueprintName = npcName ? `BP_${npcName}` : "";
  const animationBlueprintName = npcName ? `ABP_${npcName}` : "";

  const totalBytes = useMemo(
    () =>
      plan?.fileOperations.reduce(
        (total, operation) => total + operation.size,
        0,
      ) ?? 0,
    [plan],
  );

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
      setStandardAbpTemplate(
        inferStandardAbpTemplate(next.suggestedNpcName),
      );
      setPlan(null);
      setMigrated(false);
      setTargetInspection(null);
      setResult(null);
      setStatus(
        `已读取 ${next.skeletalMeshName}，共 ${next.dependencyPackageNames.length} 个依赖包`,
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
    }
    setPlan(null);
    setTargetInspection(null);
    setResult(null);
  }

  async function buildPlan(): Promise<void> {
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
        configureStandardAbp,
        standardAbpTemplate,
      });
      setPlan(next);
      setMigrated(false);
      setTargetInspection(null);
      setResult(null);
      setStatus(
        next.blockedReasons.length > 0
          ? `计划已生成，存在 ${next.blockedReasons.length} 个阻断项`
          : `计划已就绪：${next.fileOperations.length} 个资产文件，${next.bodyAnimationFiles.length + next.faceAnimationFiles.length} 个动作`,
      );
    } catch (planError) {
      setError(
        planError instanceof Error ? planError.message : "迁移计划生成失败",
      );
    } finally {
      setBusy(null);
    }
  }

  async function migrateAssets(): Promise<void> {
    if (
      !plan ||
      !window.confirm(
        `将 ${plan.fileOperations.length} 个文件复制到策划工程 Content，且不覆盖已有文件。继续吗？`,
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
        `基础资产迁移完成：${copyResult.copiedFiles.length} 个文件，${fileSize(copyResult.copiedBytes)}`,
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
          ? `策划 UE 校验完成，存在 ${inspection.blockedReasons.length} 个阻断项`
          : "策划 UE 校验通过，可以执行配置",
      );
    } catch (inspectionError) {
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : "策划 UE 校验失败",
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
        `将在策划 UE 导入 ${plan!.bodyAnimationFiles.length + plan!.faceAnimationFiles.length} 个动作并创建 ${plan!.blueprintName} / ${plan!.animationBlueprintName}${
          plan!.configureStandardAbp
            ? `，套用${plan!.standardAbpTemplate === "male" ? "男性" : "女性"}标准 ABP 模板`
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
        `目标配置完成：导入 ${configured.importedAnimationAssetPaths.length} 个动作，创建 ${configured.createdMontageAssetPaths.length} 个 Montage`,
      );
    } catch (configurationError) {
      setError(
        configurationError instanceof Error
          ? configurationError.message
          : "策划 UE 配置失败",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="npc-migration-workspace">
      <div className="workspace-floating-actions">
        <button
          className="button workspace-floating-command"
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
          className="icon-button workspace-floating-back"
          type="button"
          disabled={busy !== null}
          onClick={onClose}
          title="返回分镜工作台"
          aria-label="返回分镜工作台"
        >
          <ArrowLeft size={17} />
        </button>
      </div>

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
          {(plan?.steps ?? [
            {
              id: "source",
              label: "采集 Skeletal Mesh 与依赖",
              mode: "automatic",
              state: source ? "ready" : "blocked",
              detail: source ? source.skeletalMeshName : "等待读取源资产",
            },
          ]).map((step, index) => (
            <div
              className={`npc-migration-step ${
                step.state === "blocked" ? "is-blocked" : ""
              }`}
              key={step.id}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </div>
              <em>{step.mode === "automatic" ? "自动" : step.mode === "assisted" ? "辅助" : "人工"}</em>
            </div>
          ))}
        </aside>

        <section className="npc-migration-editor">
          <div className="npc-migration-section">
            <header>
              <ScanSearch size={17} />
              <div>
                <strong>源资产</strong>
                <small>ART UE / CONTENT BROWSER</small>
              </div>
            </header>
            {source ? (
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
            )}
          </div>

          <div className="npc-migration-section">
            <header>
              <Settings2 size={17} />
              <div>
                <strong>迁移参数</strong>
                <small>PATHS & NAMING</small>
              </div>
            </header>
            <div className="npc-migration-form">
              <label>
                <span>策划工程 Content</span>
                <div>
                  <input
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
                    title="选择 Content 目录"
                    aria-label="选择 Content 目录"
                    onClick={() => void chooseDirectory("target-content")}
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </label>
              <label>
                <span>动作 FBX 目录</span>
                <div>
                  <input
                    value={animationSourceDirectory}
                    onChange={(event) => {
                      setAnimationSourceDirectory(event.target.value);
                      setPlan(null);
                    }}
                    placeholder="...\FBX合集\Npc\NXX_XXX\Animation"
                  />
                  <button
                    className="icon-button"
                    type="button"
                    title="选择动作目录"
                    aria-label="选择动作目录"
                    onClick={() => void chooseDirectory("animations")}
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </label>
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
          </div>

          <div className="npc-migration-section">
            <header>
              <Sparkles size={17} />
              <div>
                <strong>策划 UE 配置</strong>
                <small>BLUEPRINT CLASSES</small>
              </div>
            </header>
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
              <div className="npc-migration-template-row">
                <label className="npc-migration-template-toggle">
                  <input
                    type="checkbox"
                    checked={configureStandardAbp}
                    onChange={(event) => {
                      setConfigureStandardAbp(event.target.checked);
                      setPlan(null);
                      setTargetInspection(null);
                    }}
                  />
                  <span>标准 NPC ABP 模板</span>
                </label>
                <div
                  className="mode-segment npc-migration-template-segment"
                  role="group"
                  aria-label="标准 NPC ABP 模板"
                >
                  <button
                    type="button"
                    className={standardAbpTemplate === "male" ? "is-active" : ""}
                    aria-pressed={standardAbpTemplate === "male"}
                    disabled={!configureStandardAbp}
                    onClick={() => {
                      setStandardAbpTemplate("male");
                      setPlan(null);
                      setTargetInspection(null);
                    }}
                  >
                    男性
                  </button>
                  <button
                    type="button"
                    className={standardAbpTemplate === "female" ? "is-active" : ""}
                    aria-pressed={standardAbpTemplate === "female"}
                    disabled={!configureStandardAbp}
                    onClick={() => {
                      setStandardAbpTemplate("female");
                      setPlan(null);
                      setTargetInspection(null);
                    }}
                  >
                    女性
                  </button>
                </div>
              </div>
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
                  <span>自动估算胶囊体</span>
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
                  <dt>基础文件</dt>
                  <dd title={fileSize(totalBytes)}>
                    {plan.fileOperations.length}
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
              {plan.blockedReasons.length > 0 && (
                <div className="npc-migration-review-list is-blocked">
                  <strong>
                    <ShieldAlert size={15} />
                    阻断项
                  </strong>
                  {plan.blockedReasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
              )}
              <div className="npc-migration-review-list">
                <strong>
                  <AlertTriangle size={15} />
                  人工确认
                </strong>
                {plan.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
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
                  校验策划 UE
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
                  {result ? "配置已完成" : "执行目标配置"}
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
                      ? "策划 UE 未通过"
                      : "策划 UE 已就绪"}
                  </strong>
                  <small title={targetInspection.targetProjectFile}>
                    {compactPath(targetInspection.targetProjectFile)}
                  </small>
                  {targetInspection.blockedReasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                  {targetInspection.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
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
                  <strong>最终人工复核</strong>
                  {result.manualChecks.map((check, index) => (
                    <p key={check}>
                      <span>{index + 1}</span>
                      {check}
                    </p>
                  ))}
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
