import tempfile
import unittest
from pathlib import Path

from config_linker.weapon_query_service import (
    WeaponNotFoundError,
    WeaponQueryService,
)
from config_linker.weapon_repository import WeaponRepository
from tests.fixture_factory import write_weapon_fixture


class WeaponQueryServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.doc_directory = Path(self.temp_dir.name)
        write_weapon_fixture(self.doc_directory)
        self.repository = WeaponRepository.load(self.doc_directory)
        self.service = WeaponQueryService(self.repository)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_weapon_id_query_returns_complete_details(self) -> None:
        result = self.service.search("700501")
        details = self.service.details(result.weapons[0])

        self.assertEqual(result.match_kinds, ("装备 ID",))
        self.assertEqual(result.weapons[0].name, "真·黑光星陨剑")
        self.assertEqual([row.name for row in details.careers], ["魔剑士"])
        self.assertEqual([row.name for row in details.groups], ["极T6"])
        self.assertEqual(details.appearances[0].path, "/Game/Test/SK_Rapier")
        self.assertEqual(
            {row.id for row in details.same_group_weapons},
            {700502},
        )
        self.assertEqual(
            {row.id for row in details.same_career_weapons},
            {700401},
        )
        self.assertEqual(
            {row.id for row in details.same_model_weapons},
            {700401},
        )

    def test_name_query_supports_partial_matching(self) -> None:
        result = self.service.search("黑光星陨")

        self.assertEqual(result.match_kinds, ("武器名称",))
        self.assertEqual(
            [row.id for row in result.weapons],
            [700401, 700501],
        )

    def test_numeric_query_combines_group_and_model_matches(self) -> None:
        result = self.service.search("101102")

        self.assertEqual(
            result.match_kinds,
            ("转换组 ID", "模型 ID"),
        )
        self.assertEqual(
            {row.id for row in result.weapons},
            {700401, 700501, 700502},
        )

    def test_ungrouped_weapon_is_searchable_and_reports_warning(self) -> None:
        result = self.service.search("799999")
        details = self.service.details(result.weapons[0])

        self.assertEqual(result.weapons[0].name, "未分组测试剑")
        self.assertEqual(details.groups, ())
        self.assertTrue(any("不属于" in warning for warning in details.warnings))
        self.assertTrue(any("未配置武器模型" in warning for warning in details.warnings))

    def test_missing_query_raises_not_found(self) -> None:
        with self.assertRaisesRegex(WeaponNotFoundError, "不存在"):
            self.service.search("不存在")


if __name__ == "__main__":
    unittest.main()
