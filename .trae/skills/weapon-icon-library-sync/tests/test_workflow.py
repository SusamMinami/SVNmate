import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPT_DIRECTORY = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIRECTORY))

from collect_weapon_icons import build_catalog
from reconcile_weapon_icon_catalog import reconcile
from validate_weapon_icon_catalog import _validate_pngs


class WeaponIconWorkflowTests(unittest.TestCase):
    def _fixture(self, root: Path) -> tuple[Path, Path, Path]:
        doc = root / "doc"
        res = root / "res"
        output = root / "output"
        csv_directory = doc / "csvdir"
        csv_directory.mkdir(parents=True)
        texture_directory = (
            res
            / "Content"
            / "Seria"
            / "UI"
            / "Texture"
            / "Frames"
            / "Equipicon"
        )
        texture_directory.mkdir(parents=True)
        (texture_directory / "Equipicon_1.uasset").write_bytes(b"asset")

        with (csv_directory / "z装备表.csv").open(
            "w",
            encoding="utf-8-sig",
            newline="",
        ) as stream:
            writer = csv.writer(stream)
            writer.writerow(
                [
                    "ItemAttr.id",
                    "ItemAttr.name",
                    "ItemAttr.icon",
                    "EquipAttr.part",
                    "EquipAttr.partname",
                ]
            )
            writer.writerow(["id", "名字", "图标", "部位", "部位名称"])
            writer.writerow(["7001", "武器甲", "201001", "101", "武器-魔剑"])
            writer.writerow(["7002", "武器乙", "201001", "101", "武器-魔剑"])
            writer.writerow(["8001", "防具", "201002", "1", "防具"])

        with (csv_directory / "t图标资源表.csv").open(
            "w",
            encoding="utf-8-sig",
            newline="",
        ) as stream:
            writer = csv.writer(stream)
            writer.writerow(["##&UIResource.id", "UIResource.path"])
            writer.writerow(["##id", "图标路径"])
            writer.writerow(
                ["201001", "Frames/Equipicon/Equipicon_1"]
            )
        return doc, res, output

    def test_collects_and_aggregates_formal_weapon_icons(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            doc, res, output = self._fixture(Path(temp))

            summary = build_catalog(doc, res, output)
            source = json.loads(
                (output / "weapon-icon-source.json").read_text(
                    encoding="utf-8"
                )
            )

            self.assertEqual(summary["weapons"], 2)
            self.assertEqual(summary["unique_icon_ids"], 1)
            self.assertEqual(summary["existing_uassets"], 1)
            item = source["items"][0]
            self.assertEqual(item["key"], "weapon-icon:201001")
            self.assertEqual(item["weapon_ids"], [7001, 7002])
            self.assertEqual(item["weapon_names"], ["武器甲", "武器乙"])
            self.assertEqual(item["representative_weapon_name"], "武器甲")

    def test_matching_base_record_is_reused(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            doc, res, output = self._fixture(Path(temp))
            build_catalog(doc, res, output)
            source = json.loads(
                (output / "weapon-icon-source.json").read_text(
                    encoding="utf-8"
                )
            )
            row = json.loads(
                (output / "base-record-fields.json").read_text(
                    encoding="utf-8"
                )
            )[0]
            row.update(
                {
                    "record_id": "rec_icon",
                    "导出状态": ["已导出"],
                    "预览图": [
                        {
                            "file_token": "token",
                            "name": "weapon_icon_201001.png",
                            "size": 128,
                        }
                    ],
                }
            )

            plan = reconcile(source, [row])

            self.assertEqual(plan["summary"]["create_records"], 0)
            self.assertEqual(plan["summary"]["update_records"], 0)
            self.assertEqual(plan["summary"]["export_records"], 0)
            self.assertEqual(plan["summary"]["reusable_records"], 1)

    def test_png_validation_rejects_unexpected_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            expected = directory / "weapon_icon_201001.png"
            extra = directory / "weapon_icon_999999.png"
            Image.new("RGBA", (32, 32), "#D18B2D").save(expected)
            Image.new("RGBA", (16, 16), "#18283A").save(extra)
            items = [
                {
                    "key": "weapon-icon:201001",
                    "filename": expected.name,
                    "source_exists": True,
                }
            ]

            valid, failures = _validate_pngs(items, directory)

            self.assertEqual(len(valid), 1)
            self.assertEqual(
                [failure["reason"] for failure in failures],
                ["unexpected_png"],
            )


if __name__ == "__main__":
    unittest.main()
