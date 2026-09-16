"""Blender-only target adapter. Reads prepared animation and UE target snapshot."""
import argparse
import hashlib
import json
import math
import os
import sys
import urllib.request
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def matrix(value):
    x, y, z, w = value["rotation_xyzw"]
    numbers = [*value["translation"], x, y, z, w, *value["scale"]]
    if not all(math.isfinite(v) for v in numbers):
        raise ValueError("Nonfinite reference transform")
    if abs(x*x + y*y + z*z + w*w - 1) > 0.001:
        raise ValueError("Reference quaternion is not normalized")
    if any(abs(abs(s)-1) > 0.0001 for s in value["scale"]):
        raise ValueError("Non-unit reference magnitude requires a separate adapter")
    return Matrix.LocRotScale(Vector(value["translation"]), Quaternion((w, x, y, z)),
                             Vector(value["scale"]))


def canonical(name):
    return name.replace(" ", "-")


def unique_names(bones):
    result = {}
    for bone in bones:
        name = canonical(bone.name)
        if name in result:
            raise ValueError("Ambiguous normalized bone name: " + name)
        result[name] = bone.name
    return result


def local_matrices(pose, parents):
    result = {}
    for name, value in pose.items():
        parent = parents[name]
        result[name] = pose[parent].inverted() @ value if parent else value.copy()
    return result


def blend_transform(left, right, weight):
    if weight <= 0:
        return left.copy()
    if weight >= 1:
        return right.copy()
    left_location, left_rotation, left_scale = left.decompose()
    right_location, right_rotation, right_scale = right.decompose()
    return Matrix.LocRotScale(
        left_location.lerp(right_location, weight),
        left_rotation.slerp(right_rotation, weight),
        left_scale.lerp(right_scale, weight),
    )


def rotation_angle(left, right):
    dot = abs(left.to_quaternion().normalized().dot(
        right.to_quaternion().normalized()))
    return 2 * math.acos(min(1.0, dot))


def rigid_fit(source, target, allow_reflection=False):
    a, b = np.asarray(source), np.asarray(target)
    ac, bc = a.mean(axis=0), b.mean(axis=0)
    if np.linalg.matrix_rank(a - ac) < 3:
        raise ValueError("Insufficient 3D landmarks")
    u, _, vt = np.linalg.svd((a - ac).T @ (b - bc))
    rotation = vt.T @ u.T
    if not allow_reflection and np.linalg.det(rotation) < 0:
        vt[-1] *= -1
        rotation = vt.T @ u.T
    transform = np.eye(4)
    transform[:3, :3] = rotation
    transform[:3, 3] = bc - rotation @ ac
    errors = np.linalg.norm((a @ rotation.T + transform[:3, 3]) - b, axis=1)
    return Matrix(transform.tolist()), float(errors.max())


