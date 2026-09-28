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


def _try_get_montage_tracks(montage):
    try:
        return list(montage.get_editor_property("slot_anim_tracks"))
    except Exception as error:
        if "failed to find property 'slot_anim_tracks'" not in str(error).lower():
            raise
        return None


def _capture_reviewed_montage_slots(items, asset_library):
    snapshots = {}
    for item in items:
        if not item.get("make_montage"):
            continue
        montage_path = _package_path(item.get("montage_asset_path", ""))
        if not montage_path or not asset_library.does_asset_exist(montage_path):
            continue
        montage = _require_asset(
            montage_path, "AnimMontage", "Existing Montage"
        )
        tracks = _try_get_montage_tracks(montage)
        if tracks is None:
            continue
        snapshots[montage_path] = [
            str(track.get_editor_property("slot_name")) for track in tracks
        ]
    return snapshots


def _restore_reviewed_montage_slots(snapshots):
    restored_paths = []
    for montage_path, expected_names in snapshots.items():
        montage = _require_asset(
            montage_path, "AnimMontage", "Existing Montage"
        )
        tracks = _try_get_montage_tracks(montage)
        if tracks is None:
            raise RuntimeError(
                "Existing Montage slots are no longer readable: " + montage_path
            )
        if len(tracks) != len(expected_names):
            raise RuntimeError(
                "Existing Montage slot track count changed: " + montage_path
            )
        actual_names = [
            str(track.get_editor_property("slot_name")) for track in tracks
        ]
        if actual_names == expected_names:
            continue
        for track, slot_name in zip(tracks, expected_names):
            track.set_editor_property("slot_name", unreal.Name(slot_name))
        montage.set_editor_property("slot_anim_tracks", tracks)
        _save_asset(montage, "Existing Montage")
        verified_names = [
            str(track.get_editor_property("slot_name"))
            for track in montage.get_editor_property("slot_anim_tracks")
        ]
        if verified_names != expected_names:
            raise RuntimeError(
                "Failed to restore Existing Montage slots: " + montage_path
            )
        restored_paths.append(montage.get_path_name())
    return restored_paths


def _set_new_montage_slot(montage, slot_name):
    tracks = _try_get_montage_tracks(montage)
    if tracks is None:
        _save_asset(montage, "Generated Montage")
        return False
    if not tracks:
        raise RuntimeError(
            "Generated Montage has no animation track: "
            + montage.get_path_name()
        )
    tracks[0].set_editor_property("slot_name", unreal.Name(slot_name))
    montage.set_editor_property("slot_anim_tracks", tracks)
    _save_asset(montage, "Generated Montage")
    actual_tracks = list(montage.get_editor_property("slot_anim_tracks"))
    if (
        not actual_tracks
        or str(actual_tracks[0].get_editor_property("slot_name")) != slot_name
    ):
        raise RuntimeError(
            "Generated Montage slot readback mismatch: "
            + montage.get_path_name()
        )
    return True


def _blueprint_generated_class(blueprint):
    asset_path = blueprint.get_outermost().get_path_name()
    try:
        return unreal.EditorAssetLibrary.load_blueprint_class(asset_path)
    except Exception:
        return None


def _face_component_templates(blueprint, face_mesh):
    generated_class = _blueprint_generated_class(blueprint)
    if not generated_class:
        raise RuntimeError(
            "Cannot load Blueprint GeneratedClass: "
            + blueprint.get_path_name()
        )
    prefix = generated_class.get_path_name() + ":"
    components = []
    for component in unreal.ObjectIterator(unreal.SkeletalMeshComponent):
        if not component.get_path_name().startswith(prefix):
            continue
        try:
            component_mesh = component.get_editor_property("skeletal_mesh")
        except Exception:
            component_mesh = None
        if _object_path(component_mesh) == _object_path(face_mesh):
            components.append(component)
    return components


