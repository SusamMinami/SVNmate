import tempfile
import unittest
from pathlib import Path

from config_linker.weapon_repository import (
    WeaponDataError,
    WeaponRepository,
)
from tests.fixture_factory import write_weapon_fixture


class WeaponRepositoryTests(unittest.TestCase):
    def test_loads_formal_tables_and_builds_reverse_indexes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            doc_directory = Path(temp_dir)
            write_weapon_fixture(doc_directory)

            repository = WeaponRepository.load(doc_directory)

            self.assertEqual(repository.report.weapon_count, 4)
            self.assertEqual(repository.report.group_count, 3)
            self.assertNotIn(800001, repository.weapons_by_id)
            self.assertEqual(
                repository.weapons_by_id[700501][0].name,
                "真·黑光星陨剑",
            )
            self.assertEqual(
                repository.weapons_by_id[700501][0].description,
                "在星陨中淬炼而成的魔剑。",
            )
            self.assertEqual(repository.weapons_by_id[700501][0].icon_id, 201572)
            self.assertEqual(
                [row.id for row in repository.weapons_by_model_id[101102]],
                [700501, 700401],
            )
            self.assertEqual(
                [row.name for row in repository.groups_by_equipment_id[700501]],
                ["极T6"],
            )
            self.assertEqual(
                repository.careers_by_id[101][0].name,
                "魔剑士",
            )

    def test_name_search_prioritizes_exact_then_prefix_then_substring(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            doc_directory = Path(temp_dir)
            write_weapon_fixture(
                doc_directory,
                equipment_rows=[
                    [
                        1,
                        1,
                        "星陨",
                        "",
                        60,
                        60,
                        105,
                        "武器-魔剑",
                        "101",
                        "",
                        "101",
                        0,
                    ],
                    [
                        1,
                        2,
                        "星陨剑",
                        "",
                        60,
                        60,
                        105,
                        "武器-魔剑",
                        "101",
                        "",
                        "101",
                        0,
                    ],
                    [
                        1,
                        3,
                        "真·星陨",
                        "",
                        60,
                        60,
                        105,
                        "武器-魔剑",
                        "101",
                        "",
                        "101",
                        0,
                    ],
                ],
                group_rows=[],
            )
            repository = WeaponRepository.load(doc_directory)

            matches = repository.find_weapons_by_name("  星陨  ")

            self.assertEqual([row.id for row in matches], [1, 2, 3])

    def test_missing_formal_table_reports_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            doc_directory = Path(temp_dir)
            write_weapon_fixture(doc_directory)
            (doc_directory / "csvdir" / "z装备表.csv").unlink()

            with self.assertRaisesRegex(WeaponDataError, "z装备表.csv"):
                WeaponRepository.load(doc_directory)


if __name__ == "__main__":
    unittest.main()
