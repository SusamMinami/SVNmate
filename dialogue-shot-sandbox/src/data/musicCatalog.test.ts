import { describe, expect, it } from "vitest";
import { demoDatabase } from "./demo";
import { findDialogueSequence } from "./dialogueRepository";
import {
  activeMusicRecommendationForDialogueIds,
  musicRecommendationsFromCues,
  recommendMusic,
  shortlistMusicCatalog,
  type MusicAudioAnalysis,
  type MusicCatalogEntry,
  type MusicRecommendation,
} from "./musicCatalog";

function audioAnalysis(
  overrides: Partial<MusicAudioAnalysis>,
): MusicAudioAnalysis {
  return {
    estimatedBpm: 90,
    bpmSource: "音频估算",
    tempoConfidence: 0.8,
    integratedLufs: -20,
    loudnessRangeLu: 6,
    truePeakDbfs: -1,
    dynamicRangeDb: 10,
    spectralCentroidHz: 1_200,
    lowFrequencyRatio: 0.3,
    midFrequencyRatio: 0.5,
    highFrequencyRatio: 0.2,
    tempoLevel: "中",
    energyLevel: "中",
    brightness: "均衡",
    summary: "中速、中能量、音色均衡",
    ...overrides,
  };
}

const catalog: MusicCatalogEntry[] = [
  {
    recordId: "rec1",
    name: "危机",
    stateName: "Crisis_Breakout",
    stateId: 13,
    tags: ["危险战斗"],
    notes: "非常危险，已经在战斗",
    fileToken: "f1",
    fileName: "danger.wav",
  },
  {
    recordId: "rec2",
    name: "真诚",
    stateName: "Sincere",
    stateId: 18,
    tags: ["日常轻松"],
    notes: "温馨圆满",
    fileToken: "f2",
    fileName: "sincere.wav",
  },
  {
    recordId: "rec3",
    name: "危机四伏",
    stateName: "Hidden_Crisis",
    stateId: 15,
    tags: ["备战/悬疑/危机"],
    notes: "悬疑，逐渐危险",
    fileToken: "f3",
    fileName: "suspense.wav",
  },
  {
    recordId: "rec4",
    name: "备战",
    stateName: "PrepareBattle01",
    stateId: 126,
    tags: ["危险战斗"],
    notes: "准备战斗",
    fileToken: "f4",
    fileName: "prepare.wav",
  },
];

describe("recommendMusic", () => {
  it("switches music when dialogue emotion turns", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    sequence.rows[0].content = "敌人来了，我们有危险。";
    sequence.rows[3].content = "我愿意相信你，我们合作吧。";

    expect(recommendMusic(sequence, catalog)).toEqual([
      expect.objectContaining({
        dialogueId: "204801",
        stateId: 13,
        reason: expect.stringContaining("危险/战斗"),
      }),
      expect.objectContaining({
        dialogueId: "204804",
        stateId: 18,
        reason: expect.stringContaining("真诚/和解"),
      }),
    ]);
  });

  it("uses director emotion context for the opening recommendation", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    sequence.outline = "两人在房间中交谈。";
    sequence.rows.forEach((row) => {
      row.content = "继续说。";
    });

    expect(
      recommendMusic(sequence, catalog, "秘密逐渐暴露，真相仍被隐瞒"),
    ).toEqual([
      expect.objectContaining({
        dialogueId: "204801",
        stateId: 15,
        reason: expect.stringContaining("悬疑"),
      }),
    ]);
  });

  it("distinguishes preparation from an active battle", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    sequence.outline = "";
    sequence.rows[0].content = "所有人集结，准备战斗。";

    expect(recommendMusic(sequence, catalog)[0]).toMatchObject({
      dialogueId: "204801",
      stateId: 126,
    });
  });

  it("uses cached audio features to rank semantic fallback candidates", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    sequence.outline = "平静的夜晚，众人安宁地休息。";
    sequence.rows.forEach((row) => {
      row.content = "继续说。";
    });
    const candidates: MusicCatalogEntry[] = [
      {
        recordId: "recFast",
        name: "候选快歌",
        stateName: "Calm_Fast",
        stateId: 201,
        tags: ["日常轻松"],
        notes: "",
        fileToken: "fast",
        fileName: "fast.wav",
        analysis: audioAnalysis({
          estimatedBpm: 140,
          integratedLufs: -12,
          spectralCentroidHz: 2_800,
        }),
      },
      {
        recordId: "recSlow",
        name: "候选慢歌",
        stateName: "Calm_Slow",
        stateId: 202,
        tags: ["日常轻松"],
        notes: "",
        fileToken: "slow",
        fileName: "slow.wav",
        analysis: audioAnalysis({
          estimatedBpm: 68,
          integratedLufs: -24,
          spectralCentroidHz: 800,
          summary: "慢速、低能量、音色偏暗",
        }),
      },
    ];

    expect(recommendMusic(sequence, candidates)[0]).toMatchObject({
      stateId: 202,
      audioSummary: "慢速、低能量、音色偏暗",
    });
  });

  it("uses the complete dialogue to choose music from the opening node", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    sequence.outline = "";
    sequence.rows.forEach((row) => {
      row.content = "继续交流。";
    });
    sequence.rows[5].content = "这个秘密的源头仍然未知。";

    expect(recommendMusic(sequence, catalog)[0]).toMatchObject({
      dialogueId: "204801",
      stateId: 15,
      reason: expect.stringContaining("完整对白"),
    });
  });

  it("falls back to restrained everyday music when no mood signal matches", () => {
    const sequence = findDialogueSequence(demoDatabase, "2048");
    sequence.outline = "双方核对了一份清单。";
    sequence.rows.forEach((row) => {
      row.content = "下一项。";
    });
    const neutralMusic: MusicCatalogEntry = {
      recordId: "recNeutral",
      name: "情绪-日常01",
      stateName: "Common_01",
      stateId: 19,
      tags: ["日常轻松"],
      notes: "温和舒缓",
      fileToken: "neutral",
      fileName: "neutral.wav",
    };

    expect(recommendMusic(sequence, [neutralMusic])).toEqual([
      expect.objectContaining({
        dialogueId: "204801",
        stateId: 19,
        reason: expect.stringContaining("未识别到明确的强情绪"),
      }),
    ]);
  });

  it("resolves the music being carried by a later shot", () => {
    const recommendations: MusicRecommendation[] = [
      {
        dialogueId: "204801",
        stateId: 15,
        stateName: "Hidden_Crisis",
        musicName: "危机四伏",
        reason: "开场配乐",
        fileToken: "f3",
        fileName: "suspense.wav",
        recordId: "rec3",
        audioSummary: null,
      },
      {
        dialogueId: "204804",
        stateId: 18,
        stateName: "Sincere",
        musicName: "真诚",
        reason: "转折配乐",
        fileToken: "f2",
        fileName: "sincere.wav",
        recordId: "rec2",
        audioSummary: null,
      },
    ];
    const order = [
      "204801",
      "204802",
      "204803",
      "204804",
      "204805",
    ];

    expect(
      activeMusicRecommendationForDialogueIds(
        recommendations,
        order,
        ["204803"],
      )?.stateName,
    ).toBe("Hidden_Crisis");
    expect(
      activeMusicRecommendationForDialogueIds(
        recommendations,
        order,
        ["204805"],
      )?.stateName,
    ).toBe("Sincere");
  });
});

