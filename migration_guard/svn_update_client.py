from __future__ import annotations

import time
import uuid
from collections.abc import Callable, Iterable
from pathlib import Path

from svnmate_core import UpdateEvent, create_cli_update_service, dedupe_folders
from svnmate_ipc import (
    IPC_PROTOCOL_VERSION,
    SvnMateIpcClient,
    SvnMateResponseError,
    SvnMateUnavailableError,
    is_svnmate_instance_running,
)


LogSink = Callable[[str], None]


class MigrationUpdateClient:
    def __init__(
        self,
        *,
        ipc_client: SvnMateIpcClient | None = None,
        instance_running: Callable[[], bool] = is_svnmate_instance_running,
        log: LogSink | None = None,
    ) -> None:
        self.ipc_client = ipc_client or SvnMateIpcClient()
        self.instance_running = instance_running
        self.log = log

    def update_folders(
        self,
        folders: Iterable[Path | str],
        *,
        response_timeout: float = 3600.0,
    ) -> dict[str, object]:
        normalized = [str(path) for path in dedupe_folders(folders)]
        if not normalized:
            raise ValueError("至少需要一个 SVN 工作目录")
        request_id = str(uuid.uuid4())
        deadline = time.monotonic() + response_timeout
        waiting_for_busy_svnmate = False
        if self.instance_running():
            self._write_log(
                "正在连接 SVNmate；如有前序任务将自动排队"
            )

        while True:
            try:
                remaining = max(0.1, deadline - time.monotonic())
                response = self.ipc_client.update(
                    normalized,
                    source="migration-guard",
                    request_id=request_id,
                    response_timeout=remaining,
                )
            except SvnMateUnavailableError as exc:
                if not self.instance_running():
                    break
                message = (
                    "检测到 SVNmate 正在运行，但外部调用服务不可用。"
                    "请重启新版 SVNmate 后重试。"
                )
                self._write_log(message)
                return {
                    "protocol_version": IPC_PROTOCOL_VERSION,
                    "request_id": request_id,
                    "command": "update",
                    "executed_by": "svnmate",
                    "ok": False,
                    "status": "ipc-unavailable",
                    "message": message,
                    "detail": str(exc),
                    "folders": [],
                }
            except SvnMateResponseError as exc:
                message = f"SVNmate 已接收请求，但未能返回有效结果：{exc}"
                self._write_log(message)
                return {
                    "protocol_version": IPC_PROTOCOL_VERSION,
                    "request_id": request_id,
                    "command": "update",
                    "executed_by": "svnmate",
                    "ok": False,
                    "status": "ipc-error",
                    "message": message,
                    "folders": [],
                }

            if response.get("status") != "busy":
                self._write_log(
                    "更新请求由 SVNmate 执行："
                    f"{response.get('status', 'unknown')}"
                )
                return response
            if not waiting_for_busy_svnmate:
                self._write_log(
                    "SVNmate 正在执行前序任务，本次更新已进入等待队列"
                )
                waiting_for_busy_svnmate = True
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                message = "等待 SVNmate 更新队列超时"
                self._write_log(message)
                return {
                    "protocol_version": IPC_PROTOCOL_VERSION,
                    "request_id": request_id,
                    "command": "update",
                    "executed_by": "svnmate",
                    "ok": False,
                    "status": "timeout",
                    "message": message,
                    "folders": [],
                }
            time.sleep(min(1.0, remaining))

        self._write_log("SVNmate 未运行，使用 svnmate_core 更新工作区")
        service = create_cli_update_service(
            event_sink=self._on_core_event,
            output_sink=self.log,
        )
        result = service.update_folders(
            normalized,
            request_id=request_id,
        )
        return result.to_dict(executed_by="core")

    def _on_core_event(self, event: UpdateEvent) -> None:
        detail = f" | {event.message}" if event.message else ""
        self._write_log(
            f"[{event.status}] {event.action} | {event.folder}{detail}"
        )

    def _write_log(self, message: str) -> None:
        if self.log is not None:
            self.log(message)


def update_working_copies(
    folders: Iterable[Path | str],
    *,
    log: LogSink | None = None,
    response_timeout: float = 3600.0,
) -> dict[str, object]:
    return MigrationUpdateClient(log=log).update_folders(
        folders,
        response_timeout=response_timeout,
    )
