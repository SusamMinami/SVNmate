import {
  AudioLines,
  LoaderCircle,
  Pause,
  Play,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DirectorSoundEffectRecommendation } from "../director/contracts";
import type { DialogueRow } from "../types";
import {
  inspectSoundEffectPreview,
  prepareSoundEffectPreview,
} from "../ue/client";

interface SoundEffectRecommendationsProps {
  recommendations: DirectorSoundEffectRecommendation[];
  dialogueRows: DialogueRow[];
  currentDialogueIds: string[];
  busy: boolean;
  onWrite: () => void;
}

function soundEffectRecommendationKey(
  recommendation: Pick<
    DirectorSoundEffectRecommendation,
    "dialogueId" | "category" | "assetName"
  >,
): string {
  return `${recommendation.dialogueId}:${recommendation.category}:${recommendation.assetName}`;
}

function categoryLabel(
  category: DirectorSoundEffectRecommendation["category"],
): string {
  return {
    environment: "环境",
    footstep: "脚步",
    action: "动作",
    special: "特殊",
  }[category];
}

interface PreviewState {
  available: boolean;
  checking: boolean;
  reason: string;
  mediaCount: number;
}

export function SoundEffectRecommendations({
  recommendations,
  dialogueRows,
  currentDialogueIds,
  busy,
  onWrite,
}: SoundEffectRecommendationsProps) {
  const dialogueById = new Map(dialogueRows.map((row) => [row.id, row]));
  const currentIds = new Set(currentDialogueIds);
  const currentRecommendations = recommendations.filter((recommendation) =>
    currentIds.has(recommendation.dialogueId),
  );
  const [previewByAsset, setPreviewByAsset] = useState<
    Record<string, PreviewState>
  >({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prepareRequestRef = useRef(0);
  const previewScope = `${currentDialogueIds.join("|")}::${currentRecommendations
    .map((recommendation) => recommendation.assetName)
    .sort()
    .join("|")}`;

  useEffect(() => {
    prepareRequestRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
    setPreparing(null);
    setPlaybackError("");
    const assetNames = Array.from(
      new Set(
        currentRecommendations.map(
          (recommendation) => recommendation.assetName,
        ),
      ),
    );
    setPreviewByAsset(
      Object.fromEntries(
        assetNames.map((assetName) => [
          assetName,
          {
            available: false,
            checking: true,
            reason: "正在检查 UE/Wwise 试听资源",
            mediaCount: 0,
          },
        ]),
      ),
    );
    let cancelled = false;
    void Promise.all(
      assetNames.map(async (assetName) => {
        try {
          const info = await inspectSoundEffectPreview(assetName);
          return [assetName, { ...info, checking: false }] as const;
        } catch (error) {
          return [
            assetName,
            {
              available: false,
              checking: false,
              reason:
                error instanceof Error
                  ? error.message
                  : "无法检查 UE/Wwise 试听资源",
              mediaCount: 0,
            },
          ] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) {
        setPreviewByAsset(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [previewScope]);

  useEffect(
    () => () => {
      prepareRequestRef.current += 1;
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  async function togglePreview(
    recommendation: DirectorSoundEffectRecommendation,
  ) {
    const key = soundEffectRecommendationKey(recommendation);
    if (playing === key) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    setPlaying(null);
    setPreparing(key);
    setPlaybackError("");
    const requestId = ++prepareRequestRef.current;
    try {
      const preview = await prepareSoundEffectPreview(
        recommendation.assetName,
      );
      if (prepareRequestRef.current !== requestId) {
        return;
      }
      const audio = new Audio(preview.url);
      audio.preload = "auto";
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) {
          setPlaying(null);
        }
      };
      audio.onerror = () => {
        if (audioRef.current === audio) {
          setPlaying(null);
          setPlaybackError(`${recommendation.assetName} 试听加载失败`);
        }
      };
      await audio.play();
      if (audioRef.current === audio) {
        setPlaying(key);
      }
    } catch (error) {
      if (prepareRequestRef.current === requestId) {
        setPlaybackError(
          error instanceof Error
            ? error.message
            : `${recommendation.assetName} 无法播放`,
        );
      }
    } finally {
      if (prepareRequestRef.current === requestId) {
        setPreparing(null);
      }
    }
  }

  return (
    <section className="inspector-section sound-effect-analysis">
      <div className="section-label sound-effect-analysis__header">
        <span>已有音效建议</span>
        <small>{currentRecommendations.length} 项</small>
        {currentRecommendations.length > 0 && (
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={onWrite}
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Upload size={14} />
            )}
            {busy ? "正在预检..." : "写入本镜音效"}
          </button>
        )}
      </div>
      {currentRecommendations.length > 0 ? (
        <div className="sound-effect-list">
          {currentRecommendations.map((recommendation) => {
            const row = dialogueById.get(recommendation.dialogueId);
            const recommendationKey =
              soundEffectRecommendationKey(recommendation);
            const preview = previewByAsset[recommendation.assetName];
            const isPreparing = preparing === recommendationKey;
            const previewDisabled =
              !preview || preview.checking || !preview.available;
            const previewTitle = isPreparing
              ? "正在从 UE/Wwise 提取试听缓存"
              : preview?.checking
              ? "正在检查 UE/Wwise 试听资源"
              : preview?.available
                ? preview.mediaCount > 1
                  ? preview.reason
                  : "试听音效"
                : preview?.reason ?? "UE/Wwise 试听资源不可用";
            return (
              <div key={recommendationKey}>
                <AudioLines size={15} />
                <div>
                  <strong>{recommendation.assetName}</strong>
                  <span>
                    {categoryLabel(recommendation.category)} · 节点{" "}
                    {recommendation.dialogueId}
                  </span>
                  {row && <blockquote>{row.content}</blockquote>}
                  <p>{recommendation.reason}</p>
                  <small>{recommendation.description}</small>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title={previewTitle}
                  aria-label={
                    playing === recommendationKey
                      ? `暂停音效 ${recommendation.assetName}`
                      : `试听音效 ${recommendation.assetName}`
                  }
                  disabled={
                    previewDisabled || isPreparing
                  }
                  onClick={() => void togglePreview(recommendation)}
                >
                  {isPreparing ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : playing === recommendationKey ? (
                    <Pause size={15} />
                  ) : (
                    <Play size={15} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p>当前分镜内容没有与现有目录充分匹配的音效。</p>
      )}
      {playbackError && (
        <p className="sound-effect-playback-error" role="alert">
          {playbackError}
        </p>
      )}
    </section>
  );
}
