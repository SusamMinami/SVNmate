import { useCallback, useMemo, useState } from "react";
import type { DirectorSoundEffectRecommendation } from "../director/contracts";
import type { MusicRecommendation } from "../data/musicCatalog";
import type {
  DialogueParticipant,
  DialogueSequence,
  DialogueStoryboardExportPreview,
  ShotPlan,
  StoryboardExportRequest,
} from "../types";
import {
  exportDialogueStoryboard,
  inspectDialogueStoryboardExport,
} from "../ue/client";

type StoryboardExportMode = "current" | "all" | "sound";

interface UseStoryboardExportOptions {
  sequence: DialogueSequence;
  shots: ShotPlan[];
  soundEffects: DirectorSoundEffectRecommendation[];
  musicRecommendations: MusicRecommendation[];
  activeShot?: ShotPlan;
}

export interface StoryboardExportAvailability {
  canExport: boolean;
  buttonLabel: string;
  unavailableReason: string;
}

export function getStoryboardExportAvailability(
  shotCount: number,
  participants: readonly Pick<
    DialogueParticipant,
    "name" | "positionSource" | "modelIndex"
  >[],
): StoryboardExportAvailability {
  if (shotCount === 0) {
    return {
      canExport: false,
      buttonLabel: "请先生成分镜",
      unavailableReason: "当前没有可导出的镜头",
    };
  }
  if (participants.length < 2) {
    return {
      canExport: false,
      buttonLabel: "至少需要 2 位角色",
      unavailableReason: `当前只有 ${participants.length} 位角色，UE 镜头导出至少需要 2 位角色`,
    };
  }
  const unboundParticipants = participants.filter(
    (participant) => participant.positionSource !== "blueprint",
  );
  if (unboundParticipants.length > 0) {
    return {
      canExport: false,
      buttonLabel: "需绑定 BP 站位",
      unavailableReason: `${unboundParticipants.map((participant) => participant.name).join("、")} 未绑定 UE Blueprint 站位`,
    };
  }
  const missingModelIndexes = participants.filter(
    (participant) => participant.modelIndex === null,
  );
  if (missingModelIndexes.length > 0) {
    return {
      canExport: false,
      buttonLabel: "BP 角色槽不完整",
      unavailableReason: `${missingModelIndexes.map((participant) => participant.name).join("、")} 缺少 UE Blueprint 模型槽编号`,
    };
  }
  return {
    canExport: true,
    buttonLabel: "导出到 UE",
    unavailableReason: "",
  };
}

