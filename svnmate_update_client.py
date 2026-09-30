from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path

from svnmate_core import (
    CORE_CAPABILITIES,
    CORE_VERSION,
    UpdateEvent,
    create_cli_update_service,
    dedupe_folders,
)
from svnmate_ipc import (
    IPC_PROTOCOL_VERSION,
    SvnMateIpcClient,
    SvnMateResponseError,
    SvnMateUnavailableError,
    is_svnmate_instance_running,
    runtime_metadata,
)


LogSink = Callable[[str], None]
RESULT_PREFIX = "SVNMATE_UPDATE_RESULT_JSON="


class SvnMateUpdateClient:
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
        source: str,
        response_timeout: float = 3600.0,
    ) -> dict[str, object]:
        normalized = [str(path) for path in dedupe_folders(folders)]
        if not normalized:
            raise ValueError("至少需要一个 SVN 工作目录")
        if not source.strip():
            raise ValueError("调用来源不能为空")

        request_id = str(uuid.uuid4())
        deadline = time.monotonic() + response_timeout
        waiting_for_busy_svnmate = False
        if self.instance_running():
            self._write_log("正在连接 SVNmate；如有前序任务将自动排队")

        while True:
            try:
                remaining = max(0.1, deadline - time.monotonic())
                response = self.ipc_client.update(
                    normalized,
                    source=source,
                    request_id=request_id,
                    response_timeout=remaining,
                    min_core_version=CORE_VERSION,
                    required_capabilities=CORE_CAPABILITIES,
                )
            except SvnMateUnavailableError as exc:
                if not self.instance_running():
                    break
                message = (
                    "检测到 SVNmate 正在运行，但 v2 外部调用服务不可用。"
                    "请先更新并重启 SVNmate。"
                )
                self._write_log(message)
                return self._failure(
                    request_id,
                    "ipc-unavailable",
                    message,
                    detail=str(exc),
                )
            except SvnMateResponseError as exc:
                message = f"SVNmate 运行时不满足调用要求：{exc}"
                self._write_log(message)
                return self._failure(request_id, "upgrade-required", message)

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
                return self._failure(request_id, "timeout", message)
            time.sleep(min(1.0, remaining))

        self._write_log("SVNmate 未运行，使用同版本 svnmate_core 更新工作区")
        service = create_cli_update_service(
            event_sink=self._on_core_event,
            output_sink=self.log,
        )
        result = service.update_folders(normalized, request_id=request_id)
        payload = result.to_dict(executed_by="core")
        payload.update(runtime_metadata())
        return payload

    @staticmethod
    def _failure(
        request_id: str,
        status: str,
        message: str,
        **extra: object,
    ) -> dict[str, object]:
        return {
            "protocol_version": IPC_PROTOCOL_VERSION,
            "request_id": request_id,
            "command": "update",
            "executed_by": "client",
            "ok": False,
            "status": status,
            "message": message,
            "folders": [],
            **extra,
        }

    def _on_core_event(self, event: UpdateEvent) -> None:
        detail = f" | {event.message}" if event.message else ""
        self._write_log(
            f"[{event.status}] {event.action} | {event.folder}{detail}"
        )

    def _write_log(self, message: str) -> None:
        if self.log is not None:
            self.log(message)


MigrationUpdateClient = SvnMateUpdateClient


def update_working_copies(
    folders: Iterable[Path | str],
    *,
    log: LogSink | None = None,
    source: str,
    response_timeout: float = 3600.0,
) -> dict[str, object]:
    return SvnMateUpdateClient(log=log).update_folders(
        folders,
        source=source,
        response_timeout=response_timeout,
    )


def main(argv: Sequence[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description="Update SVN working copies through SVNmate v2.",
    )
    parser.add_argument("--source", required=True)
    parser.add_argument(
        "--response-timeout",
        type=float,
        default=3600.0,
    )
    parser.add_argument("folders", nargs="+")
    args = parser.parse_args(argv)

    try:
        result = update_working_copies(
            args.folders,
            log=lambda message: print(message, flush=True),
            source=args.source,
            response_timeout=args.response_timeout,
        )
    except Exception as exc:
        result = {
            "protocol_version": IPC_PROTOCOL_VERSION,
            "request_id": str(uuid.uuid4()),
            "command": "update",
            "executed_by": "client",
            "ok": False,
            "status": "client-error",
            "message": f"{type(exc).__name__}: {exc}",
            "folders": [],
        }

    print(
        RESULT_PREFIX
        + json.dumps(result, ensure_ascii=True, separators=(",", ":")),
        flush=True,
    )
    return 0 if result.get("ok") is True else 1
