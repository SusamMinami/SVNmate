export const SOUND_EFFECT_CATALOG_SOURCE =
  "https://bytedance.larkoffice.com/docx/THMEdPSFfocRLgxh4qkcY6cin8g";
export const SOUND_EFFECT_LIBRARY_URL =
  "https://mira.byteintl.net/share/53837818131_1771919353619";
export const SOUND_EFFECT_CATALOG_REVISION = 49;
export const MAX_SOUND_EFFECT_CATALOG_ENTRIES = 128;

export const SOUND_EFFECT_CATEGORIES = [
  "environment",
  "footstep",
  "action",
  "special",
] as const;

export type SoundEffectCategory = (typeof SOUND_EFFECT_CATEGORIES)[number];

export interface SoundEffectCatalogEntry {
  category: SoundEffectCategory;
  assetName: string;
  description: string;
}

export interface SoundEffectCatalogSnapshot {
  entries: SoundEffectCatalogEntry[];
  sourceUrl: string;
  libraryUrl: string;
  revisionId: number;
  syncedAt: string | null;
  source: "bundled" | "lark";
}

export const SOUND_EFFECT_CATEGORY_LABELS: Record<
  SoundEffectCategory,
  string
> = {
  environment: "环境",
  footstep: "脚步",
  action: "动作",
  special: "特殊",
};

