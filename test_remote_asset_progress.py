import unittest

from migration_guard.asset_tree import AssetProgressTree
from migration_guard.models import SvnChange, SvnCommit
from migration_guard.remote_asset_progress import (
    DOMESTIC,
    OSOB,
    OVERSEAS_TRUNK,
    RemoteAssetProgressService,
    RemoteRepository,
)
from migration_guard.ticket_mapping import TicketMapping, TicketRoute


def _commit(
    revision: int,
    issue: str,
    *paths: tuple[str, str],
) -> SvnCommit:
    return SvnCommit(
        revision=revision,
        author="tester",
        date="2026-09-01T00:00:00Z",
        message=f"【{issue}】test",
        changes=tuple(
            SvnChange(
                action=action,
                path=path,
                kind="file",
            )
            for action, path in paths
        ),
    )


class _Svn:
    def __init__(self, commits_by_url):
        self.commits_by_url = commits_by_url
        self.calls = []

    def log_by_issues(self, target, issue_keys, *, start):
        self.calls.append((str(target), tuple(issue_keys), start))
        return self.commits_by_url.get(str(target), ())


class RemoteAssetProgressTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repositories = (
            RemoteRepository(
                DOMESTIC,
                "res",
                "https://svn/domestic",
                "/repo/domestic",
            ),
            RemoteRepository(
                OVERSEAS_TRUNK,
                "res",
                "https://svn/overseas",
                "/repo/overseas",
            ),
            RemoteRepository(
                OSOB,
                "res",
                "https://svn/osob",
                "/repo/osob",
            ),
        )
        self.mapping = TicketMapping(
            source_issue="SERIA-10",
            target_issue="OSCOA-20",
            route=TicketRoute.DOMESTIC_TO_OVERSEAS,
            row=1,
            source_text="source",
            target_text="target",
            raw_text="",
        )

    def test_scan_builds_three_stage_asset_progress(self) -> None:
        svn = _Svn(
            {
                "https://svn/domestic": (
                    _commit(
                        10,
                        "SERIA-10",
                        ("A", "/repo/domestic/Content/Foo/A.uasset"),
                        ("M", "/repo/domestic/Content/Foo/B.uasset"),
                    ),
                ),
                "https://svn/overseas": (
                    _commit(
                        20,
                        "OSCOA-20",
                        ("A", "/repo/overseas/Content/Foo/A.uasset"),
                        ("A", "/repo/overseas/Content/Foo/C.uasset"),
                    ),
                ),
                "https://svn/osob": (
                    _commit(
                        30,
                        "OSCOA-20",
                        ("A", "/repo/osob/Content/Foo/A.uasset"),
                    ),
                ),
            }
        )

        result = RemoteAssetProgressService(
            svn,
            repositories=self.repositories,
        ).scan((self.mapping,), enabled_modules=("res",))

        self.assertEqual(len(result.assets), 3)
        by_path = {item.relative_path: item for item in result.assets}
        self.assertEqual(
            by_path["Content/Foo/A.uasset"].stage_label,
            "海外 OB",
        )
        self.assertEqual(
            by_path["Content/Foo/A.uasset"].display_path,
            "/res/Game/Foo/A",
        )
        self.assertEqual(
            by_path["Content/Foo/B.uasset"].stage_label,
            "国内 trunk",
        )
        self.assertEqual(
            by_path["Content/Foo/C.uasset"].stage_label,
            "海外 trunk",
        )
        self.assertEqual(
            result.counts,
            {
                DOMESTIC: 2,
                OVERSEAS_TRUNK: 2,
                OSOB: 1,
            },
        )

    def test_tree_aggregates_branch_counts(self) -> None:
        svn = _Svn(
            {
                "https://svn/domestic": (
                    _commit(
                        10,
                        "SERIA-10",
                        ("A", "/repo/domestic/Content/Foo/A.uasset"),
                        ("A", "/repo/domestic/Content/Foo/B.uasset"),
                    ),
                ),
                "https://svn/overseas": (
                    _commit(
                        20,
                        "OSCOA-20",
                        ("A", "/repo/overseas/Content/Foo/A.uasset"),
                    ),
                ),
            }
        )
        result = RemoteAssetProgressService(
            svn,
            repositories=self.repositories,
        ).scan((self.mapping,), enabled_modules=("res",))

        tree = AssetProgressTree(result.assets)
        root = tree.root_ids[0]

        self.assertEqual(tree.nodes[root].name, "res")
        self.assertEqual(tree.stage_label(root, "domestic"), "2/2")
        self.assertEqual(
            tree.stage_label(root, "overseas_trunk"),
            "1/2",
        )
        self.assertEqual(tree.stage_label(root, "osob"), "0/2")
        self.assertEqual(tree.stage(root), "domestic")

    def test_failed_repository_keeps_other_stage_assets(self) -> None:
        class PartialSvn(_Svn):
            def log_by_issues(self, target, issue_keys, *, start):
                if str(target) == "https://svn/overseas":
                    raise RuntimeError("permission denied")
                return super().log_by_issues(
                    target,
                    issue_keys,
                    start=start,
                )

        svn = PartialSvn(
            {
                "https://svn/domestic": (
                    _commit(
                        10,
                        "SERIA-10",
                        ("M", "/repo/domestic/Content/Foo/A.uasset"),
                    ),
                ),
            }
        )

        result = RemoteAssetProgressService(
            svn,
            repositories=self.repositories,
        ).scan((self.mapping,), enabled_modules=("res",))

        self.assertEqual(len(result.assets), 1)
        self.assertEqual(len(result.warnings), 1)
        self.assertIn("permission denied", result.warnings[0])


if __name__ == "__main__":
    unittest.main()
