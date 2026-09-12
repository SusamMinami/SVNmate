import { z } from "zod";

export const SequencePathSchema = z.string().trim().regex(/^\/Game\/[A-Za-z0-9_/]+(?:\.[A-Za-z0-9_]+)?$/);
export const SubtitleDraftSchema = z.object({
  sectionPath: z.string().optional(),
  dialogueId: z.number().int().positive().max(2147483647),
  start: z.number().finite(),
  end: z.number().finite(),
  speechText: z.string().trim().min(1).max(1000).optional(),
});
export const SequencePatchSchema = z.object({
  assetPath: SequencePathSchema,
  revision: z.string().min(1),
  subtitles: z.array(SubtitleDraftSchema).max(500),
  skipTime: z.number().finite().nullable(),
  eventTimes: z.object({
    show: z.number().finite(),
    hide: z.number().finite(),
  }).nullable(),
});
export type SequencePatch = z.infer<typeof SequencePatchSchema>;
export type SubtitleDraft = z.infer<typeof SubtitleDraftSchema>;

export interface SequenceSection {
  path: string;
  className: string;
  start: number | null;
  end: number | null;
  active: boolean;
  dialogueId?: number;
  audioEvent?: string;
  subSequence?: string;
}
export interface SequenceTrack {
  path: string;
  name: string;
  className: string;
  binding: string;
  sections: SequenceSection[];
}
export interface SequenceEvent {
  sectionPath: string;
  channel: number;
  key: number;
  frame: number;
  seconds: number;
  endpoint: string;
  role: "show" | "hide" | "other";
}
export interface SequenceSnapshot {
  assetPath: string;
  name: string;
  revision: string;
  stateRevision: string;
  dirty: boolean;
  displayRate: number;
  tickResolution: number;
  start: number;
  end: number;
  director: { path: string; parent: string };
  tracks: SequenceTrack[];
  events: SequenceEvent[];
  marks: Array<{ label: string; frame: number; seconds: number }>;
  warnings: string[];
  voices: Array<{ id: number; name: string; text: string; delayMs: number }>;
  skipBlockedReasons: string[];
}
export interface SequenceReview {
  token: string;
  patch: SequencePatch;
  changes: string[];
}

export function sequencePatchProblems(snapshot: SequenceSnapshot, patch: SequencePatch): string[] {
  const errors: string[] = [];
  if (snapshot.dirty) errors.push("动画资产有未保存修改，请先在 UE 保存后重新扫描");
  if (patch.revision !== snapshot.revision || patch.assetPath !== snapshot.assetPath) {
    errors.push("动画配置已变化，请重新扫描");
  }
  if (!patch.subtitles.length && patch.skipTime === null && !patch.eventTimes) errors.push("没有选择待写入配置");
  const sections = snapshot.tracks.flatMap((track) => track.sections);
  const tracks = snapshot.tracks.filter((track) => track.className === "MovieSceneDialogueTrack");
  if (patch.subtitles.length && tracks.length > 1) errors.push("存在多个字幕轨，第一版不自动选择目标轨");
  const targets = new Set<string>();
  const ranges = sections.filter((s) => s.dialogueId !== undefined && !patch.subtitles.some((d) => d.sectionPath === s.path))
    .map((s) => ({ start: s.start, end: s.end }));
  for (const draft of patch.subtitles) {
    if (draft.start < snapshot.start || draft.end > snapshot.end || draft.end <= draft.start ||
        Math.round(draft.end * snapshot.tickResolution) <= Math.round(draft.start * snapshot.tickResolution)) {
      errors.push(`字幕 ${draft.dialogueId} 时间超出播放范围或不足一个 Tick`);
    }
    if (draft.sectionPath) {
      if (targets.has(draft.sectionPath)) errors.push("同一字幕段不能重复写入");
      targets.add(draft.sectionPath);
      if (!sections.some((s) => s.path === draft.sectionPath && s.dialogueId !== undefined)) errors.push("目标字幕段已不存在");
    } else if (sections.some((s) => s.dialogueId === draft.dialogueId) ||
      patch.subtitles.filter((s) => !s.sectionPath && s.dialogueId === draft.dialogueId).length > 1) {
      errors.push(`字幕 ${draft.dialogueId} 已存在或重复，请选择已有段编辑`);
    }
    ranges.push(draft);
  }
  if (patch.subtitles.length) {
    const ordered = ranges.filter((r): r is { start: number; end: number } => r.start !== null && r.end !== null)
      .sort((a, b) => a.start - b.start);
    if (ordered.some((r, i) => i > 0 && r.start < ordered[i - 1].end - 1 / snapshot.tickResolution)) {
      errors.push("字幕段时间重叠，请调整后再审核");
    }
  }
  if (patch.skipTime !== null) {
    if (patch.skipTime < snapshot.start || patch.skipTime >= snapshot.end) errors.push("skip 标记必须在播放范围内（不含结束帧）");
    if (snapshot.marks.filter((m) => m.label === "skip").length > 1) errors.push("存在多个 skip 标记，请先在 UE 消除歧义");
    const frame = Math.round(patch.skipTime * snapshot.tickResolution);
    if (snapshot.marks.some((m) => m.label !== "skip" && m.frame === frame)) errors.push("目标帧已有其他标记");
  }
  if (patch.eventTimes) {
    errors.push(...snapshot.skipBlockedReasons);
    const { show, hide } = patch.eventTimes;
    if (show < snapshot.start || hide >= snapshot.end || show >= hide) errors.push("跳过事件时间必须满足播放开始 ≤ 显示 < 隐藏 < 播放结束");
    if (patch.skipTime !== null && hide > patch.skipTime) errors.push("隐藏跳过按钮的时间不能晚于 skip 标记");
    for (const role of ["show", "hide"] as const) {
      const event = snapshot.events.find((e) => e.role === role);
      const target = Math.round(patch.eventTimes[role] * snapshot.tickResolution);
      if (event && snapshot.events.some((e) => e !== event && e.sectionPath === event.sectionPath && e.channel === event.channel && e.frame === target)) {
        errors.push(`${role === "show" ? "显示" : "隐藏"}目标帧已有事件，不能覆盖`);
      }
    }
    if (Math.round(show * snapshot.tickResolution) === Math.round(hide * snapshot.tickResolution)) errors.push("两个跳过事件不能位于同一 Tick");
  }
  return [...new Set(errors)];
}
