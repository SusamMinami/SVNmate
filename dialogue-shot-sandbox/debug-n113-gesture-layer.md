# Debug Session: n113-gesture-layer
- Status: [OPEN]
- Issue: User rejected the IdleStand/palm candidate: awkward motion, foot sway,
  sleeve/cape/shoulder interpenetration.
- Scope: Offline N113 motion adapter only. No UE reads/writes needed.
- Logs: local Kimodo `.dbg/trae-debug-log-n113-gesture-layer.ndjson`

## Hypotheses
| ID | Hypothesis | Likelihood | Effort | Observable signal |
| --- | --- | --- | --- | --- |
| A | Full-body deltas move pelvis and feet during a standing wave | High | Low | World-space excursion across all frames, not one local foot rotation |
| B | Imported Talk garment motion is incompatible with wave | High | Low | Sleeve/cape auxiliary motion in input and output |
| C | Arm path intersects fixed authored garment geometry | Medium | Medium | New triangle intersections relative to IdleStand baseline |
| D | Per-frame palm correction creates abrupt angular motion | Medium | Low | Wrist angular step/acceleration peaks |

## Reproduction
Inspect existing `n113-idlestand-palm-final-v2/target_preview.blend`,
the prepared `n113-reference-cloth` source, and the authored IdleStand pose.
Compare final skin, protected bone motion, and intersections using identical
sampling and rig/mesh data before and after a narrowly scoped layer fix.

Do not treat file roundtrip, low local-rotation error, or selected screenshots
as proof of natural animation or collision-free production output.
Retain instrumentation until explicit user acceptance or abort.

## Pre-fix Evidence
- Log line 1 / bone motion: feet 1.30/1.41cm, toes 1.78/1.16cm excursions.
  Right hand reaches 44.01 degrees per frame. A and D confirmed.
- Log line 2 / skin motion: sleeve roots 055/099 regions reach 32.63/29.70cm;
  cape 047/069 regions reach 12.11/11.25cm. B confirmed.
- Triangle crossings already exist at IdleStand (1259 pairs); sampled frame 91
  introduces 1591 different crossing pairs. This is not a penetration depth metric.
  C remains open until the unrelated garment motion is excluded.
- Planned limited mode: explicit right/left arm rotation layer, IdleStand elsewhere;
  no copied Talk garment deltas, no animated bone translations/scales. Smooth only
  the active arm after palm correction, retaining exact authored endpoints.

## Iteration Evidence
- Local-only IdleStand holding still raised the right sleeve: its root inherits
  UpperArm. After world-pose holding, sleeve/cape vertex motion is near zero.
- All-frame final comparison: foot/toe excursion 17.84mm -> 0mm; protected skin
  326.68mm -> 0.00112mm; peak arm step 44.01 -> 15.19 degrees.
- Final targeted cross-region gate: 59 baseline arm/garment crossings,
  650 new crossings at worst versus 720 before. C remains unresolved.
- Bounded forward-plane (0/25/45/65/85 degrees) and reduced upper-arm amplitude
  probes still intersect garments. These probes are not production code.
- Integrated run `20260914-n113-arm-layer-guarded` deliberately exits nonzero,
  status `motion_quality_blocked_not_ue_imported`; diagnostic FBX/preview retained.
- Static IdleStand two-frame control passes with zero new crossings. It still
  reports production_approved=false and does not approve baseline intersections.
- Existing 14 contract checks and Python compile pass. No UE access/writes.

## Handoff
Feet/unrelated cloth motion corrected; naturalness and arm/garment avoidance NOT
approved. Latest preview is explicitly labelled QUALITY BLOCKED. Further work
requires a collision-aware arm path or garment-specific authored corrections,
not another relaxed numeric threshold. Left-hand mode is not character-verified.
Keep this session OPEN for user feedback or explicit abort.
