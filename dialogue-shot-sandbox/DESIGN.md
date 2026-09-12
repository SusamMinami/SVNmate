---
name: 镜头沙盘
description: A desktop field-engineering interface for UE4 dialogue staging and shot design.
colors:
  ink: "#191919"
  paper: "#F2F2F0"
  surface: "#FFFFFF"
  surface-muted: "#E9E9E5"
  border: "#CACBC5"
  text-muted: "#686A65"
  signal: "#FFFA00"
  state: "#00B978"
  spatial-cyan: "#18D1FF"
  warning: "#A76816"
  danger: "#C84B3A"
  actor-warm: "#F06B4F"
  actor-cool: "#2F96E8"
typography:
  display:
    fontFamily: "Arial Narrow, Roboto Condensed, Microsoft YaHei UI, sans-serif"
    fontSize: "82px"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "normal"
  title:
    fontFamily: "Segoe UI Semibold, Microsoft YaHei UI, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  section:
    fontFamily: "Segoe UI Semibold, Microsoft YaHei UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  control:
    fontFamily: "Segoe UI, Microsoft YaHei UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Segoe UI, Microsoft YaHei UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  data:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  metadata:
    fontFamily: "Segoe UI, Microsoft YaHei UI, sans-serif"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  micro:
    fontFamily: "Segoe UI, Microsoft YaHei UI, sans-serif"
    fontSize: "8px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "normal"
rounded:
  control: "2px"
  compact: "4px"
  control-hover: "5px"
  overlay: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  inspector-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.overlay}"
---

# Design System: 镜头沙盘

## Overview

本文件只维护视觉系统、布局、组件和交互反馈。产品范围见 [PRODUCT.md](PRODUCT.md)，
数据字段、算法、事务和工作流按 [docs/README.md](docs/README.md) 路由到专题，
不在视觉规范中再复制一份。

Windows 桌面工程工具，以对白、站位确认、镜头检查与安全导出为中心。
原创视觉方向为 `Endfield field engineering`，辅以 `Arknights information system`；
全局 moderate，中央视口可局部 complex。不复制参考官网 Logo、图片、字体、
着色器或代码，不从官网请求运行时素材。

## Colors

frontmatter 是设计 token 表；运行时映射见 `src/styles.css`，青色对应 `--ark-cyan`。
中性色至少占可见面积 80%。信号黄只表示主操作/持久选中，同屏一个主要黄色焦点；
青色表示空间与数据连接，绿色表示已验证/成功，红色表示危险/失败。
A/B 角色色是业务数据，不能被品牌色覆盖；硬失败、软建议与说明不得共用红色。

## Typography

- 中文使用 Segoe UI / Microsoft YaHei UI 回退栈，正常字距。
- 正文最低 11px，紧凑数据 10px，次级元数据 9px，非必要微标签最低 8px；
  不能为了塞内容继续缩字。
- 技术数据用 Cascadia Code / Consolas，镜头号、节点 ID、焦距与时长用等宽数字。
- 窄体大编号只用于大展示面；紧凑工作区不使用 hero 字号。
- 英文微标签只标类别、单位和状态，不重复完整中文。

## Layout

### 工具轨道与顶栏

- 固定轨道按顺序放分镜、NPC 注册、任务目标物、NPC 迁移、动画语音；
  底部“设置与更新”打开设置层，不是第六工作区。
- 轨道 56px，hover 或键盘可见焦点时覆盖式展开到 196px，不重排工作面；
  普通点击焦点不锁住展开。图标不移动，独立灰色确认框负责 hover/选中。
- 产品名与版本只在轨道顶部；各工作区顶栏显示自身名称，不重复品牌标题。
- 顶栏右侧依次为配置小窗、协作连接、数据源等距图标。低频状态放弹层，
  左栏不常驻连接卡。返修案例归数据源详情，完整目录路径归设置。
- 分镜工作台是左侧镜头列表、中央视口、右侧检查器；其他工作区沿用壳层，
  采用完整表格、专用编辑窗口和固定底栏，不把页面分组做成漂浮卡片。

