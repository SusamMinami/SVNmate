import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GripVertical,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  memo,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CharacterActionEditorController,
  CharacterActionTrackDraft,
} from "../app/useCharacterActionEditor";
import type {
  BlueprintMontageAction,
  DialogueCharacterActionItem,
  DialogueCharacterActionTrack,
  DialogueSequence,
} from "../types";
import { dialogueParticipantsByModelIndex } from "../data/characterActions";

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

interface MontagePickerProps {
  actions: BlueprintMontageAction[];
  actionByName: ReadonlyMap<string, BlueprintMontageAction>;
  value: string;
  label: string;
  disabled: boolean;
  dialogueId: string;
  modelIndex: number;
  actionId: string;
  onUpdate: CharacterActionEditorController["updateAction"];
}

const MAX_VISIBLE_MONTAGES = 8;
const MONTAGE_OPTION_HEIGHT = 25;
const EMPTY_MONTAGE_ACTIONS: BlueprintMontageAction[] = [];
const EMPTY_MONTAGE_ACTION_INDEX = new Map<
  string,
  BlueprintMontageAction
>();

export function matchingMontageActions(
  actions: readonly BlueprintMontageAction[],
  query: string,
): BlueprintMontageAction[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return actions.filter((action) => {
    if (terms.length === 0) {
      return true;
    }
    const searchable =
      `${action.name} ${action.assetPath}`.toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

export function montageActionWindow(
  actions: readonly BlueprintMontageAction[],
  requestedStart: number,
): {
  total: number;
  start: number;
  visible: BlueprintMontageAction[];
} {
  const maximumStart = Math.max(
    0,
    actions.length - MAX_VISIBLE_MONTAGES,
  );
  const start = Math.min(Math.max(0, requestedStart), maximumStart);
  return {
    total: actions.length,
    start,
    visible: actions.slice(start, start + MAX_VISIBLE_MONTAGES),
  };
}

const MontagePicker = memo(function MontagePicker({
  actions,
  actionByName,
  value,
  label,
  disabled,
  dialogueId,
  modelIndex,
  actionId,
  onUpdate,
}: MontagePickerProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const committedValueRef = useRef(value);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleStart, setVisibleStart] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const matchingActions = useMemo(
    () =>
      open ? matchingMontageActions(actions, deferredQuery) : [],
    [actions, deferredQuery, open],
  );
  const filtered = useMemo(() => {
    return montageActionWindow(matchingActions, visibleStart);
  }, [matchingActions, visibleStart]);

  useEffect(() => {
    if (value === committedValueRef.current) {
      return;
    }
    committedValueRef.current = value;
    setQuery(value);
  }, [value]);

  useEffect(() => {
    setActiveIndex(0);
    setVisibleStart(0);
    if (listboxRef.current) {
      listboxRef.current.scrollTop = 0;
    }
  }, [deferredQuery]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  function selectAction(action: BlueprintMontageAction) {
    cancelPendingScrollFrame();
    committedValueRef.current = action.name;
    setQuery(action.name);
    setOpen(false);
    onUpdate(dialogueId, modelIndex, actionId, {
      montageName: action.name,
    });
  }

  function closeAndRestore() {
    cancelPendingScrollFrame();
    setOpen(false);
    setQuery(committedValueRef.current);
    setVisibleStart(0);
    setActiveIndex(0);
    setLoadingMore(false);
  }

  function showAllActions() {
    cancelPendingScrollFrame();
    setQuery("");
    setVisibleStart(0);
    setActiveIndex(0);
    setOpen(true);
    window.requestAnimationFrame(() => {
      if (listboxRef.current) {
        listboxRef.current.scrollTop = 0;
      }
      inputRef.current?.focus();
    });
  }

  function cancelPendingScrollFrame() {
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    setLoadingMore(false);
  }

  function updateVisibleWindow(scrollTop: number) {
    const nextStart = Math.min(
      Math.max(0, filtered.total - MAX_VISIBLE_MONTAGES),
      Math.max(0, Math.floor(scrollTop / MONTAGE_OPTION_HEIGHT)),
    );
    if (nextStart === filtered.start) {
      return;
    }
    setLoadingMore(true);
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      setVisibleStart(nextStart);
      setActiveIndex(0);
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        setLoadingMore(false);
        scrollFrameRef.current = null;
      });
    });
  }

  function moveActiveSelection(direction: -1 | 1) {
    if (filtered.total === 0) {
      return;
    }
    const currentAbsolute = filtered.start + activeIndex;
    const nextAbsolute = Math.max(
      0,
      Math.min(filtered.total - 1, currentAbsolute + direction),
    );
    const nextStart =
      nextAbsolute < filtered.start
        ? nextAbsolute
        : nextAbsolute >= filtered.start + filtered.visible.length
          ? Math.min(
              nextAbsolute - MAX_VISIBLE_MONTAGES + 1,
              Math.max(0, filtered.total - MAX_VISIBLE_MONTAGES),
            )
          : filtered.start;
    setVisibleStart(nextStart);
    setActiveIndex(nextAbsolute - nextStart);
    if (listboxRef.current) {
      listboxRef.current.scrollTop =
        Math.max(0, nextStart) * MONTAGE_OPTION_HEIGHT;
    }
  }

  const selectedAction = actionByName.get(value.toLocaleLowerCase());
  const queryIsInvalid =
    query.trim().length > 0 &&
    !actionByName.has(query.trim().toLocaleLowerCase());

  return (
    <div
      className="character-action-picker"
      ref={rootRef}
      onBlur={() => {
        window.requestAnimationFrame(() => {
          if (!rootRef.current?.contains(document.activeElement)) {
            closeAndRestore();
          }
        });
      }}
    >
      <div className="character-action-picker__field">
        <input
          ref={inputRef}
          className="character-action-picker__input"
          type="text"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-invalid={queryIsInvalid}
          aria-activedescendant={
            open && filtered.visible[activeIndex]
              ? `${listboxId}-${filtered.start + activeIndex}`
              : undefined
          }
          autoComplete="off"
          disabled={disabled}
          placeholder="输入动作关键词"
          title={selectedAction?.assetPath ?? ""}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            cancelPendingScrollFrame();
            const nextQuery = event.target.value;
            const exact = actionByName.get(
              nextQuery.trim().toLocaleLowerCase(),
            );
            setQuery(nextQuery);
            setOpen(true);
            setActiveIndex(0);
            setVisibleStart(0);
            if (exact) {
              committedValueRef.current = exact.name;
              if (exact.name !== value) {
                onUpdate(dialogueId, modelIndex, actionId, {
                  montageName: exact.name,
                });
              }
            } else if (value) {
              committedValueRef.current = "";
              onUpdate(dialogueId, modelIndex, actionId, {
                montageName: "",
              });
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              moveActiveSelection(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveActiveSelection(-1);
            } else if (event.key === "PageDown") {
              event.preventDefault();
              const nextStart = Math.min(
                Math.max(0, filtered.total - MAX_VISIBLE_MONTAGES),
                filtered.start + MAX_VISIBLE_MONTAGES,
              );
              setVisibleStart(nextStart);
              setActiveIndex(0);
              if (listboxRef.current) {
                listboxRef.current.scrollTop =
                  nextStart * MONTAGE_OPTION_HEIGHT;
              }
            } else if (event.key === "PageUp") {
              event.preventDefault();
              const nextStart = Math.max(
                0,
                filtered.start - MAX_VISIBLE_MONTAGES,
              );
              setVisibleStart(nextStart);
              setActiveIndex(0);
              if (listboxRef.current) {
                listboxRef.current.scrollTop =
                  nextStart * MONTAGE_OPTION_HEIGHT;
              }
            } else if (event.key === "Enter" && open) {
              const action = filtered.visible[activeIndex];
              if (action) {
                event.preventDefault();
                selectAction(action);
              }
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeAndRestore();
            }
          }}
        />
        <button
          className="character-action-picker__toggle"
          type="button"
          aria-label={`${open ? "收起" : "展开"}${label}列表`}
          aria-expanded={open}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (open ? closeAndRestore() : showAllActions())}
        >
          <ChevronDown size={13} />
        </button>
      </div>
      {open && (
        <div className="character-action-picker__menu">
          <div
            ref={listboxRef}
            className="character-action-picker__options"
            id={listboxId}
            role="listbox"
            aria-busy={loadingMore}
            style={{
              height: `${Math.max(
                1,
                Math.min(filtered.total, MAX_VISIBLE_MONTAGES),
              ) * MONTAGE_OPTION_HEIGHT}px`,
            }}
            onScroll={(event) =>
              updateVisibleWindow(event.currentTarget.scrollTop)
            }
          >
            {filtered.total > 0 ? (
              <div
                className="character-action-picker__spacer"
                style={{
                  height: `${filtered.total * MONTAGE_OPTION_HEIGHT}px`,
                }}
              >
                {filtered.visible.map((action, index) => (
                  <button
                    type="button"
                    role="option"
                    id={`${listboxId}-${filtered.start + index}`}
                    aria-selected={action.name === value}
                    className={index === activeIndex ? "is-active" : ""}
                    key={action.name}
                    title={action.assetPath}
                    style={{
                      top: `${
                        (filtered.start + index) * MONTAGE_OPTION_HEIGHT
                      }px`,
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectAction(action)}
                  >
                    {action.name}
                  </button>
                ))}
              </div>
            ) : (
              <span>没有匹配动作</span>
            )}
          </div>
          {loadingMore && (
            <span
              className="character-action-picker__loading"
              role="status"
            >
              <LoaderCircle className="spin" size={12} />
              正在加载更多动作
            </span>
          )}
          {filtered.total > MAX_VISIBLE_MONTAGES && (
            <small className="character-action-picker__count">
              {filtered.start + 1}-
              {filtered.start + filtered.visible.length} / {filtered.total}
            </small>
          )}
        </div>
      )}
    </div>
  );
});

