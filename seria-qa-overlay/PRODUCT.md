# Product

<!-- impeccable:product-schema 1 -->

## Platform

windows

## Users

- Internal Seria quest designers, QA engineers, and developers.
- Used while running development or test builds to observe quest progression and graphics injection state without leaving gameplay.

## Product Purpose

The working product, Seria QA Overlay, provides an always-visible, read-only view of the player's current quest flow and a detailed Home-key diagnostic surface. Success means a tester can identify what just completed, what is active, and what comes next without manually typing a startup GM command. When the separate DLSS5 package is installed, the same surface also reports its state.

## Positioning

It combines authoritative quest state from the game's existing Lua task manager with a ReShade overlay. Optional post-render diagnostics activate only when the separate DLSS5 package is present. The overlay visualizes actual runtime transitions instead of periodically scraping `PrintCurrentTask` text.

## Operating Context

- Runs over the UE4 Windows client during interactive play, including map changes, dialogue, navigation, reconnects, and instance transitions.
- A compact top-left HUD remains visible during normal play.
- The ReShade Home overlay opens the complete task graph, event history, filters, and optional DLSS5 diagnostics.
- The first release is diagnostic only. It must not complete, skip, accept, remove, or otherwise mutate tasks.

## Capabilities and Constraints

- Consume task accept, refresh, finish, remove, trace, task-line completion, and initial-list events.
- Distinguish persistent quest state from transient navigation and dialogue activity.
- Resolve candidate next nodes from task configuration while preserving branch ambiguity.
- Do not poll or repeatedly invoke the `PrintCurrentTask` GM command.
- Offer one-click capture startup by opening the built-in GM dialog and submitting only the fixed local bootstrap command.
- Keep the persistent HUD non-interactive so it cannot capture gameplay input.
- Preserve D3D11 compatibility and the existing ReShade 6.8+ injection architecture.
- When DLSS5 is installed, preserve RTX 4080 safeguards: `NeuralUplift=0`, `skip_exe=2`, and the verified 2560x1440 configuration.
- QA and DLSS5 must ship as separate, independently restorable ZIP packages.
- The current DLSS5 DX11 bridge package remains independently replaceable; the task UI must not make bridge failure affect quest logic.
- Product name: Seria QA Overlay.
- Lua-to-addon transport: validated double-buffered UTF-8 snapshots under
  `Saved`, consumed only after a complete matching end marker is present.

## Brand Commitments

- Quiet, dense, work-focused QA tooling.
- Practical native task browser: neutral gray, readable text, and a restrained
  blue selection state. The user explicitly rejected the earlier cyberpunk /
  industrial presentation on 2026-09-17.
- High information density, consistent feedback, crisp high-DPI typography, and automatic collapse of secondary information.

## Evidence on Hand

- `C:\trunk\res\Content\Seria\Script\UI\Task\TaskManager.lua` contains the authoritative client task state, events, task graph traversal, and current debug output.
- `C:\trunk\bin\ServerDevLibs\proto\Game\game\taskModule\taskModule.proto` defines task status, progress, subtasks, and incremental messages.
- `C:\trunk\doc\csvdir\任务表.csv` defines task names, descriptions, ordering, and successor/subtask links.
- `seria-qa-overlay/` contains the overlay source, installers, verified ReShade
  runtime, optional DLSS5 payload, and independent release workflows.
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
