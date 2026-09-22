# Seria QA Overlay Technical Specification

## 1. Scope

Version 0.3 is a read-only diagnostic overlay for internal quest designers, QA,
and developers.

- `Ctrl+Home` toggles the persistent top-left HUD.
- `Home` keeps its existing ReShade behavior and opens the full diagnostics
  surface. The persistent HUD is suppressed while the ReShade overlay is open
  and automatically returns when it closes.
- No overlay action accepts, completes, commits, removes, skips, traces, or
  otherwise mutates a task.
- DLSS5 is optional and is distributed independently from the QA overlay.

## 2. Runtime Architecture

The feature is split across the existing ownership boundary:

1. `TaskQADiagnostics.lua` observes authoritative Lua task, navigation, and
   dialogue state.
2. It writes a bounded, versioned snapshot under the project's `Saved`
   directory.
3. `seria-qa-overlay.addon64` reads the snapshot and renders through ReShade.
4. When the separate DLSS5 package is present, the add-on independently
   inspects its files, configuration, runtime API, and bridge log.

The Lua producer never calls ReShade or DLSS code. The add-on never calls game
task APIs.

Existing packaged development clients can start the same producer without
recooking content. The QA installer places `TaskQADiagnostics.lua` and
`SeriaQA.lua` beside `Seria.exe`. After entering a character, the overlay's
one-click action closes ReShade, opens the built-in GM dialog with `\`, pastes
the fixed local `RunLuaString` bootstrap, and submits it. A copyable
`gm:RunLuaString` form remains available for external GM consoles. Activation
is process-local and must be repeated after a game restart.

## 3. Snapshot Transport

Files:

- `Saved/SeriaQAOverlay.0`
- `Saved/SeriaQAOverlay.1`

Lua alternates slots. Schema version 2 files start with `SERIA_QA_SNAPSHOT` and
end with `END`, both carrying the same monotonic sequence. The reader accepts
schema 1 for retained compatibility and schema 2 for focus/progress data. It
validates the schema, sequence, record count, bounds, and terminal marker before
adopting a slot. It retains the previous valid snapshot when a write is
incomplete.

Transport health is independent from retained data:

- `LIVE`: the newest current-process slot is complete and valid.
- `STALE`: a prior valid snapshot remains visible, but an observed slot was
  deleted, the newest slot is malformed, or no current-process slot remains.
- `OFFLINE`: no valid current-process snapshot has been adopted.

`STALE` always labels the retained values and shows a recovery action; it never
presents the last valid snapshot as live data.

The logical format is UTF-8, tab-delimited, and percent-escapes `%`, tab, CR,
and LF in text fields. The game `SaveStringToFile` implementation may emit
UTF-16LE with a BOM; the native reader detects UTF-8 BOM or UTF-16LE at the
file boundary and normalizes it to UTF-8 before protocol parsing. The protocol
remains dependency-free and line-oriented so invalid records can be diagnosed
without accepting partial state.

Record types:

- `TASK`: current server/client task state and display metadata.
- `NEXT`: immediate configured successor candidates, including selected branch
  indexes when known.
- `TRACE`: traced task lines by main type.
- `NAV`: guide activity and actual auto-move activity as separate flags.
- `DIALOG`: active state, start/current dialogue IDs, task ID, and task-line ID.
- `FOCUS`: authoritative HUD task ID/line, reachable remaining configured-node
  count, unresolved-branch flag, and focus source.
- `EVENT`: bounded recent transition history.
- `META`: task-list readiness, source counts, and truncation flags.

## 4. Lua Publisher

New module:

`res/Content/Seria/Script/UI/Task/TaskQADiagnostics.lua`

The module is initialized once from `TaskManager.InitManager`. It subscribes to:

- accept, refresh, finish, remove, active, and deactive task events;
- trace, task-list initialized, task-line finished, and task-line-state events;
- navigation path add/remove and auto-move start/end events;
- dialogue start, node processing, and end events;
- task-list reset.

Callbacks only record a reason and schedule one flush on the next tick. This is
required because `OnRefreshTaskEvent` fires before `CopyTaskInfo` updates the
stored object. The delayed flush coalesces recursive parent/subtask changes.

The snapshot contains DTO values only. It never serializes `TaskData`, UObject
references, callbacks, or cyclic tables.

Navigation task identity comes from the final navigation-guide data when its
source is `ETask`; `AutoMoveInfo` is used only to report whether movement is
currently executing. Dialogue identity comes from `GetDialogID()` and
`GetStartDialogID()`.

The producer selects one focus task in this order:

1. active navigation task;
2. active dialogue task;
3. most recently handled processing task;
4. the game's shown-task order;
5. an active traced task.

Candidates must still exist in the authoritative task records with
`PROCESSING` status. This prevents an unrelated first row from replacing an
explicit navigation selection such as task `311439`.

For the focused task, the producer traverses configured successor and subtask
links within the same task line. It counts each reachable node with a name or
description once, follows selected branch indexes when known, and marks
unresolved multi-way paths as `HasBranches`. The bounded count describes
remaining configured nodes, not elapsed runtime progress or an exact percentage.
Event history retains up to 64 transitions for the current collector lifetime.

## 5. ReShade Add-on

Source:

`seria-qa-overlay/src/SeriaQAOverlay`

Target:

`payload/seria-qa-overlay.addon64`

The add-on targets the packaged ReShade 6.8.0 API and vendors only the required
BSD/MIT ReShade and Dear ImGui headers.

- A `reshade_overlay` event renders the non-interactive HUD every frame.
- A registered `Seria QA` overlay renders the full Home-key diagnostics window.
- A `reshade_open_overlay` event prevents `Ctrl+Home` from also toggling the
  main ReShade overlay.
- Snapshot file attributes are checked at a bounded interval. Parsing occurs
  only after a slot changes.
- Snapshot files older than the current process are rejected as stale.
- HUD visibility is stored only in ReShade configuration.

## 6. UI Contract

Visual system: practical native task browser.

- Neutral gray fields and white text; restrained blue selection, amber warnings
  and red failures. No decorative gutter or sci-fi identity headings.
- Status is always written in text. Transport labels are 实时 / 数据暂停 / 未连接.
- The default 全部任务 tab shows the same CurrentTaskList.Client/Server records
  used by PrintCurrentTask as document-icon, ID, name and status tiles. It
  includes hidden tasks and subtasks, never NEXT candidates in the held grid.
- ID/name search, seven status/source filters, clear filters, locate-current
  scroll, and clipboard export operate only on the local snapshot.
- Tiles sort by ID and source for stable scanning. Selection uses ID + source;
  a duplicate client/server ID remains independently inspectable.
- Full names and descriptions remain available in a tooltip and detail pane
  when the width-measured tile text is truncated.
- At >=48 font units the browser has a resizable 2:1 grid/detail split;
  narrower layouts stack them. The tile grid adapts from one to four columns.
- Persistent HUD width is bounded relative to the viewport and shows only the
  focused task description, reachable remaining-node count, immediate
  candidates, current navigation/dialogue, and the two latest distinct
  finished/committed nodes.
- The remaining-node line explicitly appends `（含分支）` when unresolved
  branches are included. Completion history begins when capture starts and
  cannot reconstruct events that occurred earlier in the process.
- The 显示设置 tab exposes a `背景不透明度` slider from 25% to
  100%. The default is 78%, and the chosen value persists in ReShade
  configuration without changing the task snapshot.
- Healthy `ACTIVE` and `READY` DLSS5 states stay out of the persistent HUD.
  The HUD adds DLSS5 content only for `CHECK`, including both the problem and
  corrective action. Full diagnostics always retains complete DLSS5 evidence.
- 最近变化, 画面诊断 and 显示设置 are separate tabs, retaining full diagnostic
  evidence without competing with held-task browsing. Raw collection metadata
  and task technical details are collapsed by default.
- The HUD never requests mouse or keyboard capture.

## 7. DLSS5 Diagnostics

The add-on reports evidence, not inferred certainty:

- current ReShade graphics API;
- presence and load state of the DX11 bridge, RenoDX add-on, and NGX DLLs;
- `NeuralUplift`, `stage`, `mode`, `skip_exe`, and resolution safeguards;
- current-session bridge log evidence such as session creation, feature
  creation, delivered frames, waiting state, or failure.
- current-session ReShade evidence scoped to `[DLSS 5 Neural Rendering]`.

Bridge and RenoDX success/failure evidence is ordered by its position in the
log. A failure after the latest success produces `CHECK`; unrelated ReShade
errors are ignored by the RenoDX check.

Health levels:

- `ACTIVE`: current-session log contains successful delivered-frame evidence.
- `READY`: required files and safeguards are valid, but delivery is not yet
  proven.
- `CHECK`: a required file or safeguard is missing or a failure is present.

Every `CHECK` item includes a concrete corrective action.

## 8. Failure and Performance Rules

- Lua write failure logs once per changed error and retries on the next event.
- A malformed or partial slot never replaces the last valid snapshot.
- Disk checks are rate-limited; no file parsing occurs every frame.
- Record counts and file size are bounded before allocation.
- Add-on initialization failure cannot affect gameplay or DLSS execution.
- No bridge source or binary is replaced by this feature.

## 9. Deployment

Deployment uses two schema-v2 manifests and two independent ZIPs:

- `Seria-QA-Overlay`: ReShade core, QA add-on, producer, and bootstrap.
- `Seria-DLSS5`: ReShade core, bridge, RenoDX add-on, DLSS libraries, and
  shader resources.

The shared ReShade core has the same hash in both packages, so either package
can be installed first. Each installer preserves unrelated `ReShade.ini`
values. Only the DLSS5 installer writes DLSS settings and the validated
2560x1440 resolution.

Shader-tree hashing uses ordinal relative-path ordering so validation is
identical under Windows PowerShell 5.1 and PowerShell 7.

The Lua file remains part of the normal game resource tree for automatic
startup in future builds. Its loose copy supports one-click or manual
activation in existing development clients. QA and DLSS5 use separate
persistent recovery directories and desktop shortcuts.

Planner distribution is a portable ZIP rather than an MSI. It contains the
validated payload, manifest, path-resolving installer entry point, Chinese quick
start, and technical documentation. The installer accepts `Seria.exe`, the
`Seria\Binaries\Win64` directory, or a supported game root, writes no registry
state, backs up differing files, and performs post-copy verification.

## 10. Acceptance

- `Ctrl+Home` toggles only the persistent HUD.
- `Home` opens ReShade, hides the persistent HUD for the duration, and exposes
  the `Seria QA` diagnostics window.
- An existing development client reaches `LIVE` after the one-click GM
  activation without rebuilding its PAK files.
- Selecting navigation task `311439` makes that processing task the HUD focus
  while navigation remains active.
- The HUD exposes remaining configured nodes, branch ambiguity, and at most two
  distinct completion events collected after activation.
- HUD background opacity defaults to 78%, is adjustable from 25-100%, and
  survives restart through `ReShade.ini`.
- Task accept/refresh/finish/remove/trace changes appear after one Lua tick.
- Navigation and dialogue IDs reflect their current authoritative managers.
- An interrupted snapshot write leaves the prior valid display intact.
- Missing data shows actionable `OFFLINE`; lost transport after a valid sample
  shows actionable `STALE` while retaining the last valid values.
- A QA-only install has no DLSS5 payload, warning, or resolution change.
- When installed separately, DLSS5 safeguards remain `NeuralUplift=0`,
  `skip_exe=2`, and `2560x1440`.
- The add-on builds as x64 with MSVC and its packaged hash verifies.
