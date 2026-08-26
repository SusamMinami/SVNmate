import type { SoundEffectCategory } from "../data/soundEffectCatalog";
import type {
  DirectorInput,
  DirectorSoundEffectCue,
  DirectorSoundEffectRecommendation,
} from "./contracts";

interface SoundEffectRule {
  category: SoundEffectCategory;
  assetName: string;
  pattern: RegExp;
  reason: string;
}

const AMBIENT_RULES: readonly SoundEffectRule[] = [
  {
    category: "environment",
    assetName: "A_SFX_Dialog_521516",
    pattern: /海浪.*(?:海鸥|风|树)|(?:海鸥|风|树).*海浪/,
    reason: "场景同时包含海浪与海边自然元素，可作为整段环境底声。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_521510",
    pattern: /海边|海滩|沙滩|海浪/,
    reason: "场景位于海边，可用持续海浪建立空间环境。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_522901",
    pattern: /空港|战舰集结/,
    reason: "空港人群和大型飞行器底声可建立场景规模。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_518314",
    pattern: /(?:空艇|飞艇).*(?:飞行中|舱内)|(?:飞行中|舱内).*(?:空艇|飞艇)/,
    reason: "空艇舱内需要持续的风噪、引擎和螺旋桨环境声。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_521357",
    pattern: /餐厅|餐吧|露天集市|烧烤店/,
    reason: "餐饮场景适合加入远处交谈和集市人群底声。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_719600",
    pattern: /团圆饭|聚餐|吃饭/,
    reason: "用餐动作可用杯碟碰撞和进食声补足生活氛围。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_730401",
    pattern: /工业区|大型设备|大型机器/,
    reason: "大型设备持续嗡鸣可稳定工业场景的背景层。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_516301",
    pattern: /工人.*(?:抗议|争吵)|(?:抗议|争吵).*工人/,
    reason: "工人争吵与金属敲击可持续支撑抗议场面的张力。",
  },
  {
    category: "environment",
    assetName: "A_SFX_Dialog_514918",
    pattern: /演出结束.*(?:欢呼|鼓掌)|(?:欢呼|鼓掌).*演出结束/,
    reason: "演出结束节点适合用群众欢呼和掌声承接画面。",
  },
];

