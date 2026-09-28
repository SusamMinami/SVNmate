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

export const SequenceSectionSchema = z.object({
  path: z.string(),
  className: z.string(),
  start: z.number().finite().nullable(),
  end: z.number().finite().nullable(),
  active: z.boolean(),
  dialogueId: z.number().int().optional(),
  audioEvent: z.string().optional(),
  subSequence: z.string().optional(),
});
export type SequenceSection = z.infer<typeof SequenceSectionSchema>;

export const SequenceTrackSchema = z.object({
  path: z.string(),
  name: z.string(),
  className: z.string(),
  binding: z.string(),
  sections: z.array(SequenceSectionSchema),
});
export type SequenceTrack = z.infer<typeof SequenceTrackSchema>;

export const SequenceEventSchema = z.object({
  sectionPath: z.string(),
  channel: z.number().int().nonnegative(),
  key: z.number().int().nonnegative(),
  frame: z.number().int(),
  seconds: z.number().finite(),
  endpoint: z.string(),
  endpointFunction: z.string().optional(),
  role: z.enum(["show", "hide", "other"]),
});
export type SequenceEvent = z.infer<typeof SequenceEventSchema>;

export const SequenceSnapshotSchema = z.object({
  assetPath: SequencePathSchema,
  name: z.string(),
  revision: z.string(),
  stateRevision: z.string(),
  dirty: z.boolean(),
  displayRate: z.number().finite(),
  tickResolution: z.number().finite().positive(),
  start: z.number().finite(),
  end: z.number().finite(),
  director: z.object({ path: z.string(), parent: z.string() }),
  tracks: z.array(SequenceTrackSchema),
  events: z.array(SequenceEventSchema),
  marks: z.array(z.object({ label: z.string(), frame: z.number().int(), seconds: z.number().finite() })),
  warnings: z.array(z.string()),
  voices: z.array(z.object({
    id: z.number().int(),
    name: z.string(),
    text: z.string(),
    delayMs: z.number().finite(),
  })),
  skipBlockedReasons: z.array(z.string()),
});
export type SequenceSnapshot = z.infer<typeof SequenceSnapshotSchema>;

export interface AnimationVoiceCache {
  root: string;
  catalog: Array<{ path: string; name: string }>;
  catalogCachedAt: string | null;
  snapshots: Record<string, { snapshot: SequenceSnapshot; cachedAt: string }>;
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
