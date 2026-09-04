import json
import unittest

from migration_guard.jira_client import (
    JiraIssueClient,
    JiraIssueSnapshot,
    build_ticket_progress,
)
from migration_guard.ticket_mapping import TicketMapping, TicketRoute


class _Response:
    def __init__(self, payload: object) -> None:
        self.body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def read(self) -> bytes:
        return self.body


class JiraIssueClientTests(unittest.TestCase):
    def test_fetch_parses_status_and_versions(self) -> None:
        requests = []

        def opener(request, *, timeout):
            requests.append((request, timeout))
            return _Response(
                {
                    "error": 0,
                    "createDate": "2026-09-03T14:42:23+08:00",
                    "jiraVersions": ["trunk", "OSOB2.0", "trunk"],
                    "jiraStatus": "分支测试",
                }
            )

        client = JiraIssueClient(opener=opener)
        snapshot = client.fetch("seria-115551")

        self.assertEqual(snapshot.issue_key, "SERIA-115551")
        self.assertEqual(snapshot.status, "分支测试")
        self.assertEqual(snapshot.versions, ("trunk", "OSOB2.0"))
        self.assertTrue(snapshot.has_trunk)
        self.assertTrue(snapshot.has_osob)
        request_body = json.loads(requests[0][0].data)
        self.assertEqual(request_body, {"issueKey": "SERIA-115551"})

    def test_fetch_caches_issue(self) -> None:
        calls = 0

        def opener(_request, *, timeout):
            nonlocal calls
            calls += 1
            return _Response({"error": 0, "jiraStatus": "处理中"})

        client = JiraIssueClient(opener=opener)

        first = client.fetch("OSCOA-20")
        second = client.fetch("OSCOA-20")

        self.assertIs(first, second)
        self.assertEqual(calls, 1)

    def test_fetch_returns_error_snapshot_without_raising(self) -> None:
        def opener(_request, *, timeout):
            raise OSError("offline")

        snapshot = JiraIssueClient(opener=opener).fetch("SERIA-10")

        self.assertFalse(snapshot.available)
        self.assertIn("offline", snapshot.error)


class TicketJiraProgressTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mapping = TicketMapping(
            source_issue="SERIA-10",
            target_issue="OSCOA-20",
            route=TicketRoute.DOMESTIC_TO_OVERSEAS,
            row=3,
            source_text="国内任务",
            target_text="海外任务",
            raw_text="mapping",
        )

    def test_progress_reaches_osob_from_jira_versions(self) -> None:
        progress = build_ticket_progress(
            (self.mapping,),
            {
                "SERIA-10": JiraIssueSnapshot(
                    issue_key="SERIA-10",
                    status="主干测试",
                    versions=("trunk",),
                ),
                "OSCOA-20": JiraIssueSnapshot(
                    issue_key="OSCOA-20",
                    status="分支测试",
                    versions=("trunk", "OSOB2.0"),
                ),
            },
        )[0]

        self.assertEqual(progress.stage_label, "海外 OB")
        self.assertEqual(progress.consistency_label, "一致")
        self.assertEqual(
            progress.branch_label,
            "trunk ✓ | OB ✓",
        )

    def test_progress_reports_missing_overseas_registration(self) -> None:
        progress = build_ticket_progress(
            (self.mapping,),
            {
                "SERIA-10": JiraIssueSnapshot(
                    issue_key="SERIA-10",
                    versions=("trunk",),
                ),
                "OSCOA-20": JiraIssueSnapshot(
                    issue_key="OSCOA-20",
                    versions=(),
                ),
            },
        )[0]

        self.assertEqual(progress.stage_label, "国内 trunk")
        self.assertEqual(progress.consistency_label, "待海外")

    def test_progress_keeps_partial_result_when_jira_fails(self) -> None:
        progress = build_ticket_progress(
            (self.mapping,),
            {
                "SERIA-10": JiraIssueSnapshot(
                    issue_key="SERIA-10",
                    error="offline",
                ),
                "OSCOA-20": JiraIssueSnapshot(
                    issue_key="OSCOA-20",
                    versions=("trunk",),
                ),
            },
        )[0]

        self.assertEqual(progress.stage_label, "状态未知")
        self.assertEqual(progress.consistency_label, "无法比较")


if __name__ == "__main__":
    unittest.main()
