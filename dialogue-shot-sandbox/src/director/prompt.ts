import {
  BLOCKING_POSITIONS,
  type DirectorInput,
  type ReadyDirectorResponse,
} from "./contracts";

interface DirectorProjectionRevision {
  previousPlan: ReadyDirectorResponse;
  failures: Array<{
    shotIndex: number;
    dialogueIds: string[];
    warnings: string[];
  }>;
  referenceCases?: Array<{
    caseId: string;
    failureSignature: string;
    originalTemplate: string;
    revisedTemplate: string;
    summary: string;
    strategy: string;
    appliesWhen: string;
    avoidWhen: string;
  }>;
}

function cameraKeyframeGuidance(input: DirectorInput): string {
  if (!input.camera_keyframes?.length) {
    return "当前输入没有单独的镜头关键帧节点。";
  }
  return [
    "camera_keyframes 来自 Dialog.State=4（关闭对话框 UI）的控制节点。",
    "这些节点的 Content 不会显示，不属于台词，不得据此判断重复文本、角色口吻或台词时长，也不得放入 shots[].dialogue_ids。",
    "它们会保留原有 UE 镜头配置；当 next_dialogue_id 非空时，必须把该可见台词视为新的镜头边界，不能与关键帧之前的台词合并。",
  ].join("");
}

