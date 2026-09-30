import { UnrealMcpConnection } from "../server/ue/transport";

const PROFILES = {
  BP_Dialog_CameraShake: {
    duration: 0.45,
    blend_in: 0.05,
    blend_out: 0.18,
    loc: {
      x: [0.18, 4.2, "zero"],
      y: [0.25, 5, "zero"],
      z: [0.35, 5.8, "zero"],
    },
    rot: {
      pitch: [0, 0, "random"],
      yaw: [0, 0, "random"],
      roll: [0, 0, "random"],
    },
  },
  BP_Dialog_CameraShake_2: {
    duration: 0.9,
    blend_in: 0.04,
    blend_out: 0.28,
    loc: {
      x: [0.35, 4, "zero"],
      y: [1.8, 5.2, "zero"],
      z: [0.45, 4.6, "zero"],
    },
    rot: {
      pitch: [0, 0, "random"],
      yaw: [0, 0, "random"],
      roll: [0, 0, "random"],
    },
  },
  BP_Dialog_CameraShake_3: {
    duration: 0.65,
    blend_in: 0.04,
    blend_out: 0.22,
    loc: {
      x: [0.18, 3.5, "zero"],
      y: [0.18, 4, "zero"],
      z: [1.2, 6.2, "zero"],
    },
    rot: {
      pitch: [0, 0, "random"],
      yaw: [0, 0, "random"],
      roll: [0, 0, "random"],
    },
  },
  BP_Dialog_CameraShake_4: {
    duration: 2.5,
    blend_in: 0.25,
    blend_out: 0.65,
    loc: {
      x: [0.35, 2.2, "random"],
      y: [0.45, 2.7, "random"],
      z: [0.7, 3.2, "random"],
    },
    rot: {
      pitch: [0.05, 1.7, "random"],
      yaw: [0.05, 1.9, "random"],
      roll: [0.03, 1.3, "random"],
    },
  },
  BP_Dialog_CameraShake_5: {
    duration: 1.8,
    blend_in: 0.25,
    blend_out: 0.55,
    loc: {
      x: [0, 0, "random"],
      y: [0, 0, "random"],
      z: [0, 0, "random"],
    },
    rot: {
      pitch: [0.08, 1.7, "random"],
      yaw: [0.12, 2.1, "random"],
      roll: [0.06, 1.3, "random"],
    },
  },
  BP_Dialog_CameraShake_6: {
    duration: 0.55,
    blend_in: 0.03,
    blend_out: 0.2,
    loc: {
      x: [0.1, 3.5, "zero"],
      y: [0.15, 4.2, "zero"],
      z: [0.55, 6.5, "zero"],
    },
    rot: {
      pitch: [0.05, 4, "zero"],
      yaw: [0.08, 4.8, "zero"],
      roll: [0.12, 5.3, "zero"],
    },
  },
  "6015_CameraShake_Slow": {
    duration: 100,
    blend_in: 0.8,
    blend_out: 1.2,
    loc: {
      x: [0.12, 0.18, "random"],
      y: [0.16, 0.22, "random"],
      z: [0.22, 0.28, "random"],
    },
    rot: {
      pitch: [0.025, 0.24, "random"],
      yaw: [0.035, 0.18, "random"],
      roll: [0.015, 0.14, "random"],
    },
  },
  "6015_CameraShake_Fast": {
    duration: 100,
    blend_in: 0.25,
    blend_out: 0.65,
    loc: {
      x: [0.25, 0.9, "random"],
      y: [0.4, 1.2, "random"],
      z: [0.55, 1.5, "random"],
    },
    rot: {
      pitch: [0.08, 1.3, "random"],
      yaw: [0.1, 1.1, "random"],
      roll: [0.05, 0.9, "random"],
    },
  },
} as const;

function pythonJson(value: unknown): unknown {
  const result = value as { bSuccess?: boolean; Result?: unknown };
  if (result.bSuccess === false || typeof result.Result !== "string") {
    throw new Error("UE 没有返回有效的镜头抖动数据");
  }
  const raw = result.Result.trim();
  return JSON.parse(
    raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw,
  );
}