const CUE_RULES: readonly SoundEffectRule[] = [
  {
    category: "special",
    assetName: "A_SFX_FB_6015_01",
    pattern: /感应器|卡牌.*(?:反应|共鸣)|(?:反应|共鸣).*卡牌/,
    reason: "感应器或卡牌产生反应，可用三声电子提示强调信息出现。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_914400",
    pattern: /时间.*(?:倒转|倒流|倒放)|(?:倒转|倒流|倒放).*时间/,
    reason: "时间逆转是明确的特殊事件，可同步使用快速倒放音效。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_914300",
    pattern: /物质信息.*释放|突然加速|瞬间释放/,
    reason: "蓄力后突然加速的声音可强化信息瞬间释放。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_516918",
    pattern: /报警|警报|系统错误/,
    reason: "系统异常节点可用报警声直接提示危险升级。",
  },
  {
    category: "special",
    assetName: "A_SFX_NewYear_Firework_01",
    pattern: /烟花|焰火/,
    reason: "画面出现烟花，可同步调用已有燃放资产。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_513900",
    pattern: /徽章.*(?:震动|发光|亮起)|(?:震动|发光|亮起).*徽章/,
    reason: "徽章状态变化可用震动和魔法效果提示。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_518317",
    pattern: /权限卡|门禁卡/,
    reason: "获得权限卡后可用清脆电子音确认状态变化。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_518319",
    pattern: /全息.*(?:消失|关闭)|(?:消失|关闭).*全息/,
    reason: "全息影像消失时可同步轻微电流收束效果。",
  },
  {
    category: "special",
    assetName: "A_SFX_Dialog_522312",
    pattern: /耳鸣|头疼|头痛/,
    reason: "头痛或耳鸣是明确的主观听觉节点，可用较明显版本强调。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_519907",
    pattern: /(?:飞艇|空艇).*(?:起飞|飞离)|(?:起飞|飞离).*(?:飞艇|空艇)/,
    reason: "飞行器起飞和离开可直接匹配已有完整动作资产。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_518318",
    pattern: /闸门|重型门.*(?:拉开|开启)/,
    reason: "重型闸门动作适合用金属摩擦强化重量。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516419",
    pattern: /拆.*电池|电钻|打开.*金属盖/,
    reason: "拆卸电池的连续动作可使用电钻、金属盖和物体碰撞组合。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_517203",
    pattern: /设备.*入侵|机械臂.*失控|电子干扰/,
    reason: "设备被入侵时可用电子干扰和齿轮失控强化异常。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_517204",
    pattern: /设备.*重启|机器.*重启/,
    reason: "大型设备重启可直接匹配现有启动冲击。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_730404",
    pattern: /设备.*(?:停运|停止|关闭)|机器.*(?:停运|停止|关闭)/,
    reason: "设备停止运作时可用带空间混响的停机资产收束。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516906",
    pattern: /机器人.*(?:喷气|着陆|降落)/,
    reason: "机器人喷气着陆是清晰动作点，可同步现有资产。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516901",
    pattern: /机器人.*(?:蓄能|准备攻击)/,
    reason: "攻击前的蓄能声可提前建立威胁。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516148",
    pattern: /安塞尔.*扫描|机械臂.*扫描|小型设备.*扫描/,
    reason: "扫描动作可用旋转齿轮与激光声同步。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_516114_2",
    pattern: /大型设备.*扫描|大型空间.*激光/,
    reason: "大型空间中的扫描需要带混响的能量激光版本。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_718500",
    pattern: /口袋.*(?:摸索|翻找|掏)|(?:摸索|翻找).*(?:口袋|衣服)/,
    reason: "角色翻找口袋时可加入衣物摩擦和摸索声。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_719000",
    pattern: /翻书|翻页/,
    reason: "连续翻页动作可直接调用已有翻书资产。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_719700",
    pattern: /化妆|粉扑|化妆刷/,
    reason: "化妆准备动作可用刷子和粉扑摩擦声增强细节。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_728700",
    pattern: /抽出武器|拔出武器|纷纷亮出武器/,
    reason: "多人拔出武器是明确节奏点，可同步现有群体动作资产。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_729700",
    pattern: /搜身|搜出.*信|找出.*信/,
    reason: "搜身并发现信件可使用对应的连续动作音效。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_513901",
    pattern: /调整.*麦克风|麦克风.*啸叫/,
    reason: "调整麦克风时可同步手持噪声和轻微啸叫。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_728412",
    pattern: /急促.*呼吸|紧张.*喘息|逐渐平静/,
    reason: "急促呼吸到平静的变化可补足角色紧张状态。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_523612",
    pattern: /金币.*(?:洒落|掉落)|金钱.*(?:洒落|掉落)/,
    reason: "金币落地是明确物理事件，可同步现有洒落资产。",
  },
  {
    category: "action",
    assetName: "A_SFX_Dialog_521505",
    pattern: /远处.*爆炸|爆炸声/,
    reason: "远处爆炸可用短促资产建立画外事件。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_718700",
    pattern: /(?:孩子|小孩).*(?:跑开|跑掉)|(?:跑开|跑掉).*(?:孩子|小孩)/,
    reason: "多名孩子跑开可匹配凌乱脚步和无语义喊叫。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_729500",
    pattern: /高跟鞋.*(?:走近|走来|靠近)|女性.*高跟鞋/,
    reason: "高跟鞋接近可在角色入画前建立出场提示。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_518316",
    pattern: /军靴.*铁网|通风管道.*脚步/,
    reason: "铁网上的军靴脚步可准确匹配通风管道材质。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_521501",
    pattern: /沙滩.*脚步|脚步.*沙滩/,
    reason: "角色从沙滩入画时可提前加入对应材质脚步。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_521345",
    pattern: /拖鞋.*(?:跑开|跑掉)|(?:跑开|跑掉).*拖鞋/,
    reason: "拖鞋在木板上快速跑开可直接匹配现有资产。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_728400",
    pattern: /偷听.*(?:离开|跑开)|(?:偷听者|身后的人).*离开/,
    reason: "偷听者迅速离开可用衣物、脚步和碰撞组合提示。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_728801",
    pattern: /敌人.*撤退|撤退.*敌人/,
    reason: "敌群撤退可用远离脚步、金属拖地和空间混响。",
  },
  {
    category: "footstep",
    assetName: "A_SFX_Dialog_729701",
    pattern:
      /警察.*(?:走来|到场|靠近)|巡逻队.*(?:回来|接近|来了)|手铐.*脚步/,
    reason: "警察或巡逻队到场前可用靴子与装备金属声建立接近感。",
  },
];

