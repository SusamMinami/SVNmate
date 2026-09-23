import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import { createDirectorInput, DirectorDecisionSchema, type DirectorInput, type RuleBeatAdvice } from "./contracts";
import { createRuleDecisions } from "./ruleDirector";
import { RuleBeatAdviceSchema } from "./ruleAdvisorContracts";

function inputFor(speakers: DirectorInput["dialogue"][number]["speaker"][] = ["A", "B", "A", "B"]) {
  const input = createDirectorInput(findDialogueSequence(demoDatabase, "2048"), "rule-semantics");
  input.dialogue = speakers.map((speaker, index) => ({
    ...input.dialogue[0], dialogue_id: `line-${index}`, speaker, content: "好的。",
  }));
  input.participants = ["A", "B", "C"].map((slot, index) => ({
    ...input.participants[index % 2],
    slot: slot as "A" | "B" | "C",
    name: ["甲", "乙", "丙"][index],
    role: "dialogue" as const,
    first_dialogue_id: "line-0", entry_dialogue_id: "line-0", exit_dialogue_id: null,
  }));
  return input;
}

function beat(start: number, end: number, overrides: Partial<RuleBeatAdvice["beats"][number]> = {}): RuleBeatAdvice["beats"][number] {
  return {
    start_dialogue_id: `line-${start}`, end_dialogue_id: `line-${end}`,
    narrative_function: "development", intensity: 35,
    coverage_strategy: "relationship_hold", reason: `观察第${start}段关系。`,
    ...overrides,
  };
}

function advise(input: DirectorInput, beats: RuleBeatAdvice["beats"]) {
  return createRuleDecisions(input, undefined, {
    schema_version: "rule-beat.v1", request_id: input.request_id, summary: "关系与反应", beats,
  });
}

