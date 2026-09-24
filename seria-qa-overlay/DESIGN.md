---
name: "Seria QA Overlay"
description: "A plain native task browser with always-visible active-dialogue identity and structural progress."
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

A plain Windows/ReShade ImGui tool for identifying held tasks by id, name, and completion percentage. Neutral gray surfaces, readable text, restrained blue selection, and native controls replace the explicitly rejected cyberpunk / industrial identity.

**Key Characteristics:**
- All held records are browsable, including hidden tasks and subtasks.
- Search, filters, local selection, and clipboard actions support inspection.
- Fixed task, location/scene, and explicitly approved GM actions are available without arbitrary command input.
- A compact non-interactive HUD exposes current progress and recent task changes during gameplay.
- Active dialogue context identifies complex idle chat, camera dialogue, task
  dialogue, or ordinary dialogue with both start and current-line IDs.
- Home opens a dedicated task workspace without ReShade's general-purpose tabs
  by default; a persisted switch restores the full ReShade Home surface.

Evidence: `src/SeriaQAOverlay/SeriaQAOverlay.cpp`, `PRODUCT.md`, and `.impeccable/surfaces/src-seriaqaoverlay-seriaqaoverlay-cpp.md`, read on 2026-09-17. This is source-derived documentation, not runtime verification; the game is stopped. Sidecar HTML/CSS illustrates native primitives, not a web implementation or captured game state.

Sidecar tonal ramps are synthesized swatch aids, not shipped tokens. Browser focus outlines, host-dependent control padding, and font metrics are illustrative; native ImGui remains authoritative.

## Colors

Frontmatter percentages preserve the source ImVec4 RGB channels and alpha without hex rounding.

### Primary
- **Soft Blue** (`accent`): selected tile outline, selected-tab overline, active task status, completed-change markers, check mark, active slider grab, and ACTIVE diagnostics. The legacy C++ identifier `color_cyan` now holds this muted blue.
- **Dialogue types:** camera dialogue uses soft blue; complex idle chat uses
  muted amber. Task dialogue uses readable white and ordinary dialogue uses
  muted gray. The written type label remains authoritative.
- **Selected Blue / Hover / Active** (`selected`, `tile-hover`, `active`): selectable and tab selection, selectable hover, and held-button/selectable feedback respectively.

### Secondary
- **Muted Amber** (`warning`): paused data, newly changed task markers, selected HUD candidates, and READY diagnostics.

### Tertiary
- **Soft Red** (`error`): failures, abandoned tasks, disconnected HUD state, and CHECK diagnostics.

### Neutral
- **Charcoal Window / Inset Panel** (`window`, `panel`): outer and child backgrounds.
- **Readable White / Muted Gray** (`text`, `muted`): names and body text versus IDs, completion percentages, metadata, and ordinary event markers.
- **Rules / Tile Border** (`rule`, `tile-border`): separators and unselected outlines; `rule` also supplies hovered frame fill.
- **Frame / Active Frame** (`frame`, `frame-active`): input and slider backgrounds; active frame also supplies tab hover.
- **Button / Hovered Button** (`button`, `button-hover`): ordinary action feedback.

**The State Is Text Rule.** Pair state colors with explicit labels; id and name identify a record, while color only reinforces its state.

## Typography

Use the ReShade ImGui host font, including its Chinese glyph support, weight, base size, and line height. Title, HUD title, heading, and body use the frontmatter's relative sizes; no separate display or monospace face is introduced. Current titles are `角色任务`, `当前任务`, and `任务详情`.

Tile names and metadata truncate with UTF-8-safe ellipses to measured width. Hover tooltips expose full ID, name, description, and completion; the inspector wraps text. Fixed pixels below are ImGui coordinates, not browser breakpoints.

The standalone Windows installer inherits SVNmate's Segoe UI and Segoe UI Semibold roles. It enables Per-Monitor V2 awareness before creating WinForms controls, uses GDI text rendering, and scales control geometry once from the launch monitor DPI so type is not bitmap-stretched.

## Layout

