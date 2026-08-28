import { describe, expect, it } from "vitest";
import { demoDatabase } from "./demo";
import { findDialogueSequence } from "./dialogueRepository";
import {
  recommendMusic,
  type MusicAudioAnalysis,
  type MusicCatalogEntry,
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
});
