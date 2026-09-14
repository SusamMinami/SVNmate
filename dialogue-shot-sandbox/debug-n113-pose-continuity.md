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
