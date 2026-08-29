import { describe, expect, it } from "vitest";
import type { BlueprintFormationSnapshot } from "../types";
import { participantFacingYawDegrees } from "../director/actorActionPlanner";
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
    expect(
      applied.sequence.participants.map(participantFacingYawDegrees),
    ).toEqual([-100, -280, -380, -280].map((yaw) =>
      ((yaw + 180) % 360 + 360) % 360 - 180
    ));
    expect(() =>
      createShotPreview(applied.sequence, {
        preserveInputPositions: true,
      }),
    ).not.toThrow();
    const flexiblePlayerPreview = createShotPreview(applied.sequence, {
      preserveInputPositions: true,
      lockPlayerPosition: false,
    });
    expect(flexiblePlayerPreview.sequence.participants[0].position).not.toEqual(
      applied.sequence.participants[0].position,
    );
    expect(
      flexiblePlayerPreview.sequence.participants
        .slice(1)
        .map((participant) => participant.position),
    ).toEqual(
      applied.sequence.participants
        .slice(1)
        .map((participant) => participant.position),
    );
    expect(
      flexiblePlayerPreview.sequence.participants.every(
        (participant) => participant.positionSource === "blueprint",
      ),
    ).toBe(true);
    expect(
      createDirectorInput(applied.sequence, "preserve-bp").constraints
        .preserve_input_formation,
    ).toBe(true);
    expect(
      createDirectorInput(applied.sequence, "flexible-player", {
        preserveInputFormation: true,
        lockPlayerPosition: false,
      }).constraints,
    ).toMatchObject({
      preserve_input_formation: true,
      lock_player_position: false,
    });
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

  it("keeps silent BP slots as background while directing only the speaker", () => {
    const database = parseDialogueDatabase(
      dialogues,
      starts,
      npcs,
      "test",
      models,
    );
    const source = findDialogueSequence(database, "7350");
    const silentSequence = {
      ...source,
      rows: source.rows.filter((row) => row.npcId === 101968),
      participants: source.participants.filter(
        (participant) => participant.id === 101968,
      ),
    };
    const snapshot: BlueprintFormationSnapshot = {
      dialogueId: "7350",
      blueprintAssetPath:
        "/Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000.BP_735000",
      blueprintClassPath:
        "/Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000.BP_735000_C",
      dialogueModels: [
        "player",
        "N115_Finance_Female",
        "M63_Cityguard",
      ],
      slots: [
        slot(
          0,
          "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
          155,
          -24,
          160,
        ),
        slot(
          1,
          "/Game/Seria/NPC/N115_Finance_Female/BP_N115_Finance_Female.BP_N115_Finance_Female_C",
          27,
          -24,
          60,
        ),
        slot(
          2,
          "/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC.BP_M63_Cityguard_NPC_C",
          34,
          82,
          -43,
        ),
      ],
      warnings: [],
    };

    const applied = applyBlueprintFormation(
      database,
      silentSequence,
      snapshot,
    );

    expect(
      applied.sequence.participants.map((participant) => ({
        modelIndex: participant.modelIndex,
        npcId: participant.id,
        yaw: participantFacingYawDegrees(participant),
      })),
    ).toEqual([
      { modelIndex: 0, npcId: 1, yaw: 160 },
      { modelIndex: 1, npcId: 101892, yaw: 60 },
      { modelIndex: 2, npcId: 101968, yaw: -43 },
    ]);
    expect(applied.sequence.rows.every((row) => row.speakerSlot === "C")).toBe(
      true,
    );
    const input = createDirectorInput(applied.sequence, "background-role-test");
    expect(
      input.participants.map((participant) => [
        participant.slot,
        participant.role,
      ]),
    ).toEqual([
      ["A", "background"],
      ["B", "background"],
      ["C", "dialogue"],
    ]);

    const preview = createShotPreview(applied.sequence, {
      preserveInputPositions: true,
    });
    expect(
      preview.shots.every((shot) => shot.visualSubjectSlot === "C"),
    ).toBe(true);
    expect(preview.shots.every((shot) => shot.axis.id === "C-look")).toBe(
      true,
    );
    expect(preview.sequence.participants).toHaveLength(3);
  });

  it("keeps dialogue NPC models before backgrounds when a reused BP exceeds the cast limit", () => {
    const database = parseDialogueDatabase(
      [
        "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
        "##对话ID,人物,内容,下一ID,结束",
        "736800,,,736801,false",
        "736801,102101,伊姆说话,736802,false",
        "736802,1,玩家说话,736803,false",
        "736803,102157,海琳娜说话,,true",
      ].join("\n"),
      [
        "##&DialogStart.id,DialogStart.Outline,DialogStart.Formation,DialogStart.Model",
        "##对话ID,剧情梗概,模板,模型",
        "736800,复用大型场景 BP,/Game/Test/BP_736700.BP_736700_C,player",
      ].join("\n"),
      [
        "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
        "##id,名称,介绍,资源",
        "1,玩家,玩家,",
        "102101,伊姆,士兵,200526",
        "102157,海琳娜,士官,200540",
      ].join("\n"),
      "test",
      [
        "##&Model.id,,Model.path",
        "##id,配置填写在此列，Model.path保存时自动生成，由程序调用,生成路径",
        "200526,/Game/Test/BP_Im,/Game/Test/BP_Im.BP_Im_C",
        "200540,/Game/Test/BP_Helena,/Game/Test/BP_Helena.BP_Helena_C",
      ].join("\n"),
    );
    const sequence = findDialogueSequence(database, "7368");
    const dialogueModels = Array.from(
      { length: 21 },
      (_, index) => index === 0 ? "player" : `Background_${index}`,
    );
    dialogueModels[13] = "Im";
    dialogueModels[14] = "Helena";
    const snapshot: BlueprintFormationSnapshot = {
      dialogueId: "7368",
      blueprintAssetPath: "/Game/Test/BP_736700.BP_736700",
      blueprintClassPath: "/Game/Test/BP_736700.BP_736700_C",
      slots: [
        slot(0, "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C", 0, 0, 0),
        ...Array.from({ length: 12 }, (_, index) =>
          slot(
            index + 1,
            `/Game/Test/BP_Background_${index + 1}.BP_Background_${index + 1}_C`,
            index * 100,
            1_000,
            0,
          ),
        ),
        slot(13, "/Game/Test/BP_Im.BP_Im_C", 0, 1_200, 0),
        slot(14, "/Game/Test/BP_Helena.BP_Helena_C", 100, 1_200, 180),
        ...Array.from({ length: 6 }, (_, index) =>
          slot(
            index + 15,
            `/Game/Test/BP_Extra_${index + 15}.BP_Extra_${index + 15}_C`,
            2_000 + index * 100,
            2_000,
            0,
          ),
        ),
      ],
      dialogueModels,
      warnings: [],
    };

    const applied = applyBlueprintFormation(database, sequence, snapshot);
    const participantsBySlot = new Map(
      applied.sequence.participants.map((participant) => [
        participant.slot,
        participant,
      ]),
    );

    expect(applied.activeSlotCount).toBe(21);
    expect(applied.mappedSlotCount).toBe(12);
    expect(
      applied.sequence.participants
        .filter((participant) => [1, 102101, 102157].includes(participant.id))
        .map((participant) => [participant.id, participant.modelIndex]),
    ).toEqual([
      [1, 0],
      [102101, 13],
      [102157, 14],
    ]);
    expect(
      applied.sequence.rows.map((row) => [
        row.npcId,
        row.speakerSlot === null
          ? null
          : participantsBySlot.get(row.speakerSlot)?.id,
      ]),
    ).toEqual([
      [102101, 102101],
      [1, 1],
      [102157, 102157],
    ]);
    expect(applied.sequence.warnings).toContain(
      "BP 有 21 个有效角色槽，已优先保留 3 个对话角色槽和距离最近的 9 个背景槽；省略 9 个背景槽",
    );
  });

  it("rejects a BP when a dialogue NPC has no model-compatible slot", () => {
    const database = parseDialogueDatabase(
      [
        "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
        "##对话ID,人物,内容,下一ID,结束",
        "880000,,,880001,false",
        "880001,102101,伊姆说话,,true",
      ].join("\n"),
      [
        "##&DialogStart.id,DialogStart.Outline,DialogStart.Formation,DialogStart.Model",
        "##对话ID,剧情梗概,模板,模型",
        "880000,错误模型,/Game/Test/BP_Wrong.BP_Wrong_C,player;Wrong",
      ].join("\n"),
      [
        "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
        "##id,名称,介绍,资源",
        "1,玩家,玩家,",
        "102101,伊姆,士兵,200526",
      ].join("\n"),
      "test",
      [
        "##&Model.id,,Model.path",
        "##id,配置填写在此列，Model.path保存时自动生成，由程序调用,生成路径",
        "200526,/Game/Test/BP_Im,/Game/Test/BP_Im.BP_Im_C",
      ].join("\n"),
    );
    const sequence = findDialogueSequence(database, "8800");
    const snapshot: BlueprintFormationSnapshot = {
      dialogueId: "8800",
      blueprintAssetPath: "/Game/Test/BP_Wrong.BP_Wrong",
      blueprintClassPath: "/Game/Test/BP_Wrong.BP_Wrong_C",
      slots: [
        slot(0, "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C", 0, 0, 0),
        slot(1, "/Game/Test/BP_WrongActor.BP_WrongActor_C", 100, 0, 180),
      ],
      dialogueModels: ["player", "Wrong"],
      warnings: [],
    };

    expect(() =>
      applyBlueprintFormation(database, sequence, snapshot),
    ).toThrow("BP 未找到与对话 NPC 伊姆（102101）模型一致的角色槽");
  });

  it("rejects an explicit AM_Talk slot whose model belongs to another NPC", () => {
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
      blueprintAssetPath: "/Game/Test/BP_735000.BP_735000",
      blueprintClassPath: "/Game/Test/BP_735000.BP_735000_C",
      slots: [
        slot(0, "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C", 0, 0, 0),
        slot(
          2,
          "/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC.BP_M63_Cityguard_NPC_C",
          0,
          100,
          0,
        ),
        slot(
          3,
          "/Game/Seria/NPC/N115_Finance_Female/BP_N115_Finance_Female.BP_N115_Finance_Female_C",
          100,
          100,
          0,
        ),
        slot(4, "/Game/Test/BP_WrongActor.BP_WrongActor_C", 200, 100, 0),
      ],
      dialogueModels: ["player", "None", "M63_Cityguard", "N115", "Wrong"],
      warnings: [],
    };

    expect(() =>
      applyBlueprintFormation(database, sequence, snapshot),
    ).toThrow("与 AM_Talk 指向的 BP 槽位 4 模型不一致");
  });

});
