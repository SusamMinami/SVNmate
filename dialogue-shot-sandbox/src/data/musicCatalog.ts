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
    pattern:
      /备战|准备(?:好|战斗|出发|行动|进入|前往)?|制定计划|集结|整装|部署|分工|动身|启程|汇合|会合|目的地/,
    preferred: ["PrepareBattle01", "Bena_prepare_for_war", "Fleet_Fight_hopeful"],
    tags: ["备战7", "备战/悬疑/危机", "危险战斗"],
    metadataTerms: ["备战", "准备", "集结", "希望"],
    featureTarget: { bpm: 112, lufs: -17, centroidHz: 1_600 },
  },
  {
    mood: "danger",
    label: "危险/战斗",
    pattern:
      /危机(?:爆发)?|危险|敌人|战斗|开战|追杀|爆炸|警报|撤退|威胁|袭击|进攻|防守|防线|封锁|失守|沦陷|击毙|伤亡|遇袭|围攻|战火|冲突|压迫|紧张|警觉|感染.{0,6}(?:扩散|严重|继续|袭击)/,
    preferred: ["Crisis_Breakout", "Fight42_hard_battle", "Hidden_Crisis_2"],
    tags: ["危险战斗", "备战/悬疑/危机"],
    metadataTerms: ["危险", "战斗", "紧张", "压迫"],
    featureTarget: { bpm: 128, lufs: -14, centroidHz: 1_900 },
  },
  {
    mood: "suspense",
    label: "悬疑",
    pattern:
      /真相|隐瞒|秘密|可疑|怀疑|谜|阴谋|不对劲|跟踪|试探|回避|异常|未知|源头|调查|侦察|诱敌|身份|控制|不明|禁书|野心/,
    preferred: ["Hidden_Crisis", "Suspence", "Common_Suspence_light_60bpm_v2"],
    tags: ["备战/悬疑/危机"],
    metadataTerms: ["悬疑", "神秘", "阴谋", "危机四伏"],
    featureTarget: { bpm: 82, lufs: -22, centroidHz: 1_100 },
  },
  {
    mood: "sad",
    label: "悲伤",
    pattern:
      /悲伤|难过|失去|死亡|离别|孤独|对不起|遗憾|哭|痛苦|沉痛|哀悼|牺牲|重伤|绝望|自责|愧疚/,
    preferred: ["Sad", "Common_Sadness_120bpm", "LoneLiness"],
    tags: ["忧伤低落"],
    metadataTerms: ["悲伤", "忧伤", "孤独", "沉痛"],
    featureTarget: { bpm: 72, lufs: -23, centroidHz: 900 },
  },
  {
    mood: "happy",
    label: "喜悦",
    pattern:
      /开心|快乐|庆祝|胜利|终于成功|节日|团聚|太好了|高兴|平安|解决|成功|恢复|活下来|致敬|好消息|欢呼/,
    preferred: ["Happy", "Victory", "Sincere"],
    tags: ["日常轻松"],
    metadataTerms: ["快乐", "庆典", "胜利", "愉悦"],
    featureTarget: { bpm: 118, lufs: -17, centroidHz: 1_800 },
  },
  {
    mood: "humour",
    label: "幽默",
    pattern: /搞笑|荒诞|玩笑|出糗|哈哈|笨蛋|幽默|滑稽|调侃|戏谑|取笑/,
    preferred: ["Humour_01", "Common_Humor_2_BPM100_Without_FX"],
    tags: ["日常轻松"],
    metadataTerms: ["搞笑", "荒诞", "幽默", "滑稽"],
    featureTarget: { bpm: 108, lufs: -18, centroidHz: 2_000 },
  },
  {
    mood: "sincere",
    label: "真诚/和解",
    pattern:
      /相信|合作|原谅|谢谢|感谢|致谢|承诺|真诚|和解|欢迎|理解|认同|帮助|保护|共识|倾听|道谢|支持|信任|重返|叮嘱/,
    preferred: ["Sincere", "Common_01", "Forest01_Majestic_calm"],
    tags: ["日常轻松"],
    metadataTerms: ["温馨", "圆满", "和平", "感人"],
    featureTarget: { bpm: 78, lufs: -22, centroidHz: 1_100 },
  },
  {
    mood: "calm",
    label: "平静",
    pattern:
      /平静|安宁|日常|散步|休息|黄昏|夜晚|村庄|交谈|寒暄|会面|说明|解释|询问|接待|茶水|悠闲|安全|放松|闲聊/,
    preferred: ["Common_01", "Common_Delightful_63bpm", "Village_Dusk"],
    tags: ["日常轻松"],
    metadataTerms: ["平静", "安宁", "舒缓", "悠闲"],
    featureTarget: { bpm: 68, lufs: -24, centroidHz: 800 },
  },
];

interface WeightedMoodContext {
  text: string;
  weight: number;
}

interface MoodMatch {
  rule: MoodRule;
  score: number;
  signalCount: number;
}

function patternMatchCount(pattern: RegExp, text: string): number {
  if (!text) {
    return 0;
  }
  const matcher = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  return new Set([...text.matchAll(matcher)].map((match) => match[0])).size;
}

