# StudioBinder 镜头语言提炼

更新日期：2026-08-23

> 文档状态：研究参考。本文保存来源提炼，不作为当前机器协议；现行规则以
> `shot-language-rulebook.md` 和 `shot-language-rules.v1.json` 为准。

本文整理 StudioBinder Camera Shots 目录及其景别、角度、画面关系、运动、
焦点、镜头、构图和灯光子项，并记录哪些内容已经进入镜头沙盘规则。

## 总体方法

StudioBinder 把一个镜头拆成多个可组合维度：

1. Shot size：观众看到多少人物与环境。
2. Angle：观众以怎样的权力和心理位置观察。
3. Framing：画面中有谁，他们之间是什么关系。
4. Movement：观众的注意力和空间位置如何在镜内变化。
5. Focus：哪个景深层次清晰，注意力是否在镜内转移。
6. Lens：空间被扩张、自然呈现还是压缩。
7. Composition：正负空间、视觉重量和焦点如何组织。
8. Lighting：如何进一步引导注意和表达情绪。

项目采用的核心原则是：每个参数共同服务一个主要叙事目标。一个镜头可以
组合多种技术，但不能为了“丰富”而堆叠互相竞争的效果。

## 已落地规则

### 正负空间与视线空间

- Negative space 是主体周围或主体之间没有主要视觉信息的区域；它不天然
  等于角色脸后方的空间。
- 普通对话使用 look room：角色看左时放在画面右侧，角色看右时放在画面
  左侧，让主要空白位于视线前方。
- 脸后方空白大于视线前方属于 short-side framing。它会产生受阻、困住、
  对抗或不安感，只能在 `negative_space=pressure` 时有意使用。
- `isolation` 要同时满足叙事证据和显著空白。普通停顿、犹豫或省略号不
  自动等于孤独。
- 几何验收同时记录 `lookRoom` 与 `backRoom`。普通视线空间要求
  `lookRoom >= 0.14`，且不得无动机小于 `backRoom`。

### 焦点与空间层次

- 每镜必须有明确主焦点。单人或浅景深镜头只保留一个主要注意对象。
- Deep focus 适合让观众同时读取前景、中景和背景中的动作或人物关系。
- Shallow focus 适合隔离角色、强化情绪或隐藏尚未揭示的信息。
- `depth_of_field` 描述清晰范围；`layered_depth` 描述人物和物体在
  前中后景的空间排列，二者不能互相替代。
- 前景元素可以建立深度、观察感和关系压力，但不能无意遮挡主体。

### 人数与关系

- Single 是画面关系，不是景别；它可以是宽景、中景或近景。
- Two-shot 让观众同时读取距离、身体语言和同步反应。
- Three-shot 应明确三人关系：均匀分布表示团结或平衡，中心前置表示
  领导，两人靠近而第三人拉开表示阵营变化或孤立。
- Group shot 表达更大的集体结构，不能把三人关系的细节无差别稀释。

### 静态与动态

- Static shot 不是缺少设计。它能让观众研究画面、读取表演、承受停顿，
  并通过不移动制造克制或紧张。
- Push-in 聚焦情绪、信息或领悟；Zoom-in 只改变视场。二者画面放大结果
  相似，但空间透视不同，不能混用名称。
- 运动和静止应形成对照。一个场景持续运动后突然锁定，或持续静止后首次
  推近，本身就能成为叙事重音。

## 能力边界

以下技巧具有价值，但当前协议缺少可靠输入或渲染能力，因此只记录为后续
扩展，不允许模型用现有字段伪装：