### 状态与导航

- 五个工作区首次访问懒加载；普通切换保留已访问表单、勾选、子视图、结果和反馈，
  隐藏时不主动刷新。配置小窗卸载工具、镜头列表和 Canvas，详见
  [节点配置](docs/node-configuration.md)，不能再写成全部工作区始终挂载。
- 按轨道顺序上下切换，480ms 内整页同时进出，结束才隐藏旧页；中性页边阴影，
  不使用扫线、黄分隔或短距离假位移。新读取/新任务才按操作语义刷新旧状态。
- 设置、授权、冲突和高风险确认用模态框；长表与连续编辑使用专用窗口。
- 状态弹层点击外部或 Escape 关闭，不放额外关闭按钮；首次占位选择和首次设置
  则必须允许显式关闭。不能混用两种规则。
- 四位 ID 只加载本地对白；“读取 BP 站位”和导演入口是显式下一步。
  区分未设计、UE 已有镜头和导演生成；BP 失败时保留对白和可读镜头。
  完整状态转换见 [分镜工作流](docs/storyboard-workflow.md)。

### 工作区特定布局

| 工作区 | 保留的交互 |
| --- | --- |
| NPC 注册 | 右上悬浮读取/返回，不重复标题；批量复用和地图选择作用于兼容已选项 |
| 任务目标物 | 右上读取，底栏清除/同步/加载/注册；BP 后的节点覆盖项默认折叠为 32px 图标，有值显示状态点，展开输入不超过 160px |
| NPC 迁移 | 三个等宽大图标入口；子流程仅保留网格返回，不并排另放返回分镜箭头；动作清单左上批量选择、默认最近修改排序并显示时间 |
| 动画语音 | 顶部单行目录/扫描/进度，左侧可筛选清单，右侧字幕时间/配置检查；精确差异固定在主滚动区外、底栏上方 |

任务目标物六位节点流程先计算站位，再确认写入；左侧俯视图固定，仅右侧角色列表
滚动。UE 选择审核居中显示 Actor、类型、组件名、Transform 和增改状态；匹配结果
进入位置编辑器时直接复用，不重复读取。字段规则归 [目标物规范](docs/mission-target-preview.md)。

NPC 动作表展示 Body/Face 配对，面部曲线与 Montage 独立复选；勾选变化自动刷新
审核令牌并暂时禁写，不要求重复点击生成清单。设置页 NPC 动作库与运行时并排，
多个根目录用紧凑下拉增删；飞书与端侧模型并排、行高统一，长路径 hover 查看。
业务规则归 [NPC 迁移](docs/npc-migration.md)。

首次设置只选 res/doc 两个根目录，分别显示就绪状态，展示推导出的目标物 Excel
路径；不展开逐表配置、不重复产品标题。失败保留原数据源，目录就绪后查询仍为空。

## Elevation & Depth

1px 分隔和浅色层次承载常驻内容。阴影只给真正覆盖内容的弹层、轨道展开态和中央
视口局部深度；重要性用位置、标签与状态表达，不用装饰阴影。

## Shapes

控件默认 2px 圆角，hover 最多 5px，弹层 6px。面板不嵌套卡片。
斜切、网格和刻度仅用于启动页、视口和空状态；表格保留固定表头/操作栏。

## Components

### 设置状态

- 环境检查统一用绿色勾号表示就绪、琥珀色叹号表示待配置/待连接、灰色旋转图标
  表示真实处理中、红色叉号表示异常；悬停或键盘焦点显示具体状态。
- 首次打开先呈现灰色空心图标，240ms 后按双列阅读顺序每项错开 65ms，
  在固定 20px 图标位内用 260ms 揭示真实状态，总时长不超过 1.25 秒。
  异常不延迟，业务数据、按钮、错误正文不参与入场占位，不增加检测请求。
- 完成或用户开始点击/键盘操作即结束引导并在本机记住；后续打开立即显示真实状态。
  减少动态效果时直接显示结果，处理中保留静态图形与状态说明；慢请求仍保持处理中。
