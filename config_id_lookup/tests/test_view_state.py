import unittest

from config_linker.models import QueryKey, QueryKind
from config_linker.view_state import QueryHistory, ResultPager


class ViewStateTests(unittest.TestCase):
    def test_history_returns_through_every_previous_query(self) -> None:
        history = QueryHistory()
        history.visit(QueryKey(QueryKind.TARGET, 1001))
        history.visit(QueryKey(QueryKind.NPC, 2001))
        history.visit(QueryKey(QueryKind.RESOURCE, 3001))

        self.assertEqual(history.back(), QueryKey(QueryKind.NPC, 2001))
        self.assertEqual(history.back(), QueryKey(QueryKind.TARGET, 1001))
        self.assertFalse(history.can_go_back)

    def test_visiting_same_query_does_not_add_history(self) -> None:
        history = QueryHistory()
        key = QueryKey(QueryKind.TARGET, 1001)

        history.visit(key)
        history.visit(key)

        self.assertEqual(history.current, key)
        self.assertFalse(history.can_go_back)

    def test_back_without_history_returns_none(self) -> None:
        history = QueryHistory()
        history.visit(QueryKey(QueryKind.TARGET, 1001))

        self.assertIsNone(history.back())

    def test_pagination_starts_at_200_and_loads_more(self) -> None:
        pager = ResultPager(total=450, page_size=200)

        self.assertEqual(pager.visible_count, 200)
        self.assertTrue(pager.has_more)
        pager.load_more()
        self.assertEqual(pager.visible_count, 400)
        pager.load_more()
        self.assertEqual(pager.visible_count, 450)
        self.assertFalse(pager.has_more)

    def test_pagination_handles_small_and_empty_results(self) -> None:
        self.assertEqual(ResultPager(total=12).visible_count, 12)
        self.assertEqual(ResultPager(total=0).visible_count, 0)


if __name__ == "__main__":
    unittest.main()
