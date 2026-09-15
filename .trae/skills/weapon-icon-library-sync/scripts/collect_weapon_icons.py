"""Build a deterministic weapon-icon catalog from formal-server CSV files."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


EQUIPMENT_FILE = "z装备表.csv"
ICON_FILE = "t图标资源表.csv"


class CatalogError(RuntimeError):
    pass


def _normalize_member(value: str) -> str:
    return value.strip().removeprefix("##&")


def _read_rows(path: Path) -> tuple[list[str], list[str], list[list[str]]]:
    try:
        stream = path.open("r", encoding="utf-8-sig", newline="")
    except OSError as exc:
        raise CatalogError(f"无法读取 {path}: {exc}") from exc
    with stream:
        reader = csv.reader(stream)
        try:
            members = next(reader)
            labels = next(reader)
        except StopIteration as exc:
            raise CatalogError(f"{path.name} 缺少双表头") from exc
        rows = [
            row
            for row in reader
            if any(value.strip() for value in row)
        ]
    return members, labels, rows


def _column(path: Path, members: list[str], member: str) -> int:
    normalized = [_normalize_member(value) for value in members]
    try:
        return normalized.index(member)
    except ValueError as exc:
        raise CatalogError(f"{path.name} 缺少字段 {member}") from exc


def _cell(row: list[str], index: int) -> str:
    return row[index].strip() if index < len(row) else ""


def _positive_int(
    value: str,
    *,
    path: Path,
    row_number: int,
    field: str,
) -> int | None:
    if not value or value == "0":
        return None
    try:
        parsed = int(value)
    except ValueError as exc:
        raise CatalogError(
            f"{path.name} 第 {row_number} 行 {field} 不是整数: {value!r}"
        ) from exc
    return parsed if parsed > 0 else None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_write(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _is_weapon(part_id: int | None, part_name: str) -> bool:
    return part_name.startswith("武器-") or (
        part_id is not None and 100 <= part_id < 200
    )


def _normalize_config_path(value: str) -> str:
    normalized = value.strip().replace("\\", "/")
    if normalized.casefold().endswith(".uasset"):
        normalized = normalized[:-7]
    return normalized.strip("/")


def _resource_paths(
    config_path: str,
    res_directory: Path,
) -> tuple[str, str, Path]:
    if config_path.startswith("Game/"):
        content_path = config_path.removeprefix("Game/")
    else:
        content_path = f"Seria/UI/Texture/{config_path}"
    asset_path = f"/Game/{content_path}"
    relative_uasset = f"res/Content/{content_path}.uasset"
    absolute_uasset = (
        res_directory
        / "Content"
        / Path(*content_path.split("/"))
    ).with_suffix(".uasset")
    return asset_path, relative_uasset, absolute_uasset


def _ensure_external_output(
    output_directory: Path,
    protected_directories: tuple[Path, ...],
) -> None:
    resolved_output = output_directory.resolve()
    for directory in protected_directories:
        resolved = directory.resolve()
        if resolved_output == resolved or resolved_output.is_relative_to(
            resolved
        ):
            raise CatalogError(
                "输出目录必须位于配置仓和资源仓之外: "
                f"{resolved_output}"
            )


def build_catalog(
    doc_directory: Path,
    res_directory: Path,
    output_directory: Path,
) -> dict[str, Any]:
    doc_directory = doc_directory.resolve()
    res_directory = res_directory.resolve()
    output_directory = output_directory.resolve()
    _ensure_external_output(
        output_directory,
        (doc_directory, res_directory),
    )

    csv_directory = doc_directory / "csvdir"
    equipment_path = csv_directory / EQUIPMENT_FILE
    icon_path = csv_directory / ICON_FILE
    for path in (equipment_path, icon_path):
        if not path.is_file():
            raise CatalogError(f"缺少正式服输入文件: {path}")

    equipment_members, _equipment_labels, equipment_rows = _read_rows(
        equipment_path
    )
    equipment_columns = {
        member: _column(equipment_path, equipment_members, member)
        for member in (
            "ItemAttr.id",
            "ItemAttr.name",
            "ItemAttr.icon",
            "EquipAttr.part",
            "EquipAttr.partname",
        )
    }

    weapon_ids_seen: set[int] = set()
    references: dict[int, list[tuple[int, str]]] = defaultdict(list)
    weapon_count = 0
    for row_number, row in enumerate(equipment_rows, start=3):
        weapon_id = _positive_int(
            _cell(row, equipment_columns["ItemAttr.id"]),
            path=equipment_path,
            row_number=row_number,
            field="ItemAttr.id",
        )
        if weapon_id is None:
            continue
        part_id = _positive_int(
            _cell(row, equipment_columns["EquipAttr.part"]),
            path=equipment_path,
            row_number=row_number,
            field="EquipAttr.part",
        )
        part_name = _cell(row, equipment_columns["EquipAttr.partname"])
        if not _is_weapon(part_id, part_name):
            continue
        if weapon_id in weapon_ids_seen:
            raise CatalogError(
                f"{equipment_path.name} 存在重复武器 ID: {weapon_id}"
            )
        weapon_ids_seen.add(weapon_id)
        weapon_count += 1
        icon_id = _positive_int(
            _cell(row, equipment_columns["ItemAttr.icon"]),
            path=equipment_path,
            row_number=row_number,
            field="ItemAttr.icon",
        )
        if icon_id is not None:
            references[icon_id].append(
                (
                    weapon_id,
                    _cell(row, equipment_columns["ItemAttr.name"]),
                )
            )

    icon_members, _icon_labels, icon_rows = _read_rows(icon_path)
    icon_id_column = _column(icon_path, icon_members, "UIResource.id")
    icon_path_column = _column(icon_path, icon_members, "UIResource.path")
    resource_paths: dict[int, str] = {}
    duplicate_resource_rows = 0
    for row_number, row in enumerate(icon_rows, start=3):
        icon_id = _positive_int(
            _cell(row, icon_id_column),
            path=icon_path,
            row_number=row_number,
            field="UIResource.id",
        )
        if icon_id is None:
            continue
        config_path = _normalize_config_path(_cell(row, icon_path_column))
        current = resource_paths.get(icon_id)
        if current is not None:
            duplicate_resource_rows += 1
            if current != config_path:
                raise CatalogError(
                    f"{icon_path.name} 的图标 ID {icon_id} 对应多个路径: "
                    f"{current!r}, {config_path!r}"
                )
            continue
        resource_paths[icon_id] = config_path

    items: list[dict[str, Any]] = []
    unresolved_ids: list[int] = []
    missing_uasset_ids: list[int] = []
    for icon_id in sorted(references):
        weapon_refs = sorted(set(references[icon_id]))
        weapon_ids = [weapon_id for weapon_id, _name in weapon_refs]
        weapon_names = list(
            dict.fromkeys(
                name for _weapon_id, name in weapon_refs if name
            )
        )
        representative_weapon_name = (
            weapon_refs[0][1] if weapon_refs else ""
        )
        config_path = resource_paths.get(icon_id, "")
        if config_path:
            asset_path, relative_uasset, absolute_uasset = _resource_paths(
                config_path,
                res_directory,
            )
            source_exists = absolute_uasset.is_file()
            if not source_exists:
                missing_uasset_ids.append(icon_id)
        else:
            asset_path = ""
            relative_uasset = ""
            absolute_uasset = Path()
            source_exists = False
            unresolved_ids.append(icon_id)

        items.append(
            {
                "key": f"weapon-icon:{icon_id}",
                "icon_id": icon_id,
                "config_path": config_path,
                "asset_path": asset_path,
                "uasset_path": relative_uasset,
                "absolute_uasset_path": (
                    str(absolute_uasset) if config_path else ""
                ),
                "source_exists": source_exists,
                "filename": f"weapon_icon_{icon_id}.png",
                "weapon_ids": weapon_ids,
                "weapon_names": weapon_names,
                "representative_weapon_name": representative_weapon_name,
            }
        )

    generated_at = datetime.now(timezone.utc).isoformat()
    catalog = {
        "schema_version": 1,
        "generated_at": generated_at,
        "scope": "formal-server csvdir only",
        "doc_directory": str(doc_directory),
        "res_directory": str(res_directory),
        "source_files": {
            EQUIPMENT_FILE: _sha256(equipment_path),
            ICON_FILE: _sha256(icon_path),
        },
        "counts": {
            "weapons": weapon_count,
            "weapons_with_icon": sum(len(values) for values in references.values()),
            "unique_icon_ids": len(items),
            "resolved_icon_ids": len(items) - len(unresolved_ids),
            "existing_uassets": sum(
                1 for item in items if item["source_exists"]
            ),
            "duplicate_resource_rows": duplicate_resource_rows,
        },
        "unresolved_icon_ids": unresolved_ids,
        "missing_uasset_ids": missing_uasset_ids,
        "items": items,
    }

    output_directory.mkdir(parents=True, exist_ok=True)
    catalog_path = output_directory / "weapon-icon-source.json"
    unreal_manifest_path = (
        output_directory / "unreal-export-manifest.json"
    )
    base_records_path = output_directory / "base-record-fields.json"
    _json_write(catalog_path, catalog)
    _json_write(
        unreal_manifest_path,
        [
            {
                "key": item["key"],
                "asset_path": item["asset_path"],
                "filename": item["filename"],
            }
            for item in items
            if item["source_exists"]
        ],
    )
    _json_write(
        base_records_path,
        [
            {
                "图标键": item["key"],
                "图标ID": str(item["icon_id"]),
                "配置路径": item["config_path"],
                "UAsset路径": item["uasset_path"],
                "导出状态": [
                    "待导出"
                    if item["source_exists"]
                    else "源文件缺失"
                ],
                "源状态": ["有效"],
                "引用武器数量": len(item["weapon_ids"]),
                "引用武器ID": ",".join(
                    str(value) for value in item["weapon_ids"]
                ),
                "代表武器名": item["representative_weapon_name"],
            }
            for item in items
        ],
    )
    summary = {
        **catalog["counts"],
        "unresolved_icon_ids": unresolved_ids,
        "missing_uasset_ids": missing_uasset_ids,
        "catalog": str(catalog_path),
        "unreal_manifest": str(unreal_manifest_path),
        "base_record_fields": str(base_records_path),
    }
    _json_write(output_directory / "collection-summary.json", summary)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Collect formal-server weapon icon references without changing "
            "the source repositories."
        )
    )
    parser.add_argument("--doc-dir", required=True, type=Path)
    parser.add_argument("--res-dir", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    res_directory = args.res_dir or args.doc_dir.resolve().parent / "res"
    try:
        summary = build_catalog(
            args.doc_dir,
            res_directory,
            args.output_dir,
        )
    except CatalogError as exc:
        parser.exit(2, f"error: {exc}\n")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
