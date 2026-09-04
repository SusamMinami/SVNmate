import tempfile
import unittest
from pathlib import Path

from migration_guard.batch_workflow import BatchMigrationExecutor
from migration_guard.models import (
    BatchMigrationAuditResult,
    ExpectedChange,
    FileVerification,
    MigrationAuditResult,
    VerificationState,
    WorkspaceModule,
)
from migration_guard.ue_client import (
    UnrealMcpClient,
    UnrealMcpError,
    UnrealMigrationContext,
    UnrealMigrationResult,
)


def _verification(
    module: WorkspaceModule,
    name: str,
    source_issue: str,
    target_issue: str,
    state: VerificationState,
    *,
    action: str = "M",
) -> FileVerification:
    source = module.source_path / "Content" / name
    target = module.target_path / "Content" / name
    source.parent.mkdir(parents=True, exist_ok=True)
    if action != "D":
        source.write_bytes(b"asset")
    return FileVerification(
        expected=ExpectedChange(
            module=module.name,
            source_issue=source_issue,
            target_issue=target_issue,
            source_path=f"/project/res/trunk/Content/{name}",
            source_local_path=str(source),
            target_path=f"/project/res/overseas/trunk/Content/{name}",
            target_local_path=str(target),
            action=action,
            kind="file",
            source_revisions=(10,),
            source_authors=("author",),
            source_messages=(f"[{source_issue}] change",),
        ),
        state=state,
        local_status=(
            "modified"
            if state == VerificationState.PENDING_COMMIT
            else "normal"
        ),
        repository_status="",
        reason="test",
    )


def _batch(*cases: tuple[str, str, tuple[FileVerification, ...]]):
    return BatchMigrationAuditResult(
        started_at="start",
        finished_at="finish",
        cases=tuple(
            MigrationAuditResult(
                source_issue=source_issue,
                target_issue=target_issue,
                started_at="start",
                finished_at="finish",
                files=files,
                modules=(),
            )
            for source_issue, target_issue, files in cases
        ),
    )


class _FakeUnrealClient:
    def __init__(self) -> None:
        self.calls = []

    def migrate_packages(
        self,
        package_names,
        *,
        source_content_dir,
        target_branch_dir,
    ):
        self.calls.append(
            (package_names, source_content_dir, target_branch_dir)
        )
        return UnrealMigrationResult(
            requested_packages=package_names,
            context=UnrealMigrationContext(
                str(source_content_dir),
                str(target_branch_dir),
            ),
        )


class _FakeProcess:
    def __init__(self, return_code: int = 0) -> None:
        self.return_code = return_code

    def wait(self) -> int:
        return self.return_code


