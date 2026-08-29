import {
  AudioLines,
  Check,
  ChevronDown,
  LoaderCircle,
  Music2,
  Pause,
  Play,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SOUND_EFFECT_CATEGORIES,
  SOUND_EFFECT_CATEGORY_LABELS,
  type SoundEffectCatalogEntry,
  type SoundEffectCatalogSnapshot,
} from "../data/soundEffectCatalog";
import {
  musicPreviewUrl,
  type MusicCatalogEntry,
  type MusicCatalogSnapshot,
  type MusicRecommendation,
} from "../data/musicCatalog";
import type { DirectorSoundEffectRecommendation } from "../director/contracts";
import type { DialogueRow } from "../types";
import { prepareSoundEffectPreview } from "../ue/client";

type AudioLibraryKind = "sound-effect" | "music";

interface AudioLibraryCategory {
  id: string;
  label: string;
  count: number;
}

interface AudioLibraryBrowserProps {
  soundEffectCatalog: SoundEffectCatalogSnapshot;
  musicCatalog: MusicCatalogSnapshot;
  dialogueRows: DialogueRow[];
  currentDialogueIds: string[];
  activeDialogueId: string;
  appliedSoundEffects: DirectorSoundEffectRecommendation[];
  appliedMusic: MusicRecommendation[];
  onApplySoundEffect: (
    entry: SoundEffectCatalogEntry,
    dialogueId: string,
  ) => void;
  onApplyMusic: (entry: MusicCatalogEntry, dialogueId: string) => void;
}

const UNCATEGORIZED_MUSIC = "__uncategorized__";

