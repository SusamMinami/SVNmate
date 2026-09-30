---
name: 角色创建工具
description: 沿用镜头沙盘的浅色工程工作台，使用紧凑控件与信号黄主操作。
colors:
  paper: "#f2f2f0"
  surface: "#fff"
  ink: "#191919"
  muted: "#686a65"
  line: "#cacbc5"
  signal: "#fffa00"
  green: "#256548"
  danger: "#ad3c30"
  warning: "#8a5612"
  hover: "#383838"
  inverse-muted: "#c9cbc5"
typography:
  body: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "12px", fontWeight: 400, lineHeight: 1.5 }
  app-title: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "17px", fontWeight: 600, lineHeight: 1.5 }
  headline: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "26px", fontWeight: 600, lineHeight: 1.25 }
  section-title: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "14px", fontWeight: 600, lineHeight: 1.5 }
  label: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "12px", fontWeight: 600, lineHeight: 1.5 }
  hint: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "11px", fontWeight: 400, lineHeight: 1.65 }
  metadata: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "10px", fontWeight: 400, lineHeight: 1.5 }
  code: { fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: "11px", fontWeight: 400, lineHeight: 1.5 }
rounded:
  square: "0"
  control: "2px"
  dialog: "3px"
  dot: "50%"
spacing:
  icon-gap: "7px"
  tight: "8px"
  compact: "10px"
  row: "12px"
  small: "16px"
  medium: "18px"
  section: "20px"
  gutter: "24px"
  editor: "30px"
components:
  button: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", typography: "{typography.body}", rounded: "{rounded.control}", padding: "7px 11px" }
  button-hover: { backgroundColor: "{colors.hover}", textColor: "{colors.surface}" }
  button-primary: { backgroundColor: "{colors.signal}", textColor: "{colors.ink}", typography: "{typography.label}", rounded: "{rounded.control}", padding: "10px 17px" }
  button-primary-hover: { backgroundColor: "{colors.ink}", textColor: "{colors.signal}" }
  button-source: { backgroundColor: "transparent", textColor: "{colors.ink}", rounded: "{rounded.control}", padding: "7px 11px" }
  button-reset: { backgroundColor: "transparent", textColor: "{colors.ink}", rounded: "{rounded.control}", padding: "5px 7px" }
  field: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", rounded: "{rounded.control}", padding: "7px 9px", width: "100%" }
  module-navigation: { backgroundColor: "transparent", textColor: "{colors.ink}", rounded: "{rounded.square}", padding: "12px 0" }
  tag: { textColor: "{colors.muted}", typography: "{typography.metadata}", rounded: "{rounded.square}", padding: "1px 5px" }
  career-row: { backgroundColor: "transparent", textColor: "{colors.ink}", rounded: "{rounded.square}", padding: "11px 10px", width: "100%" }
  career-row-selected: { backgroundColor: "{colors.ink}", textColor: "{colors.surface}" }
  inspector: { backgroundColor: "{colors.paper}", textColor: "{colors.ink}", rounded: "{rounded.square}", padding: "20px" }
  review-dialog: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", rounded: "{rounded.dialog}", width: "min(820px, calc(100vw - 32px))" }
---

# Design System: 角色创建工具

## Overview
**Creative North Star: "镜头沙盘式工程工作台"**

沿用 [PRODUCT.md](PRODUCT.md) 明确指定的镜头沙盘语言：浅纸色壳层、白色编辑面、黑白层级、少量信号黄、紧凑表单和细线分区。界面服务于精确的桌面操作，不做装饰性仪表盘。

**Key Characteristics:**
- 平面分区与细线层级，不使用悬浮卡片。
- 易读标签搭配低调的等宽数据。
- 选中、修改与反馈保持清晰区分。

以上 token 为规范值，模式取自 [src/styles.css](src/styles.css)、[src/App.tsx](src/App.tsx) 和 [src/Authoring.tsx](src/Authoring.tsx)。[侧车文件](.impeccable/design.json) 保存扩展与可直接渲染的示例；页面构成见[界面简报](docs/surface-brief.md)，本文件不承载功能规则。

## Colors
主色：**signal** 用于主操作和文本选区；**ink** 用于选中行及主按钮悬停。黄色不作为常规面板底色。

