import { describe, expect, it } from "vitest";
import { SpeechRunSchema, speechTextKey } from "./animationSpeech";

const base = {
  audioToken: "9a00eb34-5c0b-4b16-8b0e-68a8dca06c3b",
  mode: "align", cropStart: 2, cropEnd: 7, timelineOrigin: -2,
  lines: [{ key: "one", dialogueId: 1, text: "目标锁定" }],
};

describe("speech requests", () => {
  it("accepts finite cropped audio with a negative source origin", () => {
    expect(SpeechRunSchema.parse(base).timelineOrigin).toBe(-2);
  });
  it.each([
    { cropStart: -1 }, { cropEnd: 2 }, { cropEnd: 302.001 },
    { cropEnd: Infinity }, { timelineOrigin: NaN }, { lines: [] },
    { lines: [base.lines[0], base.lines[0]] }, { lines: [{ key: "a", text: " " }] },
  ])("rejects invalid or ambiguous alignment input %j", (change) => {
    expect(SpeechRunSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });
  it("accepts a 300 second crop and empty text for ASR", () => {
    expect(SpeechRunSchema.safeParse({ ...base, mode: "asr", cropEnd: 302, lines: [] }).success).toBe(true);
  });
  it("normalizes punctuation and width but does not equate different dialogue", () => {
    expect(speechTextKey("二级警戒，二级警戒。")).toBe(speechTextKey("二级警戒 二级警戒"));
    expect(speechTextKey("预计５分钟接触")).toBe(speechTextKey("预计5分钟接触"));
    expect(speechTextKey("预计五分钟结束")).not.toBe(speechTextKey("预计5分钟接触"));
  });
});
