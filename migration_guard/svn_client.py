from __future__ import annotations

import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .models import SvnChange, SvnCommit, SvnInfo, WorkingCopyStatus


LogSink = Callable[[str], None]
Runner = Callable[[Sequence[str], Path | None, float], "SvnCommandOutput"]
ISSUE_PATTERN = re.compile(r"(?<![A-Z0-9-])((?:SERIA|OSCOA)-\d+)(?![A-Z0-9-])", re.IGNORECASE)


@dataclass(frozen=True)
class SvnCommandOutput:
    command: tuple[str, ...]
    return_code: int
    stdout: str
    stderr: str
    elapsed_seconds: float


class SvnCommandError(RuntimeError):
    def __init__(self, output: SvnCommandOutput) -> None:
        self.output = output
        message = output.stderr.strip() or output.stdout.strip()
        if not message:
            message = f"SVN 命令退出码 {output.return_code}"
        super().__init__(message)


def normalize_issue_key(value: str) -> str:
    match = ISSUE_PATTERN.search(value.strip())
    if not match:
        raise ValueError(f"无法识别 Jira 单号：{value}")
    return match.group(1).upper()


def message_has_issue(message: str, issue_key: str) -> bool:
    pattern = re.compile(
        rf"(?<![A-Z0-9-]){re.escape(issue_key)}(?![A-Z0-9-])",
        re.IGNORECASE,
    )
    return bool(pattern.search(message))


def issue_keys_in_message(message: str) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            match.group(1).upper()
            for match in ISSUE_PATTERN.finditer(message)
        )
    )


