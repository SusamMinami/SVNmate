import { ArrowDown, ArrowUp, Check, Play, Plus, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { SequenceSnapshot } from "../animationVoice";
import type { SpeechLine } from "../animationSpeech";
import type { useAnimationSpeech } from "../app/useAnimationSpeech";
import type { SubtitleRow } from "../app/useAnimationVoice";
import { useTaskReceipts } from "./TaskMotion";

export function AnimationSubtitleList({
  speech,
  snapshot,
  rows,
  disabled,
  locked,
  active,
  playing,
  onPlay,
  onRowsChange,
  onInvalidate,
  onAdopt,
}: {
  speech: ReturnType<typeof useAnimationSpeech>;
  snapshot: SequenceSnapshot;
  rows: SubtitleRow[];
  disabled: boolean;
  locked: boolean;
  active: boolean;
  playing?: string;
  onPlay: (line: SpeechLine) => void;
  onRowsChange: (rows: SubtitleRow[]) => void;
  onInvalidate: () => void;
  onAdopt: (keys: string[]) => void;
}) {
  const session = speech.session;
  const list = useRef<HTMLElement>(null);
  useTaskReceipts(list, `${snapshot.assetPath}:${session.job?.id ?? ""}`, session.adoptedKeys, active);
  const resultLines = session.job?.result?.lines ?? [];
  const referenceIndex = new Map(
    (session.mode === "align" ? session.reference : []).map((line, index) => [line.key, index]),
  );
  const resultTargets = new Map<string, SpeechLine>();
  for (const line of resultLines) {
    const target = rows.some((row) => row.key === line.key)
      ? line.key
      : session.adoptedTargets[line.key];
    if (target) resultTargets.set(target, line);
  }
  const pendingResults = resultLines.filter((line) =>
    !session.adoptedKeys[line.key] &&
    !rows.some((row) => row.key === line.key) &&
    !session.adoptedTargets[line.key]);
  const orderedRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((left, right) => {
      const leftRank = referenceIndex.get(left.row.key);
      const rightRank = referenceIndex.get(right.row.key);
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
      if (leftRank !== undefined) return -1;
      if (rightRank !== undefined) return 1;
      return left.originalIndex - right.originalIndex;
    });

  function updateRow(key: string, patch: Partial<SubtitleRow>) {
    onInvalidate();
    onRowsChange(rows.map((row) => row.key === key ? { ...row, ...patch, selected: true } : row));
  }

  function reorderReference(index: number, delta: number) {
    const reference = [...session.reference];
    [reference[index], reference[index + delta]] = [reference[index + delta], reference[index]];
    speech.edit({ reference });
  }

  function renderSuggestion(line: SpeechLine, index: number) {
    const adopted = Boolean(session.adoptedKeys[line.key]);
    return <>
      <div className="animation-subtitle__suggestion-time">
        <span>{line.start.toFixed(3)} – {line.end.toFixed(3)}</span>
        <button type="button" title="试听模型建议时间" aria-label={`试听语音结果 ${index + 1}`}
          onClick={() => onPlay(line)}><Play size={13} /></button>
      </div>
      <small role="status">{playing === line.key ? "试听中" : session.auditioned[line.key] ? "已试听" : "待试听"}</small>
      {line.warnings.length > 0 && <small className="animation-voice__warning">{line.warnings.join("；")}</small>}
      {adopted
        ? <span className="animation-subtitle__adopted" data-task-receipt={line.key}><Check size={13} />已采用到待写入</span>
        : <button type="button" disabled={disabled} onClick={() => onAdopt([line.key])}>采用到待写入</button>}
    </>;
  }

  return <section ref={list} className="animation-subtitle" aria-label="字幕与对齐">
    <div className="animation-voice__section-title">
      <h3>字幕与对齐</h3>
      <div className="animation-subtitle__title-actions">
        <span role="status">{rows.filter((row) => row.selected).length} 条待写入</span>
        <button type="button" disabled={disabled} title="添加字幕" aria-label="添加字幕" onClick={() => {
          onInvalidate();
          onRowsChange([...rows, { key: crypto.randomUUID(), dialogueId: "", start: "", end: "", selected: true }]);
        }}><Plus size={15} /></button>
      </div>
    </div>
    <table className="animation-subtitle__table">
      <thead><tr>
        <th><label className="animation-subtitle__write-all">
          <input type="checkbox" aria-label="选择全部字幕写入" disabled={disabled || !rows.length}
            checked={rows.length > 0 && rows.every((row) => row.selected)}
            onChange={(event) => {
              onInvalidate();
              onRowsChange(rows.map((row) => ({ ...row, selected: event.target.checked })));
            }} />
          <span>写入</span>
        </label></th>
        <th>对齐</th>
        <th>台词</th>
        <th>字幕时间 / 秒</th>
        <th>模型建议</th>
        <th />
      </tr></thead>
      <tbody>
        {orderedRows.map(({ row, originalIndex }) => {
          const voice = snapshot.voices.find((item) => String(item.id) === row.dialogueId);
          const referencePosition = referenceIndex.get(row.key);
          const reference = referencePosition === undefined ? undefined : session.reference[referencePosition];
          const result = resultTargets.get(row.key);
          return <tr key={row.key} data-selected={row.selected}>
            <td><input type="checkbox" aria-label={`选择字幕 ${originalIndex + 1} 写入`} checked={row.selected} disabled={disabled}
              onChange={(event) => {
                onInvalidate();
                onRowsChange(rows.map((item) => item.key === row.key ? { ...item, selected: event.target.checked } : item));
              }} /></td>
            <td>{session.mode === "align" && reference && referencePosition !== undefined ? <div className="animation-subtitle__order">
              <input type="checkbox" aria-label={`选择字幕 ${originalIndex + 1} 用于对齐`} checked={reference.selected} disabled={locked}
                onChange={(event) => speech.edit({
                  reference: session.reference.map((item) =>
                    item.key === row.key ? { ...item, selected: event.target.checked } : item),
                })} />
              <span>{referencePosition + 1}</span>
              <button type="button" title="上移对齐顺序" aria-label={`上移字幕 ${originalIndex + 1} 的对齐顺序`}
                disabled={locked || referencePosition === 0} onClick={() => reorderReference(referencePosition, -1)}><ArrowUp size={12} /></button>
              <button type="button" title="下移对齐顺序" aria-label={`下移字幕 ${originalIndex + 1} 的对齐顺序`}
                disabled={locked || referencePosition === session.reference.length - 1} onClick={() => reorderReference(referencePosition, 1)}><ArrowDown size={12} /></button>
            </div> : <span className="animation-subtitle__muted">—</span>}</td>
            <td>
              <div className="animation-subtitle__identity">
                <input aria-label={`字幕 ${originalIndex + 1} ID`} value={row.dialogueId} disabled={disabled}
                  onChange={(event) => updateRow(row.key, { dialogueId: event.target.value })} />
                <div>
                  <small>{voice?.name || (row.sectionPath ? "UE 已有字幕" : "新增字幕")}{row.timeSource ? ` · ${row.timeSource}` : ""}</small>
                  <span>{voice?.text || row.speechText || "配音表未匹配"}</span>
                  {voice && row.speechText && row.speechText !== voice.text && <small>识别：{row.speechText}</small>}
                  {row.speechText && !voice && <small className="animation-voice__warning">
                    {row.dialogueId ? "配音 ID 待审核校验" : "待填写有效配音 ID"}；识别文字不写入配音表
                  </small>}
                </div>
              </div>
            </td>
            <td><div className="animation-subtitle__time">
              <input type="number" step="0.001" aria-label={`字幕 ${originalIndex + 1} 开始`} value={row.start} disabled={disabled}
                onChange={(event) => updateRow(row.key, { start: event.target.value })} />
              <span>–</span>
              <input type="number" step="0.001" aria-label={`字幕 ${originalIndex + 1} 结束`} value={row.end} disabled={disabled}
                onChange={(event) => updateRow(row.key, { end: event.target.value })} />
              <small>{row.start && row.end ? `${(Number(row.end) - Number(row.start)).toFixed(3)}s` : "待定"}</small>
            </div></td>
            <td>{result ? renderSuggestion(result, resultLines.indexOf(result)) : <span className="animation-subtitle__muted">尚无建议</span>}</td>
            <td>{!row.sectionPath && <button type="button" disabled={disabled} title="移除新增字幕" aria-label={`移除新增字幕 ${originalIndex + 1}`}
              onClick={() => {
                onInvalidate();
                onRowsChange(rows.filter((item) => item.key !== row.key));
              }}><Trash2 size={14} /></button>}</td>
          </tr>;
        })}
        {pendingResults.map((line) => {
          const resultIndex = resultLines.indexOf(line);
          return <tr key={line.key} data-result="pending">
            <td><span className="animation-subtitle__muted">—</span></td>
            <td><span className="animation-subtitle__muted">—</span></td>
            <td><div className="animation-subtitle__identity">
              <span className="animation-subtitle__draft-id">待填写 ID</span>
              <div><small>语音识别草稿</small><span>{line.text}</span></div>
            </div></td>
            <td><span className="animation-subtitle__muted">采用后生成字幕</span></td>
            <td>{renderSuggestion(line, resultIndex)}</td>
            <td />
          </tr>;
        })}
      </tbody>
    </table>
    {!rows.length && !pendingResults.length && <p className="animation-voice__empty">尚无字幕或语音识别结果</p>}
    {pendingResults.length > 1 && <div className="animation-subtitle__bulk">
      <button type="button" disabled={disabled} onClick={() => onAdopt(pendingResults.map((line) => line.key))}>
        <Check size={14} />全部采用到待写入
      </button>
    </div>}
  </section>;
}
