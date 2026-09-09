import { Music2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  musicPreviewUrl,
  type MusicRecommendation,
} from "../data/musicCatalog";
import type { ExistingDialogueNodeConfiguration } from "../types";

interface MusicRecommendationsProps {
  recommendations: MusicRecommendation[];
  currentDialogueIds: string[];
  existingConfiguration?: ExistingDialogueNodeConfiguration;
  playbackActive: boolean;
  onPlaybackStart: (label: string) => void;
  onPlaybackStop: () => void;
}

export function MusicRecommendations({
  recommendations,
  currentDialogueIds,
  existingConfiguration,
  playbackActive,
  onPlaybackStart,
  onPlaybackStop,
}: MusicRecommendationsProps) {
  const currentIds = new Set(currentDialogueIds);
  const existingStateId =
    existingConfiguration?.backgroundMusicStateId ?? null;
  const current = recommendations.filter(
    (item) =>
      currentIds.has(item.dialogueId) && item.stateId !== existingStateId,
  );
  const recommendationLabel = current.some(
    (item) => item.source === "rule-advisor",
  )
    ? "端侧配乐建议"
    : "待写入配乐";
  const hasExistingMusic = existingStateId !== null;
  const dialogueScope = currentDialogueIds.join("|");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState("");

  useEffect(() => {
    setPlaybackError("");
  }, [dialogueScope]);

  useEffect(() => {
    if (!playbackActive) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(null);
    }
  }, [playbackActive]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  if (current.length === 0) {
    return null;
  }

  async function toggle(item: MusicRecommendation) {
    const playbackId = `${item.dialogueId}-${item.stateId}`;
    if (playing === playbackId) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(null);
      onPlaybackStop();
      return;
    }
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
    setPlaybackError("");
    if (!item.fileToken) {
      setPlaybackError(`${item.musicName} 未提供试听文件`);
      return;
    }
    onPlaybackStart(item.musicName);
    const audio = new Audio(musicPreviewUrl(item));
    audio.preload = "metadata";
    audioRef.current = audio;
    audio.onended = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlaying(null);
        onPlaybackStop();
      }
    };
    audio.onerror = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlaying(null);
        setPlaybackError(`${item.musicName} 试听加载失败`);
        onPlaybackStop();
      }
    };
    try {
      await audio.play();
      if (audioRef.current === audio) {
        setPlaying(playbackId);
      }
    } catch {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setPlaying(null);
        setPlaybackError(`${item.musicName} 无法播放，请重新同步后再试`);
        onPlaybackStop();
      }
    }
  }

  return (
    <section className="inspector-section music-recommendations">
      <div className="section-label">
        <span>{recommendationLabel}</span>
        <small>{hasExistingMusic ? "建议替换" : `${current.length} 项`}</small>
      </div>
      <div className="music-recommendation-list">
        {current.map((item) => {
          const playbackId = `${item.dialogueId}-${item.stateId}`;
          const isPlaying = playing === playbackId;
          return (
            <div
              className={isPlaying ? "is-playing" : undefined}
              aria-current={isPlaying ? "true" : undefined}
              key={playbackId}
            >
              <Music2 size={15} />
              <div>
                <strong>{item.musicName}</strong>
                <span>
                  节点 {item.dialogueId} · {item.stateName}
                </span>
                <p>{item.reason}</p>
                {item.audioSummary && (
                  <small className="music-recommendation-analysis">
                    {item.audioSummary}
                  </small>
                )}
              </div>
              <button
                className="icon-button"
                type="button"
                title={
                  item.fileToken
                    ? isPlaying
                      ? "暂停配乐"
                      : "试听配乐"
                    : "未提供试听文件"
                }
                aria-label={
                  isPlaying
                    ? `暂停配乐 ${item.musicName}`
                    : `试听配乐 ${item.musicName}`
                }
                disabled={!item.fileToken}
                onClick={() => void toggle(item)}
              >
                {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              </button>
            </div>
          );
        })}
      </div>
      {playbackError && (
        <p className="music-playback-error" role="alert">
          {playbackError}
        </p>
      )}
    </section>
  );
}