export function buildDirectorPrompt(
  input: DirectorInput,
  providerName: string,
  revision?: DirectorProjectionRevision,
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
  if (revision) {
    const contentById = new Map(
      input.dialogue.map((line) => [line.dialogue_id, line]),
    );
    const failures = revision.failures.map((failure) => ({
      ...failure,
      dialogue: failure.dialogueIds.map((dialogueId) =>
        contentById.get(dialogueId),
      ),
    }));
    return [
      `你是 ${providerName}，正在执行一次投影验收后的定向返修。`,
      `request_id 必须原样返回：${input.request_id}`,
      "只输出完整的 shot-plan.v5 JSON，不要 Markdown 或解释文字。",
      "保留未列出镜头的台词分组和设计，只重新设计失败镜头（failed_shots）；返回结果仍须按原顺序覆盖每个 dialogue_id 一次。",
      cameraKeyframeGuidance(input),
      "根据每条 warnings 调整失败镜头的模板、主体、注视对象、焦段、机位高度、运动或构图语义。不要只改 intent 文案。",
      "在顶层 revision_reflections 中为每个失败镜头输出一条简短的事后总结，包含 shot_index、summary、root_cause、strategy、applies_when、avoid_when；只记录可复用结论，不输出推理过程。",
      input.constraints.preserve_input_formation
        ? "角色站位来自 UE Blueprint，不得修改或假设 blocking.position 会改变实际坐标。"
        : "可以调整 blocking，但所有角色位置必须唯一，并保持进出场节点有效。",
      "继续遵守 16:9 主构图、21:9 安全区域、关系轴同侧、视线空间、角色不重叠、运镜起止画面可读和相邻镜头至少 30 度变化等约束。",
      revision.referenceCases?.length
        ? `已审核历史案例（仅作经验参考，不得照抄与当前站位冲突的参数）：${JSON.stringify(revision.referenceCases)}`
        : "当前没有匹配的已审核历史案例，请只依据本次验收证据返修。",
      `failed_shots：${JSON.stringify(failures)}`,
      `上一版完整方案：${JSON.stringify(revision.previousPlan)}`,
      `原始输入：${JSON.stringify(input)}`,
    ].join("\n");
  }
  return [
    `你是 ${providerName}，负责游戏过场动画的分镜设计。`,
    `请分析 ${input.participants.length} 人对话的戏剧目标、情绪推进、权力变化和视觉节奏。`,
    "生成前请在内部依次判断：当前叙事变化是什么、观众该看谁、需要多大空间信息、角度与焦段如何改变感受、镜头运动是否确有必要。最终只输出结论，不输出思考过程。",
    "把每个镜头视为景别、角度、画面人数、运动、焦段、焦点层次和构图的组合。每个参数应共同服务一个主要叙事目标，不能为了技巧数量而堆叠互相竞争的效果。",
    "只允许输出一个 JSON 对象，不要 Markdown 代码块，不要解释文字。",
    `request_id 必须原样返回：${input.request_id}`,
    "必须覆盖输入中的每一个 dialogue_id，且每个 ID 只能出现一次。",
    cameraKeyframeGuidance(input),
    "可以把连续台词合并到一个镜头，但不得改写台词或增删角色。",
    "按约每秒 4-5 个汉字估算台词时长；普通镜头至少覆盖连续两句台词，不能仅因说话人变化就切镜。常规镜头尽量保持 4-8 秒；若新镜头不足两句或预计不足 4 秒，优先与相邻台词合并并保留当前机位，除非遇到进出场边界或明确的重大情绪、动作、信息转折。",
    "不要输出 XYZ 坐标，软件会根据语义模板计算机位。",
    input.constraints.preserve_input_formation
      ? "输入角色包含从 UE Blueprint 读取的 initial_position 与 initial_facing_target。必须以这些现有站位分析遮挡、关系轴和镜头，不得假设 blocking.position 会改变实际坐标。"
      : "角色初始坐标由软件根据 blocking.position 的语义站位确定。",
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
    "camera_height=eye 是中性、平等和客观的默认角度；low 用于权力、威胁或从弱者视点仰望，high 用于脆弱、受困、规模或环境压倒人物。不要把高低机位机械等同于强弱，必须结合剧情语境。",
    "camera_roll_degrees 默认必须为 0。只有失衡、混乱、心理异常、梦境或明确不安时才使用 Dutch angle，通常取正负 15-25 度；更陡角度仅用于强烈失序，不能把轻微歪斜当装饰。",
    "焦距决定视场和空间透视，不直接决定景别：24-35mm 用于空间、群像或有意夸张近大远小；35-50mm 接近自然视感；50-85mm 适合过肩、对话和主体分离；85-135mm 适合近景、特写和空间压缩。软件会通过机位距离维持目标景别。",
    "lens_intent 必须与 lens_mm 一致：spatial_context=24-35，natural_perspective=35-50，subject_isolation=50-85，compressed_intimacy=85-135，perspective_distortion=24-35 且必须有明确夸张意图。",
    "depth_of_field 也要服务叙事：建立镜头、群像、前后景同时发生动作或需要观众比较关系时优先 deep；普通对话可用 moderate；只有一个主要焦点的情绪近景、反应和关键信息可用 shallow。景深是清晰范围，layered_depth 是前中后景调度，不得混为一谈。",
    "camera_movement 默认 static。只有信息揭示、角色移动、情绪推进、关系变化或空间重建需要时才运镜；运动必须有清晰起点、终点和叙事目的，不能只为增加变化。",
    "pan 保持摄影机位置不变，通过水平改变视线连接角色、跟随横向动作或逐步揭示信息；tracking 随主体穿过环境，只有上下文存在明确移动路径时使用。",
    "dolly_in 物理靠近主体，用于注意力集中、期待、领悟或情绪增强；dolly_out 物理远离主体，用于孤立、抽离、空间揭示或关系疏远。zoom_in/zoom_out 保持机位不动，只通过增加/缩短焦距改变视场，其空间透视不等同于物理推拉。",
    "dolly_zoom_in 表示摄影机推进并同步缩短焦距，dolly_zoom_out 表示摄影机后退并同步增加焦距；两者都应保持主体尺寸近似不变，只用于恐惧、震惊、顿悟、失衡等关键节点，并优先使用 50-135mm 范围和有纵深的背景。",
    "静态镜头必须使用 movement_intensity=none 且 end_lens_mm=lens_mm；所有运动镜头必须使用 subtle、moderate 或 strong。只有 zoom 和 Dolly zoom 可以改变 end_lens_mm：zoom_in 增加焦距，zoom_out 缩短焦距。",
    "运镜起止画面都必须保持主体、视线、轴线和 21:9 安全区域可读。常规对话优先 subtle，强运动只用于强烈动作或情绪节点，并应给观众足够时间读懂运动。",
    "close_up、reaction_closeup、low_angle_closeup、high_angle_closeup 和 reverse_medium 都是单主体构图；若希望保留其他角色，应改用 speaker_group_medium。",
    "reverse_medium 只能用于与前一个单人镜头构成主体互换、视线互补的正反打；没有互补前镜时使用 close_up 或其他合适模板。",
    "相邻镜头应有明确的角度或景别变化；连续拍摄同一主体时，水平机位变化原则上至少 30 度。",
    "普通对话从建立镜头逐步收紧景别；全景直接跳到特写需要重大情绪或信息转折。特写后优先使用另一角色的匹配特写，或回到建立镜头重新交代空间。",
    "每个 shot 必须声明 composition_mode、visual_anchor、negative_space 和 composition_transition；构图必须服务于当前情绪、关系与上下镜视觉连续。",
    "普通对话单人镜头优先使用 rule_of_thirds，并把眼睛放在上三分交点附近、给视线方向保留空间；情绪强调可使用更细腻的 golden_ratio。",
    "center 或 symmetry 用于秩序、权力、仪式感、压迫或正面揭示，不作为所有普通对话的默认构图。",
    "negative space 是主体周围的空白，不等同于角色脸后的空间。普通对话使用 look_room 时，主要空白必须位于角色注视方向，视线前方空间不得小于后方空间。",
    "isolation 只有在台词或上下文明确支持孤独、缺席或环境压倒人物时才使用；停顿本身不足以推断孤立。画外威胁应使用 look_room，把空白留在角色正在观察的方向。pressure 是有意的短边构图：压缩角色面朝方向的空间、把较多空白留在脑后，只用于受阻、困住、对抗或不安，并在 intent 中说明。",
    "每镜必须有清晰焦点。单人和浅景深镜头只保留一个主焦点；双人、三人和深景深镜头可以让观众比较多个焦点，但站位、大小、锐度或画面重量必须说明优先级。",
    "三人镜头不是简单装下三个人：均匀间距表达团结或平衡，中心前置/高位表达领导，两人靠近而第三人拉开表达阵营分裂或孤立。",
    "Rack focus、Split diopter、POV、Insert、Tilt、Arc、Whip pan、Snorricam 和 Overhead 需要当前协议尚未提供的焦点对象、观察者、场景目标或轨迹参数；不得用相近模板或 camera_movement 字段冒充这些技巧。",
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
        schema_version: "shot-plan.v5",
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
            end_lens_mm: 35,
            lens_intent: "spatial_context",
            depth_of_field: "deep",
            camera_movement: "static",
            movement_intensity: "none",
            camera_roll_degrees: 0,
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
        schema_version: "shot-plan.v5",
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
    `允许的 lens_intent：${input.constraints.supported_lens_intents.join(", ")}`,
    `允许的 depth_of_field：${input.constraints.supported_depth_of_field.join(", ")}`,
    `允许的 camera_movement：${input.constraints.supported_camera_movements.join(", ")}`,
    "允许的 movement_intensity：none, subtle, moderate, strong",
    "camera_roll_degrees 允许 -45 到 45；不用 Dutch angle 时必须填 0。",
    "允许的 required_context：npc_background, npc_relationship, scene_layout, story_before, story_after",
    "输入数据：",
    JSON.stringify(input),
  ].join("\n");
}
