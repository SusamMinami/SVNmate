import { LoaderCircle } from "lucide-react";
import type { MusicCatalogSnapshot } from "../data/musicCatalog";
import type { ExistingDialogueNodeConfiguration } from "../types";

interface ExistingAudioConfigurationProps {
  configuration?: ExistingDialogueNodeConfiguration;
  loading?: boolean;
  musicCatalog: MusicCatalogSnapshot;
}

export function ExistingAudioConfiguration({
  configuration,
  loading = false,
  musicCatalog,
}: ExistingAudioConfigurationProps) {
  if (loading) {
    return (
      <section className="inspector-section ue-existing-audio" role="status">
        <div className="section-label">
          <span>UE 当前音频</span>
          <small>
            <LoaderCircle className="spin" size={11} />
            读取中
          </small>
        </div>
      </section>
    );
  }

  const musicStateId = configuration?.backgroundMusicStateId ?? null;
  const music =
    musicStateId === null
      ? undefined
      : musicCatalog.entries.find((entry) => entry.stateId === musicStateId);
  const hasSoundEffect = Boolean(configuration?.soundEffectAssetName);
  const hasMusic = musicStateId !== null;
  if (!configuration || (!hasSoundEffect && !hasMusic)) {
    return null;
  }

  return (
    <section className="inspector-section ue-existing-audio">
      <div className="section-label">
        <span>UE 当前音频</span>
        <small>{Number(hasSoundEffect) + Number(hasMusic)} 项</small>
      </div>
      <dl>
        {hasSoundEffect && (
          <div>
            <dt>Sound Effect</dt>
            <dd title={configuration.soundEffectAssetPath || undefined}>
              <strong>{configuration.soundEffectAssetName}</strong>
              <span>延迟 {configuration.soundEffectDelaySeconds}s</span>
            </dd>
          </div>
        )}
        {hasMusic && (
          <div>
            <dt>Music</dt>
            <dd>
              <strong>{music?.name ?? `音乐状态 ${musicStateId}`}</strong>
              <span>
                {music?.stateName ?? "未同步名称"} · ID {musicStateId} · 延迟{" "}
                {configuration.backgroundMusicDelaySeconds}s
              </span>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
