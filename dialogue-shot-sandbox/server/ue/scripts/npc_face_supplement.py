"""Run reviewed NPC face-animation supplementation inside Unreal Editor.

The caller must provide FACE_SUPPLEMENT_REQUEST and read _result after
execution. This script intentionally bypasses BP_FaceConfigHelper and invokes
the native SeriaAssetHelperBlueprintFunctionLibrary functions per reviewed
animation.
"""

import os


def _package_path(value):
    return str(value or "").split(".", 1)[0]


def _object_path(value):
    return value.get_path_name() if value else ""


def _require_asset(asset_path, class_name, label):
    asset = unreal.load_asset(asset_path)
    if not asset:
        raise RuntimeError(label + " does not exist: " + asset_path)
    if class_name and asset.get_class().get_name() != class_name:
        raise RuntimeError(
            label
            + " has unexpected class "
            + asset.get_class().get_name()
            + ": "
            + asset_path
        )
    return asset


def _save_asset(asset, label):
    if not unreal.EditorAssetLibrary.save_loaded_asset(asset):
        raise RuntimeError("Failed to save " + label + ": " + asset.get_path_name())


def _validate_request(request):
    required = [
        "target_project_file",
        "animation_package_path",
        "face_skeletal_mesh_asset_path",
        "face_skeleton_asset_path",
        "remove_prefix",
        "items",
    ]
    missing = [name for name in required if not request.get(name)]
    if missing:
        raise RuntimeError(
            "Face supplement request is missing: " + ", ".join(missing)
        )
    if not isinstance(request["items"], list):
        raise RuntimeError("Face supplement items must be a list")