describe("shortlistMusicCatalog", () => {
  it("keeps the semantic match and current music while bounding model input", () => {
    const generic = Array.from({ length: 20 }, (_, index) => ({
      recordId: `generic-${index}`,
      name: `普通候选${index}`,
      stateName: `Generic_${index}`,
      stateId: 300 + index,
      tags: ["日常轻松"],
      notes: "普通场景音乐",
      fileToken: `generic-file-${index}`,
      fileName: `generic-${index}.wav`,
    } satisfies MusicCatalogEntry));
    const suspense = {
      recordId: "semantic-suspense",
      name: "暗线浮现",
      stateName: "Semantic_Suspense",
      stateId: 401,
      tags: ["备战/悬疑/危机"],
      notes: "真相逐步显露",
      fileToken: "semantic-suspense-file",
      fileName: "semantic-suspense.wav",
      analysis: {
        ...audioAnalysis({}),
        recommendedUse: "叙事功能：悬疑调查；情绪：神秘、暗涌",
        semanticProfile: {
          schemaVersion: "music-semantic-profile.v3",
          narrativeFunctions: ["悬疑调查", "信息揭示"],
          moods: ["神秘", "暗涌"],
          valence: -0.3,
          arousal: 0.4,
          tension: 0.8,
          intensityTrajectory: "渐强",
          entryMode: "慢铺垫",
          dialogueFit: "高",
          specialUseOnly: false,
          confidence: 0.9,
        },
      },
    } satisfies MusicCatalogEntry;
    const currentSpecial = {
      recordId: "current-special",
      name: "当前角色主题",
      stateName: "Current_Theme",
      stateId: 499,
      tags: ["特殊"],
      notes: "角色主题曲",
      fileToken: "current-special-file",
      fileName: "current-special.wav",
    } satisfies MusicCatalogEntry;

    const shortlist = shortlistMusicCatalog(
      [...generic, suspense, currentSpecial],
      {
        outline: "调查隐藏的秘密，真相逐步显露。",
        dialogue: [{ content: "这里一定还有我们不知道的线索。" }],
      },
      [currentSpecial.stateId],
    );

    expect(shortlist).toHaveLength(12);
    expect(shortlist[0].stateId).toBe(currentSpecial.stateId);
    expect(shortlist.some((entry) => entry.stateId === suspense.stateId)).toBe(
      true,
    );
  });
});

describe("musicRecommendationsFromCues", () => {
  it("maps valid model cues and marks replacements", () => {
    expect(
      musicRecommendationsFromCues(
        [
          {
            dialogueId: "204804",
            stateId: 18,
            reason: "关系缓和，建议切换到更真诚的配乐。",
          },
        ],
        catalog,
        [{ dialogueId: "204804", stateId: 13 }],
      ),
    ).toEqual([
      expect.objectContaining({
        dialogueId: "204804",
        stateId: 18,
        source: "rule-advisor",
        replacesStateId: 13,
      }),
    ]);
  });

  it("drops duplicate, unchanged and unknown model cues", () => {
    expect(
      musicRecommendationsFromCues(
        [
          { dialogueId: "204801", stateId: 13, reason: "保持当前。" },
          { dialogueId: "204801", stateId: 18, reason: "重复节点。" },
          { dialogueId: "204802", stateId: 999, reason: "目录外。" },
        ],
        catalog,
        [{ dialogueId: "204801", stateId: 13 }],
      ),
    ).toEqual([]);
  });
});
