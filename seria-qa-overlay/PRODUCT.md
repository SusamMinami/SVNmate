# Product

<!-- impeccable:product-schema 1 -->

## Platform

windows

## Users

- Internal Seria quest designers, QA engineers, and developers.
- Used while running development or test builds to observe quest progression and graphics injection state without leaving gameplay.

## Product Purpose

The working product, Seria QA Overlay, provides an always-visible view of the player's current quest flow and active dialogue trigger, plus a detailed Home-key diagnostic surface. Success means a tester can inspect every configured node in a held task line, distinguish completed and current nodes, identify active dialogue IDs, and copy exact task IDs without leaving gameplay. When the separate DLSS5 package is installed, the same surface also reports its state.

## Positioning

It combines authoritative quest state from the game's existing Lua task manager with a ReShade overlay. Optional post-render diagnostics activate only when the separate DLSS5 package is present. The overlay visualizes actual runtime transitions instead of periodically scraping `PrintCurrentTask` text.

## Operating Context

- Runs over the UE4 Windows client during interactive play, including map changes, dialogue, navigation, reconnects, and instance transitions.
- A compact top-left HUD remains visible during normal play, identifies the
  active camera dialogue or complex idle chat, and ranks recently changed task
  icons before unchanged tasks.
- `Home` defaults to a dedicated Seria QA task workspace regardless of other
  installed add-ons. A persisted desktop/in-game switch restores the complete
  ReShade surface without requiring a second daily-use shortcut.
- Manual installation uses a native Windows GUI with direct path entry/paste,
  optional target discovery, install, verification, and HUD preferences;
  SVNmate automation retains the CLI entry.
- Task browsing, selection, export, status queries, and snapshots remain
  read-only by default. Task mutations may be added one command at a time after
  explicit approval, with a compiled allowlist, strict parameter validation,
  visible target/scope, and submission feedback.

## Capabilities and Constraints

- Consume task accept, refresh, finish, remove, trace, task-line completion, and initial-list events.
- Highlight changed tasks in the persistent HUD long enough to notice during gameplay and rank them before the current and unchanged tasks.
- Expand every held task line from its configured root and compare the local
  task graph with held/cached task state. Traversed predecessors are marked as
  locally inferred, so the inspector distinguishes current, completed/path-past,
  pending, unselected-branch, failed, and abandoned nodes without sending bulk
  status queries to the logic server.
- Distinguish persistent quest state from transient navigation and dialogue
  activity. Active dialogue context exposes both start and current-line IDs and
  classifies complex idle chat independently from camera dialogue.
- Resolve candidate next nodes from task configuration while preserving branch ambiguity.
- Do not poll or repeatedly invoke the `PrintCurrentTask` GM command.
- Offer one-click capture startup plus a fixed GM allowlist by opening
  the built-in GM dialog and submitting only commands compiled into the add-on.
- The GM surface separates read-only diagnosis from approved state actions. It
  never accepts arbitrary command or Lua text. Task and Buff IDs accept positive
  integers only; Buff stacks are bounded to 1-999. Destructive actions remain
  visually distinct and state their exact scope, but submit directly. Task
  mutation commands follow the same review and allowlist requirements.
- `addtask <ID>` is an approved task mutation. A non-held configured node can be
  added from its row button or by double-clicking the node; held nodes disable
  the action to prevent an obvious duplicate request.
- Keep the persistent HUD non-interactive so it cannot capture gameplay input.
- Preserve D3D11 compatibility and the existing ReShade 6.8+ injection architecture.
- When DLSS5 is installed, preserve RTX 4080 safeguards: `NeuralUplift=0`, `skip_exe=2`, and the verified 2560x1440 configuration.
- QA and DLSS5 must ship as separate, independently restorable ZIP packages.
- The QA ZIP includes both GUI and CLI installers backed by the same verified
  PowerShell core. GUI configuration must not fork installation behavior.
- The current DLSS5 DX11 bridge package remains independently replaceable; the task UI must not make bridge failure affect quest logic.
- Product name: Seria QA Overlay.
- Lua-to-addon transport: validated double-buffered UTF-8 snapshots under
  `Saved`, consumed only after a complete matching end marker is present.

## Brand Commitments

- Quiet, dense, work-focused QA tooling.
- Practical native task browser: neutral gray, readable text, and a restrained
  blue selection state. The user explicitly rejected the earlier cyberpunk /
  industrial presentation on 2026-09-17.
- The standalone installer follows SVNmate's light Metro surface, compact
  native controls, and Segoe UI typography instead of the overlay's dark theme.
- High information density, consistent feedback, crisp high-DPI typography, and automatic collapse of secondary information.

## Evidence on Hand

- `C:\trunk\res\Content\Seria\Script\UI\Task\TaskManager.lua` contains the authoritative client task state, events, task graph traversal, and current debug output.
- `C:\trunk\bin\ServerDevLibs\proto\Game\game\taskModule\taskModule.proto` defines task status, progress, subtasks, and incremental messages.
- `C:\trunk\doc\csvdir\任务表.csv` defines task names, descriptions, ordering, and successor/subtask links.
- `seria-qa-overlay/` contains the overlay source, installers, verified ReShade
  runtime, optional DLSS5 payload, and the explicit SVNmate module release
  entry point.
- The native overlay is implemented; the task browser presents the same client
  and server task collections used by PrintCurrentTask, including hidden records.

## Product Principles

- Runtime truth over reconstructed log text.
- Important transitions remain visible long enough to understand.
- Diagnostic depth expands on demand; normal gameplay stays visually quiet.
- Read-only by default and failure-isolated from gameplay and rendering.
- Every warning states the corrective action, not only the failure.

## Accessibility & Inclusion

- Support Chinese task names and mixed Chinese/Latin diagnostic text.
- Remain legible at 2560x1440 and high-DPI desktop scaling.
- Never rely on color alone; every node state also uses an icon or shape treatment.