function recommendationFromRule(
  input: DirectorInput,
  rule: SoundEffectRule,
  dialogueId: string,
): DirectorSoundEffectRecommendation | null {
  const entry = input.sound_effect_catalog.find(
    (candidate) =>
      candidate.category === rule.category &&
      candidate.asset_name === rule.assetName,
  );
  return entry
    ? {
        dialogueId,
        assetName: entry.asset_name,
        category: entry.category,
        reason: rule.reason,
        description: entry.description,
      }
    : null;
}

export function recommendSoundEffects(
  input: DirectorInput,
): DirectorSoundEffectRecommendation[] {
  const firstDialogueId = input.dialogue[0]?.dialogue_id;
  if (!firstDialogueId) {
    return [];
  }
  const recommendations: DirectorSoundEffectRecommendation[] = [];
  const usedAssets = new Set<string>();
  const sceneText = [
    input.outline,
    ...input.dialogue.map((line) => line.content),
  ].join(" ");
  const ambientRule = AMBIENT_RULES.find((rule) => rule.pattern.test(sceneText));
  if (ambientRule) {
    const recommendation = recommendationFromRule(
      input,
      ambientRule,
      firstDialogueId,
    );
    if (recommendation) {
      recommendations.push(recommendation);
      usedAssets.add(`${recommendation.category}:${recommendation.assetName}`);
    }
  }

  for (const line of input.dialogue) {
    const cueRule = CUE_RULES.find((rule) => rule.pattern.test(line.content));
    if (!cueRule) {
      continue;
    }
    const assetKey = `${cueRule.category}:${cueRule.assetName}`;
    if (usedAssets.has(assetKey)) {
      continue;
    }
    const recommendation = recommendationFromRule(
      input,
      cueRule,
      line.dialogue_id,
    );
    if (recommendation) {
      recommendations.push(recommendation);
      usedAssets.add(assetKey);
    }
    if (recommendations.length >= 8) {
      break;
    }
  }
  return recommendations;
}

export function resolveSoundEffectRecommendations(
  input: DirectorInput,
  cues: DirectorSoundEffectCue[],
): DirectorSoundEffectRecommendation[] {
  const dialogueIds = new Set(
    input.dialogue.map((line) => line.dialogue_id),
  );
  const seenDialogueIds = new Set<string>();
  return cues.map((cue) => {
    if (!dialogueIds.has(cue.dialogue_id)) {
      throw new Error(
        `音效 ${cue.asset_name} 使用了未知台词节点 ${cue.dialogue_id}`,
      );
    }
    const entry = input.sound_effect_catalog.find(
      (candidate) =>
        candidate.category === cue.category &&
        candidate.asset_name === cue.asset_name,
    );
    if (!entry) {
      throw new Error(`音效 ${cue.asset_name} 不在本次导演请求的资料库中`);
    }
    if (seenDialogueIds.has(cue.dialogue_id)) {
      throw new Error(`台词节点 ${cue.dialogue_id} 只能推荐一个音效`);
    }
    seenDialogueIds.add(cue.dialogue_id);
    return {
      dialogueId: cue.dialogue_id,
      assetName: cue.asset_name,
      category: cue.category,
      reason: cue.reason,
      description: entry.description,
    };
  });
}
