import type { DialogueSequence } from "../types";

export const MUSIC_BASE_TOKEN = "TxRLbFH2zalbTSsw4O3cFQUAnkb";
export const MUSIC_TABLE_ID = "tblXRZRyNviXeFSr";
export const MUSIC_ANALYSIS_TABLE_ID = "tblyINACQE4xtUGx";

export interface MusicAudioAnalysis {
  estimatedBpm: number | null;
  bpmSource: string;
  tempoConfidence: number;
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbfs: number | null;
  dynamicRangeDb: number;
  spectralCentroidHz: number;
  lowFrequencyRatio: number;
  midFrequencyRatio: number;
  highFrequencyRatio: number;
  tempoLevel: string;
  energyLevel: string;
  brightness: string;
  summary: string;
}

export interface MusicCatalogEntry {
  recordId: string;
  name: string;
  stateName: string;
  stateId: number;
  tags: string[];
  notes: string;
  fileToken: string | null;
  fileName: string | null;
  analysis?: MusicAudioAnalysis;
}

export interface MusicCatalogSnapshot {
  entries: MusicCatalogEntry[];
  revision: number;
  syncedAt: string | null;
  unmappedCount: number;
  missingAttachmentCount: number;
  analyzedCount: number;
}

export interface MusicRecommendation {
  dialogueId: string;
  stateId: number;
  stateName: string;
  musicName: string;
  reason: string;
  fileToken: string | null;
  fileName: string | null;
  recordId: string;
  audioSummary: string | null;
}

type Mood =
  | "danger"
  | "suspense"
  | "preparation"
  | "sad"
  | "happy"
  | "sincere"
  | "humour"
  | "calm";

interface MoodRule {
  mood: Mood;
  label: string;
  pattern: RegExp;
  preferred: string[];
  tags: string[];
  metadataTerms: string[];
  featureTarget: {
    bpm: number;
    lufs: number;
    centroidHz: number;
  };
}

const moodRules: MoodRule[] = [
  {
    mood: "preparation",
    label: "备战",
    pattern: /备战|准备(?:战斗|出发|行动)|制定计划|集结/,
    preferred: ["PrepareBattle01", "Bena_prepare_for_war", "Fleet_Fight_hopeful"],
    tags: ["备战7", "备战/悬疑/危机", "危险战斗"],
    metadataTerms: ["备战", "准备", "集结", "希望"],
    featureTarget: { bpm: 112, lufs: -17, centroidHz: 1_600 },
  },
  {
    mood: "danger",
    label: "危险/战斗",
    pattern: /危机爆发|危险|敌人|战斗|开战|追杀|爆炸|警报|撤退|牺牲/,
    preferred: ["Crisis_Breakout", "Fight42_hard_battle", "Hidden_Crisis_2"],
    tags: ["危险战斗", "备战/悬疑/危机"],
    metadataTerms: ["危险", "战斗", "紧张", "压迫"],
    featureTarget: { bpm: 128, lufs: -14, centroidHz: 1_900 },
  },
  {
    mood: "suspense",
    label: "悬疑",
    pattern: /真相|隐瞒|秘密|可疑|怀疑|谜|阴谋|不对劲|跟踪/,
    preferred: ["Hidden_Crisis", "Suspence", "Common_Suspence_light_60bpm_v2"],
    tags: ["备战/悬疑/危机"],
    metadataTerms: ["悬疑", "神秘", "阴谋", "危机四伏"],
    featureTarget: { bpm: 82, lufs: -22, centroidHz: 1_100 },
  },
  {
    mood: "sad",
    label: "悲伤",
    pattern: /悲伤|难过|失去|死亡|离别|孤独|对不起|遗憾|哭/,
    preferred: ["Sad", "Common_Sadness_120bpm", "LoneLiness"],
    tags: ["忧伤低落"],
    metadataTerms: ["悲伤", "忧伤", "孤独", "沉痛"],
    featureTarget: { bpm: 72, lufs: -23, centroidHz: 900 },
  },
  {
    mood: "happy",
    label: "喜悦",
    pattern: /开心|快乐|庆祝|胜利|终于成功|节日|团聚|太好了/,
    preferred: ["Happy", "Victory", "Sincere"],
    tags: ["日常轻松"],
    metadataTerms: ["快乐", "庆典", "胜利", "愉悦"],
    featureTarget: { bpm: 118, lufs: -17, centroidHz: 1_800 },
  },
  {
    mood: "humour",
    label: "幽默",
    pattern: /搞笑|荒诞|玩笑|出糗|哈哈|笨蛋|幽默/,
    preferred: ["Humour_01", "Common_Humor_2_BPM100_Without_FX"],
    tags: ["日常轻松"],
    metadataTerms: ["搞笑", "荒诞", "幽默", "滑稽"],
    featureTarget: { bpm: 108, lufs: -18, centroidHz: 2_000 },
  },
  {
    mood: "sincere",
    label: "真诚/和解",
    pattern: /相信|合作|原谅|谢谢|承诺|真诚|和解/,
    preferred: ["Sincere", "Common_01", "Forest01_Majestic_calm"],
    tags: ["日常轻松"],
    metadataTerms: ["温馨", "圆满", "和平", "感人"],
    featureTarget: { bpm: 78, lufs: -22, centroidHz: 1_100 },
  },
  {
    mood: "calm",
    label: "平静",
    pattern: /平静|安宁|日常|散步|休息|黄昏|夜晚|村庄/,
    preferred: ["Common_01", "Common_Delightful_63bpm", "Village_Dusk"],
    tags: ["日常轻松"],
    metadataTerms: ["平静", "安宁", "舒缓", "悠闲"],
    featureTarget: { bpm: 68, lufs: -24, centroidHz: 800 },
  },
];

