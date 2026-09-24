# Seria QA Overlay Technical Specification

## 1. Scope

Version 0.12 is a task diagnostic overlay for internal quest designers, QA,
and developers.

- `Home` toggles a dedicated task workspace and suppresses the ReShade host
  overlay by default, including when optional DLSS5 files are present.
- `HomeOpensFullReShade` is a persisted master switch that restores ReShade's
  plugin/settings/statistics/log/about surface on Home. It is configurable from
  both the desktop client and in-game display settings.
- The persistent HUD is suppressed while either interactive workspace is open
  and automatically returns when it closes.
- Browsing and status collection are read-only. Task mutation is permitted only
  for individually reviewed, enum-backed commands with validated parameters,
  visible scope, and submission feedback. Version 0.12.0 exposes only
  `addtask <positive task ID>` for task mutation.
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

The same input state machine supports a compiled allowlist:
`PrintCurrentTask`, `TaskListPrint`, `DebugTaskInfo`,
`ShowMissionDialogInfo <positive task ID>`, `GetRotation`, `GetTOD`,
`sceneOnlineNum`, `showLocation`, `SkipLevelSequence`,
`addtask <positive task ID>`, `AddBuff <positive Buff ID> <1-999 stacks>`, and
`kill`. The UI can select only these enum-backed definitions. A second validation
layer rejects any other
command text and validates every numeric argument; arbitrary GM, Lua, unreviewed
task mutation, and engine-command input remain unreachable. `kill` has no argument,
so it retains the game's safer default scope: hostile monsters in the player's
current room.

## 3. Snapshot Transport

Files:

- `Saved/SeriaQAOverlay.0`
- `Saved/SeriaQAOverlay.1`

Lua alternates slots. Schema version 6 files start with `SERIA_QA_SNAPSHOT` and
end with `END`, both carrying the same monotonic sequence. The reader accepts
only schema 6; older snapshots are rejected instead of being interpreted with
partial progress data. It validates the schema, sequence, record count, bounds,
progress consistency, and terminal marker before adopting a slot. It retains
the previous valid snapshot when a write is incomplete.

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
- `DIALOG`: active state, start/current dialogue IDs, task ID, task-line ID,
  complex-idle-chat flag, and camera-dialogue flag.
- `FOCUS`: authoritative HUD task ID/line, completed/reachable/total configured
  node counts, progress-known and unresolved-branch flags, and focus source.
- `PROGRESS`: per-task structural progress, one record per unique held task ID.
  Same node-count fields as FOCUS without a source; tasks on one task line share
  a single walk from the line root for completed counts, then each task gets its
  own forward walk for remaining nodes. The parser enforces the same
  completed + remaining + 1 = total consistency.
- `NODE`: configured task-line node with line/task/parent IDs, depth, stable
  order, status, held/selected-path/branch flags, inferred-status and subtask-edge
  flags, name, and description. At most 1024 nodes are emitted; `META` reports
  truncation.
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

For each unique held task line, the producer walks every configured successor
and subtask from `GetFirstTaskIDOfTaskLine`. Held-node statuses come directly
from `CurrentTaskList`; statuses already cached by the game are consumed without
causing network activity. For uncached nodes, predecessors connected by
successor edges to a held node are marked `status_inferred` and shown as
`路径已过`. Subtask-parent edges are not treated as completed. The overlay never
calls `AddQueryTaskStatus`, avoiding bulk `CGetTaskState` traffic.

Navigation task identity comes from the final navigation-guide data when its
source is `ETask`; `AutoMoveInfo` is used only to report whether movement is
currently executing. Dialogue identity comes from `GetDialogID()` and
`GetStartDialogID()`. The start ID is classified independently against
`SeriaCfg.ComplexChat` and `SeriaCfg.DialogStart[StartId].Virtual`, so future
configuration can preserve both flags instead of collapsing them into one
exclusive enum. UI label priority is complex idle chat, camera dialogue, task
dialogue, then ordinary dialogue.

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
unresolved multi-way paths as `HasBranches`. A second bounded traversal starts
at the task line's configured first task and finds a path to the focused node.
When that path exists, `completed + current + remaining` defines the displayed
configured-node total and percentage. Missing roots leave progress unknown
instead of inventing a number. This is configuration progress, not elapsed
runtime progress. Event history retains up to 64 transitions for the current
collector lifetime.

## 5. ReShade Add-on

Source:

`seria-qa-overlay/src/SeriaQAOverlay`

Target:

`payload/seria-qa-overlay.addon64`

The add-on targets the packaged ReShade 6.8.0 API and vendors only the required
BSD/MIT ReShade and Dear ImGui headers.

