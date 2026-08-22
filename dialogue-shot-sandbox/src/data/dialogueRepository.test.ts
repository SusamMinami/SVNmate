import { describe, expect, it } from "vitest";
import { demoDatabase } from "./demo";
import { findDialogueSequence } from "./dialogueRepository";

describe("findDialogueSequence", () => {
  it("follows the start node and NextID chain", () => {
    const result = findDialogueSequence(demoDatabase, "2048");

    expect(result.startId).toBe("204800");
    expect(result.rows.map((row) => row.id)).toEqual([
      "204801",
      "204802",
      "204803",
      "204804",
      "204805",
      "204806",
      "204807",
    ]);
    expect(result.participants.map((participant) => participant.name)).toEqual([
      "林澈",
      "玩家",
    ]);
    expect(result.adjacentContext.previous?.prefix).toBe("2047");
    expect(result.adjacentContext.previous?.dialogue[0].content).toContain(
      "巡逻路线",
    );
    expect(result.adjacentContext.next?.prefix).toBe("2049");
    expect(result.adjacentContext.next?.dialogue[0].content).toContain(
      "先合作",
    );
  });

  it("requires an exact four-digit prefix", () => {
    expect(() => findDialogueSequence(demoDatabase, "204")).toThrow(
      "请输入四位数对话 ID",
    );
  });

  it("keeps every speaker in a multi-character dialogue", () => {
    const result = findDialogueSequence(demoDatabase, "3099");

    expect(result.participants.map((participant) => participant.slot)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(
      result.participants.map((participant) => participant.entryDialogueId),
    ).toEqual(["309901", "309901", "309903", "309904"]);
    expect(
      result.participants.map((participant) => participant.lastDialogueId),
    ).toEqual(["309905", "309902", "309903", "309904"]);
    expect(
      result.participants.map((participant) => participant.exitDialogueId),
    ).toEqual([null, null, null, null]);
    expect(result.participants.map((participant) => participant.name)).toEqual([
      "岑队长",
      "洛安",
      "弥莎",
      "赫克",
    ]);
    expect(result.rows).toHaveLength(5);
    expect(
      new Set(
        result.participants.map((participant) =>
          participant.position.join(","),
        ),
      ).size,
    ).toBe(4);
    expect(result.warnings).toEqual([]);
  });
});
