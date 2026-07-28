import csv
import tempfile
import unittest
from pathlib import Path

from config_linker.repository import CsvDataError, CsvRepository, SchemaError
from tests.fixture_factory import (
    TARGET_LABEL_ROW,
    TARGET_MEMBER_ROW,
    write_fixture,
)


class RepositoryTests(unittest.TestCase):
    def test_loads_realistic_double_headers_and_builds_indexes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            write_fixture(Path(temp_dir))

            repository = CsvRepository.load(Path(temp_dir))

            self.assertEqual(repository.targets_by_id[1001][0].description, "目标A")
            self.assertEqual(
                repository.targets_by_id[1001][0].position,
                "(X=1,Y=2,Z=3)",
            )
            self.assertEqual(
                repository.targets_by_id[1001][0].rotation,
                "(Pitch=0,Yaw=90,Roll=0)",
            )
            self.assertEqual(len(repository.targets_by_npc_id[2001]), 2)
            self.assertEqual(repository.npcs_by_id[2001][0].name, "测试NPC甲")
            self.assertEqual(len(repository.npcs_by_resource_id[3001]), 2)
            resource = repository.resources_by_id[3001][0]
            self.assertIn(",", resource.configured_path)
            self.assertIn("\n", resource.configured_path)
            self.assertEqual(resource.generated_path, "/Game/Test/BP_Test.BP_Test_C")
            self.assertEqual(repository.report.target_count, 5)
            self.assertEqual(repository.report.npc_count, 3)
            self.assertEqual(repository.report.resource_count, 1)

    def test_duplicate_ids_are_preserved_with_source_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            write_fixture(
                Path(temp_dir),
                target_rows=[
                    [1001, "交互物", "目标A", 3, 2001, "", ""],
                    [1001, "区域", "目标A副本", 2, 2002, "", ""],
                ],
            )

            repository = CsvRepository.load(Path(temp_dir))

            records = repository.targets_by_id[1001]
            self.assertEqual(len(records), 2)
            self.assertEqual([record.row_number for record in records], [3, 4])

    def test_missing_file_reports_the_expected_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            write_fixture(directory)
            (directory / "NPC表.csv").unlink()

            with self.assertRaisesRegex(CsvDataError, "NPC表.csv"):
                CsvRepository.load(directory)

    def test_missing_required_member_reports_schema_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            write_fixture(directory)
            path = directory / "m目标物表.csv"
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.reader(handle))
            rows[0] = [
                value if value != "MissionPosition.NPCID" else "MissionPosition.Unknown"
                for value in TARGET_MEMBER_ROW
            ]
            with path.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(rows[0])
                writer.writerow(TARGET_LABEL_ROW)
                writer.writerows(rows[2:])

            with self.assertRaisesRegex(SchemaError, "MissionPosition.NPCID"):
                CsvRepository.load(directory)

    def test_non_integer_primary_key_reports_row_number(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            write_fixture(
                Path(temp_dir),
                target_rows=[["bad-id", "交互物", "错误目标", 3, 2001, "", ""]],
            )

            with self.assertRaisesRegex(CsvDataError, "m目标物表.csv.*第 3 行"):
                CsvRepository.load(Path(temp_dir))


if __name__ == "__main__":
    unittest.main()
