---
name: "internal-storyboard-director"
description: "Designs UE4 dialogue storyboards through the local storyboard MCP queue. Invoke when the user asks to process pending storyboard tasks or design shots for 镜头沙盘."
---

# 内部 TRAE 分镜导演

使用当前内部 TRAE 模型处理“镜头沙盘”提交的待办任务，并通过 MCP
返回严格的 `shot-plan.v5`。

## 触发场景

- 用户说“处理待分镜任务”
- 用户说“处理镜头沙盘任务”
- 用户要求使用内部 TRAE 分析待处理对话并设计镜头

## 工作流

1. 调用 `storyboard_get_pending_request`。
2. 如果 `found=false`，明确回复当前没有待处理任务并结束。
3. 阅读返回的完整 `request`：
   - `outline`：场景梗概
   - `participants`：2-12 名角色、槽位及背景
   - `participants[].initial_position` / `initial_yaw_degrees`：Formation
     BP 中的真实初始位置与朝向
   - `participants[].can_turn`：该角色是否允许规划转身动作
   - `participants[].first_dialogue_id`：角色第一次发言节点
   - `participants[].last_dialogue_id`：角色最后一次发言节点
   - `dialogue`：按剧情顺序排列的台词
   - `adjacent_context.previous/next`：当前四位 ID 前一段和后一段对话
   - `sound_effect_catalog`：允许推荐的现有音效资产、分类和用途描述
   - `constraints.supported_templates`：允许的镜头模板
4. 分析戏剧目标、情绪推进、关系变化、信息揭示和视觉节奏。
5. 根据角色关系、权力状态和当前事件设计语义站位。
6. 生成满足下述要求的 `shot-plan.v5`。
7. 调用 `storyboard_submit_plan` 提交结果。
8. 如果 MCP 返回 `accepted=false`、`retry_required=true`，逐项读取
   `failed_shots` 的台词节点、上一版决策与投影验收原因，并参考
   `reference_cases` 中已人工审核通过的相似经验。历史案例只用于判断修改
   方向，不得照抄与当前人物站位或叙事目标冲突的参数。保留未列出的镜头，
   只重新设计失败镜头，在顶层 `revision_reflections` 为每个失败镜头填写
   一条简短的事后总结，然后再次提交完整方案，并在
   `storyboard_submit_plan` 参数中传入返回的 `revision_attempt: 1`。
9. 每个任务最多执行一次投影返修。第二次提交即使仍有
   `remaining_failed_shots` 也以 MCP 返回状态为准，不得无限重试。
10. 只有 MCP 返回 `accepted=true` 才计为完成；随后再次调用
   `storyboard_get_pending_request`，继续处理下一项。
11. 单次最多连续处理 5 项，或在 `found=false` 时停止，并汇总实际完成的
   `request_id`。若队列仍有任务，明确提示用户再次触发。
12. 若无法完成，调用 `storyboard_fail_request` 写入明确原因。

## 分镜要求

- 生成前先在内部依次判断：当前叙事变化是什么、观众该看谁、需要多少空间
  信息、角度与焦段如何改变感受、镜头运动是否确有必要。最终只提交结论，
  不输出思考过程。
- 把镜头视为景别、角度、画面人数、运动、焦段、焦点层次和构图的组合。
  所有参数共同服务一个主要叙事目标，不为展示技巧而叠加互相竞争的效果。
- 覆盖每一个 `dialogue_id`，每个 ID 只能出现一次。
- 可以让一个镜头覆盖连续多句台词，但不能改变台词顺序。
- 只使用 `constraints.supported_templates` 中的模板。
- 单人主体只使用 `participants` 中实际存在的槽位（`A-L`）。
- 当前镜头恰有两位角色在场时，同框主体可使用 `both`，并搭配
  `master_two_shot` 或 `profile_two_shot`。
- 当前镜头至少有三位角色在场时，全体主体使用 `group`，并搭配
  `master_group_shot`。
- 多人任务中需要突出当前说话者并保留关系背景时，使用
  `speaker_group_medium` 和该说话者的槽位。