def _prepare_face_runtime(request, face_mesh, face_skeleton, dirty_packages):
    runtime = request["face_runtime"]
    face_abp_path = _package_path(runtime["animation_blueprint_asset_path"])
    face_abp_name = face_abp_path.rsplit("/", 1)[-1]
    expected_class_path = face_abp_path + "." + face_abp_name + "_C"
    state = runtime["animation_blueprint_state"]
    face_abp_exists = unreal.EditorAssetLibrary.does_asset_exist(face_abp_path)
    if state == "create" and face_abp_exists:
        raise RuntimeError(
            "Face Anim Blueprint appeared after review: " + face_abp_path
        )
    if state == "ready" and not face_abp_exists:
        raise RuntimeError(
            "Face Anim Blueprint disappeared after review: " + face_abp_path
        )
    if state not in ["create", "ready"]:
        raise RuntimeError("Face runtime configuration is blocked")
    if face_abp_path.lower() in dirty_packages:
        raise RuntimeError(
            "Face Anim Blueprint has unsaved changes: " + face_abp_path
        )
    existing_face_abp = unreal.load_asset(face_abp_path) if face_abp_exists else None
    if existing_face_abp:
        if existing_face_abp.get_class().get_name() != "AnimBlueprint":
            raise RuntimeError(
                "Face Anim Blueprint has unexpected class: " + face_abp_path
            )
        actual_skeleton = existing_face_abp.get_editor_property("target_skeleton")
        if _object_path(actual_skeleton) != _object_path(face_skeleton):
            raise RuntimeError(
                "Face Anim Blueprint Skeleton changed after review: "
                + face_abp_path
            )

    prepared_bindings = []
    for binding in runtime["bindings"]:
        blueprint_path = _package_path(binding["blueprint_asset_path"])
        if blueprint_path.lower() in dirty_packages:
            raise RuntimeError(
                "NPC Blueprint has unsaved changes: " + blueprint_path
            )
        blueprint = _require_asset(blueprint_path, "Blueprint", "NPC Blueprint")
        components = _face_component_templates(blueprint, face_mesh)
        named_components = [
            component
            for component in components
            if component.get_name().replace("_GEN_VARIABLE", "")
            == binding["component_name"]
        ]
        if len(named_components) != 1:
            raise RuntimeError(
                "Reviewed Face component cannot be resolved: " + blueprint_path
            )
        component = named_components[0]
        current_class = component.get_editor_property("anim_class")
        current_class_path = _object_path(current_class)
        if current_class_path != binding["current_anim_class_path"]:
            raise RuntimeError(
                "Face AnimClass changed after review: " + blueprint_path
            )
        if binding["state"] == "ready":
            if current_class_path != expected_class_path:
                raise RuntimeError(
                    "Reviewed Face AnimClass mismatch: " + blueprint_path
                )
        elif binding["state"] == "configure":
            if current_class:
                raise RuntimeError(
                    "Face AnimClass is no longer empty: " + blueprint_path
                )
        else:
            raise RuntimeError(
                "Face component binding is blocked: " + blueprint_path
            )
        prepared_bindings.append(
            {
                "blueprint": blueprint,
                "blueprint_path": blueprint_path,
                "component_name": binding["component_name"],
                "old_anim_class": current_class,
                "old_animation_mode": component.get_editor_property(
                    "animation_mode"
                ),
                "state": binding["state"],
            }
        )
    if not prepared_bindings:
        raise RuntimeError("No reviewed NPC Blueprint Face bindings")
    return {
        "animation_blueprint_path": face_abp_path,
        "animation_blueprint_name": face_abp_name,
        "animation_blueprint_state": state,
        "expected_class_path": expected_class_path,
        "existing_face_abp": existing_face_abp,
        "bindings": prepared_bindings,
    }


def _configure_face_runtime(prepared, face_mesh, face_skeleton):
    asset_library = unreal.EditorAssetLibrary
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    created_face_abp = False
    changed_bindings = []
    face_abp = prepared["existing_face_abp"]
    try:
        if prepared["animation_blueprint_state"] == "create":
            parent_class = getattr(unreal, "SeriaFaceAnimInstance", None)
            if not parent_class:
                raise RuntimeError("SeriaFaceAnimInstance is unavailable")
            factory = unreal.AnimBlueprintFactory()
            factory.set_editor_property("target_skeleton", face_skeleton)
            factory.set_editor_property("parent_class", parent_class)
            face_abp = asset_tools.create_asset(
                prepared["animation_blueprint_name"],
                prepared["animation_blueprint_path"].rsplit("/", 1)[0],
                unreal.AnimBlueprint,
                factory,
            )
            if not face_abp:
                raise RuntimeError("Failed to create Face Anim Blueprint")
            created_face_abp = True
        face_abp.set_editor_property("target_skeleton", face_skeleton)
        face_abp_class = _blueprint_generated_class(face_abp)
        if (
            not face_abp_class
            or face_abp_class.get_path_name()
            != prepared["expected_class_path"]
        ):
            raise RuntimeError("Face Anim Blueprint GeneratedClass mismatch")

        for binding in prepared["bindings"]:
            if binding["state"] == "ready":
                continue
            components = _face_component_templates(binding["blueprint"], face_mesh)
            matches = [
                component
                for component in components
                if component.get_name().replace("_GEN_VARIABLE", "")
                == binding["component_name"]
            ]
            if len(matches) != 1:
                raise RuntimeError(
                    "Face component changed before configuration: "
                    + binding["blueprint_path"]
                )
            component = matches[0]
            component.set_editor_property(
                "animation_mode", unreal.AnimationMode.ANIMATION_BLUEPRINT
            )
            component.set_editor_property("anim_class", face_abp_class)
            changed_bindings.append(binding)

        _save_asset(face_abp, "Face Anim Blueprint")
        for binding in changed_bindings:
            _save_asset(binding["blueprint"], "NPC Blueprint")

        for binding in prepared["bindings"]:
            components = _face_component_templates(binding["blueprint"], face_mesh)
            matches = [
                component
                for component in components
                if component.get_name().replace("_GEN_VARIABLE", "")
                == binding["component_name"]
            ]
            if len(matches) != 1:
                raise RuntimeError(
                    "Face component readback failed: " + binding["blueprint_path"]
                )
            actual_class = matches[0].get_editor_property("anim_class")
            if _object_path(actual_class) != prepared["expected_class_path"]:
                raise RuntimeError(
                    "Face AnimClass readback mismatch: "
                    + binding["blueprint_path"]
                )
        return {
            "face_animation_blueprint_asset_path": face_abp.get_path_name(),
            "created_face_animation_blueprint": created_face_abp,
            "configured_face_blueprint_asset_paths": [
                binding["blueprint"].get_path_name()
                for binding in prepared["bindings"]
            ],
        }
    except Exception:
        for binding in changed_bindings:
            try:
                components = _face_component_templates(
                    binding["blueprint"], face_mesh
                )
                matches = [
                    component
                    for component in components
                    if component.get_name().replace("_GEN_VARIABLE", "")
                    == binding["component_name"]
                ]
                if len(matches) == 1:
                    matches[0].set_editor_property(
                        "animation_mode", binding["old_animation_mode"]
                    )
                    matches[0].set_editor_property(
                        "anim_class", binding["old_anim_class"]
                    )
                    asset_library.save_loaded_asset(binding["blueprint"])
            except Exception:
                pass
        if created_face_abp:
            try:
                asset_library.delete_asset(
                    prepared["animation_blueprint_path"]
                )
            except Exception:
                pass
        raise


