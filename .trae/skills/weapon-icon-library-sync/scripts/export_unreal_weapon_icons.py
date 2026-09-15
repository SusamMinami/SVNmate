"""Export weapon icon Texture2D assets from an Unreal Editor commandlet."""

import json
import os
import traceback

import unreal


manifest_path = os.environ["WEAPON_ICON_ASSET_MANIFEST"]
output_dir = os.environ["WEAPON_ICON_ASSET_OUTPUT"]

with open(manifest_path, "r", encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)

os.makedirs(output_dir, exist_ok=True)
direct_assets = set()
source_assets = set()
results = []

for item in manifest:
    result = {
        "key": item["key"],
        "asset_path": item["asset_path"],
        "filename": item["filename"],
    }
    try:
        asset = unreal.EditorAssetLibrary.load_asset(item["asset_path"])
        if asset is None:
            raise RuntimeError("asset could not be loaded")

        class_name = asset.get_class().get_name()
        result["class_name"] = class_name
        if class_name == "PaperSprite":
            texture = asset.get_editor_property("source_texture")
            uv = asset.get_editor_property("source_uv")
            dimensions = asset.get_editor_property("source_dimension")
            source_path = texture.get_path_name().split(".", 1)[0]
            result["source_texture"] = source_path
            result["source_uv"] = [int(uv.x), int(uv.y)]
            result["source_dimension"] = [
                int(dimensions.x),
                int(dimensions.y),
            ]
            source_assets.add(source_path)
        elif class_name == "Texture2D":
            direct_assets.add(item["asset_path"])
        else:
            raise RuntimeError(
                "unsupported Unreal asset class: " + class_name
            )
    except Exception as exc:
        result["error"] = str(exc)
        result["traceback"] = traceback.format_exc()
    results.append(result)

assets_to_export = sorted(direct_assets | source_assets)
if assets_to_export:
    unreal.AssetToolsHelpers.get_asset_tools().export_assets(
        assets_to_export,
        output_dir,
    )

for result in results:
    exported_asset = result.get("source_texture", result["asset_path"])
    exported_file = os.path.join(
        output_dir,
        exported_asset.lstrip("/").replace("/", os.sep) + ".TGA",
    )
    result["exported_file"] = exported_file
    result["success"] = (
        os.path.isfile(exported_file) and "error" not in result
    )
    if result["success"]:
        result["file_size"] = os.path.getsize(exported_file)
    elif "error" not in result:
        result["error"] = "expected exported TGA was not created"

result_path = os.path.join(output_dir, "export-results.json")
with open(result_path, "w", encoding="utf-8") as result_file:
    json.dump(results, result_file, ensure_ascii=False, indent=2)

unreal.log(
    "WEAPON_ICON_EXPORT_RESULT="
    + json.dumps(results, ensure_ascii=False)
)
