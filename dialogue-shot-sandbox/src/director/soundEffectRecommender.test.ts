import { describe, expect, it } from "vitest";
import {
  SOUND_EFFECT_CATALOG,
  SOUND_EFFECT_CATALOG_REVISION,
  SOUND_EFFECT_CATALOG_SOURCE,
  parseSoundEffectCatalogMarkdown,
} from "../data/soundEffectCatalog";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import { createDirectorInput } from "./contracts";
import {
  recommendSoundEffects,
  resolveSoundEffectRecommendations,
} from "./soundEffectRecommender";

describe("sound effect catalog", () => {
  it("keeps the usable Lark catalog locally with unique category assets", () => {
    expect(SOUND_EFFECT_CATALOG).toHaveLength(98);
    expect(
      new Set(
        SOUND_EFFECT_CATALOG.map(
          (entry) => `${entry.category}:${entry.assetName}`,
        ),
      ).size,
    ).toBe(SOUND_EFFECT_CATALOG.length);
    expect(SOUND_EFFECT_CATALOG_SOURCE).toContain(
      "THMEdPSFfocRLgxh4qkcY6cin8g",
    );
    expect(SOUND_EFFECT_CATALOG_REVISION).toBe(49);
  });

  it("parses document tables and merges duplicate category assets", () => {
    const entries = parseSoundEffectCatalogMarkdown(`
## **环境音效**
| **编号** | **资产描述** | **资产名** |
|-|-|-|
| 001 | 海浪背景。 | A_SFX_Dialog_100001 |
| 002 | 海鸥层。 | A_SFX_Dialog_100001 |
## **脚步音效**
| 001 | 暂未制作。 | 未提供 |
| 002 | 木板脚步。 | A_SFX_Dialog_100002 |
`);

    expect(entries).toEqual([
      {
        category: "environment",
        assetName: "A_SFX_Dialog_100001",
        description: "海浪背景。；海鸥层。",
      },
      {
        category: "footstep",
        assetName: "A_SFX_Dialog_100002",
        description: "木板脚步。",
      },
    ]);
  });

  it("keeps escaped Markdown table separators inside descriptions", () => {
    const entries = parseSoundEffectCatalogMarkdown(`
## **特殊音效**
| **编号** | **资产描述** | **资产名** |
|-|-|-|
| 001 | 包含 A \\| B 两层。 | A_SFX_Dialog_900001 |
`);

    expect(entries).toEqual([
      {
        category: "special",
        assetName: "A_SFX_Dialog_900001",
        description: "包含 A | B 两层。",
      },
    ]);
  });
});

describe("recommendSoundEffects", () => {
  it("recommends a matching ambient asset and a precise action cue", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const input = createDirectorInput({
      ...sequence,
      outline: "两人在海边交谈，远处海浪持续拍打沙滩。",
    });
    input.dialogue[2].content = "系统错误，警报马上就要响了。";

    const recommendations = recommendSoundEffects(input);

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dialogueId: "204801",
          assetName: "A_SFX_Dialog_521510",
        }),
        expect.objectContaining({
          dialogueId: "204803",
          assetName: "A_SFX_Dialog_516918",
        }),
      ]),
    );
  });

  it("does not force a recommendation for a vague conversational scene", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const input = createDirectorInput({
      ...sequence,
      outline: "两位角色交换意见。",
      rows: sequence.rows.map((row) => ({
        ...row,
        content: "这是没有明确环境或动作信息的普通对话。",
      })),
    });

    expect(recommendSoundEffects(input)).toEqual([]);
  });

  it("uses the AI result as-is without legacy fallback", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const input = createDirectorInput({
      ...sequence,
      outline: "两人在海边交谈。",
    });

    expect(resolveSoundEffectRecommendations(input, [])).toEqual([]);
  });

  it("validates AI recommendations against the synchronized request catalog", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const input = createDirectorInput(sequence, "runtime-catalog", {
      soundEffectCatalog: [
        {
          category: "special",
          assetName: "A_SFX_Dialog_RuntimeAdded",
          description: "运行时新增音效。",
        },
      ],
    });

    expect(
      resolveSoundEffectRecommendations(input, [
        {
          dialogue_id: "204801",
          asset_name: "A_SFX_Dialog_RuntimeAdded",
          category: "special",
          reason: "匹配运行时目录。",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        assetName: "A_SFX_Dialog_RuntimeAdded",
      }),
    ]);
    expect(() =>
      resolveSoundEffectRecommendations(input, [
        {
          dialogue_id: "204801",
          asset_name: "A_SFX_Dialog_NotInCatalog",
          category: "special",
          reason: "目录外资产。",
        },
      ]),
    ).toThrow("不在本次导演请求的资料库");
  });
});
