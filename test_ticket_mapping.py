import tempfile
import unittest
from pathlib import Path

from migration_guard.ticket_mapping import (
    LarkTicketSheetClient,
    TicketMapping,
    TicketRoute,
    TicketSheetSnapshot,
    as_overseas_to_osob,
    parse_ticket_rows,
    resolve_ticket_text,
    workbook_url,
)


class TicketRowParsingTests(unittest.TestCase):
    def test_rows_are_classified_by_mapping_protocol_and_sections(self) -> None:
        values = [
            "",
            "【OSCOA-20】海外标题&&&&【SERIA-10】国内标题",
            "纯海外单子，海外主干合海外（OStrunk→OSOB2.0）",
            "【OSCOA-21】纯海外",
            "单提OSOB",
            "【OSCOA-22】直接提交",
            "不合并",
            "【OSCOA-23】不处理",
            "【SERIA-11】缺少海外映射",
        ]

        mappings = parse_ticket_rows(
            values,
            row_indices=list(range(1, len(values) + 1)),
        )

        self.assertEqual(len(mappings), 5)
        self.assertEqual(
            (
                mappings[0].source_issue,
                mappings[0].target_issue,
                mappings[0].route,
            ),
            (
                "SERIA-10",
                "OSCOA-20",
                TicketRoute.DOMESTIC_TO_OVERSEAS,
            ),
        )
        self.assertEqual(
            mappings[1].route,
            TicketRoute.OVERSEAS_TO_OSOB,
        )
        self.assertEqual(mappings[2].route, TicketRoute.OSOB_ONLY)
        self.assertEqual(mappings[3].route, TicketRoute.SKIP)
        self.assertEqual(mappings[4].route, TicketRoute.UNKNOWN)

    def test_one_overseas_ticket_can_map_multiple_domestic_tickets(self) -> None:
        mappings = parse_ticket_rows(
            [
                "【OSCOA-20】海外&&&&"
                "【SERIA-10】国内A【SERIA-11】国内B"
            ]
        )

        self.assertEqual(
            {
                (item.source_issue, item.target_issue)
                for item in mappings
            },
            {
                ("SERIA-10", "OSCOA-20"),
                ("SERIA-11", "OSCOA-20"),
            },
        )
        self.assertTrue(
            all(
                item.route == TicketRoute.DOMESTIC_TO_OVERSEAS
                for item in mappings
            )
        )
        by_source = {item.source_issue: item for item in mappings}
        self.assertEqual(
            by_source["SERIA-10"].source_text,
            "【SERIA-10】国内A",
        )
        self.assertEqual(
            by_source["SERIA-11"].source_text,
            "【SERIA-11】国内B",
        )
        self.assertEqual(
            by_source["SERIA-10"].target_text,
            "【OSCOA-20】海外",
        )

    def test_pasted_web_rows_resolve_multiple_tickets_and_deduplicate(
        self,
    ) -> None:
        mappings = parse_ticket_rows(
            [
                "【OSCOA-20】海外A&&&&【SERIA-10】国内A",
                "【OSCOA-21】海外B&&&&【SERIA-11】国内B",
            ]
        )
        snapshot = TicketSheetSnapshot(
            url="https://example.invalid/wiki/token",
            sheet_id="latest",
            sheet_name="latest",
            revision=1,
            fetched_at="2026-09-04T00:00:00+00:00",
            mappings=mappings,
        )

        result = resolve_ticket_text(
            "网页标题 SERIA-10 OSCOA-20\n另一个任务 SERIA-11",
            snapshot,
        )

        self.assertEqual(result.mappings, mappings)
        self.assertEqual(result.unresolved_keys, ())
        self.assertEqual(result.ambiguous_keys, ())

    def test_osob_stage_uses_each_overseas_ticket_once(self) -> None:
        mappings = (
            TicketMapping(
                "SERIA-10",
                "OSCOA-20",
                TicketRoute.DOMESTIC_TO_OVERSEAS,
                1,
                "source",
                "target",
                "raw",
            ),
            TicketMapping(
                "OSCOA-20",
                "OSCOA-20",
                TicketRoute.OVERSEAS_TO_OSOB,
                2,
                "target",
                "target",
                "raw",
            ),
        )

        result = as_overseas_to_osob(mappings)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].source_issue, "OSCOA-20")
        self.assertEqual(result[0].target_issue, "OSCOA-20")
        self.assertEqual(result[0].route, TicketRoute.OVERSEAS_TO_OSOB)

    def test_workbook_url_removes_sheet_and_preserves_other_query(self) -> None:
        self.assertEqual(
            workbook_url(
                "https://example.invalid/wiki/token?sheet=old&view=compact"
            ),
            "https://example.invalid/wiki/token?view=compact",
        )