中性色：**paper** 构成壳层，**surface** 承载编辑器、控件和弹窗，**line** 分区，**muted** 呈现辅助文字。**hover** 用于普通按钮悬停，**inverse-muted** 保持深色行内次要文字可读。

状态色：**green** 表示字段修改、新值和成功，**danger** 表示错误，**warning** 表示警告。反馈须同时提供文字。已声明但未接入的 cyan、soft 不纳入设计 token。

## Typography
标签与正文使用系统 UI 字体栈，标识符及结构化值使用等宽字体栈。代码使用等宽数字和 `overflow-wrap: anywhere`，允许换行，不截断核对信息。

headline 用于编辑器标题，app-title 用于应用名称，section-title 用于分区，检查器标题复用 label。技术字段名使用 metadata 字号和等宽字体；输入值使用 body 字号和等宽字体，人类可读名称及说明文字除外。原生下拉框保留 UI 字体。弹窗标题为（19px），窄屏应用标题为（16px）；不引入展示字体或全大写字距。

## Layout
桌面壳层为 `100dvh`、最小高度（420px）的纵向 flex；顶栏（58px），工作区填满余高，底栏最小高度（58px）。默认三栏为 `224px minmax(0, 1fr) 300px`。导航列表、编辑器及检查器独立滚动；flex/grid 子项保留 `min-height: 0`、`min-width: 0`。

编辑器标题内边距为 `27px 30px 20px`，分区为 `25px 30px 30px`，检查器分区为（20px）。字段采用两个 `minmax(0, 1fr)` 列，间距（20px 24px），长控件跨两列；槽位组默认三列。

| 视口 | 已实现行为 |
| --- | --- |
| 至少 1600px | 三栏变为 `242px minmax(0, 1fr) 320px`；编辑器与模块导航左右内边距为 42px。 |
| 至多 1120px | 三栏变为 `190px minmax(0, 1fr) 242px`；编辑器左右内边距 20px，标题可换行，字段间距 18px，槽位变为两列，检查器分区内边距 17px。 |
| 至多 860px | 工作区改为 `175px minmax(0, 1fr)` 并可滚动；检查器移至下方通栏，其分区排为两列。导航与编辑器高度为 `max(480px, calc(100dvh - 150px))`；顶栏左右内边距 16px，隐藏标签。 |
| 至多 540px | 页面自然增高，工作区纵向堆叠；导航横向滚动，条目宽 157px；编辑器最小高度 480px；检查器分区纵向排列。模块导航横向滚动，编辑器左右内边距 16px，底栏吸附底部。字段仍为两列，间距 18px 12px；槽位仍为两列。 |

文本输入框、下拉框和文本域均为 `width: 100%; min-width: 0`。来源目录控件保持单行 flex、间距（10px）：图标和按钮不收缩，输入框可收缩。不得添加固定最小宽度或擅自改为窄屏堆叠。目录区内边距由 `16px 24px` 在窄屏变为（14px）；复制 ID 输入框最大宽度（170px），技能搜索最大宽度（350px）。

技能/Buff 作者区沿用编辑器分区，不另建壳层。全库检索采用 `minmax(80px, .6fr) minmax(100px, 1fr)` 两列，间距（10px 16px），检索结果跨两列，外边距为 `16px 0 10px`；此布局不套用上文技能搜索的最大宽度。作者区包裹控件的标签为单列 grid，间距（5px），可收缩；草稿选择器上下外边距为（16px）。

记录选择器与模板入口沿底边对齐，间距（12px），上方细线与内边距（20px）分隔上下文；选择器伸展，按钮不收缩。展开的模板表单使用 paper 底色、内边距（16px）、间距（12px）和上外边距（16px），生成按钮靠起始边。分组字段复用双列字段与槽位断点，不新增断点；组内字段区内边距为 `6px 0 24px`，数组字段跨整行。

## Elevation & Depth
常规层级依靠边框与底色，不使用卡片阴影或渐变。仅审核弹窗使用阴影 `0 18px 60px #0003`，遮罩为 `#19191955`，不模糊背景。反馈采用细线分隔的条带，不做悬浮通知。

