"""Compare a weapon-icon source catalog with a Feishu Base NDJSON export."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


SOURCE_FIELDS = (
    "图标键",
    "图标ID",
    "配置路径",
    "UAsset路径",
    "源状态",
    "引用武器数量",
    "引用武器ID",
    "代表武器名",
)


class ReconcileError(RuntimeError):
    pass


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReconcileError(f"无法读取 JSON {path}: {exc}") from exc


def _read_ndjson(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, start=1):
                if not line.strip():
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ReconcileError(
                        f"{path} 第 {line_number} 行不是对象"
                    )
                rows.append(value)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        if isinstance(exc, ReconcileError):
            raise
        raise ReconcileError(f"无法读取 NDJSON {path}: {exc}") from exc
    return rows


def _select(value: Any) -> str:
    if isinstance(value, list) and value:
        return str(value[0]).strip()
    return str(value).strip() if value is not None else ""


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _number(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _attachments(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _expected_fields(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "图标键": item["key"],
        "图标ID": str(item["icon_id"]),
        "配置路径": item.get("config_path", ""),
        "UAsset路径": item.get("uasset_path", ""),
        "源状态": ["有效"],
        "引用武器数量": len(item.get("weapon_ids", [])),
        "引用武器ID": ",".join(
            str(value) for value in item.get("weapon_ids", [])
        ),
        "代表武器名": item.get("representative_weapon_name", ""),
    }


def _field_equal(name: str, actual: Any, expected: Any) -> bool:
    if name == "源状态":
        return _select(actual) == _select(expected)
    if name == "引用武器数量":
        return _number(actual) == _number(expected)
    return _text(actual) == _text(expected)


def _unique_map(
    values: list[dict[str, Any]],
    key_getter,
    *,
    label: str,
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    duplicates: list[str] = []
    for value in values:
        key = _text(key_getter(value))
        if not key:
            raise ReconcileError(f"{label} 存在空业务键")
        if key in result:
            duplicates.append(key)
        else:
            result[key] = value
    if duplicates:
        raise ReconcileError(
            f"{label} 存在重复业务键: "
            + ", ".join(sorted(set(duplicates))[:20])
        )
    return result


def reconcile(
    source_catalog: dict[str, Any],
    base_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    source_items = source_catalog.get("items")
    if not isinstance(source_items, list):
        raise ReconcileError("源清单缺少 items 数组")
    source_by_key = _unique_map(
        source_items,
        lambda item: item.get("key"),
        label="源清单",
    )
    base_by_key = _unique_map(
        base_rows,
        lambda row: row.get("图标键"),
        label="Base",
    )

    creates: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    exports: list[dict[str, Any]] = []
    verify_attachments: list[dict[str, Any]] = []
    reusable: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    inactive: list[dict[str, Any]] = []

    for key in sorted(source_by_key):
        item = source_by_key[key]
        expected = _expected_fields(item)
        row = base_by_key.get(key)
        if row is None:
            fields = {
                **expected,
                "导出状态": [
                    "待导出"
                    if item.get("source_exists")
                    else "源文件缺失"
                ],
            }
            creates.append({"key": key, "fields": fields})
            if item.get("source_exists"):
                exports.append(
                    {
                        "key": key,
                        "record_id": None,
                        "filename": item["filename"],
                        "reason": "new_record",
                    }
                )
            continue

        record_id = _text(row.get("record_id"))
        if not record_id:
            conflicts.append({"key": key, "reason": "missing_record_id"})
            continue
        delta: dict[str, Any] = {}
        for field_name in SOURCE_FIELDS:
            if not _field_equal(
                field_name,
                row.get(field_name),
                expected[field_name],
            ):
                delta[field_name] = expected[field_name]

        path_changed = any(
            field_name in delta
            for field_name in ("配置路径", "UAsset路径")
        )
        source_exists = bool(item.get("source_exists"))
        attachments = _attachments(row.get("预览图"))
        export_status = _select(row.get("导出状态"))

        if not source_exists:
            if export_status != "源文件缺失":
                delta["导出状态"] = ["源文件缺失"]
        elif path_changed:
            delta["导出状态"] = ["待导出"]
            exports.append(
                {
                    "key": key,
                    "record_id": record_id,
                    "filename": item["filename"],
                    "reason": "source_path_changed",
                    "existing_file_tokens": [
                        _text(attachment.get("file_token"))
                        for attachment in attachments
                        if _text(attachment.get("file_token"))
                    ],
                }
            )
        elif len(attachments) > 1:
            conflicts.append(
                {
                    "key": key,
                    "record_id": record_id,
                    "reason": "multiple_attachments",
                    "file_tokens": [
                        _text(attachment.get("file_token"))
                        for attachment in attachments
                        if _text(attachment.get("file_token"))
                    ],
                }
            )
        elif not attachments:
            exports.append(
                {
                    "key": key,
                    "record_id": record_id,
                    "filename": item["filename"],
                    "reason": "attachment_missing",
                }
            )
        elif export_status != "已导出":
            verify_attachments.append(
                {
                    "key": key,
                    "record_id": record_id,
                    "file_token": _text(
                        attachments[0].get("file_token")
                    ),
                    "filename": _text(attachments[0].get("name")),
                    "reason": "attachment_exists_status_not_exported",
                }
            )
        else:
            reusable.append(
                {
                    "key": key,
                    "record_id": record_id,
                    "file_token": _text(
                        attachments[0].get("file_token")
                    ),
                }
            )

        if delta:
            updates.append(
                {
                    "key": key,
                    "record_id": record_id,
                    "fields": delta,
                }
            )

    for key in sorted(set(base_by_key) - set(source_by_key)):
        row = base_by_key[key]
        record_id = _text(row.get("record_id"))
        if not record_id:
            conflicts.append({"key": key, "reason": "missing_record_id"})
            continue
        inactive.append(
            {
                "key": key,
                "record_id": record_id,
                "fields": {"源状态": ["已失效"]},
                "already_inactive": _select(row.get("源状态"))
                == "已失效",
            }
        )
        if _select(row.get("源状态")) != "已失效":
            updates.append(
                {
                    "key": key,
                    "record_id": record_id,
                    "fields": {"源状态": ["已失效"]},
                }
            )

    plan = {
        "schema_version": 1,
        "source_generated_at": source_catalog.get("generated_at"),
        "summary": {
            "source_records": len(source_by_key),
            "base_records": len(base_by_key),
            "create_records": len(creates),
            "update_records": len(updates),
            "export_records": len(exports),
            "verify_existing_attachments": len(verify_attachments),
            "reusable_records": len(reusable),
            "inactive_records": len(inactive),
            "conflicts": len(conflicts),
        },
        "create_records": creates,
        "update_records": updates,
        "export_records": exports,
        "verify_existing_attachments": verify_attachments,
        "reusable_records": reusable,
        "inactive_records": inactive,
        "conflicts": conflicts,
    }
    return plan


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Create a read-only reconciliation plan for the weapon icon Base."
        )
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--base-ndjson", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        source_catalog = _read_json(args.source)
        if not isinstance(source_catalog, dict):
            raise ReconcileError("源清单根节点不是对象")
        plan = reconcile(
            source_catalog,
            _read_ndjson(args.base_ndjson),
        )
    except ReconcileError as exc:
        parser.exit(2, f"error: {exc}\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(plan["summary"], ensure_ascii=False, indent=2))
    return 3 if plan["conflicts"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