def _validate_request(request):
    required = [
        "target_project_file",
        "animation_package_path",
        "face_skeletal_mesh_asset_path",
        "face_skeleton_asset_path",
        "face_runtime",
        "remove_prefix",
        "items",
    ]
    missing = [
        name
        for name in required
        if name not in request
        or request[name] is None
        or (name != "items" and not request[name])
    ]
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
    required_functions = []
    if request["items"]:
        required_functions.append("get_face_anim_sequence")
    if any(item.get("copy_face_curves") for item in request["items"]):
        required_functions.append("copy_face_anim_sequence_morph_targets_curve")
    if any(item.get("make_montage") for item in request["items"]):
        required_functions.append("make_npc_montage_by_anim_sequence")
    for function_name in required_functions:
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
    prepared_face_runtime = _prepare_face_runtime(
        request, face_mesh, face_skeleton, dirty_packages
    )

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
            "native_functions": required_functions,
            "face_animation_blueprint_asset_path":
                prepared_face_runtime["animation_blueprint_path"],
            "face_animation_blueprint_state":
                prepared_face_runtime["animation_blueprint_state"],
            "validated_face_blueprint_asset_paths": [
                binding["blueprint_path"]
                for binding in prepared_face_runtime["bindings"]
            ],
        }

    montage_slot_snapshots = _capture_reviewed_montage_slots(
        request["items"], asset_library
    )
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
    unverified_montage_slot_paths = []
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
                try:
                    helper.make_npc_montage_by_anim_sequence(
                        request["remove_prefix"], body_animation
                    )
                except Exception as error:
                    raise RuntimeError(
                        "Seria native Montage creation failed: " + str(error)
                    )
                montage = _require_asset(
                    montage_path, "AnimMontage", "Generated Montage"
                )
                slot_verified = _set_new_montage_slot(
                    montage, item.get("montage_slot_name") or "IdleSlot"
                )
                if not slot_verified:
                    unverified_montage_slot_paths.append(montage.get_path_name())
                created_montage_paths.append(montage.get_path_name())
            else:
                montage = _require_asset(
                    montage_path, "AnimMontage", "Existing Montage"
                )
                reused_montage_paths.append(montage.get_path_name())

        processed_body_paths.append(body_animation.get_path_name())

    restored_montage_slot_paths = _restore_reviewed_montage_slots(
        montage_slot_snapshots
    )
    face_runtime_result = _configure_face_runtime(
        prepared_face_runtime, face_mesh, face_skeleton
    )
    return {
        "imported_asset_paths": imported_paths,
        "locked_root_asset_paths": locked_paths,
        "curve_copied_body_asset_paths": copied_body_paths,
        "processed_body_asset_paths": processed_body_paths,
        "created_montage_asset_paths": created_montage_paths,
        "reused_montage_asset_paths": reused_montage_paths,
        "restored_montage_slot_paths": restored_montage_slot_paths,
        "unverified_montage_slot_paths": unverified_montage_slot_paths,
        "pair_readback": pair_readback,
        **face_runtime_result,
    }


_result = run_face_supplement(FACE_SUPPLEMENT_REQUEST)
