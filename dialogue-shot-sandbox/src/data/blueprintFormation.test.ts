import { describe, expect, it } from "vitest";
import type { BlueprintFormationSnapshot } from "../types";
import { createDirectorInput } from "../director/contracts";
import { createShotPreview } from "../director/shotPlanner";
import { applyBlueprintFormation } from "./blueprintFormation";
import { parseDialogueDatabase } from "./csv";
import { findDialogueSequence } from "./dialogueRepository";

const dialogues = `##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End,Dialog.CharacterBehaviourString,Dialog.RelativeTransformsString
##对话ID,人物,内容,下一ID,结束,动作,相对位置
735000,,,735001,false,,
735001,101968,守卫甲说话,735002,false,";;;;0.000000,AM_Talk,0,0,0,0,0,0,0,0;",
735002,101968,守卫乙说话,735003,false,";;0.000000,AM_Talk,0,0,0,0,0,0,0,0;;;",
735003,1,玩家说话,735004,false,,
735004,101892,西维尔说话,,true,";;;0.000000,AM_Talk,0,0,0,0,0,0,0,0;",
`;

const starts = `##&DialogStart.id,DialogStart.Outline,DialogStart.Formation,DialogStart.Model
##对话ID,剧情梗概,模板,模型
735000,测试站位,/Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000.BP_735000_C,player;None;M63_Cityguard;N115_Finance_Female;M63_Cityguard
`;

const npcs = `##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id
##id,名称,介绍,资源
1,玩家,玩家,
101968,商会安保,守卫,200135
101892,西维尔,职员,200528
`;

const models = `##&Model.id,,Model.path
##id,配置填写在此列，Model.path保存时自动生成，由程序调用,生成路径
200135,/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC,/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC.BP_M63_Cityguard_NPC_C
200528,/Game/Seria/NPC/N115_Finance_Female/BP_N115_Finance_Female,/Game/Seria/NPC/N115_Finance_Female/BP_N115_Finance_Female.BP_N115_Finance_Female_C
`;

function slot(
  modelIndex: number,
  modelClassPath: string,
  x: number,
  y: number,
  yaw: number,
): BlueprintFormationSnapshot["slots"][number] {
  return {
    modelIndex,
    componentName: `ChildActorComponent_${modelIndex}_GEN_VARIABLE`,
    componentGuid: `guid-${modelIndex}`,
    modelClassPath,
    transform: {
      location: { x, y, z: 92 },
      rotation: { pitch: 0, yaw, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

describe("applyBlueprintFormation", () => {
  it("maps BP model slots to NPC identities without collapsing duplicate actors", () => {
    const database = parseDialogueDatabase(
      dialogues,
      starts,
      npcs,
      "test",
      models,
    );
    const sequence = findDialogueSequence(database, "7350");
    const snapshot: BlueprintFormationSnapshot = {
      dialogueId: "7350",
      blueprintAssetPath:
        "/Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000.BP_735000",
      blueprintClassPath:
        "/Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000.BP_735000_C",
      slots: [
        slot(0, "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C", -393, 102, -100),
        slot(1, "/Game/Seria/NPC/Unused/BP_Unused.BP_Unused_C", 239, 907, -160),
        slot(
          2,
          "/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC.BP_M63_Cityguard_NPC_C",
          -620,
          -148,
          -280,
        ),
        slot(
          3,
          "/Game/Seria/NPC/N115_Finance_Female/BP_N115_Finance_Female.BP_N115_Finance_Female_C",
          -242,
          306,
          -380,
        ),
        slot(
          4,
          "/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC.BP_M63_Cityguard_NPC_C",
          -221,
          -159,
          -280,
        ),
      ],
      warnings: [],
    };

    const applied = applyBlueprintFormation(database, sequence, snapshot);

    expect(applied.activeSlotCount).toBe(4);
    expect(applied.mappedSlotCount).toBe(4);
    expect(
      applied.sequence.participants.map((participant) => [
        participant.slot,
        participant.id,
        participant.modelIndex,
      ]),
    ).toEqual([
      ["A", 1, 0],
      ["B", 101968, 2],
      ["C", 101892, 3],
      ["D", 101968, 4],
    ]);
    expect(
      applied.sequence.rows.map((row) => [row.id, row.speakerSlot]),
    ).toEqual([
      ["735001", "D"],
      ["735002", "B"],
      ["735003", "A"],
      ["735004", "C"],
    ]);
    expect(
      applied.sequence.participants.every(
        (participant) => participant.positionSource === "blueprint",
      ),
    ).toBe(true);
    expect(() =>
      createShotPreview(applied.sequence, {
        preserveInputPositions: true,
      }),
    ).not.toThrow();
    expect(
      createDirectorInput(applied.sequence, "preserve-bp").constraints
        .preserve_input_formation,
    ).toBe(true);
    expect(
      createDirectorInput(applied.sequence, "request-ai-formation", {
        preserveInputFormation: false,
      }).constraints.preserve_input_formation,
    ).toBe(false);
    expect(
      createShotPreview(applied.sequence).sequence.participants.every(
        (participant) => participant.positionSource === "generated",
      ),
    ).toBe(true);
  });
});
