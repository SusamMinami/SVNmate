from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from .svn_client import normalize_issue_key
from .ticket_mapping import TicketMapping, TicketRoute


DEFAULT_JIRA_STATUS_URL = (
    "https://cloudapi.bytedance.net/faas/services/ttwac2/"
    "invoke/P6JiraStatusGet"
)
JIRA_CACHE_SECONDS = 300
UrlOpen = Callable[..., object]


@dataclass(frozen=True)
class JiraIssueSnapshot:
    issue_key: str
    status: str = ""
    versions: tuple[str, ...] = ()
    create_date: str = ""
    fetched_at: str = ""
    error: str = ""

    @property
    def available(self) -> bool:
        return not self.error

    @property
    def has_trunk(self) -> bool:
        return any(
            version.strip().casefold() == "trunk"
            for version in self.versions
        )

    @property
    def has_osob(self) -> bool:
        return any(
            "osob" in version.strip().casefold()
            for version in self.versions
        )

    @property
    def version_label(self) -> str:
        return ", ".join(self.versions) or "未登记"


@dataclass(frozen=True)
class TicketJiraProgress:
    mapping: TicketMapping
    source: JiraIssueSnapshot
    target: JiraIssueSnapshot

    @property
    def stage_label(self) -> str:
        if not self.source.available or not self.target.available:
            return "状态未知"
        if self.target.has_osob:
            return "海外 OB"
        if self.target.has_trunk:
            return "海外 trunk"
        if self.source.has_trunk:
            return "国内 trunk"
        return "待登记"

    @property
    def consistency_label(self) -> str:
        if not self.source.available or not self.target.available:
            return "无法比较"
        if self.mapping.route == TicketRoute.OVERSEAS_TO_OSOB:
            return "已登记" if self.target.has_osob else "待 OB"
        if self.target.has_osob and not self.target.has_trunk:
            return "版本异常"
        if self.source.has_trunk and self.target.has_trunk:
            return "一致"
        if self.source.has_trunk:
            return "待海外"
        return "待国内"

    @property
    def branch_label(self) -> str:
        if not self.target.available:
            return "读取失败"
        trunk = "trunk ✓" if self.target.has_trunk else "trunk -"
        osob = "OB ✓" if self.target.has_osob else "OB -"
        return f"{trunk} | {osob}"


class JiraIssueClient:
    def __init__(
        self,
        endpoint: str = DEFAULT_JIRA_STATUS_URL,
        *,
        timeout: float = 15.0,
        opener: UrlOpen | None = None,
        cache_seconds: int = JIRA_CACHE_SECONDS,
    ) -> None:
        self.endpoint = endpoint
        self.timeout = timeout
        self.opener = opener or urllib.request.urlopen
        self.cache_seconds = cache_seconds
        self._cache: dict[str, tuple[float, JiraIssueSnapshot]] = {}

    def fetch(self, issue_key: str) -> JiraIssueSnapshot:
        key = normalize_issue_key(issue_key)
        cached = self._cache.get(key)
        if cached and time.monotonic() - cached[0] < self.cache_seconds:
            return cached[1]
        try:
            payload = self._request(key)
            snapshot = self._parse(key, payload)
        except Exception as exc:
            snapshot = JiraIssueSnapshot(
                issue_key=key,
                fetched_at=_utc_now(),
                error=str(exc),
            )
        self._cache[key] = (time.monotonic(), snapshot)
        return snapshot

    def fetch_many(
        self,
        issue_keys: tuple[str, ...],
    ) -> dict[str, JiraIssueSnapshot]:
        keys = tuple(
            dict.fromkeys(normalize_issue_key(key) for key in issue_keys)
        )
        if not keys:
            return {}
        results: dict[str, JiraIssueSnapshot] = {}
        with ThreadPoolExecutor(
            max_workers=min(6, len(keys)),
            thread_name_prefix="migration-jira",
        ) as executor:
            futures = {
                executor.submit(self.fetch, key): key
                for key in keys
            }
            for future in as_completed(futures):
                key = futures[future]
                results[key] = future.result()
        return results

    def _request(self, issue_key: str) -> object:
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(
                {"issueKey": issue_key},
                ensure_ascii=True,
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with self.opener(request, timeout=self.timeout) as response:
                body = response.read()
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Jira 接口 HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"无法连接 Jira 接口：{exc.reason}") from exc
        try:
            return json.loads(body.decode("utf-8-sig"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("Jira 接口返回了无效 JSON") from exc

    @staticmethod
    def _parse(issue_key: str, payload: object) -> JiraIssueSnapshot:
        if not isinstance(payload, dict):
            raise RuntimeError("Jira 接口返回格式无效")
        error = payload.get("error", 0)
        if error not in {0, "0", None, ""}:
            message = payload.get("message") or payload.get("errorMsg")
            raise RuntimeError(str(message or f"Jira 错误 {error}"))
        versions_value = payload.get("jiraVersions", ())
        if not isinstance(versions_value, (list, tuple)):
            versions_value = ()
        versions = tuple(
            dict.fromkeys(
                str(value).strip()
                for value in versions_value
                if str(value).strip()
            )
        )
        return JiraIssueSnapshot(
            issue_key=issue_key,
            status=str(payload.get("jiraStatus", "")).strip(),
            versions=versions,
            create_date=str(payload.get("createDate", "")).strip(),
            fetched_at=_utc_now(),
        )


def build_ticket_progress(
    mappings: tuple[TicketMapping, ...],
    issues: dict[str, JiraIssueSnapshot],
) -> tuple[TicketJiraProgress, ...]:
    progress = []
    for mapping in mappings:
        source = issues.get(mapping.source_issue) or JiraIssueSnapshot(
            issue_key=mapping.source_issue,
            error="未读取国内 Jira",
        )
        target_key = mapping.target_issue or mapping.source_issue
        target = issues.get(target_key) or JiraIssueSnapshot(
            issue_key=target_key,
            error="未读取海外 Jira",
        )
        progress.append(
            TicketJiraProgress(
                mapping=mapping,
                source=source,
                target=target,
            )
        )
    return tuple(progress)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
