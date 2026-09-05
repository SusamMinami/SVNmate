---
name: MigrationGuard
description: Evidence-first desktop workflow for validating multi-stage SVN migrations.
colors:
  canvas: "#E7EAED"
  surface: "#F2F2F0"
  evidence: "#FFFFFF"
  ink: "#191919"
  ink-secondary: "#343C45"
  muted: "#686A65"
  border: "#CACBC5"
  table-heading: "#E9E9E5"
  primary: "#FFFA00"
  primary-hover: "#DED900"
  data-flow: "#18D1FF"
  complete: "#16825C"
  submitted: "#047857"
  pending: "#B45309"
  blocked: "#B42318"
  review: "#6D5BD0"
typography:
  display:
    fontFamily: "Microsoft YaHei UI"
    fontSize: "18pt"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  title:
    fontFamily: "Microsoft YaHei UI"
    fontSize: "12pt"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Microsoft YaHei UI"
    fontSize: "10pt"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  data:
    fontFamily: "Microsoft YaHei UI"
    fontSize: "10pt"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  control: "4px"
  panel-max: "6px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 9px"
  result-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    height: "max(28px, font-linespace + 6px)"
---

# Design System: MigrationGuard

## Overview

**Creative North Star: "Evidence Relay Console"**

MigrationGuard 的视觉层级围绕“路线、阶段、证据、下一步”展开。它不是通用 Jira
看板，也不是欢迎式仪表盘；主表必须获得最大空间，用户应能快速扫出哪些文件完成、
待提交、需确认或阻断，并从同一行进入证据详情。

视觉语言参考运镜沙盒已有的 Ark 工程界面：浅色工程壳层、黑白信息层级、稀有信号
黄和青色数据流，但不复制其 Logo、图形资产或具体页面结构。MigrationGuard 使用
自己的“三阶段迁移与核验终点”图标。

**Key Characteristics:**

- 面向桌面宽屏的高信息密度。
- 单一粘贴入口和自动路线联动。
- 以文件证据表为视觉中心。
- 状态颜色始终配合图标或短标签。
- 高风险写入与只读复核在视觉上明确分层。

## Colors

中性工程灰与白色证据面承载大部分面积；信号黄只用于当前主动作，青色用于进行中的
数据流。绿色、橙色、红色和紫色只表达业务状态。

### Primary

- **Signal Yellow**：当前流程唯一主动作。
- **Data Cyan**：扫描、读取和传递中的数据状态。

### Secondary

- **Review Violet**：无法自动归属、需要人工判断的状态。

### Neutral

- **Audit Canvas**：窗口背景。
- **Evidence Surface**：输入、汇总、表格和详情工作面。
- **Primary Ink**：路径与主要结论。
- **Muted Metadata**：版本、作者、时间与说明。

### Named Rules

**The Evidence Color Rule.** 绿色只表示提交证据和本地状态同时通过，不能用于“已
扫描”或“窗口已打开”。

**The Red Means Blocked Rule.** 红色只表示未迁移、冲突、映射失败或无法继续；普通
提醒不得借用红色。

## Typography

**Display Font:** Microsoft YaHei UI Bold
**Body Font:** Microsoft YaHei UI
**Data Font:** Microsoft YaHei UI

**Character:** 全部中英文界面统一使用完整覆盖简体中文的 Microsoft YaHei UI，
避免 Segoe UI 或 Consolas 在中文处触发隐式字体回退。路径、revision 与单号依靠
列对齐和标点结构保持可扫描性，不为技术感额外引入字体。

### Hierarchy

- **Display**（700，18pt）：窗口产品名。
- **Title**（700，12pt）：弹窗标题和关键分组。
- **Body**（400，10pt）：按钮、表头、状态和正文。
- **Metadata**（400/700，9pt）：辅助说明与紧凑字段标签。
- **Data**（400，10pt）：路径、revision 与证据详情。

Tkinter 字号使用 point，不按 CSS pixel 解释。粗体使用同一字体族的 `bold` 权重，
不得再以 `Segoe UI Semibold` 作为独立字体族；Microsoft YaHei UI 不可用时依次
回退到 Microsoft YaHei 与 Segoe UI。表格行高必须基于正文实际行距计算。

**The Path Integrity Rule.** 长路径单行省略或横向滚动，永不通过缩小字号换取完整
显示。

## Layout