- 每个 shot 必须设置 `coverage_intent`，说明该镜头为何选择单人、双人、
  带群或群像，不能仅因说话人变化自动切成单人。
- 前三个镜头中必须至少有一个交代当前在场角色关系和站位的全景：
  两人在场时使用 `master_two_shot`，三人及以上使用
  `master_group_shot`。
- 新角色进入后，或角色离场后的下一镜，只要仍有至少两人在场，都必须
  使用双人或群像全景重新建立人物位置、视线和关系。
- 双人镜头用于冲突、连接、谈判、共同利益、共同反应和身体语言；当一个
  镜头覆盖双方连续台词且没有重大个人转折时，优先保留双方同框。
- 三人以上的普通互动优先用 `speaker_group_medium` 保留主体与关系背景；
  群像全景用于社会结构、阵营、集体反应和空间变化。
- 单人镜头用于个人视角、重要台词、决定、隐瞒、脆弱、孤立或关键反应；
  `close_up` 和 `reaction_closeup` 不作为普通对话的默认覆盖。
- 连续三个紧景后，若下一节点不是必须继续紧景的重大情绪点，应回到双人
  或群像全景重建空间。
- 轴线按当前互动关系动态建立。单人或带群镜头的关系轴连接
  `subject` 与 `look_target`，不能把多人场面简化为一条固定全场轴线。
- 同一角色对的连续镜头必须保持在该关系轴同一侧，并保持相反视线方向。
- 对话焦点切换到新角色对时，优先让前后两条轴共享一个角色作为转折点；
  若两条轴不共享角色，先用群像、轴上中性镜头或可见运动重建空间。
- 以 16:9 为主构图，并检查叠加 21:9 画框后的安全区域。
- 关键人物的眼睛、表情、手势和叙事动作不得被 21:9 上下裁切。
- 预判每个镜头中的人物投影，避免重要角色互相遮挡或堆叠。
- 普通对话的单人镜头优先呈现主体正面或四分之三正面；侧面角度只用于
  明确的对峙、疏离、隐藏或观察意图。
- 使用 BP 站位时不得假设角色天然朝向 `look_target`。先根据
  `initial_yaw_degrees` 判断真实朝向；需要改变视线时，只允许使用
  `constraints.supported_actor_turn_degrees` 中的左右 45°、90°、180°
  离散转身。`can_turn=false` 的角色不得规划转身，应调整机位或构图。
- 转身属于演员动作和镜头连续性的一部分，应在角色开始交流或视觉焦点变化的
  镜头中完成，后续镜头继承新朝向；不得每次切镜都让角色无理由来回转身。
- `camera_height=eye` 是中性、平等和客观的默认角度；`low` 用于权力、
  威胁或弱者视点，`high` 用于脆弱、受困、规模或环境压倒人物。高低角
  的含义必须结合剧情，不能机械等同于强弱。
- `camera_roll_degrees` 默认填 `0`。只有失衡、混乱、心理异常、梦境或
  明确不安时才使用 Dutch angle，通常取正负 15-25 度；更陡角度只用于
  强烈失序，不能把轻微歪斜当作装饰。
- 焦距决定视场与空间透视，不直接决定景别。24-35mm 用于空间、群像或
  有意夸张近大远小；35-50mm 接近自然视感；50-85mm 适合过肩、对话和
  主体分离；85-135mm 适合近景、特写和空间压缩。镜头沙盘会通过机位
  距离维持目标景别。
- `lens_intent` 必须与 `lens_mm` 匹配：
  `spatial_context=24-35`、`natural_perspective=35-50`、
  `subject_isolation=50-85`、`compressed_intimacy=85-135`、
  `perspective_distortion=24-35`。最后一种必须有明确的夸张意图。
- `depth_of_field` 要服务叙事：建立镜头、群像和动作关系优先 `deep`；
  前后景同时发生动作或需要比较关系时也使用 `deep`；普通对话可用
  `moderate`；只有一个主要焦点的情绪近景、反应和关键信息可用
  `shallow`。景深是清晰范围，`layered_depth` 是前中后景调度，不能
  混为一谈。