function musicCategories(
  entries: readonly MusicCatalogEntry[],
): AudioLibraryCategory[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const tags =
      entry.tags.map((tag) => tag.trim()).filter(Boolean).length > 0
        ? entry.tags.map((tag) => tag.trim()).filter(Boolean)
        : [UNCATEGORIZED_MUSIC];
    for (const tag of new Set(tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts].map(([id, count]) => ({
    id,
    label: id === UNCATEGORIZED_MUSIC ? "未分类" : id,
    count,
  }));
}

export function AudioLibraryBrowser({
  soundEffectCatalog,
  musicCatalog,
  dialogueRows,
  currentDialogueIds,
  activeDialogueId,
  appliedSoundEffects,
  appliedMusic,
  onApplySoundEffect,
  onApplyMusic,
}: AudioLibraryBrowserProps) {
  const [library, setLibrary] = useState<AudioLibraryKind | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [targetDialogueId, setTargetDialogueId] =
    useState(activeDialogueId);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [preparingKey, setPreparingKey] = useState<string | null>(null);
  const [auditionedKeys, setAuditionedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [playbackError, setPlaybackError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackRunRef = useRef(0);
  const soundCategories = useMemo(
    () =>
      SOUND_EFFECT_CATEGORIES.flatMap((id) => {
        const count = soundEffectCatalog.entries.filter(
          (entry) => entry.category === id,
        ).length;
        return count > 0
          ? [{ id, label: SOUND_EFFECT_CATEGORY_LABELS[id], count }]
          : [];
      }),
    [soundEffectCatalog.entries],
  );
  const availableMusicCategories = useMemo(
    () => musicCategories(musicCatalog.entries),
    [musicCatalog.entries],
  );
  const categories =
    library === "sound-effect" ? soundCategories : availableMusicCategories;
  const soundEffects =
    library === "sound-effect" && category
      ? soundEffectCatalog.entries.filter((entry) => entry.category === category)
      : [];
  const music =
    library === "music" && category
      ? musicCatalog.entries.filter((entry) =>
          category === UNCATEGORIZED_MUSIC
            ? entry.tags.every((tag) => !tag.trim())
            : entry.tags.some((tag) => tag.trim() === category),
        )
      : [];
  const dialogueById = useMemo(
    () => new Map(dialogueRows.map((row) => [row.id, row])),
    [dialogueRows],
  );
  const dialogueScope = currentDialogueIds.join("|");

  useEffect(() => {
    setTargetDialogueId((current) => {
      if (currentDialogueIds.includes(current)) {
        return current;
      }
      return currentDialogueIds.includes(activeDialogueId)
        ? activeDialogueId
        : currentDialogueIds[0] ?? "";
    });
  }, [activeDialogueId, dialogueScope]);

  function stopPlayback() {
    playbackRunRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingKey(null);
    setPreparingKey(null);
  }

  useEffect(
    () => () => {
      playbackRunRef.current += 1;
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  function selectLibrary(nextLibrary: AudioLibraryKind) {
    stopPlayback();
    setPlaybackError("");
    setCategory(null);
    setLibrary((current) => (current === nextLibrary ? null : nextLibrary));
  }

  function selectCategory(nextCategory: string) {
    stopPlayback();
    setPlaybackError("");
    setCategory(nextCategory);
  }

  async function playPreparedAudio(
    key: string,
    label: string,
    prepare: () => Promise<string>,
  ) {
    if (playingKey === key) {
      stopPlayback();
      return;
    }
    stopPlayback();
    setPlaybackError("");
    setPreparingKey(key);
    const runId = ++playbackRunRef.current;
    try {
      const url = await prepare();
      if (playbackRunRef.current !== runId) {
        return;
      }
      const audio = new Audio(url);
      audio.preload = "metadata";
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) {
          setPlayingKey(null);
        }
      };
      audio.onerror = () => {
        if (audioRef.current === audio) {
          setPlayingKey(null);
          setPlaybackError(`${label} 试听加载失败`);
        }
      };
      await audio.play();
      if (audioRef.current === audio) {
        setPlayingKey(key);
        setAuditionedKeys((current) => {
          if (current.has(key)) {
            return current;
          }
          const next = new Set(current);
          next.add(key);
          return next;
        });
      }
    } catch (error) {
      if (playbackRunRef.current === runId) {
        setPlaybackError(
          error instanceof Error ? error.message : `${label} 无法播放`,
        );
      }
    } finally {
      if (playbackRunRef.current === runId) {
        setPreparingKey(null);
      }
    }
  }

  function playSoundEffect(entry: SoundEffectCatalogEntry) {
    const key = `sound-effect:${entry.assetName}`;
    void playPreparedAudio(key, entry.assetName, async () => {
      const preview = await prepareSoundEffectPreview(entry.assetName);
      return preview.url;
    });
  }

  function playMusic(entry: MusicCatalogEntry) {
    if (!entry.fileToken) {
      return;
    }
    void playPreparedAudio(
      `music:${entry.recordId}`,
      entry.name,
      async () => musicPreviewUrl(entry),
    );
  }

  return (
    <section className="inspector-section audio-library-browser">
      <div className="section-label">
        <span>资料库试听</span>
        <small>
          {soundEffectCatalog.entries.length} 音效 ·{" "}
          {musicCatalog.entries.length} 音乐
        </small>
      </div>

      <div
        className="audio-library-browser__switch"
        role="group"
        aria-label="选择试听资料库"
      >
        <button
          type="button"
          aria-expanded={library === "sound-effect"}
          aria-pressed={library === "sound-effect"}
          disabled={soundEffectCatalog.entries.length === 0}
          title={
            soundEffectCatalog.entries.length > 0
              ? "浏览音效资料库"
              : "音效资料库为空，请先在设置中同步"
          }
          onClick={() => selectLibrary("sound-effect")}
        >
          <AudioLines size={14} />
          <span>音效资料库</span>
          <small>{soundEffectCatalog.entries.length}</small>
          <ChevronDown size={13} />
        </button>
        <button
          type="button"
          aria-expanded={library === "music"}
          aria-pressed={library === "music"}
          disabled={musicCatalog.entries.length === 0}
          title={
            musicCatalog.entries.length > 0
              ? "浏览音乐资料库"
              : "音乐资料库为空，请先在设置中同步"
          }
          onClick={() => selectLibrary("music")}
        >
          <Music2 size={14} />
          <span>音乐资料库</span>
          <small>{musicCatalog.entries.length}</small>
          <ChevronDown size={13} />
        </button>
      </div>

      {library && (
        <>
          <label className="audio-library-browser__target">
            <span>应用到节点</span>
            <select
              aria-label="资料库资源应用节点"
              value={targetDialogueId}
              onChange={(event) => setTargetDialogueId(event.target.value)}
            >
              {currentDialogueIds.map((dialogueId) => (
                <option key={dialogueId} value={dialogueId}>
                  {dialogueId}
                  {dialogueById.get(dialogueId)?.content
                    ? ` · ${dialogueById.get(dialogueId)!.content}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <div
            className="audio-library-browser__categories"
            role="group"
            aria-label={library === "sound-effect" ? "音效分类" : "音乐分类"}
          >
            {categories.map((item) => (
              <button
                type="button"
                aria-pressed={category === item.id}
                className={category === item.id ? "is-active" : ""}
                key={item.id}
                onClick={() => selectCategory(item.id)}
              >
                <span>{item.label}</span>
                <small>{item.count}</small>
              </button>
            ))}
          </div>
        </>
      )}

      {library === "sound-effect" && category && (
        <div
          className="audio-library-browser__resources"
          role="list"
          aria-label={`${SOUND_EFFECT_CATEGORY_LABELS[
            category as keyof typeof SOUND_EFFECT_CATEGORY_LABELS
          ]}音效`}
        >
          {soundEffects.map((entry) => {
            const key = `sound-effect:${entry.assetName}`;
            const preparing = preparingKey === key;
            const applied = appliedSoundEffects.some(
              (recommendation) =>
                recommendation.dialogueId === targetDialogueId &&
                recommendation.assetName === entry.assetName,
            );
            const auditioned = auditionedKeys.has(key);
            return (
              <div role="listitem" key={`${entry.category}:${entry.assetName}`}>
                <div>
                  <strong>{entry.assetName}</strong>
                  <p>{entry.description}</p>
                </div>
                <div className="audio-library-browser__resource-actions">
                  {auditioned && (
                    <button
                      className="icon-button audio-library-browser__apply"
                      type="button"
                      aria-label={`应用资料库音效 ${entry.assetName} 到节点 ${targetDialogueId}`}
                      aria-pressed={applied}
                      disabled={!targetDialogueId}
                      title={
                        targetDialogueId
                          ? `应用到节点 ${targetDialogueId}`
                          : "当前分镜没有可用对话节点"
                      }
                      onClick={() =>
                        onApplySoundEffect(entry, targetDialogueId)
                      }
                    >
                      <Check size={14} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    type="button"
                    title={playingKey === key ? "暂停音效" : "试听音效"}
                    aria-label={
                      playingKey === key
                        ? `暂停资料库音效 ${entry.assetName}`
                        : `试听资料库音效 ${entry.assetName}`
                    }
                    disabled={preparing}
                    onClick={() => playSoundEffect(entry)}
                  >
                    {preparing ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : playingKey === key ? (
                      <Pause size={15} />
                    ) : (
                      <Play size={15} />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {library === "music" && category && (
        <div
          className="audio-library-browser__resources"
          role="list"
          aria-label={`${category === UNCATEGORIZED_MUSIC ? "未分类" : category}音乐`}
        >
          {music.map((entry) => {
            const key = `music:${entry.recordId}`;
            const preparing = preparingKey === key;
            const applied = appliedMusic.some(
              (recommendation) =>
                recommendation.dialogueId === targetDialogueId &&
                recommendation.recordId === entry.recordId,
            );
            const auditioned = auditionedKeys.has(key);
            return (
              <div role="listitem" key={entry.recordId}>
                <div>
                  <strong>{entry.name}</strong>
                  <span>
                    {entry.stateName} · {entry.stateId}
                  </span>
                  <p>{entry.notes || entry.analysis?.summary || "无备注"}</p>
                </div>
                <div className="audio-library-browser__resource-actions">
                  {auditioned && (
                    <button
                      className="icon-button audio-library-browser__apply"
                      type="button"
                      aria-label={`应用资料库音乐 ${entry.name} 到节点 ${targetDialogueId}`}
                      aria-pressed={applied}
                      disabled={!targetDialogueId}
                      title={
                        targetDialogueId
                          ? `应用到节点 ${targetDialogueId}`
                          : "当前分镜没有可用对话节点"
                      }
                      onClick={() => onApplyMusic(entry, targetDialogueId)}
                    >
                      <Check size={14} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    type="button"
                    title={
                      entry.fileToken
                        ? playingKey === key
                          ? "暂停音乐"
                          : "试听音乐"
                        : "未提供试听文件"
                    }
                    aria-label={
                      playingKey === key
                        ? `暂停资料库音乐 ${entry.name}`
                        : `试听资料库音乐 ${entry.name}`
                    }
                    disabled={!entry.fileToken || preparing}
                    onClick={() => playMusic(entry)}
                  >
                    {preparing ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : playingKey === key ? (
                      <Pause size={15} />
                    ) : (
                      <Play size={15} />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {playbackError && (
        <p className="audio-library-browser__error" role="alert">
          {playbackError}
        </p>
      )}
    </section>
  );
}
