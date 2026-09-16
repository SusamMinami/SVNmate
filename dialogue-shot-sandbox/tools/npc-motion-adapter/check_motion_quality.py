"""Blender offline all-frame skin/motion gate, independent of FBX roundtrip."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree


def shortest_angle(left, right):
    a = np.asarray(left.to_quaternion(), dtype=float)
    b = np.asarray(right.to_quaternion(), dtype=float)
    dot = abs(float(np.dot(a / np.linalg.norm(a), b / np.linalg.norm(b))))
    return math.degrees(2 * math.acos(min(1, dot)))


def validate_preview(blend, side, output, rig_name="Armature"):
    if output.exists():
        raise FileExistsError(output)
    if side not in ("left", "right"):
        raise ValueError("Unknown arm side")
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    scene = bpy.context.scene
    rig = scene.objects.get(rig_name)
    if not rig or not rig.animation_data or not rig.animation_data.action:
        raise ValueError("Expected animated target rig")
    side = "R" if side == "right" else "L"
    root = f"Bip001-{side}-UpperArm"
    if root not in rig.data.bones:
        raise ValueError("Unknown arm root")
    active = {b.name for b in rig.data.bones if b.name.startswith(f"Bip001-{side}-") and
              (b.name == root or root in {p.name for p in b.parent_recursive})}
    feet = [f"Bip001-{s}-{part}" for s in ("L", "R") for part in ("Foot", "Toe0")]
    if any(n not in rig.data.bones for n in feet):
        raise ValueError("Missing foot landmarks")
    first, last = (int(f) for f in rig.animation_data.action.frame_range)
    if last <= first or last - first > 10000:
        raise ValueError("Invalid/oversized motion range")
    meshes = [o for o in scene.objects if o.type == "MESH" and any(
        m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]
    if not meshes:
        raise ValueError("Skin is required for quality validation")
    topology = {}
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles = [tuple(t.vertices) for t in obj.data.loop_triangles]
        dominant = [obj.vertex_groups[max(v.groups, key=lambda g: g.weight).group].name
                    if v.groups else "" for v in obj.data.vertices]
        arm = [i for i, t in enumerate(triangles) if sum(dominant[v] in active for v in t) >= 2]
        garment = [i for i, t in enumerate(triangles)
                   if sum(dominant[v].startswith("N113_") for v in t) >= 2]
        protected = [v.index for v in obj.data.vertices if v.groups and all(
            obj.vertex_groups[g.group].name not in active for g in v.groups if g.weight > 1e-7)]
        topology[obj.name] = (triangles, arm, garment, protected)
    baseline_pose, baseline_vertices, baseline_pairs = None, {}, {}
    previous = None
    foot_motion = protected_skin_motion = peak_step = endpoint_position = 0.0
    records = []
    for frame in range(first, last + 1):
        scene.frame_set(frame)
        pose = {b.name: rig.matrix_world @ b.matrix for b in rig.pose.bones}
        if baseline_pose is None:
            baseline_pose = pose
        foot_motion = max(foot_motion, *((
            pose[n].translation - baseline_pose[n].translation).length for n in feet))
        if previous:
            peak_step = max(peak_step, *(shortest_angle(previous[n], pose[n]) for n in active))
        previous = pose
        if frame == last:
            endpoint_position = max((pose[n].translation - baseline_pose[n].translation).length
                                    for n in pose)
        new_count = total_count = 0
        for obj in meshes:
            triangles, arm, garment, protected = topology[obj.name]
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            data = evaluated.to_mesh()
            try:
                if len(data.vertices) != len(obj.data.vertices):
                    raise ValueError("Topology-changing modifiers are unsupported")
                vertices = [evaluated.matrix_world @ v.co for v in data.vertices]
                array = np.asarray([tuple(v) for v in vertices])
                if not np.isfinite(array).all():
                    raise ValueError("Nonfinite evaluated mesh")
                if frame == first:
                    baseline_vertices[obj.name] = array
                if protected:
                    protected_skin_motion = max(protected_skin_motion, float(np.linalg.norm(
                        array[protected] - baseline_vertices[obj.name][protected], axis=1).max()))
                pairs = set()
                if arm and garment:
                    at = BVHTree.FromPolygons(vertices, [triangles[i] for i in arm], all_triangles=True)
                    gt = BVHTree.FromPolygons(vertices, [triangles[i] for i in garment], all_triangles=True)
                    pairs = {(arm[i], garment[j]) for i, j in at.overlap(gt)
                             if set(triangles[arm[i]]).isdisjoint(triangles[garment[j]])}
                if frame == first:
                    baseline_pairs[obj.name] = pairs
                new_count += len(pairs - baseline_pairs[obj.name])
                total_count += len(pairs)
            finally:
                evaluated.to_mesh_clear()
        records.append({"frame": frame, "arm_garment_crossings": total_count,
                        "new_crossings_vs_idle": new_count})
    reasons = []
    if not any(arm and garment for _, arm, garment, _ in topology.values()):
        reasons.append("garment_mapping_unavailable")
    maximum_new = max(r["new_crossings_vs_idle"] for r in records)
    if foot_motion > 0.0001:
        reasons.append("standing_feet_moved")
    if protected_skin_motion > 0.0001:
        reasons.append("non_arm_skin_moved")
    if peak_step > 20:
        reasons.append("abrupt_arm_rotation")
    if endpoint_position > 0.0001:
        reasons.append("endpoint_pose_changed")
    if maximum_new:
        reasons.append("new_arm_garment_triangle_crossings")
    report = {
        "status": "quality_gate_blocked" if reasons else "measured_checks_passed_visual_review_required",
        "production_approved": False, "ue_imported": False, "blocking_reasons": reasons,
        "frame_count": len(records), "foot_excursion_m": foot_motion,
        "protected_skin_excursion_m": protected_skin_motion,
        "peak_arm_step_degrees": peak_step, "endpoint_position_error_m": endpoint_position,
        "baseline_arm_garment_crossings": records[0]["arm_garment_crossings"],
        "maximum_new_arm_garment_crossings": maximum_new, "frames": records,
        "limits": ["N113 naming and same-mesh dominant-weight regions only",
                   "triangle crossings are not penetration depth or swept-volume tests",
                   "does not assess within-region or separate-mesh intersections",
                   "baseline may already contain authored intersections; visual review required"],
    }
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", type=Path, required=True)
    parser.add_argument("--rig", default="Armature")
    parser.add_argument("--side", choices=("left", "right"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    report = validate_preview(args.blend, args.side, args.output, args.rig)
    if report["blocking_reasons"]:
        raise RuntimeError("Motion quality gate blocked: " + ", ".join(report["blocking_reasons"]))


if __name__ == "__main__":
    main()
