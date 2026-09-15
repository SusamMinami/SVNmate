"""Validate local PNGs and an optional Base export against the source catalog."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image

from reconcile_weapon_icon_catalog import reconcile


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_ndjson(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as stream:
        return [
            json.loads(line)
            for line in stream
            if line.strip()
        ]


def _select(value: Any) -> str:
    if isinstance(value, list) and value:
        return str(value[0]).strip()
    return str(value).strip() if value is not None else ""


def _validate_pngs(
    items: list[dict[str, Any]],
    png_directory: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    valid: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    expected_names: set[str] = set()
    for item in items:
        if not item.get("source_exists"):
            continue
        filename = str(item["filename"])
        expected_names.add(filename)
        path = png_directory / filename
        if not path.is_file():
            failures.append(
                {"key": item["key"], "reason": "png_missing"}
            )
            continue
        try:
            with Image.open(path) as image:
                image.verify()
            with Image.open(path) as image:
                width, height = image.size
                image_format = image.format
            if image_format != "PNG" or width <= 0 or height <= 0:
                raise ValueError(
                    f"invalid image properties: {image_format} {width}x{height}"
                )
        except Exception as exc:
            failures.append(
                {
                    "key": item["key"],
                    "reason": "png_invalid",
                    "error": str(exc),
                }
            )
            continue
        valid.append(
            {
                "key": item["key"],
                "filename": filename,
                "width": width,
                "height": height,
                "size": path.stat().st_size,
            }
        )

    extras = sorted(
        path.name
        for path in png_directory.glob("weapon_icon_*.png")
        if path.name not in expected_names
    )
    for filename in extras:
        failures.append(
            {"key": "", "reason": "unexpected_png", "filename": filename}
        )
    return valid, failures


def _validate_base_rows(
    source: dict[str, Any],
    rows: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    plan = reconcile(source, rows)
    failures = list(plan["conflicts"])
    for row in rows:
        if _select(row.get("导出状态")) != "已导出":
            continue
        attachments = row.get("预览图")
        if not isinstance(attachments, list) or len(attachments) != 1:
            failures.append(
                {
                    "key": row.get("图标键"),
                    "reason": "exported_record_attachment_count",
                    "count": (
                        len(attachments)
                        if isinstance(attachments, list)
                        else 0
                    ),
                }
            )
            continue
        attachment = attachments[0]
        if (
            not isinstance(attachment, dict)
            or not attachment.get("file_token")
            or not attachment.get("name")
            or int(attachment.get("size") or 0) <= 0
        ):
            failures.append(
                {
                    "key": row.get("图标键"),
                    "reason": "invalid_attachment_metadata",
                }
            )
    for category in (
        "create_records",
        "update_records",
        "export_records",
        "verify_existing_attachments",
    ):
        for item in plan[category]:
            failures.append(
                {
                    "key": item.get("key"),
                    "reason": f"pending_{category}",
                }
            )
    return plan["summary"], failures


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate a weapon-icon collection run."
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--png-dir", type=Path)
    parser.add_argument("--base-ndjson", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    source = _read_json(args.source)
    if not isinstance(source, dict) or not isinstance(
        source.get("items"), list
    ):
        parser.error("源清单格式无效")

    report: dict[str, Any] = {
        "source_counts": source.get("counts", {}),
        "png": None,
        "base": None,
        "failures": [],
    }
    if args.png_dir is not None:
        valid, failures = _validate_pngs(
            source["items"],
            args.png_dir,
        )
        report["png"] = {
            "valid": len(valid),
            "expected": sum(
                1
                for item in source["items"]
                if item.get("source_exists")
            ),
        }
        report["failures"].extend(failures)

    if args.base_ndjson is not None:
        summary, failures = _validate_base_rows(
            source,
            _read_ndjson(args.base_ndjson),
        )
        report["base"] = summary
        report["failures"].extend(failures)

    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