describe("rule director narrative semantics", () => {
  it("holds compatible coverage across different narrative beats and retains their reasons", () => {
    const input = inputFor();
    const shots = advise(input, [
      beat(0, 1, { narrative_function: "establish", reason: "先核对到场情况。" }),
      beat(2, 3, { narrative_function: "development", reason: "接着确认行动安排。" }),
    ]);
    expect(shots).toHaveLength(1);
    expect(shots[0].dialogue_ids).toEqual(input.dialogue.map((row) => row.dialogue_id));
    expect(shots[0].intent).toContain("先核对到场情况");
    expect(shots[0].intent).toContain("接着确认行动安排");
  });

  it("keeps high-intensity emphasis static with ordinary look room without a visual motive", () => {
    const input = inputFor();
    const shots = advise(input, [beat(0, 1), beat(2, 3, {
      coverage_strategy: "emphasis_focus", intensity: 98, focus_slot: "A",
    })]);
    const emphasis = shots.find((shot) => shot.dialogue_ids.includes("line-2"))!;
    expect(emphasis.coverage_intent).toBe("individual_emphasis");
    expect(emphasis.camera_movement).toBe("static");
    expect(emphasis.movement_intensity).toBe("none");
    expect(emphasis.negative_space).toBe("look_room");
  });

  it("aims a listener reaction at the speaker rather than the first other slot", () => {
    const input = inputFor(["A", "B", "C", "C"]);
    const shots = advise(input, [beat(0, 1), beat(2, 3, {
      coverage_strategy: "reaction_focus", focus_slot: "B",
    })]);
    const reaction = shots.find((shot) => shot.dialogue_ids.includes("line-2"))!;
    expect(reaction.subject).toBe("B");
    expect(reaction.look_target).toBe("C");
  });

  it("does not turn emphatic punctuation into an unmotivated push-in", () => {
    const input = inputFor();
    input.dialogue[0].content = "今天先把所有的准备情况逐一确认清楚。";
    input.dialogue[1].content = "物资和人员都已到齐，可以按计划开始。";
    input.dialogue[2].content = "太好了！";
    input.dialogue[3].content = "我们终于完成了！";
    const shots = createRuleDecisions(input);
    expect(shots.every((shot) => shot.camera_movement === "static")).toBe(true);
    expect(shots.every((shot) => shot.negative_space !== "pressure")).toBe(true);
  });

  it.each([
    ["reveal", "dolly_in", "look_room"],
    ["realization", "dolly_in", "look_room"],
    ["isolation", "dolly_out", "isolation"],
    ["entrapment", "static", "pressure"],
  ] as const)("uses evidenced %s independently of intensity", (kind, movement, space) => {
    const input = inputFor();
    input.dialogue[2].content = "密信是伪造的，原来如此，只剩我一人被困在这里。";
    const shots = advise(input, [beat(0, 1), beat(2, 3, {
      coverage_strategy: "emphasis_focus", intensity: 20, focus_slot: "A",
      visual_motivation: { kind, dialogue_id: "line-2", evidence: input.dialogue[2].content },
    })]);
    const shot = shots.find((candidate) => candidate.dialogue_ids.includes("line-2"))!;
    expect(shot.camera_movement).toBe(movement);
    expect(shot.negative_space).toBe(space);
    expect(shot.intent).toContain(input.dialogue[2].content);
  });

  it.each([
    { kind: "reveal", dialogue_id: "line-2", evidence: "不存在的台词" },
    { kind: "reveal", dialogue_id: "line-0", evidence: "好的" },
  ] as const)("ignores unsupported or out-of-shot visual evidence: $dialogue_id", (visual_motivation) => {
    const input = inputFor();
    const shots = advise(input, [beat(0, 1), beat(2, 3, {
      coverage_strategy: "emphasis_focus", intensity: 99, focus_slot: "A", visual_motivation,
    })]);
    const shot = shots.find((candidate) => candidate.dialogue_ids.includes("line-2"))!;
    expect(shot.camera_movement).toBe("static");
    expect(shot.negative_space).toBe("look_room");
  });

  it("honors an explicit A-to-C interaction and cuts when its target changes", () => {
    const input = inputFor(["A", "B", "A", "A", "A", "A"]);
    const shots = advise(input, [beat(0, 1),
      beat(2, 3, { coverage_strategy: "speaker_focus", focus_slot: "A", interaction_target_slot: "B" }),
      beat(4, 5, { coverage_strategy: "speaker_focus", focus_slot: "A", interaction_target_slot: "C" }),
    ]);
    expect(shots.find((shot) => shot.dialogue_ids.includes("line-2"))?.look_target).toBe("B");
    const toC = shots.find((shot) => shot.dialogue_ids.includes("line-4"))!;
    expect(toC.dialogue_ids[0]).toBe("line-4");
    expect(toC.subject).toBe("A");
    expect(toC.look_target).toBe("C");
  });

  it("uses a leading named address before previous-speaker heuristics", () => {
    const input = inputFor(["A", "B", "A", "A"]);
    input.dialogue[0].content = "今天先把所有的准备情况逐一确认清楚。";
    input.dialogue[1].content = "物资和人员都已到齐，可以按计划开始。";
    input.dialogue[2].content = "丙，你到底有什么打算？";
    const shot = createRuleDecisions(input).find((candidate) => candidate.dialogue_ids.includes("line-2"))!;
    expect(shot.subject).toBe("A");
    expect(shot.look_target).toBe("C");
  });

  it.each(["self", "absent", "background"] as const)("rejects a %s interaction target", (mode) => {
    const input = inputFor(["A", "B", "A", "A"]);
    if (mode === "absent") input.participants[2].entry_dialogue_id = "not-in-scene";
    if (mode === "background") input.participants[2].role = "background";
    const shots = advise(input, [beat(0, 1), beat(2, 3, {
      coverage_strategy: "emphasis_focus", focus_slot: "A",
      interaction_target_slot: mode === "self" ? "A" : "C",
    })]);
    expect(shots.find((shot) => shot.dialogue_ids.includes("line-2"))?.look_target).toBe("B");
  });

  it.each(["entry", "exit"] as const)("keeps a hard %s boundary inside one advised beat", (mode) => {
    const input = inputFor(["A", "B", "A", "C"]);
    if (mode === "entry") input.participants[2].entry_dialogue_id = "line-2";
    else input.participants[1].exit_dialogue_id = "line-1";
    const shots = advise(input, [beat(0, 3)]);
    expect(shots.map((shot) => shot.dialogue_ids)).toEqual([["line-0", "line-1"], ["line-2", "line-3"]]);
    expect(shots[1].coverage_intent).toBe("reestablish_geography");
  });

  it("allows one beat to span multiple shots when duration requires it", () => {
    const input = inputFor(Array.from({ length: 12 }, (_, index) => index % 2 ? "B" : "A"));
    input.dialogue.forEach((row) => { row.content = "我们已经确认了全部物资和准备情况，接下来可以继续讨论行动安排。"; });
    const shots = advise(input, [beat(0, 11)]);
    expect(shots.length).toBeGreaterThan(1);
    expect(shots.flatMap((shot) => shot.dialogue_ids)).toEqual(input.dialogue.map((row) => row.dialogue_id));
  });

  it("preserves an important coverage change even if its beat is short", () => {
    const input = inputFor(["A", "B", "C", "A"]);
    const shots = advise(input, [
      beat(0, 1),
      beat(2, 2, { coverage_strategy: "reaction_focus", focus_slot: "B", reason: "乙听到丙的回答后沉默。" }),
      beat(3, 3),
    ]);
    const reaction = shots.find((shot) => shot.dialogue_ids.includes("line-2"))!;
    expect(reaction.dialogue_ids).toEqual(["line-2"]);
    expect(reaction.coverage_intent).toBe("reaction");
    expect(reaction.intent).toContain("乙听到丙的回答后沉默");
  });

  it("accepts both old responses and optional semantic fields", () => {
    const base = { schema_version: "rule-beat.v1", request_id: "compat", summary: "兼容旧建议" };
    expect(RuleBeatAdviceSchema.parse({ ...base, beats: [beat(0, 1)] }).beats[0].visual_motivation).toBeUndefined();
    const enhanced = beat(0, 1, {
      focus_slot: "A", interaction_target_slot: "C",
      visual_motivation: { kind: "reveal", dialogue_id: "line-0", evidence: "密信是伪造的" },
    });
    expect(RuleBeatAdviceSchema.parse({ ...base, beats: [enhanced] }).beats[0]).toEqual(enhanced);
  });

  it("keeps every beat represented without exceeding the shot intent contract", () => {
    const input = inputFor(Array.from({ length: 12 }, (_, index) => index % 2 ? "B" : "A"));
    const beats = input.dialogue.map((_, index) => beat(index, index, {
      reason: `节拍${index}：${"继续观察人物关系和反应。".repeat(16)}`,
    }));
    const shots = advise(input, beats);
    expect(shots).toHaveLength(1);
    expect(() => DirectorDecisionSchema.parse(shots[0])).not.toThrow();
    beats.forEach((_, index) => expect(shots[0].intent).toContain(`节拍${index}：`));
  });

  it("does not fabricate a pair when a group interaction is ambiguous", () => {
    const input = inputFor(["A", "A", "A", "A"]);
    const shots = advise(input, [beat(0, 1), beat(2, 3, {
      coverage_strategy: "speaker_focus", focus_slot: "A",
    })]);
    expect(shots.find((shot) => shot.dialogue_ids.includes("line-2"))?.look_target).toBe("group_center");
  });

  it("reestablishes space after an advised change between disjoint pairs", () => {
    const input = inputFor(["A", "B", "A", "B", "C", "D"]);
    input.participants.push({ ...input.participants[2], slot: "D", name: "丁" });
    const shots = advise(input, [beat(0, 1),
      beat(2, 3, { coverage_strategy: "speaker_focus", focus_slot: "A", interaction_target_slot: "B" }),
      beat(4, 5, { coverage_strategy: "speaker_focus", focus_slot: "C", interaction_target_slot: "D" }),
    ]);
    const changed = shots.find((shot) => shot.dialogue_ids.includes("line-4"))!;
    expect(changed.template).toBe("master_group_shot");
    expect(changed.coverage_intent).toBe("reestablish_geography");
  });

  it("holds the reestablished camera into the next compatible beat", () => {
    const input = inputFor(["A", "B", "A", "B", "A", "B"]);
    const shots = advise(input, [beat(0, 1),
      beat(2, 3, { coverage_strategy: "reestablish" }),
      beat(4, 5),
    ]);
    expect(shots.map((shot) => shot.dialogue_ids)).toEqual([
      ["line-0", "line-1"], ["line-2", "line-3", "line-4", "line-5"],
    ]);
    expect(shots[1].coverage_intent).toBe("reestablish_geography");
  });
});
