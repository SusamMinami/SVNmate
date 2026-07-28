import tempfile
import unittest
from pathlib import Path

from config_linker.models import QueryKey, QueryKind
from config_linker.query_service import NotFoundError, QueryService
from config_linker.repository import CsvRepository
from tests.fixture_factory import write_fixture


class QueryServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp_dir.name)
        write_fixture(self.directory)
        self.repository = CsvRepository.load(self.directory)
        self.service = QueryService(self.repository)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_target_query_includes_same_npc_targets_and_resource(self) -> None:
        result = self.service.search(QueryKey(QueryKind.TARGET, 1001))

        self.assertEqual({row.id for row in result.targets}, {1001, 1002})
        self.assertEqual({row.id for row in result.npcs}, {2001})
        self.assertEqual({row.id for row in result.resources}, {3001})
        self.assertEqual(result.warnings, ())

    def test_npc_query_includes_focus_targets_and_same_resource_npcs(self) -> None:
        result = self.service.search(QueryKey(QueryKind.NPC, 2001))

        self.assertEqual({row.id for row in result.targets}, {1001, 1002})
        self.assertEqual({row.id for row in result.npcs}, {2001, 2002})
        self.assertEqual({row.id for row in result.resources}, {3001})

    def test_resource_query_includes_all_npcs_and_their_targets(self) -> None:
        result = self.service.search(QueryKey(QueryKind.RESOURCE, 3001))

        self.assertEqual({row.id for row in result.targets}, {1001, 1002, 1003})
        self.assertEqual({row.id for row in result.npcs}, {2001, 2002})
        self.assertEqual({row.id for row in result.resources}, {3001})

    def test_missing_focus_id_raises_not_found(self) -> None:
        with self.assertRaisesRegex(NotFoundError, "目标物 ID 999999"):
            self.service.search(QueryKey(QueryKind.TARGET, 999999))

    def test_zero_and_negative_one_have_distinct_warnings(self) -> None:
        zero_result = self.service.search(QueryKey(QueryKind.TARGET, 1004))
        special_result = self.service.search(QueryKey(QueryKind.TARGET, 1005))

        self.assertTrue(any("为 0" in warning for warning in zero_result.warnings))
        self.assertTrue(any("为 -1" in warning for warning in special_result.warnings))
        self.assertEqual(zero_result.npcs, ())
        self.assertEqual(special_result.npcs, ())

    def test_missing_positive_npc_keeps_target_and_warns(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            write_fixture(
                directory,
                target_rows=[[1010, "交互物", "断链目标", 3, 9999, "", ""]],
            )
            service = QueryService(CsvRepository.load(directory))

            result = service.search(QueryKey(QueryKind.TARGET, 1010))

            self.assertEqual({row.id for row in result.targets}, {1010})
            self.assertEqual(result.npcs, ())
            self.assertTrue(any("NPC ID 9999 未找到" in warning for warning in result.warnings))

    def test_missing_resource_keeps_npc_and_warns(self) -> None:
        result = self.service.search(QueryKey(QueryKind.NPC, 2003))

        self.assertEqual({row.id for row in result.npcs}, {2003})
        self.assertEqual(result.resources, ())
        self.assertTrue(any("资源 ID 3999 未找到" in warning for warning in result.warnings))


if __name__ == "__main__":
    unittest.main()
