# Debug Session: target-bind-pose
- Status: [OPEN]
- Issue: UE target adapter joints roundtrip correctly but mesh is distorted.
- Log: local Kimodo .dbg/trae-debug-log-target-bind-pose.ndjson

## Reproduction
Run tools/npc-motion-adapter/adapt_motion.py with the captured target snapshot,
prepared source blend, neutral face and a fresh output directory. Render frame 43.

## Hypotheses
| ID | Hypothesis | Likelihood | Effort | Evidence |
| --- | --- | --- | --- | --- |
| A | Edit-bone creation loses requested reference axes | High | Low | Pending matrix comparison |
| B | Animation assignments change native scale or are overwritten | Medium | Low | Pending evaluated pose comparison |
| C | Imported mesh retains incompatible parent/bind coordinates | Medium | Low | Pending neutral mesh positions |

No production UE asset writes. Keep instrumentation pending user review or abort.

## Pre-fix evidence
- Log line 1: actual bind differs from requested matrix by 2.0; head axes differ.
  A confirmed: zero-length edit bone loses orientation before length is set.
- Log line 2: mesh parent is None and world scale is 0.01. No stale parent found.
- Log line 3: pose assignment error only 0.00000378, but local negative scale present.
  B overwrite hypothesis not supported; compare scales again with correct bind axes.
- Fix: initialize length before assigning matrix; reject bind mismatch >0.0001.

## Post-fix
- Bind maximum matrix element error 0.00001264, compared with pre-fix 2.0.
- Pose assignment error 0.00000266; scales ~1.0 after explicit conversion of six
  unweighted reflected leaf axes. Weighted/non-leaf reflections are rejected.
- Original target mesh reference-pose vertex error 0.000000608m: C rejected.
- Export Y/X error on Bone123 was 0.003823m; identical scene X/Y export gives
  animation position error 0.00001768m, diagnostic skin 0.00004010m.
- Full adapter v5 passes all 120 frames / 189 bones; neutral face shown in closeup.
- Body-only run with DEBUG_SERVER_URL unset passes the same checks.
- UE assets not imported or saved. Keep optional instrumentation until user review.
