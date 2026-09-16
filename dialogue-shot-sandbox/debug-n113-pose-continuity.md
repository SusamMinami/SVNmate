# Debug Session: n113-pose-continuity
- Status: [OPEN]
- Issue: Adapted N113 motion has raised feet, incorrect waving-hand orientation,
  and does not begin/end at the authored IdleStand pose.
- Log: local Kimodo `.dbg/trae-debug-log-n113-pose-continuity.ndjson`

## Reproduction
Compare frames 1/120 and the raised-hand frames of the current target-adapter
preview against `A_N113_Ratking_Idlestand1.fbx`, using the same target mesh,
coordinate basis, and 189-bone UE snapshot. Do not import or save UE assets.

## Hypotheses
| ID | Hypothesis | Likelihood | Effort | Expected evidence |
| --- | --- | --- | --- | --- |
| A | Kimodo source foot/hand rest rotations are transferred as absolute deltas from a different authored neutral pose | High | Low | Source-to-IdleStand local rotation offsets remain at frames 1/120 |
| B | Current world-space transfer preserves joints but maps end-effector bone axes incorrectly | High | Medium | Hand/foot positions agree while bind-relative rotations diverge |
| C | N113 IdleStand contains authored finger, foot and auxiliary-bone offsets absent from generated motion | High | Low | Reference animation has nonidentity local pose on those chains |
| D | A transition blend alone can restore endpoints without corrupting the gesture middle | Medium | Low | Delta-to-IdleStand reaches zero at endpoints and retains middle trajectory |

## Safety
No UE imports, saves, asset creation, production writes, or source FBX changes.
Keep instrumentation and this record until user confirms success or aborts.

## Pre-fix evidence
- Log line 1: generated key-bone start/end rotations are identical.
- Feet differ from IdleStand by 25.26 / 24.77 degrees while local translations
  differ by only 0.89 / 1.15mm.
- Hands differ by 12.18 / 6.02 degrees at endpoints; the waving right hand and
  forearm differ by 24.62 / 76.24 degrees in the middle.
- IdleStand frame 0 and 180 match on all sampled chains; its loop boundary is a
  valid authored endpoint. In-loop variation is intentional.

## Verification conclusion
- A confirmed: generated neutral and authored IdleStand are different bases.
- B confirmed: end-effector joint placement is close but local orientation diverges.
- C confirmed: feet, hands and forearms all carry authored IdleStand offsets.
- D supported: rebase generated local motion from its identical endpoints onto
  IdleStand frame 0, then apply a 15-frame smooth endpoint envelope.

## Reference import evidence
- Animation-FBX bind matrices are not directly compatible data: Bone045 reports
  a 253.486m local discrepancy and finger axes differ by up to 0.791rad.
- Idle pose local matrices also expose meter-scale garment offsets on Bone055/099.
  Therefore direct local-matrix blending is rejected.
- Existing visual reference playback succeeded by copying position/rotation (not
  scale) from the animation armature onto the actual source rig. The fix must
  evaluate IdleStand through that source rig before computing local pose deltas.

## Palm evidence
- The palm plane uses wrist, index, little-finger and middle-finger landmarks.
- Old frame 43 absolute palm/forward alignment: 0.0619; rebased frame 43: 0.3647.
- Rebased frame 60 alignment is 0.1624 while finger/up alignment is 0.7935.
- Baseline rebasing improves but does not solve palm facing. Apply an explicit
  wave-only wrist twist around the finger direction; do not alter hand position,
  finger-up direction, or non-wave actions.

## Post-fix evidence
- IdleStand is evaluated by copying world location/rotation onto the real source
  rig; animation-FBX scale/bind matrices are not consumed as pose truth.
- A 15-frame smoothstep envelope has weights 0 at frames 1/120 and 1 at
  frames 16/105 and through the gesture middle.
- All-bone endpoint residual: 0.00003280m / 0.00069053rad.
- Feet/toes at frame 60 differ from IdleStand by at most 0.0969 degrees.
- Explicit right-wave correction affects 92 raised/transition frames, rotates
  around finger direction only, and leaves endpoints unchanged.
- Palm/forward alignment at frames 25/43/60/79 is approximately
  0.926 / 0.955 / 0.917 / 0.955; projected alignment is >=0.99999978.
- Full 120-frame/189-bone FBX roundtrip passes:
  animation 0.00001937m / 0.00097656rad; diagnostic skin
  0.00002047m / 0.00119604rad.
- Neutral-face and body-only branches pass with the same motion checks.
- 14 contract checks, Python compile, TypeScript type check, links and
  `git diff --check` pass.
- No UE writes. Current UE has unrelated dirty package
  `/Game/Seria/Task/taskgraph/MainQuest/1009-Cha9`; future import must block.

## User verification
Review `%LOCALAPPDATA%/Kimodo/runs/20260914-n113-idlestand-palm-final-v2/`
`n113_body_preview.gif`. Keep status OPEN and retain instrumentation until the
user confirms fixed, reports another symptom, or aborts.

User replied B: full-motion quality remains unacceptable (foot sway, awkward
gesture, severe garment intersections). This candidate is NOT accepted.
Continuation evidence is in [debug-n113-gesture-layer.md](debug-n113-gesture-layer.md);
that iteration corrects unwanted motion but still blocks on garment crossings.
