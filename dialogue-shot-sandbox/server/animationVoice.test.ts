import { describe, expect, it } from "vitest";
import { attachSequenceEndpoints, validateSpeechVoices } from "./animationVoice";
import type { SequenceSnapshot } from "../src/animationVoice";

function snapshot(): SequenceSnapshot {
  return {
    assetPath: "/Game/LS_Test.LS_Test", name: "LS_Test", revision: "", stateRevision: "",
    dirty: false, displayRate: 30, tickResolution: 24000, start: 0, end: 10,
    director: { path: "", parent: "" }, tracks: [], marks: [], warnings: [], voices: [], skipBlockedReasons: [],
    events: [{ sectionPath: "/Game/LS_Test.LS_Test:MovieScene.Track.Section", channel: 0, key: 0, frame: 0, seconds: 0, endpoint: "", role: "other" }],
  };
}
const text = `Begin Object Name="LS_Test"
Begin Object Name="MovieScene"
Begin Object Name="Track"
Begin Object Name="Section"
EventChannel=(KeyTimes=(()),KeyValues=((Ptrs=(Function=Function'"CompiledEntry"'),WeakEndpoint=K2Node_CustomEvent'"LS_Test:SequenceDirector.Sequencer Events.Endpoint"')))
End Object
End Object
End Object
Begin Object Name="SequenceDirector"
ParentClass=BlueprintGeneratedClass'"/Game/Seria/Sequences/CommonSequenceDirector.CommonSequenceDirector_C"'
Begin Object Name="Sequencer Events"
Begin Object Name="Endpoint"
CustomProperties Pin (PinName="then",PinType.PinCategory="exec",LinkedTo=(Call 1234,))
End Object
Begin Object Name="Call"
FunctionReference=(MemberName="Show SkipButton",bSelfContext=True)
CustomProperties Pin (PinId=1234,PinName="execute",LinkedTo=(Endpoint 5678,))
CustomProperties Pin (PinName="Mark",DefaultValue="skip")
End Object
End Object
End Object
DirectorBlueprint=Blueprint'"SequenceDirector"'
End Object`;

describe("attachSequenceEndpoints", () => {
  it("resolves a compiled direct Show endpoint with the skip mark", () => {
    const source = snapshot(); attachSequenceEndpoints(source, text);
    expect(source.events[0].role).toBe("show");
    expect(source.director.parent).toContain("CommonSequenceDirector_C");
    expect(source.skipBlockedReasons).toEqual(["无法唯一确认隐藏跳过按钮的已绑定端点，请在 UE 检查"]);
  });
  it.each([
    ['Function=Function\'"CompiledEntry"\'', "Function=None"],
    ['DefaultValue="skip"', 'DefaultValue="other"'],
    ["LinkedTo=(Call 1234,)", "LinkedTo=(Call 1234,Other 9999,)"],
    ['bSelfContext=True', "bSelfContext=False"],
  ])("does not guess ambiguous or uncompiled endpoint: %s", (from, to) => {
    const source = snapshot(); attachSequenceEndpoints(source, text.replace(from, to));
    expect(source.events[0].role).toBe("other");
    expect(source.skipBlockedReasons).toHaveLength(2);
  });
  it("blocks missing director without throwing away other snapshot data", () => {
    const source = snapshot(); attachSequenceEndpoints(source, 'Begin Object Name="LS_Test"\nEnd Object');
    expect(source.skipBlockedReasons[0]).toContain("缺少 Director Blueprint");
    expect(source.events).toHaveLength(1);
  });
});

describe("validateSpeechVoices", () => {
  const draft = { dialogueId: 123, start: 1, end: 2, speechText: "识别台词" };
  const voice = { id: 123, name: "角色", text: "正式台词" };
  it("includes both recognized and official text in the review", () => {
    const result = validateSpeechVoices([draft], [voice]);
    expect(result.changes[0]).toContain("正式台词「正式台词」");
    expect(result.changes[0]).toContain("语音草稿「识别台词」");
  });
  it.each([{ voices: [] }, { voices: [voice, voice] }, { voices: [{ ...voice, text: "" }] }])("refuses unresolved IDs: %j", ({ voices }) => {
    expect(() => validateSpeechVoices([draft], voices)).toThrow("不存在、重复或没有正式台词");
  });
  it("changes the review fingerprint when official text changes", () => {
    expect(validateSpeechVoices([draft], [voice]).proof).not.toBe(
      validateSpeechVoices([draft], [{ ...voice, text: "新版台词" }]).proof);
  });
  it("does not make ordinary non-speech timing edits depend on the voice table", () => {
    expect(validateSpeechVoices([{ dialogueId: 123, start: 1, end: 2 }], []).changes).toEqual([]);
  });
});
