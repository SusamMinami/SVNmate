"""Convert Unreal texture exports into validated PNG weapon icons."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert Unreal weapon-icon exports into PNG files."
    )
    parser.add_argument("results_json", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--max-size", type=int, default=512)
    args = parser.parse_args()
    if args.max_size <= 0:
        parser.error("--max-size 必须大于 0")

    results = json.loads(
        args.results_json.read_text(encoding="utf-8")
    )
    if not isinstance(results, list):
        parser.error("export-results.json 根节点必须是数组")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    converted: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    seen_filenames: set[str] = set()
    for result in results:
        key = str(result.get("key", ""))
        filename = str(result.get("filename", ""))
        if not key or not filename:
            failed.append(
                {"key": key or "<unknown>", "error": "missing key/filename"}
            )
            continue
        if filename in seen_filenames:
            failed.append(
                {"key": key, "error": f"duplicate filename: {filename}"}
            )
            continue
        seen_filenames.add(filename)
        if not result.get("success"):
            failed.append(
                {"key": key, "error": str(result.get("error", "export failed"))}
            )
            continue

        source = Path(str(result["exported_file"]))
        target = args.output_dir / filename
        try:
            with Image.open(source) as opened:
                image = opened.convert("RGBA")
                if result.get("class_name") == "PaperSprite":
                    x, y = result["source_uv"]
                    width, height = result["source_dimension"]
                    if width <= 0 or height <= 0:
                        raise ValueError("PaperSprite crop size must be positive")
                    image = image.crop((x, y, x + width, y + height))

                image.thumbnail(
                    (args.max_size, args.max_size),
                    Image.Resampling.LANCZOS,
                )
                image.save(target, "PNG", optimize=True)

            with Image.open(target) as verified:
                verified.verify()
            with Image.open(target) as measured:
                width, height = measured.size
                mode = measured.mode
            converted.append(
                {
                    "key": key,
                    "png": str(target),
                    "width": width,
                    "height": height,
                    "mode": mode,
                    "size": target.stat().st_size,
                    "sha256": _sha256(target),
                }
            )
        except Exception as exc:
            target.unlink(missing_ok=True)
            failed.append({"key": key, "error": str(exc)})

    summary = {
        "converted": converted,
        "failed": failed,
        "counts": {
            "input": len(results),
            "converted": len(converted),
            "failed": len(failed),
        },
    }
    _write_json(args.output_dir / "preview-results.json", summary)
    print(json.dumps(summary["counts"], ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
