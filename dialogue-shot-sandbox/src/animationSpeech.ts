import { z } from "zod";
import { SequencePathSchema } from "./animationVoice";

export const SpeechMediaRequestSchema = z.object({
  assetPath: SequencePathSchema,
  revision: z.string().min(1),
  sectionPath: z.string().min(1),
});
export const SpeechRunSchema = z.object({
  audioToken: z.string().uuid(),
  mode: z.enum(["align", "asr"]),
  cropStart: z.number().finite().nonnegative(),
  cropEnd: z.number().finite().positive(),
  timelineOrigin: z.number().finite(),
  lines: z.array(z.object({
    key: z.string().min(1).max(2000),
    dialogueId: z.number().int().positive().optional(),
    text: z.string().trim().min(1).max(1000),
  })).max(200),
}).superRefine((value, ctx) => {
  if (value.cropEnd <= value.cropStart || value.cropEnd - value.cropStart > 300) {
    ctx.addIssue({ code: "custom", message: "单次音频范围需大于 0 且不超过 300 秒" });
  }
  if (value.mode === "align" && !value.lines.length) ctx.addIssue({ code: "custom", message: "强制对齐需要正式台词" });
  if (new Set(value.lines.map((line) => line.key)).size !== value.lines.length) ctx.addIssue({ code: "custom", message: "台词行重复" });
});
export type SpeechRun = z.infer<typeof SpeechRunSchema>;
export interface SpeechMediaChoice {
  id: string; name: string; eventName: string; language: string;
}
export interface SpeechAudio {
  token: string; url: string; duration: number; eventName: string; mediaId: string;
  assetPath: string; revision: string; sectionPath: string; sectionStart: number;
}
export interface SpeechLine {
  key: string;
  dialogueId?: number;
  text: string;
  start: number;
  end: number;
  audioStart: number;
  audioEnd: number;
  warnings: string[];
}
export interface SpeechResult {
  mode: "align" | "asr"; model: string; device: string; elapsed: number;
  lines: SpeechLine[]; warnings: string[];
}
export interface SpeechJob {
  id: string;
  state: "running" | "complete" | "failed" | "cancelled";
  stage: string;
  result?: SpeechResult;
  error?: string;
}
export interface SpeechStatus {
  ready: boolean; reason: string; root: string; busy: boolean;
}
export const speechTextKey = (text: string) => text.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
