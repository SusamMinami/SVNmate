from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import time
import urllib.parse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Protocol

from .config import DEFAULT_TICKET_SHEET_URL, default_data_directory
from .svn_client import normalize_issue_key


MAPPING_DELIMITER = "&&&&"
ISSUE_FINDER = re.compile(
    r"(?<![A-Z0-9-])((?:SERIA|OSCOA)-\d+)(?![A-Z0-9-])",
    re.IGNORECASE,
)
CACHE_SCHEMA_VERSION = 1
CACHE_TTL_SECONDS = 300


class TicketRoute(str, Enum):
    DOMESTIC_TO_OVERSEAS = "domestic_to_overseas"
    OVERSEAS_TO_OSOB = "overseas_to_osob"
    OSOB_ONLY = "osob_only"
    SKIP = "skip"
    UNKNOWN = "unknown"

    @property
    def label(self) -> str:
        return {
            self.DOMESTIC_TO_OVERSEAS: "国内主干 → 海外主干",
            self.OVERSEAS_TO_OSOB: "海外主干 → OSOB",
            self.OSOB_ONLY: "仅提交 OSOB",
            self.SKIP: "不合并",
            self.UNKNOWN: "待确认",
        }[self]


@dataclass(frozen=True)
class TicketMapping:
    source_issue: str
    target_issue: str
    route: TicketRoute
    row: int
    source_text: str
    target_text: str
    raw_text: str

    def matches(self, issue_key: str) -> bool:
        normalized = normalize_issue_key(issue_key)
        return normalized in {self.source_issue, self.target_issue}

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["route"] = self.route.value
        return data

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "TicketMapping":
        return cls(
            source_issue=str(data.get("source_issue", "")),
            target_issue=str(data.get("target_issue", "")),
            route=TicketRoute(str(data.get("route", TicketRoute.UNKNOWN.value))),
            row=int(data.get("row", 0)),
            source_text=str(data.get("source_text", "")),
            target_text=str(data.get("target_text", "")),
            raw_text=str(data.get("raw_text", "")),
        )


@dataclass(frozen=True)
class TicketTextResolution:
    mappings: tuple[TicketMapping, ...]
    issue_keys: tuple[str, ...]
    unresolved_keys: tuple[str, ...]
    ambiguous_keys: tuple[str, ...]


@dataclass(frozen=True)
class TicketSheetSnapshot:
    url: str
    sheet_id: str
    sheet_name: str
    revision: int
    fetched_at: str
    mappings: tuple[TicketMapping, ...]
    from_cache: bool = False
    warning: str = ""

    def resolve(self, issue_key: str) -> tuple[TicketMapping, ...]:
        normalized = normalize_issue_key(issue_key)
        return tuple(
            mapping
            for mapping in self.mappings
            if normalized in {
                mapping.source_issue,
                mapping.target_issue,
            }
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": CACHE_SCHEMA_VERSION,
            "url": self.url,
            "sheet_id": self.sheet_id,
            "sheet_name": self.sheet_name,
            "revision": self.revision,
            "fetched_at": self.fetched_at,
            "mappings": [item.to_dict() for item in self.mappings],
        }

    @classmethod
    def from_dict(
        cls,
        data: object,
        *,
        from_cache: bool = True,
        warning: str = "",
    ) -> "TicketSheetSnapshot":
        if not isinstance(data, dict):
            raise ValueError("单号映射缓存格式无效")
        mappings = data.get("mappings", [])
        if not isinstance(mappings, list):
            raise ValueError("单号映射缓存缺少 mappings")
        return cls(
            url=str(data.get("url", "")),
            sheet_id=str(data.get("sheet_id", "")),
            sheet_name=str(data.get("sheet_name", "")),
            revision=int(data.get("revision", 0)),
            fetched_at=str(data.get("fetched_at", "")),
            mappings=tuple(
                TicketMapping.from_dict(item)
                for item in mappings
                if isinstance(item, dict)
            ),
            from_cache=from_cache,
            warning=warning,
        )


class JsonCommandRunner(Protocol):
    def __call__(self, command: list[str]) -> dict[str, object]:
        ...


