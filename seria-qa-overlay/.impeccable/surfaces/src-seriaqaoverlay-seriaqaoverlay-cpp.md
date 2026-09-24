---
version: 1
slug: "src-seriaqaoverlay-seriaqaoverlay-cpp"
primary_target: "src/SeriaQAOverlay/SeriaQAOverlay.cpp"
related_targets: []
---

## Surface

Seria QA Overlay, Windows/ReShade, Operate mode.

Audience: internal quest designers, QA, and developers. Task: understand the
current quest transition, complete task-line node state, active dialogue IDs
and type, navigation context, and DLSS5 health without leaving gameplay.
Constraints: read-only task inspection, compact non-interactive HUD, Chinese
text, 2560x1440, high DPI.

## Direction contract

THESIS: A practical task browser makes every held task and current dialogue
trigger identifiable by ID, with task details one click away.

OWN-WORLD: Neutral charcoal, readable white text, muted blue selection, native
controls, compact document icons. No neon, decorative gutter, or sci-fi titles.

STORY: Browse all held records, search, select a task, inspect its description
and complete node line, copy its identity for discussion, or submit a fixed GM
command without exposing arbitrary command text. Completed and current nodes
are visually distinct; a non-held node can be added directly through the fixed
`addtask` command while held-task double-click continues to copy its exact ID.

FIRST VIEWPORT: Task tab opens by default. Search and filters precede a wrapping
tile grid with a detail pane; narrow windows stack details below. An active
dialogue block stays above the tabs and in the HUD, naming its type, start ID,
and current-line ID. The detail pane contains a dense status/ID/node/action
table instead of hiding graph state under technical disclosure. Events, fixed
GM diagnostics and approved actions, graphics diagnostics, and display
preferences occupy separate tabs.

FORM: User-pinned practical native task browser, code-led. Seed `cf2c30fe`
acknowledged; explicit user rejection of the incumbent identity takes priority.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
