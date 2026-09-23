import { describe, expect, it } from "vitest";
import type { MusicCatalogEntry } from "../data/musicCatalog";
import { filterMusicLibraryEntries } from "./AudioLibraryBrowser";

const entries: MusicCatalogEntry[] = [
  {
    recordId: "suspense-03",
    name: "悬疑",
    stateName: "Suspence_03",
    stateId: 124,
    tags: ["备战/悬疑/危机"],
    notes: "",
    fileToken: "file-suspense-03",
    fileName: "suspense-03.wav",
  },
  {
    recordId: "suspense-04",
    name: "悬疑_2",
    stateName: "Suspence_04",
    stateId: 125,
    tags: ["备战/悬疑/危机"],
    notes: "",
    fileToken: "file-suspense-04",
    fileName: "suspense-04.wav",
    analysis: {
      estimatedBpm: 76,
      bpmSource: "音频估算",
      tempoConfidence: 0.3,
      integratedLufs: -13.7,
      loudnessRangeLu: 5.7,
      truePeakDbfs: -3,
      dynamicRangeDb: 10.5,
      spectralCentroidHz: 564,
      lowFrequencyRatio: 0.91,
      midFrequencyRatio: 0.08,
      highFrequencyRatio: 0.01,
      tempoLevel: "慢",
      energyLevel: "高",
      brightness: "偏暗",
      summary: "慢速、高能量、音色偏暗",
      recommendedUse: "叙事功能：悬疑调查、信息揭示",
      semanticProfile: {
        schemaVersion: "music-semantic-profile.v3",
        narrativeFunctions: ["悬疑调查", "信息揭示"],
        moods: ["神秘"],
        valence: 0,
        arousal: 0.8,
        tension: 0.6,
        intensityTrajectory: "平稳",
        entryMode: "立即进入",
        dialogueFit: "中",
        specialUseOnly: false,
        confidence: 0.7,
      },
    },
  },
  {
    recordId: "common-01",
    name: "情绪-日常01",
    stateName: "Common_01",
    stateId: 19,
    tags: ["日常轻松"],
    notes: "温和舒缓",
    fileToken: "file-common-01",
    fileName: "common-01.wav",
  },
];

describe("filterMusicLibraryEntries", () => {
  it("searches the full catalog instead of intersecting the selected category", () => {
    expect(
      filterMusicLibraryEntries(entries, "日常轻松", "悬疑").map(
        (entry) => entry.name,
      ),
    ).toEqual(["悬疑", "悬疑_2"]);
  });

  it("normalizes full-width text, punctuation and underscores", () => {
    expect(
      filterMusicLibraryEntries(entries, null, "Ｓｕｓｐｅｎｃｅ＿０４").map(
        (entry) => entry.name,
      ),
    ).toEqual(["悬疑_2"]);
    expect(
      filterMusicLibraryEntries(entries, null, "悬疑 2").map(
        (entry) => entry.name,
      ),
    ).toEqual(["悬疑_2"]);
  });

  it("searches v3 semantic fields and keeps category browsing unchanged", () => {
    expect(
      filterMusicLibraryEntries(entries, null, "信息揭示").map(
        (entry) => entry.name,
      ),
    ).toEqual(["悬疑_2"]);
    expect(
      filterMusicLibraryEntries(entries, "日常轻松", "").map(
        (entry) => entry.name,
      ),
    ).toEqual(["情绪-日常01"]);
  });
});