def run_face_supplement(request):
    _validate_request(request)
    expected_project = os.path.normcase(
        os.path.abspath(request["target_project_file"])
    )
    current_project = os.path.normcase(
        os.path.abspath(unreal.Paths.get_project_file_path())
    )
    if current_project != expected_project:
        raise RuntimeError(
            "The connected Unreal Editor is not the reviewed target project"
        )

    asset_library = unreal.EditorAssetLibrary
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    helper = getattr(
        unreal, "SeriaAssetHelperBlueprintFunctionLibrary", None
    )
    if not helper:
        raise RuntimeError(
            "SeriaAssetHelperBlueprintFunctionLibrary is not exposed to Python"
        )
    for function_name in [
        "get_face_anim_sequence",
        "copy_face_anim_sequence_morph_targets_curve",
        "make_npc_montage_by_anim_sequence",
    ]:
        if not callable(getattr(helper, function_name, None)):
            raise RuntimeError(
                "Required Seria Python function is unavailable: " + function_name
            )

    face_mesh = _require_asset(
        request["face_skeletal_mesh_asset_path"],
        "SkeletalMesh",
        "Face Skeletal Mesh",
    )
    face_skeleton = _require_asset(
        request["face_skeleton_asset_path"],
        "Skeleton",
        "Face Skeleton",
    )
    mesh_skeleton = face_mesh.get_editor_property("skeleton")
    if _object_path(mesh_skeleton) != _object_path(face_skeleton):
        raise RuntimeError(
            "Face Skeletal Mesh does not use the reviewed Face Skeleton"
        )
    dirty_packages = {
        _package_path(package.get_path_name()).lower()
        for package in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()
    }

    for item in request["items"]:
        target_path = _package_path(item["target_asset_path"])
        body_path = _package_path(item["body_asset_path"])
        montage_path = _package_path(item.get("montage_asset_path", ""))
        target_exists = asset_library.does_asset_exist(target_path)
        if item["state"] == "new" and target_exists:
            raise RuntimeError(
                "Face animation appeared after review: " + target_path
            )
        if item["state"] == "update" and not target_exists:
            raise RuntimeError(
                "Face animation disappeared after review: " + target_path
            )
        if target_path.lower() in dirty_packages:
            raise RuntimeError("Face animation has unsaved changes: " + target_path)
        if not asset_library.does_asset_exist(body_path):
            raise RuntimeError(
                "Matching Body animation disappeared after review: " + body_path
            )
        if body_path.lower() in dirty_packages:
            raise RuntimeError("Body animation has unsaved changes: " + body_path)
        if item.get("make_montage"):
            montage_exists = asset_library.does_asset_exist(montage_path)
            if item["montage_state"] == "create" and montage_exists:
                raise RuntimeError(
                    "Montage appeared after review: " + montage_path
                )
            if item["montage_state"] == "reuse" and not montage_exists:
                raise RuntimeError(
                    "Montage disappeared after review: " + montage_path
                )
            if montage_path.lower() in dirty_packages:
                raise RuntimeError("Montage has unsaved changes: " + montage_path)

    if request.get("dry_run"):
        return {
            "dry_run": True,
            "validated_item_count": len(request["items"]),
            "face_skeletal_mesh_asset_path": face_mesh.get_path_name(),
            "face_skeleton_asset_path": face_skeleton.get_path_name(),
            "native_functions": [
                "get_face_anim_sequence",
                "copy_face_anim_sequence_morph_targets_curve",
                "make_npc_montage_by_anim_sequence",
            ],
        }

    destination = request["animation_package_path"] + "/Face"
    asset_library.make_directory(destination)
    imported_paths = []
    locked_paths = []
    for item in request["items"]:
        task = unreal.AssetImportTask()
        task.set_editor_property("filename", item["source_file"])
        task.set_editor_property("destination_path", destination)
        task.set_editor_property("destination_name", item["source_asset_name"])
        task.set_editor_property("automated", True)
        task.set_editor_property("replace_existing", item["state"] == "update")
        task.set_editor_property("save", False)

        options = unreal.FbxImportUI()
        options.set_editor_property("automated_import_should_detect_type", False)
        options.set_editor_property(
            "mesh_type_to_import", unreal.FBXImportType.FBXIT_ANIMATION
        )
        options.set_editor_property(
            "original_import_type", unreal.FBXImportType.FBXIT_ANIMATION
        )
        options.set_editor_property("import_mesh", False)
        options.set_editor_property("import_animations", True)
        options.set_editor_property("skeleton", face_skeleton)
        task.set_editor_property("options", options)
        asset_tools.import_asset_tasks([task])

        face_animation = _require_asset(
            item["target_asset_path"], "AnimSequence", "Face animation"
        )
        actual_skeleton = face_animation.get_editor_property("skeleton")
        if _object_path(actual_skeleton) != _object_path(face_skeleton):
            raise RuntimeError(
                "Face animation Skeleton readback mismatch: "
                + item["source_asset_name"]
            )
        face_animation.set_editor_property("force_root_lock", True)
        if not bool(face_animation.get_editor_property("force_root_lock")):
            raise RuntimeError(
                "Failed to lock the Face animation root: "
                + item["source_asset_name"]
            )
        _save_asset(face_animation, "Face animation")
        imported_paths.append(face_animation.get_path_name())
        locked_paths.append(face_animation.get_path_name())

    copied_body_paths = []
    processed_body_paths = []
    created_montage_paths = []
    reused_montage_paths = []
    pair_readback = []
    for item in request["items"]:
        body_animation = _require_asset(
            item["body_asset_path"], "AnimSequence", "Body animation"
        )
        face_animation = _require_asset(
            item["target_asset_path"], "AnimSequence", "Face animation"
        )
        resolved_face = helper.get_face_anim_sequence(body_animation)
        if _package_path(_object_path(resolved_face)).lower() != _package_path(
            _object_path(face_animation)
        ).lower():
            raise RuntimeError(
                "Seria face-pair readback mismatch: " + item["source_asset_name"]
            )
        pair_readback.append(
            {
                "body": body_animation.get_path_name(),
                "face": resolved_face.get_path_name(),
            }
        )

        if item.get("copy_face_curves"):
            helper.copy_face_anim_sequence_morph_targets_curve(
                face_mesh, face_animation, body_animation
            )
            _save_asset(body_animation, "Body animation")
            copied_body_paths.append(body_animation.get_path_name())

        if item.get("make_montage"):
            montage_path = item["montage_asset_path"]
            if item["montage_state"] == "create":
                helper.make_npc_montage_by_anim_sequence(
                    request["remove_prefix"], body_animation
                )
                montage = _require_asset(
                    montage_path, "AnimMontage", "Generated Montage"
                )
                _save_asset(montage, "Generated Montage")
                created_montage_paths.append(montage.get_path_name())
            else:
                montage = _require_asset(
                    montage_path, "AnimMontage", "Existing Montage"
                )
                reused_montage_paths.append(montage.get_path_name())

        processed_body_paths.append(body_animation.get_path_name())

    return {
        "imported_asset_paths": imported_paths,
        "locked_root_asset_paths": locked_paths,
        "curve_copied_body_asset_paths": copied_body_paths,
        "processed_body_asset_paths": processed_body_paths,
        "created_montage_asset_paths": created_montage_paths,
        "reused_montage_asset_paths": reused_montage_paths,
        "pair_readback": pair_readback,
    }


_result = run_face_supplement(FACE_SUPPLEMENT_REQUEST)
