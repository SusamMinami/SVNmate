# 镜头沙盘镜头语言规则库 v1

本规则库用于三个环节：

1. 规则导演生成候选镜头。
2. 大模型提示词提供视觉约束。
3. Three.js 生成摄影机后执行几何验收。

机器可读源文件为 [`shot-language-rules.v1.json`](./shot-language-rules.v1.json)。

## 规则分级

| 级别 | 含义 | 系统行为 |
| --- | --- | --- |
| 硬约束 | 画面语义或连续性错误 | 候选镜头不通过，重新求解 |
| 软约束 | 通常应遵守，但可因叙事目的破例 | 扣分；破例时记录原因 |
| 风格偏好 | 镜头沙盘项目采用的导演风格 | 作为可配置权重参与排序 |

30°和180°规则是经典连续性原则，但仍允许有意打破。Adobe 对 180°规则的说明也强调，越轴可用于制造混乱或表现权力变化，前提是导演有意识地这样做。[来源](https://www.adobe.com/ph_en/creativecloud/video/discover/what-is-the-180-degree-rule.html)

“全景不直接切特写”和“特写后优先匹配特写或回到远景”不是所有电影都必须遵守的铁律。大幅跳变可以形成冲击，因此本项目将它们设为可调的风格偏好；普通对话默认使用，明确的揭示、惊吓或情绪转折可以破例。

## 核心规则

### 画面与标签一致

- 景别按角色身体关键点的最终屏幕投影判定，不按模板名称或焦距猜测。
- 洁净单人镜头只能有一个主要可见角色。
- 若画面保留对方肩背，应标记为过肩或脏单人镜头。
- 16:9 主构图中的关键表演信息还必须落在 21:9 安全区域。

Adobe 将中近景定义为头顶至胸部附近，将近景描述为由面部或单一元素占据画面；Prague Film Institute 也按身体裁切位置区分全景、中景、中近景和近景。因此系统应使用投影关键点分类，而不是把 `50 mm` 等同于某个固定景别。[Adobe 景别说明](https://www.adobe.com/ng/creativecloud/video/production/cinematography/camera-shots-and-angles/medium-close-up-shot.html) [Prague Film Institute 景别说明](https://www.praguefilminstitute.cz/shot-size-camera-framing-in-film/)

### 对话角度

- 普通说话人单人镜头优先正面至四分之三正面，即面部正方向与摄影机方向夹角约 0°-45°。
- 70°以上的接近侧面机位需要明确的对峙、疏离、秘密感或轮廓表达意图。
- 普通对话默认平视；俯拍和仰拍需要承担权力或情绪语义。

这里的角度是摄影机相对角色面部朝向的角度，不是摄影机相对世界坐标的角度。求解时必须使用 `facingTarget - position` 建立角色局部坐标系。

### 连续性

- 同一场连续对话默认保持在行动轴同一侧。
- 正反打中的两人应保持相反的屏幕视线方向。
- 连续拍摄同一主体时，机位方位变化优先不小于 30°。
- 越轴前使用中性镜头、可见的越轴运动或新建立镜头重建空间。

SJSU 的剪辑课程资料把 180°系统、视线匹配、正反打和 30°规则列为连续性剪辑的核心工具。[来源](https://www.sjsu.edu/people/drew.todd/courses/c1/s0/editing.pdf)

### 正反打

- “反打”是两个镜头之间的关系，不是单个镜头模板。
- 反打镜头必须关联配对镜头，主体互换，并验证轴线同侧和视线互补。
- 中性对话的匹配正反打优先使用相同景别、相近焦距和眼高。
- 单人正反打可以是洁净单人，也可以是过肩镜头，但两者必须明确区分。

Adobe 将正反打定义为先展示角色，再切到该角色所看的人或物，之后可切回原角度；过肩镜头则明确包含前景角色的肩背。[正反打](https://www.adobe.com/creativecloud/video/production/cinematography/camera-shots-and-angles/reverse-shot.html) [过肩镜头](https://www.adobe.com/mena_en/creativecloud/video/production/cinematography/camera-shots-and-angles/over-the-shoulder-shot.html)

### 景别转换

- 相邻镜头拍摄同一主体时，角度与景别至少有一项产生明确变化。
- 普通对话从建立镜头逐步收紧到中景、中近景和近景。
- 无叙事动机时，避免全景直接跳到近景或特写。
- 本项目偏好：特写后切对方的匹配特写，或回到全景重新建立空间；避免无动机回落到普通中景。
- 近景和特写应对应情绪、反应或关键信息，避免连续滥用。

摄影教学资料通常把过小的景别变化称为犹豫剪辑，把全景直接跳到特写视为可能产生冲击的转换，并建议普通连续性场景使用中间景别过渡。[来源](https://pacevideofall2011.wordpress.com/wp-content/uploads/2011/09/02class-elementsofcinematog-copy-2.pdf)

### 节奏与主体

- 普通镜头目标 4-8 秒，原则上至少承载两句台词。
- 切镜由信息、情绪、动作、权力或空间变化驱动，不由说话人变化单独触发。
- 多句台词分段后，再决定镜头应拍说话者、听者反应还是双人关系。
- 角色进出场、移动、轴线改变或连续三个紧景后，评估是否需要重新建立空间。

反应镜头不是次要素材。正反打可以在说话者和听者反应之间组织意义，因此模型输出必须显式给出 `focus_role` 和 `focus_reason`，不能把第一句说话者永久当作整个合并镜头的主体。[来源](https://www.studiobinder.com/blog/shot-reverse-shot-cutaways-coverage)

## 推荐协议

大模型不应输出 XYZ 坐标，但需要输出足够完整的镜头语义：

```json
{
  "dialogue_ids": ["204803", "204804"],
  "shot_size": "MCU",
  "coverage": "clean_single",
  "subject": "B",
  "look_target": "A",
  "horizontal_angle": "three_quarter_front",
  "camera_height": "eye",
  "screen_position": "right_third",
  "lens_mm": 50,
  "axis_id": "axis-A-B-01",
  "pair_id": "pair-01",
  "focus_role": "listener",
  "focus_reason": "追问后保留林澈的迟疑反应",
  "transition_intent": "matching_reverse"
}
```

Three.js 负责把语义转成候选机位并做投影验证。大模型决定“为什么拍、拍谁、希望是什么画面”，几何求解器决定“摄影机具体放在哪里”。

## 推荐执行管线

1. 按进出场和叙事节拍划分镜头段。
2. 为每段确定视觉主体与镜头功能。
3. 基于角色朝向、行动轴和目标景别生成多组机位候选。
4. 将角色关键点投影到 16:9 和 21:9 画框。
5. 硬约束过滤不合格候选。
6. 按正面程度、景别节奏、30°变化、遮挡和叙事意图评分。
7. 使用整段序列优化选择总分最高的组合。
8. 输出实测标签、违规说明、规则集版本和规则集指纹。

规则表更新后，应先经过 Schema 校验，再生成本地只读快照。网络不可用时使用最近一次有效快照，避免在线表格故障阻断规则导演。
