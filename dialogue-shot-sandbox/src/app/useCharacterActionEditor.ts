import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  dialogueCharacterActionTracks,
  mergeDialogueCharacterActionTracks,
  turnDegreesFromMontageName,
} from "../data/characterActions";
import type {
  BlueprintMontageCatalog,
  DialogueCharacterActionItem,
  DialogueCharacterActionTrack,
  DialogueSequence,
  DialogueViewLine,
  DialogueViewLineNode,
  StoryboardExportRequest,
} from "../types";
import { readDialogueCharacterActions } from "../ue/client";

export interface CharacterActionDraft extends DialogueCharacterActionItem {
  id: string;
}

export interface CharacterActionTrackDraft {
  dialogueId: string;
  modelIndex: number;
  actions: CharacterActionDraft[];
}

export interface CharacterActionEditorController {
  loading: boolean;
  error: string;
  status: string;
  dialogueAssetPath: string;
  catalogs: BlueprintMontageCatalog[];
  existingTracks: DialogueCharacterActionTrack[];
  existingViewLineNodes: DialogueViewLineNode[];
  tracks: CharacterActionTrackDraft[];
  viewLines: DialogueViewLine[];
  exportActions: NonNullable<StoryboardExportRequest["characterActions"]>;
  exportViewLines: NonNullable<StoryboardExportRequest["viewLines"]>;
  hasChanges: boolean;
  refresh: () => Promise<void>;
  addParticipant: (dialogueId: string, modelIndex: number) => void;
  removeParticipant: (dialogueId: string, modelIndex: number) => void;
  addAction: (dialogueId: string, modelIndex: number) => void;
  removeAction: (
    dialogueId: string,
    modelIndex: number,
    actionId: string,
  ) => void;
  updateAction: (
    dialogueId: string,
    modelIndex: number,
    actionId: string,
    update: Partial<DialogueCharacterActionItem>,
  ) => void;
  reorderAction: (
    dialogueId: string,
    modelIndex: number,
    sourceIndex: number,
    targetIndex: number,
  ) => void;
  setViewLine: (
    dialogueId: string,
    observerModelIndex: number,
    targetModelIndex: number,
  ) => void;
  removeViewLineChange: (
    dialogueId: string,
    observerModelIndex: number,
  ) => void;
  commitExported: (
    items: NonNullable<StoryboardExportRequest["characterActions"]>,
  ) => void;
  commitExportedViewLines: (
    items: NonNullable<StoryboardExportRequest["viewLines"]>,
  ) => void;
}

function trackKey(dialogueId: string, modelIndex: number): string {
  return `${dialogueId}:${modelIndex}`;
}

function catalogStatus(catalogs: BlueprintMontageCatalog[]): string {
  const loadedCatalogs = catalogs.filter(
    (catalog) => catalog.status === "loaded",
  );
  const unavailableCatalogs = catalogs.length - loadedCatalogs.length;
  return `已读取 ${loadedCatalogs.length} 个 BP、${loadedCatalogs.reduce(
    (total, catalog) => total + catalog.actions.length,
    0,
  )} 个动作${
    unavailableCatalogs > 0
      ? `；${unavailableCatalogs} 个 BP 不可用`
      : ""
  }`;
}