## Shapes
控件使用 control 圆角，导航行与标签保持直角，弹窗使用 dialog 圆角。分隔线为（1px）实线，当前模块下划线与键盘焦点描边为（2px）。状态点为（5px）圆点，不做胶囊。图标使用小型内联描边 SVG，无需栅格图片。

## Components
- **按钮：**次操作白底，来源与恢复按钮透明底，主操作黄底。普通悬停为深底白字，主操作悬停为墨黑底黄字。禁用透明度 `.48`，使用默认光标；背景和文字共享（160ms ease-out）过渡，不添加按压位移。
- **输入框、下拉框与单选框：**使用细边框原生控件。标签在技术字段名和值上方；修改状态同时显示绿边与“已修改”文字。文本域可纵向缩放。单选框保持原生外观、`width: auto`、墨黑强调色、零外边距，标签间距（7px）。
- **键盘焦点与搜索：**控件和折叠摘要使用墨黑描边，偏移（3px）。搜索框将焦点描边移至容器，偏移（2px），取消内层输入框描边。保留真实标签与图标按钮的无障碍名称。
- **导航与列表：**模块按钮不填色，当前项使用墨黑下划线和粗体，悬停下划线使用 line 色。职业行以（46px）等宽 ID 列对齐名称和元信息，最小高度（59px）。选中行填墨黑，草稿圆点由绿变黄；保留 `aria-current` 与 `aria-pressed`。
- **标签与容器：**标签是小型描边元信息，不是操作。容器复用细线分区，不做圆角卡片。检查器行的次要 ID 靠右；旧值灰色删除线，新值绿色无下划线。回执上下文保持低调辅助文字，成功与错误条带提供明确说明。
- **弹窗：**使用原生 dialog，标题可见并通过 `aria-labelledby` 关联。头部、正文、底部内边距分别为 `20px 24px`、`22px 24px`、`14px 24px`；正文在 `calc(100dvh - 48px)` 高度约束内滚动。差异两侧为弹性列，中间箭头列宽（14px）；窄屏底部可换行。
- **动态：**仅按钮颜色过渡与（1s linear infinite）忙碌旋转。减少动态效果时取消动画和过渡，恢复自动滚动行为；不依赖旋转表达忙碌，文字反馈始终可读。

### 技能/Buff 作者组件
- **检索与记录选择：**当前职业技能、配置类型、全库检索、检索结果、已暂存配置与编辑记录使用可见中文标签和原生紧凑控件。当前职业技能通过 `htmlFor` / `id` 关联，其余使用包裹式 label；下拉框已有的中文 `aria-label` 与可见标签一致。全库检索保留输入框自身焦点，不使用容器式搜索框的焦点替换。
- **模板表单与草稿选择：**模板入口展开纸色内联表单，不使用弹窗或浮层；新 ID 与技能树 ID 输入框均由可见中文 label 包裹。已有草稿时显示选择器，以记录标题、ID 和“新建 / 修改”文字区分条目；操作沿用普通按钮，不新增强调色。
- **分组字段：**使用无边框 fieldset 包裹原生 details / summary，各组顶部分隔线、摘要上下内边距（14px），右侧以 metadata 显示配置项数量。首组默认展开，其余默认折叠；忙碌或读取时禁用字段集。枚举用 select，单值用一行或三行 textarea，最小高度（34px）；数组复用槽位输入，显示组标签和每槽标签。字段技术名及文本值沿用等宽字，修改状态仍为绿边加“已修改”。

**The Visible Label Rule.** 作者字段的无障碍名称关联可见中文标签，技术成员名仅通过 `aria-describedby` 提供说明。动态字段 ID 由组件 `useId()`、记录表名与目标 ID、字段名组成；select / textarea 的 `aria-labelledby` 指向字段标签，数组输入同时指向字段标签与对应槽位标签。描述 ID 指向可见 code；“已修改”位于标签引用之外，不混入控件名称。

## Do's and Don'ts
- **Do** 保留浅纸色壳层、白色编辑面和细分隔线。
- **Do** 保留原生控件、清晰键盘焦点及文字状态提示。
- **Do** 保留窄屏双列字段和可收缩的来源输入框。
- **Don't** 引入悬浮卡片、渐变、装饰性栅格图片或新强调色。
- **Don't** 用展示字体替换数据字体，或截断审核信息。
- **Don't** 添加已有过渡和忙碌指示之外的动态效果。
