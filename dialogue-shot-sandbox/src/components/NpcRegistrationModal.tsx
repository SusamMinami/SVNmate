import {
  AlertTriangle,
  CheckCircle2,
  FilePenLine,
  FileSpreadsheet,
  LoaderCircle,
  PencilLine,
  RefreshCw,
  UserRoundPlus,
  X,
} from "lucide-react";
import { type ClipboardEvent, useState } from "react";
import {
  formatUnrealRotator,
  formatUnrealVector,
  parseUnrealRotatorText,
  parseUnrealVectorText,
} from "../data/npcRegistration";
import type {
  MissionTargetEditRequest,
  MissionTargetTransform,
  MissionTargetUpdateItem,
  NpcRegistrationCandidate,
  NpcRegistrationWriteItem,
  SelectedLevelActorsResult,
} from "../types";
import {
  openConfigTable,
  readSelectedLevelActors,
  scanSelectedNpcRegistration,
  updateMissionTargetTransforms,
  writeNpcRegistrationDraft,
} from "../ue/client";

interface NpcRegistrationModalProps {
  editRequest?: MissionTargetEditRequest;
  onClose: () => void;
  onTargetsUpdated?: (items: MissionTargetUpdateItem[]) => void;
}

interface NewNpcDraft {
  name: string;
  title: string;
  canTurn: boolean;
}

interface TargetTransformDraft {
  actorRef: string;
  positionText: string;
  rotationText: string;
}

function actorClassName(classPath: string): string {
  return classPath.split(".").at(-1)?.replace(/_C$/i, "") || classPath;
}

function normalizedAssetPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").toLowerCase();
  const withoutClass = normalized.endsWith("_c")
    ? normalized.slice(0, -2)
    : normalized;
  return withoutClass.split(".")[0];
}

function transformChanged(
  original: MissionTargetTransform,
  next: MissionTargetTransform,
): boolean {
  return (
    Math.abs(original.location.x - next.location.x) > 0.000001 ||
    Math.abs(original.location.y - next.location.y) > 0.000001 ||
    Math.abs(original.location.z - next.location.z) > 0.000001 ||
    Math.abs(original.rotation.pitch - next.rotation.pitch) > 0.000001 ||
    Math.abs(original.rotation.yaw - next.rotation.yaw) > 0.000001 ||
    Math.abs(original.rotation.roll - next.rotation.roll) > 0.000001
  );
}

function turnLabel(canTurn: boolean | null | undefined): string {
  if (canTurn === true) {
    return "可转身";
  }
  if (canTurn === false) {
    return "不可转身";
  }
  return "转身未配置";
}