- At available width >= `48 * ImGui::GetFontSize()`, the browser uses a resizable 2:1 task-grid/detail split. Below it, details stack after the grid: grid height `max(220, area_height * 0.58)`, inspector height `max(140, area_height * 0.34)`, where `area_height = max(220, available_height - 8)`.
- Grid columns are `clamp(int(available_width / (text_line_height * 16)), 1, 4)`. Tiles are at least 60px wide and `3 * text_line_height + 24px` high. Text starts 10px inside the tile.
- Search and filter share a row at >= 21 font units; the filter takes up to 9 font units. Action buttons wrap according to measured remaining width. The count follows the toolbar.
- Window padding and item rhythm use the frontmatter spacing. Detail labels and values wrap together without fixed horizontal offsets.
- The HUD remains at (16px, 62px), width `clamp(display_width * 0.27, 420, 560)`, with automatic height. While dialogue is active, a compact current-trigger block appears immediately below the HUD header with its type, start ID, current-line ID, and optional task linkage. A 72px progress ring then leads the current-task group; unresolved progress displays `--` rather than removing the ring. Below it, a wrapping queue of task chips (`[id]` plus name in one tinted block) shows recent changes first, then the current task, then other records; it wraps to at most two rows and collapses the remainder into a `+N` chip. Home temporarily hides the HUD while either task workspace is open.
- The Home workspace opens centered at roughly 82% of the display and remains resizable. By default it is the primary surface even when DLSS5 is installed. The desktop and in-game `Home 显示完整 ReShade 页面` switch restores the complete host UI.
- The Windows installer opens at 1000x760 with a 900x660 minimum, leaving enough logical width for all controls when WinForms is scaled at 125% DPI. A single resizable work surface orders target path, HUD/Home settings, commands, status, and a growing log vertically. Width remains sufficient for direct entry, paste, browse, and explicit auto-detect while the log absorbs vertical resizing.

## Elevation & Depth

No custom shadows, glow, decorative gutter, or animation. Tonal child surfaces, separators, outlined tiles, and selected fills organize the tool. HUD background alpha overrides window alpha: default 78%, adjustable 25-100%; text opacity is not reduced by this setting.

## Shapes

Use the documented window and frame radii. The custom tile outline has its own 4px radius; it does not redefine ImGui's selectable fill geometry. Task chips share that radius: a tinted fill plus semantic border, with `[id]` and name on one line, drawn directly by ImDrawList. The task-line progress ring uses a neutral full track, a soft-blue completed arc, center percentage text, and up to 12 evenly distributed milestone points; the first incomplete point is amber. No image assets or icon font are required.

## Components

- **Workspace:** Home toggles a dedicated `任务 QA` window by default, so ReShade's plugin, settings, statistics, log, and about pages do not compete with the daily task workflow. `显示设置` persists a master switch for restoring the complete ReShade Home surface.
- **Current trigger:** While dialogue is active, the same current-trigger block
  appears between the workspace status line and its tabs, so changing tabs
  never hides the dialogue identity. `复杂闲话` takes label priority over
  `镜头对话` if future configuration marks both flags; task linkage remains
  secondary to `开始 ID` and `当前句 ID`.
