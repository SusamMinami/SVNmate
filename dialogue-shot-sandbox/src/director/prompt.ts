import { BLOCKING_POSITIONS, type DirectorInput } from "./contracts";

export function buildDirectorPrompt(
  input: DirectorInput,
  providerName: string,
): string {
  const participantSlots = input.participants.map(
    (participant) => participant.slot,
  );
  const subjectOptions =
    input.participants.length === 2
      ? [...participantSlots, "both"]
      : [...participantSlots, "both", "group"];
  const examplePositions =
    input.participants.length === 2
      ? (["front_left", "front_right"] as const)
      : BLOCKING_POSITIONS;
  return [
    `你是 ${providerName}，负责游戏过场动画的分镜设计。`,
    `请分析 ${input.participants.length} 人对话的戏剧目标、情绪推进、权力变化和视觉节奏。`,
    "只允许输出一个 JSON 对象，不要 Markdown 代码块，不要解释文字。",
    `request_id 必须原样返回：${input.request_id}`,
    "必须覆盖输入中的每一个 dialogue_id，且每个 ID 只能出现一次。",
    "可以把连续台词合并到一个镜头，但不得改写台词或增删角色。",
    "按约每秒 4-5 个汉字估算台词时长；普通镜头至少覆盖连续两句台词，不能仅因说话人变化就切镜。常规镜头尽量保持 4-8 秒；若新镜头不足两句或预计不足 4 秒，优先与相邻台词合并并保留当前机位，除非遇到进出场边界或明确的重大情绪、动作、信息转折。",
    "不要输出 XYZ 坐标，软件会根据语义模板计算机位。",
    "blocking 必须覆盖所有参与角色，每个角色只能出现一次，position 不能重复。",
    "facing 可以是另一个实际角色槽位或 group_center；不要让角色面向自己。",
    "每个 shot 必须设置 look_target。单人和带群镜头填写当前主体正在交流或注视的实际角色槽位；双人、群像建立镜头填写 group_center。",
    "轴线按当前互动关系动态建立：单人镜头的关系轴连接 subject 与 look_target，不得把多人场面简化为一条永远不变的全场轴线。",
    "同一角色对的连续镜头必须保持在该关系轴同一侧。切换到新的角色对时，优先让前后两条轴共享一个角色作为转折点；不共享角色时，先用群像、轴上中性镜头或可见运动重建空间。",
    "每个 placement 必须给出 entry_dialogue_id。它可以早于角色的 first_dialogue_id，但不能晚于首次发言。",
    "每个 placement 必须给出 exit_dialogue_id。没有提前离场时填 null；有离场时填角色仍在画面中的最后一个当前 dialogue_id，角色从下一节点起消失。",
    "exit_dialogue_id 不能早于 entry_dialogue_id，也不能早于角色的 last_dialogue_id。只有文本或上下文明确支持离场时才设置，不能仅因角色不再发言就推断其离场。",
    "角色进场或离场节点必须位于镜头边界，单个 shot 不得跨越任何角色的进场或离场变化。",
    "结合 adjacent_context.previous 和 adjacent_context.next 理解前因后果，但 shots 只能使用当前 dialogue 中的 dialogue_id。",
    "所有镜头以 16:9 为主构图，同时检查叠加 21:9 画框后的安全区域。",
    "关键角色的眼睛、表情、手势和叙事动作应尽量保留在 21:9 中央区域，避免被上下裁切。",
    "按当前站位预判镜头投影，不能让两个重要角色在画面中重叠成一人；必要时调整语义站位、主体景别或左右构图。",
    "普通对话的单人镜头优先呈现主体正面或四分之三正面；侧面角度只用于明确的对峙、疏离、隐藏或观察意图。",
    "close_up、reaction_closeup、low_angle_closeup、high_angle_closeup 和 reverse_medium 都是单主体构图；若希望保留其他角色，应改用 speaker_group_medium。",
    "reverse_medium 只能用于与前一个单人镜头构成主体互换、视线互补的正反打；没有互补前镜时使用 close_up 或其他合适模板。",
    "相邻镜头应有明确的角度或景别变化；连续拍摄同一主体时，水平机位变化原则上至少 30 度。",
    "普通对话从建立镜头逐步收紧景别；全景直接跳到特写需要重大情绪或信息转折。特写后优先使用另一角色的匹配特写，或回到建立镜头重新交代空间。",
    "每个 shot 必须声明 composition_mode、visual_anchor、negative_space 和 composition_transition；构图必须服务于当前情绪、关系与上下镜视觉连续。",
    "普通对话单人镜头优先使用 rule_of_thirds，并把眼睛放在上三分交点附近、给视线方向保留空间；情绪强调可使用更细腻的 golden_ratio。",
    "center 或 symmetry 用于秩序、权力、仪式感、压迫或正面揭示，不作为所有普通对话的默认构图。",
    "negative_space 用于孤独、缺席、等待、威胁或悬念；isolation 保留较多空白，pressure 刻意压缩视线空间，但都必须写明叙事动机。",
    "三人及以上群像优先考虑 triangular 或 layered_depth；通过前中后景和三角视觉关系分离角色轮廓。",
    "上下镜 composition_transition：正反打优先 mirror_reverse；希望观众视线停留在相近屏幕区域时使用 match_eye_trace；收紧情绪时使用 progressive_shift；重新建立空间时使用 recenter；有意制造冲击时才使用 contrast。",
    "构图连续性优先匹配主体眼睛或主要视觉重心，而不是机械保持完全相同画面；连续多镜也要避免所有主体始终落在同一侧造成单调。",
    "每个 shot 必须设置 coverage_intent，明确该镜为何选择单人、双人、带群或群像，而不是只按当前说话者机械切换。",
    "前三个镜头中必须至少有一个交代当前在场角色关系和站位的全景：恰有两人在场时使用 master_two_shot，至少三人在场时使用 master_group_shot。",
    "任何角色进入后，或角色离场后的下一镜，只要仍有至少两人在场，都必须使用双人或群像全景重新建立位置与关系。",
    "双人镜头用于关系、共同反应、身体语言、距离和共同利益；当一个镜头覆盖双方连续台词且没有重大个人情绪转折时，优先保留双方同框，避免机械正反打。",
    "三人以上的普通互动优先使用 speaker_group_medium 保留主体和关系背景；群像全景用于社会结构、阵营、集体反应和空间变化。",
    "单人镜头用于个人视角、重要台词、决定、隐瞒、脆弱、孤立或关键反应；close_up 和 reaction_closeup 不应成为普通对话的默认覆盖。",
    "连续三个紧景后，若下一个节点不是必须保持紧景的重大情绪点，应回到双人或群像全景重建空间。",
    "正面群像中避免同时选择同侧且前后相邻的位置组合（如 mid_right + back_right）；优先用左右错列或对角站位分离轮廓。",
    "群像镜头应形成前后层次和横向间距；单人镜头不必强行容纳所有角色。",
    input.participants.length > 2
      ? "按 entry_dialogue_id 和 exit_dialogue_id 判断每个镜头的实际在场人数：恰有两人在场时可使用双人模板 + both；至少三人在场时才使用 master_group_shot + group；需要保留关系背景时使用 speaker_group_medium + 单个角色槽位。"
      : "双人同框使用 master_two_shot 或 profile_two_shot + both。",
    "如果信息不足，返回 status=need_context，并只使用允许的 required_context。",
    "ready 格式：",
    JSON.stringify(
      {
        schema_version: "shot-plan.v4",
        request_id: input.request_id,
        status: "ready",
        scene_analysis: {
          dramatic_goal: "本场戏的叙事目标",
          emotional_progression: "情绪与关系如何变化",
          visual_strategy: "景别、角度和节奏的整体策略",
        },
        blocking: {
          formation:
            input.participants.length === 3 ? "triangle" : "arc",
          intent: "站位如何体现关系、权力和当前事件",
          placements: input.participants.map((participant, index) => ({
            subject: participant.slot,
            position: examplePositions[index],
            facing: "group_center",
            entry_dialogue_id: input.dialogue[0].dialogue_id,
            exit_dialogue_id: null,
            intent: "该角色为什么站在这里并面向这个方向",
          })),
        },
        shots: [
          {
            dialogue_ids: ["台词节点ID"],
            template:
              input.participants.length > 2
                ? "master_group_shot"
                : "master_two_shot",
            subject: input.participants.length > 2 ? "group" : "both",
            look_target: "group_center",
            lens_mm: 35,
            composition_mode:
              input.participants.length > 2 ? "triangular" : "symmetry",
            visual_anchor: "balanced",
            negative_space: "balanced",
            composition_transition: "recenter",
            coverage_intent: "establish_geography",
            camera_height: "eye",
            intent: "这个镜头如何推动叙事",
          },
        ],
      },
      null,
      2,
    ),
    "need_context 格式：",
    JSON.stringify(
      {
        schema_version: "shot-plan.v4",
        request_id: input.request_id,
        status: "need_context",
        required_context: ["npc_relationship"],
        reason: "缺少信息的原因",
      },
      null,
      2,
    ),
    `允许的 template：${input.constraints.supported_templates.join(", ")}`,
    `允许的 subject：${subjectOptions.join(", ")}`,
    "允许的 formation：arc, triangle, cluster, opposed_groups, leader_front",
    "允许的 position：front_center, front_left, front_right, mid_center, mid_left, mid_right, back_center, back_left, back_right, far_left, far_right, rear_center",
    "允许的 composition_mode：center, rule_of_thirds, golden_ratio, symmetry, asymmetrical_balance, triangular, negative_space, layered_depth",
    "允许的 visual_anchor：center, left_third, right_third, left_golden, right_golden, balanced",
    "允许的 negative_space：balanced, look_room, isolation, pressure",
    "允许的 composition_transition：recenter, match_eye_trace, mirror_reverse, progressive_shift, contrast",
    "允许的 coverage_intent：establish_geography, reestablish_geography, relationship, shared_reaction, individual_perspective, individual_emphasis, reaction",
    "允许的 camera_height：low, eye, high",
    "允许的 required_context：npc_background, npc_relationship, scene_layout, story_before, story_after",
    "输入数据：",
    JSON.stringify(input),
  ].join("\n");
}