function moodFor(text: string): MoodRule | null {
  return moodRules.find((rule) => rule.pattern.test(text)) ?? null;
}

function pickMusic(
  catalog: readonly MusicCatalogEntry[],
  rule: MoodRule,
  context: string,
): MusicCatalogEntry | null {
  const candidates = catalog.filter(
    (entry) =>
      rule.preferred.includes(entry.stateName) ||
      entry.tags.some((tag) => rule.tags.includes(tag)),
  );
  return candidates
    .map((entry) => {
      const metadata = `${entry.name} ${entry.notes}`;
      const preferredIndex = rule.preferred.indexOf(entry.stateName);
      let score =
        (preferredIndex >= 0 ? 12 - preferredIndex * 2 : 0) +
        (entry.fileToken ? 1 : 0) +
        (entry.tags.some((tag) => rule.tags.includes(tag)) ? 2 : 0);
      score += rule.metadataTerms.reduce(
        (total, term) => total +
          (metadata.includes(term) ? 1 : 0) +
          (context.includes(term) && metadata.includes(term) ? 3 : 0),
        0,
      );
      if (entry.analysis) {
        const { estimatedBpm, tempoConfidence, integratedLufs, spectralCentroidHz } =
          entry.analysis;
        if (estimatedBpm !== null && tempoConfidence >= 0.12) {
          score +=
            Math.max(
              0,
              3 - Math.abs(estimatedBpm - rule.featureTarget.bpm) / 18,
            ) * tempoConfidence;
        }
        if (integratedLufs !== null) {
          score += Math.max(
            0,
            2 - Math.abs(integratedLufs - rule.featureTarget.lufs) / 5,
          );
        }
        score += Math.max(
          0,
          1.5 -
            Math.abs(
              spectralCentroidHz - rule.featureTarget.centroidHz,
            ) /
              800,
        );
      }
      return { entry, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.stateId - right.entry.stateId,
    )[0]?.entry ?? null;
}

export function recommendMusic(
  sequence: DialogueSequence,
  catalog: readonly MusicCatalogEntry[],
  directorEmotion = "",
): MusicRecommendation[] {
  if (sequence.rows.length === 0 || catalog.length === 0) {
    return [];
  }
  const recommendations: MusicRecommendation[] = [];
  let activeMood: Mood | null = null;
  let lastSwitchIndex = -3;
  const openingContext = [
    sequence.outline,
    directorEmotion,
    ...sequence.rows.slice(0, 2).map((row) => row.content),
  ].join(" ");
  for (const [index, row] of sequence.rows.entries()) {
    const context = index === 0 ? openingContext : row.content;
    const rule = moodFor(context);
    if (!rule || rule.mood === activeMood || index - lastSwitchIndex < 2) {
      continue;
    }
    const music = pickMusic(catalog, rule, context);
    if (!music) {
      continue;
    }
    recommendations.push({
      dialogueId: row.id,
      stateId: music.stateId,
      stateName: music.stateName,
      musicName: music.name,
      reason:
        recommendations.length === 0
          ? `场景整体进入“${rule.label}”情绪，适合作为本段起始配乐。`
          : `此处情绪转折为“${rule.label}”，建议从该节点切换配乐。`,
      fileToken: music.fileToken,
      fileName: music.fileName,
      recordId: music.recordId,
      audioSummary: music.analysis?.summary ?? null,
    });
    activeMood = rule.mood;
    lastSwitchIndex = index;
    if (recommendations.length >= 4) {
      break;
    }
  }
  return recommendations;
}

export function musicPreviewUrl(recommendation: MusicRecommendation): string {
  const params = new URLSearchParams({
    recordId: recommendation.recordId,
    fileToken: recommendation.fileToken ?? "",
    fileName: recommendation.fileName ?? "music.wav",
  });
  return `/api/lark/music/file?${params.toString()}`;
}
