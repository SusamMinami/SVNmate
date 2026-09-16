# NPC Motion Target Adapter

Experimental offline adapter, not a production import command or a sandbox UI.
The input motion must already be retargeted to the source character proportions.
This tool adapts that motion to a captured UE character's exact names and hierarchy.
It does not invoke Kimodo, solve arbitrary humanoid retargeting, or generate face/cloth motion.

## Capture

Run from `dialogue-shot-sandbox/` with the requested UE project already open:

```powershell
npx tsx tools/npc-motion-adapter/capture-target.ts `
  --project "<absolute .uproject>" `
  --blueprint "/Game/.../BP_NPC" `
  --body-component CharacterMesh0 `
  --output "<new directory outside Content>"
```

Optional independent face: provide both `--face-node "<full SCS node path>"` and
`--face-template "<full component template path>"`. The tool reads the node's
parent and attachment bone and checks it against the requested body/template.
Do not copy one character's node index or attachment values to another character.

Capture exports **local FBX copies** and `target.json`, not UE assets. It refuses
existing output directories, any dirty content packages, a different project, or
output inside Content. It uses a transient unregistered component to reconstruct
local reference transforms from inverse identity-pose deltas, cross-checking every
local position with `get_ref_pose_position`. No actor is spawned.
The FBX reference joint positions are independently checked in the Blender stage.

## Adapt

Use Blender 5.2 with its bundled NumPy. No Rokoko plugin or debug server is required.

```powershell
& "<blender.exe>" --background --factory-startup --disable-autoexec `
  --python-exit-code 1 --python tools/npc-motion-adapter/adapt_motion.py -- `
  --snapshot "<capture>/target.json" `
  --motion-blend "<prepared animation.blend>" `
  --source-rig "<exact animated Armature object>" `
  --idle-reference "<A_NPC_Idlestand.fbx>" `
  --transition-frames 18 `
  --palm-forward right `
  --standing-arm right `
  --arm-smoothing-frames 5 `
  --face neutral `
  --output "<new output directory>"
```

An authored IdleStand reference is required. The adapter evaluates its location
and rotation through the real source rig instead of trusting animation-FBX bind
matrices or copying scale. It treats generated motion as change relative to its
first frame, rebases that change onto the chosen IdleStand frame (the loop start
by default), and applies a smooth endpoint envelope. First and last frames must
match IdleStand within 0.1mm / 0.001rad or the command fails.

`--transition-frames` controls each endpoint window and must leave an unchanged
middle. `--idle-frame` may select another authored frame explicitly.
`--palm-forward left|right` is an opt-in wave correction: while that hand is raised,
it twists the wrist and descendants only around the finger direction so the palm
plane faces the character's foot-inferred forward direction. It preserves wrist
position and finger-up direction. Other gestures should leave it as `none`.

For a planted standing gesture, `--standing-arm left|right` transfers only that
arm's rotations. It holds the pelvis, legs, torso, other arm and all non-arm
source bones at the authored IdleStand **world** pose, including garment bones
parented to the active arm. The active arm uses IdleStand local translations and
scales. `--arm-smoothing-frames` is a 0-15 frame radius for sign-invariant
quaternion averaging after palm correction; it preserves both endpoints.
The palm measurements in the report precede smoothing, not final facing proof.

This mode is restricted to the current Bip001 mapping. It intentionally removes
full-body secondary motion and does not simulate cloth. Frozen garments may still
intersect the moving arm. The current N113 wave **still fails the geometry gate**;
it is not a ready-to-import action or a visually approved example.

`--face none` is the default and works for characters without an independent face.
`neutral` uses the exported UE face and the captured relative transform. Existing
facial expression clips are not silently reused or overwritten.

The adapter:

- Verifies FBX hashes and normalizes spaces to hyphens with collision detection.
- Fits the native UE-to-FBX coordinate basis from 3D landmarks, with a 0.1 mm
  reference residual limit. Does not hardcode an NPC's handedness or facing.
- Requires near-identical source/target proportions (5 mm landmark residual).
- Rebuilds the target hierarchy, restoring a root Blender represented as an object.
- Rebases source-local motion onto authored IdleStand, then transfers the resulting
  world-space deformation relative to source rest. Unmapped target bones keep
  their local reference relation and follow their parent.
- Preserves the exported target mesh and weights. Refuses mirrored weighted or
  non-leaf bind bones; reflected unweighted leaf axes are normalized and reported.
- Rejects nonfinite data, unsupported non-unit scale magnitudes, missing bones,
  weighted bones omitted by IdleStand, name collisions, invalid hierarchy,
  implausible evaluated IdleStand bounds, and changed bind matrices.
- Exports `animation.fbx` separately from `diagnostic_skin.fbx`.
- Exposes `--primary-bone-axis` / `--secondary-bone-axis` (defaults X/Y);
  export coordinate axes are validated, not silently changed after a failure.
- Checks every frame and target bone. Animation-only rotation is compared relative
  to its first frame; the diagnostic FBX rotation is compared relative to bind pose.

## Outputs And Limits

`target_preview.blend`, `animation.fbx`, `diagnostic_skin.fbx`, `validation.json`.
The separate face is included in the preview only, not in the body exports.

Standing-arm mode also writes `motion-quality.json` automatically. It checks all
frames for foot motion, protected skin movement, angular steps and new arm/garment
triangle crossings relative to the first frame. New crossings, a missing garment
mapping or a motion failure produce a nonzero exit and
`motion_quality_blocked_not_ue_imported`, even when FBX roundtrip passed.
Files are retained for diagnosis, not as accepted deliverables.

The mesh gate currently identifies N113 garments by dominant skin weights.
It is conservative: existing intersections, penetration depth, swept motion
between frames and collisions within one region or across meshes are not solved.
Its 20-degree/frame angular ceiling catches gross jumps, not animation quality.
Non-standing mode reports geometry quality as `not_checked`.

To assess an already generated preview without regenerating motion:

```powershell
& "<blender.exe>" --background --factory-startup --disable-autoexec `
  --python-exit-code 1 --python tools/npc-motion-adapter/check_motion_quality.py -- `
  --blend "<target_preview.blend>" --side right --output "<new quality.json>"
```

An offline pass does **not** establish UE import compatibility, runtime face-curve
consumption, foot contact, cloth collision, correct root motion, or production
animation quality. Exporter-added Armature nodes, reference axes and mirrored leaf
representation still require a controlled UE import test against the captured
Skeleton. Never update the existing UE Skeleton's reference pose during that test.

This tool contains no UE import/save operation. Asset writes must go through the
existing reviewed NPC supplement workflow after a separately authorized test.

For the N113 trial, see
[the dated validation record](../../docs/research/kimodo-n113-validation-2026-09-14.md).
Machine paths, character assets, snapshots and generated outputs stay outside Git.

## Verification

Syntax checks do not launch UE:

```powershell
python -m py_compile tools/npc-motion-adapter/adapt_motion.py tools/npc-motion-adapter/export_target.py tools/npc-motion-adapter/check_motion_quality.py
npx tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler tools/npc-motion-adapter/capture-target.ts
& "<blender.exe>" --background --factory-startup --disable-autoexec --python-exit-code 1 --python tools/npc-motion-adapter/check_contracts.py
git diff --check
```

Temporary `debug-point` instrumentation runs only when `DEBUG_SERVER_URL` or
`DEBUG_GESTURE_URL` is set;
it is retained pending review of the bind-pose and pose-continuity fixes. Leave
that variable unset for ordinary offline operation. `DEBUG_RUN_ID` distinguishes
pre/post-fix evidence.
