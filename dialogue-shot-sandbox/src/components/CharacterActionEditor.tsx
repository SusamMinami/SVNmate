import {
  AlertTriangle,
  ChevronRight,
  GripVertical,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CharacterActionEditorController } from "../app/useCharacterActionEditor";
import type {
  DialogueCharacterActionItem,
  DialogueSequence,
} from "../types";

interface CharacterActionEditorProps {
  controller: CharacterActionEditorController;
  sequence: DialogueSequence;
  dialogueIds: string[];
  busy: boolean;
}

interface DraggedAction {
  dialogueId: string;
  modelIndex: number;
  actionId: string;
}

function actionTypeLabel(action: DialogueCharacterActionItem): string {
  const type = action.behaviourType ?? "ENone";
  return {
    enone: "Montage",
    erotate: "旋转",
    ewalk: "走位",
    estatemachinewalk: "状态机走位",
  }[type.toLowerCase()] ?? type;
}

export function CharacterActionEditor({
  controller,
  sequence,
  dialogueIds,
  busy,
}: CharacterActionEditorProps) {
  const [expandedDialogueId, setExpandedDialogueId] = useState(
    dialogueIds[0] ?? "",
  );
  const [pendingModelByDialogue, setPendingModelByDialogue] = useState<
    Record<string, number>
  >({});
  const [draggedAction, setDraggedAction] =
    useState<DraggedAction | null>(null);
  const editingDisabled = busy || controller.loading;
  const participants = useMemo(
    () =>
      sequence.participants
        .filter(
          (participant) =>
            participant.modelIndex !== null && participant.modelClassPath,
        )
        .sort(
          (left, right) =>
            (left.modelIndex ?? 0) - (right.modelIndex ?? 0),
        ),
    [sequence.participants],
  );
  const participantByModelIndex = useMemo(
    () =>
      new Map(
        participants.map((participant) => [
          participant.modelIndex!,
          participant,
        ]),
      ),
    [participants],
  );
  const catalogByModelIndex = useMemo(
    () =>
      new Map(
        controller.catalogs.map((catalog) => [
          catalog.modelIndex,
          catalog,
        ]),
      ),
    [controller.catalogs],
  );
  const rows = dialogueIds.flatMap((dialogueId) => {
    const row = sequence.rows.find((item) => item.id === dialogueId);
    return row ? [row] : [];
  });

  useEffect(() => {
    if (
      expandedDialogueId &&
      !dialogueIds.includes(expandedDialogueId)
    ) {
      setExpandedDialogueId(dialogueIds[0] ?? "");
    }
  }, [dialogueIds, expandedDialogueId]);

  async function refresh() {
    if (
      controller.hasChanges &&
      !window.confirm("重新读取 UE 会放弃尚未导出的动作修改，是否继续？")
    ) {
      return;
    }
    await controller.refresh();
  }

  return (
    <section className="inspector-section character-action-editor">
      <div className="section-label">
        <span>动作编辑</span>
        <button
          className="icon-button"
          type="button"
          title={
            controller.loading
              ? "正在读取 UE 动作"
              : "重新读取 BP Montages 和节点动作"
          }
          aria-label="重新读取角色动作"
          disabled={busy || controller.loading}
          onClick={() => void refresh()}
        >
          {controller.loading ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
        </button>
      </div>

      {(controller.error || controller.status) && (
        <div
          className={`character-action-editor__status ${
            controller.error ? "is-error" : ""
          }`}
          role={controller.error ? "alert" : "status"}
        >
          {controller.error && <AlertTriangle size={13} />}
          <span>{controller.error || controller.status}</span>
        </div>
      )}

      <div className="character-action-nodes">
        {rows.map((row) => {
          const expanded = expandedDialogueId === row.id;
          const existingTracks = controller.existingTracks.filter(
            (track) => track.dialogueId === row.id,
          );
          const pendingTracks = controller.tracks.filter(
            (track) => track.dialogueId === row.id,
          );
          const modelIndexes = Array.from(
            new Set([
              ...existingTracks.map((track) => track.modelIndex),
              ...pendingTracks.map((track) => track.modelIndex),
            ]),
          ).sort((left, right) => left - right);
          const usedModelIndexes = new Set(modelIndexes);
          const availableParticipants = participants.filter(
            (participant) =>
              !usedModelIndexes.has(participant.modelIndex!) &&
              (catalogByModelIndex.get(participant.modelIndex!)?.actions
                .length ?? 0) > 0,
          );
          const pendingModel =
            pendingModelByDialogue[row.id] ??
            availableParticipants[0]?.modelIndex ??
            -1;
          const actionCount =
            existingTracks.reduce(
              (total, track) => total + track.actions.length,
              0,
            ) +
            pendingTracks.reduce(
              (total, track) => total + track.actions.length,
              0,
            );
          return (
            <article
              className="character-action-node"
              key={row.id}
              data-expanded={expanded}
            >
              <button
                className="character-action-node__toggle"
                type="button"
                aria-expanded={expanded}
                aria-controls={`character-action-node-${row.id}`}
                onClick={() =>
                  setExpandedDialogueId((current) =>
                    current === row.id ? "" : row.id,
                  )
                }
              >
                <ChevronRight size={14} />
                <code>{row.id}</code>
                <span>{row.content}</span>
                <small>{actionCount} 项</small>
              </button>

              {expanded && (
                <div
                  className="character-action-node__body"
                  id={`character-action-node-${row.id}`}
                >
                  {modelIndexes.map((modelIndex) => {
                    const participant = participantByModelIndex.get(modelIndex);
                    const catalog = catalogByModelIndex.get(modelIndex);
                    const existingTrack = existingTracks.find(
                      (track) => track.modelIndex === modelIndex,
                    );
                    const pendingTrack = pendingTracks.find(
                      (track) => track.modelIndex === modelIndex,
                    );
                    return (
                      <section
                        className="character-action-track"
                        key={`${row.id}:${modelIndex}`}
                      >
                        <header>
                          <span
                            className="character-action-track__slot"
                            style={{ backgroundColor: participant?.color }}
                          >
                            {modelIndex}
                          </span>
                          <strong>
                            {participant?.name ?? `BP 槽 ${modelIndex}`}
                          </strong>
                          {(existingTrack?.actions.length ?? 0) > 0 && (
                            <small>
                              已配置 {existingTrack!.actions.length} 项
                            </small>
                          )}
                          {pendingTrack && (
                            <button
                              className="icon-button"
                              type="button"
                              title="移除本次新增动作"
                              aria-label={`移除 ${participant?.name ?? `BP 槽 ${modelIndex}`} 的新增动作`}
                              disabled={editingDisabled}
                              onClick={() =>
                                controller.removeParticipant(
                                  row.id,
                                  modelIndex,
                                )
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </header>

                        {(existingTrack?.actions.length ?? 0) > 0 && (
                          <div className="character-action-existing-list">
                            {existingTrack!.actions.map((action, index) => (
                              <div
                                className="character-action-existing-row"
                                key={`${action.montageName}:${index}`}
                              >
                                <LockKeyhole size={12} aria-hidden="true" />
                                <code>{action.montageName}</code>
                                <span>
                                  {actionTypeLabel(action)} ·{" "}
                                  {action.delaySeconds.toFixed(1)}s
                                </span>
                              </div>
                            ))}
                            {existingTrack!.preservedComplexActionCount >
                              0 && (
                              <small>
                                另保留{" "}
                                {existingTrack!.preservedComplexActionCount}{" "}
                                个无 Montage 特殊动作
                              </small>
                            )}
                          </div>
                        )}

                        {pendingTrack && (
                          <div className="character-action-list">
                            {pendingTrack.actions.map(
                              (action, actionIndex) => (
                                <div
                                  className={`character-action-row ${
                                    draggedAction?.actionId === action.id
                                      ? "is-dragging"
                                      : ""
                                  }`}
                                  draggable={!editingDisabled}
                                  key={action.id}
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData(
                                      "text/plain",
                                      action.id,
                                    );
                                    setDraggedAction({
                                      dialogueId: row.id,
                                      modelIndex,
                                      actionId: action.id,
                                    });
                                  }}
                                  onDragOver={(event) => {
                                    if (!editingDisabled) {
                                      event.preventDefault();
                                      event.dataTransfer.dropEffect = "move";
                                    }
                                  }}
                                  onDrop={(event) => {
                                    event.preventDefault();
                                    if (editingDisabled) {
                                      return;
                                    }
                                    const sourceActionId =
                                      event.dataTransfer.getData(
                                        "text/plain",
                                      ) || draggedAction?.actionId;
                                    if (
                                      !sourceActionId ||
                                      (draggedAction &&
                                        (draggedAction.dialogueId !== row.id ||
                                          draggedAction.modelIndex !==
                                            modelIndex))
                                    ) {
                                      return;
                                    }
                                    const sourceIndex =
                                      pendingTrack.actions.findIndex(
                                        (item) =>
                                          item.id === sourceActionId,
                                      );
                                    controller.reorderAction(
                                      row.id,
                                      modelIndex,
                                      sourceIndex,
                                      actionIndex,
                                    );
                                    setDraggedAction(null);
                                  }}
                                  onDragEnd={() => setDraggedAction(null)}
                                >
                                  <GripVertical
                                    aria-hidden="true"
                                    className="character-action-row__handle"
                                    size={14}
                                  />
                                  <select
                                    aria-label={`${participant?.name ?? "角色"} 新增动作 ${actionIndex + 1}`}
                                    disabled={editingDisabled}
                                    title={
                                      catalog?.actions.find(
                                        (montage) =>
                                          montage.name === action.montageName,
                                      )?.assetPath ?? action.montageName
                                    }
                                    value={action.montageName}
                                    onChange={(event) =>
                                      controller.updateAction(
                                        row.id,
                                        modelIndex,
                                        action.id,
                                        { montageName: event.target.value },
                                      )
                                    }
                                  >
                                    {(catalog?.actions ?? []).map((montage) => (
                                      <option
                                        key={montage.name}
                                        title={montage.assetPath}
                                        value={montage.name}
                                      >
                                        {montage.name}
                                      </option>
                                    ))}
                                  </select>
                                  <label>
                                    <span>延迟</span>
                                    <input
                                      type="number"
                                      min="0"
                                      max="120"
                                      step="0.1"
                                      value={action.delaySeconds}
                                      disabled={editingDisabled}
                                      onChange={(event) =>
                                        controller.updateAction(
                                          row.id,
                                          modelIndex,
                                          action.id,
                                          {
                                            delaySeconds: Math.max(
                                              0,
                                              Math.min(
                                                120,
                                                Number(event.target.value) || 0,
                                              ),
                                            ),
                                          },
                                        )
                                      }
                                    />
                                    <small>s</small>
                                  </label>
                                  <button
                                    className="icon-button"
                                    type="button"
                                    title="删除新增动作"
                                    aria-label={`删除新增动作 ${action.montageName}`}
                                    disabled={editingDisabled}
                                    onClick={() =>
                                      controller.removeAction(
                                        row.id,
                                        modelIndex,
                                        action.id,
                                      )
                                    }
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              ),
                            )}
                          </div>
                        )}

                        <button
                          className="character-action-track__add"
                          type="button"
                          disabled={
                            editingDisabled ||
                            catalog?.status !== "loaded" ||
                            catalog.actions.length === 0
                          }
                          title={
                            catalog?.status === "loaded"
                              ? "添加新动作"
                              : catalog?.message || "该 BP 没有可用动作"
                          }
                          onClick={() =>
                            pendingTrack
                              ? controller.addAction(row.id, modelIndex)
                              : controller.addParticipant(row.id, modelIndex)
                          }
                        >
                          <Plus size={13} />
                          添加动作
                        </button>
                      </section>
                    );
                  })}

                  <div className="character-action-node__add">
                    <select
                      aria-label={`节点 ${row.id} 添加角色`}
                      value={pendingModel}
                      disabled={
                        editingDisabled ||
                        availableParticipants.length === 0
                      }
                      onChange={(event) =>
                        setPendingModelByDialogue((current) => ({
                          ...current,
                          [row.id]: Number(event.target.value),
                        }))
                      }
                    >
                      {availableParticipants.length === 0 ? (
                        <option value={-1}>没有可添加的角色</option>
                      ) : (
                        availableParticipants.map((participant) => (
                          <option
                            key={participant.instanceId}
                            value={participant.modelIndex!}
                          >
                            {participant.modelIndex} {participant.name}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      className="button"
                      type="button"
                      disabled={
                        editingDisabled ||
                        pendingModel < 0
                      }
                      title={
                        availableParticipants.length > 0
                          ? "添加角色动作"
                          : "当前节点没有其他可添加角色"
                      }
                      onClick={() => {
                        controller.addParticipant(row.id, pendingModel);
                        setPendingModelByDialogue((current) => {
                          const next = { ...current };
                          delete next[row.id];
                          return next;
                        });
                      }}
                    >
                      <Plus size={14} />
                      添加角色
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
