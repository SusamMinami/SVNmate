import { describe, expect, it } from "vitest";
import { createDefaultBlocking } from "../director/blockingResolver";
import { createDirectorInput } from "../director/contracts";
import { createRuleDecisions } from "../director/ruleDirector";
import { parseDialogueDatabase } from "./csv";
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

  it("keeps close-UI nodes as camera keyframes without treating their content as dialogue", () => {
    const database = parseDialogueDatabase(
      [
        "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End,Dialog.State,Dialog.CameraPosition,Dialog.CameraMoveString,Dialog.CharacterBehaviourString",
        "##对话ID,人物,内容,下一ID,结束,状态,机位,运镜,动作",
        "880000,,,880001,false,,,,",
        "880001,1042,这句不会显示。,880002,false,4,c1,move,action",
        "880002,1042,第一句可见台词。,880003,false,0,c1,,",
        "880003,1042,,880004,false,4,c1,move,",
        "880004,1042,第二句可见台词。,880005,false,0,,,",
        "880005,1,我看见了。,,true,0,,,",
      ].join("\n"),
      [
        "##&DialogStart.id,DialogStart.Outline",
        "##对话ID,剧情梗概",
        "880000,测试关闭对话框 UI 节点",
      ].join("\n"),
      [
        "##&NPC.id,NPC.name,NPC.npcintroduce",
        "##id,NPC名字,NPC介绍",
        "1,玩家,由玩家控制的冒险者",
        "1042,林澈,谨慎克制的情报员",
      ].join("\n"),
      "test",
    );

    const result = findDialogueSequence(database, "8800");
    const input = createDirectorInput(result, "camera-keyframes");
    const decisions = createRuleDecisions(
      input,
      createDefaultBlocking(input),
    );

    expect(result.rows.map((row) => row.id)).toEqual([
      "880002",
      "880004",
      "880005",
    ]);
    expect(result.participants.map((participant) => participant.name)).toEqual([
      "林澈",
      "玩家",
    ]);
    expect(result.cameraKeyframes).toEqual([
      {
        dialogueId: "880001",
        rowNumber: 4,
        previousDialogueId: null,
        nextDialogueId: "880002",
        hasCameraInstruction: true,
        hasCharacterAction: true,
      },
      {
        dialogueId: "880003",
        rowNumber: 6,
        previousDialogueId: "880002",
        nextDialogueId: "880004",
        hasCameraInstruction: true,
        hasCharacterAction: false,
      },
    ]);
    expect(input.dialogue.map((row) => row.dialogue_id)).toEqual([
      "880002",
      "880004",
      "880005",
    ]);
    expect(input.camera_keyframes?.map((keyframe) => keyframe.dialogue_id))
      .toEqual(["880001", "880003"]);
    expect(
      decisions.some(
        (decision) =>
          decision.dialogue_ids.includes("880002") &&
          decision.dialogue_ids.includes("880004"),
      ),
    ).toBe(false);
    expect(result.warnings[0]).toContain(
      "2 个关闭对话框 UI 镜头关键帧",
    );
  });
});