class LarkTicketSheetClient:
    def __init__(
        self,
        url: str = DEFAULT_TICKET_SHEET_URL,
        *,
        lark_cli: str | None = None,
        runner: JsonCommandRunner | None = None,
        cache_path: Path | None = None,
    ) -> None:
        self.url = url
        self.lark_cli = lark_cli or shutil.which("lark-cli") or "lark-cli"
        self.runner = runner or self._run_json
        self.cache_path = cache_path or _cache_path_for_url(url)
        self.legacy_cache_path = (
            None
            if cache_path is not None
            else default_data_directory() / "ticket_mapping_cache.json"
        )

    def fetch(self, *, force_refresh: bool = False) -> TicketSheetSnapshot:
        cached = self._load_cache()
        if (
            not force_refresh
            and cached is not None
            and cached.url == self.url
            and _cache_age_seconds(cached.fetched_at) <= CACHE_TTL_SECONDS
        ):
            return cached

        try:
            snapshot = self._fetch_online()
            self._save_cache(snapshot)
            return snapshot
        except Exception as exc:
            if cached is not None and cached.url == self.url:
                return TicketSheetSnapshot(
                    url=cached.url,
                    sheet_id=cached.sheet_id,
                    sheet_name=cached.sheet_name,
                    revision=cached.revision,
                    fetched_at=cached.fetched_at,
                    mappings=cached.mappings,
                    from_cache=True,
                    warning=f"飞书读取失败，已使用缓存：{exc}",
                )
            raise

    def _fetch_online(self) -> TicketSheetSnapshot:
        workbook = self.runner(
            [
                self.lark_cli,
                "sheets",
                "+workbook-info",
                "--url",
                self.url,
                "--as",
                "user",
                "--format",
                "json",
            ]
        )
        data = _envelope_data(workbook)
        sheets = data.get("sheets", [])
        if not isinstance(sheets, list):
            raise ValueError("飞书工作簿未返回 sheets")
        requested_sheet_id = _sheet_id_from_url(self.url)
        selected = _select_sheet(sheets, requested_sheet_id)
        sheet_id = str(selected.get("sheet_id", ""))
        sheet_name = str(
            selected.get("title")
            or selected.get("sheet_name")
            or sheet_id
        )
        row_count = max(1, int(selected.get("row_count", 1)))

        csv_response = self.runner(
            [
                self.lark_cli,
                "sheets",
                "+csv-get",
                "--url",
                self.url,
                "--sheet-id",
                sheet_id,
                "--range",
                f"A1:A{row_count}",
                "--include-row-prefix=false",
                "--max-chars",
                "500000",
                "--as",
                "user",
                "--format",
                "json",
            ]
        )
        csv_data = _envelope_data(csv_response)
        if bool(csv_data.get("has_more", False)):
            raise ValueError("合并表 A 列读取被截断")
        values = _first_column_values(
            str(csv_data.get("annotated_csv", ""))
        )
        row_indices = csv_data.get("row_indices", [])
        if not isinstance(row_indices, list):
            row_indices = []
        mappings = parse_ticket_rows(values, row_indices=row_indices)
        return TicketSheetSnapshot(
            url=self.url,
            sheet_id=sheet_id,
            sheet_name=sheet_name,
            revision=int(
                csv_data.get("revision")
                or data.get("revision")
                or 0
            ),
            fetched_at=_utc_now(),
            mappings=mappings,
        )

    def _run_json(self, command: list[str]) -> dict[str, object]:
        environment = os.environ.copy()
        environment["LARKSUITE_CLI_NO_UPDATE_NOTIFIER"] = "1"
        environment["LARKSUITE_CLI_NO_SKILLS_NOTIFIER"] = "1"
        creation_flags = (
            subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        )
        try:
            result = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
                shell=False,
                creationflags=creation_flags,
                env=environment,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("未安装 lark-cli") from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("读取飞书合并表超时") from exc
        stdout = result.stdout.decode("utf-8-sig", errors="replace")
        stderr = result.stderr.decode("utf-8-sig", errors="replace")
        payload_text = stdout if result.returncode == 0 else stderr
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                stderr.strip() or stdout.strip() or "lark-cli 返回无效数据"
            ) from exc
        if result.returncode != 0 or payload.get("ok") is not True:
            error = payload.get("error", {})
            if isinstance(error, dict):
                message = str(
                    error.get("message")
                    or error.get("hint")
                    or "飞书读取失败"
                )
            else:
                message = str(error or "飞书读取失败")
            raise RuntimeError(message)
        return payload

    def _load_cache(self) -> TicketSheetSnapshot | None:
        candidates = [self.cache_path]
        if self.legacy_cache_path is not None:
            candidates.append(self.legacy_cache_path)
        for candidate in candidates:
            if not candidate.is_file():
                continue
            try:
                snapshot = TicketSheetSnapshot.from_dict(
                    json.loads(candidate.read_text(encoding="utf-8"))
                )
            except (
                OSError,
                UnicodeError,
                ValueError,
                json.JSONDecodeError,
            ):
                continue
            if snapshot.url == self.url:
                return snapshot
        return None

    def _save_cache(self, snapshot: TicketSheetSnapshot) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.cache_path.with_suffix(
            self.cache_path.suffix + ".tmp"
        )
        temporary.write_text(
            json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temporary, self.cache_path)