默认窗口目标尺寸为 1360x760；桌面最小尺寸以实现和验收统一后的值为准。顶部依次
为产品/固定表命令、源到目标路线、单号粘贴与解析、结果视图切换/状态筛选/进度。
主体使用 7:3 可调分栏，左侧结果表获取剩余空间，右侧详情可收起。“单号 / 资产”
切换、状态筛选与进度固定在同一行，不随表格刷新移动。

**The One-Paste Rule.** 单号来源只有一个粘贴区；解析后的映射进入单号页签和详情
区，不在输入区重复展示。

**The Stable Filter Rule.** 状态计数变化不能推动筛选按钮、表格或同行进度条改变
位置。

## Elevation & Depth

常驻界面使用背景层、1px 边界和可调分栏表达层级，不使用装饰阴影。设置、迁移
选择、提交审核和高风险确认作为真正的覆盖层，可使用原生窗口深度。

## Shapes

面板圆角不超过 6px，功能控件以小圆角矩形为主。状态不使用胶囊堆叠；筛选项采用
固定宽度分段或紧凑标签。图标按钮保持稳定方形尺寸。

## Components

### Buttons

- **Primary:** 每个流程阶段只保留一个信号黄主动作：解析、更新并复核、迁移或
  完成后的复核。
- **Secondary:** “刷新状态”“定位文件”等独立命令使用中性按钮。
- **Icon:** 设置和收起详情使用 16px 图标，并提供 tooltip 与可读名称。
- **Disabled:** 正在执行写操作时，同工作区其他写操作禁用但保持位置。
- **Feedback:** 所有按钮使用一致的深色悬停和按下反馈；持续选中、业务状态和
  主动作使用各自独立的视觉语义。
- **Contextual:** “定位文件”只在本地复核的资产叶子上启用；远端资产和目录
  没有可定位的工作副本文件。

### Inputs / Fields

- 粘贴区允许网页原文和多行任务，`Ctrl+Enter` 与“解析”触发相同行为。
- 自动解析结果在单号页签与右侧详情中展示，并在缺失或一对多映射时就地显示原因。
- 路线由源工作区联动推导；路线名称和右侧箭头打开同一个切换菜单，路径编辑只从
  右上角设置进入。

### Tables

- 主表行高以正文字体实际行距加 6px 计算，最小 28px；路径列伸缩，其余证据列
  保持稳定宽度。
- 状态列同时显示短标签和符号；选中行的完整证据在右栏展开。
- 文件、目录、Jira 进度和远端资产模式必须保留明确的列标题，不能只靠行色区分。
- 结果区使用“单号 / 资产”紧凑页签；单号视图按任务聚合并可展开资产，资产视图
  按路径去重并在详情区展示全部关联单号。
- 单号树把 `SERIA-*` / `OSCOA-*` 缩写为 `SER-*` / `OSC-*`，并把任务描述放在
  同一行；详情保留完整单号。缩写不得进入查询、缓存键或提交信息。
- 树节点内容被列宽截断时，鼠标悬停显示完整静态文本；不使用持续滚动文字干扰扫读。
- 资产详情中的关联单号使用当前资产或目录的聚合状态色，并保持粗体以区别普通证据。
- 路径层级只在左侧树中呈现，右侧详情不重复完整路径。

### Progress

- 状态筛选行右侧显示上次刷新或复核时间和进度条；高 DPI 紧凑模式隐藏时间但保留
  进度条，鼠标悬停或键盘聚焦可查看完整当前状态。
- 完成为绿、仍有待处理为橙、执行失败为红；颜色旁始终显示阶段文字。
- 两阶段 OB 流程必须明确显示当前阶段和阶段间门禁结果。

### Navigation

- 主窗口是单一工作面，不增加营销首页。
- 设置、批量迁移选择和提交审核用专用窗口；普通错误留在对应模块或文件行。
- 设置窗口按“工作区、固定表、核验策略”分组，保持标题、主体和保存栏的固定层级。

## Do's and Don'ts

### Do:

- **Do** 优先展示真实证据、任务阶段和下一步动作。
- **Do** 自动匹配源/目标路线，并让推断结果保持可见。
- **Do** 保留批量处理、筛选、复制路径和最小目录更新的专家效率。
- **Do** 对空、加载、部分成功、缓存回退、冲突和取消提交提供独立状态。

### Don't:

- **Don't** 把 Jira 状态、远端提交和本地工作副本状态合并成一个含糊结论。
- **Don't** 用连续弹窗报告批量错误。
- **Don't** 在同一视图放置多个同等强调的主按钮。
- **Don't** 因状态刷新改变表格高度、分栏位置或筛选宽度。
- **Don't** 自动提交、revert、解决冲突或把额外改动归入当前任务。