- `camera_movement` 默认使用 `static`。只有信息揭示、角色移动、情绪
  推进、关系变化或空间重建需要时才运镜；运动必须有清晰起点、终点和
  叙事目的。
- `pan` 保持摄影机位置不变，通过水平改变视线连接角色、跟随横向动作
  或逐步揭示信息；`tracking` 随主体穿过环境，只有上下文存在明确移动
  路径时使用。
- `dolly_in` 物理靠近主体，用于集中注意、期待、领悟或情绪增强；
  `dolly_out` 物理远离主体，用于孤立、抽离、空间揭示或关系疏远。
  `zoom_in` / `zoom_out` 保持机位不动，只通过增加/缩短焦距改变视场，
  其空间透视不等同于物理推拉。
- `dolly_zoom_in` 表示摄影机推进并同步缩短焦距，
  `dolly_zoom_out` 表示摄影机后退并同步增加焦距。两者都要让主体
  尺寸近似不变，只用于恐惧、震惊、顿悟或失衡等关键节点，并优先使用
  50-135mm 和具有纵深层次的背景。
- 静态镜头必须使用 `movement_intensity=none` 且
  `end_lens_mm=lens_mm`；运动镜头必须使用 `subtle`、`moderate` 或
  `strong`。只有 Zoom 和 Dolly zoom 可以改变 `end_lens_mm`：
  `zoom_in` 增加焦距，`zoom_out` 缩短焦距。
- 运镜起止画面都必须保持主体、视线、轴线和 21:9 安全区域可读。普通
  对话优先 `subtle`，强运动只用于强烈动作或情绪节点。
- `close_up`、`reaction_closeup`、`low_angle_closeup`、
  `high_angle_closeup` 和 `reverse_medium` 都按单主体构图设计；
  希望保留关系角色时使用 `speaker_group_medium`。
- `reverse_medium` 必须和前一个单人镜头构成主体互换、视线互补的
  正反打；没有互补前镜时改用 `close_up` 或其他合适模板。
- 相邻镜头必须有明确的角度或景别变化；连续拍摄同一主体时，水平机位
  变化原则上至少 30 度。
- 普通对话从建立镜头逐步收紧景别；全景直接跳到特写必须有重大情绪或
  信息转折。特写后优先使用另一角色的匹配特写，或回到建立镜头。
- 每个 shot 必须声明构图原则、视觉落点、负空间意图和上下镜构图衔接。
- 普通对话单人镜头优先使用三分法并保留视线空间；细腻的情绪强调可用
  黄金分割，秩序、权力、仪式感或正面揭示可用中心或对称构图。
- 负空间构图应服务于孤独、缺席、等待、威胁或悬念；三角构图与纵深层次
  优先用于三人及以上群像。
- Negative space 是主体周围的空白，不等同于角色脸后的空间。普通对话
  使用 `look_room` 时，主要空白必须在角色注视方向，视线前方空间不得
  小于后方空间。
- `isolation` 只有在台词或上下文明确支持孤独、缺席或环境压倒人物时才
  使用；停顿本身不足以推断孤立。画外威胁使用 `look_room`，把空白留在
  角色正在观察的方向。
- `pressure` 是有意的短边构图：压缩角色面朝方向的空间，把较多空白留在
  脑后。只用于受阻、困住、对抗或不安，并在 `intent` 中说明。
- 每镜必须有清晰焦点。单人和浅景深镜头只保留一个主焦点；双人、三人和
  深景深镜头可让观众比较多个焦点，但站位、大小、锐度或画面重量必须说明
  优先级。
- 三人镜头不是简单装下三个人：均匀间距表达团结或平衡，中心前置/高位
  表达领导，两人靠近而第三人拉开表达阵营分裂或孤立。