def parse_ticket_rows(
    values: list[str],
    *,
    row_indices: list[object] | None = None,
) -> tuple[TicketMapping, ...]:
    route = TicketRoute.DOMESTIC_TO_OVERSEAS
    mappings: list[TicketMapping] = []
    row_numbers = row_indices or []
    for index, raw_value in enumerate(values):
        value = raw_value.strip()
        row = (
            int(row_numbers[index])
            if index < len(row_numbers)
            else index + 1
        )
        if not value:
            continue
        marker_route = _route_marker(value)
        if marker_route is not None:
            route = marker_route
            continue

        issues = tuple(
            match.group(1).upper()
            for match in ISSUE_FINDER.finditer(value)
        )
        if not issues:
            continue
        seria_issues = tuple(
            issue for issue in issues if issue.startswith("SERIA-")
        )
        oscoa_issues = tuple(
            issue for issue in issues if issue.startswith("OSCOA-")
        )
        left, delimiter, right = value.partition(MAPPING_DELIMITER)
        if delimiter and seria_issues and oscoa_issues:
            pairs, is_unambiguous = _related_issue_pairs(
                left,
                right,
                seria_issues,
                oscoa_issues,
            )
            for source_issue, target_issue in pairs:
                mappings.append(
                    TicketMapping(
                        source_issue=source_issue,
                        target_issue=target_issue,
                        route=(
                            TicketRoute.DOMESTIC_TO_OVERSEAS
                            if is_unambiguous
                            else TicketRoute.UNKNOWN
                        ),
                        row=row,
                        source_text=_text_for_issue(
                            right,
                            source_issue,
                        ),
                        target_text=_text_for_issue(
                            left,
                            target_issue,
                        ),
                        raw_text=value,
                    )
                )
            continue
        if len(oscoa_issues) == 1 and not seria_issues:
            source_issue = oscoa_issues[0]
            target_issue = oscoa_issues[0]
            source_text = value
            target_text = value
            item_route = route
        elif seria_issues and oscoa_issues:
            source_issue = seria_issues[0]
            target_issue = oscoa_issues[0]
            source_text = value
            target_text = value
            item_route = TicketRoute.UNKNOWN
        else:
            source_issue = seria_issues[0] if seria_issues else issues[0]
            target_issue = ""
            source_text = value
            target_text = ""
            item_route = TicketRoute.UNKNOWN
        mappings.append(
            TicketMapping(
                source_issue=source_issue,
                target_issue=target_issue,
                route=item_route,
                row=row,
                source_text=source_text,
                target_text=target_text,
                raw_text=value,
            )
        )
    return tuple(mappings)


def resolve_ticket_text(
    text: str,
    snapshot: TicketSheetSnapshot,
) -> TicketTextResolution:
    issue_keys = tuple(
        dict.fromkeys(
            match.group(1).upper()
            for match in ISSUE_FINDER.finditer(text)
        )
    )
    selected: list[TicketMapping] = []
    selected_keys: set[tuple[str, str, str]] = set()
    unresolved = []
    ambiguous = []

    for issue_key in issue_keys:
        matches = snapshot.resolve(issue_key)
        if not matches:
            unresolved.append(issue_key)
            continue
        unique_matches = _unique_mappings(matches)
        if len(unique_matches) > 1:
            ambiguous.append(issue_key)
            continue
        mapping = unique_matches[0]
        identity = _mapping_identity(mapping)
        if identity not in selected_keys:
            selected.append(mapping)
            selected_keys.add(identity)

    direct_rows = parse_ticket_rows(text.splitlines())
    for mapping in direct_rows:
        if not mapping.target_issue:
            continue
        identity = _mapping_identity(mapping)
        if identity in selected_keys:
            continue
        covered = {mapping.source_issue, mapping.target_issue}
        if covered.isdisjoint(unresolved):
            continue
        selected.append(mapping)
        selected_keys.add(identity)
        unresolved = [
            issue for issue in unresolved if issue not in covered
        ]

    return TicketTextResolution(
        mappings=tuple(selected),
        issue_keys=issue_keys,
        unresolved_keys=tuple(unresolved),
        ambiguous_keys=tuple(ambiguous),
    )


def as_overseas_to_osob(
    mappings: tuple[TicketMapping, ...],
) -> tuple[TicketMapping, ...]:
    result = []
    seen = set()
    for mapping in mappings:
        if mapping.route in {TicketRoute.OSOB_ONLY, TicketRoute.SKIP}:
            continue
        issue = mapping.target_issue or mapping.source_issue
        if not issue.startswith("OSCOA-") or issue in seen:
            continue
        seen.add(issue)
        result.append(
            TicketMapping(
                source_issue=issue,
                target_issue=issue,
                route=TicketRoute.OVERSEAS_TO_OSOB,
                row=mapping.row,
                source_text=mapping.target_text or mapping.source_text,
                target_text=mapping.target_text or mapping.source_text,
                raw_text=mapping.raw_text,
            )
        )
    return tuple(result)


