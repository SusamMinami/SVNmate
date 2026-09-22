---
version: 1
slug: "src-seriaqaoverlay-seriaqaoverlay-cpp"
primary_target: "src/SeriaQAOverlay/SeriaQAOverlay.cpp"
related_targets: []
---

## Surface

Seria QA Overlay, Windows/ReShade, Operate mode.

Audience: internal quest designers, QA, and developers. Task: understand the
current quest transition, immediate candidates, navigation/dialogue context,
and DLSS5 health without leaving gameplay. Constraints: read-only, compact,
non-interactive HUD, Chinese text, 2560x1440, high DPI.

## Direction contract

THESIS: A practical task browser makes every held task identifiable by ID and
name, with details one click away.

OWN-WORLD: Neutral charcoal, readable white text, muted blue selection, native
controls, compact document icons. No neon, decorative gutter, or sci-fi titles.

STORY: Browse all held records, search, select a task, inspect its description
and candidates, copy its identity for discussion.

FIRST VIEWPORT: Task tab opens by default. Search and filters precede a wrapping
tile grid with a detail pane; narrow windows stack details below. Events,
graphics diagnostics, and display preferences occupy separate tabs.

FORM: User-pinned practical native task browser, code-led. Seed `cf2c30fe`
acknowledged; explicit user rejection of the incumbent identity takes priority.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
