import os
import queue
import threading
import time
import unittest
from unittest.mock import Mock, patch

from migration_guard.svn_update_client import MigrationUpdateClient
from svn_auto_tool import APP_VERSION, SvnAutoTool
from svnmate_ipc import (
    IPC_PROTOCOL_VERSION,
    SvnMateIpcClient,
    SvnMateIpcServer,
    SvnMateResponseError,
    SvnMateUnavailableError,
    make_update_request,
    validate_request,
)


class IpcProtocolTests(unittest.TestCase):
    def test_update_request_is_normalized(self) -> None:
        request = make_update_request(
            [r"C:\trunk\res", "  ", r"D:\Oversea\OStrunk\res"],
            request_id="request-1",
        )

        self.assertEqual(request["protocol_version"], IPC_PROTOCOL_VERSION)
        self.assertEqual(request["request_id"], "request-1")
        self.assertEqual(
            request["folders"],
            [r"C:\trunk\res", r"D:\Oversea\OStrunk\res"],
        )

    def test_invalid_request_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "folders"):
            validate_request(
                {
                    "protocol_version": IPC_PROTOCOL_VERSION,
                    "command": "update",
                    "folders": "not-a-list",
                }
            )

    @unittest.skipUnless(os.name == "nt", "Windows named pipe only")
    def test_named_pipe_round_trip(self) -> None:
        address = rf"\\.\pipe\SVNmate.Test.{os.getpid()}.{time.time_ns()}"
        seen: list[dict[str, object]] = []

        def handler(request: dict[str, object]) -> dict[str, object]:
            seen.append(request)
            return {
                "protocol_version": IPC_PROTOCOL_VERSION,
                "request_id": request["request_id"],
                "command": request["command"],
                "executed_by": "svnmate",
                "ok": True,
                "status": "completed",
                "folders": [],
            }

        server = SvnMateIpcServer(handler, address=address)
        self.assertTrue(server.start())
        try:
            response = SvnMateIpcClient(address=address).update(
                [r"C:\trunk\res"],
                request_id="request-2",
                response_timeout=5,
            )
        finally:
            server.stop()

        self.assertTrue(response["ok"])
        self.assertEqual(response["executed_by"], "svnmate")
        self.assertEqual(seen[0]["folders"], [r"C:\trunk\res"])


class SvnMateIpcHandlerTests(unittest.TestCase):
    def test_ping_reports_ready_instance(self) -> None:
        tool = SvnAutoTool.__new__(SvnAutoTool)
        tool.running = False

        response = tool._handle_ipc_request(
            {
                "protocol_version": IPC_PROTOCOL_VERSION,
                "request_id": "ping-1",
                "command": "ping",
            }
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["status"], "ready")
        self.assertEqual(response["version"], APP_VERSION)

    def test_busy_instance_rejects_external_update(self) -> None:
        tool = SvnAutoTool.__new__(SvnAutoTool)
        tool.running = True
        response: dict[str, object] = {}
        completed = threading.Event()

        tool._start_ipc_update_on_ui_thread(
            {
                "request_id": "request-3",
                "command": "update",
                "folders": [r"C:\trunk\res"],
            },
            response,
            completed,
        )

        self.assertTrue(completed.is_set())
        self.assertFalse(response["ok"])
        self.assertEqual(response["status"], "busy")

    def test_idle_instance_runs_requested_folders(self) -> None:
        tool = SvnAutoTool.__new__(SvnAutoTool)
        tool.running = False
        tool.root = Mock()
        tool.root.after.side_effect = lambda _delay, callback: callback()
        tool.run_button = Mock()
        tool.live_log = Mock()
        tool.status_text = Mock()
        tool.log_queue = queue.Queue()
        tool._log = Mock()
        batch_result = Mock()
        batch_result.to_dict.return_value = {
            "protocol_version": IPC_PROTOCOL_VERSION,
            "request_id": "request-4",
            "command": "update",
            "executed_by": "svnmate",
            "ok": True,
            "status": "completed",
            "folders": [],
        }
        service = Mock()
        service.update_folders.return_value = batch_result
        tool._workspace_update_service = Mock(return_value=service)

        response = tool._handle_ipc_request(
            {
                "protocol_version": IPC_PROTOCOL_VERSION,
                "request_id": "request-4",
                "command": "update",
                "source": "migration-guard",
                "folders": [r"C:\trunk\res"],
            }
        )

        self.assertTrue(response["ok"])
        self.assertEqual(response["executed_by"], "svnmate")
        service.update_folders.assert_called_once_with(
            [r"C:\trunk\res"],
            request_id="request-4",
        )
        self.assertEqual(tool.log_queue.get_nowait()[0], "done")


class MigrationUpdateClientTests(unittest.TestCase):
    def test_running_svnmate_handles_update(self) -> None:
        ipc_client = Mock()
        ipc_client.update.return_value = {
            "protocol_version": IPC_PROTOCOL_VERSION,
            "command": "update",
            "ok": True,
            "status": "completed",
            "executed_by": "svnmate",
        }
        client = MigrationUpdateClient(
            ipc_client=ipc_client,
            instance_running=lambda: True,
        )

        result = client.update_folders([r"C:\trunk\res"])

        self.assertTrue(result["ok"])
        self.assertEqual(result["executed_by"], "svnmate")
        ipc_client.update.assert_called_once()

    def test_running_instance_without_ipc_does_not_fallback(self) -> None:
        ipc_client = Mock()
        ipc_client.update.side_effect = SvnMateUnavailableError("missing")
        client = MigrationUpdateClient(
            ipc_client=ipc_client,
            instance_running=lambda: True,
        )

        with patch(
            "migration_guard.svn_update_client.create_cli_update_service"
        ) as create_service:
            result = client.update_folders([r"C:\trunk\res"])

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "ipc-unavailable")
        create_service.assert_not_called()

    def test_absent_svnmate_uses_core(self) -> None:
        ipc_client = Mock()
        ipc_client.update.side_effect = SvnMateUnavailableError("missing")
        batch_result = Mock()
        batch_result.to_dict.return_value = {
            "ok": True,
            "status": "completed",
            "executed_by": "core",
        }
        service = Mock()
        service.update_folders.return_value = batch_result
        client = MigrationUpdateClient(
            ipc_client=ipc_client,
            instance_running=lambda: False,
        )

        with patch(
            "migration_guard.svn_update_client.create_cli_update_service",
            return_value=service,
        ):
            result = client.update_folders([r"C:\trunk\res"])

        self.assertTrue(result["ok"])
        self.assertEqual(result["executed_by"], "core")
        service.update_folders.assert_called_once()

    def test_ipc_response_error_does_not_start_second_updater(self) -> None:
        ipc_client = Mock()
        ipc_client.update.side_effect = SvnMateResponseError("broken")
        client = MigrationUpdateClient(
            ipc_client=ipc_client,
            instance_running=lambda: True,
        )

        with patch(
            "migration_guard.svn_update_client.create_cli_update_service"
        ) as create_service:
            result = client.update_folders([r"C:\trunk\res"])

        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "ipc-error")
        create_service.assert_not_called()


if __name__ == "__main__":
    unittest.main()
