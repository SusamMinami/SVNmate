import {
  AlertTriangle,
  CheckCircle2,
  Layers3,
  LoaderCircle,
  Music2,
  PersonStanding,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { DialogueStoryboardExportPreview } from "../types";

interface StoryboardExportModalProps {
  preview: DialogueStoryboardExportPreview;
  mode: "current" | "all" | "sound";
  currentShotNumber: number;
  busy: boolean;
  error: string;
  result: string;
  onClose: () => void;
  onShowAll: () => void;
  onConfirm: (
    selectedShotIndexes: number[],
    selectedCharacterActionIndexes: number[],
    selectedSoundEffectIndexes: number[],
    selectedMusicIndexes: number[],
  ) => void;
}

const ACTION_LABELS: Record<
  DialogueStoryboardExportPreview["nodes"][number]["action"],
  string
> = {
  create: "新增",
  replace: "覆盖",
  clear: "清空旧镜头",
  unchanged: "无需修改",
};

const SOUND_EFFECT_ACTION_LABELS: Record<
  NonNullable<
    DialogueStoryboardExportPreview["soundEffects"]
  >[number]["action"],
  string
> = {
  add: "新增",
  replace: "替换",
  unchanged: "无需修改",
};

const CHARACTER_ACTION_LABELS = {
  add: "新增",
  replace: "替换",
  clear: "清空",
  unchanged: "无需修改",
} as const;

export function StoryboardExportModal({
  preview,
  mode,
  currentShotNumber,
  busy,
  error,
  result,
  onClose,
  onShowAll,
  onConfirm,
}: StoryboardExportModalProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [selectedShotIndexes, setSelectedShotIndexes] = useState<number[]>(
    () => Array.from({ length: preview.shotCount }, (_, index) => index),
  );
  const previewSoundEffects = preview.soundEffects ?? [];
  const [selectedSoundEffectIndexes, setSelectedSoundEffectIndexes] =
    useState<number[]>(() =>
      previewSoundEffects.map((soundEffect) => soundEffect.soundEffectIndex),
    );
  const selectedShots = new Set(selectedShotIndexes);
  const previewCharacterActions = preview.characterActions ?? [];
  const [
    selectedCharacterActionIndexes,
    setSelectedCharacterActionIndexes,
  ] = useState<number[]>(() =>
    previewCharacterActions.map((item) => item.characterActionIndex),
  );
  const selectedCharacterActions = new Set(
    selectedCharacterActionIndexes,
  );
  const selectedCharacterActionRows = previewCharacterActions.filter(
    (item) =>
      selectedCharacterActions.has(item.characterActionIndex),
  );
  const changedCharacterActions = selectedCharacterActionRows.filter(
    (item) => item.action !== "unchanged",
  );
  const selectedSoundEffects = new Set(selectedSoundEffectIndexes);
  const previewMusic = preview.music ?? [];
  const [selectedMusicIndexes, setSelectedMusicIndexes] = useState<number[]>(
    () => previewMusic.map((item) => item.musicIndex),
  );
  const selectedMusic = new Set(selectedMusicIndexes);
  const selectedMusicRows = previewMusic.filter((item) =>
    selectedMusic.has(item.musicIndex),
  );
  const changedMusic = selectedMusicRows.filter(
    (item) => item.action !== "unchanged",
  );
  const selectedNodes = preview.nodes.filter((node) =>
    selectedShots.has(node.shotIndex),
  );
  const changedNodes = selectedNodes.filter(
    (node) => node.action !== "unchanged",
  );
  const selectedSoundEffectRows = previewSoundEffects.filter((soundEffect) =>
    selectedSoundEffects.has(soundEffect.soundEffectIndex),
  );
  const changedSoundEffects = selectedSoundEffectRows.filter(
    (soundEffect) => soundEffect.action !== "unchanged",
  );
  const selectedCharacterActionModelIndexes = new Set(
    selectedCharacterActionRows.map((item) => item.modelIndex),
  );
  const selectedBlockedReasons = [
    ...preview.globalBlockedReasons.filter(
      (reason) =>
        selectedShotIndexes.length > 0 ||
        selectedCharacterActionIndexes.length > 0 ||
        !reason.startsWith("Formation BP"),
    ),
    ...(preview.characterActionBlockedReasons ?? [])
      .filter((item) =>
        selectedCharacterActionModelIndexes.has(item.modelIndex),
      )
      .map((item) => item.reason),
    ...preview.shots
      .filter((shot) => selectedShots.has(shot.shotIndex))
      .flatMap((shot) => shot.blockedReasons),
  ];
  const selectedInvalidShotCount = preview.shots.filter(
    (shot) =>
      selectedShots.has(shot.shotIndex) && !shot.projectionValid,
  ).length;
  const selectedActorActionCount = preview.shots
    .filter((shot) => selectedShots.has(shot.shotIndex))
    .reduce((total, shot) => total + (shot.actorActionCount ?? 0), 0);
  const selectedWarnings = [
    ...(selectedInvalidShotCount
      ? [
        `${selectedInvalidShotCount} 个镜头的投影验收未通过，确认后仍可导出`,
      ]
      : []),
    ...(selectedActorActionCount > 0
      ? [
          `选中镜头包含 ${selectedActorActionCount} 个自动转身建议；只有动作编辑器中明确配置的动作会写入 UE`,
        ]
      : []),
  ];
  const blocked = selectedBlockedReasons.length > 0;
  const allSelected = selectedShotIndexes.length === preview.shotCount;
  const allSoundEffectsSelected =
    previewSoundEffects.length > 0 &&
    selectedSoundEffectIndexes.length === previewSoundEffects.length;
  const allMusicSelected =
    previewMusic.length > 0 &&
    selectedMusicIndexes.length === previewMusic.length;
  const allCharacterActionsSelected =
    previewCharacterActions.length > 0 &&
    selectedCharacterActionIndexes.length ===
      previewCharacterActions.length;
  const hasSelection =
    selectedShotIndexes.length > 0 ||
    selectedCharacterActionIndexes.length > 0 ||
    selectedSoundEffectIndexes.length > 0 ||
    selectedMusicIndexes.length > 0;

  useEffect(() => {
    setSelectedShotIndexes(
      Array.from({ length: preview.shotCount }, (_, index) => index),
    );
    setSelectedSoundEffectIndexes(
      previewSoundEffects.map(
        (soundEffect) => soundEffect.soundEffectIndex,
      ),
    );
    setSelectedCharacterActionIndexes(
      previewCharacterActions.map((item) => item.characterActionIndex),
    );
    setSelectedMusicIndexes(previewMusic.map((item) => item.musicIndex));
    setConfirmed(false);
  }, [preview.reviewToken]);

  function selectAllShots(checked: boolean) {
    setSelectedShotIndexes(
      checked
        ? Array.from({ length: preview.shotCount }, (_, index) => index)
        : [],
    );
    setConfirmed(false);
  }

  function selectAllCharacterActions(checked: boolean) {
    setSelectedCharacterActionIndexes(
      checked
        ? previewCharacterActions.map(
            (item) => item.characterActionIndex,
          )
        : [],
    );
    setConfirmed(false);
  }

  function selectCharacterAction(
    characterActionIndex: number,
    checked: boolean,
  ) {
    setSelectedCharacterActionIndexes((current) =>
      checked
        ? [...current, characterActionIndex].sort(
            (left, right) => left - right,
          )
        : current.filter((index) => index !== characterActionIndex),
    );
    setConfirmed(false);
  }

  function selectShot(shotIndex: number, checked: boolean) {
    setSelectedShotIndexes((current) =>
      checked
        ? [...current, shotIndex].sort((left, right) => left - right)
        : current.filter((index) => index !== shotIndex),
    );
    setConfirmed(false);
  }

  function selectAllSoundEffects(checked: boolean) {
    setSelectedSoundEffectIndexes(
      checked
        ? previewSoundEffects.map(
            (soundEffect) => soundEffect.soundEffectIndex,
          )
        : [],
    );
    setConfirmed(false);
  }

  function selectSoundEffect(soundEffectIndex: number, checked: boolean) {
    setSelectedSoundEffectIndexes((current) =>
      checked
        ? [...current, soundEffectIndex].sort((left, right) => left - right)
        : current.filter((index) => index !== soundEffectIndex),
    );
    setConfirmed(false);
  }

  function selectMusic(musicIndex: number, checked: boolean) {
    setSelectedMusicIndexes((current) =>
      checked
        ? [...current, musicIndex].sort((a, b) => a - b)
        : current.filter((index) => index !== musicIndex),
    );
    setConfirmed(false);
  }

  function selectAllMusic(checked: boolean) {
    setSelectedMusicIndexes(
      checked ? previewMusic.map((item) => item.musicIndex) : [],
    );
    setConfirmed(false);
  }

  return (
    <div className="modal-backdrop storyboard-export-backdrop" role="presentation">
      <section
        className="storyboard-export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storyboard-export-title"
      >
        <header>
          <div className="storyboard-export-title">
            <span>
              <Upload size={18} />
            </span>
            <div>
              <small>UE Dialog Graph 写入预检</small>
              <h2 id="storyboard-export-title">
                {mode === "sound"
                  ? `写入当前分镜音效 ${String(currentShotNumber).padStart(2, "0")}`
                  : mode === "current"
                    ? `导出当前镜头 ${String(currentShotNumber).padStart(2, "0")}`
                    : "导出全部分镜"}
              </h2>
            </div>
          </div>
          <div className="storyboard-export-header-actions">
            {mode === "current" && (
              <button
                className="button storyboard-export-all-button"
                type="button"
                onClick={onShowAll}
                disabled={busy || Boolean(result)}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Layers3 size={15} />
                )}
                全部导出
              </button>
            )}
            <button
              className="icon-button"
              type="button"
              title="关闭"
              aria-label="关闭导出预检"
              onClick={onClose}
              disabled={busy}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <section className="storyboard-export-summary">
          <dl>
            <div>
              <dt>对话资产</dt>
              <dd>{preview.startId}</dd>
            </div>
            <div>
              <dt>分镜</dt>
              <dd>
                {mode === "sound"
                  ? "不导出"
                  : mode === "current"
                  ? String(currentShotNumber).padStart(2, "0")
                  : `${selectedShotIndexes.length} / ${preview.shotCount}`}
              </dd>
            </div>
            <div>
              <dt>变更节点</dt>
              <dd>{changedNodes.length}</dd>
            </div>
            <div>
              <dt>角色动作</dt>
              <dd>
                {selectedCharacterActionIndexes.length} /{" "}
                {previewCharacterActions.length}
              </dd>
            </div>
            <div>
              <dt>音效</dt>
              <dd>
                {selectedSoundEffectIndexes.length} /{" "}
                {previewSoundEffects.length}
              </dd>
            </div>
            <div>
              <dt>音乐</dt>
              <dd>{selectedMusicIndexes.length} / {previewMusic.length}</dd>
            </div>
            <div>
              <dt>启用相机</dt>
              <dd>{preview.cameraName || "不写相机"}</dd>
            </div>
          </dl>
          <code title={preview.dialogueAssetPath}>
            {preview.dialogueAssetPath}
          </code>
        </section>

        {(selectedBlockedReasons.length > 0 ||
          selectedWarnings.length > 0 ||
          error ||
          result) && (
          <div className="storyboard-export-messages">
            {selectedBlockedReasons.map((reason) => (
              <p className="is-error" key={reason}>
                <AlertTriangle size={14} />
                <span>{reason}</span>
              </p>
            ))}
            {selectedWarnings.map((warning) => (
              <p className="is-warning" key={warning}>
                <AlertTriangle size={14} />
                <span>{warning}</span>
              </p>
            ))}
            {error && (
              <p className="is-error" role="alert">
                <AlertTriangle size={14} />
                <span>{error}</span>
              </p>
            )}
            {result && (
              <p className="is-success" role="status">
                <CheckCircle2 size={14} />
                <span>{result}</span>
              </p>
            )}
          </div>
        )}

        <div className="storyboard-export-table-wrap">
          {preview.nodes.length > 0 && (
            <section className="storyboard-export-table-section">
            <div className="storyboard-export-table-section__title">
              <Layers3 size={14} />
              <strong>镜头数据</strong>
              <small>{selectedShotIndexes.length} 项已选</small>
            </div>
            <table className="storyboard-export-table">
              <thead>
                <tr>
                  {mode === "all" && (
                    <th className="storyboard-export-table__select">
                      <input
                        type="checkbox"
                        aria-label="选择全部镜头"
                        title="选择全部镜头"
                        checked={allSelected}
                        disabled={busy || Boolean(result)}
                        onChange={(event) =>
                          selectAllShots(event.target.checked)
                        }
                      />
                    </th>
                  )}
                  <th className="storyboard-export-table__shot">镜头</th>
                  <th className="storyboard-export-table__dialogue">台词节点</th>
                  <th className="storyboard-export-table__role">节点用途</th>
                  <th className="storyboard-export-table__camera">当前相机</th>
                  <th className="storyboard-export-table__camera">导出后</th>
                  <th className="storyboard-export-table__action">处理</th>
                </tr>
              </thead>
              <tbody>
                {preview.nodes.map((node) => (
                  <tr
                    key={node.dialogueId}
                    data-action={node.action}
                    data-selected={selectedShots.has(node.shotIndex)}
                  >
                    {mode === "all" && (
                      <td className="storyboard-export-table__select">
                        {node.role === "shot_start" && (
                          <input
                            type="checkbox"
                            aria-label={`选择镜头 ${String(node.shotIndex + 1).padStart(2, "0")}`}
                            checked={selectedShots.has(node.shotIndex)}
                            disabled={busy || Boolean(result)}
                            onChange={(event) =>
                              selectShot(
                                node.shotIndex,
                                event.target.checked,
                              )
                            }
                          />
                        )}
                      </td>
                    )}
                    <td>
                      {node.role === "shot_start"
                        ? String(
                            mode === "current"
                              ? currentShotNumber
                              : node.shotIndex + 1,
                          ).padStart(2, "0")
                        : "↳"}
                    </td>
                    <td>
                      <code>{node.dialogueId}</code>
                    </td>
                    <td>
                      {node.role === "shot_start" ? "镜头起点" : "镜头延续"}
                    </td>
                    <td>
                      <code>{node.existingCameraPosition || "空"}</code>
                      <small>{node.existingMovementCount} 段运镜</small>
                    </td>
                    <td>
                      <code>{node.desiredCameraPosition || "空"}</code>
                      <small>{node.desiredMovementCount} 段运镜</small>
                    </td>
                    <td>
                      <span className={`export-action export-action--${node.action}`}>
                        {ACTION_LABELS[node.action]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </section>
          )}

          {previewCharacterActions.length > 0 && (
            <section className="storyboard-export-table-section">
              <div className="storyboard-export-table-section__title">
                <PersonStanding size={14} />
                <strong>角色动作</strong>
                <small>
                  {selectedCharacterActionIndexes.length} 项已选
                </small>
              </div>
              <table className="storyboard-export-table storyboard-export-action-table">
                <thead>
                  <tr>
                    <th className="storyboard-export-table__select">
                      <input
                        type="checkbox"
                        aria-label="选择全部角色动作"
                        title="选择全部角色动作"
                        checked={allCharacterActionsSelected}
                        disabled={busy || Boolean(result)}
                        onChange={(event) =>
                          selectAllCharacterActions(event.target.checked)
                        }
                      />
                    </th>
                    <th>台词节点</th>
                    <th>角色槽</th>
                    <th>当前动作</th>
                    <th>导出后</th>
                    <th className="storyboard-export-table__action">处理</th>
                  </tr>
                </thead>
                <tbody>
                  {previewCharacterActions.map((item) => (
                    <tr
                      key={`${item.dialogueId}:${item.modelIndex}`}
                      data-action={item.action}
                      data-selected={selectedCharacterActions.has(
                        item.characterActionIndex,
                      )}
                    >
                      <td className="storyboard-export-table__select">
                        <input
                          type="checkbox"
                          aria-label={`选择节点 ${item.dialogueId} 槽 ${item.modelIndex} 的角色动作`}
                          checked={selectedCharacterActions.has(
                            item.characterActionIndex,
                          )}
                          disabled={busy || Boolean(result)}
                          onChange={(event) =>
                            selectCharacterAction(
                              item.characterActionIndex,
                              event.target.checked,
                            )
                          }
                        />
                      </td>
                      <td><code>{item.dialogueId}</code></td>
                      <td><code>BP {item.modelIndex}</code></td>
                      <td>
                        <code>
                          {item.existingActions.length > 0
                            ? item.existingActions
                                .map(
                                  (action) =>
                                    `${action.montageName} @ ${action.delaySeconds.toFixed(1)}s`,
                                )
                                .join(" · ")
                            : "空"}
                        </code>
                      </td>
                      <td>
                        <code>
                          {item.desiredActions.length > 0
                            ? item.desiredActions
                                .map(
                                  (action) =>
                                    `${action.montageName} @ ${action.delaySeconds.toFixed(1)}s`,
                                )
                                .join(" · ")
                            : "空"}
                        </code>
                        {item.preservedComplexActionCount > 0 && (
                          <small>
                            保留 {item.preservedComplexActionCount} 个特殊动作
                          </small>
                        )}
                      </td>
                      <td>
                        <span
                          className={`export-action export-action--${item.action}`}
                        >
                          {CHARACTER_ACTION_LABELS[item.action]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {previewSoundEffects.length > 0 && (
            <section className="storyboard-export-table-section">
              <div className="storyboard-export-table-section__title">
                <Volume2 size={14} />
                <strong>音效建议</strong>
                <small>{selectedSoundEffectIndexes.length} 项已选</small>
              </div>
              <table className="storyboard-export-table storyboard-export-sound-table">
                <thead>
                  <tr>
                    <th className="storyboard-export-table__select">
                      <input
                        type="checkbox"
                        aria-label="选择全部音效"
                        title="选择全部音效"
                        checked={allSoundEffectsSelected}
                        disabled={busy || Boolean(result)}
                        onChange={(event) =>
                          selectAllSoundEffects(event.target.checked)
                        }
                      />
                    </th>
                    <th className="storyboard-export-table__dialogue">台词节点</th>
                    <th>推荐资产</th>
                    <th>当前音效</th>
                    <th className="storyboard-export-table__action">处理</th>
                  </tr>
                </thead>
                <tbody>
                  {previewSoundEffects.map((soundEffect) => (
                    <tr
                      key={`${soundEffect.dialogueId}-${soundEffect.assetName}`}
                      data-action={soundEffect.action}
                      data-selected={selectedSoundEffects.has(
                        soundEffect.soundEffectIndex,
                      )}
                    >
                      <td className="storyboard-export-table__select">
                        <input
                          type="checkbox"
                          aria-label={`选择音效 ${soundEffect.assetName}`}
                          checked={selectedSoundEffects.has(
                            soundEffect.soundEffectIndex,
                          )}
                          disabled={busy || Boolean(result)}
                          onChange={(event) =>
                            selectSoundEffect(
                              soundEffect.soundEffectIndex,
                              event.target.checked,
                            )
                          }
                        />
                      </td>
                      <td>
                        <code>{soundEffect.dialogueId}</code>
                      </td>
                      <td>
                        <code>{soundEffect.assetName}</code>
                      </td>
                      <td>
                        <code>
                          {soundEffect.existingAssetPath
                            .split(/[./]/)
                            .filter(Boolean)
                            .at(-1) || "空"}
                        </code>
                      </td>
                      <td>
                        <span
                          className={`export-action export-action--${soundEffect.action}`}
                        >
                          {SOUND_EFFECT_ACTION_LABELS[soundEffect.action]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {previewMusic.length > 0 && (
            <section className="storyboard-export-table-section">
              <div className="storyboard-export-table-section__title">
                <Music2 size={14} />
                <strong>音乐建议</strong>
                <small>{selectedMusicIndexes.length} 项已选</small>
              </div>
              <table className="storyboard-export-table">
                <thead>
                  <tr>
                    <th className="storyboard-export-table__select">
                      <input
                        type="checkbox"
                        aria-label="选择全部音乐"
                        title="选择全部音乐"
                        checked={allMusicSelected}
                        disabled={busy || Boolean(result)}
                        onChange={(event) =>
                          selectAllMusic(event.target.checked)
                        }
                      />
                    </th>
                    <th>台词节点</th>
                    <th>推荐音乐</th>
                    <th>当前状态</th>
                    <th>目标状态</th>
                    <th>处理</th>
                  </tr>
                </thead>
                <tbody>
                  {previewMusic.map((item) => (
                    <tr
                      key={`${item.dialogueId}-${item.stateId}`}
                      data-action={item.action}
                      data-selected={selectedMusic.has(item.musicIndex)}
                    >
                      <td className="storyboard-export-table__select">
                        <input
                          type="checkbox"
                          aria-label={`选择音乐 ${item.musicName}`}
                          checked={selectedMusic.has(item.musicIndex)}
                          disabled={busy || Boolean(result)}
                          onChange={(event) => selectMusic(item.musicIndex, event.target.checked)}
                        />
                      </td>
                      <td><code>{item.dialogueId}</code></td>
                      <td>{item.musicName}</td>
                      <td><code>{item.existingStateId}</code></td>
                      <td><code>{item.stateName}</code></td>
                      <td><span className={`export-action export-action--${item.action}`}>{SOUND_EFFECT_ACTION_LABELS[item.action]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>

        <footer>
          <label className="storyboard-export-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={
                busy ||
                blocked ||
                !hasSelection ||
                Boolean(result)
              }
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              已核对 {changedNodes.length} 个镜头节点、{" "}
              {changedCharacterActions.length} 组角色动作、{" "}
              {changedSoundEffects.length} 个音效和 {changedMusic.length} 首音乐，
              并确认写入后保存 UE 对话资产
            </span>
          </label>
          <div>
            <button
              className="button"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              {result ? "完成" : "取消"}
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={
                busy ||
                blocked ||
                !hasSelection ||
                !confirmed ||
                Boolean(result)
              }
              onClick={() =>
                onConfirm(
                  selectedShotIndexes,
                  selectedCharacterActionIndexes,
                  selectedSoundEffectIndexes,
                  selectedMusicIndexes,
                )
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Upload size={16} />
              )}
              {busy ? "正在写入..." : "确认写入并保存"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
