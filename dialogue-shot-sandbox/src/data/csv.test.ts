import { describe, expect, it } from "vitest";
import {
  parseCareerPreviewOptions,
  parseDialogueDatabase,
} from "./csv";
import { findDocCsvFile } from "./csvLoader";

function fixtureFile(relativePath: string): File {
  return {
    name: relativePath.split("/").at(-1) ?? "",
    webkitRelativePath: relativePath,
  } as File;
}

describe("doc CSV file selection", () => {
  it("selects NPC表.csv from csvdir when csvspecial has the same filename", () => {
    const special = fixtureFile("doc/csvspecial/NPC表.csv");
    const configured = fixtureFile("doc/csvdir/NPC表.csv");

    expect(
      findDocCsvFile([special, configured], "NPC表.csv"),
    ).toBe(configured);
  });

  it("supports selecting the csvdir folder directly", () => {
    const configured = fixtureFile("csvdir/NPC表.csv");

    expect(findDocCsvFile([configured], "NPC表.csv")).toBe(configured);
  });
});

describe("dialogue CSV parsing", () => {
  const startText = [
    "##&DialogStart.id,DialogStart.Outline",
    "##id,剧情梗概",
    "735200,测试",
  ].join("\n");
  const npcText = [
    "##&NPC.id,NPC.name,NPC.npcintroduce",
    "##id,名称,介绍",
    "1,玩家,玩家",
  ].join("\n");

  it("recovers unescaped dialogue quotes when the column count is intact", () => {
    const dialogueText = [
      "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
      "##id,NPC,内容,下一节点,结束",
      '735200,1,"他说"你好"。",,true',
    ].join("\n");

    const database = parseDialogueDatabase(
      dialogueText,
      startText,
      npcText,
      "test",
    );

    expect(database.dialogueRows[0].content).toBe('他说"你好"。');
  });

  it("reports the global row number for errors after a parse chunk", () => {
    const header = [
      "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
      "##id,NPC,内容,下一节点,结束",
    ];
    const validRows = Array.from(
      { length: 800 },
      (_, index) =>
        `${735200 + index},1,"${"对白".repeat(220)}",,true`,
    );
    const dialogueText = [
      ...header,
      ...validRows,
      '999999,1,"未闭合字段,,true',
    ].join("\n");

    expect(() =>
      parseDialogueDatabase(
        dialogueText,
        startText,
        npcText,
        "test",
      ),
    ).toThrow("对话表.csv 第 803 行解析失败");
  });

  it("detects reusable NPC dialogue and avatar configuration", () => {
    const dialogueText = [
      "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
      "##id,NPC,内容,下一节点,结束",
      "735200,101968,测试对白,,true",
    ].join("\n");
    const richNpcText = [
      "##&NPC.id,NPC.name,NPC.resource_id,NPC.avatarpath,NPC.headicon,NPC.title,NPC.npcintroduce,NPC.npcchat2,NPC.npcchat3,NPC.ifturn",
      "##id,名称,资源,半身像,头像,头衔,介绍,复杂闲话,冒泡对白,转身",
      "101968,商会安保,200135,144,0,安保,测试 NPC,704000;704001,704100,TRUE",
      "101969,普通守卫,200135,0,,守卫,测试 NPC,0,0,FALSE",
      "101970,,200135,0,,守卫,测试 NPC,,,TRUE",
    ].join("\n");

    const database = parseDialogueDatabase(
      dialogueText,
      startText,
      richNpcText,
      "test",
    );

    expect(database.npcs.get(101968)).toMatchObject({
      hasDialogue: true,
      hasAvatar: true,
      complexChatDialogueIds: ["704000", "704001"],
      bubbleDialogueIds: ["704100"],
    });
    expect(database.npcs.get(101969)).toMatchObject({
      hasDialogue: false,
      hasAvatar: false,
      complexChatDialogueIds: [],
      bubbleDialogueIds: [],
    });
    expect(database.npcs.get(101970)).toMatchObject({
      name: "NPC 101970",
      hasConfiguredName: false,
    });
  });
});

describe("career preview CSV parsing", () => {
  it("reads PreviewSchoolID options from the career configuration table", () => {
    const careers = parseCareerPreviewOptions([
      "##&CareerInfor.id,CareerInfor.name,CareerInfor.bp",
      "##职业id,职业名,角色蓝图",
      "401,镰卫,Ring_Scythe/BP_Ring_Scythe",
      "100,剑士,Eric/BP_Eric",
      "0,无效职业,Invalid/BP_Invalid",
    ].join("\n"));

    expect(careers).toEqual([
      {
        id: 100,
        name: "剑士",
        blueprintPath: "Eric/BP_Eric",
      },
      {
        id: 401,
        name: "镰卫",
        blueprintPath: "Ring_Scythe/BP_Ring_Scythe",
      },
    ]);
  });
});