- 资料库授权不等于已有资料：音乐尚无条目时显示待同步，同步失败显示异常。

### 按钮与反馈

- 普通按钮 hover 在 200ms 内转深底白字；图标保持位置、大小与角度。
- 导演分段按钮 hover 有背景与底边反馈，未选用青色底线，已选深底黄色线。
- 黄色左条只给持久选中/主动作，不是普通 hover。主按钮左条可在 200ms 内变箭头
  右移 4px；loading 圆环替换同一指示位，不在右侧堆第二个图标。
- 按下 80ms 缩放到 98%，不改布局尺寸；禁用不播放 hover。图标有 `title`
  与可访问名称，进度/成功/失败不只靠颜色。
- UE 长读取显示具体阶段；地图仍在加载时不能提前报失败。

### 镜头列表与检查器

- 固定高度镜头行，共享选中背景 300ms 移动；普通 hover 不移动编号或整行。
  硬失败红条/“未通过”，软建议警示色/“有建议”，已修正标签作为说明。
- 角色色块显示模型槽序号而非内部 A/B 标记，无 BP 时按 `0..N`。演员转身与
  Montage 在导演页独立展示，不塞到镜头理由。
- 四页互斥：导演（梗概/动作/理由/全场分析/站位）、镜头（参数/验收/构图）、
  音频（已有配置/建议/试听）、UE（动作/坐标/警告/导出）。
- 切镜保留页签；梗概默认收起，同对话保留展开状态，新对话重置。
  左侧模式行显示 AI 进度，导演检查器显示逐镜候选评分、采用项和理由。
  采用/拒绝按钮在镜头标题行，不能隐去 AI 中间判断。
- 完整窗口动作按台词节点折叠，支持角色、多动作、延迟与拖拽排序；
  候选菜单连续滚动、同时约 8 行，空白项不提交，既有动作只读。
- 小窗不重复节点折叠栏，视线在动作上方，两栏独立收纳并保留草稿；
  镜头按钮只选方案，唯一写入按钮固定底栏。完整规则含状态灯、滚动、取消和
  dirty 例外统一归 [节点配置](docs/node-configuration.md)。

### 导出与编辑

- 分镜导出默认当前镜头，右上“全部导出”切换多镜头；标题明确范围，
  镜头/动作/音效/音乐独立勾选、默认展开，可折叠但不清选择。
- 首先展示本地清单，确认范围后才读 UE 差异；最终覆盖确认、取消与保存固定底栏。
  dirty 提示支持原地刷新，不要求关闭重来。字段与保存归
  [导出协议](docs/dialogue-camera-export-design.md)。
- 文字搜索结果左栏右下铅笔按钮打开独立编辑器；批量替换逐行复选并有预览/确认。
- 动画语音清单逐项展示未扫描/失败/已读取，停止保留结果，失败项可单独重扫；
  切动画保留草稿，显式重读成功才重置。
- 字幕页语音扩展沿用 Segoe UI 与紧凑工程布局；显式选择 Wwise 语音事件并读取
  CN 媒体，多媒体必须手选。原生播放器旁显示媒体来源、裁剪范围与源音频零点对应
  的动画时间；裁剪不改变零点，核对映射后才允许开始。
- “正式台词强制对齐”与“语音转文字”（ASR）用互斥分段按钮；正式台词列表可折叠，
  逐行勾选并上下调整顺序。任务显示阶段进度并可取消；不自动播放、不自动推理，
  工作区隐藏时暂停播放器与任务轮询。
- 结果逐行独立显示“待试听/试听中/已试听”，与警告并存，不以警告替代试听状态。
  语音面板警告文字局部使用 `#8A5612`（paper 上对比度 5.48:1），不改全局 warning token。
- 结果默认不勾选，逐行标记“已采用”；未采用项保持待选，可分多批采用到字幕草稿，
  不写 UE。字幕段显示“强制对齐/语音识别”时间来源；动画快照或字幕编辑已变化时
  拒绝采用过期结果，防止覆盖较新草稿。