- A `reshade_overlay` event renders the non-interactive HUD every frame.
- A registered `Seria QA` overlay renders the full Home-key diagnostics window.
- The same overlay event renders a dedicated resizable task window. A
  `reshade_open_overlay` event intercepts ordinary Home presses unless
  `HomeOpensFullReShade=1`, preventing unrelated host tabs from opening.
- Legacy modifier shortcuts remain compatible but are not part of the primary
  workflow.
- Snapshot file attributes are checked at a bounded interval. Parsing occurs
  only after a slot changes.
- Snapshot files older than the current process are rejected as stale.
- HUD visibility, opacity, and the Home surface preference are stored in ReShade
  configuration.

## 6. UI Contract

Visual system: practical native task browser.

- Neutral gray fields and white text; restrained blue selection, amber warnings
  and red failures. No decorative gutter or sci-fi identity headings.
- Status is always written in text. Transport labels are 实时 / 数据暂停 / 未连接.
- The default 全部任务 tab shows the same CurrentTaskList.Client/Server records
  used by PrintCurrentTask as ID, name, completion and status tiles. It includes
  hidden tasks and subtasks, never NEXT candidates in the held grid.
- ID/name search, seven status/source filters, clear filters, locate-current
  scroll, and clipboard export operate only on the local snapshot.
- Tasks changed during the last 12 seconds sort first by newest change and use
  event-semantic color: blue for completion, amber for ordinary changes, red
  for failure/abandon. The current task follows, then active, traced, and
  unchanged tasks; stable ID/source order breaks remaining ties.
- Selection uses ID + source; a duplicate client/server ID remains independently
  inspectable even though task events do not identify their origin.
- Full names and descriptions remain available in a tooltip and detail pane
  when the width-measured tile text is truncated.
- Double-clicking a held-task tile copies only its task ID. Selecting it opens a
  task-line node table in the inspector. Completed/committed nodes are blue,
  held processing nodes amber, failed/abandoned nodes red, and pending or
  unselected branches muted with written labels. Node rows retain parent/depth
  context without rendering a decorative graph.
- The inspector retains an explicit `复制节点 ID` action. A non-held node's row
  button or double-click submits `addtask <ID>` directly; held nodes disable
  addition.
- At >=48 font units the browser has a resizable 2:1 grid/detail split;
  narrower layouts stack them. The tile grid adapts from one to four columns.
- Persistent HUD width is bounded relative to the viewport and shows the focused
  task beside a compact progress ring. The filled arc and center percentage show
  completed configured-node share; up to 12 points around the ring provide
  milestone position without turning long task lines into visual noise.
- While dialogue is active, a current-trigger block appears directly below the
  HUD header and above the workspace tabs. It always writes the dialogue type,
  `开始 ID`, and `当前句 ID`; task and task-line linkage are secondary details.
- The HUD and inspector state completed/total and remaining node counts in text.
  Unknown roots show no fake percentage. The HUD keeps the ring visible with
  `--` whenever a current task exists but progress cannot be computed.
- Below the current task, a bounded 50x42px document-icon queue uses the same
  change ranking and color rules. It shows recently changed tasks first and
  muted unchanged tasks afterward, with an overflow count rather than expanding
  without limit.
- The 显示设置 tab exposes a `背景不透明度` slider from 25% to
  100%. The default is 78%, and the chosen value persists in ReShade
  configuration without changing the task snapshot.
- Healthy `ACTIVE` and `READY` DLSS5 states stay out of the persistent HUD.
  The HUD adds DLSS5 content only for `CHECK`, including both the problem and
  corrective action. Full diagnostics always retains complete DLSS5 evidence.
- 最近变化, GM 工具, 画面诊断 and 显示设置 are separate tabs, retaining full
  diagnostic evidence without competing with held-task browsing. The GM page
  groups task, location/scene, and state commands in dense two-column tables.
  State commands are explicitly labeled; destructive `kill` uses a red direct
  action whose current-room enemy scope is stated beside it. Raw collection
  metadata and task technical details are collapsed by default.
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

Planner distribution includes a portable ZIP and a single self-extracting GUI
Setup EXE. The EXE embeds the exact QA ZIP, extracts it to a unique temporary
directory, validates that the CMD, PowerShell GUI, and package manifest exist,
then starts `Install-SeriaQA-GUI.cmd` in a synchronous host mode. The CMD waits
for the GUI to exit before the EXE removes the temporary files. Ordinary CMD
launches remain detached. The ZIP remains the authoritative SVNmate and
automation payload. Both paths accept `Seria.exe`, the `Seria\Binaries\Win64`
directory, or a supported game root, write no registry state, back up differing
files, and perform post-copy verification.