export const SOUND_EFFECT_CATALOG: readonly SoundEffectCatalogEntry[] = [
  {
    category: "environment",
    assetName: "A_SFX_Dialog_516301",
    description: "工人围着经理争吵，包含金属敲击和拍打，可覆盖约 25 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_516314",
    description: "抱箱子的工人移动，营造熙熙攘攘的感觉，约 8 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_516416",
    description: "大型机械运作和机器头旋转，带齿轮、能量低频及环境混响。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_730401",
    description: "大型设备工作时的持续嗡鸣背景，约 20 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_517702",
    description: "劣化工人散发辐射时的非人呼吸声，约 8 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_719600",
    description: "团圆饭中的进食、杯子和碟子碰撞声。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_514918",
    description: "演出结束后的群众欢呼、鼓掌和口哨。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_729600",
    description: "敌群人声、无人机和武器准备攻击的混合氛围。",
  },
  {
    category: "environment",
    assetName: "A_SFX_FB_6015_03",
    description: "慌张人群、繁杂脚步、金属摩擦和重物拖拽。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_518314",
    description: "空艇飞行中的空气、风噪和螺旋桨室内环境声。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_518315",
    description: "飞艇引擎启动及螺旋桨转动，包含室内 EQ。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_518320",
    description: "工业区大型排气扇转动，带环境混响。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_522902",
    description: "小型空艇从镜头前飞过，约 10 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_522901",
    description: "热闹空港的人群与巨型战舰缓慢螺旋桨，约 25 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_522224",
    description: "空港中熙攘的冒险者人群，约 12 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_522201",
    description: "空艇群穿梭、破风震动及大型螺旋桨启动，约 18 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_522213",
    description: "出发演讲背景中的螺旋桨、小艇飞过和轻微人群议论。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_522218",
    description: "来往人群脚步与背景空艇飞过，约 6 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_522221",
    description: "来往人群脚步与背景空艇飞过，不含机器人重复音效。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_521510",
    description: "海浪拍打沙滩的对话背景环境声，约 30 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_521516",
    description: "较强海浪、海鸥、风和树叶摇曳，缓入缓出，约 14 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_521357",
    description: "室外露天餐吧或集市中的餐厅人群交谈，约 30 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_521601",
    description: "顾客退款闹事和表达不满的人群声，约 20 秒。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_521509",
    description: "较明显的海鸥叫声，约 4 秒。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_518007",
    description: "老人和机器人一起散步时的老年脚步声。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_516327",
    description: "工人走近，包含金属件、布料摩擦和雪地脚步，约 6 秒。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_516328",
    description: "经理从右侧悄悄离开，雪地皮鞋声由近到远。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_516730",
    description: "工人一瘸一拐离场，皮鞋踩铁地板并带环境混响。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_718700",
    description: "四个孩子凌乱跑开的脚步，可带无语义喊叫。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_728400",
    description: "偷听者快速离开，包含衣物、桌椅和玻璃碰撞。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_728801",
    description: "敌人撤退的纷乱脚步、金属拖地和远离混响。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_729400",
    description: "敌人先狞笑再靠近，包含武器晃动和多人脚步。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_729500",
    description: "女性高跟鞋走近的脚步声，约 4 秒。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_729701",
    description: "四名警察穿靴走近，包含手铐金属声，约 8 秒。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_729702",
    description: "警察羁押罪犯并离去的黑幕表现。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_514920",
    description: "两人走回舞台、调整麦克风及轻微啸叫。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_518316",
    description: "军靴踩在通风管道铁网上的脚步声。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_522201",
    description: "冒险者朝目标聚集的多人脚步，约 8 秒。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_521352",
    description: "拖鞋踩木地板并逐渐靠近，约 4 秒。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_521353",
    description: "拖鞋踩木地板并向右离画，约 8 秒。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_521501",
    description: "玩家从右侧沙滩入画的脚步，约 6 秒。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_521345",
    description: "角色穿拖鞋在木板上快速跑开，约 3 秒。",
  },
  {
    category: "action",
    assetName: "A_SFX_FB_6015_02",
    description: "远处多人收拾和拖拽重物，带金属撞击及繁杂脚步。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516148",
    description: "安塞尔或小型机械臂执行扫描，包含旋转齿轮和激光。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_N86_AM_Idle1",
    description: "N86 Idle1 动作音效，建议降低至 50%。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_N86_AM_Idle2",
    description: "N86 Idle2 动作音效，建议降低至 50%。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_N86_AM_Idle3",
    description: "N86 Idle3 动作音效，建议降低至 50%。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_N86_AM_Idle4",
    description: "N86 Idle4 动作音效，建议降低至 50%。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_N86_AM_Talk",
    description: "N86 Talk 动作音效，建议降低至 60%。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516303",
    description: "工人不耐烦地活动关节，包含金属件和布料摩擦。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516114",
    description: "大型设备使用能量激光扫描。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516114_2",
    description: "大型空间内使用的能量激光扫描混响版。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516419",
    description: "电钻拆螺丝、打开金属盖并取出大型电池。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_730404",
    description: "交互后大型设备停止运作，带环境混响。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_517203",
    description: "机械臂被入侵后的电子干扰和齿轮失控。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_517204",
    description: "大型设备突然快速重启，带环境混响。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516906",
    description: "机器人喷气进入并着陆。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516901",
    description: "机器人蓄能准备攻击。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_518002",
    description: "机器人胳膊与机器脸的部件碰撞摩擦。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_718500",
    description: "在衣服口袋中摸索、翻找和掏取物品。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_719000",
    description: "快速翻动几十页书。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_719700",
    description: "刷子和粉扑在脸上移动的化妆声。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_728700",
    description: "多人纷纷抽出武器准备战斗。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_728800",
    description: "敌人战败后的短促呻吟、撤退脚步和金属落地。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_729700",
    description: "搜身并找出一封信。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_513901",
    description: "手持调整麦克风时的啸叫和噪音。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_728412",
    description: "女性急促呼吸并逐渐平静，约 5 秒。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_519907",
    description: "飞艇启动引擎、起飞并离开。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_518318",
    description: "拉动重型闸门时的金属摩擦。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_521341",
    description: "烤得不错时的奖励提示音，约 3 秒。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_521342",
    description: "烤得非常好时的奖励提示音，约 3 秒。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_521340",
    description: "烧烤结果很差时的惩罚提示音，约 3 秒。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_523612",
    description: "金币或金钱洒落，约 3 秒。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_521505",
    description: "远处爆炸，约 3 秒。",
  },
  {
    category: "special",
    assetName: "A_SFX_FB_6015_01",
    description: "感应器与卡牌发生反应时的三声哔哔提示。",
  },
  {
    category: "special",
    assetName: "A_SFX_FB_1220099005",
    description: "L-12 语音 1220099005。",
  },
  {
    category: "special",
    assetName: "A_SFX_FB_1220099007",
    description: "L-12 语音 1220099007。",
  },
  {
    category: "special",
    assetName: "A_SFX_FB_1220099014",
    description: "L-12 语音 1220099014。",
  },
  {
    category: "special",
    assetName: "A_SFX_FB_1220099023",
    description: "L-12 语音 1220099023。",
  },
  {
    category: "special",
    assetName: "A_SFX_FB_1220099024",
    description: "L-12 语音 1220099024。",
  },
  {
    category: "special",
    assetName: "A_SFX_FB_1220099029",
    description: "L-12 语音 1220099029。",
  },
  {
    category: "special",
    assetName: "A_SFX_FB_1220099037",
    description: "L-12 语音 1220099037。",
  },
  {
    category: "special",
    assetName: "A_SFX_FB_1220099044",
    description: "L-12 语音 1220099044。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_516918",
    description: "系统错误时突然响起的报警声，带环境混响。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_914300",
    description: "物质信息释放时的蓄力和突然加速，适合黑场字幕。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_914400",
    description: "时间快速倒放和流逝，适合黑场字幕。",
  },
  {
    category: "special",
    assetName: "A_SFX_NewYear_Firework_01",
    description: "春节活动道具和任务燃放烟花。",
  },
  {
    category: "special",
    assetName: "A_SFX_NewYear_Firework_02",
    description: "道具燃放烟花的变化版本 02。",
  },
  {
    category: "special",
    assetName: "A_SFX_NewYear_Firework_03",
    description: "道具燃放烟花的变化版本 03。",
  },
  {
    category: "special",
    assetName: "A_SFX_NewYear_Firework_04",
    description: "道具燃放烟花的变化版本 04。",
  },
  {
    category: "special",
    assetName: "A_SFX_NewYear_Firework_05",
    description: "道具燃放烟花的变化版本 05。",
  },
  {
    category: "special",
    assetName: "A_SFX_NewYear_Firework_06",
    description: "道具燃放烟花的变化版本 06。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_513900",
    description: "冒险者协会徽章从不亮到发光时的震动和魔法效果。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_520022",
    description: "安塞尔向 L-12 传输数据并混合背景低声交谈。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_518317",
    description: "获取权限卡时的清脆电子提示音。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_518319",
    description: "全息影像消失并伴随轻微电流声。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_522312",
    description: "头疼时较明显的耳鸣，约 3 秒。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_522311",
    description: "头疼时较轻微且节奏不同的耳鸣，约 3 秒。",
  },
] as const;