| 技巧 | 叙事价值 | 启用前需要 |
| --- | --- | --- |
| Rack focus | 不切镜转移注意、揭示信息、连接两人反应 | 起止焦点对象和真实景深渲染 |
| Split diopter | 同时保持远近主体清晰，表达冲突或并置 | 分区焦点与镜头附件语义 |
| POV | 建立主观体验、共情或不可靠叙述 | `observer` 和可寻址观察目标 |
| Insert | 强调关键道具或动作细节 | 可寻址道具/场景对象 |
| Tilt | 固定机位垂直揭示规模、力量或发现 | 独立的起止俯仰角 |
| Arc | 环绕固定主体，强调选择、浪漫、英雄感或恐慌 | 轨迹方向、弧度和越轴策略 |
| Whip pan | 紧急转移、喜剧节奏、因果或转场 | 速度曲线、运动模糊和终点主体 |
| Snorricam | 主体锁定而背景运动，表达恐慌或心理失衡 | 角色绑定机位和角色移动轨迹 |
| Overhead | 抽离、监视、秩序/混乱和空间图案 | 俯视模板、环境尺度与顶部遮挡 |

## 本次负空间诊断

原规则导演把所有以省略号开头的台词都设置为 `negative_space +
isolation + dolly_out`。这会把普通思考、迟疑或承认错误过度解释为孤独，
导致不必要的大面积空白。

同时，摄影机求解器虽然计算了视线前方空间的最低值，但没有测量脸后空间，
也没有把前后比例加入候选评分。语义锚点不合适时，候选机位可能仍被接受。

修正后：

- 普通停顿使用稳定的情绪近景和正常 look room。
- 只有明确孤立证据才使用 `isolation + dolly_out`。
- 画外威胁可以保留前向负空间，但不会自动拉远。
- `look_room` 优先选择前方空间大于后方空间的候选。
- `pressure` 则反向要求短边视线，并保留最小边缘安全距离。
- 参数面板显示“视线前/后”实测值，便于人工复核。

## 真实数据审计

使用 `C:\trunk\doc\csvdir` 在 2026-08-23 扫描可成功生成的 1,585 段对话，
共 10,274 个镜头，其中 6,086 个镜头具有可测量的前后视线空间：

- 普通 `look_room` 中，前向空间明显小于脸后空间：0 个。
- 非 `pressure` / `isolation` 镜头中，脸后空白超过半幅且明显大于前方：
  0 个。
- `pressure` 短边镜头：541 个，全部满足前向空间小于脸后空间。
- `isolation` 镜头：1 个，仅在文本存在明确孤立证据时生成。

## 来源

- [StudioBinder Camera Shots](https://www.studiobinder.com/camera-shots/)
- [Shot Size](https://www.studiobinder.com/camera-shots/shot-size/)
- [Camera Angles](https://www.studiobinder.com/camera-shots/camera-angles/)
- [Framing](https://www.studiobinder.com/camera-shots/framing/)
- [Camera Movements](https://www.studiobinder.com/camera-shots/camera-movements/)
- [Focus](https://www.studiobinder.com/camera-shots/focus/)
- [Camera Lenses](https://www.studiobinder.com/camera-shots/camera-lenses/)
- [Composition](https://www.studiobinder.com/camera-shots/composition/)
- [Lighting](https://www.studiobinder.com/camera-shots/lighting/)
- [Negative Space](https://www.studiobinder.com/camera-shots/composition/negative-space-in-film/)
- [Rule of Thirds](https://www.studiobinder.com/camera-shots/composition/rule-of-thirds-in-film/)
- [Depth in Film](https://www.studiobinder.com/camera-shots/composition/depth-in-film/)
- [Foreground](https://www.studiobinder.com/camera-shots/composition/foreground-in-film/)
- [Focal Point](https://www.studiobinder.com/camera-shots/composition/focal-point-in-film/)
- [Static Shot](https://www.studiobinder.com/camera-shots/camera-movements/static-shot/)
- [Push-In Shot](https://www.studiobinder.com/camera-shots/camera-movements/push-in-shot/)
- [Arc Shot](https://www.studiobinder.com/camera-shots/camera-movements/arc-shot/)
- [Rack Focus](https://www.studiobinder.com/camera-shots/focus/rack-focus-shot/)
- [Split Diopter](https://www.studiobinder.com/camera-shots/focus/split-diopter-shot/)
- [POV Shot](https://www.studiobinder.com/camera-shots/framing/pov-shot/)
- [Three Shot](https://www.studiobinder.com/camera-shots/framing/three-shot/)