class SvnClient:
    def __init__(
        self,
        svn_executable: str = "svn",
        *,
        runner: Runner | None = None,
        log: LogSink | None = None,
        timeout: float = 300.0,
    ) -> None:
        self.svn_executable = svn_executable
        self.runner = runner or self._default_runner
        self.log = log
        self.timeout = timeout

    def info(self, target: Path | str) -> SvnInfo:
        output = self._run(["info", "--xml", str(target)])
        root = self._parse_xml(output.stdout, "svn info")
        entry = root.find("entry")
        if entry is None:
            raise ValueError(f"SVN info 缺少 entry：{target}")
        repository = entry.find("repository")
        wc_info = entry.find("wc-info")
        return SvnInfo(
            path=entry.get("path", str(target)),
            url=_node_text(entry.find("url")),
            relative_url=_node_text(entry.find("relative-url")),
            repository_root=_node_text(
                repository.find("root") if repository is not None else None
            ),
            repository_uuid=_node_text(
                repository.find("uuid") if repository is not None else None
            ),
            revision=_parse_int(entry.get("revision")),
            wc_root=_node_text(
                wc_info.find("wcroot-abspath") if wc_info is not None else None
            ),
            kind=entry.get("kind", ""),
        )

    def log_by_issue(
        self,
        target: Path | str,
        issue_key: str,
        *,
        start: date | str,
    ) -> tuple[SvnCommit, ...]:
        return self.log_by_issues(
            target,
            [issue_key],
            start=start,
        )

    def log_by_issues(
        self,
        target: Path | str,
        issue_keys: Iterable[str],
        *,
        start: date | str,
    ) -> tuple[SvnCommit, ...]:
        normalized_issues = tuple(
            dict.fromkeys(normalize_issue_key(key) for key in issue_keys)
        )
        if not normalized_issues:
            return ()
        start_text = start.isoformat() if isinstance(start, date) else str(start)
        search_arguments = [
            value
            for issue in normalized_issues
            for value in ("--search", f"*{issue}*")
        ]
        output = self._run(
            [
                "log",
                "--xml",
                "-v",
                *search_arguments,
                "-r",
                f"{{{start_text}}}:HEAD",
                str(target),
            ]
        )
        return tuple(
            commit
            for commit in self._parse_commits(output.stdout)
            if any(
                message_has_issue(commit.message, issue)
                for issue in normalized_issues
            )
        )

    def log_by_message_pattern(
        self,
        target: Path | str,
        search_pattern: str,
        *,
        start: date | str,
    ) -> tuple[SvnCommit, ...]:
        pattern = search_pattern.strip()
        if not pattern:
            return ()
        start_text = start.isoformat() if isinstance(start, date) else str(start)
        output = self._run(
            [
                "log",
                "--xml",
                "-v",
                "--search",
                pattern,
                "-r",
                f"{{{start_text}}}:HEAD",
                str(target),
            ]
        )
        return self._parse_commits(output.stdout)

    def _parse_commits(self, value: str) -> tuple[SvnCommit, ...]:
        root = self._parse_xml(value, "svn log")
        commits: list[SvnCommit] = []
        for node in root.findall("logentry"):
            message = _node_text(node.find("msg"))
            changes = []
            for path_node in node.findall("paths/path"):
                changes.append(
                    SvnChange(
                        action=path_node.get("action", ""),
                        path=(path_node.text or "").strip(),
                        kind=path_node.get("kind", ""),
                        copyfrom_path=path_node.get("copyfrom-path", ""),
                        copyfrom_revision=_optional_int(
                            path_node.get("copyfrom-rev")
                        ),
                    )
                )
            commits.append(
                SvnCommit(
                    revision=_parse_int(node.get("revision")),
                    author=_node_text(node.find("author")),
                    date=_node_text(node.find("date")),
                    message=message,
                    changes=tuple(changes),
                )
            )
        return tuple(sorted(commits, key=lambda item: item.revision))

    def status_paths(
        self,
        paths: Iterable[Path | str],
        *,
        show_updates: bool = True,
    ) -> dict[str, WorkingCopyStatus]:
        normalized_paths = [str(Path(path)) for path in paths]
        results: dict[str, WorkingCopyStatus] = {}
        for chunk in _chunk_paths(normalized_paths):
            try:
                results.update(
                    self._status_chunk(chunk, show_updates=show_updates)
                )
            except SvnCommandError:
                if len(chunk) == 1:
                    path = chunk[0]
                    results[_path_key(path)] = WorkingCopyStatus(
                        path=path,
                        item="error",
                        props="",
                        error="无法读取该路径的 SVN 状态",
                    )
                    continue
                for path in chunk:
                    try:
                        results.update(
                            self._status_chunk(
                                [path],
                                show_updates=show_updates,
                            )
                        )
                    except SvnCommandError as exc:
                        results[_path_key(path)] = WorkingCopyStatus(
                            path=path,
                            item="error",
                            props="",
                            error=str(exc),
                        )
        return results

    def external_paths(self, working_copy: Path | str) -> tuple[Path, ...]:
        root_path = Path(working_copy)
        output = self._run(
            [
                "propget",
                "svn:externals",
                "--xml",
                "-R",
                str(root_path),
            ]
        )
        root = self._parse_xml(output.stdout, "svn propget")
        paths: list[Path] = []
        seen: set[str] = set()
        for target in root.findall("target"):
            owner = Path(target.get("path", str(root_path)))
            for property_node in target.findall("property"):
                for line in (property_node.text or "").splitlines():
                    local_name = _external_local_name(line)
                    if not local_name:
                        continue
                    local_path = owner / local_name
                    key = _path_key(local_path)
                    if key in seen or not local_path.exists():
                        continue
                    seen.add(key)
                    paths.append(local_path)
        return tuple(paths)

    def _status_chunk(
        self,
        paths: list[str],
        *,
        show_updates: bool,
    ) -> dict[str, WorkingCopyStatus]:
        arguments = ["status", "--xml"]
        if show_updates:
            arguments.append("--show-updates")
        arguments.extend(paths)
        output = self._run(arguments)
        root = self._parse_xml(output.stdout, "svn status")
        results: dict[str, WorkingCopyStatus] = {}
        for target in root.findall("target"):
            target_path = target.get("path", "")
            for entry in target.findall("entry"):
                path = entry.get("path", target_path)
                wc_status = entry.find("wc-status")
                repos_status = entry.find("repos-status")
                results[_path_key(path)] = WorkingCopyStatus(
                    path=path,
                    item=(
                        wc_status.get("item", "")
                        if wc_status is not None
                        else ""
                    ),
                    props=(
                        wc_status.get("props", "")
                        if wc_status is not None
                        else ""
                    ),
                    revision=_optional_int(
                        wc_status.get("revision")
                        if wc_status is not None
                        else None
                    ),
                    repository_item=(
                        repos_status.get("item", "")
                        if repos_status is not None
                        else ""
                    ),
                    repository_props=(
                        repos_status.get("props", "")
                        if repos_status is not None
                        else ""
                    ),
                )
        return results

    def _run(
        self,
        arguments: Sequence[str],
        *,
        cwd: Path | None = None,
    ) -> SvnCommandOutput:
        command = [self.svn_executable, *arguments]
        if self.log is not None:
            self.log(" ".join(command))
        output = self.runner(command, cwd, self.timeout)
        if output.return_code != 0:
            raise SvnCommandError(output)
        return output

    @staticmethod
    def _default_runner(
        command: Sequence[str],
        cwd: Path | None,
        timeout: float,
    ) -> SvnCommandOutput:
        started = time.monotonic()
        try:
            process = subprocess.run(
                list(command),
                cwd=str(cwd) if cwd else None,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
                shell=False,
            )
        except FileNotFoundError as exc:
            return SvnCommandOutput(
                command=tuple(command),
                return_code=-1,
                stdout="",
                stderr=f"命令不存在：{exc.filename}",
                elapsed_seconds=time.monotonic() - started,
            )
        except subprocess.TimeoutExpired:
            return SvnCommandOutput(
                command=tuple(command),
                return_code=-1,
                stdout="",
                stderr=f"SVN 命令超过 {timeout:.0f} 秒未完成",
                elapsed_seconds=time.monotonic() - started,
            )
        return SvnCommandOutput(
            command=tuple(command),
            return_code=process.returncode,
            stdout=_decode_svn_output(process.stdout),
            stderr=_decode_svn_output(process.stderr),
            elapsed_seconds=time.monotonic() - started,
        )

    @staticmethod
    def _parse_xml(value: str, operation: str) -> ET.Element:
        try:
            return ET.fromstring(value)
        except ET.ParseError as exc:
            raise ValueError(f"{operation} 返回了无效 XML：{exc}") from exc


