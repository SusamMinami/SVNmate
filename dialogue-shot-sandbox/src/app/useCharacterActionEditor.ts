import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { turnDegreesFromMontageName } from "../data/characterActions";
import type {
  BlueprintMontageCatalog,
  DialogueCharacterActionItem,
  DialogueCharacterActionTrack,
  DialogueSequence,
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
  tracks: CharacterActionTrackDraft[];
  exportActions: NonNullable<StoryboardExportRequest["characterActions"]>;
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
  turnDegreesByModelIndex: (dialogueIds: string[]) => Map<number, number>;
  commitExported: (
    items: NonNullable<StoryboardExportRequest["characterActions"]>,
  ) => void;
}

function trackKey(dialogueId: string, modelIndex: number): string {
  return `${dialogueId}:${modelIndex}`;
}

export function useCharacterActionEditor({
  sequence,
  enabled,
}: {
  sequence: DialogueSequence;
  enabled: boolean;
}): CharacterActionEditorController {
  const actionIdRef = useRef(0);
  const requestRunRef = useRef(0);
  const loadedSignatureRef = useRef("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [dialogueAssetPath, setDialogueAssetPath] = useState("");
  const [catalogs, setCatalogs] = useState<BlueprintMontageCatalog[]>([]);
  const [existingTracks, setExistingTracks] = useState<
    DialogueCharacterActionTrack[]
  >([]);
  const [tracksBySignature, setTracksBySignature] = useState<
    Map<string, CharacterActionTrackDraft[]>
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
  const signature = useMemo(
    () =>
      JSON.stringify({
        startId: sequence.startId,
        dialogueIds: sequence.rows.map((row) => row.id),
        models,
      }),
    [models, sequence.rows, sequence.startId],
  );
  const tracks = useMemo(
    () => tracksBySignature.get(signature) ?? [],
    [signature, tracksBySignature],
  );
  const setTracks = useCallback(
    (update: SetStateAction<CharacterActionTrackDraft[]>) => {
      setTracksBySignature((current) => {
        const currentTracks = current.get(signature) ?? [];
        const nextTracks =
          typeof update === "function" ? update(currentTracks) : update;
        if (nextTracks === currentTracks) {
          return current;
        }
        const next = new Map(current);
        if (nextTracks.length > 0) {
          next.set(signature, nextTracks);
        } else {
          next.delete(signature);
        }
        return next;
      });
    },
    [signature],
  );

  const nextActionId = useCallback(
    (dialogueId: string, modelIndex: number) =>
      `${dialogueId}:${modelIndex}:${++actionIdRef.current}`,
    [],
  );

  const load = useCallback(async (discardDrafts: boolean) => {
    const requestRun = ++requestRunRef.current;
    loadedSignatureRef.current = signature;
    if (models.length === 0) {
      setCatalogs([]);
      setExistingTracks([]);
      setDialogueAssetPath("");
      setError("");
      setStatus("当前方案没有可读取动作的 BP 模型槽");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("正在读取 UE 角色动作...");
    try {
      const snapshot = await readDialogueCharacterActions({
        startId: sequence.startId,
        dialogueIds: sequence.rows.map((row) => row.id),
        models,
      });
      if (requestRun !== requestRunRef.current) {
        return;
      }
      setDialogueAssetPath(snapshot.dialogueAssetPath);
      setCatalogs(snapshot.catalogs);
      setExistingTracks(snapshot.tracks);
      if (discardDrafts) {
        setTracks([]);
      }
      const loadedCatalogs = snapshot.catalogs.filter(
        (catalog) => catalog.status === "loaded",
      );
      const unavailableCatalogs =
        snapshot.catalogs.length - loadedCatalogs.length;
      setStatus(
        `已读取 ${loadedCatalogs.length} 个 BP、${loadedCatalogs.reduce(
          (total, catalog) => total + catalog.actions.length,
          0,
        )} 个动作${
          unavailableCatalogs > 0
            ? `；${unavailableCatalogs} 个 BP 不可用`
            : ""
        }`,
      );
    } catch (loadError) {
      if (requestRun !== requestRunRef.current) {
        return;
      }
      setError(
        loadError instanceof Error ? loadError.message : "无法读取 UE 角色动作",
      );
      setStatus("");
    } finally {
      if (requestRun === requestRunRef.current) {
        setLoading(false);
      }
    }
  }, [models, sequence.rows, sequence.startId, setTracks, signature]);

  useEffect(() => {
    requestRunRef.current += 1;
    loadedSignatureRef.current = "";
    setLoading(false);
    setError("");
    setStatus("");
    setDialogueAssetPath("");
    setCatalogs([]);
    setExistingTracks([]);
  }, [signature]);

  useEffect(() => {
    if (!enabled || loadedSignatureRef.current === signature) {
      return;
    }
    void load(false);
  }, [enabled, load, signature]);

  const refresh = useCallback(() => load(true), [load]);

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
                  delaySeconds: 0,
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
            delaySeconds: 0,
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

  const turnDegreesByModelIndex = useCallback(
    (dialogueIds: string[]) => {
      const selectedDialogueIds = new Set(dialogueIds);
      const result = new Map<number, number>();
      const addTurn = (
        modelIndex: number,
        action: DialogueCharacterActionItem,
        existing: boolean,
      ) => {
        const turnDegrees = turnDegreesFromMontageName(
          action.montageName,
        );
        const isRotate = existing
          ? action.behaviourType?.toLowerCase() === "erotate"
          : turnDegrees !== null;
        if (!isRotate || turnDegrees === null) {
          return;
        }
        result.set(
          modelIndex,
          (result.get(modelIndex) ?? 0) + turnDegrees,
        );
      };
      for (const track of existingTracks) {
        if (!selectedDialogueIds.has(track.dialogueId)) {
          continue;
        }
        for (const action of track.actions) {
          addTurn(track.modelIndex, action, true);
        }
      }
      for (const track of tracks) {
        if (!selectedDialogueIds.has(track.dialogueId)) {
          continue;
        }
        for (const action of track.actions) {
          addTurn(track.modelIndex, action, false);
        }
      }
      return result;
    },
    [existingTracks, tracks],
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
      setExistingTracks((current) => {
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
        return next;
      });
    },
    [setTracks],
  );

  return {
    loading,
    error,
    status,
    dialogueAssetPath,
    catalogs,
    existingTracks,
    tracks,
    exportActions,
    hasChanges: exportActions.length > 0,
    refresh,
    addParticipant,
    removeParticipant,
    addAction,
    removeAction,
    updateAction,
    reorderAction,
    turnDegreesByModelIndex,
    commitExported,
  };
}