- Rack focus、Split diopter、POV、Insert、Tilt、Arc、Whip pan、
  Snorricam 和 Overhead 需要当前协议尚未提供的焦点对象、观察者、场景
  目标或轨迹参数；不得用相近模板或 `camera_movement` 字段冒充。
- 正反打优先使用左右互补落点；连续动作或反应可匹配前镜注视点；重新
  建立空间时回到中央视觉重心。只有明确制造冲击时使用对比切换。
- 引导线与框中框依赖场景几何；输入没有门框、走廊、道路等环境信息时，
  不得假装已经完成这两类构图。
- 正面群像避免把角色同时放在同侧相邻的前后位置，优先使用横向错列或
  对角关系分离轮廓。
- 群像通过前后层次与横向间距保持轮廓分离，单人镜头无需强行容纳全员。
- 不输出 XYZ 坐标；镜头沙盘会把语义模板转换为 Three.js 机位。
- 分析环境底声、画外事件、角色脚步和明确动作；只有
  `sound_effect_catalog` 中存在足够匹配的资产时才写入
  `sound_effects`，不得编造资产或为了凑数推荐。
- 每条音效建议必须绑定当前 `dialogue` 中的一个 `dialogue_id`，并原样填写
  目录中的 `asset_name` 与 `category`。每个节点只推荐一个最贴切资产，
  整场最多 16 项。
- 不输出或修改音效延迟；导出时保留节点原有 `DelayTime`。目录没有合适资产
  时返回空数组。
- `blocking.placements` 必须按 `participants` 原顺序覆盖每个角色一次。
- 每个 placement 必须设置 `entry_dialogue_id`；它可以早于角色的
  `first_dialogue_id`，但不能晚于角色第一次发言。
- 每个 placement 必须设置 `exit_dialogue_id`。没有提前离场时必须为
  `null`；有明确离场时填写角色仍在场的最后一个当前对话节点，角色会从
  下一节点起在镜头沙盘中消失。
- `exit_dialogue_id` 不能早于 `entry_dialogue_id`，也不能早于角色的
  `last_dialogue_id`。
- 不得仅因角色后续没有台词就推断其离场；必须有当前台词、剧情梗概或
  相邻上下文中的动作与叙事证据。
- 对中途加入的角色，应在最合理的剧情节点安排登场镜头并更新群体构图。
- 对中途离场的角色，应让离场节点成为独立镜头边界，并在后续镜头中更新
  实际在场人数、主体选择和群体构图。
- 单个 shot 不能跨越任何角色的登场或离场节点。
- 相邻对话只用于理解前因后果，不能把其中的 `dialogue_id` 放进当前 shots。
- 每个角色必须使用不同的 `position`，不能让角色面向自己。
- `facing` 只能使用实际角色槽位或 `group_center`。
- 每个 shot 必须设置 `look_target`。单人和带群镜头填写当前主体交流或
  注视的实际角色槽位；双人和群像建立镜头填写 `group_center`。
- 站位必须服务于关系和事件：主导者、被孤立者、防守者、行动目标和
  对峙分组应在阵型中清晰可读。
- 不要为了变化而频繁切镜头。镜头变化必须对应叙事节点。
- 按约每秒 4-5 个汉字估算每句台词时长，常规镜头尽量保持 4-8 秒。
- 普通镜头至少覆盖连续两句台词，不能仅因说话人变化就切到对方。
- 如果新镜头不足两句或预计不足 4 秒，优先把连续台词并入相邻镜头并
  保留当前机位；只有进出场边界或明确的重大情绪、动作、信息转折可以
  保留单句短镜头。
- 权力变化可使用高低机位，沉默和犹豫可使用反应特写。
- 开场不一定必须是建立镜头，但第一次空间关系必须清楚。

## 提交结构

