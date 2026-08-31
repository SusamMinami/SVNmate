import { Music2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  activeMusicRecommendationForDialogueIds,
  musicPreviewUrl,
  type MusicRecommendation,
} from "../data/musicCatalog";

interface MusicRecommendationsProps {
  recommendations: MusicRecommendation[];
  dialogueOrder: string[];
  currentDialogueIds: string[];
  playbackActive: boolean;
  onPlaybackStart: () => void;
  onPlaybackStop: () => void;
}

export function MusicRecommendations({
  recommendations,
  dialogueOrder,
  currentDialogueIds,
  playbackActive,
  onPlaybackStart,
  onPlaybackStop,
}: MusicRecommendationsProps) {
  const currentIds = new Set(currentDialogueIds);
  const current = recommendations.filter((item) =>
    currentIds.has(item.dialogueId),
  );
  const activeRecommendation = activeMusicRecommendationForDialogueIds(
    recommendations,
    dialogueOrder,
    currentDialogueIds,
  );
  const isContinuing = current.length === 0 && activeRecommendation !== null;
  const visibleRecommendations = isContinuing
    ? [activeRecommendation]
    : current;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const dialogueScope = currentDialogueIds.join("|");

  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
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
    onPlaybackStart();
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
        <span>配乐建议</span>
        <small>{isContinuing ? "沿用中" : `${current.length} 项`}</small>
      </div>
      {visibleRecommendations.length === 0 ? (
        <p>尚未生成整段配乐建议，请检查音乐资料库同步状态。</p>
      ) : (
        <div className="music-recommendation-list">
          {visibleRecommendations.map((item) => {
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
                    {isContinuing
                      ? `沿用自节点 ${item.dialogueId}`
                      : `节点 ${item.dialogueId}`}{" "}
                    · {item.stateName}
                  </span>
                  <p>
                    {isContinuing
                      ? "本镜延续当前配乐，无需在此处重新切换。"
                      : item.reason}
                  </p>
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
      )}
      {playbackError && (
        <p className="music-playback-error" role="alert">
          {playbackError}
        </p>
      )}
    </section>
  );
}
