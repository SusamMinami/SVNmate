---
name: "internal-storyboard-director"
description: "Designs UE4 dialogue storyboards through the local storyboard MCP queue. Invoke when the user asks to process pending storyboard tasks or design shots for 镜头沙盘."
---

# 内部 TRAE 分镜导演

使用当前内部 TRAE 模型处理“镜头沙盘”提交的待办任务，并通过 MCP
返回严格的 `shot-plan.v1`。

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
   - `participants[].first_dialogue_id`：角色第一次发言节点
   - `participants[].last_dialogue_id`：角色最后一次发言节点
   - `dialogue`：按剧情顺序排列的台词
   - `adjacent_context.previous/next`：当前四位 ID 前一段和后一段对话
   - `constraints.supported_templates`：允许的镜头模板
4. 分析戏剧目标、情绪推进、关系变化、信息揭示和视觉节奏。
5. 根据角色关系、权力状态和当前事件设计语义站位。
6. 生成满足下述要求的 `shot-plan.v1`。
7. 调用 `storyboard_submit_plan` 提交结果。
8. 只有 MCP 返回 `accepted=true` 才计为完成；随后再次调用
   `storyboard_get_pending_request`，继续处理下一项。
9. 单次最多连续处理 5 项，或在 `found=false` 时停止，并汇总实际完成的
   `request_id`。若队列仍有任务，明确提示用户再次触发。
10. 若无法完成，调用 `storyboard_fail_request` 写入明确原因。

## 分镜要求

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
- 保持 180 度轴线连续、视线方向连续和人物站位稳定。
- 以 16:9 为主构图，并检查叠加 21:9 画框后的安全区域。
- 关键人物的眼睛、表情、手势和叙事动作不得被 21:9 上下裁切。
- 预判每个镜头中的人物投影，避免重要角色互相遮挡或堆叠。
- 普通对话的单人镜头优先呈现主体正面或四分之三正面；侧面角度只用于
  明确的对峙、疏离、隐藏或观察意图。
- `close_up`、`reaction_closeup`、`low_angle_closeup`、
  `high_angle_closeup` 和 `reverse_medium` 都按单主体构图设计；
  希望保留关系角色时使用 `speaker_group_medium`。
- `reverse_medium` 必须和前一个单人镜头构成主体互换、视线互补的
  正反打；没有互补前镜时改用 `close_up` 或其他合适模板。
- 相邻镜头必须有明确的角度或景别变化；连续拍摄同一主体时，水平机位
  变化原则上至少 30 度。
- 普通对话从建立镜头逐步收紧景别；全景直接跳到特写必须有重大情绪或
  信息转折。特写后优先使用另一角色的匹配特写，或回到建立镜头。
- 正面群像避免把角色同时放在同侧相邻的前后位置，优先使用横向错列或
  对角关系分离轮廓。
- 群像通过前后层次与横向间距保持轮廓分离，单人镜头无需强行容纳全员。
- 不输出 XYZ 坐标；镜头沙盘会把语义模板转换为 Three.js 机位。
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
  "schema_version": "shot-plan.v1",
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
      "lens_mm": 50,
      "screen_position": "left_third",
      "camera_height": "eye",
      "intent": "该镜头推动叙事的原因"
    }
  ]
}
```

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

## 信息不足

仅在确实无法设计时提交：

```json
{
  "schema_version": "shot-plan.v1",
  "request_id": "必须与任务一致",
  "status": "need_context",
  "required_context": ["npc_relationship"],
  "reason": "需要补充什么，以及为什么"
}
```

`required_context` 只能使用任务合同允许的枚举。