export function NpcRegistrationModal({
  editRequest,
  onClose,
  onTargetsUpdated,
}: NpcRegistrationModalProps) {
  const editMode = Boolean(editRequest);
  const [selection, setSelection] =
    useState<SelectedLevelActorsResult | null>(null);
  const [candidates, setCandidates] = useState<
    NpcRegistrationCandidate[]
  >([]);
  const [npcChoices, setNpcChoices] = useState<Record<string, string>>({});
  const [newNpcDrafts, setNewNpcDrafts] = useState<
    Record<string, NewNpcDraft>
  >({});
  const [mapChoices, setMapChoices] = useState<Record<string, string>>({});
  const [writtenActorRefs, setWrittenActorRefs] = useState<Set<string>>(
    new Set(),
  );
  const [editDrafts, setEditDrafts] = useState<
    Record<string, TargetTransformDraft>
  >(() =>
    Object.fromEntries(
      (editRequest?.targets ?? []).map((target) => [
        target.targetId,
        {
          actorRef: "",
          positionText: formatUnrealVector(target.transform.location),
          rotationText: formatUnrealRotator(target.transform.rotation),
        },
      ]),
    ),
  );
  const [writtenTargetIds, setWrittenTargetIds] = useState<Set<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const missingModelCount = candidates.filter(
    (candidate) =>
      candidate.targetMatches.length === 0 &&
      candidate.modelOptions.length === 0,
  ).length;
  const newNpcCount = candidates.filter(
    (candidate) =>
      candidate.targetMatches.length === 0 &&
      (npcChoices[candidate.actor.actorRef] ?? "new") === "new",
  ).length;
  const newTargetCount = candidates.filter(
    (candidate) =>
      candidate.targetMatches.length === 0 &&
      !writtenActorRefs.has(candidate.actor.actorRef),
  ).length;
  const parsedEditItems =
    editRequest?.targets.map((target) => {
      const draft = editDrafts[target.targetId];
      const location = parseUnrealVectorText(draft?.positionText ?? "");
      const rotation = parseUnrealRotatorText(draft?.rotationText ?? "");
      const originalTransform: MissionTargetTransform = {
        location: target.transform.location,
        rotation: target.transform.rotation,
      };
      const transform =
        location && rotation ? { location, rotation } : null;
      return {
        target,
        draft,
        originalTransform,
        transform,
        changed: Boolean(
          transform && transformChanged(originalTransform, transform),
        ),
      };
    }) ?? [];
  const changedEditCount = parsedEditItems.filter(
    (item) => item.changed && !writtenTargetIds.has(item.target.targetId),
  ).length;
  const invalidEditCount = parsedEditItems.filter(
    (item) => !item.transform,
  ).length;

  async function refreshSelection() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (editRequest) {
        const result = await readSelectedLevelActors();
        if (
          normalizedAssetPath(result.mapAssetPath) !==
          normalizedAssetPath(editRequest.mapAssetPath)
        ) {
          throw new Error(
            `当前 UE 关卡与目标物地图不一致：${result.mapAssetPath}`,
          );
        }
        const claimedActors = new Set<string>();
        let matchedCount = 0;
        const nextDrafts = { ...editDrafts };
        setSelection(result);
        for (const target of editRequest.targets) {
          const identity =
            `ShotSandboxMissionTargetPreview_${editRequest.taskId}_${target.targetId}`.toLowerCase();
          const actor = result.actors.find(
            (candidate) =>
              !claimedActors.has(candidate.actorRef) &&
              `${candidate.actorRef}\n${candidate.label}`
                .toLowerCase()
                .includes(identity),
          );
          if (!actor) {
            continue;
          }
          claimedActors.add(actor.actorRef);
          matchedCount += 1;
          nextDrafts[target.targetId] = {
            actorRef: actor.actorRef,
            positionText: formatUnrealVector(actor.transform.location),
            rotationText: formatUnrealRotator(actor.transform.rotation),
          };
        }
        setEditDrafts(nextDrafts);
        setWrittenTargetIds(new Set());
        setStatus(
          result.actors.length === 0
            ? "当前 UE 关卡没有选中的 Actor，可直接粘贴 Transform"
            : `已读取 ${result.actors.length} 个 UE Actor，按预览名称匹配 ${matchedCount} 个目标物`,
        );
        return;
      }
      const result = await scanSelectedNpcRegistration();
      setSelection(result.selection);
      setCandidates(result.candidates);
      const nextChoices: Record<string, string> = {};
      const nextDrafts: Record<string, NewNpcDraft> = {};
      const nextMapChoices: Record<string, string> = {};
      for (const candidate of result.candidates) {
        const targetNpcId = candidate.targetMatches
          .map((target) => target.npcId)
          .find(
            (npcId) =>
              npcId !== null &&
              candidate.npcOptions.some((npc) => npc.id === npcId),
          );
        nextChoices[candidate.actor.actorRef] =
          targetNpcId !== undefined
            ? String(targetNpcId)
            : candidate.npcOptions.length === 1
              ? String(candidate.npcOptions[0].id)
              : candidate.npcOptions.length > 1
                ? "choose"
                : "new";
        nextDrafts[candidate.actor.actorRef] = {
          name: candidate.actor.label.replace(/^BP_/i, ""),
          title: "",
          canTurn: true,
        };
        nextMapChoices[candidate.actor.actorRef] =
          candidate.mapId ?? "";
      }
      setNpcChoices(nextChoices);
      setNewNpcDrafts(nextDrafts);
      setMapChoices(nextMapChoices);
      setWrittenActorRefs(new Set());
      setStatus(
        result.selection.actors.length > 0
          ? `已读取 ${result.selection.actors.length} 个 UE Actor`
          : "当前 UE 关卡没有选中的 Actor",
      );
    } catch (selectionError) {
      setSelection(null);
      setCandidates([]);
      setNpcChoices({});
      setMapChoices({});
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "读取 UE 选择失败",
      );
    } finally {
      setBusy(false);
    }
  }

  function updateEditDraft(
    targetId: string,
    changes: Partial<TargetTransformDraft>,
  ) {
    setEditDrafts((current) => ({
      ...current,
      [targetId]: {
        ...current[targetId],
        ...changes,
      },
    }));
    setWrittenTargetIds((current) => {
      const next = new Set(current);
      next.delete(targetId);
      return next;
    });
    setError("");
    setStatus("");
  }

  function assignActor(targetId: string, actorRef: string) {
    const actor = selection?.actors.find(
      (candidate) => candidate.actorRef === actorRef,
    );
    updateEditDraft(
      targetId,
      actor
        ? {
            actorRef,
            positionText: formatUnrealVector(actor.transform.location),
            rotationText: formatUnrealRotator(actor.transform.rotation),
          }
        : { actorRef: "" },
    );
  }

  function normalizeEditField(
    targetId: string,
    field: "positionText" | "rotationText",
  ) {
    const value = editDrafts[targetId]?.[field] ?? "";
    const parsed =
      field === "positionText"
        ? parseUnrealVectorText(value)
        : parseUnrealRotatorText(value);
    if (!parsed) {
      return;
    }
    updateEditDraft(targetId, {
      [field]:
        field === "positionText"
          ? formatUnrealVector(parsed as { x: number; y: number; z: number })
          : formatUnrealRotator(
              parsed as { pitch: number; yaw: number; roll: number },
            ),
    });
  }

  function pasteEditTransform(
    targetId: string,
    event: ClipboardEvent<HTMLInputElement>,
  ) {
    const value = event.clipboardData.getData("text");
    const location = parseUnrealVectorText(value);
    const rotation = parseUnrealRotatorText(value);
    if (!location || !rotation) {
      return;
    }
    event.preventDefault();
    updateEditDraft(targetId, {
      positionText: formatUnrealVector(location),
      rotationText: formatUnrealRotator(rotation),
    });
  }

  async function writeTargetUpdates() {
    if (!editRequest) {
      return;
    }
    const invalid = parsedEditItems.find((item) => !item.transform);
    if (invalid) {
      setError(
        `目标物 ${invalid.target.targetId} 的位置或旋转格式无效`,
      );
      return;
    }
    const changed = parsedEditItems.filter(
      (item) =>
        item.changed && !writtenTargetIds.has(item.target.targetId),
    );
    if (changed.length === 0) {
      setStatus("没有需要写入的位置或旋转变化");
      return;
    }
    const actorRefs = changed
      .map((item) => item.draft.actorRef)
      .filter(Boolean);
    if (new Set(actorRefs).size !== actorRefs.length) {
      setError("同一个 UE Actor 不能绑定到多个目标物 ID");
      return;
    }
    const mismatchedActor = changed.find((item) => {
      if (!item.draft.actorRef || !item.target.modelClassPath) {
        return false;
      }
      const actor = selection?.actors.find(
        (candidate) => candidate.actorRef === item.draft.actorRef,
      );
      return (
        actor &&
        normalizedAssetPath(actor.classPath) !==
          normalizedAssetPath(item.target.modelClassPath)
      );
    });
    if (mismatchedActor) {
      setError(
        `目标物 ${mismatchedActor.target.targetId} 绑定的 UE Actor 模型不一致`,
      );
      return;
    }
    const items: MissionTargetUpdateItem[] = changed.map((item) => ({
      targetId: item.target.targetId,
      mapId: item.target.mapId,
      originalTransform: item.originalTransform,
      transform: item.transform!,
    }));
    if (
      !window.confirm(
        `将按目标物 ID 修改 ${items.length} 行，仅更新位置和旋转。\n\n工作簿会保持未保存状态，是否继续？`,
      )
    ) {
      setStatus("已取消写入 Excel");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await updateMissionTargetTransforms(items);
      setWrittenTargetIds(
        new Set(items.map((item) => item.targetId)),
      );
      onTargetsUpdated?.(items);
      setStatus(
        `已写入未保存草稿：修改 ${result.updatedTargets.length} 个目标物${
          result.unchangedTargetIds.length
            ? `，${result.unchangedTargetIds.length} 个已是目标值`
            : ""
        }`,
      );
    } catch (writeError) {
      setError(
        writeError instanceof Error
          ? writeError.message
          : "修改目标物位置失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function writeNewItems() {
    const pendingCandidates = candidates.filter(
      (candidate) =>
        candidate.targetMatches.length === 0 &&
        !writtenActorRefs.has(candidate.actor.actorRef),
    );
    if (pendingCandidates.length === 0) {
      return;
    }
    const missingMap = pendingCandidates.find(
      (candidate) => !mapChoices[candidate.actor.actorRef],
    );
    if (missingMap) {
      setError(`Actor ${missingMap.actor.label} 无法匹配 MapID`);
      return;
    }
    const missingNpcChoice = pendingCandidates.find(
      (candidate) =>
        (npcChoices[candidate.actor.actorRef] ?? "new") === "choose",
    );
    if (missingNpcChoice) {
      setError(`请选择 ${missingNpcChoice.actor.label} 使用的 NPC`);
      return;
    }
    const items: NpcRegistrationWriteItem[] = pendingCandidates.map(
      (candidate) => {
        const choice = npcChoices[candidate.actor.actorRef] ?? "new";
        const existingNpc =
          choice === "new"
            ? undefined
            : candidate.npcOptions.find(
                (npc) => npc.id === Number(choice),
              );
        const draft = newNpcDrafts[candidate.actor.actorRef] ?? {
          name: candidate.actor.label.replace(/^BP_/i, ""),
          title: "",
          canTurn: true,
        };
        return {
          actorRef: candidate.actor.actorRef,
          label: candidate.actor.label,
          classPath: candidate.actor.classPath,
          transform: candidate.actor.transform,
          mapId: mapChoices[candidate.actor.actorRef],
          existingModelId: candidate.modelOptions[0]?.id ?? null,
          existingNpcId: existingNpc?.id ?? null,
          existingTargetId: null,
          canTurn: existingNpc?.canTurn ?? draft.canTurn,
          newNpc:
            existingNpc === undefined
              ? {
                  name: draft.name.trim(),
                  title: draft.title.trim(),
                  canTurn: draft.canTurn,
                }
              : null,
        };
      },
    );
    const unnamed = items.find(
      (item) => item.newNpc && !item.newNpc.name,
    );
    if (unnamed) {
      setError(`请填写 ${unnamed.label} 的 NPC 名称`);
      return;
    }
    if (
      !window.confirm(
        `将向 Excel 源表写入 ${items.length} 个目标物，并按需新增 ${missingModelCount} 个模型、${newNpcCount} 个 NPC。\n\n工作簿会保持未保存状态，是否继续？`,
      )
    ) {
      setStatus("已取消写入 Excel");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await writeNpcRegistrationDraft(items);
      setWrittenActorRefs(
        new Set(items.map((item) => item.actorRef)),
      );
      const actorLabels = new Map(
        items.map((item) => [item.actorRef, item.label]),
      );
      const targetAssignments = [
        ...result.createdTargets.map((target) =>
          `${actorLabels.get(target.actorRef) ?? target.actorRef} → ${target.id}`,
        ),
        ...result.reusedTargets.map((target) =>
          `${actorLabels.get(target.actorRef) ?? target.actorRef} → ${target.id}（复用）`,
        ),
      ];
      setStatus(
        `已写入未保存草稿：模型 ${result.createdModels.length}、NPC ${result.createdNpcs.length}、目标物 ${result.createdTargets.length}${
          targetAssignments.length
            ? `；目标物 ID：${targetAssignments.join("，")}`
            : ""
        }`,
      );
    } catch (writeError) {
      setError(
        writeError instanceof Error
          ? writeError.message
          : "写入 Excel 草稿失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openTable(
    table: "missionTarget" | "npc" | "model",
    label: string,
  ) {
    setBusy(true);
    setError("");
    try {
      await openConfigTable(table);
      setStatus(`已打开${label}`);
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : `无法打开${label}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop npc-registration-backdrop" role="presentation">
      <section
        className="npc-registration-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="npc-registration-title"
      >
        <header>
          <div className="npc-registration-title">
            <span>
              {editMode ? (
                <PencilLine size={18} />
              ) : (
                <UserRoundPlus size={18} />
              )}
            </span>
            <div>
              <small>
                {editMode ? "按目标物 ID 更新配置" : "UE 选择注册草稿"}
              </small>
              <h2 id="npc-registration-title">
                {editMode ? "修改目标物位置" : "注册 NPC"}
              </h2>
            </div>
          </div>
          <div className="npc-registration-header-actions">
            <button
              className="button"
              type="button"
              onClick={() => void refreshSelection()}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              读取 UE 选择
            </button>
            <button
              className="icon-button"
              type="button"
              title="关闭"
              aria-label={editMode ? "关闭修改目标物位置" : "关闭注册 NPC"}
              onClick={onClose}
              disabled={busy}
            >
              <X size={17} />
            </button>
          </div>
        </header>

        {error && (
          <div className="npc-registration-message is-error" role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}
        {status && (
          <div className="npc-registration-message is-success" role="status">
            <CheckCircle2 size={16} />
            <span>{status}</span>
          </div>
        )}

        <div className="npc-registration-body">
          {editMode && editRequest ? (
            <table className="npc-registration-table npc-target-edit-table">
              <thead>
                <tr>
                  <th>目标物</th>
                  <th>NPC / 模型</th>
                  <th>UE Actor</th>
                  <th>新位置</th>
                  <th>新旋转</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {parsedEditItems.map(
                  ({ target, draft, transform, changed }) => {
                    const positionValid = Boolean(
                      parseUnrealVectorText(draft.positionText),
                    );
                    const rotationValid = Boolean(
                      parseUnrealRotatorText(draft.rotationText),
                    );
                    const isWritten = writtenTargetIds.has(target.targetId);
                    const state = isWritten
                      ? { label: "已写入", tone: "is-existing" }
                      : !transform
                        ? { label: "格式错误", tone: "is-warning" }
                        : changed
                          ? { label: "待修改", tone: "is-new" }
                          : { label: "未修改", tone: "is-existing" };
                    return (
                      <tr key={target.targetId}>
                        <td>
                          <strong>{target.targetId}</strong>
                          <small>{target.description || "未填写描述"}</small>
                        </td>
                        <td title={target.modelClassPath}>
                          <strong>
                            {target.npcId && target.npcId > 0
                              ? `${target.npcName || "未知 NPC"} · ${target.npcId}`
                              : "N/A"}
                          </strong>
                          <small>
                            {target.modelClassPath
                              ? actorClassName(target.modelClassPath)
                              : "无模型资源"}
                          </small>
                        </td>
                        <td>
                          <select
                            value={draft.actorRef}
                            disabled={busy}
                            onChange={(event) =>
                              assignActor(target.targetId, event.target.value)
                            }
                            aria-label={`目标物 ${target.targetId} UE Actor`}
                          >
                            <option value="">未绑定</option>
                            {(selection?.actors ?? []).map((actor) => {
                              const assignedElsewhere = parsedEditItems.some(
                                (item) =>
                                  item.target.targetId !== target.targetId &&
                                  item.draft.actorRef === actor.actorRef,
                              );
                              return (
                                <option
                                  key={actor.actorRef}
                                  value={actor.actorRef}
                                  disabled={assignedElsewhere}
                                >
                                  {actor.label}
                                </option>
                              );
                            })}
                          </select>
                        </td>
                        <td>
                          <input
                            className={
                              positionValid ? undefined : "is-invalid"
                            }
                            value={draft.positionText}
                            disabled={busy}
                            onChange={(event) =>
                              updateEditDraft(target.targetId, {
                                positionText: event.target.value,
                              })
                            }
                            onBlur={() =>
                              normalizeEditField(
                                target.targetId,
                                "positionText",
                              )
                            }
                            onPaste={(event) =>
                              pasteEditTransform(target.targetId, event)
                            }
                            aria-label={`目标物 ${target.targetId} 新位置`}
                            spellCheck={false}
                          />
                          <small>
                            原 {formatUnrealVector(target.transform.location)}
                          </small>
                        </td>
                        <td>
                          <input
                            className={
                              rotationValid ? undefined : "is-invalid"
                            }
                            value={draft.rotationText}
                            disabled={busy}
                            onChange={(event) =>
                              updateEditDraft(target.targetId, {
                                rotationText: event.target.value,
                              })
                            }
                            onBlur={() =>
                              normalizeEditField(
                                target.targetId,
                                "rotationText",
                              )
                            }
                            onPaste={(event) =>
                              pasteEditTransform(target.targetId, event)
                            }
                            aria-label={`目标物 ${target.targetId} 新旋转`}
                            spellCheck={false}
                          />
                          <small>
                            原{" "}
                            {formatUnrealRotator(target.transform.rotation)}
                          </small>
                        </td>
                        <td>
                          <span
                            className={`registration-state ${state.tone}`}
                          >
                            {state.label}
                          </span>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          ) : candidates.length > 0 ? (
            <table className="npc-registration-table">
              <thead>
                <tr>
                  <th>UE Actor</th>
                  <th>模型资源</th>
                  <th>NPC 复用</th>
                  <th>地图</th>
                  <th>位置</th>
                  <th>旋转</th>
                  <th>目标物</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => {
                  const {
                    actor,
                    modelOptions,
                    npcOptions,
                    positionMatches,
                    targetMatches,
                  } = candidate;
                  const choice = npcChoices[actor.actorRef] ?? "new";
                  const draft = newNpcDrafts[actor.actorRef] ?? {
                    name: actor.label.replace(/^BP_/i, ""),
                    title: "",
                    canTurn: true,
                  };
                  const isWritten = writtenActorRefs.has(actor.actorRef);
                  return (
                    <tr key={actor.actorRef}>
                      <td title={actor.classPath}>
                        <strong>{actor.label}</strong>
                        <small>{actorClassName(actor.classPath)}</small>
                      </td>
                      <td
                        className={
                          modelOptions.length > 0
                            ? "registration-match"
                            : undefined
                        }
                      >
                        {modelOptions.length > 0 ? (
                          <>
                            <strong>
                              {modelOptions.map((model) => model.id).join(" / ")}
                            </strong>
                            <small>已有</small>
                          </>
                        ) : (
                          <span className="registration-state is-warning">
                            先注册模型资源
                          </span>
                        )}
                      </td>
                      <td>
                        {modelOptions.length > 0 && (
                          <select
                            value={choice}
                            disabled={busy}
                            onChange={(event) =>
                              setNpcChoices((current) => ({
                                ...current,
                                [actor.actorRef]: event.target.value,
                              }))
                            }
                            aria-label={`${actor.label} NPC 复用方式`}
                          >
                            {npcOptions.length > 1 && (
                              <option value="choose">请选择 NPC</option>
                            )}
                            {npcOptions.map((npc) => (
                              <option key={npc.id} value={npc.id}>
                                {npc.id} · {npc.name} ·{" "}
                                {npc.title || "无头衔"} ·{" "}
                                {turnLabel(npc.canTurn)}
                              </option>
                            ))}
                            <option value="new">新建 NPC</option>
                          </select>
                        )}
                        {choice === "new" && (
                          <div className="npc-registration-new-fields">
                            <input
                              value={draft.name}
                              disabled={busy}
                              onChange={(event) =>
                                setNewNpcDrafts((current) => ({
                                  ...current,
                                  [actor.actorRef]: {
                                    ...draft,
                                    name: event.target.value,
                                  },
                                }))
                              }
                              aria-label={`${actor.label} 新 NPC 名称`}
                              placeholder="NPC 名称"
                            />
                            <input
                              value={draft.title}
                              disabled={busy}
                              onChange={(event) =>
                                setNewNpcDrafts((current) => ({
                                  ...current,
                                  [actor.actorRef]: {
                                    ...draft,
                                    title: event.target.value,
                                  },
                                }))
                              }
                              aria-label={`${actor.label} 新 NPC 头衔`}
                              placeholder="头衔"
                            />
                            <label>
                              <input
                                type="checkbox"
                                checked={draft.canTurn}
                                disabled={busy}
                                onChange={(event) =>
                                  setNewNpcDrafts((current) => ({
                                    ...current,
                                    [actor.actorRef]: {
                                      ...draft,
                                      canTurn: event.target.checked,
                                    },
                                  }))
                                }
                              />
                              可转身
                            </label>
                          </div>
                        )}
                      </td>
                      <td>
                        {candidate.mapOptions.length > 1 ? (
                          <select
                            value={mapChoices[actor.actorRef] ?? ""}
                            disabled={busy}
                            onChange={(event) =>
                              setMapChoices((current) => ({
                                ...current,
                                [actor.actorRef]: event.target.value,
                              }))
                            }
                            aria-label={`${actor.label} MapID`}
                          >
                            <option value="">选择 MapID</option>
                            {candidate.mapOptions.map((map) => (
                              <option key={map.id} value={map.id}>
                                {map.id} · {map.name}
                              </option>
                            ))}
                          </select>
                        ) : candidate.mapId ? (
                          <>
                            <strong>{candidate.mapId}</strong>
                            <small>{candidate.mapName}</small>
                          </>
                        ) : (
                          <span className="registration-state is-warning">
                            地图未匹配
                          </span>
                        )}
                      </td>
                      <td
                        className={
                          positionMatches.length > 0
                            ? "registration-match"
                            : undefined
                        }
                      >
                        <code>
                          {[
                            actor.transform.location.x,
                            actor.transform.location.y,
                            actor.transform.location.z,
                          ]
                            .map((value) => value.toFixed(3))
                            .join(", ")}
                        </code>
                      </td>
                      <td
                        className={
                          targetMatches.length > 0
                            ? "registration-match"
                            : undefined
                        }
                      >
                        <code>
                          {[
                            actor.transform.rotation.pitch,
                            actor.transform.rotation.yaw,
                            actor.transform.rotation.roll,
                          ]
                            .map((value) => `${value.toFixed(2)}°`)
                            .join(", ")}
                        </code>
                      </td>
                      <td>
                        {targetMatches.length > 0 ? (
                          <span className="registration-state is-existing">
                            已有 {targetMatches.map((target) => target.id).join(" / ")}
                          </span>
                        ) : isWritten ? (
                          <span className="registration-state is-existing">
                            已写入待保存
                          </span>
                        ) : (
                          <span className="registration-state is-new">
                            新增
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="npc-registration-empty">
              <UserRoundPlus size={28} />
              <strong>当前没有注册草稿</strong>
              <small>
                {selection
                  ? selection.mapAssetPath
                  : "等待读取 UE 编辑器选择"}
              </small>
            </div>
          )}
        </div>

        <footer>
          <span>
            {editRequest
              ? `任务 ${editRequest.taskId} · ${editRequest.targets.length} 个目标物 · ${changedEditCount} 项待修改${
                  invalidEditCount ? ` · ${invalidEditCount} 项格式错误` : ""
                }`
              : selection
                ? `${candidates.length} 个 Actor · ${missingModelCount} 个模型待注册 · ${newNpcCount} 个 NPC 待新建 · ${newTargetCount} 个目标物待新增`
                : "只读取关卡选择，不修改地图或配置表"}
          </span>
          <div>
            {editMode ? (
              <>
                <button
                  className="button"
                  type="button"
                  onClick={() => void openTable("missionTarget", "目标物表")}
                  disabled={busy}
                >
                  <FileSpreadsheet size={15} />
                  目标物表
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void writeTargetUpdates()}
                  disabled={
                    busy || changedEditCount === 0 || invalidEditCount > 0
                  }
                >
                  <PencilLine size={15} />
                  写入修改
                </button>
              </>
            ) : (
              <>
                <button
                  className="button"
                  type="button"
                  onClick={() => void openTable("model", "模型资源表")}
                  disabled={busy || missingModelCount === 0}
                >
                  <FileSpreadsheet size={15} />
                  模型资源表
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => void openTable("npc", "NPC 表")}
                  disabled={busy || newNpcCount === 0}
                >
                  <FileSpreadsheet size={15} />
                  NPC 表
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => void openTable("missionTarget", "目标物表")}
                  disabled={busy || newTargetCount === 0}
                >
                  <FileSpreadsheet size={15} />
                  目标物表
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => void writeNewItems()}
                  disabled={busy || newTargetCount === 0}
                >
                  <FilePenLine size={15} />
                  写入新增项
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
