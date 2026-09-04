import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileInput,
  FolderOpen,
  LayoutGrid,
  ListChecks,
  LoaderCircle,
  PackageCheck,
  Play,
  RefreshCw,
  ScanFace,
  SquareCheckBig,
  SquareX,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  NpcSupplementApplyResult,
  NpcSupplementKind,
  NpcSupplementPlan,
  NpcSupplementTarget,
} from "../types";
import {
  applyNpcSupplement,
  inspectNpcSupplementPlan,
  scanNpcSupplementTarget,
} from "../ue/client";

interface NpcSupplementWorkspaceProps {
  kind: NpcSupplementKind;
  onBack: () => void;
  onClose: () => void;
}

type BusyAction = "target" | "plan" | "apply" | null;

function compactPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function selectionKey(files: Iterable<string>): string {
  return Array.from(files).sort().join("\n");
}

function reviewKey(
  files: Iterable<string>,
  options: ReadonlyMap<
    string,
    { copyFaceCurves: boolean; makeMontage: boolean }
  >,
): string {
  return Array.from(files)
    .sort()
    .map((file) => {
      const option = options.get(file);
      return `${file}|${option?.copyFaceCurves ?? false}|${option?.makeMontage ?? false}`;
    })
    .join("\n");
}

export function NpcSupplementWorkspace({
  kind,
  onBack,
  onClose,
}: NpcSupplementWorkspaceProps) {
  const [target, setTarget] = useState<NpcSupplementTarget | null>(null);
  const [sourceDirectory, setSourceDirectory] = useState("");
  const [plan, setPlan] = useState<NpcSupplementPlan | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [faceOptions, setFaceOptions] = useState<
    Map<string, { copyFaceCurves: boolean; makeMontage: boolean }>
  >(new Map());
  const [reviewedSelectionKey, setReviewedSelectionKey] = useState("");
  const [result, setResult] = useState<NpcSupplementApplyResult | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const isFace = kind === "face";
  const title = isFace ? "面部补充" : "动作补充与修改";
  const currentSelectionKey = useMemo(
    () =>
      isFace
        ? reviewKey(selectedFiles, faceOptions)
        : selectionKey(selectedFiles),
    [faceOptions, isFace, selectedFiles],
  );
  const reviewIsCurrent =
    Boolean(plan) && currentSelectionKey === reviewedSelectionKey;
  const selectedItems =
    plan?.items.filter((item) => selectedFiles.has(item.sourceFile)) ?? [];
  const newCount = selectedItems.filter((item) => item.state === "new").length;
  const updateCount = selectedItems.filter(
    (item) => item.state === "update",
  ).length;

  function clearFeedback(): void {
    setError("");
    setStatus("");
  }

  async function readTarget(): Promise<void> {
    clearFeedback();
    setBusy("target");
    try {
      const next = await scanNpcSupplementTarget();
      setTarget(next);
      setPlan(null);
      setSelectedFiles(new Set());
      setFaceOptions(new Map());
      setReviewedSelectionKey("");
      setResult(null);
      setStatus(`已读取 ${next.npcName} · ${next.selectedAssetName}`);
    } catch (readError) {
      setError(
        readError instanceof Error ? readError.message : "NPC 目标读取失败",
      );
    } finally {
      setBusy(null);
    }
  }

  async function chooseDirectory(): Promise<void> {
    const chooser = window.shotSandboxDesktop?.chooseNpcMigrationDirectory;
    if (!chooser) {
      return;
    }
    const selected = await chooser("animations");
    if (!selected) {
      return;
    }
    setSourceDirectory(selected);
    setPlan(null);
    setSelectedFiles(new Set());
    setFaceOptions(new Map());
    setReviewedSelectionKey("");
    setResult(null);
  }

  async function inspectPlan(): Promise<void> {
    if (!target) {
      setError("请先读取策划 UE 中选中的 NPC BP 或 Body Skeletal Mesh");
      return;
    }
    clearFeedback();
    setBusy("plan");
    try {
      const next = await inspectNpcSupplementPlan({
        kind,
        target,
        sourceDirectory,
        includedSourceFiles: plan ? Array.from(selectedFiles) : undefined,
        faceOptions:
          isFace && plan
            ? Array.from(faceOptions, ([sourceFile, option]) => ({
                sourceFile,
                ...option,
              }))
            : undefined,
      });
      const nextSelected = new Set(
        next.items
          .filter((item) => item.included)
          .map((item) => item.sourceFile),
      );
      const nextFaceOptions = new Map(
        next.items.map((item) => [
          item.sourceFile,
          {
            copyFaceCurves: item.copyFaceCurves,
            makeMontage: item.makeMontage,
          },
        ]),
      );
      setPlan(next);
      setSelectedFiles(nextSelected);
      setFaceOptions(nextFaceOptions);
      setReviewedSelectionKey(
        isFace
          ? reviewKey(nextSelected, nextFaceOptions)
          : selectionKey(nextSelected),
      );
      setResult(null);
      setStatus(
        next.blockedReasons.length > 0
          ? `清单已生成，存在 ${next.blockedReasons.length} 个阻断项`
          : `清单已审核：新增 ${next.items.filter((item) => item.included && item.state === "new").length}，更新 ${next.items.filter((item) => item.included && item.state === "update").length}`,
      );
    } catch (planError) {
      setError(
        planError instanceof Error ? planError.message : "增补清单生成失败",
      );
    } finally {
      setBusy(null);
    }
  }

  function toggleItem(sourceFile: string): void {
    setSelectedFiles((current) => {
      const next = new Set(current);
      if (next.has(sourceFile)) {
        next.delete(sourceFile);
      } else {
        next.add(sourceFile);
      }
      return next;
    });
    setResult(null);
  }

  function selectAll(include: boolean): void {
    setSelectedFiles(
      include && plan
        ? new Set(
            plan.items
              .filter((item) => item.state !== "blocked")
              .map((item) => item.sourceFile),
          )
        : new Set(),
    );
    setResult(null);
  }

  function toggleFaceOption(
    sourceFile: string,
    option: "copyFaceCurves" | "makeMontage",
  ): void {
    setFaceOptions((current) => {
      const next = new Map(current);
      const value = next.get(sourceFile) ?? {
        copyFaceCurves: false,
        makeMontage: false,
      };
      next.set(sourceFile, { ...value, [option]: !value[option] });
      return next;
    });
    setResult(null);
  }

  async function applyPlan(): Promise<void> {
    if (
      !plan ||
      !reviewIsCurrent ||
      !window.confirm(
        isFace
          ? `将导入 ${selectedItems.length} 个 Face 动作，锁定根骨骼并保存。继续吗？`
          : `将导入 ${selectedItems.length} 个 Body 动作，其中 ${updateCount} 个会覆盖现有动作。继续吗？`,
      )
    ) {
      return;
    }
    clearFeedback();
    setBusy("apply");
    try {
      const next = await applyNpcSupplement(plan);
      setResult(next);
      setStatus(
        isFace
          ? `面部补充完成：导入 ${next.importedAssetPaths.length}，复制曲线 ${next.curveCopiedBodyAssetPaths.length}，创建 Montage ${next.createdMontageAssetPaths.length}`
          : `动作增补完成：导入 ${next.importedAssetPaths.length} 个动作，创建 ${next.createdMontageAssetPaths.length} 个 Montage`,
      );
    } catch (applyError) {
      setError(
        applyError instanceof Error ? applyError.message : "增补执行失败",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="npc-migration-workspace npc-supplement-workspace">
      <div className="workspace-subview-title">
        <strong>{title}</strong>
        <small>{isFace ? "FACE PIPELINE" : "BODY ACTIONS"}</small>
      </div>
      <div className="workspace-floating-actions">
        <button
          className="button workspace-floating-command"
          type="button"
          disabled={busy !== null}
          onClick={() => void readTarget()}
          title="读取策划 UE 内容浏览器中选中的 NPC BP 或 Body Skeletal Mesh"
        >
          {busy === "target" ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          读取 UE 目标
        </button>
        <button
          className="icon-button"
          type="button"
          disabled={busy !== null}
          onClick={onBack}
          title="重新选择处理类型"
          aria-label="重新选择处理类型"
        >
          <LayoutGrid size={17} />
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

      <div className="npc-supplement-layout">
        <aside className="npc-supplement-setup">
          <section>
            <header>
              {isFace ? <ScanFace size={18} /> : <FileInput size={18} />}
              <div>
                <strong>已有 NPC</strong>
                <small>TARGET UE</small>
              </div>
            </header>
            {target ? (
              <dl className="npc-supplement-target">
                <div>
                  <dt>NPC</dt>
                  <dd>{target.npcName}</dd>
                </div>
                <div>
                  <dt>Body Skeleton</dt>
                  <dd title={target.skeletonAssetPath}>
                    {compactPath(target.skeletonAssetPath)}
                  </dd>
                </div>
                {isFace && (
                  <div>
                    <dt>Face Skeleton</dt>
                    <dd title={target.faceSkeletonAssetPath}>
                      {target.faceSkeletonAssetPath
                        ? compactPath(target.faceSkeletonAssetPath)
                        : "未找到"}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Animation</dt>
                  <dd title={target.animationPackagePath}>
                    {target.animationPackagePath}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="npc-migration-empty">
                <RefreshCw size={24} />
                <strong>等待 UE 目标</strong>
                <small>选择 NPC BP 或 Body Skeletal Mesh</small>
              </div>
            )}
          </section>

          <section>
            <header>
              <FolderOpen size={18} />
              <div>
                <strong>动作来源</strong>
                <small>FBX DIRECTORY</small>
              </div>
            </header>
            <div className="npc-supplement-directory">
              <input
                aria-label="动作 FBX 目录"
                value={sourceDirectory}
                onChange={(event) => {
                  setSourceDirectory(event.target.value);
                  setPlan(null);
                  setSelectedFiles(new Set());
                  setFaceOptions(new Map());
                  setReviewedSelectionKey("");
                  setResult(null);
                }}
                placeholder={
                  isFace ? "...\\Animation\\Face" : "...\\Animation"
                }
              />
              <button
                className="icon-button"
                type="button"
                onClick={() => void chooseDirectory()}
                title="选择动作 FBX 目录"
                aria-label="选择动作 FBX 目录"
              >
                <FolderOpen size={16} />
              </button>
            </div>
            <button
              className="button button--primary"
              type="button"
              disabled={!target || !sourceDirectory.trim() || busy !== null}
              onClick={() => void inspectPlan()}
            >
              {busy === "plan" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ClipboardCheck size={16} />
              )}
              {plan && !reviewIsCurrent ? "更新审核清单" : "生成动作清单"}
            </button>
          </section>

        </aside>

        <main className="npc-supplement-list">
          <header>
            <div>
              <strong>动作清单</strong>
              <small>
                {plan
                  ? `${plan.items.length} ITEMS`
                  : isFace
                    ? "FACE ANIM SEQUENCES"
                    : "BODY ANIM SEQUENCES"}
              </small>
            </div>
            {plan && (
              <div className="npc-supplement-list-actions">
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy !== null || Boolean(result)}
                  onClick={() => selectAll(true)}
                  title="选择全部可处理动作"
                  aria-label="选择全部可处理动作"
                >
                  <SquareCheckBig size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy !== null || Boolean(result)}
                  onClick={() => selectAll(false)}
                  title="清空选择"
                  aria-label="清空选择"
                >
                  <SquareX size={16} />
                </button>
              </div>
            )}
          </header>
          {plan ? (
            <div
              className={`npc-supplement-table ${isFace ? "is-face" : ""}`}
              role="table"
            >
              <div
                className={`npc-supplement-table__head ${
                  isFace ? "is-face" : ""
                }`}
                role="row"
              >
                <span />
                <span>动作</span>
                <span>目标状态</span>
                <span>{isFace ? "Body 配对" : "Montage"}</span>
                {isFace && <span>曲线</span>}
                {isFace && <span>Montage</span>}
              </div>
              {plan.items.map((item) => (
                <div
                  className={`npc-supplement-row ${
                    item.state === "blocked" ? "is-blocked" : ""
                  } ${isFace ? "is-face" : ""}`}
                  role="row"
                  key={item.sourceFile}
                  title={item.blockedReason || item.targetAssetPath}
                >
                  <input
                    type="checkbox"
                    aria-label={`处理 ${item.sourceAssetName}`}
                    checked={selectedFiles.has(item.sourceFile)}
                    disabled={
                      item.state === "blocked" ||
                      busy !== null ||
                      Boolean(result)
                    }
                    onChange={() => toggleItem(item.sourceFile)}
                  />
                  <span>
                    <strong>{item.actionName || item.sourceAssetName}</strong>
                    <small>{item.sourceAssetName}</small>
                  </span>
                  <em data-state={item.state}>
                    {item.state === "new"
                      ? "新增"
                      : item.state === "update"
                        ? "更新"
                        : "阻断"}
                  </em>
                  <code>
                    {item.blockedReason ||
                      (isFace
                        ? item.bodyAssetPath.split("/").at(-1)
                        : item.montageName ||
                          "仅导入")}
                  </code>
                  {isFace && (
                    <label
                      className="npc-supplement-operation"
                      title="复制 Face Morph Target 曲线到 Body 动作"
                    >
                      <input
                        type="checkbox"
                        checked={
                          faceOptions.get(item.sourceFile)?.copyFaceCurves ??
                          item.copyFaceCurves
                        }
                        disabled={
                          item.state === "blocked" ||
                          !selectedFiles.has(item.sourceFile) ||
                          busy !== null ||
                          Boolean(result)
                        }
                        onChange={() =>
                          toggleFaceOption(
                            item.sourceFile,
                            "copyFaceCurves",
                          )
                        }
                      />
                      <span>复制</span>
                    </label>
                  )}
                  {isFace && (
                    <label
                      className="npc-supplement-operation"
                      title={
                        item.montageState === "reuse"
                          ? "复用现有 Montage"
                          : "生成 NPC Montage"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={
                          faceOptions.get(item.sourceFile)?.makeMontage ??
                          item.makeMontage
                        }
                        disabled={
                          item.state === "blocked" ||
                          !selectedFiles.has(item.sourceFile) ||
                          busy !== null ||
                          Boolean(result)
                        }
                        onChange={() =>
                          toggleFaceOption(item.sourceFile, "makeMontage")
                        }
                      />
                      <span>
                        {item.montageState === "reuse" ? "复用" : "生成"}
                      </span>
                    </label>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="npc-migration-empty">
              <ListChecks size={25} />
              <strong>尚未生成清单</strong>
              <small>读取 UE 目标并选择 FBX 目录</small>
            </div>
          )}
        </main>

        <aside className="npc-supplement-review">
          <header>
            <PackageCheck size={18} />
            <div>
              <strong>执行审核</strong>
              <small>REVIEW & APPLY</small>
            </div>
          </header>
          {plan ? (
            <>
              <dl className="npc-supplement-metrics">
                <div>
                  <dt>已选</dt>
                  <dd>{selectedItems.length}</dd>
                </div>
                <div>
                  <dt>新增</dt>
                  <dd>{newCount}</dd>
                </div>
                <div>
                  <dt>更新</dt>
                  <dd>{updateCount}</dd>
                </div>
              </dl>
              {!reviewIsCurrent && (
                <div className="npc-migration-review-list is-blocked">
                  <strong>
                    <AlertTriangle size={15} />
                    清单待更新
                  </strong>
                  <p>选择已经变化，请重新生成审核清单。</p>
                </div>
              )}
              {plan.blockedReasons.length > 0 && (
                <div className="npc-migration-review-list is-blocked">
                  <strong>
                    <AlertTriangle size={15} />
                    阻断项
                  </strong>
                  {plan.blockedReasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
              )}
              <div className="npc-migration-review-list">
                <strong>
                  <ListChecks size={15} />
                  执行内容
                </strong>
                {plan.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
              <button
                className="button button--primary"
                type="button"
                disabled={
                  busy !== null ||
                  !reviewIsCurrent ||
                  !plan.canApply ||
                  Boolean(result)
                }
                onClick={() => void applyPlan()}
              >
                {busy === "apply" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : result ? (
                  <Check size={16} />
                ) : (
                  <Play size={16} />
                )}
                {result
                  ? "执行已完成"
                  : isFace
                    ? "执行面部补充"
                    : "执行动作增补"}
              </button>
              {result && (
                <div className="npc-migration-result npc-supplement-result">
                  <div className="npc-migration-result__summary">
                    <span>动作 {result.importedAssetPaths.length}</span>
                    {isFace ? (
                      <>
                        <span>锁根 {result.lockedRootAssetPaths.length}</span>
                        <span>
                          曲线 {result.curveCopiedBodyAssetPaths.length}
                        </span>
                        <span>
                          Montage{" "}
                          {result.createdMontageAssetPaths.length +
                            result.reusedMontageAssetPaths.length}
                        </span>
                      </>
                    ) : (
                      <span>
                        Montage {result.createdMontageAssetPaths.length}
                      </span>
                    )}
                  </div>
                  <strong>最终确认</strong>
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
              <PackageCheck size={25} />
              <strong>等待审核清单</strong>
              <small>清单确认后才允许写入 UE</small>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