const apply = process.argv.includes("--apply");
const script = `
import json

specs = json.loads(${JSON.stringify(JSON.stringify(PROFILES))})
root = "/Game/Seria/Core/CameraShake/"
paths = [root + name for name in specs]
zero = unreal.InitialOscillatorOffset.EOO_OFFSET_ZERO
random = unreal.InitialOscillatorOffset.EOO_OFFSET_RANDOM

def offset_name(value):
    return "zero" if "ZERO" in str(value) else "random"

def read_axis(value):
    return [
        float(value.get_editor_property("amplitude")),
        float(value.get_editor_property("frequency")),
        offset_name(value.get_editor_property("initial_offset")),
    ]

def read_profile(cdo):
    loc = cdo.get_editor_property("loc_oscillation")
    rot = cdo.get_editor_property("rot_oscillation")
    return {
        "duration": float(cdo.get_editor_property("oscillation_duration")),
        "blend_in": float(cdo.get_editor_property("oscillation_blend_in_time")),
        "blend_out": float(cdo.get_editor_property("oscillation_blend_out_time")),
        "single_instance": bool(cdo.get_editor_property("single_instance")),
        "loc": {axis: read_axis(loc.get_editor_property(axis)) for axis in ["x", "y", "z"]},
        "rot": {axis: read_axis(rot.get_editor_property(axis)) for axis in ["pitch", "yaw", "roll"]},
    }

def set_group(cdo, property_name, axes):
    group = cdo.get_editor_property(property_name)
    for axis, values in axes.items():
        oscillator = group.get_editor_property(axis)
        oscillator.set_editor_property("amplitude", float(values[0]))
        oscillator.set_editor_property("frequency", float(values[1]))
        oscillator.set_editor_property(
            "initial_offset",
            zero if values[2] == "zero" else random,
        )
        group.set_editor_property(axis, oscillator)
    cdo.set_editor_property(property_name, group)

def apply_profile(cdo, profile):
    cdo.set_editor_property("oscillation_duration", float(profile["duration"]))
    cdo.set_editor_property("oscillation_blend_in_time", float(profile["blend_in"]))
    cdo.set_editor_property("oscillation_blend_out_time", float(profile["blend_out"]))
    cdo.set_editor_property("single_instance", bool(profile.get("single_instance", True)))
    set_group(cdo, "loc_oscillation", profile["loc"])
    set_group(cdo, "rot_oscillation", profile["rot"])

def profile_matches(actual, expected):
    if not actual["single_instance"]:
        return False
    for key in ["duration", "blend_in", "blend_out"]:
        if abs(actual[key] - float(expected[key])) > 0.00001:
            return False
    for group_name in ["loc", "rot"]:
        for axis, values in expected[group_name].items():
            actual_values = actual[group_name][axis]
            if abs(actual_values[0] - float(values[0])) > 0.00001:
                return False
            if abs(actual_values[1] - float(values[1])) > 0.00001:
                return False
            if actual_values[2] != values[2]:
                return False
    return True

entries = {}
for name in specs:
    path = root + name
    object_path = path + "." + name
    blueprint = unreal.load_asset(object_path)
    generated_class = unreal.EditorAssetLibrary.load_blueprint_class(object_path)
    if not blueprint or not generated_class:
        raise RuntimeError("Unable to load " + path)
    entries[path] = [
        blueprint,
        unreal.get_default_object(generated_class),
    ]

before = {path: read_profile(pair[1]) for path, pair in entries.items()}
if not ${apply ? "True" : "False"}:
    _result = {"status": "audit", "profiles": before}
else:
    dirty = set(
        str(package.get_path_name()).split(".")[0]
        for package in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()
    )
    blocked = [path for path in paths if path in dirty]
    if blocked:
        raise RuntimeError("CameraShake assets are dirty: " + ", ".join(blocked))
    saved = []
    try:
        for name, profile in specs.items():
            path = root + name
            blueprint, cdo = entries[path]
            if hasattr(blueprint, "modify"):
                blueprint.modify()
            if hasattr(cdo, "modify"):
                cdo.modify()
            apply_profile(cdo, profile)
            actual = read_profile(cdo)
            if not profile_matches(actual, profile):
                raise RuntimeError(
                    "Readback mismatch before save: " + path + " " + json.dumps(actual)
                )
        for path, pair in entries.items():
            if not unreal.EditorAssetLibrary.save_loaded_asset(pair[0], False):
                raise RuntimeError("Save failed: " + path)
            saved.append(path)
        verified = {path: read_profile(pair[1]) for path, pair in entries.items()}
        for name, profile in specs.items():
            path = root + name
            if not profile_matches(verified[path], profile):
                raise RuntimeError("Readback mismatch after save: " + path)
        _result = {"status": "updated", "profiles": verified}
    except Exception as error:
        rollback_failures = []
        for path, pair in entries.items():
            try:
                apply_profile(pair[1], before[path])
                if path in saved:
                    unreal.EditorAssetLibrary.save_loaded_asset(pair[0], False)
            except Exception as rollback_error:
                rollback_failures.append(path + ": " + str(rollback_error))
        suffix = (
            "; rollback failed: " + " | ".join(rollback_failures)
            if rollback_failures
            else "; restored"
        )
        raise RuntimeError(str(error) + suffix)
`;

const connection = new UnrealMcpConnection();
try {
  await connection.connect();
  const expression = `(lambda ns: (exec(${JSON.stringify(
    script,
  )}, ns), __import__("json").dumps(ns["_result"]))[1])({"unreal": unreal})`;
  const result = pythonJson(
    await connection.invoke(
      "script.eval_python_expression",
      { Expression: expression },
      { timeoutMs: 120_000 },
    ),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  connection.close();
}