export function useStoryboardExport({
  sequence,
  shots,
  soundEffects,
  musicRecommendations,
  activeShot,
}: UseStoryboardExportOptions) {
  const [preview, setPreview] =
    useState<DialogueStoryboardExportPreview | null>(null);
  const [request, setRequest] = useState<StoryboardExportRequest | null>(null);
  const [mode, setMode] = useState<StoryboardExportMode>("current");
  const [currentShotNumber, setCurrentShotNumber] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const availability = useMemo(
    () =>
      getStoryboardExportAvailability(shots.length, sequence.participants),
    [sequence.participants, shots.length],
  );
  const { canExport } = availability;

  const buildRequest = useCallback(
    (
      selectedShots: ShotPlan[] = shots,
      selectedSoundEffects: DirectorSoundEffectRecommendation[] = soundEffects,
      selectedMusic: MusicRecommendation[] = musicRecommendations,
    ): StoryboardExportRequest => {
      if (selectedShots.length > 0 && !canExport) {
        throw new Error("当前方案未绑定完整的 UE Blueprint 站位");
      }
      return {
        dialogueId: sequence.prefix,
        startId: sequence.startId,
        dialogueIds: selectedShots.flatMap((shot) => shot.dialogueIds),
        participantModelIndexes:
          selectedShots.length > 0
            ? sequence.participants.map((participant) => participant.modelIndex!)
            : [],
        usesBlueprintFormation: selectedShots.length > 0,
        soundEffects: selectedSoundEffects.map((recommendation) => ({
          dialogueId: recommendation.dialogueId,
          assetName: recommendation.assetName,
        })),
        music: selectedMusic.map((recommendation) => ({
          dialogueId: recommendation.dialogueId,
          stateId: recommendation.stateId,
          stateName: recommendation.stateName,
          musicName: recommendation.musicName,
        })),
        shots: selectedShots.map((shot) => ({
          dialogueId: shot.dialogueId,
          dialogueIds: [...shot.dialogueIds],
          cameraPosition: shot.cameraPosition,
          cameraTarget: shot.cameraTarget,
          cameraEndPosition: shot.cameraEndPosition,
          cameraEndTarget: shot.cameraEndTarget,
          focalLength: shot.focalLength,
          endFocalLength: shot.endFocalLength,
          cameraMovement: shot.cameraMovement,
          movementIntensity: shot.movementIntensity,
          cameraRollDegrees: shot.cameraRollDegrees,
          projectionValid: shot.projection.valid,
          actorActions: shot.actorActions.flatMap((action) => {
            const participant = sequence.participants.find(
              (candidate) => candidate.slot === action.participantSlot,
            );
            return participant?.modelIndex === null ||
              participant?.modelIndex === undefined
              ? []
              : [
                  {
                    modelIndex: participant.modelIndex,
                    montageName: action.montageName,
                    angleDegrees: action.angleDegrees,
                  },
                ];
          }),
        })),
      };
    },
    [canExport, sequence, shots, soundEffects, musicRecommendations],
  );

  const previewCurrent = useCallback(async () => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      if (!activeShot) {
        throw new Error("当前没有可导出的镜头");
      }
      const activeDialogueIds = new Set(activeShot.dialogueIds);
      const nextRequest = buildRequest(
        [activeShot],
        soundEffects.filter((recommendation) =>
          activeDialogueIds.has(recommendation.dialogueId),
        ),
        musicRecommendations.filter((recommendation) =>
          activeDialogueIds.has(recommendation.dialogueId),
        ),
      );
      const nextPreview = await inspectDialogueStoryboardExport(nextRequest);
      const activeIndex = shots.indexOf(activeShot);
      setMode("current");
      setCurrentShotNumber((activeIndex >= 0 ? activeIndex : 0) + 1);
      setRequest(nextRequest);
      setPreview(nextPreview);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "无法检查 UE 分镜写入",
      );
    } finally {
      setBusy(false);
    }
  }, [activeShot, buildRequest, shots, soundEffects, musicRecommendations]);

  const previewCurrentSoundEffects = useCallback(async () => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      if (!activeShot) {
        throw new Error("当前没有可导出的分镜");
      }
      const activeDialogueIds = new Set(activeShot.dialogueIds);
      const currentSoundEffects = soundEffects.filter((recommendation) =>
        activeDialogueIds.has(recommendation.dialogueId),
      );
      if (currentSoundEffects.length === 0) {
        throw new Error("当前分镜没有可写入的音效建议");
      }
      const nextRequest = buildRequest([], currentSoundEffects, []);
      const nextPreview = await inspectDialogueStoryboardExport(nextRequest);
      const activeIndex = shots.indexOf(activeShot);
      setMode("sound");
      setCurrentShotNumber((activeIndex >= 0 ? activeIndex : 0) + 1);
      setRequest(nextRequest);
      setPreview(nextPreview);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "无法检查当前分镜音效写入",
      );
    } finally {
      setBusy(false);
    }
  }, [activeShot, buildRequest, shots, soundEffects]);

  const previewAll = useCallback(async () => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const nextRequest = buildRequest();
      const nextPreview = await inspectDialogueStoryboardExport(nextRequest);
      setMode("all");
      setRequest(nextRequest);
      setPreview(nextPreview);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "无法检查全部 UE 分镜写入",
      );
    } finally {
      setBusy(false);
    }
  }, [buildRequest]);

  const confirm = useCallback(
    async (
      selectedShotIndexes: number[],
      selectedSoundEffectIndexes: number[],
      selectedMusicIndexes: number[],
    ) => {
      if (!preview || !request) {
        return;
      }
      setBusy(true);
      setError("");
      try {
        const selectedIndexes = new Set(selectedShotIndexes);
        const selectedShots = request.shots.filter((_, index) =>
          selectedIndexes.has(index),
        );
        const selectedSoundIndexes = new Set(selectedSoundEffectIndexes);
        const availableSoundEffects = request.soundEffects ?? [];
        const selectedSoundEffects = availableSoundEffects.filter((_, index) =>
          selectedSoundIndexes.has(index),
        );
        const availableMusic = request.music ?? [];
        const selectedMusicSet = new Set(selectedMusicIndexes);
        const selectedMusic = availableMusic.filter((_, index) =>
          selectedMusicSet.has(index),
        );
        if (selectedShots.length === 0 && selectedSoundEffects.length === 0 && selectedMusic.length === 0) {
          throw new Error("请至少选择一个要导出的镜头、音效或音乐");
        }
        const selectedRequest: StoryboardExportRequest = {
          ...request,
          dialogueIds: selectedShots.flatMap((shot) => shot.dialogueIds),
          shots: selectedShots,
          soundEffects: selectedSoundEffects,
          music: selectedMusic,
        };
        const exportsEntirePreview =
          selectedShots.length === request.shots.length &&
          selectedSoundEffects.length === availableSoundEffects.length;
        const exportsAllMusic =
          selectedMusic.length === availableMusic.length;
        const selectedPreview = exportsEntirePreview
          && exportsAllMusic
          ? preview
          : await inspectDialogueStoryboardExport(selectedRequest);
        const exportResult = await exportDialogueStoryboard(
          selectedRequest,
          selectedPreview.reviewToken,
        );
        setResult(
          exportResult.status === "unchanged"
            ? "所选镜头、音效与音乐已与 UE 对话资产一致，无需写入"
            : `已写入 ${exportResult.changedNodeCount} 个镜头节点、${exportResult.changedSoundEffectCount ?? 0} 个音效和 ${exportResult.changedMusicCount ?? 0} 首音乐并保存`,
        );
      } catch (exportError) {
        setError(
          exportError instanceof Error
            ? exportError.message
            : "分镜导出失败",
        );
      } finally {
        setBusy(false);
      }
    },
    [preview, request],
  );

  const close = useCallback(() => {
    setPreview(null);
    setRequest(null);
    setMode("current");
    setError("");
    setResult("");
  }, []);

  return {
    preview,
    request,
    mode,
    currentShotNumber,
    busy,
    error,
    result,
    canExport,
    exportButtonLabel: availability.buttonLabel,
    exportUnavailableReason: availability.unavailableReason,
    previewCurrent,
    previewCurrentSoundEffects,
    previewAll,
    confirm,
    close,
  };
}
