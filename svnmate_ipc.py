from __future__ import annotations

import ctypes
import os
import threading
import time
import uuid
from collections.abc import Callable
from multiprocessing import AuthenticationError
from multiprocessing.connection import Client, Listener


IPC_PROTOCOL_VERSION = 1
IPC_PIPE_ADDRESS = r"\\.\pipe\SVNmate.Command.v1"
IPC_AUTHKEY = b"svnmate-command-v1"
SVNMATE_MUTEX_NAME = r"Local\SVNmate.SingleInstance"
MAX_REQUEST_FOLDERS = 64


class SvnMateIpcError(RuntimeError):
    pass


class SvnMateUnavailableError(SvnMateIpcError):
    pass


class SvnMateResponseError(SvnMateIpcError):
    pass


def make_update_request(
    folders: list[str],
    *,
    source: str = "migration-guard",
    request_id: str | None = None,
) -> dict[str, object]:
    normalized = [str(folder).strip() for folder in folders if str(folder).strip()]
    if not normalized:
        raise ValueError("至少需要一个 SVN 工作目录")
    if len(normalized) > MAX_REQUEST_FOLDERS:
        raise ValueError(f"单次最多更新 {MAX_REQUEST_FOLDERS} 个工作目录")
    return {
        "protocol_version": IPC_PROTOCOL_VERSION,
        "request_id": request_id or str(uuid.uuid4()),
        "command": "update",
        "source": source,
        "folders": normalized,
    }