function actionTypeLabel(action: DialogueCharacterActionItem): string {
  const type = action.behaviourType ?? "ENone";
  return {
    enone: "Montage",
    erotate: "旋转",
    ewalk: "走位",
    estatemachinewalk: "状态机走位",
  }[type.toLowerCase()] ?? type;
}

function groupTracksByDialogue<T extends { dialogueId: string }>(
  tracks: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const track of tracks) {
    const values = grouped.get(track.dialogueId) ?? [];
    values.push(track);
    grouped.set(track.dialogueId, values);
  }
  return grouped;
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
  const editableParticipants = useMemo(
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
  const editableParticipantByModelIndex = useMemo(
    () =>
      new Map(
        editableParticipants.map((participant) => [
          participant.modelIndex!,
          participant,
        ]),
      ),
    [editableParticipants],
  );
  const participantByModelIndex = useMemo(
    () =>
      dialogueParticipantsByModelIndex(
        sequence.participants,
        sequence.rows,
      ),
    [sequence.participants, sequence.rows],
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
  const actionByNameByModelIndex = useMemo(
    () =>
      new Map(
        controller.catalogs.map((catalog) => [
          catalog.modelIndex,
          new Map(
            catalog.actions.map((action) => [
              action.name.toLocaleLowerCase(),
              action,
            ]),
          ),
        ]),
      ),
    [controller.catalogs],
  );
  const rowsById = useMemo(
    () => new Map(sequence.rows.map((row) => [row.id, row])),
    [sequence.rows],
  );
  const dialogueScope = dialogueIds.join("|");
  const rows = useMemo(
    () =>
      dialogueIds.flatMap((dialogueId) => {
        const row = rowsById.get(dialogueId);
        return row ? [row] : [];
      }),
    [dialogueScope, rowsById],
  );
  const existingTracksByDialogue = useMemo(
    () =>
      groupTracksByDialogue<DialogueCharacterActionTrack>(
        controller.existingTracks,
      ),
    [controller.existingTracks],
  );
  const pendingTracksByDialogue = useMemo(
    () =>
      groupTracksByDialogue<CharacterActionTrackDraft>(
        controller.tracks,
      ),
    [controller.tracks],
  );
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
          const existingTracks =
            existingTracksByDialogue.get(row.id) ?? [];
          const pendingTracks =
            pendingTracksByDialogue.get(row.id) ?? [];
          const modelIndexes = Array.from(
            new Set([
              ...existingTracks.map((track) => track.modelIndex),
              ...pendingTracks.map((track) => track.modelIndex),
            ]),
          ).sort((left, right) => left - right);
          const usedModelIndexes = new Set(modelIndexes);
          const availableParticipants = editableParticipants.filter(
            (participant) =>
              !usedModelIndexes.has(participant.modelIndex!) &&
              (catalogByModelIndex.get(participant.modelIndex!)?.actions
                .length ?? 0) > 0,
          );
          const requestedModel = pendingModelByDialogue[row.id] ?? -1;
          const pendingModel = availableParticipants.some(
            (participant) => participant.modelIndex === requestedModel,
          )
            ? requestedModel
            : -1;
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
                    const catalog =
                      editableParticipantByModelIndex.get(modelIndex) ===
                      participant
                        ? catalogByModelIndex.get(modelIndex)
                        : undefined;
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
                                  <MontagePicker
                                    actions={
                                      catalog?.actions ??
                                      EMPTY_MONTAGE_ACTIONS
                                    }
                                    actionByName={
                                      actionByNameByModelIndex.get(modelIndex) ??
                                      EMPTY_MONTAGE_ACTION_INDEX
                                    }
                                    disabled={editingDisabled}
                                    dialogueId={row.id}
                                    label={`${participant?.name ?? "角色"} 新增动作 ${actionIndex + 1}`}
                                    modelIndex={modelIndex}
                                    actionId={action.id}
                                    onUpdate={controller.updateAction}
                                    value={action.montageName}
                                  />
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
                                    aria-label={`删除新增动作 ${action.montageName || "未选择"}`}
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
                            catalog.actions.length === 0 ||
                            pendingTrack?.actions.some(
                              (action) => !action.montageName,
                            )
                          }
                          title={
                            pendingTrack?.actions.some(
                              (action) => !action.montageName,
                            )
                              ? "请先选择当前空白动作"
                              : catalog?.status === "loaded"
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
                      <option value={-1}>
                        {availableParticipants.length === 0
                          ? "没有可添加的角色"
                          : "选择角色"}
                      </option>
                      {availableParticipants.map((participant) => (
                          <option
                            key={participant.instanceId}
                            value={participant.modelIndex!}
                          >
                            {participant.modelIndex} {participant.name}
                          </option>
                      ))}
                    </select>
                    <button
                      className="button"
                      type="button"
                      disabled={
                        editingDisabled ||
                        pendingModel < 0
                      }
                      title={
                        availableParticipants.length === 0
                          ? "当前节点没有其他可添加角色"
                          : pendingModel < 0
                            ? "请先选择角色"
                            : "添加角色动作"
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