def workbook_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    query = urllib.parse.parse_qsl(
        parsed.query,
        keep_blank_values=True,
    )
    query = [
        (key, value)
        for key, value in query
        if key.casefold() != "sheet"
    ]
    return urllib.parse.urlunparse(
        parsed._replace(query=urllib.parse.urlencode(query))
    )


def _related_issue_pairs(
    left: str,
    right: str,
    seria_issues: tuple[str, ...],
    oscoa_issues: tuple[str, ...],
) -> tuple[tuple[tuple[str, str], ...], bool]:
    left_oscoa = tuple(
        match.group(1).upper()
        for match in ISSUE_FINDER.finditer(left)
        if match.group(1).upper().startswith("OSCOA-")
    ) or oscoa_issues
    right_seria = tuple(
        match.group(1).upper()
        for match in ISSUE_FINDER.finditer(right)
        if match.group(1).upper().startswith("SERIA-")
    ) or seria_issues
    if len(left_oscoa) == 1:
        return (
            tuple((source, left_oscoa[0]) for source in right_seria),
            True,
        )
    if len(right_seria) == 1:
        return (
            tuple((right_seria[0], target) for target in left_oscoa),
            True,
        )
    if len(left_oscoa) == len(right_seria):
        return tuple(zip(right_seria, left_oscoa)), True
    return ((right_seria[0], left_oscoa[0]),), False


def _text_for_issue(value: str, issue_key: str) -> str:
    matches = tuple(ISSUE_FINDER.finditer(value))
    for index, match in enumerate(matches):
        if match.group(1).upper() != issue_key:
            continue
        start = match.start()
        if start and value[start - 1] in "【[（(":
            start -= 1
        end = (
            matches[index + 1].start()
            if index + 1 < len(matches)
            else len(value)
        )
        if end and value[end - 1] in "【[（(":
            end -= 1
        return value[start:end].strip()
    return value.strip()


def _route_marker(value: str) -> TicketRoute | None:
    compact = value.replace(" ", "").casefold()
    if "纯海外单子" in compact:
        return TicketRoute.OVERSEAS_TO_OSOB
    if "单提osob" in compact:
        return TicketRoute.OSOB_ONLY
    if "不合并" in compact:
        return TicketRoute.SKIP
    return None


def _first_column_values(csv_text: str) -> list[str]:
    rows = csv.reader(io.StringIO(csv_text), skipinitialspace=True)
    return [
        str(row[0]).strip() if row else ""
        for row in rows
    ]


def _sheet_id_from_url(url: str) -> str:
    query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    return str(query.get("sheet", [""])[0])


def _select_sheet(
    sheets: list[object],
    requested_sheet_id: str,
) -> dict[str, object]:
    candidates = [item for item in sheets if isinstance(item, dict)]
    if requested_sheet_id:
        for item in candidates:
            if str(item.get("sheet_id", "")) == requested_sheet_id:
                return item
        raise ValueError(f"合并表不存在工作表 {requested_sheet_id}")
    visible = [item for item in candidates if not item.get("is_hidden")]
    if not visible:
        raise ValueError("合并表没有可读取的工作表")
    return min(
        visible,
        key=lambda item: int(item.get("index", len(candidates))),
    )


def _envelope_data(payload: dict[str, object]) -> dict[str, object]:
    if payload.get("ok") is not True:
        raise ValueError("飞书命令未成功")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("飞书命令缺少 data")
    return data


def _cache_age_seconds(value: str) -> float:
    try:
        fetched = datetime.fromisoformat(value)
    except ValueError:
        return float("inf")
    if fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=timezone.utc)
    return max(0.0, (datetime.now(timezone.utc) - fetched).total_seconds())


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mapping_identity(mapping: TicketMapping) -> tuple[str, str, str]:
    return (
        mapping.source_issue,
        mapping.target_issue,
        mapping.route.value,
    )


def _unique_mappings(
    mappings: tuple[TicketMapping, ...],
) -> tuple[TicketMapping, ...]:
    result = []
    seen = set()
    for mapping in mappings:
        identity = _mapping_identity(mapping)
        if identity in seen:
            continue
        seen.add(identity)
        result.append(mapping)
    return tuple(result)


def _cache_path_for_url(url: str) -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]
    return (
        default_data_directory()
        / f"ticket_mapping_cache_{digest}.json"
    )
