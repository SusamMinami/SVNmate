# 镜头沙盘镜头语言规则库 v1.3

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

- 单人镜头的关系轴由当前 `subject` 与 `look_target` 的位置动态建立。
- 多人场景可以同时存在多条角色对轴线，不使用一条固定全场轴线约束所有对话。
- 同一角色对的连续镜头保持在其关系轴同一侧。
- 切换角色对时，优先让前后关系轴共享一个角色，形成转折点或枢轴过渡。
- 两条关系轴没有共享角色时，先用群像、轴上中性镜头、切出镜头或可见运动重建空间。
- 正反打中的两人应保持相反的屏幕视线方向。
- 连续拍摄同一主体时，机位方位变化优先不小于 30°。
- 角色移动会改变关系轴；只有观众看见移动过程，后续机位才可按新轴线重新布置。

轴线是当前互动双方或角色与目标之间的关系线。Cadrage 对多人桌边场景的说明明确指出：当角色转向另一位对象交谈时，会在新的两人之间建立新关系线；Filmmakers Academy 也指出角色移动后轴线可以重建。多人场面因此需要管理一组关系轴，而不是锁定一条世界坐标线。[Cadrage](https://www.cadrage.app/the-180-degree-rule-in-filmmaking/) [Filmmakers Academy](https://www.filmmakersacademy.com/glossary/axis-of-action/)

康奈尔关于电影空间认知的研究显示，180°规则有助于观众更快判断角色位置，建立镜头则用于持续刷新空间关系。这意味着动态轴线不能只做数学换线，还必须保留观众可理解的过渡。[Cornell](https://ecommons.cornell.edu/items/7dd0b8a5-46fa-4219-a78e-e02eee532b2a/full)

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

反应镜头不是次要素材。正反打可以在说话者和听者反应之间组织意义，因此模型输出必须显式给出 `coverage_intent` 和镜头意图，不能把第一句说话者永久当作整个合并镜头的主体。[来源](https://www.studiobinder.com/blog/shot-reverse-shot-cutaways-coverage)

## 单人、双人和群像覆盖

镜头人数不是景别的同义词。单人镜头可以是全景或近景，双人镜头也可以是中近景；规则导演先判断当前叙事重点属于个人还是关系，再选择覆盖人数与景别。

| 覆盖意图 | 优先画面 | 使用条件 |
| --- | --- | --- |
| `establish_geography` | 双人或群像全景 | 场景开始；前三镜至少出现一次 |
| `reestablish_geography` | 双人或群像全景 | 角色加入、角色离场后的下一镜、无共享角色换轴、连续紧景后 |
| `relationship` | 双人镜头或带群中景 | 冲突、连接、谈判、共同利益、身体语言 |
| `shared_reaction` | 双人、带群或群像 | 同一信息同时影响多位角色 |
| `individual_perspective` | 单人或过肩 | 明确采用某一角色视角 |
| `individual_emphasis` | 单人近景或特写 | 重要台词、决定、隐瞒、脆弱或权力转折 |
| `reaction` | 单人反应或必要时共同反应 | 沉默、迟疑、情绪变化和听者反应 |

Adobe 将主镜头定义为覆盖人物、动作与空间关系的全景，并指出它可在任何时刻帮助观众重新定位场景地理。项目因此规定：前三个镜头内只要已有至少两人在场，就必须有一个覆盖全部当前角色的关系全景；角色进入或离场改变空间关系后也必须重新建立。[Adobe Master Shot](https://www.adobe.com/sa_en/creativecloud/video/production/cinematography/camera-shots-and-angles/master-shot.html)

双人镜头不是单人正反打的过渡素材。它让观众同时读取距离、姿态、共同反应和权力变化，适合关系本身是重点的段落；群像则把重点扩大到社会结构、阵营和集体能量。[StudioBinder Two Shot](https://www.studiobinder.com/camera-shots/framing/two-shot/)

单人镜头把其他角色排除在画外，会强化人物内心、决定、孤立和情绪暴露。因此普通说话行为不足以单独构成使用单人的理由，必须具有 `individual_perspective`、`individual_emphasis` 或 `reaction` 意图。[StudioBinder Single Shot](https://www.studiobinder.com/camera-shots/framing/single-shot/)

规则导演的默认序列策略：

1. 场景开端用双人或群像全景建立当前人物关系。
2. 普通双方互动优先双人镜头；三人以上优先带群中景。
3. 重要个人节点才收紧为单人近景或反应镜头。
4. 新角色进入时立即用全景展示全部当前角色。
5. 离场镜头仍保留离场角色，下一镜用全景展示剩余角色。
6. 连续三个紧景后，下一普通节点回到关系全景。
7. 短场景若以连续单人结束，结尾优先回到双人关系镜头表达共享结果。

## 构图语法

构图不是独立于剧情的“漂亮画面模板”。规则导演先判断镜头功能和情绪，再选择构图模式；几何求解器负责把语义落到屏幕坐标，投影验收负责确认实际画面。

| 构图 | 适用场景 | 情绪作用 | 当前机器执行 |
| --- | --- | --- | --- |
| 三分法 | 普通对话、过肩、环境人物 | 自然、开放、有方向感 | 眼睛靠近左右上三分交点，检查视线空间 |
| 中心构图 | 正面揭示、宣告、独处、重建空间 | 直接、强制、孤立 | 主体视觉落点接近中轴 |
| 黄金分割 | 情绪近景、安静观察 | 细腻、有机、比三分法更柔和 | 眼睛靠近 0.382/0.618 的黄金落点 |
| 对称构图 | 仪式、秩序、权力中心、封闭空间 | 稳定、正式、压迫或人工感 | 画面视觉重量接近中轴 |
| 不对称平衡 | 权力不均、关系试探 | 张力、运动感、关系不稳定 | 主体偏置，另一侧由角色或有意义空白平衡 |
| 负空间 | 孤独、缺席、等待、威胁 | 脆弱、悬念、压迫 | 声明 `look_room`、`isolation` 或 `pressure` |
| 三角构图 | 三人以上群像、三方关系 | 稳定且有层级 | 与三角站位结合，保持至少三个可读顶点 |
| 纵深层次 | 多人建立、环境叙事 | 空间感、关系层次 | 使用前中后景距离带并继续检查轮廓重叠 |
| 对角线 | 动作、冲突升级、失衡 | 动势、紧张、不稳定 | 需要场景线或运动轨迹数据后才可验收 |
| 框中框 | 窥视、禁锢、空间转换 | 隔离、观察、边界感 | 需要门窗等环境几何后才可验收 |
| 引导线 | 走廊、道路、建筑边缘、光线 | 引导注意、制造纵深 | 需要场景线段和焦点数据后才可验收 |

三分法把画面划分为九宫格并用交点组织重点，可同时建立自然平衡和视线空间；中心与对称构图则更直接、正式。负空间既能突出主体，也能通过“本应被填满却仍为空”的区域表达孤独或悬念。[StudioBinder 构图目录](https://www.studiobinder.com/camera-shots/composition/) [Adobe 构图基础](https://www.adobe.com/creativecloud/photography/technique/composition.html)

黄金分割的横向落点使用画面宽度的 `0.382 / 0.618`，转换为 NDC 后约为 `-0.236 / +0.236`。它不是比三分法更高级的硬规则，而是一种更靠近中部、更柔和的偏置选择。

### 人物画面空间

- 普通对话在角色注视方向保留 `look room`，当前最低软阈值为画面宽度的 `14%`。
- 近景头部空间随景别收紧；压迫构图可以有意减小，但必须声明 `negative_space=pressure`。
- `isolation` 通过较小主体和较大空白表达孤独；不能把错误偏框自动解释为负空间。
- 群像按投影面积计算视觉重量中心；对称镜头要求其横向偏差不超过 `0.12 NDC`。

## 上下镜构图匹配

每个镜头使用 `composition_transition` 声明与前镜的关系：

| 转换 | 用途 | 验收 |
| --- | --- | --- |
| `recenter` | 建立或重新建立空间 | 当前主要视觉重心回到中轴附近 |
| `match_eye_trace` | 连续动作、反应、同一信息点 | 前后主要落点水平偏移不超过 `0.35 NDC` |
| `mirror_reverse` | 正反打 | 主体分处中轴两侧，离中轴距离差不超过 `0.20 NDC` |
| `progressive_shift` | 情绪逐步收紧或权力转移 | 视觉重心有方向地移动，不产生无动机跳跃 |
| `contrast` | 揭示、惊吓、关系断裂 | 允许大幅改变，但必须有叙事理由 |

眼迹匹配的目标不是把每个镜头都锁在同一位置，而是在切点让观众不必无意义地重新搜索。Walter Murch 将 eye trace 视为有效剪辑的重要条件；Adobe 也将其描述为通过构图、调度、颜色、光线或剪切把注意力引到下一画面的目标区域。[Walter Murch Rule of Six](https://www.studiobinder.com/blog/walter-murch-rule-of-six) [Adobe 连续性剪辑](https://www.adobe.com/creativecloud/video/hub/ideas/what-is-continuity-editing-in-film.html)

连续构图的默认策略：

- 建立镜头使用 `recenter`，先给观众稳定空间锚点。
- 匹配正反打使用 `mirror_reverse`，双方在左右三分点或黄金点互补。
- 同一反应或动作延续使用 `match_eye_trace`。
- 情绪升级可从三分法向黄金分割或中心逐步收紧，使用 `progressive_shift`。
- 连续三个以上镜头避免无动机地重复同一侧、同景别和同构图；变化仍须服从轴线、视线和叙事节拍。

## 推荐协议

大模型不应输出 XYZ 坐标，但需要输出足够完整的镜头语义：

```json
{
  "schema_version": "shot-plan.v4",
  "dialogue_ids": ["204803", "204804"],
  "template": "reverse_medium",
  "subject": "B",
  "look_target": "A",
  "camera_height": "eye",
  "composition_mode": "rule_of_thirds",
  "visual_anchor": "right_third",
  "negative_space": "look_room",
  "composition_transition": "mirror_reverse",
  "coverage_intent": "individual_perspective",
  "lens_mm": 50,
  "intent": "在 A 的近景后切到 B，形成同一 A-B 关系轴上的匹配反打。"
}
```

大模型必须声明 `subject`、`look_target`、`coverage_intent` 和四个构图字段。Three.js 据此生成稳定的无序关系轴 ID（例如 `A-B`）、同侧机位、逐镜头朝向覆盖、视觉落点和投影验收。景别和画面构成由模板提出、由投影结果确认。大模型决定“为什么拍、拍谁、看向谁、采用个人还是关系覆盖、怎样组织画面”，几何求解器决定“轴线在哪里、摄影机具体放在哪里、实际构图是否成立”。

## 推荐执行管线

1. 按进出场和叙事节拍划分镜头段。
2. 为每段确定覆盖意图、视觉主体和镜头功能。
3. 基于角色朝向、行动轴和目标景别生成多组机位候选。
4. 将角色关键点投影到 16:9 和 21:9 画框。
5. 硬约束过滤不合格候选。
6. 按正面程度、景别节奏、30°变化、遮挡和叙事意图评分。
7. 使用整段序列优化选择总分最高的组合。
8. 输出实测标签、违规说明、规则集版本和规则集指纹。

规则表更新后，应先经过 Schema 校验，再生成本地只读快照。网络不可用时使用最近一次有效快照，避免在线表格故障阻断规则导演。