def validate_request(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise ValueError("请求必须是对象")
    if payload.get("protocol_version") != IPC_PROTOCOL_VERSION:
        raise ValueError("不支持的 IPC 协议版本")

    command = payload.get("command")
    if command == "ping":
        return dict(payload)
    if command != "update":
        raise ValueError("不支持的命令")

    folders = payload.get("folders")
    if not isinstance(folders, list):
        raise ValueError("folders 必须是数组")
    normalized = []
    for folder in folders:
        if not isinstance(folder, str) or not folder.strip():
            raise ValueError("folders 只能包含非空路径")
        normalized.append(folder.strip())
    if not normalized:
        raise ValueError("至少需要一个 SVN 工作目录")
    if len(normalized) > MAX_REQUEST_FOLDERS:
        raise ValueError(f"单次最多更新 {MAX_REQUEST_FOLDERS} 个工作目录")

    result = dict(payload)
    result["folders"] = normalized
    request_id = result.get("request_id")
    if not isinstance(request_id, str) or not request_id.strip():
        result["request_id"] = str(uuid.uuid4())
    source = result.get("source")
    if not isinstance(source, str) or not source.strip():
        result["source"] = "external"
    return result


class SvnMateIpcServer:
    def __init__(
        self,
        handler: Callable[[dict[str, object]], dict[str, object]],
        *,
        address: str = IPC_PIPE_ADDRESS,
        authkey: bytes = IPC_AUTHKEY,
        log: Callable[[str], None] | None = None,
    ) -> None:
        self.handler = handler
        self.address = address
        self.authkey = authkey
        self.log = log
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._ready_event = threading.Event()
        self._started = False

    def start(self, timeout: float = 3.0) -> bool:
        if os.name != "nt":
            return False
        if self._thread and self._thread.is_alive():
            return self._started
        self._stop_event.clear()
        self._ready_event.clear()
        self._thread = threading.Thread(
            target=self._serve,
            name="svnmate-ipc",
            daemon=True,
        )
        self._thread.start()
        self._ready_event.wait(timeout)
        return self._started

    def stop(self) -> None:
        if not self._thread:
            return
        self._stop_event.set()
        if self._started:
            try:
                connection = Client(
                    self.address,
                    family="AF_PIPE",
                    authkey=self.authkey,
                )
                with connection:
                    connection.send(
                        {
                            "protocol_version": IPC_PROTOCOL_VERSION,
                            "command": "_stop_server",
                        }
                    )
            except (OSError, EOFError, AuthenticationError):
                pass
        if self._thread.is_alive() and threading.current_thread() is not self._thread:
            self._thread.join(timeout=2)
        self._thread = None
        self._started = False

    def _serve(self) -> None:
        listener = None
        try:
            listener = Listener(
                self.address,
                family="AF_PIPE",
                backlog=4,
                authkey=self.authkey,
            )
            self._started = True
            self._ready_event.set()
            while not self._stop_event.is_set():
                try:
                    connection = listener.accept()
                except (OSError, EOFError, AuthenticationError):
                    break
                threading.Thread(
                    target=self._handle_connection,
                    args=(connection,),
                    name="svnmate-ipc-request",
                    daemon=True,
                ).start()
        except OSError as exc:
            self._write_log(f"IPC 服务启动失败：{exc}")
        finally:
            self._started = False
            self._ready_event.set()
            if listener is not None:
                try:
                    listener.close()
                except OSError:
                    pass

    def _handle_connection(self, connection: object) -> None:
        try:
            with connection:
                payload = connection.recv()
                if (
                    isinstance(payload, dict)
                    and payload.get("command") == "_stop_server"
                ):
                    return
                try:
                    request = validate_request(payload)
                    response = self.handler(request)
                    if not isinstance(response, dict):
                        raise TypeError("IPC handler 必须返回对象")
                except Exception as exc:
                    response = {
                        "protocol_version": IPC_PROTOCOL_VERSION,
                        "ok": False,
                        "status": "invalid-request",
                        "message": str(exc),
                    }
                connection.send(response)
        except (OSError, EOFError, AuthenticationError) as exc:
            self._write_log(f"IPC 请求连接中断：{exc}")

    def _write_log(self, message: str) -> None:
        if self.log is not None:
            self.log(message)


class SvnMateIpcClient:
    def __init__(
        self,
        *,
        address: str = IPC_PIPE_ADDRESS,
        authkey: bytes = IPC_AUTHKEY,
    ) -> None:
        self.address = address
        self.authkey = authkey

    def request(
        self,
        payload: dict[str, object],
        *,
        connect_timeout: float = 2.0,
        response_timeout: float = 3600.0,
    ) -> dict[str, object]:
        if os.name != "nt":
            raise SvnMateUnavailableError("SVNmate IPC 仅支持 Windows")
        if not _wait_for_named_pipe(self.address, connect_timeout):
            raise SvnMateUnavailableError("SVNmate IPC 服务未运行")
        try:
            connection = Client(
                self.address,
                family="AF_PIPE",
                authkey=self.authkey,
            )
        except (OSError, EOFError, AuthenticationError) as exc:
            raise SvnMateUnavailableError(f"无法连接 SVNmate：{exc}") from exc

        with connection:
            try:
                connection.send(payload)
                if not connection.poll(response_timeout):
                    raise SvnMateResponseError("等待 SVNmate 返回结果超时")
                response = connection.recv()
            except (OSError, EOFError, AuthenticationError) as exc:
                raise SvnMateResponseError(
                    f"SVNmate IPC 请求失败：{exc}"
                ) from exc
        if not isinstance(response, dict):
            raise SvnMateResponseError("SVNmate 返回了无效结果")
        return response

    def ping(self, *, connect_timeout: float = 2.0) -> dict[str, object]:
        return self.request(
            {
                "protocol_version": IPC_PROTOCOL_VERSION,
                "request_id": str(uuid.uuid4()),
                "command": "ping",
                "source": "client",
            },
            connect_timeout=connect_timeout,
            response_timeout=5.0,
        )

    def update(
        self,
        folders: list[str],
        *,
        source: str = "migration-guard",
        request_id: str | None = None,
        response_timeout: float = 3600.0,
    ) -> dict[str, object]:
        response = self.request(
            make_update_request(
                folders,
                source=source,
                request_id=request_id,
            ),
            response_timeout=response_timeout,
        )
        if response.get("protocol_version") != IPC_PROTOCOL_VERSION:
            raise SvnMateResponseError("SVNmate 返回了不兼容的协议版本")
        if response.get("command") != "update":
            raise SvnMateResponseError("SVNmate 返回了错误的命令类型")
        return response


def is_svnmate_instance_running(
    mutex_name: str = SVNMATE_MUTEX_NAME,
) -> bool:
    if os.name != "nt":
        return False
    synchronize = 0x00100000
    kernel32 = ctypes.windll.kernel32
    kernel32.OpenMutexW.argtypes = [
        ctypes.c_ulong,
        ctypes.c_int,
        ctypes.c_wchar_p,
    ]
    kernel32.OpenMutexW.restype = ctypes.c_void_p
    handle = kernel32.OpenMutexW(synchronize, False, mutex_name)
    if not handle:
        return False
    kernel32.CloseHandle(handle)
    return True


def _wait_for_named_pipe(address: str, timeout: float) -> bool:
    if os.name != "nt":
        return False
    kernel32 = ctypes.windll.kernel32
    kernel32.WaitNamedPipeW.argtypes = [ctypes.c_wchar_p, ctypes.c_ulong]
    kernel32.WaitNamedPipeW.restype = ctypes.c_int
    timeout_ms = max(0, min(int(timeout * 1000), 0xFFFFFFFE))
    deadline = time.monotonic() + timeout
    while True:
        if kernel32.WaitNamedPipeW(address, timeout_ms):
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.05)