- **Installer:** A light native WinForms surface mirrors SVNmate's Metro language: `#F3F3F3` work area, white sections, Segoe UI text, restrained borders, and a `#0067C0` primary command. It starts with an empty editable target unless a path is explicitly supplied; `粘贴` reads the clipboard, inline feedback validates the resolved Win64 directory, and browse or auto-detect only replace the value after the user invokes them. Two checkboxes configure HUD visibility and whether Home opens the complete ReShade surface; a 25-100% numeric control configures opacity. `安装 / 更新` is primary; `仅校验` and `关闭` remain neutral. The read-only log uses the UI font and explicit success/error status while the existing PowerShell core runs in a hidden child process. No wizard pages, decorative cards, or registry state.
- **Tabs:** Inside the task workspace, `全部任务` opens first, followed by `最近变化`, `GM 工具`, optional `画面诊断`, and `显示设置`. Graphics adds `!` for CHECK. The selected tab uses the selected fill and soft-blue overline; unoverridden geometry stays host-native.
- **Search and filters:** Search matches task ID or name. Filters are all records, in progress, traced, completed/submitted, abnormal, server, and client. Hidden and subtask records are included, not excluded by default. The activity ordering rules still apply inside filtered results.
- **Actions:** `一键启动采集` appears while disconnected and submits the fixed bootstrap through the built-in GM dialog; a copy action remains as fallback. `定位当前任务` clears filters, selects the current task, and scrolls to it; it is disabled without a current task. `清除筛选` resets search/filter. `复制列表` copies the filtered records as tab-separated ID, name, status, completion, and source. Double-clicking a held-task tile copies only its task ID; explicit inspector actions copy ID or ID plus name. The `单击查看详情 · 双击复制任务 ID` helper appears only for the first hovered task after each workspace/overlay open and disappears after leaving it. Shared `已复制` feedback lasts two seconds where rendered.
- **GM tools:** Three dense command tables group task diagnosis, location/scene diagnosis, and state operations. Each row uses a full-width native action button, a plain-language effect, the fixed command name, execution side, and result location. Submission temporarily closes the workspace so the built-in GM dialog can receive `\`, select existing text, paste, and Enter. The page reports submission state rather than claiming command execution, because results remain authoritative in the game screen, chat, or log. No arbitrary command field exists. `ShowMissionDialogInfo` and `addtask` accept positive task IDs; `AddBuff` accepts a positive Buff ID and 1-999 stacks. The state section has an amber warning, and destructive `kill` uses a red button with its current-room enemy scope stated beside it; it submits on one click.
- **Task tile:** ID (with `当前` when applicable) on the top row with the completion percentage right-aligned, then the readable name, then labeled status/source/subtask/traced metadata. Finished/committed tasks read `100%`; failed tasks show structural progress in red; an unresolvable or abandoned line reads `--`. A task changed during the last 12 seconds moves ahead of unchanged tasks and receives a semantic blue, amber, or red border and event label. Current, active, traced, then stable ID/source ordering resolve the remaining positions. Selection is keyed by ID plus client/server origin and changes only local inspection; double-click copies the task ID without changing in-game tracking.
- **Ambiguous focus:** If any selected focus/navigation/dialogue candidate ID matches multiple source records, automatic focus stops and the HUD explains the ambiguity. Each source record remains independently selectable in the browser.
- **Inspector:** Wrapped identity and description, copy actions, status, a completion line, task line, and for the current task an 88px progress ring with completed/total/current/remaining facts. Below that, a dense four-column node table lists status, task ID, indented node name, and add action for the complete configured task line. Exact completed nodes read `已完成`; predecessors inferred from the local task graph read `路径已过`. Both are blue, the held processing node is amber, failed/abandoned nodes are red, and pending or unselected branches are muted with explicit text. Double-clicking a task tile copies its ID; double-clicking a non-held node submits the approved `addtask` command. Held nodes disable addition. Node descriptions, parent IDs, and inference provenance remain in hover details; raw runtime fields stay behind `技术信息`.
- **Empty and paused states:** Distinguish waiting for the task list, no held records, and no search matches. Disconnection offers a copyable collector-start command. Paused data remains visible with a warning and recovery guidance.
- **Events and diagnostics:** Events are newest first; completion markers are blue, ordinary recent changes amber, and failure/abandon markers red. The graphics tab is absent in QA-only installations; when the separate DLSS5 package is detected, it retains labeled ACTIVE/READY/CHECK evidence and corrective actions.
- **Display settings and HUD:** The desktop client and in-game settings persist HUD visibility, `HomeOpensFullReShade`, and opacity. HUD input/navigation are disabled. It shows active dialogue identity, current task context, configured-node progress, up to two selected candidates, and a wrapping task chip queue. Each chip combines `[id]` and the task name in one tinted block; its color is semantic - recent change event color, cyan for the current task, otherwise the task's own status color. Changes stay highlighted for 12 seconds and sort first; the current task follows, then other active/traced and unchanged tasks. Graphics appears there only for CHECK. An unknown task-line root renders `--` instead of a fabricated value.

## Do's and Don'ts

### Do:
- **Do** keep id, name, and completion visible as the task identity.
- **Do** preserve all-held-record browsing and distinguish client/server identity.
- **Do** use native controls and font-relative responsive layout.
- **Do** label retained data and provide actionable recovery guidance.
- **Do** keep recent task changes visible without requiring the interactive workspace.

### Don't:
- **Don't** restore neon, cyberpunk titles, decorative gutters, or dashboard chrome.
- **Don't** mutate quests, in-game tracking, or graphics configuration through inspection controls.
- **Don't** treat HTML illustrations as native screenshots or runtime verification.