Manual users launch `Install-SeriaQA-GUI.cmd`, which starts a DPI-aware WinForms
surface in STA mode. The GUI starts without silently selecting an inferred
target, accepts direct typing or clipboard paste of a game root, `Seria.exe`, or
Win64 directory, and keeps browse plus explicit auto-detect as optional actions.
Auto-detect treats the current text as a location hint: it checks the hint and
its ancestors, then searches at most four nearby directory levels and 1500
directories before falling back to the launch argument, `SERIA_TRUNK`, and
`%SystemDrive%\trunk`. It validates the path inline, accepts HUD visibility,
Home surface preference, and 25-100% opacity, and runs `Install-SeriaTool.ps1`
asynchronously with redirected output. After install verification and optional
persistent-recovery publication both succeed, the GUI displays a modal
completion notice with the resolved target. Install, verify-only, and
persistent-recovery steps remain in the existing scripts.
`Install-SeriaQA.cmd` remains the machine-facing entry point required by
SVNmate.

The GUI runs one asynchronous update check per local calendar day. A clickable
status dot beside the bottom-left version label replaces a separate update
button: green is current, red has an update, blue is busy, amber is a failed
check, and gray is unchecked. Tooltip and accessibility text carry the same
meaning without relying on color. Clicking red downloads the update; clicking
another idle state retries the check. It reads only the fixed
`seria-qa-overlay-latest/module-manifest.json` channel. The manifest keeps the
SVNmate ZIP URL/hash and also publishes `setup_url` plus `setup_sha256`.
`SeriaQA-SelfUpdate.ps1` requires HTTPS, the exact GitHub repository/tag path,
the expected Setup filename, a 64-character SHA-256, and the existing package
id/entrypoint. A newer version is shown inline; downloading is user-initiated.
After hash verification, the downloaded Setup is launched from LocalAppData
with the current resolved target path. Network or update failures do not block
manual installation or verification.

SVNmate consumes the QA ZIP through the fixed `seria-qa-overlay-latest`
release channel. It validates the updater manifest, HTTPS URL, archive SHA-256,
ZIP paths, and exact `Install-SeriaQA.cmd` entry point. It then runs
`Install-SeriaTool.ps1` non-interactively against `%SERIA_TRUNK%` or
`C:\trunk`, publishes the external recovery copy, and commits the managed
module version only after both steps succeed. It never terminates `Seria.exe`;
the user must close the game first.

## 10. Acceptance

- By default, `Home` opens only the dedicated task workspace regardless of
  installed add-ons; a second Home press closes it.
- Enabling `Home 显示完整 ReShade 页面` makes Home open the complete host UI.
- The GUI installer opens at 1000x760 with a 900x660 minimum, retaining enough
  logical width for complete controls at 125% DPI. It installs to a pasted or
  selected fixture, applies HUD visibility,
  Home surface preference, and opacity, then verifies those selected values
  without rewriting files.
- The release exposes a directly downloadable `-Setup.exe`; `-ValidateOnly`
  traverses its embedded extraction and GUI bootstrap path without modifying
  the target, and the embedded ZIP hash matches the separately published ZIP.
- An existing development client reaches `LIVE` after the one-click GM
  activation without rebuilding its PAK files.
- Every GM 工具 action submits only its compiled allowlist command. Invalid or
  zero task/Buff IDs and Buff stacks outside 1-999 stay disabled. `kill`
  submits directly with no argument, and the page reports submission rather
  than claiming that the game executed the command.
- Selecting a held task shows every configured node in its task line. Held or
  already-cached statuses remain exact; local graph inference labels traversed
  predecessors as `路径已过`. Task-card double-click copies its ID; non-held
  node double-click submits exactly `addtask <node ID>` without generating
  background task-state queries.
- Selecting navigation task `311439` makes that processing task the HUD focus
  while navigation remains active.
- The HUD always exposes a progress ring for a resolved current task, using `--`
  when configured-node progress is unknown.
- Newly changed task icons are colored and sorted first for 12 seconds; unchanged
  tasks follow in current/active/traced/stable order.
- HUD background opacity defaults to 78%, is adjustable from 25-100%, and
  survives restart through `ReShade.ini`.
- Task accept/refresh/finish/remove/trace changes appear after one Lua tick.
- Navigation and dialogue IDs reflect their current authoritative managers.
  Camera dialogue and complex idle chat display their explicit type together
  with both start and current-line IDs in the HUD and task workspace.
- An interrupted snapshot write leaves the prior valid display intact.
- Missing data shows actionable `OFFLINE`; lost transport after a valid sample
  shows actionable `STALE` while retaining the last valid values.
- A QA-only install has no DLSS5 payload, warning, or resolution change.
- When installed separately, DLSS5 safeguards remain `NeuralUplift=0`,
  `skip_exe=2`, and `2560x1440`.
- The add-on builds as x64 with MSVC and its packaged hash verifies.
