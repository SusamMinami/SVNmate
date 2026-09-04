from __future__ import annotations

import ast
import json
import os
import socket
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 12031
MAX_RESPONSE_BYTES = 16 * 1024 * 1024


class UnrealMcpError(RuntimeError):
    pass


@dataclass(frozen=True)
class UnrealMigrationContext:
    project_content_dir: str
    branch_content_path: str


@dataclass(frozen=True)
class UnrealMigrationResult:
    requested_packages: tuple[str, ...]
    context: UnrealMigrationContext


class UnrealMcpClient:
    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
        *,
        connect_timeout: float = 2.0,
        request_timeout: float = 1800.0,
    ) -> None:
        self.host = host or os.environ.get("UE_MCP_HOST", DEFAULT_HOST)
        self.port = port or _environment_port()
        self.connect_timeout = connect_timeout
        self.request_timeout = request_timeout

    def inspect_migration_context(self) -> UnrealMigrationContext:
        value = self.eval_python_expression(
            "__import__('json').dumps({"
            "'project_content_dir': "
            "unreal.Paths.convert_relative_path_to_full("
            "unreal.Paths.project_content_dir()),"
            "'branch_content_path': "
            "unreal.Paths.convert_relative_path_to_full(str("
            "unreal.SeriaMigrateInfo().get_info_struct()"
            ".get_editor_property('BranchContentPath').path))"
            "})"
        )
        data = _decode_python_json(value, "UE 迁移配置")
        if not isinstance(data, dict):
            raise UnrealMcpError("UE 返回了无效的迁移配置")
        return UnrealMigrationContext(
            project_content_dir=str(data.get("project_content_dir", "")),
            branch_content_path=str(data.get("branch_content_path", "")),
        )

    def migrate_packages(
        self,
        package_names: tuple[str, ...],
        *,
        source_content_dir: Path,
        target_branch_dir: Path,
    ) -> UnrealMigrationResult:
        packages = tuple(dict.fromkeys(package_names))
        if not packages:
            raise ValueError("没有可迁移的 UE 资源")
        invalid = [
            package
            for package in packages
            if not package.startswith("/Game/")
            or package.endswith((".uasset", ".umap"))
        ]
        if invalid:
            raise ValueError(f"无效的 UE 包名：{invalid[0]}")

        context = self.inspect_migration_context()
        _require_same_path(
            context.project_content_dir,
            source_content_dir,
            "当前 UE 工程不是所选源工程",
        )
        _require_one_of_paths(
            context.branch_content_path,
            (
                target_branch_dir,
                target_branch_dir / "Content",
                target_branch_dir / "res" / "Content",
            ),
            "UE 的 BranchContentPath 未指向所选目标工程",
        )

        package_json = json.dumps(
            packages,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        expression = (
            "(lambda paths: ("
            "unreal.SeriaMigrateInfo.migrate_by_package_names(paths),"
            "__import__('json').dumps({"
            "'ok': True, 'requested_packages': paths"
            "})"
            ")[1])("
            f"{package_json}"
            ")"
        )
        value = self.eval_python_expression(
            expression,
            timeout=self.request_timeout,
        )
        data = _decode_python_json(value, "UE 迁移结果")
        if not isinstance(data, dict) or data.get("ok") is not True:
            raise UnrealMcpError("UE 未返回有效的迁移完成结果")
        return UnrealMigrationResult(
            requested_packages=packages,
            context=context,
        )

    def eval_python_expression(
        self,
        expression: str,
        *,
        timeout: float | None = None,
    ) -> object:
        value = self.invoke(
            "script.eval_python_expression",
            {"Expression": expression},
            timeout=timeout,
        )
        if not isinstance(value, dict):
            raise UnrealMcpError("UE Python 返回了无效响应")
        if value.get("bSuccess") is False:
            raise UnrealMcpError(
                str(value.get("Message") or "UE Python 执行失败")
            )
        return value.get("Result")

    def invoke(
        self,
        action: str,
        args: dict[str, object],
        *,
        timeout: float | None = None,
    ) -> object:
        payload = {
            "proto_type": "tool_call",
            "tool_name": "unreal_invoke",
            "tool_args": {
                "action": action,
                "args": args,
            },
        }
        response = self._request(payload, timeout=timeout)
        if response.get("success") is False:
            message = (
                response.get("errorLogs")
                or response.get("message")
                or response.get("error")
                or f"UE 操作失败：{action}"
            )
            raise UnrealMcpError(str(message))
        if "Value" in response:
            return response["Value"]
        output = response.get("Output")
        if isinstance(output, dict) and "ReturnValue" in output:
            return output["ReturnValue"]
        return None

    def _request(
        self,
        payload: dict[str, object],
        *,
        timeout: float | None,
    ) -> dict[str, Any]:
        body = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        try:
            with socket.create_connection(
                (self.host, self.port),
                timeout=self.connect_timeout,
            ) as connection:
                connection.settimeout(timeout or self.request_timeout)
                connection.sendall(struct.pack(">I", len(body)) + body)
                size = struct.unpack(">I", _receive_exact(connection, 4))[0]
                if size > MAX_RESPONSE_BYTES:
                    raise UnrealMcpError("UE 编辑器响应超过大小限制")
                raw_response = _receive_exact(connection, size)
        except TimeoutError as exc:
            raise UnrealMcpError(
                f"连接或调用 UE 编辑器超时（{self.host}:{self.port}）"
            ) from exc
        except OSError as exc:
            raise UnrealMcpError(
                f"无法连接 UE 编辑器 OmniMcpCore"
                f"（{self.host}:{self.port}）：{exc}"
            ) from exc
        try:
            response = json.loads(raw_response.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise UnrealMcpError("UE 编辑器返回了无效 JSON") from exc
        if not isinstance(response, dict):
            raise UnrealMcpError("UE 编辑器返回了无效响应")
        return response


def _receive_exact(connection: socket.socket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        chunk = connection.recv(size - len(chunks))
        if not chunk:
            raise UnrealMcpError("UE 编辑器在响应完成前关闭了连接")
        chunks.extend(chunk)
    return bytes(chunks)


def _decode_python_json(value: object, operation: str) -> object:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        raise UnrealMcpError(f"{operation}未返回 JSON")
    serialized = value.strip()
    if (
        len(serialized) >= 2
        and serialized[0] in {"'", '"'}
        and serialized[-1] == serialized[0]
    ):
        try:
            literal = ast.literal_eval(serialized)
        except (SyntaxError, ValueError):
            literal = serialized[1:-1]
        if isinstance(literal, str):
            serialized = literal
    try:
        return json.loads(serialized)
    except json.JSONDecodeError as exc:
        raise UnrealMcpError(f"{operation}返回了无效 JSON") from exc


def _require_same_path(
    actual: str,
    expected: Path,
    message: str,
) -> None:
    if not actual:
        raise UnrealMcpError(f"{message}：UE 配置为空")
    actual_path = Path(actual).resolve()
    expected_path = expected.resolve()
    if actual_path != expected_path:
        raise UnrealMcpError(
            f"{message}：UE={actual_path}，工具={expected_path}"
        )


def _require_one_of_paths(
    actual: str,
    expected: tuple[Path, ...],
    message: str,
) -> None:
    if not actual:
        raise UnrealMcpError(f"{message}：UE 配置为空")
    actual_path = Path(actual).resolve()
    expected_paths = tuple(path.resolve() for path in expected)
    if actual_path not in expected_paths:
        choices = "、".join(str(path) for path in expected_paths)
        raise UnrealMcpError(
            f"{message}：UE={actual_path}，工具可接受={choices}"
        )


def _environment_port() -> int:
    try:
        port = int(os.environ.get("UE_MCP_PORT", DEFAULT_PORT))
    except ValueError:
        return DEFAULT_PORT
    return port if 1 <= port <= 65535 else DEFAULT_PORT