class BatchWorkflowTests(unittest.TestCase):
    def test_asset_plan_deduplicates_packages_and_keeps_owners(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = WorkspaceModule(
                "res",
                root / "source" / "res",
                root / "target" / "res",
            )
            first = _verification(
                module,
                "Game/A.uasset",
                "SERIA-10",
                "OSCOA-20",
                VerificationState.NOT_MIGRATED,
            )
            second = _verification(
                module,
                "Game/A.uasset",
                "SERIA-11",
                "OSCOA-21",
                VerificationState.NOT_MIGRATED,
            )
            table = _verification(
                module,
                "Tables/A.csv",
                "SERIA-10",
                "OSCOA-20",
                VerificationState.NOT_MIGRATED,
            )
            completed = _verification(
                module,
                "Game/B.uasset",
                "SERIA-10",
                "OSCOA-20",
                VerificationState.COMPLETE,
            )
            result = _batch(
                ("SERIA-10", "OSCOA-20", (first, table, completed)),
                ("SERIA-11", "OSCOA-21", (second,)),
            )

            plan = BatchMigrationExecutor().build_asset_plan(
                result,
                (module,),
            )

        self.assertEqual(plan.package_names, ("/Game/Game/A",))
        self.assertEqual(
            plan.assets[0].source_issues,
            ("SERIA-10", "SERIA-11"),
        )
        self.assertEqual(
            plan.assets[0].target_issues,
            ("OSCOA-20", "OSCOA-21"),
        )
        self.assertEqual(len(plan.manual_files), 1)
        self.assertEqual(plan.already_handled_count, 1)

    def test_migrate_calls_unreal_once_with_all_packages(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = WorkspaceModule(
                "res",
                root / "source" / "res",
                root / "target" / "res",
            )
            files = tuple(
                _verification(
                    module,
                    f"Game/{name}.uasset",
                    "SERIA-10",
                    "OSCOA-20",
                    VerificationState.NOT_MIGRATED,
                )
                for name in ("A", "B")
            )
            plan = BatchMigrationExecutor().build_asset_plan(
                _batch(("SERIA-10", "OSCOA-20", files)),
                (module,),
            )
            ue = _FakeUnrealClient()
            executor = BatchMigrationExecutor(ue=ue)

            executor.migrate(
                plan,
                (module,),
                target_branch_dir=root / "target",
            )

        self.assertEqual(len(ue.calls), 1)
        self.assertEqual(
            ue.calls[0][0],
            ("/Game/Game/A", "/Game/Game/B"),
        )

    def test_asset_plan_can_be_filtered_by_user_selection(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = WorkspaceModule(
                "res",
                root / "source" / "res",
                root / "target" / "res",
            )
            files = tuple(
                _verification(
                    module,
                    f"Game/{name}.uasset",
                    "SERIA-10",
                    "OSCOA-20",
                    VerificationState.NOT_MIGRATED,
                )
                for name in ("A", "B")
            )
            executor = BatchMigrationExecutor()
            plan = executor.build_asset_plan(
                _batch(("SERIA-10", "OSCOA-20", files)),
                (module,),
            )

            selected = executor.select_assets(
                plan,
                ("/Game/Game/B",),
            )

        self.assertEqual(selected.package_names, ("/Game/Game/B",))
        self.assertEqual(selected.manual_files, plan.manual_files)
        self.assertEqual(
            selected.already_handled_count,
            plan.already_handled_count,
        )

    def test_checkout_plan_blocks_paths_owned_by_multiple_tickets(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = WorkspaceModule(
                "res",
                root / "source" / "res",
                root / "target" / "res",
            )
            first = _verification(
                module,
                "Game/A.uasset",
                "SERIA-10",
                "OSCOA-20",
                VerificationState.PENDING_COMMIT,
            )
            second = _verification(
                module,
                "Game/A.uasset",
                "SERIA-11",
                "OSCOA-21",
                VerificationState.PENDING_COMMIT,
            )
            result = _batch(
                ("SERIA-10", "OSCOA-20", (first,)),
                ("SERIA-11", "OSCOA-21", (second,)),
            )

            plan = BatchMigrationExecutor().build_checkout_plan(
                result,
                {
                    "OSCOA-20": "first",
                    "OSCOA-21": "second",
                },
            )

        self.assertEqual(plan.groups, ())
        self.assertEqual(
            plan.ambiguous_paths,
            (first.expected.target_local_path,),
        )

    def test_checkout_windows_are_opened_per_target_ticket(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            module = WorkspaceModule(
                "res",
                root / "source" / "res",
                root / "target" / "res",
            )
            first = _verification(
                module,
                "Game/A.uasset",
                "SERIA-10",
                "OSCOA-20",
                VerificationState.PENDING_COMMIT,
            )
            second = _verification(
                module,
                "Game/B.uasset",
                "SERIA-11",
                "OSCOA-21",
                VerificationState.PENDING_COMMIT,
            )
            plan = BatchMigrationExecutor().build_checkout_plan(
                _batch(
                    ("SERIA-10", "OSCOA-20", (first,)),
                    ("SERIA-11", "OSCOA-21", (second,)),
                ),
                {
                    "OSCOA-20": "first",
                    "OSCOA-21": "second",
                },
            )
            commands = []

            def launch(command):
                commands.append(command)
                return _FakeProcess()

            result = BatchMigrationExecutor(
                tortoise_executable="TortoiseProc.exe",
                process_launcher=launch,
            ).open_checkout_windows(plan)

        self.assertEqual(len(commands), 2)
        self.assertEqual(len(result.opened_groups), 2)
        self.assertEqual(result.return_codes, (0, 0))
        self.assertIn("/logmsg:first", commands[0])
        self.assertIn("/logmsg:second", commands[1])


class UnrealMcpClientTests(unittest.TestCase):
    def test_python_result_wrapper_is_decoded(self) -> None:
        client = UnrealMcpClient()
        client.invoke = lambda *args, **kwargs: {
            "bSuccess": True,
            "Result": "'{\"value\": 3}'",
        }

        value = client.eval_python_expression("ignored")

        self.assertEqual(value, "'{\"value\": 3}'")

    def test_migration_rejects_the_wrong_unreal_project(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source" / "Content"
            target = root / "target"
            source.mkdir(parents=True)
            target.mkdir()
            client = UnrealMcpClient()
            client.inspect_migration_context = lambda: UnrealMigrationContext(
                str(root / "other" / "Content"),
                str(target),
            )

            with self.assertRaisesRegex(
                UnrealMcpError,
                "当前 UE 工程不是所选源工程",
            ):
                client.migrate_packages(
                    ("/Game/A",),
                    source_content_dir=source,
                    target_branch_dir=target,
                )


if __name__ == "__main__":
    unittest.main()
