import {
  AlertTriangle,
  ArrowUpDown,
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
import { useEffect, useMemo, useRef, useState } from "react";
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
}

type BusyAction = "target" | "plan" | "apply" | null;
type SupplementSort = "modified-desc" | "modified-asc" | "name-asc";

const sourceTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function compactPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function formatSourceModifiedTime(value: number): string {
  return value > 0 ? sourceTimeFormatter.format(new Date(value)) : "时间未知";
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
  const [reviewSyncing, setReviewSyncing] = useState(false);
  const [sort, setSort] = useState<SupplementSort>("modified-desc");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const reviewRevision = useRef(0);
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
  const pairedFaceCount = selectedItems.filter(
    (item) => item.pairedFace && item.pairedFace.state !== "blocked",
  ).length;
  const processableCount =
    plan?.items.filter((item) => item.state !== "blocked").length ?? 0;
  const sortedItems = useMemo(() => {
    const items = [...(plan?.items ?? [])];
    return items.sort((left, right) => {
      const leftModifiedTime = left.sourceModifiedTimeMs ?? 0;
      const rightModifiedTime = right.sourceModifiedTimeMs ?? 0;
      if (sort === "name-asc") {
        return left.sourceAssetName.localeCompare(
          right.sourceAssetName,
          "en",
          { sensitivity: "base" },
        );
      }
      if (
        leftModifiedTime === 0 ||
        rightModifiedTime === 0
      ) {
        if (leftModifiedTime === rightModifiedTime) {
          return left.sourceAssetName.localeCompare(
            right.sourceAssetName,
            "en",
            { sensitivity: "base" },
          );
        }
        return leftModifiedTime === 0 ? 1 : -1;
      }
      const timeDifference = leftModifiedTime - rightModifiedTime;
      return sort === "modified-desc" ? -timeDifference : timeDifference;
    });
  }, [plan, sort]);

  useEffect(() => {
    const revision = reviewRevision.current + 1;
    reviewRevision.current = revision;
    if (
      !plan ||
      !target ||
      !sourceDirectory.trim() ||
      currentSelectionKey === reviewedSelectionKey ||
      result ||
      busy !== null
    ) {
      if (!plan || currentSelectionKey === reviewedSelectionKey) {
        setReviewSyncing(false);
      }
      return;
    }

    setReviewSyncing(true);
    const selectedSnapshot = Array.from(selectedFiles);
    const faceOptionsSnapshot = Array.from(
      faceOptions,
      ([sourceFile, option]) => ({ sourceFile, ...option }),
    );
    const selectionSnapshotKey = currentSelectionKey;
    const timer = window.setTimeout(() => {
      void inspectNpcSupplementPlan({
        kind,
        target,
        sourceDirectory,
        includedSourceFiles: selectedSnapshot,
        faceOptions: isFace ? faceOptionsSnapshot : undefined,
      })
        .then((next) => {
          if (reviewRevision.current !== revision) {
            return;
          }
          setPlan(next);
          setReviewedSelectionKey(selectionSnapshotKey);
          setError("");
          const reviewedItems = next.items.filter((item) => item.included);
          const reviewedFaceCount = reviewedItems.filter(
            (item) =>
              item.pairedFace && item.pairedFace.state !== "blocked",
          ).length;
          setStatus(
            isFace
              ? `选择已自动审核：Face ${reviewedItems.length}`
              : `选择已自动审核：Body ${reviewedItems.length}，Face ${reviewedFaceCount}`,
          );
        })
        .catch((reviewError) => {
          if (reviewRevision.current !== revision) {
            return;
          }
          setError(
            reviewError instanceof Error
              ? reviewError.message
              : "选择范围自动审核失败，请重新扫描动作目录",
          );
        })
        .finally(() => {
          if (reviewRevision.current === revision) {
            setReviewSyncing(false);
          }
        });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [
    busy,
    currentSelectionKey,
    faceOptions,
    isFace,
    kind,
    plan,
    result,
    reviewedSelectionKey,
    selectedFiles,
    sourceDirectory,
    target,
  ]);

  function clearFeedback(): void {
    setError("");
    setStatus("");
  }

  function acceptPlan(
    next: NpcSupplementPlan,
    statusMessage?: string,
  ): void {
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
    setReviewSyncing(false);
    setResult(null);
    setStatus(
      statusMessage ??
        (next.blockedReasons.length > 0
          ? `清单已生成，存在 ${next.blockedReasons.length} 个阻断项`
          : `清单已审核：新增 ${next.items.filter((item) => item.included && item.state === "new").length}，更新 ${next.items.filter((item) => item.included && item.state === "update").length}`),
    );
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
      setReviewSyncing(false);
      setResult(null);
      const resolver =
        window.shotSandboxDesktop?.resolveNpcAnimationDirectory;
      if (!resolver) {
        setStatus(`已读取 ${next.npcName} · ${next.selectedAssetName}`);
        return;
      }
      const resolution = await resolver(next.npcName);
      if (resolution.directoryPath) {
        setSourceDirectory(resolution.directoryPath);
        const nextPlan = await inspectNpcSupplementPlan({
          kind,
          target: next,
          sourceDirectory: resolution.directoryPath,
        });
        acceptPlan(
          nextPlan,
          nextPlan.blockedReasons.length > 0
            ? `已自动匹配动作目录 · 存在 ${nextPlan.blockedReasons.length} 个阻断项`
            : `已自动匹配动作目录 · ${resolution.matchedFileCount} 个 Body FBX`,
        );
      } else if (resolution.candidateDirectories.length > 1) {
        setStatus(
          `已读取 ${next.npcName}；动作库中找到 ${resolution.candidateDirectories.length} 个候选目录，请手动选择`,
        );
      } else {
        setStatus(
          `已读取 ${next.npcName}；动作库中未找到对应目录`,
        );
      }
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
    setReviewSyncing(false);
    setResult(null);
  }

  async function inspectPlan(): Promise<void> {
    if (!target) {
      setError(
        "请先读取策划 UE 中选中的 NPC BP、Body Skeletal Mesh 或 Skeleton",
      );
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
      acceptPlan(next);
    } catch (planError) {
      setError(
        planError instanceof Error ? planError.message : "增补清单生成失败",
      );
    } finally {
      setBusy(null);
    }
  }

  function toggleItem(sourceFile: string): void {
    setReviewSyncing(true);
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
    setReviewSyncing(true);
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
    setReviewSyncing(true);
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
      reviewSyncing ||
      !reviewIsCurrent ||
      !window.confirm(
        isFace
          ? `将导入 ${selectedItems.length} 个 Face 动作，锁定根骨骼并保存。继续吗？`
          : `将导入 ${selectedItems.length} 个 Body 动作${
              pairedFaceCount > 0
                ? `，并自动导入 ${pairedFaceCount} 个同名 Face 动作`
                : ""
            }，其中 ${updateCount} 个 Body 动作会覆盖现有资产。继续吗？`,
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
          : `动作增补完成：Body ${selectedItems.length}，Face ${next.lockedRootAssetPaths.length}，创建 Montage ${next.createdMontageAssetPaths.length}`,
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
        <small>{isFace ? "FACE PIPELINE" : "BODY + AUTO FACE"}</small>
      </div>
      <div className="workspace-floating-actions">
        <button
          className="button workspace-floating-command"
          type="button"
          disabled={busy !== null}
          onClick={() => void readTarget()}
          title="读取策划 UE 内容浏览器中选中的 NPC BP、Body Skeletal Mesh 或 Skeleton"
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
          title="返回模块选择"
          aria-label="返回模块选择"
        >
          <LayoutGrid size={17} />
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
                <div>
                  <dt>Face Skeleton</dt>
                  <dd title={target.faceSkeletonAssetPath}>
                    {target.faceSkeletonAssetPath
                      ? compactPath(target.faceSkeletonAssetPath)
                      : "未找到"}
                  </dd>
                </div>
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
                <small>内容浏览器只选一个 BP、Body Mesh 或 Skeleton</small>
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
                  setReviewSyncing(false);
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
              disabled={
                !target ||
                !sourceDirectory.trim() ||
                busy !== null ||
                reviewSyncing
              }
              onClick={() => void inspectPlan()}
            >
              {busy === "plan" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ClipboardCheck size={16} />
              )}
              {plan ? "重新扫描动作目录" : "生成动作清单"}
            </button>
          </section>

        </aside>

        <main className="npc-supplement-list">
          <header>
            <div className="npc-supplement-list-header-main">
              <div className="npc-supplement-list-heading">
                <strong>动作清单</strong>
                <small>
                  {plan
                    ? `${selectedItems.length} / ${processableCount} 已选`
                    : isFace
                      ? "FACE ANIM SEQUENCES"
                      : "BODY ANIM SEQUENCES"}
                </small>
              </div>
              {plan && (
                <div className="npc-supplement-list-actions">
                  <button
                    className="npc-supplement-list-action"
                    type="button"
                    disabled={busy !== null || Boolean(result)}
                    onClick={() => selectAll(true)}
                    title="选择全部可处理动作"
                  >
                    <SquareCheckBig size={14} />
                    全选
                  </button>
                  <button
                    className="npc-supplement-list-action"
                    type="button"
                    disabled={busy !== null || Boolean(result)}
                    onClick={() => selectAll(false)}
                    title="清空选择"
                  >
                    <SquareX size={14} />
                    取消
                  </button>
                </div>
              )}
            </div>
            {plan && (
              <label className="npc-supplement-sort">
                <ArrowUpDown size={14} aria-hidden="true" />
                <select
                  aria-label="动作排序"
                  value={sort}
                  onChange={(event) =>
                    setSort(event.target.value as SupplementSort)
                  }
                >
                  <option value="modified-desc">最近修改</option>
                  <option value="modified-asc">最早修改</option>
                  <option value="name-asc">名称 A-Z</option>
                </select>
              </label>
            )}
          </header>
          {plan ? (
            <div
              className={`npc-supplement-table ${isFace ? "is-face" : ""}`}
              role="table"
              aria-label={isFace ? "面部动作增补清单" : "Body 动作增补清单"}
            >
              <div
                className={`npc-supplement-table__head ${
                  isFace ? "is-face" : ""
                }`}
                role="row"
              >
                <span role="columnheader">选择</span>
                <span role="columnheader">动作 / 修改时间</span>
                <span role="columnheader">目标状态</span>
                <span role="columnheader">
                  {isFace ? "Body 配对" : "Face 配对"}
                </span>
                {!isFace && <span role="columnheader">Montage</span>}
                {isFace && <span role="columnheader">曲线</span>}
                {isFace && <span role="columnheader">Montage</span>}
              </div>
              {sortedItems.map((item) => (
                <div
                  className={`npc-supplement-row ${
                    item.state === "blocked" ? "is-blocked" : ""
                  } ${
                    selectedFiles.has(item.sourceFile) ? "is-selected" : ""
                  } ${isFace ? "is-face" : ""}`}
                  role="row"
                  key={item.sourceFile}
                  title={item.blockedReason || item.targetAssetPath}
                >
                  <span className="npc-supplement-row__check" role="cell">
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
                  </span>
                  <span className="npc-supplement-row__action" role="cell">
                    <strong>{item.actionName || item.sourceAssetName}</strong>
                    <small className="npc-supplement-source-meta">
                      <span>{item.sourceAssetName}</span>
                      <time
                        dateTime={
                          item.sourceModifiedTimeMs > 0
                            ? new Date(
                                item.sourceModifiedTimeMs,
                              ).toISOString()
                            : undefined
                        }
                        title={
                          item.sourceModifiedTimeMs > 0
                            ? new Date(
                                item.sourceModifiedTimeMs,
                              ).toLocaleString("zh-CN", { hour12: false })
                            : "无法读取源文件修改时间"
                        }
                      >
                        {formatSourceModifiedTime(
                          item.sourceModifiedTimeMs,
                        )}
                      </time>
                    </small>
                  </span>
                  <em data-state={item.state} role="cell">
                    {item.state === "new"
                      ? "新增"
                      : item.state === "update"
                        ? "更新"
                        : "阻断"}
                  </em>
                  <code
                    className={
                      !isFace && item.pairedFace
                        ? "npc-supplement-face-pair"
                        : undefined
                    }
                    data-state={item.pairedFace?.state}
                    role="cell"
                    title={
                      !isFace && item.pairedFace
                        ? item.pairedFace.blockedReason ||
                          item.pairedFace.sourceFile
                        : undefined
                    }
                  >
                    {isFace
                      ? item.blockedReason ||
                        item.bodyAssetPath.split("/").at(-1)
                      : item.pairedFace
                        ? item.pairedFace.blockedReason ||
                          `${
                            item.pairedFace.state === "update"
                              ? "更新"
                              : "新增"
                          } Face`
                        : "无匹配"}
                  </code>
                  {!isFace && (
                    <code
                      role="cell"
                      title={
                        item.montageName
                          ? `${item.montageName} · ${
                              item.montageState === "reuse"
                                ? "保留原 Slot"
                                : item.montageSlotName
                            }`
                          : "该动作属于状态机或混合空间素材"
                      }
                    >
                      {item.montageName
                        ? `${item.montageName} · ${
                            item.montageState === "reuse"
                              ? "保留原 Slot"
                              : item.montageSlotName
                          }`
                        : "仅导入"}
                    </code>
                  )}
                  {isFace && (
                    <label
                      className="npc-supplement-operation"
                      title="复制 Face Morph Target 曲线到 Body 动作"
                      role="cell"
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
                      role="cell"
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
                <div className="npc-migration-review-list is-syncing">
                  <strong>
                    {reviewSyncing ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )}
                    {reviewSyncing ? "正在同步选择" : "自动审核未完成"}
                  </strong>
                  <p>
                    {reviewSyncing
                      ? "无需操作，完成后即可直接执行。"
                      : "请检查顶部错误后重新扫描动作目录。"}
                  </p>
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
                  reviewSyncing ||
                  !reviewIsCurrent ||
                  !plan.canApply ||
                  selectedItems.length === 0 ||
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
                    {isFace ? (
                      <>
                        <span>动作 {result.importedAssetPaths.length}</span>
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
                      <>
                        <span>
                          Body{" "}
                          {result.importedAssetPaths.length -
                            result.lockedRootAssetPaths.length}
                        </span>
                        <span>Face {result.lockedRootAssetPaths.length}</span>
                        <span>
                          Montage {result.createdMontageAssetPaths.length}
                        </span>
                      </>
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
