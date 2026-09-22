---
name: "Seria QA Overlay"
description: "A plain native browser for all held tasks, identified by document icon, ID, and name."
colors:
  window: "rgb(12% 12% 13% / 0.96)"
  panel: "rgb(15% 15% 16% / 0.98)"
  text: "rgb(94% 94% 95%)"
  muted: "rgb(72% 73% 75%)"
  accent: "rgb(64% 76% 90%)"
  warning: "rgb(87% 75% 53%)"
  error: "rgb(95% 62% 60%)"
  rule: "rgb(29% 29% 31%)"
  selected: "rgb(24% 30% 38%)"
  tile-hover: "rgb(29% 32% 37%)"
  active: "rgb(30% 38% 47%)"
  frame: "rgb(22% 22% 24%)"
  frame-active: "rgb(30% 34% 39%)"
  button: "rgb(24% 24% 26%)"
  button-hover: "rgb(32% 34% 38%)"
  tile-border: "rgb(30% 30% 32%)"
typography:
  title:
    fontFamily: "ReShade ImGui host font"
    fontSize: "1.10em"
  hud-title:
    fontFamily: "ReShade ImGui host font"
    fontSize: "1.08em"
  heading:
    fontFamily: "ReShade ImGui host font"
    fontSize: "1.06em"
  body:
    fontFamily: "ReShade ImGui host font"
    fontSize: "1em"
rounded:
  document: "1px"
  frame: "2px"
  window: "3px"
  tile-outline: "4px"
spacing:
  item-x: "7px"
  item-y: "4px"
  window-x: "10px"
  window-y: "9px"
  marker-gap: "6px"
components:
  button:
    backgroundColor: "{colors.button}"
    textColor: "{colors.text}"
    rounded: "{rounded.frame}"
    typography: "{typography.body}"
  search:
    backgroundColor: "{colors.frame}"
    textColor: "{colors.text}"
    rounded: "{rounded.frame}"
    typography: "{typography.body}"
  tab-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
  task-tile-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
  opacity-setting:
    backgroundColor: "{colors.frame}"
    textColor: "{colors.text}"
    rounded: "{rounded.frame}"
    typography: "{typography.body}"
---

# Design System: Seria QA Overlay

## Overview

**Creative North Star: "The Practical Task Browser"**

A plain Windows/ReShade ImGui tool for identifying held tasks by document icon, ID, and name. Neutral gray surfaces, readable text, restrained blue selection, and native controls replace the explicitly rejected cyberpunk / industrial identity.

**Key Characteristics:**
- All held records are browsable, including hidden tasks and subtasks.
- Search, filters, local selection, and clipboard actions support inspection.
- A compact non-interactive HUD complements the tabbed Home workspace.

Evidence: `src/SeriaQAOverlay/SeriaQAOverlay.cpp`, `PRODUCT.md`, and `.impeccable/surfaces/src-seriaqaoverlay-seriaqaoverlay-cpp.md`, read on 2026-09-17. This is source-derived documentation, not runtime verification; the game is stopped. Sidecar HTML/CSS illustrates native primitives, not a web implementation or captured game state.

Sidecar tonal ramps are synthesized swatch aids, not shipped tokens. Browser focus outlines, host-dependent control padding, and font metrics are illustrative; native ImGui remains authoritative.

## Colors

Frontmatter percentages preserve the source ImVec4 RGB channels and alpha without hex rounding.

### Primary
- **Soft Blue** (`accent`): selected tile outline, selected-tab overline, active task status, check mark, active slider grab, and ACTIVE diagnostics. The legacy C++ identifier `color_cyan` now holds this muted blue.
- **Selected Blue / Hover / Active** (`selected`, `tile-hover`, `active`): selectable and tab selection, selectable hover, and held-button/selectable feedback respectively.

### Secondary
- **Muted Amber** (`warning`): paused data, selected HUD candidates, and READY diagnostics, not ordinary event decoration.

### Tertiary
- **Soft Red** (`error`): failures, abandoned tasks, disconnected HUD state, and CHECK diagnostics.

### Neutral
- **Charcoal Window / Inset Panel** (`window`, `panel`): outer and child backgrounds.
- **Readable White / Muted Gray** (`text`, `muted`): names and body text versus IDs, document icons, metadata, and ordinary event markers.
- **Rules / Tile Border** (`rule`, `tile-border`): separators and unselected outlines; `rule` also supplies hovered frame fill.
- **Frame / Active Frame** (`frame`, `frame-active`): input and slider backgrounds; active frame also supplies tab hover.
- **Button / Hovered Button** (`button`, `button-hover`): ordinary action feedback.

**The State Is Text Rule.** Pair state colors with explicit labels; the document icon identifies a record, not its status.

## Typography