- 底栏仍是唯一 UE 写入入口，从“检查写入差异”转为“确认写入 UE”，草稿变化即使
  审核失效。边界与历史验证归 [动画语音](docs/animation-voice-workspace.md)。

### 音频

- UE 已有音频与待写建议分开，建议只显示当前覆盖节点。长资产名换行；
  缺媒体禁用播放并说明 Event/WEM/解码器等具体原因，检查中显示 loading。
- 播放只改变所在行背景，不加侧条；跨检查器页签继续播放，暂停入口在音频页签，
  切一级工作区则停止。失败为行内错误，无匹配保持空状态。
- 资料库先分类再列资源；音乐可属多个标签。资源成功开始试听后才显示左侧应用
  图标，再点取消节点选择。小窗控件置顶、使用同一主滚动区。
- 配乐显示名称、状态、理由与播放；有效缓存可展示 BPM/能量/频谱摘要。
  全量选择在导出弹窗，与镜头分组。

### 视口与场景工具

- 镜头画布固定 16:9，21:9 遮幅只标安全区，不缩放 Canvas。SHOT 编号、角色带、
  左下状态共用视口坐标，切俯视不移动这些元素。视图切换有 `aria-pressed`。
- 有分镜时角色“槽位色块 + 名称”在顶部遮幅单行，溢出拖动横滚，hover/焦点查看
  完整状态；无分镜才在左栏显示名单。身高/体型来源放原 tooltip，不增常驻行。
- 体型代理身体可非等比，头脸保持等比；脚底偏移与角色原点分离，比例眼高明示估算。
- 对白栏保留原换行，用画面外 76-132px 空间扩高，不缩画布；长文内部滚动，
  切节点回顶部。俯视同对话固定视域，缩略图紧凑框角色/轴线，允许裁切相机路径。
- 场景入口贴标题栏展开，限高表格、固定采集/应用栏；明示非实时快照，AI 分享
  默认关闭。角色标签不得盖住工具。失效、关闭焦点与落点交互见
  [场景 UI](docs/scene-reference-ui.md)。
- 指针探针只读显示归一化 X/Y 与视觉落点，110ms transform 追随、离开 180ms 淡出，
  不触发 React 高频重渲染，不修改相机/UE。

### Motion Timing

| 场景 | 时长与方式 |
| --- | --- |
| 按钮 hover / 轨道确认框 | 200ms；确认框从 94% 到 100% 淡入 |
| 轨道展开 | 300ms 宽度/标签透明度 |
| 检查器页签 | 300ms 裁切与 8px 位移；小窗不用 |
| 镜头/视图切换 | 420ms 浅色遮罩向右揭开，黄色窄边 |
| 主工作区切换 | 480ms 整页进出 |
| 启动内容 / 退出 | 600ms 分层进入 / 430ms 连续揭示 |

动效可中断；除明确加载指示外不循环超过 2 秒。镜头数据立即成为真实状态，
交互动效不修改 ShotPlan、时长、焦距、轨迹或 UE 数据。

### Launch Screen

深色背景配产品标志、数据源与版本，黄色仅为进度基线和退出边界。
每窗口会话一次，点击/Enter/Escape 提前进入，退出连续揭示工作区；
减少动态效果时近即时完成。

### Accessibility and Performance

所有交互支持键盘、明确焦点和非纯颜色状态，尊重 `prefers-reduced-motion`。
常规桌面不出现页面级横滚，长路径可读可复制。Three.js 按需渲染，运动期间才连续帧；
CSV Worker 分块解析，加载时禁查询。端侧模型请求租约和卸载参数只维护在
[端侧顾问](docs/rule-director-edge-advisor.md)，不让 UI 状态暗中启动推理。

## Do's and Don'ts

保持数据单一视觉所有者、固定空间关系、真实进度与精确写入范围。
不用随机 HUD、无含义坐标、大面积黄底、嵌套卡片或缩字制造“工程感”。
UI/3D 改动验证桌面截图、Canvas 非空、溢出和减少动态效果；不为本产品新增移动验收。
