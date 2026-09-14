"""Executed in UE with REQUEST. Exports copies only; never imports/saves assets."""
import hashlib
import json
import os
from pathlib import Path


def transform_data(value):
    t, q, s = value.translation, value.rotation, value.scale3d
    return {"translation": [t.x, t.y, t.z], "rotation_xyzw": [q.x, q.y, q.z, q.w],
            "scale": [s.x, s.y, s.z]}


def export_target(request):
    actual = os.path.normcase(os.path.abspath(unreal.Paths.get_project_file_path()))
    if actual != os.path.normcase(os.path.abspath(request["project"])):
        raise RuntimeError("Connected project differs from requested project")
    output = Path(request["output"]).resolve()
    if output.exists():
        raise FileExistsError(output)
    content = Path(unreal.Paths.project_content_dir()).resolve()
    if content == output or content in output.parents:
        raise ValueError("Output must be outside project Content")
    dirty_before = sorted(p.get_path_name() for p in
                          unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())
    if dirty_before:
        raise RuntimeError("Save/review existing dirty assets before target capture")
    cls = unreal.EditorAssetLibrary.load_blueprint_class(request["blueprint"])
    if not cls:
        raise ValueError("Blueprint not found")
    cdo = unreal.get_default_object(cls)
    body = next((c for c in cdo.get_components_by_class(unreal.SkeletalMeshComponent)
                 if c.get_name() == request["body_component"]), None)
    if not body:
        raise ValueError("Body component not found")
    mesh = body.get_editor_property("skeletal_mesh")
    skeleton = mesh.get_editor_property("skeleton")
    face = None
    if request.get("face"):
        face = unreal.find_object(None, request["face"]["template"])
        if not face or not isinstance(face, unreal.SkeletalMeshComponent):
            raise ValueError("Face component template not found")
    bones = []
    for i in range(body.get_num_bones()):
        name = body.get_bone_name(i)
        parent = str(body.get_parent_bone(name))
        bones.append({
            "name": str(name), "parent": None if parent == "None" else parent,
            "component_transform": transform_data(body.get_socket_transform(
                name, unreal.RelativeTransformSpace.RTS_COMPONENT)),
        })
    output.mkdir(parents=True)
    options = unreal.FbxExportOption()
    options.set_editor_property("ascii", False)
    options.set_editor_property("level_of_detail", False)
    options.set_editor_property("collision", False)
    options.set_editor_property("export_morph_targets", True)
    def export_copy(asset, filename):
        task = unreal.AssetExportTask()
        task.object = asset
        task.filename = str(output / filename)
        task.automated = True
        task.prompt = False
        task.replace_identical = False
        task.options = options
        if not unreal.Exporter.run_asset_export_task(task):
            raise RuntimeError("FBX export failed: " + str(task.errors))
        data = (output / filename).read_bytes()
        return {"file": filename, "sha256": hashlib.sha256(data).hexdigest(),
                "asset": asset.get_path_name()}
    snapshot = {
        "schema_version": 1, "project": actual, "blueprint": request["blueprint"],
        "body_component": body.get_name(), "skeleton": skeleton.get_path_name(),
        "bones": bones, "body": export_copy(mesh, "target_body.fbx"), "face": None,
        "ue_assets_written": False,
    }
    if face:
        bone = request["face"]["attach_bone"]
        if bone not in {b["name"] for b in bones}:
            raise ValueError("Face attachment bone is absent")
        loc = face.get_editor_property("relative_location")
        rot = face.get_editor_property("relative_rotation")
        scale = face.get_editor_property("relative_scale3d")
        snapshot["face"] = {
            **export_copy(face.get_editor_property("skeletal_mesh"), "target_face.fbx"),
            "attach_bone": bone,
            "relative_transform": transform_data(unreal.Transform(loc, rot, scale)),
            "scs_evidence": request["face"],
        }
    dirty_after = sorted(p.get_path_name() for p in
                         unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())
    snapshot["dirty_unchanged"] = dirty_before == dirty_after
    if not snapshot["dirty_unchanged"]:
        raise RuntimeError("Dirty packages changed during export; inspect editor")
    (output / "target.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    return {"snapshot": str(output / "target.json"), "bone_count": len(bones),
            "face_exported": bool(face), "dirty_unchanged": True}


_result = export_target(REQUEST)