def reset_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def import_fbx(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), use_anim=False, use_image_search=False,
                             automatic_bone_orientation=False)
    bpy.context.view_layer.update()
    objects = set(bpy.context.scene.objects) - before
    rigs = [o for o in objects if o.type == "ARMATURE"]
    if len(rigs) != 1:
        raise ValueError("Expected one armature: " + str(path))
    return rigs[0], [o for o in objects if o.type == "MESH"], objects


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--snapshot", type=Path, required=True)
    p.add_argument("--motion-blend", type=Path, required=True)
    p.add_argument("--source-rig", required=True)
    p.add_argument("--idle-reference", type=Path, required=True)
    p.add_argument("--idle-frame", type=int)
    p.add_argument("--transition-frames", type=int, default=15)
    p.add_argument("--palm-forward", choices=("none", "left", "right"), default="none")
    p.add_argument("--standing-arm", choices=("none", "left", "right"), default="none")
    p.add_argument("--arm-smoothing-frames", type=int, default=5)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--face", choices=("none", "neutral"), default="none")
    p.add_argument("--primary-bone-axis", choices=("X", "Y", "Z", "-X", "-Y", "-Z"), default="X")
    p.add_argument("--secondary-bone-axis", choices=("X", "Y", "Z", "-X", "-Y", "-Z"), default="Y")
    args = p.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if args.output.exists():
        raise FileExistsError(args.output)
    if args.primary_bone_axis.lstrip("-") == args.secondary_bone_axis.lstrip("-"):
        raise ValueError("Export axes must be orthogonal")
    if args.transition_frames < 1:
        raise ValueError("Transition frames must be positive")
    if not 0 <= args.arm_smoothing_frames <= 15:
        raise ValueError("Arm smoothing radius must be between 0 and 15 frames")
    if args.standing_arm != "none" and args.palm_forward not in ("none", args.standing_arm):
        raise ValueError("Palm correction must use the active standing arm")
    profile = json.loads(args.snapshot.read_text(encoding="utf-8"))
    if profile["schema_version"] != 1 or not profile["dirty_unchanged"]:
        raise ValueError("Unsupported/unverified target snapshot")
    for entry in (profile["body"], profile.get("face")):
        if entry:
            asset = (args.snapshot.parent / entry["file"]).resolve()
            if asset.parent != args.snapshot.parent.resolve() or digest(asset) != entry["sha256"]:
                raise ValueError("Snapshot FBX hash/path mismatch")
    if args.face != "none" and not profile.get("face"):
        raise ValueError("Snapshot has no verified face attachment")
    args.output.mkdir(parents=True)
    report = {"status": "in_progress", "ue_imported": False,
              "production_approved": False, "snapshot_sha256": digest(args.snapshot),
              "motion_sha256": digest(args.motion_blend),
              "idle_reference_sha256": digest(args.idle_reference)}
    report_path = args.output / "validation.json"
    try:
        bpy.ops.wm.open_mainfile(filepath=str(args.motion_blend))
        source = bpy.data.objects.get(args.source_rig)
        if not source or source.type != "ARMATURE" or not source.animation_data:
            raise ValueError("Missing source animated rig")
        if not source.animation_data.action:
            raise ValueError("Missing source action")
        first, last = [int(round(f)) for f in source.animation_data.action.frame_range]
        if last < first or last - first > 10000:
            raise ValueError("Invalid/oversized source action")
        fps = bpy.context.scene.render.fps
        fps_base = bpy.context.scene.render.fps_base
        source_names = unique_names(source.data.bones)
        source_rest = {n: source.matrix_world @ source.data.bones[raw].matrix_local
                       for n, raw in source_names.items()}
        source_contract = {n: canonical(source.data.bones[raw].parent.name)
                           if source.data.bones[raw].parent else None for n, raw in source_names.items()}
        motion = {}
        for f in range(first, last + 1):
            bpy.context.scene.frame_set(f)
            motion[f] = {n: source.matrix_world @ source.pose.bones[raw].matrix
                         for n, raw in source_names.items()}
            if any(not math.isfinite(v) for m in motion[f].values() for row in m for v in row):
                raise ValueError("Nonfinite source pose")
        reference_before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.fbx(filepath=str(args.idle_reference), use_anim=True,
                                 anim_offset=0.0, use_image_search=False,
                                 automatic_bone_orientation=False)
        reference_rigs = [o for o in set(bpy.context.scene.objects) - reference_before
                          if o.type == "ARMATURE"]
        if len(reference_rigs) != 1 or not reference_rigs[0].animation_data or not reference_rigs[0].animation_data.action:
            raise ValueError("Idle reference must contain exactly one animated armature")
        reference = reference_rigs[0]
        reference_names = unique_names(reference.data.bones)
        reference_contract = {
            n: canonical(reference.data.bones[raw].parent.name)
            if reference.data.bones[raw].parent else None
            for n, raw in reference_names.items()
        }
        reference_first, reference_last = [
            int(round(v)) for v in reference.animation_data.action.frame_range
        ]
        idle_frame = reference_first if args.idle_frame is None else args.idle_frame
        if not reference_first <= idle_frame <= reference_last:
            raise ValueError("Idle frame is outside the reference action")
        for name in source_names.keys() & reference_names.keys():
            if source_contract[name] != reference_contract[name]:
                raise ValueError("Idle reference hierarchy differs: " + name)
        common_reference = source_names.keys() & reference_names.keys()
        source.animation_data.action = None
        for bone in source.pose.bones:
            bone.matrix_basis = Matrix.Identity(4)
        reference_constraints = []
        for name in common_reference:
            owner = source.pose.bones[source_names[name]]
            for kind in ("COPY_LOCATION", "COPY_ROTATION"):
                constraint = owner.constraints.new(kind)
                constraint.target = reference
                constraint.subtarget = reference_names[name]
                constraint.owner_space = "WORLD"
                constraint.target_space = "WORLD"
                reference_constraints.append((owner, constraint))
        bpy.context.scene.frame_set(idle_frame)
        bpy.context.view_layer.update()
        idle_pose = {
            n: source.matrix_world @ source.pose.bones[raw].matrix
            for n, raw in source_names.items()
        }
        idle_local = local_matrices(idle_pose, source_contract)
        source_rest_local = local_matrices(source_rest, source_contract)
        generated_local = {
            frame: local_matrices(pose, source_contract)
            for frame, pose in motion.items()
        }
        generated_start = generated_local[first]
        for owner, constraint in reference_constraints:
            owner.constraints.remove(constraint)
        rest_points = np.asarray([tuple(value.translation) for value in source_rest.values()])
        idle_points = np.asarray([tuple(value.translation) for value in idle_pose.values()])
        rest_span = float(np.linalg.norm(rest_points.max(axis=0) - rest_points.min(axis=0)))
        idle_span = float(np.linalg.norm(idle_points.max(axis=0) - idle_points.min(axis=0)))
        span_ratio = idle_span / rest_span
        if not 0.5 <= span_ratio <= 2.0:
            raise ValueError("Evaluated IdleStand pose has implausible bounds")
        # #region debug-point A-C:reference-evaluation
        if os.environ.get("DEBUG_SERVER_URL"):
            pose_position_errors = {
                n: (generated_start[n].translation - idle_local[n].translation).length
                for n in common_reference
            }
            pose_rotation_errors = {
                n: rotation_angle(generated_start[n], idle_local[n])
                for n in common_reference
            }
            urllib.request.urlopen(urllib.request.Request(
                os.environ["DEBUG_SERVER_URL"],
                data=json.dumps({
                    "sessionId": "n113-pose-continuity",
                    "runId": os.environ.get("DEBUG_RUN_ID", "post-fix"),
                    "hypothesisId": "A-C",
                    "location": "adapt_motion.py:reference-evaluation",
                    "msg": "[DEBUG] IdleStand evaluated through source rig",
                    "data": {
                        "source_rest_span_m": rest_span,
                        "idle_pose_span_m": idle_span,
                        "span_ratio": span_ratio,
                        "worst_pose_positions": sorted(
                            pose_position_errors.items(), key=lambda item: item[1], reverse=True
                        )[:12],
                        "worst_pose_rotations": sorted(
                            pose_rotation_errors.items(), key=lambda item: item[1], reverse=True
                        )[:12],
                    },
                }).encode(), headers={"Content-Type": "application/json"}), timeout=2).read()
        # #endregion
        reference_missing = sorted(source_names.keys() - reference_names.keys())
        for name in reference_missing:
            idle_local[name] = generated_start[name].copy()
        if args.transition_frames * 2 >= last - first + 1:
            raise ValueError("Transition windows leave no unchanged motion middle")
        active_arm = set()
        if args.standing_arm != "none":
            side = "R" if args.standing_arm == "right" else "L"
            arm_root = f"Bip001-{side}-UpperArm"
            if arm_root not in source_names:
                raise ValueError("Standing arm root not found: " + arm_root)
            for name in source_names:
                ancestor = name
                while ancestor and ancestor != arm_root:
                    ancestor = source_contract[ancestor]
                if ancestor == arm_root and name.startswith(f"Bip001-{side}-"):
                    active_arm.add(name)
        palm_setup = None
        palm_metrics = {}
        if args.palm_forward != "none":
            side = "L" if args.palm_forward == "left" else "R"
            palm_names = {
                "hand": f"Bip001-{side}-Hand",
                "shoulder": f"Bip001-{side}-UpperArm",
                "index": f"Bip001-{side}-Finger1",
                "little": f"Bip001-{side}-Finger4",
                "middle_tip": f"Bip001-{side}-Finger22",
            }
            anatomy = [
                "Bip001-Pelvis", "Bip001-Head",
                "Bip001-L-Foot", "Bip001-L-Toe0",
                "Bip001-R-Foot", "Bip001-R-Toe0",
                *palm_names.values(),
            ]
            missing_anatomy = [name for name in anatomy if name not in source_names]
            if missing_anatomy:
                raise ValueError("Palm correction requires bones: " + ", ".join(missing_anatomy))
            character_up = (
                idle_pose["Bip001-Head"].translation
                - idle_pose["Bip001-Pelvis"].translation
            ).normalized()
            character_forward = sum((
                idle_pose[f"Bip001-{leg}-Toe0"].translation
                - idle_pose[f"Bip001-{leg}-Foot"].translation
                for leg in ("L", "R")
            ), Vector())
            character_forward -= character_up * character_forward.dot(character_up)
            if character_forward.length < 0.01:
                raise ValueError("Cannot infer character forward direction from feet")
            character_forward.normalize()
            body_height = (
                idle_pose["Bip001-Head"].translation
                - idle_pose["Bip001-Pelvis"].translation
            ).length
            descendants = []
            for candidate in source_names:
                ancestor = candidate
                while ancestor and ancestor != palm_names["hand"]:
                    ancestor = source_contract[ancestor]
                if ancestor == palm_names["hand"]:
                    descendants.append(candidate)
            palm_setup = {
                **palm_names, "up": character_up, "forward": character_forward,
                "body_height": body_height, "descendants": descendants,
            }
        prepared_motion = {}
        envelope = {}
        for frame in range(first, last + 1):
            distance = min(frame - first, last - frame)
            raw_weight = min(1.0, distance / args.transition_frames)
            weight = raw_weight * raw_weight * (3 - 2 * raw_weight)
            envelope[frame] = weight
            prepared_local = {}
            prepared_world = {}
            for name in source_names:
                rebased = (
                    generated_local[frame][name]
                    @ generated_start[name].inverted()
                    @ idle_local[name]
                )
                if args.standing_arm != "none":
                    if name not in active_arm:
                        rebased = idle_local[name]
                    else:
                        rebased = Matrix.LocRotScale(idle_local[name].translation,
                            rebased.to_quaternion(), idle_local[name].to_scale())
                prepared_local[name] = blend_transform(idle_local[name], rebased, weight)
                parent = source_contract[name]
                if parent and parent not in prepared_world:
                    raise ValueError("Source bones are not parent-first")
                prepared_world[name] = (
                    prepared_world[parent] @ prepared_local[name]
                    if parent else prepared_local[name]
                )
                if active_arm and name not in active_arm:
                    prepared_world[name] = idle_pose[name].copy()
            if palm_setup:
                wrist = prepared_world[palm_setup["hand"]].translation
                along = (
                    prepared_world[palm_setup["middle_tip"]].translation - wrist
                ).normalized()
                across = (
                    prepared_world[palm_setup["little"]].translation
                    - prepared_world[palm_setup["index"]].translation
                ).normalized()
                normal = along.cross(across).normalized()
                desired = (
                    palm_setup["forward"]
                    - along * palm_setup["forward"].dot(along)
                )
                if desired.length < 0.01:
                    raise ValueError("Palm forward is parallel to finger direction")
                desired.normalize()
                signed_angle = math.atan2(
                    along.dot(normal.cross(desired)),
                    max(-1.0, min(1.0, normal.dot(desired))),
                )
                hand_height = (
                    prepared_world[palm_setup["hand"]].translation
                    - prepared_world[palm_setup["shoulder"]].translation
                ).dot(palm_setup["up"])
                raised = max(0.0, min(1.0, hand_height / (0.15 * palm_setup["body_height"])))
                raised = raised * raised * (3 - 2 * raised)
                correction_weight = raised * weight
                correction = Quaternion(along, signed_angle * correction_weight)
                transform = (
                    Matrix.Translation(wrist)
                    @ correction.to_matrix().to_4x4()
                    @ Matrix.Translation(-wrist)
                )
                for name in palm_setup["descendants"]:
                    prepared_world[name] = transform @ prepared_world[name]
                corrected_normal = correction @ normal
                palm_metrics[frame] = {
                    "weight": correction_weight,
                    "correction_deg": math.degrees(signed_angle * correction_weight),
                    "forward_alignment": corrected_normal.dot(palm_setup["forward"]),
                    "projected_forward_alignment": corrected_normal.dot(desired),
                    "finger_up_alignment": along.dot(palm_setup["up"]),
                }
            prepared_motion[frame] = prepared_world
        prepared_local = {
            frame: local_matrices(pose, source_contract)
            for frame, pose in prepared_motion.items()
        }
        if active_arm:
            # Smooth only the allowed local rotations. Sign-invariant quaternion
            # means prevent q/-q flips; FK uses unchanged IdleStand translations.
            radius = args.arm_smoothing_frames
            rotations = {f: {n: prepared_local[f][n].to_quaternion().normalized()
                             for n in active_arm} for f in prepared_local}
            for frame in prepared_motion:
                pose = {}
                for name in source_names:
                    value = idle_local[name].copy()
                    if name in active_arm:
                        mean = np.zeros((4, 4))
                        for offset in range(-radius, radius+1):
                            index = max(first, min(last, frame+offset))
                            q = np.asarray(rotations[index][name], dtype=float)
                            mean += math.exp(-0.5*(offset/max(1, radius/2))**2) * np.outer(q, q)
                        _, vectors = np.linalg.eigh(mean)
                        q = Quaternion(vectors[:, -1].tolist()).normalized()
                        if frame in (first, last):
                            q = idle_local[name].to_quaternion()
                        else:
                            fade = min(1.0, min(frame-first, last-frame)/max(1, radius))
                            fade = fade*fade*(3-2*fade)
                            q = idle_local[name].to_quaternion().slerp(q, fade)
                        value = Matrix.LocRotScale(value.translation, q, value.to_scale())
                    parent = source_contract[name]
                    pose[name] = (
                        (pose[parent] @ value if parent else value)
                        if name in active_arm else idle_pose[name].copy()
                    )
                prepared_motion[frame] = pose
            prepared_local = {f: local_matrices(pose, source_contract)
                              for f, pose in prepared_motion.items()}
        palm_summary = None
        if palm_setup:
            active_palm = [
                value for value in palm_metrics.values() if value["weight"] >= 0.99
            ]
            if not active_palm:
                raise ValueError("Selected hand never enters the raised correction region")
            palm_summary = {
                "side": args.palm_forward,
                "character_forward": list(palm_setup["forward"]),
                "maximum_correction_deg": max(
                    abs(value["correction_deg"]) for value in palm_metrics.values()),
                "active_minimum_forward_alignment": min(
                    value["forward_alignment"] for value in active_palm),
                "active_minimum_projected_forward_alignment": min(
                    value["projected_forward_alignment"] for value in active_palm),
                "active_minimum_finger_up_alignment": min(
                    value["finger_up_alignment"] for value in active_palm),
                "corrected_frames": sum(
                    value["weight"] > 0 for value in palm_metrics.values()),
            }
            # #region debug-point B:palm-correction
            if os.environ.get("DEBUG_SERVER_URL"):
                urllib.request.urlopen(urllib.request.Request(
                    os.environ["DEBUG_SERVER_URL"],
                    data=json.dumps({
                        "sessionId": "n113-pose-continuity",
                        "runId": os.environ.get("DEBUG_RUN_ID", "post-fix-palm"),
                        "hypothesisId": "B",
                        "location": "adapt_motion.py:palm-correction",
                        "msg": "[DEBUG] palm-forward correction result",
                        "data": {
                            "summary": palm_summary,
                            "active_frames": {
                                str(frame): value for frame, value in palm_metrics.items()
                                if value["weight"] >= 0.99
                            },
                        },
                    }).encode(), headers={"Content-Type": "application/json"}), timeout=2).read()
            # #endregion
            if palm_summary["active_minimum_projected_forward_alignment"] < 0.99:
                raise ValueError("Palm-forward correction did not converge")
            palm_summary["measurement_stage"] = "before standing-arm smoothing; final motion requires geometric review"
        endpoint_position_error = max(
            (prepared_local[frame][name].translation - idle_local[name].translation).length
            for frame in (first, last) for name in source_names
        )
        endpoint_rotation_error = max(
            rotation_angle(prepared_local[frame][name], idle_local[name])
            for frame in (first, last) for name in source_names
        )
        # #region debug-point D:endpoint
        if os.environ.get("DEBUG_SERVER_URL"):
            endpoint_positions = {
                f"{frame}:{name}": (
                    prepared_local[frame][name].translation
                    - idle_local[name].translation
                ).length
                for frame in (first, last) for name in source_names
            }
            endpoint_rotations = {
                f"{frame}:{name}": rotation_angle(
                    prepared_local[frame][name], idle_local[name])
                for frame in (first, last) for name in source_names
            }
            urllib.request.urlopen(urllib.request.Request(
                os.environ["DEBUG_SERVER_URL"],
                data=json.dumps({
                    "sessionId": "n113-pose-continuity",
                    "runId": os.environ.get("DEBUG_RUN_ID", "post-fix-endpoint"),
                    "hypothesisId": "D",
                    "location": "adapt_motion.py:endpoint",
                    "msg": "[DEBUG] prepared endpoint residuals",
                    "data": {
                        "max_position_error_m": endpoint_position_error,
                        "max_rotation_error_rad": endpoint_rotation_error,
                        "worst_positions": sorted(
                            endpoint_positions.items(), key=lambda item: item[1], reverse=True
                        )[:8],
                        "worst_rotations": sorted(
                            endpoint_rotations.items(), key=lambda item: item[1], reverse=True
                        )[:8],
                    },
                }).encode(), headers={"Content-Type": "application/json"}), timeout=2).read()
        # #endregion
        if endpoint_position_error > 0.0001 or endpoint_rotation_error > 0.001:
            raise ValueError("Prepared endpoints do not match IdleStand")
        motion = prepared_motion
        # #region debug-point A-B-C-D:idlestand-evidence
        if os.environ.get("DEBUG_SERVER_URL"):
            keys = [n for n in (
                "Bip001-L-Foot", "Bip001-R-Foot", "Bip001-L-Toe0", "Bip001-R-Toe0",
                "Bip001-L-Hand", "Bip001-R-Hand", "Bip001-L-Forearm", "Bip001-R-Forearm",
            ) if n in source_names and n in reference_names]
            middle = (first + last) // 2
            urllib.request.urlopen(urllib.request.Request(
                os.environ["DEBUG_SERVER_URL"],
                data=json.dumps({
                    "sessionId": "n113-pose-continuity",
                    "runId": os.environ.get("DEBUG_RUN_ID", "post-fix"),
                    "hypothesisId": "A-B-C-D",
                    "location": "adapt_motion.py:prepared-evidence",
                    "msg": "[DEBUG] IdleStand-rebased motion",
                    "data": {
                        "idle_frame": idle_frame,
                        "transition_frames": args.transition_frames,
                        "weights": {str(f): envelope[f] for f in
                                    (first, first + args.transition_frames, middle,
                                     last - args.transition_frames, last)},
                        "endpoint_max_position_error_m": endpoint_position_error,
                        "endpoint_max_rotation_error_rad": endpoint_rotation_error,
                        "palm_forward": palm_summary,
                        "key_rotation_from_idle_deg": {
                            name: {
                                "start": math.degrees(rotation_angle(
                                    prepared_local[first][name], idle_local[name])),
                                "middle": math.degrees(rotation_angle(
                                    prepared_local[middle][name], idle_local[name])),
                                "end": math.degrees(rotation_angle(
                                    prepared_local[last][name], idle_local[name])),
                            } for name in keys
                        },
                    },
                }).encode(), headers={"Content-Type": "application/json"}), timeout=2).read()
        # #endregion
        for obj in set(bpy.context.scene.objects) - reference_before:
            bpy.data.objects.remove(obj, do_unlink=True)
        reset_scene()
        scene = bpy.context.scene
        scene.render.fps, scene.render.fps_base = fps, fps_base
        scene.frame_start, scene.frame_end = first, last
        imported, meshes, imported_objects = import_fbx(args.snapshot.parent / profile["body"]["file"])
        imported_names = unique_names(imported.data.bones)
        target_names = {b["name"] for b in profile["bones"]}
        if len(target_names) != len(profile["bones"]):
            raise ValueError("Duplicate target names")
        roots = [b["name"] for b in profile["bones"] if b["parent"] is None]
        if len(roots) != 1:
            raise ValueError("Target must have one explicit root")
        missing = target_names - imported_names.keys()
        if missing not in (set(), {roots[0]}) or imported_names.keys() - target_names:
            raise ValueError("Target FBX disagrees with captured hierarchy")
        native = {}
        parents = {}
        for b in profile["bones"]:
            name, parent = b["name"], b["parent"]
            parents[name] = parent
            if parent and parent not in native:
                raise ValueError("Target bones must be parent-first")
            native[name] = (native[parent] if parent else Matrix.Identity(4)) @ matrix(b["reference_local_transform"])
        points = [n for n in imported_names]
        native_points = [list(native[n].translation * 0.01) for n in points]
        imported_rest = {n: imported.matrix_world @ imported.data.bones[raw].matrix_local
                         for n, raw in imported_names.items()}
        basis, ref_error = rigid_fit(native_points, [list(imported_rest[n].translation)
                                                    for n in points], allow_reflection=True)
        if ref_error > 0.0001:
            raise ValueError(f"Native reference and FBX disagree: {ref_error}m")
        conversion = basis @ Matrix.Diagonal((0.01, 0.01, 0.01, 1))
        inv_conversion = conversion.inverted()
        rest = {n: conversion @ m @ inv_conversion for n, m in native.items()}
        mirrored_leaves = []
        weighted = set()
        for obj in meshes:
            for vertex in obj.data.vertices:
                for group in vertex.groups:
                    if group.weight > 1e-7:
                        weighted.add(canonical(obj.vertex_groups[group.group].name))
        missing_weighted_reference = sorted(weighted & set(reference_missing))
        if missing_weighted_reference:
            raise ValueError(
                "Idle reference omits weighted source bones: "
                + ", ".join(missing_weighted_reference)
            )
        for name, value in rest.items():
            if value.to_3x3().determinant() < 0:
                if name in weighted or name in parents.values():
                    raise ValueError("Mirrored weighted/non-leaf bind bone: " + name)
                rest[name] = Matrix.LocRotScale(value.translation, value.to_quaternion(),
                                               Vector((1, 1, 1)))
                mirrored_leaves.append(name)
        for name, raw in imported_names.items():
            bone = imported.data.bones[raw]
            actual_parent = canonical(bone.parent.name) if bone.parent else roots[0]
            if parents[name] and actual_parent != parents[name]:
                raise ValueError("Target FBX parent mismatch: " + name)
        common = target_names & source_names.keys()
        source_only = source_names.keys() - target_names
        if source_only:
            raise ValueError("Unmapped source bones: " + str(sorted(source_only)))
        for name in common:
            parent = parents[name]
            while parent and parent not in common:
                parent = parents[parent]
            if parent != source_contract[name]:
                raise ValueError("Source hierarchy differs beyond extra target bones: " + name)
        align, alignment_error = rigid_fit(
            [list(source_rest[n].translation) for n in sorted(common)],
            [list(rest[n].translation) for n in sorted(common)])
        if alignment_error > 0.005:
            raise ValueError(f"Source/target are not equivalent proportions: {alignment_error}m")
        inv_align = align.inverted()
        rig_data = bpy.data.armatures.new("UE_Target_Skeleton")
        rig = bpy.data.objects.new("Armature", rig_data)
        scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active = rig
        rig.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        for name in native:
            bone = rig_data.edit_bones.new(name)
            bone.length = 0.025
            bone.matrix = rest[name]
            if parents[name]:
                bone.parent = rig_data.edit_bones[parents[name]]
        bpy.ops.object.mode_set(mode="OBJECT")
        bind_signature = {b.name: b.matrix_local.copy() for b in rig.data.bones}
        # #region debug-point A:bind-axes
        os.environ.get("DEBUG_SERVER_URL") and urllib.request.urlopen(urllib.request.Request(os.environ["DEBUG_SERVER_URL"], data=json.dumps({"sessionId":"target-bind-pose","runId":os.environ.get("DEBUG_RUN_ID","pre-fix"),"hypothesisId":"A","msg":"[DEBUG] rebuilt bind difference","data":{"max_element_error":max(abs(v) for n in rest for row in bind_signature[n]-rest[n] for v in row),"head_requested":[list(r) for r in rest["Bip001-Head"]],"head_actual":[list(r) for r in bind_signature["Bip001-Head"]]}}).encode(),headers={"Content-Type":"application/json"}),timeout=2).read()
        # #endregion
        if max(abs(v) for n in rest for row in bind_signature[n] - rest[n] for v in row) > 0.0001:
            raise ValueError("Rebuilt bind pose differs from UE reference")
        # Keep the exported UE mesh and weights, but use the exact target axes/hierarchy.
        skin_modifiers = []
        original_skin = {}
        for obj in meshes:
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            original_skin[obj.name] = np.asarray([tuple(evaluated.matrix_world @ v.co)
                                                 for v in evaluated.data.vertices])
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = world
            for group in obj.vertex_groups:
                group.name = canonical(group.name)
            for modifier in obj.modifiers:
                if modifier.type == "ARMATURE":
                    modifier.object = rig
                    skin_modifiers.append((modifier, modifier.show_viewport))
                    modifier.show_viewport = False
        for obj in imported_objects - set(meshes):
            bpy.data.objects.remove(obj, do_unlink=True)
        for modifier, visible in skin_modifiers:
            modifier.show_viewport = visible
        bpy.context.view_layer.update()
        rest_skin_error = 0.0
        for obj in meshes:
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            values = np.asarray([tuple(evaluated.matrix_world @ v.co)
                                 for v in evaluated.data.vertices])
            rest_skin_error = max(rest_skin_error, float(np.linalg.norm(values-original_skin[obj.name], axis=1).max()))
        if rest_skin_error > 0.0001:
            raise ValueError("Rebuilt rig changes exported reference mesh: " + str(rest_skin_error))
        for modifier, visible in skin_modifiers:
            modifier.show_viewport = False
        for bone in rig.pose.bones:
            bone.rotation_mode = "QUATERNION"
        # #region debug-point C:mesh-basis
        os.environ.get("DEBUG_SERVER_URL") and urllib.request.urlopen(urllib.request.Request(os.environ["DEBUG_SERVER_URL"],data=json.dumps({"sessionId":"target-bind-pose","runId":os.environ.get("DEBUG_RUN_ID","pre-fix"),"hypothesisId":"C","msg":"[DEBUG] mesh coordinates","data":[{"matrix":[list(r) for r in o.matrix_world],"groups":len(o.vertex_groups),"parent":str(o.parent)} for o in meshes]}).encode(),headers={"Content-Type":"application/json"}),timeout=2).read()
        # #endregion
        samples = {}
        for frame, source_pose in motion.items():
            scene.frame_set(frame)
            for name in native:
                bone = rig.pose.bones[name]
                if name in common:
                    desired = align @ source_pose[name] @ source_rest[name].inverted() @ inv_align @ rest[name]
                    if name in mirrored_leaves:
                        desired = Matrix.LocRotScale(desired.translation, desired.to_quaternion(),
                                                     Vector((1, 1, 1)))
                    bone.matrix = desired
                else:
                    bone.matrix_basis = Matrix.Identity(4)
                bpy.context.view_layer.update()
                bone.keyframe_insert("location", frame=frame)
                bone.keyframe_insert("rotation_quaternion", frame=frame)
                bone.keyframe_insert("scale", frame=frame)
            samples[frame] = {b.name: b.matrix.copy() for b in rig.pose.bones}
        # #region debug-point B:pose
        os.environ.get("DEBUG_SERVER_URL") and urllib.request.urlopen(urllib.request.Request(os.environ["DEBUG_SERVER_URL"],data=json.dumps({"sessionId":"target-bind-pose","runId":os.environ.get("DEBUG_RUN_ID","pre-fix"),"hypothesisId":"B","msg":"[DEBUG] evaluated poses","data":{"scale_min":min(v for b in rig.pose.bones for v in b.scale),"scale_max":max(v for b in rig.pose.bones for v in b.scale),"max_assignment_error":max(abs(v) for f in samples for n in common for row in samples[f][n]-(align@motion[f][n]@source_rest[n].inverted()@inv_align@rest[n]) for v in row)}}).encode(),headers={"Content-Type":"application/json"}),timeout=2).read()
        # #endregion
        # #region debug-point A-B:gesture-layer-excursion
        if os.environ.get("DEBUG_GESTURE_URL"):
            excursions = {n: max((samples[f][n].translation - samples[first][n].translation).length
                                 for f in samples) for n in native}
            urllib.request.urlopen(urllib.request.Request(
                os.environ["DEBUG_GESTURE_URL"], data=json.dumps({
                    "sessionId": "n113-gesture-layer", "runId": os.environ.get("DEBUG_RUN_ID", "pre-fix"),
                    "hypothesisId": "A-B", "msg": "[DEBUG] baked world-space excursions",
                    "data": {"bones_m": excursions}
                }).encode(), headers={"Content-Type": "application/json"}), timeout=2).read()
        # #endregion
        rig.animation_data.action.name = "Target_Adapted_Motion"
        standing_quality = None
        if active_arm:
            protected = set(common) - active_arm
            protected_position = max((samples[f][n].translation - samples[first][n].translation).length
                                     for f in samples for n in protected)
            protected_rotation = max(rotation_angle(samples[f][n], samples[first][n])
                                     for f in samples for n in protected)
            active_peak_step = max(rotation_angle(samples[f-1][n], samples[f][n])
                                   for f in range(first+1, last+1) for n in active_arm)
            endpoint_world_position = max(
                (samples[last][n].translation - samples[first][n].translation).length for n in native)
            standing_quality = {
                "protected_position_excursion_m": protected_position,
                "protected_rotation_excursion_rad": protected_rotation,
                "active_peak_step_deg": math.degrees(active_peak_step),
                "first_last_position_error_m": endpoint_world_position,
                "cloth_policy": "non-arm world poses held at authored IdleStand; no simulation",
                "collision_review": "required_on_evaluated_mesh",
            }
            if protected_position > 0.0001 or protected_rotation > 0.001:
                raise ValueError("Standing layer moved protected bones")
            if active_peak_step > math.radians(20):
                raise ValueError("Standing layer angular step exceeds 20 degrees/frame")
            if endpoint_world_position > 0.0001:
                raise ValueError("Standing layer endpoints diverged after baking")
        for modifier, visible in skin_modifiers:
            modifier.show_viewport = visible
        if any(max(abs(v) for row in rig.data.bones[n].matrix_local - m for v in row) > 1e-6
               for n, m in bind_signature.items()):
            raise ValueError("Target bind matrices changed")
        face_meshes = []
        if args.face == "neutral":
            face_profile = profile["face"]
            face_rig, face_meshes, face_objects = import_fbx(args.snapshot.parent / face_profile["file"])
            head = face_profile["attach_bone"]
            local = matrix(face_profile["relative_transform"])
            base = conversion @ native[head] @ local @ inv_conversion
            original = {o: o.matrix_world.copy() for o in face_objects if o.parent not in face_objects}
            for frame in motion:
                scene.frame_set(frame)
                delta = samples[frame][head] @ rest[head].inverted()
                for obj, world in original.items():
                    obj.matrix_world = delta @ base @ world
                    obj.rotation_mode = "QUATERNION"
                    for prop in ("location", "rotation_quaternion", "scale"):
                        obj.keyframe_insert(prop, frame=frame)
            report["face"] = {"mode": "neutral", "attach_bone": head,
                              "source": "UE exported face and captured SCS relative transform"}
        for frame in motion:
            scene.frame_set(frame)
            for obj in [*meshes, *face_meshes]:
                evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
                if any(not math.isfinite(v) for vertex in evaluated.data.vertices for v in vertex.co):
                    raise ValueError("Nonfinite evaluated mesh")
        scene.frame_set(first)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.output / "target_preview.blend"))
        # Separate animation delivery from the mesh-containing diagnostic reference.
        exports = []
        for filename, include_mesh in (("animation.fbx", False), ("diagnostic_skin.fbx", True)):
            bpy.ops.object.select_all(action="DESELECT")
            rig.select_set(True)
            for obj in meshes:
                obj.select_set(include_mesh)
            bpy.context.view_layer.objects.active = rig
            path = args.output / filename
            bpy.ops.export_scene.fbx(filepath=str(path), use_selection=True,
                object_types={"ARMATURE", "MESH"} if include_mesh else {"ARMATURE"},
                add_leaf_bones=False, bake_anim=True, bake_anim_use_nla_strips=False,
                bake_anim_use_all_actions=False, bake_anim_simplify_factor=0,
                axis_forward="-Z", axis_up="Y", primary_bone_axis=args.primary_bone_axis,
                secondary_bone_axis=args.secondary_bone_axis)
            exports.append({"file": filename, "sha256": digest(path)})
        roundtrips = {}
        for filename in ("animation.fbx", "diagnostic_skin.fbx"):
            reset_scene()
            bpy.ops.import_scene.fbx(filepath=str(args.output / filename), use_anim=True,
                                    anim_offset=0, use_image_search=False)
            recovered = next(o for o in scene.objects if o.type == "ARMATURE")
            actual_parents = {b.name: b.parent.name if b.parent else None for b in recovered.data.bones}
            if actual_parents != parents:
                raise ValueError(filename + " changed exact target hierarchy")
            if list(recovered.animation_data.action.frame_range) != [first, last]:
                raise ValueError(filename + " changed duration")
            scene.frame_set(first)
            # FBX import re-expresses bone axes. Mesh export carries bind poses;
            # animation-only checks relative motion, not unverified reference axes.
            if filename == "diagnostic_skin.fbx":
                actual_basis = {b.name: recovered.matrix_world @ b.matrix_local
                                for b in recovered.data.bones}
                expected_basis = rest
            else:
                actual_basis = {b.name: recovered.matrix_world @ b.matrix
                                for b in recovered.pose.bones}
                expected_basis = samples[first]
            position_error = rotation_error = 0.0
            for frame, expected in samples.items():
                scene.frame_set(frame)
                for name in native:
                    actual = recovered.matrix_world @ recovered.pose.bones[name].matrix
                    position_error = max(position_error, (actual.translation - expected[name].translation).length)
                    qa = (actual @ actual_basis[name].inverted()).to_quaternion().normalized()
                    qe = (expected[name] @ expected_basis[name].inverted()).to_quaternion().normalized()
                    rotation_error = max(rotation_error, 2 * math.acos(min(1, abs(qa.dot(qe)))))
            roundtrips[filename] = {"position_error_m": position_error,
                "rotation_error_rad": rotation_error,
                "rotation_basis": "bind_pose" if filename == "diagnostic_skin.fbx" else "first_frame"}
            if position_error > 0.001 or rotation_error > 0.005:
                raise ValueError(f"{filename} roundtrip failed: {position_error}, {rotation_error}")
        report.update(status="offline_target_adapter_passed_not_ue_imported",
                      target_bone_count=len(native), mapped_bones=len(common),
                      preserved_extra_bones=sorted(target_names - common),
                      restored_root_from_armature=list(missing),
                      unweighted_mirrored_leaf_axis_conversion=mirrored_leaves,
                      source_alignment_max_error_m=alignment_error,
                      native_reference_fbx_max_error_m=ref_error,
                      rebuilt_reference_mesh_max_error_m=rest_skin_error,
                      idle_reference_frame_range=[reference_first, reference_last],
                      idle_reference_frame=idle_frame,
                      idle_reference_evaluation="copy world location/rotation onto source rig; do not copy scale",
                      idle_reference_pose_span_ratio=span_ratio,
                      idle_reference_missing_unweighted_bones=reference_missing,
                      transition_frames=args.transition_frames,
                      endpoint_idle_max_position_error_m=endpoint_position_error,
                      endpoint_idle_max_rotation_error_rad=endpoint_rotation_error,
                      standing_arm=args.standing_arm,
                      active_arm_bones=sorted(active_arm),
                      arm_smoothing_frames=args.arm_smoothing_frames if active_arm else 0,
                      standing_quality=standing_quality,
                      visual_quality_approved=False,
                      palm_forward=palm_summary,
                      ue_to_blender_matrix=[list(row) for row in conversion],
                      export_bone_axes=[args.primary_bone_axis, args.secondary_bone_axis],
                      frame_range=[first, last], fps=fps, fps_base=fps_base,
                      roundtrips=roundtrips,
                      target_hierarchy_exact=True, exports=exports)
        report["motion_quality"] = {"status": "not_checked", "production_approved": False}
        if active_arm:
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from check_motion_quality import validate_preview
            quality = validate_preview(args.output / "target_preview.blend",
                                       args.standing_arm, args.output / "motion-quality.json")
            report["motion_quality"] = {
                key: value for key, value in quality.items() if key != "frames"
            }
            if quality["blocking_reasons"]:
                report["status"] = "motion_quality_blocked_not_ue_imported"
    except Exception as error:
        report.update(status="failed", error=str(error))
        raise
    finally:
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if report["status"] == "motion_quality_blocked_not_ue_imported":
        raise RuntimeError("Diagnostic outputs only: " + ", ".join(
            report["motion_quality"]["blocking_reasons"]))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