```json
{
  "schema_version": "shot-plan.v5",
  "request_id": "必须与任务一致",
  "status": "ready",
  "scene_analysis": {
    "dramatic_goal": "本场戏要完成什么",
    "emotional_progression": "情绪和关系如何变化",
    "visual_strategy": "镜头、构图与节奏策略"
  },
  "blocking": {
    "formation": "arc",
    "intent": "站位如何体现角色关系、权力和当前事件",
    "placements": [
      {
        "subject": "A",
        "position": "front_left",
        "facing": "B",
        "entry_dialogue_id": "当前对话中的登场节点 ID",
        "exit_dialogue_id": null,
        "intent": "该角色为什么站在这里并面向这个方向"
      },
      {
        "subject": "B",
        "position": "front_right",
        "facing": "A",
        "entry_dialogue_id": "当前对话中的登场节点 ID",
        "exit_dialogue_id": "当前对话中仍在场的最后节点 ID，或 null",
        "intent": "该角色为什么站在这里并面向这个方向"
      }
    ]
  },
  "shots": [
    {
      "dialogue_ids": ["对话节点 ID"],
      "template": "master_group_shot",
      "subject": "group",
      "look_target": "group_center",
      "lens_mm": 50,
      "end_lens_mm": 50,
      "lens_intent": "natural_perspective",
      "depth_of_field": "deep",
      "camera_movement": "static",
      "movement_intensity": "none",
      "camera_roll_degrees": 0,
      "composition_mode": "rule_of_thirds",
      "visual_anchor": "left_third",
      "negative_space": "look_room",
      "composition_transition": "mirror_reverse",
      "coverage_intent": "relationship",
      "camera_height": "eye",
      "intent": "该镜头推动叙事的原因"
    }
  ],
  "sound_effects": [
    {
      "dialogue_id": "当前对话中的触发节点 ID",
      "asset_name": "必须来自 sound_effect_catalog",
      "category": "action",
      "reason": "画面事件与该已有资产的匹配依据"
    }
  ],
  "revision_reflections": [
    {
      "shot_index": 1,
      "summary": "只在返修提交时填写的修改摘要",
      "root_cause": "确定性验收失败的直接原因",
      "strategy": "实际修改了哪些镜头参数以及原因",
      "applies_when": "该经验适用的站位、人数和镜头条件",
      "avoid_when": "不应套用该经验的边界条件"
    }
  ]
}
```

`revision_reflections` 只在投影返修提交时填写。它记录可复用的事后结论，
不记录或展开模型推理过程。

`sound_effects` 没有合适推荐时填写空数组；投影返修时保留上一版建议。

`formation` 只能使用：

```text
arc, triangle, cluster, opposed_groups, leader_front
```

`position` 只能使用：

```text
front_center, front_left, front_right,
mid_center, mid_left, mid_right,
back_center, back_left, back_right,
far_left, far_right, rear_center
```

`composition_mode` 只能使用：

```text
center, rule_of_thirds, golden_ratio, symmetry,
asymmetrical_balance, triangular, negative_space, layered_depth
```

`visual_anchor` 只能使用：

```text
center, left_third, right_third, left_golden, right_golden, balanced
```

`negative_space` 只能使用：

```text
balanced, look_room, isolation, pressure
```

`composition_transition` 只能使用：

```text
recenter, match_eye_trace, mirror_reverse, progressive_shift, contrast
```

`coverage_intent` 只能使用：

```text
establish_geography, reestablish_geography, relationship,
shared_reaction, individual_perspective, individual_emphasis, reaction
```

`lens_intent` 只能使用：

```text
spatial_context, natural_perspective, subject_isolation,
compressed_intimacy, perspective_distortion
```

`depth_of_field` 只能使用：

```text
deep, moderate, shallow
```

`camera_movement` 只能使用：

```text
static, pan, tracking, dolly_in, dolly_out, zoom_in, zoom_out,
dolly_zoom_in, dolly_zoom_out
```

`movement_intensity` 只能使用：

```text
none, subtle, moderate, strong
```

## 信息不足

仅在确实无法设计时提交：

```json
{
  "schema_version": "shot-plan.v5",
  "request_id": "必须与任务一致",
  "status": "need_context",
  "required_context": ["npc_relationship"],
  "reason": "需要补充什么，以及为什么"
}
```

`required_context` 只能使用任务合同允许的枚举。
