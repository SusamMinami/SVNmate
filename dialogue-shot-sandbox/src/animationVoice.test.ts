import { describe, expect, it } from "vitest";
import { sequencePatchProblems, SequencePatchSchema, type SequenceSnapshot, type SequencePatch } from "./animationVoice";

function snapshot(): SequenceSnapshot {
  return {
    assetPath: "/Game/LS_Test.LS_Test", name: "LS_Test", revision: "revision", stateRevision: "state",
    dirty: false, displayRate: 30, tickResolution: 24000, start: 0, end: 10,
    director: { path: "", parent: "" }, tracks: [], events: [], marks: [], warnings: [], voices: [],
    skipBlockedReasons: ["缺少 Director Blueprint"],
  };
}
function patch(values: Partial<SequencePatch> = {}): SequencePatch {
  return { assetPath: "/Game/LS_Test.LS_Test", revision: "revision", subtitles: [], skipTime: 9, eventTimes: null, ...values };
}
describe("sequencePatchProblems", () => {
  it("allows subtitle and mark creation without a director", () => {
    expect(sequencePatchProblems(snapshot(), patch({ subtitles: [{ dialogueId: 1, start: 0, end: 2 }] }))).toEqual([]);
  });
  it("blocks event changes without a director", () => {
    expect(sequencePatchProblems(snapshot(), patch({ eventTimes: { show: 1, hide: 8 } }))).toContain("缺少 Director Blueprint");
  });
  it("rejects dirty assets and stale revisions", () => {
    const source = snapshot(); source.dirty = true;
    expect(sequencePatchProblems(source, patch({ revision: "old" }))).toHaveLength(2);
  });
  it.each([[-1, 2], [2, 2], [3, 2], [1, 11], [1, 1.000001]])("rejects invalid subtitle range %s..%s", (start, end) => {
    expect(sequencePatchProblems(snapshot(), patch({ subtitles: [{ dialogueId: 1, start, end }] })).join()).toContain("不足一个 Tick");
  });
  it("rejects duplicate subtitles and overlapping ranges", () => {
    const result = sequencePatchProblems(snapshot(), patch({ subtitles: [
      { dialogueId: 1, start: 1, end: 3 }, { dialogueId: 1, start: 2, end: 4 },
    ] }));
    expect(result.join()).toContain("重复");
    expect(result.join()).toContain("重叠");
  });
  it("preserves unselected sections in collision checks", () => {
    const source = snapshot();
    source.tracks = [{ path: "track", name: "Dialogue", className: "MovieSceneDialogueTrack", binding: "", sections: [
      { path: "section", className: "MovieSceneDialogueSection", dialogueId: 2, start: 2, end: 4, active: true },
    ] }];
    expect(sequencePatchProblems(source, patch({ subtitles: [{ dialogueId: 1, start: 1, end: 3 }] })).join()).toContain("重叠");
    expect(sequencePatchProblems(source, patch({ subtitles: [{ dialogueId: 2, sectionPath: "section", start: 2, end: 5 }] }))).toEqual([]);
  });
  it("rejects mark collision and the exclusive playback end", () => {
    const source = snapshot(); source.marks = [{ label: "other", frame: 216000, seconds: 9 }];
    expect(sequencePatchProblems(source, patch())).toContain("目标帧已有其他标记");
    expect(sequencePatchProblems(snapshot(), patch({ skipTime: 10 })).join()).toContain("不含结束帧");
  });
  it("rejects key movement onto another event", () => {
    const source = snapshot(); source.skipBlockedReasons = [];
    source.events = [
      { sectionPath: "s", channel: 0, key: 0, frame: 24000, seconds: 1, endpoint: "show", role: "show" },
      { sectionPath: "s", channel: 0, key: 1, frame: 48000, seconds: 2, endpoint: "other", role: "other" },
      { sectionPath: "s", channel: 0, key: 2, frame: 192000, seconds: 8, endpoint: "hide", role: "hide" },
    ];
    expect(sequencePatchProblems(source, patch({ eventTimes: { show: 2, hide: 8 } })).join()).toContain("已有事件");
  });
  it("rejects nonfinite values and non-game paths at the boundary", () => {
    expect(SequencePatchSchema.safeParse(patch({ skipTime: NaN })).success).toBe(false);
    expect(SequencePatchSchema.safeParse(patch({ assetPath: "../../other" })).success).toBe(false);
  });
});