Use the ReShade ImGui host font, including its Chinese glyph support, weight, base size, and line height. Title, HUD title, heading, and body use the frontmatter's relative sizes; no separate display or monospace face is introduced. Current titles are `角色任务`, `当前任务`, and `任务详情`.

Tile names and metadata truncate with UTF-8-safe ellipses to measured width. Hover tooltips expose full ID, name, and description; the inspector wraps text. Fixed pixels below are ImGui coordinates, not browser breakpoints.

## Layout

- At available width >= `48 * ImGui::GetFontSize()`, the browser uses a resizable 2:1 task-grid/detail split. Below it, details stack after the grid: grid height `max(220, area_height * 0.58)`, inspector height `max(140, area_height * 0.34)`, where `area_height = max(220, available_height - 8)`.
- Grid columns are `clamp(int(available_width / (text_line_height * 16)), 1, 4)`. Tiles are at least 60px wide and `3 * text_line_height + 24px` high. Icon and text start 10px inside the tile.
- Search and filter share a row at >= 21 font units; the filter takes up to 9 font units. Action buttons wrap according to measured remaining width. The count follows the toolbar.
- Window padding and item rhythm use the frontmatter spacing. Detail labels and values wrap together without fixed horizontal offsets.
- The HUD remains at (16px, 62px), width `clamp(display_width * 0.27, 420, 560)`, with automatic height. Home temporarily hides it while the workspace is open.

## Elevation & Depth

No custom shadows, glow, decorative gutter, or animation. Tonal child surfaces, separators, outlined tiles, and selected fills organize the tool. HUD background alpha overrides window alpha: default 78%, adjustable 25-100%; text opacity is not reduced by this setting.

## Shapes

Use the documented window and frame radii. The custom tile outline has its own 4px radius; it does not redefine ImGui's selectable fill geometry. The document icon is a muted 12x16px outlined rectangle with a 1px radius and two horizontal strokes, drawn directly by ImDrawList. No image assets or icon font are required.

## Components

- **Tabs:** `全部任务` opens first, followed by `最近变化`, `画面诊断`, and `显示设置`. Graphics adds `!` for CHECK. The selected tab uses the selected fill and soft-blue overline; unoverridden geometry stays host-native.
- **Search and filters:** Search matches task ID or name. Filters are all records, in progress, traced, completed/submitted, abnormal, server, and client. Hidden and subtask records are included, not excluded by default. Tiles sort by ID, then server before client.
- **Actions:** `一键启动采集` appears while disconnected and submits the fixed bootstrap through the built-in GM dialog; a copy action remains as fallback. `定位当前任务` clears filters, selects the current task, and scrolls to it; it is disabled without a current task. `清除筛选` resets search/filter. `复制列表` copies the filtered records as tab-separated ID, name, status, and source. `复制编号与名称` copies inspector identity. Shared `已复制` feedback lasts two seconds where rendered.
- **Task tile:** Document icon and muted ID (with `当前` when applicable), readable name, then labeled status/source/subtask/traced metadata. Selection is keyed by ID plus client/server origin and changes only local inspection, never in-game tracking.
- **Ambiguous focus:** If any selected focus/navigation/dialogue candidate ID matches multiple source records, automatic focus stops and the HUD explains the ambiguity. Each source record remains independently selectable in the browser.
- **Inspector:** Wrapped identity and description, copy action, status, task line, applicable focus/remaining-node facts, and configured successors. Unselected branches are labeled; technical details are behind `技术信息`.
- **Empty and paused states:** Distinguish waiting for the task list, no held records, and no search matches. Disconnection offers a copyable collector-start command. Paused data remains visible with a warning and recovery guidance.
- **Events and diagnostics:** Events are newest first; ordinary markers are muted, failure/abandon markers red. The graphics tab is absent in QA-only installations; when the separate DLSS5 package is detected, it retains labeled ACTIVE/READY/CHECK evidence and corrective actions.
- **Display settings and HUD:** Checkbox and Ctrl+Home persist `SeriaQAOverlay.HudVisible`; the integer opacity slider persists `SeriaQAOverlay.HudOpacity`. HUD input/navigation are disabled. It shows current task context, up to two selected candidates, and two distinct recent completions; graphics appears there only for CHECK.

## Do's and Don'ts

### Do:
- **Do** keep icon, ID, and name visible as the task identity.
- **Do** preserve all-held-record browsing and distinguish client/server identity.
- **Do** use native controls and font-relative responsive layout.
- **Do** label retained data and provide actionable recovery guidance.

### Don't:
- **Don't** restore neon, cyberpunk titles, decorative gutters, or dashboard chrome.
- **Don't** mutate quests, in-game tracking, or graphics configuration through inspection controls.
- **Don't** treat HTML illustrations as native screenshots or runtime verification.