class LarkTicketSheetClientTests(unittest.TestCase):
    def _responses(self):
        workbook = {
            "ok": True,
            "data": {
                "revision": 12,
                "sheets": [
                    {
                        "sheet_id": "sheet-1",
                        "sheet_name": "current",
                        "row_count": 4,
                        "is_hidden": False,
                    }
                ],
            },
        }
        csv_response = {
            "ok": True,
            "data": {
                "revision": 13,
                "annotated_csv": (
                    " \n"
                    '"【OSCOA-20】海外&&&&【SERIA-10】国内"\n'
                    "纯海外单子\n"
                    '"【OSCOA-21】海外"\n'
                ),
                "row_indices": [1, 2, 3, 4],
                "has_more": False,
            },
        }
        return workbook, csv_response

    def test_fetch_reads_requested_sheet_and_builds_bidirectional_lookup(
        self,
    ) -> None:
        workbook, csv_response = self._responses()
        calls: list[list[str]] = []

        def runner(command: list[str]):
            calls.append(command)
            return workbook if "+workbook-info" in command else csv_response

        with tempfile.TemporaryDirectory() as temp_dir:
            client = LarkTicketSheetClient(
                "https://example.invalid/wiki/token?sheet=sheet-1",
                runner=runner,
                cache_path=Path(temp_dir) / "cache.json",
            )
            snapshot = client.fetch(force_refresh=True)

        self.assertEqual(snapshot.sheet_id, "sheet-1")
        self.assertEqual(snapshot.revision, 13)
        self.assertEqual(
            snapshot.resolve("SERIA-10")[0].target_issue,
            "OSCOA-20",
        )
        self.assertEqual(
            snapshot.resolve("OSCOA-20")[0].source_issue,
            "SERIA-10",
        )
        self.assertIn("A1:A4", calls[1])

    def test_online_failure_uses_existing_cache(self) -> None:
        workbook, csv_response = self._responses()

        def online_runner(command: list[str]):
            return workbook if "+workbook-info" in command else csv_response

        with tempfile.TemporaryDirectory() as temp_dir:
            cache = Path(temp_dir) / "cache.json"
            online = LarkTicketSheetClient(
                "https://example.invalid/wiki/token?sheet=sheet-1",
                runner=online_runner,
                cache_path=cache,
            )
            online.fetch(force_refresh=True)

            def offline_runner(_command: list[str]):
                raise RuntimeError("offline")

            offline = LarkTicketSheetClient(
                "https://example.invalid/wiki/token?sheet=sheet-1",
                runner=offline_runner,
                cache_path=cache,
            )
            snapshot = offline.fetch(force_refresh=True)

        self.assertTrue(snapshot.from_cache)
        self.assertIn("offline", snapshot.warning)
        self.assertEqual(
            snapshot.resolve("OSCOA-21")[0].route,
            TicketRoute.OVERSEAS_TO_OSOB,
        )

    def test_workbook_url_selects_first_visible_sheet_by_index(self) -> None:
        workbook, csv_response = self._responses()
        workbook["data"]["sheets"] = [
            {
                "sheet_id": "older",
                "sheet_name": "older",
                "row_count": 4,
                "index": 2,
                "is_hidden": False,
            },
            {
                "sheet_id": "hidden",
                "sheet_name": "hidden",
                "row_count": 4,
                "index": 0,
                "is_hidden": True,
            },
            {
                "sheet_id": "latest",
                "sheet_name": "latest",
                "row_count": 4,
                "index": 1,
                "is_hidden": False,
            },
        ]

        def runner(command: list[str]):
            return workbook if "+workbook-info" in command else csv_response

        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot = LarkTicketSheetClient(
                "https://example.invalid/wiki/token",
                runner=runner,
                cache_path=Path(temp_dir) / "cache.json",
            ).fetch(force_refresh=True)

        self.assertEqual(snapshot.sheet_id, "latest")
        self.assertEqual(snapshot.sheet_name, "latest")


if __name__ == "__main__":
    unittest.main()
