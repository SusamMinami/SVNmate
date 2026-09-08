---
name: ConfigLinker
description: A compact relationship explorer for game configuration data.
colors:
  canvas-light: "#F3F6FA"
  surface-light: "#FFFFFF"
  data-surface-light: "#FBFCFE"
  ink-light: "#172033"
  muted-light: "#667085"
  border-light: "#D8E0EA"
  accent-light: "#0078D4"
  accent-hover-light: "#106EBE"
  accent-soft-light: "#E8F3FC"
  success-light: "#107C10"
  warning-light: "#9D5D00"
  error-light: "#C42B1C"
  canvas-dark: "#111827"
  surface-dark: "#1F2937"
  data-surface-dark: "#182231"
  ink-dark: "#F3F4F6"
  muted-dark: "#A7B0BF"
  border-dark: "#344155"
  accent-dark: "#2899F5"
  accent-hover-dark: "#48AEF7"
  accent-soft-dark: "#163A59"
typography:
  display:
    fontFamily: "Segoe UI Semibold, Microsoft YaHei UI, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  headline:
    fontFamily: "Segoe UI Semibold, Microsoft YaHei UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Segoe UI, Microsoft YaHei UI, sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "Segoe UI Semibold, Microsoft YaHei UI, sans-serif"
    fontSize: "9px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
spacing:
  xs: "3px"
  sm: "6px"
  md: "7px"
  lg: "10px"
  xl: "14px"
components:
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.surface-light}"
    typography: "{typography.body}"
    padding: "7px 14px"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    padding: "6px 10px"
  segment-active:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.surface-light}"
    typography: "{typography.label}"
    padding: "6px 13px"
  result-row:
    backgroundColor: "{colors.data-surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    height: "29px"
---

# Design System: ConfigLinker

## Overview

**Creative North Star: "Relationship Workbench"**

ConfigLinker 把复杂配置引用变成可连续探索的桌面工作面。界面应突出当前查询中心、
关系方向、命中范围和可复制数据，而不是把每类记录做成独立展示卡。角色与武器是
两个工作模式，共享搜索、历史和状态语言，但各自保留最适合的数据结构。

**Key Characteristics:**

- 搜索框、返回和模式切换集中在单一工具栏。
- 角色关系使用固定三段拓扑，武器查询使用主列表加关系详情。
- 当前查询中心始终有边框、标签和行级三重反馈。
- 长路径、ID、坐标和简介以复制效率为优先。
- 浅色/暗色主题保持相同语义。

## Colors

界面使用冷中性背景和 Windows 蓝色强调。成功、警告和错误只表达数据或加载状态，
不作为装饰。

### Primary

- **Metro Action Blue**：主搜索、当前查询中心、选中标签和交互反馈。

### Neutral

- **Cool Canvas**：应用背景。
- **White Work Surface**：关系区和详情。
- **Data Frost**：表格与只读数据底色。
- **Deep Ink**：名称、ID 和主要结果。
- **Slate Metadata**：说明、记录数、路径与来源状态。

### Named Rules

**The Center-of-Query Rule.** 蓝色首先标识当前查询中心；普通关联项不得使用同等
强调。

**The Offline Core Rule.** 飞书同步失败只使用警告色，不能把整个本地查询工作区染成
错误状态。

## Typography

**Display Font:** Segoe UI Semibold
**Body Font:** Segoe UI
**Label/Mono Font:** Segoe UI；路径与技术 ID 可使用 Cascadia Mono

**Character:** 字体层级接近 Windows 原生工具。产品标题只在窗口顶部出现一次，
关系卡、详情和筛选依靠 9-12px 的紧凑层级。

### Hierarchy

- **Display**（600，24px）：产品名称。
- **Headline**（600，12px）：关系类型、角色名和详情分组。
- **Body**（400，10px）：表格、字段和值。
- **Label**（600，9px）：状态、标签、列名和元数据。

**The Data Stays Readable Rule.** 路径和表格数据不小于 9px；空间不足时滚动或重排，
不继续缩字。

## Layout

应用顶部是模式切换、返回、搜索和设置的一体化工具栏。角色查询工作区维持
“目标物 -> NPC -> 模型资源”的固定三段关系；卡片等宽、列头对齐，当前查询中心
在原位置高亮。武器工作区采用 4:6 左右分栏：左侧命中与简介，右侧详情及三类
关联结果。

角色档案属于按需打开的专用详情窗口，不应把长篇设定常驻在关系工作区。窗口按当前
DPI 使用约 85%-90% 工作区，并在小屏上收敛到可用范围。

## Elevation & Depth

默认使用边框、背景层和选中底色，不依赖阴影。角色档案、设置和同步提示是独立窗口，
可使用系统级深度；复制反馈使用单一短暂 toast，不堆叠。

## Shapes

控件采用紧凑矩形和小圆角。关系区域可以使用三个一级容器，但禁止在每条结果外再包
卡片。标签和查询中心徽标保持短小，不能挤压名称或 ID。

## Components

### Search

- 角色/武器模式共用工具栏位置，输入类型变化不移动搜索按钮。
- 数字存在多义时合并展示所有命中，并明确分类，不静默猜测。
- 空输入、格式错误和无结果在搜索区就地提示，不弹阻断对话框。

### Relationship Panels

- 标题显示类型、结果数和当前查询中心。
- 列表默认限制渲染量，继续加载时保留滚动位置。
- 单击 ID 延迟进入关系，双击取消跳转并复制。

### Tables

- 行高为 29px，选中使用轻蓝背景，文字保持主色。
- 模型路径列允许横向滚动；选中详情提供只读完整值。
- 缺失关联不清空其他列，使用明确缺失原因和警告状态。

### Segmented Controls

- 角色/武器模式和武器关系分类使用分段控件。
- 选中项为蓝底白字，未选项保持中性；选项数量和宽度固定。

### Status and Toasts

- 顶部状态显示数据目录、记录数、更新时间及是否使用缓存。
- 复制 toast 在约 1.5 秒后消失，连续复制更新同一个提示。
- 更新红点只表示有可安装版本，不能与数据错误共用。

### Images

- 头像、立绘和武器图标只在存在真实资源时显示。
- 加载失败保留文本关系与本地查询能力，并提供来源状态。
- 技术资源 ID 放在 tooltip 或详情，不抢占业务名称。

## Do's and Don'ts

### Do:

- **Do** 让用户从任意结果继续探索，并保持完整返回历史。
- **Do** 把角色与武器模式的共同行为放在相同位置。
- **Do** 优先展示业务名称，技术 ID 与路径保持易复制。
- **Do** 在刷新失败后明确显示仍使用哪一份成功数据。

### Don't:

- **Don't** 继续以 2026-07-28 初版范围限制当前角色资料和武器功能。
- **Don't** 为每条关联记录创建独立卡片或增加装饰图标。
- **Don't** 把在线图片或飞书授权变成本地查询的阻断条件。
- **Don't** 用同一个红点同时表达应用更新、数据错误和同步失败。
- **Don't** 因角色资料丰富而让主查询工作区失去紧凑性。