export function useCharacterActionEditor({
  sequence,
  dialogueIds,
  enabled,
  releaseWhenDisabled = false,
}: {
  sequence: DialogueSequence;
  dialogueIds: string[];
  enabled: boolean;
  releaseWhenDisabled?: boolean;
}): CharacterActionEditorController {
  const actionIdRef = useRef(0);
  const requestRunRef = useRef(0);
  const loadedSignatureRef = useRef("");
  const catalogCacheRef = useRef<{
    signature: string;
    dialogueAssetPath: string;
    catalogs: BlueprintMontageCatalog[];
  } | null>(null);
  const trackCacheRef = useRef(
    new Map<
      string,
      {
        dialogueAssetPath: string;
        tracks: DialogueCharacterActionTrack[];
        viewLineNodes: DialogueViewLineNode[];
      }
    >(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [dialogueAssetPath, setDialogueAssetPath] = useState("");
  const [catalogs, setCatalogs] = useState<BlueprintMontageCatalog[]>([]);
  const [ueTracks, setUeTracks] = useState<
    DialogueCharacterActionTrack[]
  >([]);
  const [existingViewLineNodes, setExistingViewLineNodes] = useState<
    DialogueViewLineNode[]
  >([]);
  const [tracksBySignature, setTracksBySignature] = useState<
    Map<string, CharacterActionTrackDraft[]>
  >(() => new Map());
  const [viewLinesBySignature, setViewLinesBySignature] = useState<
    Map<string, DialogueViewLine[]>
  >(() => new Map());

  const models = useMemo(
    () =>
      sequence.participants.flatMap((participant) =>
        participant.modelIndex !== null && participant.modelClassPath
          ? [{
              modelIndex: participant.modelIndex,
              blueprintClassPath: participant.modelClassPath,
            }]
          : [],
      ),
    [sequence.participants],
  );
  const localTracks = useMemo(
    () => dialogueCharacterActionTracks(sequence.rows),
    [sequence.rows],
  );
  const existingTracks = useMemo(
    () => mergeDialogueCharacterActionTracks(localTracks, ueTracks),
    [localTracks, ueTracks],
  );
  const draftSignature = useMemo(
    () =>
      JSON.stringify({
        startId: sequence.startId,
        dialogueIds: sequence.rows.map((row) => row.id),
        models,
      }),
    [models, sequence.rows, sequence.startId],
  );
  const catalogSignature = useMemo(
    () =>
      JSON.stringify({
        startId: sequence.startId,
        models,
      }),
    [models, sequence.startId],
  );
  const readSignature = useMemo(
    () =>
      JSON.stringify({
        catalogSignature,
        dialogueIds,
      }),
    [catalogSignature, dialogueIds],
  );
  const tracks = useMemo(
    () => tracksBySignature.get(draftSignature) ?? [],
    [draftSignature, tracksBySignature],
  );
  const viewLines = useMemo(
    () => viewLinesBySignature.get(draftSignature) ?? [],
    [draftSignature, viewLinesBySignature],
  );
  const setTracks = useCallback(
    (update: SetStateAction<CharacterActionTrackDraft[]>) => {
      setTracksBySignature((current) => {
        const currentTracks = current.get(draftSignature) ?? [];
        const nextTracks =
          typeof update === "function" ? update(currentTracks) : update;
        if (nextTracks === currentTracks) {
          return current;
        }
        const next = new Map(current);
        if (nextTracks.length > 0) {
          next.set(draftSignature, nextTracks);
        } else {
          next.delete(draftSignature);
        }
        return next;
      });
    },
    [draftSignature],
  );
  const setViewLines = useCallback(
    (update: SetStateAction<DialogueViewLine[]>) => {
      setViewLinesBySignature((current) => {
        const currentLines = current.get(draftSignature) ?? [];
        const nextLines =
          typeof update === "function" ? update(currentLines) : update;
        if (nextLines === currentLines) {
          return current;
        }
        const next = new Map(current);
        if (nextLines.length > 0) {
          next.set(draftSignature, nextLines);
        } else {
          next.delete(draftSignature);
        }
        return next;
      });
    },
    [draftSignature],
  );

  const nextActionId = useCallback(
    (dialogueId: string, modelIndex: number) =>
      `${dialogueId}:${modelIndex}:${++actionIdRef.current}`,
    [],
  );

  const load = useCallback(async (
    discardDrafts: boolean,
    refreshCatalogs = false,
  ) => {
    const requestRun = ++requestRunRef.current;
    loadedSignatureRef.current = readSignature;
    setLoading(true);
    setError("");
    const cachedCatalog =
      catalogCacheRef.current?.signature === catalogSignature
        ? catalogCacheRef.current
        : null;
    const includeCatalogs = refreshCatalogs || !cachedCatalog;
    setStatus(
      includeCatalogs
        ? "正在读取 UE 角色动作..."
        : "正在读取当前节点动作...",
    );
    try {
      const snapshot = await readDialogueCharacterActions({
        startId: sequence.startId,
        dialogueIds,
        models: includeCatalogs
          ? models
          : cachedCatalog.catalogs.map((catalog) => ({
              modelIndex: catalog.modelIndex,
              blueprintClassPath: catalog.blueprintClassPath,
            })),
        includeCatalogs,
      });
      if (requestRun !== requestRunRef.current) {
        return;
      }
      const nextCatalogs = includeCatalogs
        ? snapshot.catalogs
        : cachedCatalog.catalogs;
      const nextViewLineNodes = snapshot.viewLineNodes ?? [];
      if (includeCatalogs) {
        catalogCacheRef.current = {
          signature: catalogSignature,
          dialogueAssetPath: snapshot.dialogueAssetPath,
          catalogs: snapshot.catalogs,
        };
      }
      trackCacheRef.current.set(readSignature, {
        dialogueAssetPath: snapshot.dialogueAssetPath,
        tracks: snapshot.tracks,
        viewLineNodes: nextViewLineNodes,
      });
      setDialogueAssetPath(snapshot.dialogueAssetPath);
      setCatalogs(nextCatalogs);
      setUeTracks(snapshot.tracks);
      setExistingViewLineNodes(nextViewLineNodes);
      if (discardDrafts) {
        setTracks([]);
        setViewLines([]);
      }
      setStatus(catalogStatus(nextCatalogs));
    } catch (loadError) {
      if (requestRun !== requestRunRef.current) {
        return;
      }
      setError(
        loadError instanceof Error ? loadError.message : "无法读取 UE 角色动作",
      );
      setStatus("");
      loadedSignatureRef.current = "";
    } finally {
      if (requestRun === requestRunRef.current) {
        setLoading(false);
      }
    }
  }, [
    dialogueIds,
    models,
    sequence.startId,
    setTracks,
    setViewLines,
    catalogSignature,
    readSignature,
  ]);

  useEffect(() => {
    requestRunRef.current += 1;
    loadedSignatureRef.current = "";
    catalogCacheRef.current = null;
    trackCacheRef.current.clear();
    setLoading(false);
    setError("");
    setStatus("");
    setDialogueAssetPath("");
    setCatalogs([]);
    setUeTracks([]);
    setExistingViewLineNodes([]);
  }, [catalogSignature]);

  useEffect(() => {
    requestRunRef.current += 1;
    loadedSignatureRef.current = "";
    setLoading(false);
    setError("");
    const cachedCatalog =
      catalogCacheRef.current?.signature === catalogSignature
        ? catalogCacheRef.current
        : null;
    const cachedTracks = trackCacheRef.current.get(readSignature);
    if (cachedCatalog) {
      setDialogueAssetPath(cachedCatalog.dialogueAssetPath);
      setCatalogs(cachedCatalog.catalogs);
      setStatus(catalogStatus(cachedCatalog.catalogs));
    }
    if (cachedTracks) {
      loadedSignatureRef.current = readSignature;
      setDialogueAssetPath(cachedTracks.dialogueAssetPath);
      setUeTracks(cachedTracks.tracks);
      setExistingViewLineNodes(cachedTracks.viewLineNodes);
    } else {
      setUeTracks([]);
      setExistingViewLineNodes([]);
    }
  }, [catalogSignature, readSignature]);

  useEffect(() => {
    if (!enabled || loadedSignatureRef.current === readSignature) {
      return;
    }
    void load(false);
  }, [enabled, load, readSignature]);

  useEffect(() => {
    if (enabled || !releaseWhenDisabled) {
      return;
    }
    requestRunRef.current += 1;
    loadedSignatureRef.current = "";
    catalogCacheRef.current = null;
    trackCacheRef.current.clear();
    setLoading(false);
    setError("");
    setStatus("");
    setDialogueAssetPath("");
    setCatalogs([]);
    setUeTracks([]);
    setExistingViewLineNodes([]);
  }, [enabled, releaseWhenDisabled]);

  const refresh = useCallback(() => {
    catalogCacheRef.current = null;
    trackCacheRef.current.clear();
    loadedSignatureRef.current = "";
    return load(true, true);
  }, [load]);

  const catalogByModelIndex = useMemo(
    () => new Map(catalogs.map((catalog) => [catalog.modelIndex, catalog])),
    [catalogs],
  );

  const updateTrack = useCallback(
    (
      dialogueId: string,
      modelIndex: number,
      update: (track: CharacterActionTrackDraft) => CharacterActionTrackDraft,
    ) => {
      setTracks((current) =>
        current.map((track) =>
          track.dialogueId === dialogueId &&
          track.modelIndex === modelIndex
            ? update(track)
            : track,
        ),
      );
    },
    [setTracks],
  );

  const addParticipant = useCallback(
    (dialogueId: string, modelIndex: number) => {
      if (!catalogByModelIndex.get(modelIndex)?.actions.length) {
        return;
      }
      setTracks((current) =>
        current.some(
          (track) =>
            track.dialogueId === dialogueId &&
            track.modelIndex === modelIndex,
        )
          ? current
          : [
              ...current,
              {
                dialogueId,
                modelIndex,
                actions: [{
                  id: nextActionId(dialogueId, modelIndex),
                  montageName: "",
                  delaySeconds: 0.4,
                }],
              },
            ],
      );
    },
    [catalogByModelIndex, nextActionId, setTracks],
  );

  const removeParticipant = useCallback(
    (dialogueId: string, modelIndex: number) => {
      setTracks((current) =>
        current.filter(
          (track) =>
            track.dialogueId !== dialogueId ||
            track.modelIndex !== modelIndex,
        ),
      );
    },
    [setTracks],
  );

  const addAction = useCallback(
    (dialogueId: string, modelIndex: number) => {
      if (!catalogByModelIndex.get(modelIndex)?.actions.length) {
        return;
      }
      updateTrack(dialogueId, modelIndex, (track) => ({
        ...track,
        actions: [
          ...track.actions,
          {
            id: nextActionId(dialogueId, modelIndex),
            montageName: "",
            delaySeconds: 0.4,
          },
        ],
      }));
    },
    [catalogByModelIndex, nextActionId, updateTrack],
  );

  const removeAction = useCallback(
    (dialogueId: string, modelIndex: number, actionId: string) => {
      setTracks((current) =>
        current.flatMap((track) => {
          if (
            track.dialogueId !== dialogueId ||
            track.modelIndex !== modelIndex
          ) {
            return [track];
          }
          const actions = track.actions.filter(
            (action) => action.id !== actionId,
          );
          return actions.length > 0 ? [{ ...track, actions }] : [];
        }),
      );
    },
    [setTracks],
  );

  const updateAction = useCallback(
    (
      dialogueId: string,
      modelIndex: number,
      actionId: string,
      update: Partial<DialogueCharacterActionItem>,
    ) => {
      updateTrack(dialogueId, modelIndex, (track) => ({
        ...track,
        actions: track.actions.map((action) =>
          action.id === actionId ? { ...action, ...update } : action,
        ),
      }));
    },
    [updateTrack],
  );

  const reorderAction = useCallback(
    (
      dialogueId: string,
      modelIndex: number,
      sourceIndex: number,
      targetIndex: number,
    ) => {
      if (sourceIndex === targetIndex) {
        return;
      }
      updateTrack(dialogueId, modelIndex, (track) => {
        if (
          sourceIndex < 0 ||
          targetIndex < 0 ||
          sourceIndex >= track.actions.length ||
          targetIndex >= track.actions.length
        ) {
          return track;
        }
        const actions = [...track.actions];
        const [moved] = actions.splice(sourceIndex, 1);
        actions.splice(targetIndex, 0, moved);
        return { ...track, actions };
      });
    },
    [updateTrack],
  );

  const exportActions = useMemo(
    () =>
      tracks.flatMap((track) => {
        const actions = track.actions
          .filter((action) => action.montageName.trim())
          .map((action) => ({
            montageName: action.montageName,
            delaySeconds: action.delaySeconds,
          }));
        return actions.length > 0
          ? [{
              dialogueId: track.dialogueId,
              modelIndex: track.modelIndex,
              actions,
            }]
          : [];
      }),
    [tracks],
  );
  const exportViewLines = viewLines;

  const setViewLine = useCallback(
    (
      dialogueId: string,
      observerModelIndex: number,
      targetModelIndex: number,
    ) => {
      const existingTarget = existingViewLineNodes
        .find((node) => node.dialogueId === dialogueId)
        ?.lines.find(
          (line) => line.observerModelIndex === observerModelIndex,
        )?.targetModelIndex;
      setViewLines((current) => {
        const withoutObserver = current.filter(
          (line) =>
            line.dialogueId !== dialogueId ||
            line.observerModelIndex !== observerModelIndex,
        );
        return existingTarget === targetModelIndex
          ? withoutObserver
          : [
              ...withoutObserver,
              {
                dialogueId,
                observerModelIndex,
                targetModelIndex,
              },
            ];
      });
    },
    [existingViewLineNodes, setViewLines],
  );

  const removeViewLineChange = useCallback(
    (dialogueId: string, observerModelIndex: number) => {
      setViewLines((current) =>
        current.filter(
          (line) =>
            line.dialogueId !== dialogueId ||
            line.observerModelIndex !== observerModelIndex,
        ),
      );
    },
    [setViewLines],
  );

  const commitExported = useCallback(
    (items: NonNullable<StoryboardExportRequest["characterActions"]>) => {
      const exportedKeys = new Set(
        items.map((item) => trackKey(item.dialogueId, item.modelIndex)),
      );
      setTracks((current) =>
        current.filter(
          (track) =>
            !exportedKeys.has(trackKey(track.dialogueId, track.modelIndex)),
        ),
      );
      setUeTracks((current) => {
        const next = current.map((track) => ({
          ...track,
          actions: [...track.actions],
        }));
        for (const item of items) {
          const key = trackKey(item.dialogueId, item.modelIndex);
          const existing = next.find(
            (track) =>
              trackKey(track.dialogueId, track.modelIndex) === key,
          );
          const appended = item.actions.map((action) => ({
            ...action,
            behaviourType:
              turnDegreesFromMontageName(action.montageName) === null
                ? "ENone"
                : "ERotate",
          }));
          if (existing) {
            existing.actions = [...existing.actions, ...appended];
          } else {
            next.push({
              dialogueId: item.dialogueId,
              modelIndex: item.modelIndex,
              actions: appended,
              preservedComplexActionCount: 0,
            });
          }
        }
        trackCacheRef.current.set(readSignature, {
          dialogueAssetPath,
          tracks: next,
          viewLineNodes:
            trackCacheRef.current.get(readSignature)?.viewLineNodes ??
            existingViewLineNodes,
        });
        return next;
      });
    },
    [
      dialogueAssetPath,
      existingViewLineNodes,
      readSignature,
      setTracks,
    ],
  );

  const commitExportedViewLines = useCallback(
    (items: NonNullable<StoryboardExportRequest["viewLines"]>) => {
      const exportedKeys = new Set(
        items.map(
          (item) => `${item.dialogueId}:${item.observerModelIndex}`,
        ),
      );
      setViewLines((current) =>
        current.filter(
          (line) =>
            !exportedKeys.has(
              `${line.dialogueId}:${line.observerModelIndex}`,
            ),
        ),
      );
      setExistingViewLineNodes((current) => {
        const next = current.map((node) => ({
          ...node,
          lines: [...node.lines],
        }));
        for (const item of items) {
          let node = next.find(
            (candidate) => candidate.dialogueId === item.dialogueId,
          );
          if (!node) {
            node = {
              dialogueId: item.dialogueId,
              lines: [],
              preservedComplexLineCount: 0,
              lockedObserverModelIndexes: [],
            };
            next.push(node);
          }
          node.lines = [
            ...node.lines.filter(
              (line) =>
                line.observerModelIndex !== item.observerModelIndex,
            ),
            { ...item },
          ].sort(
            (left, right) =>
              left.observerModelIndex - right.observerModelIndex,
          );
        }
        trackCacheRef.current.set(readSignature, {
          dialogueAssetPath,
          tracks:
            trackCacheRef.current.get(readSignature)?.tracks ?? ueTracks,
          viewLineNodes: next,
        });
        return next;
      });
    },
    [dialogueAssetPath, readSignature, setViewLines, ueTracks],
  );

  return {
    loading,
    error,
    status,
    dialogueAssetPath,
    catalogs,
    existingTracks,
    existingViewLineNodes,
    tracks,
    viewLines,
    exportActions,
    exportViewLines,
    hasChanges: exportActions.length > 0 || exportViewLines.length > 0,
    refresh,
    addParticipant,
    removeParticipant,
    addAction,
    removeAction,
    updateAction,
    reorderAction,
    setViewLine,
    removeViewLineChange,
    commitExported,
    commitExportedViewLines,
  };
}