def _decode_svn_output(value: bytes) -> str:
    if not value:
        return ""
    try:
        return value.decode("utf-8-sig")
    except UnicodeDecodeError:
        encoding = "mbcs" if os.name == "nt" else "utf-8"
        return value.decode(encoding, errors="replace")


def _node_text(node: ET.Element | None) -> str:
    return (node.text or "").strip() if node is not None else ""


def _parse_int(value: str | None) -> int:
    try:
        return int(value or 0)
    except ValueError:
        return 0


def _optional_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _path_key(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


def _chunk_paths(
    paths: list[str],
    *,
    max_items: int = 80,
    max_characters: int = 24000,
) -> tuple[list[str], ...]:
    chunks: list[list[str]] = []
    current: list[str] = []
    current_length = 0
    for path in paths:
        additional = len(path) + 3
        if current and (
            len(current) >= max_items
            or current_length + additional > max_characters
        ):
            chunks.append(current)
            current = []
            current_length = 0
        current.append(path)
        current_length += additional
    if current:
        chunks.append(current)
    return tuple(chunks)


def _external_local_name(line: str) -> str:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return ""
    tokens = [
        first or second
        for first, second in re.findall(r'"([^"]+)"|(\S+)', stripped)
    ]
    cleaned_tokens = []
    skip_revision = False
    for token in tokens:
        if skip_revision:
            skip_revision = False
            continue
        if token in {"-r", "--revision"}:
            skip_revision = True
            continue
        if token.startswith("-r") or token.startswith("--revision="):
            continue
        cleaned_tokens.append(token)
    tokens = cleaned_tokens
    if len(tokens) < 2:
        return ""

    def is_url(token: str) -> bool:
        lowered = token.lower()
        return lowered.startswith(
            ("^/", "../", "//", "/", "http://", "https://", "svn://")
        )

    if is_url(tokens[0]):
        return tokens[-1]
    if is_url(tokens[-1]):
        return tokens[0]
    return ""