function dominantMood(
  contexts: readonly WeightedMoodContext[],
): MoodMatch | null {
  return moodRules
    .map((rule) => {
      let score = 0;
      let signalCount = 0;
      for (const context of contexts) {
        const matches = patternMatchCount(rule.pattern, context.text);
        score += matches * context.weight;
        signalCount += matches;
      }
      return { rule, score, signalCount };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function pickMusic(
  catalog: readonly MusicCatalogEntry[],
  rule: MoodRule,
  context: string,
): MusicCatalogEntry | null {
  const semanticCandidates = catalog.filter(
    (entry) =>
      rule.preferred.includes(entry.stateName) ||
      entry.tags.some((tag) => rule.tags.includes(tag)),
  );
  const generalCandidates = catalog.filter(
    (entry) => !entry.tags.includes("特殊"),
  );
  const candidates =
    semanticCandidates.length > 0
      ? semanticCandidates
      : generalCandidates.length > 0
        ? generalCandidates
        : catalog;
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
  const fullDialogue = sequence.rows.map((row) => row.content).join(" ");
  const openingDialogue = sequence.rows
    .slice(0, Math.min(3, sequence.rows.length))
    .map((row) => row.content)
    .join(" ");
  const overallMatch = dominantMood([
    { text: sequence.outline, weight: 3 },
    { text: directorEmotion, weight: 3 },
    { text: openingDialogue, weight: 2 },
    { text: fullDialogue, weight: 1 },
  ]);
  const fallbackRule =
    moodRules.find((rule) => rule.mood === "calm") ?? moodRules[0];
  const openingRule = overallMatch?.rule ?? fallbackRule;
  const openingContext = [
    sequence.outline,
    directorEmotion,
    fullDialogue,
  ].join(" ");
  const openingMusic = pickMusic(catalog, openingRule, openingContext);
  if (!openingMusic) {
    return [];
  }
  recommendations.push({
    dialogueId: sequence.rows[0].id,
    stateId: openingMusic.stateId,
    stateName: openingMusic.stateName,
    musicName: openingMusic.name,
    reason: overallMatch
      ? `综合剧情梗概、完整对白${directorEmotion.trim() ? "和导演情绪" : ""}，本段整体以“${openingRule.label}”为主，建议从开场使用。`
      : "未识别到明确的强情绪，建议从开场使用较克制的日常配乐。",
    fileToken: openingMusic.fileToken,
    fileName: openingMusic.fileName,
    recordId: openingMusic.recordId,
    audioSummary: openingMusic.analysis?.summary ?? null,
  });

  let activeMood: Mood = openingRule.mood;
  let lastSwitchIndex = 0;
  for (let index = 1; index < sequence.rows.length; index += 1) {
    const row = sequence.rows[index];
    const nextRow = sequence.rows[index + 1];
    const transitionMatch = dominantMood([
      { text: row.content, weight: 1 },
      { text: nextRow?.content ?? "", weight: 0.5 },
    ]);
    const currentSignalCount = transitionMatch
      ? patternMatchCount(transitionMatch.rule.pattern, row.content)
      : 0;
    if (
      !transitionMatch ||
      currentSignalCount === 0 ||
      transitionMatch.signalCount < 2 ||
      transitionMatch.rule.mood === activeMood ||
      index - lastSwitchIndex < 3
    ) {
      continue;
    }
    const music = pickMusic(
      catalog,
      transitionMatch.rule,
      `${row.content} ${nextRow?.content ?? ""}`,
    );
    if (!music) {
      continue;
    }
    recommendations.push({
      dialogueId: row.id,
      stateId: music.stateId,
      stateName: music.stateName,
      musicName: music.name,
      reason: `此处情绪转折为“${transitionMatch.rule.label}”，建议从该节点切换配乐。`,
      fileToken: music.fileToken,
      fileName: music.fileName,
      recordId: music.recordId,
      audioSummary: music.analysis?.summary ?? null,
    });
    activeMood = transitionMatch.rule.mood;
    lastSwitchIndex = index;
    if (recommendations.length >= 4) {
      break;
    }
  }
  return recommendations;
}

export function activeMusicRecommendationForDialogueIds(
  recommendations: readonly MusicRecommendation[],
  dialogueOrder: readonly string[],
  currentDialogueIds: readonly string[],
): MusicRecommendation | null {
  const orderById = new Map(
    dialogueOrder.map((dialogueId, index) => [dialogueId, index]),
  );
  const currentIndex = Math.min(
    ...currentDialogueIds
      .map((dialogueId) => orderById.get(dialogueId))
      .filter((index): index is number => index !== undefined),
  );
  if (!Number.isFinite(currentIndex)) {
    return null;
  }
  let active: MusicRecommendation | null = null;
  let activeIndex = -1;
  for (const recommendation of recommendations) {
    const recommendationIndex = orderById.get(recommendation.dialogueId);
    if (
      recommendationIndex !== undefined &&
      recommendationIndex <= currentIndex &&
      recommendationIndex >= activeIndex
    ) {
      active = recommendation;
      activeIndex = recommendationIndex;
    }
  }
  return active;
}

export function musicPreviewUrl(recommendation: MusicRecommendation): string {
  const params = new URLSearchParams({
    recordId: recommendation.recordId,
    fileToken: recommendation.fileToken ?? "",
    fileName: recommendation.fileName ?? "music.wav",
  });
  return `/api/lark/music/file?${params.toString()}`;
}