export function soundEffectCatalogForDirector(): Array<{
  category: SoundEffectCategory;
  asset_name: string;
  description: string;
}>;
export function soundEffectCatalogForDirector(
  entries: readonly SoundEffectCatalogEntry[],
): Array<{
  category: SoundEffectCategory;
  asset_name: string;
  description: string;
}>;
export function soundEffectCatalogForDirector(
  entries: readonly SoundEffectCatalogEntry[] = SOUND_EFFECT_CATALOG,
): Array<{
  category: SoundEffectCategory;
  asset_name: string;
  description: string;
}> {
  return entries.map((entry) => ({
    category: entry.category,
    asset_name: entry.assetName,
    description: entry.description,
  }));
}

const markdownCategoryByTitle: Record<string, SoundEffectCategory> = {
  环境音效: "environment",
  脚步音效: "footstep",
  动作音效: "action",
  特殊音效: "special",
};

function cleanMarkdownCell(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\*\*/g, "")
    .replace(/\\([\\|`*_{}\[\]()#+.!-])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function splitMarkdownTableRow(line: string): string[] {
  const content = line.slice(1, line.endsWith("|") ? -1 : undefined);
  const cells: string[] = [];
  let current = "";
  let precedingBackslashes = 0;
  for (const character of content) {
    if (character === "|" && precedingBackslashes % 2 === 0) {
      cells.push(cleanMarkdownCell(current));
      current = "";
      precedingBackslashes = 0;
      continue;
    }
    current += character;
    precedingBackslashes =
      character === "\\" ? precedingBackslashes + 1 : 0;
  }
  cells.push(cleanMarkdownCell(current));
  return cells;
}

export function parseSoundEffectCatalogMarkdown(
  markdown: string,
): SoundEffectCatalogEntry[] {
  let category: SoundEffectCategory | null = null;
  const entries = new Map<string, SoundEffectCatalogEntry>();
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("#")) {
      const title = cleanMarkdownCell(line.replace(/^#+\s*/, ""));
      category = markdownCategoryByTitle[title] ?? null;
      continue;
    }
    if (!category || !line.startsWith("|")) {
      continue;
    }
    const cells = splitMarkdownTableRow(line);
    if (
      cells.length < 3 ||
      !/^\d+$/.test(cells[0]) ||
      !cells[1] ||
      !cells[2] ||
      cells[2] === "未提供"
    ) {
      continue;
    }
    const key = `${category}:${cells[2]}`;
    const existing = entries.get(key);
    entries.set(key, {
      category,
      assetName: cells[2],
      description:
        existing && existing.description !== cells[1]
          ? `${existing.description}；${cells[1]}`
          : cells[1],
    });
  }
  return [...entries.values()];
}

export function bundledSoundEffectCatalog(): SoundEffectCatalogSnapshot {
  return {
    entries: SOUND_EFFECT_CATALOG.map((entry) => ({ ...entry })),
    sourceUrl: SOUND_EFFECT_CATALOG_SOURCE,
    libraryUrl: SOUND_EFFECT_LIBRARY_URL,
    revisionId: SOUND_EFFECT_CATALOG_REVISION,
    syncedAt: null,
    source: "bundled",
  };
}
