from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator


BASE_TOKEN = "InxgbLPW1a8WiRs2KR4cDmevnhg"
ROLE_TABLE_ID = "tblAUpM02flmHgJt"
NAMED_ROLE_VIEW_ID = "vewD6vnEri"
NPC_TABLE_ID = "tblry088Tp8n1qwL"

CACHE_SCHEMA_VERSION = 2
RATE_LIMIT_CODE = 800050828


class CharacterCatalogError(RuntimeError):
    """Base error for character catalogue operations."""


class LarkCliUnavailable(CharacterCatalogError):
    """Raised when lark-cli is not installed or cannot be executed."""


class LarkAuthenticationRequired(CharacterCatalogError):
    """Raised when lark-cli has no valid user authorization."""


@dataclass(frozen=True)
class CharacterProfile:
    record_id: str
    role_key: str
    name: str
    tags: tuple[str, ...]
    summary: str
    personality: str
    story: str
    evidence_level: str
    analysis_status: str
    dialogue_count: int


@dataclass(frozen=True)
class CharacterTask:
    task_id: str
    name: str
    description: str
    task_type: str


@dataclass(frozen=True)
class CharacterDialogue:
    dialogue_id: str
    task_prefix: str
    content: str


@dataclass(frozen=True)
class CharacterStory:
    task_prefix: str
    start_node_id: str
    outline: str


@dataclass(frozen=True)
class CharacterDetails:
    character_id: str
    tasks: tuple[CharacterTask, ...]
    dialogues: tuple[CharacterDialogue, ...]
    stories: tuple[CharacterStory, ...]
    loaded_at: datetime


@dataclass(frozen=True)
class CharacterIndex:
    profiles: tuple[CharacterProfile, ...]
    npc_links: dict[int, str]
    fetched_at: datetime


@dataclass(frozen=True)
class LarkLoginRequest:
    verification_url: str
    device_code: str


def default_character_cache_path() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        root = Path(local_app_data)
    else:
        root = Path.home() / "AppData" / "Local"
    return root / "SVNmate" / "ConfigLinker" / "character_catalog.sqlite3"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _from_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _first_option(value: Any) -> str:
    if isinstance(value, list) and value:
        return _text(value[0])
    return _text(value)


def _active(value: Any) -> bool:
    return "有效" in value if isinstance(value, list) else value == "有效"


def _link_ids(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    result = []
    for item in value:
        if isinstance(item, dict):
            record_id = _text(item.get("id"))
            if record_id:
                result.append(record_id)
    return tuple(result)


def _split_tags(value: Any) -> tuple[str, ...]:
    text = _text(value)
    if not text:
        return ()
    return tuple(
        part.strip()
        for part in re.split(r"[、,，;；]", text)
        if part.strip()
    )


def _integer(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    try:
        return int(_text(value))
    except ValueError:
        return 0


class CharacterCatalogCache:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS characters (
                    record_id TEXT PRIMARY KEY,
                    role_key TEXT NOT NULL,
                    name TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    personality TEXT NOT NULL,
                    story TEXT NOT NULL,
                    evidence_level TEXT NOT NULL,
                    analysis_status TEXT NOT NULL,
                    dialogue_count INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS npc_map (
                    npc_id INTEGER PRIMARY KEY,
                    character_id TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_npc_map_character
                    ON npc_map(character_id);
                DROP TABLE IF EXISTS details;
                """
            )
            connection.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)",
                ("schema_version", str(CACHE_SCHEMA_VERSION)),
            )

    def replace_index(self, index: CharacterIndex) -> None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM characters")
            connection.execute("DELETE FROM npc_map")
            connection.executemany(
                """
                INSERT INTO characters(
                    record_id, role_key, name, tags_json, summary,
                    personality, story, evidence_level, analysis_status,
                    dialogue_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        profile.record_id,
                        profile.role_key,
                        profile.name,
                        json.dumps(profile.tags, ensure_ascii=False),
                        profile.summary,
                        profile.personality,
                        profile.story,
                        profile.evidence_level,
                        profile.analysis_status,
                        profile.dialogue_count,
                    )
                    for profile in index.profiles
                ],
            )
            connection.executemany(
                "INSERT INTO npc_map(npc_id, character_id) VALUES(?, ?)",
                sorted(index.npc_links.items()),
            )
            connection.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)",
                ("index_fetched_at", _to_iso(index.fetched_at)),
            )

    def profile_for_npc(self, npc_id: int) -> CharacterProfile | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT characters.*
                FROM npc_map
                JOIN characters
                  ON characters.record_id = npc_map.character_id
                WHERE npc_map.npc_id = ?
                """,
                (npc_id,),
            ).fetchone()
        return self._profile_from_row(row) if row is not None else None

    def profile_count(self) -> int:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM characters"
            ).fetchone()
        return int(row["count"]) if row is not None else 0

    def npc_ids_for_character(self, character_id: str) -> tuple[int, ...]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT npc_id
                FROM npc_map
                WHERE character_id = ?
                ORDER BY npc_id
                """,
                (character_id,),
            ).fetchall()
        return tuple(int(row["npc_id"]) for row in rows)

    def index_fetched_at(self) -> datetime | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT value FROM meta WHERE key = ?",
                ("index_fetched_at",),
            ).fetchone()
        return _from_iso(row["value"]) if row is not None else None

    @staticmethod
    def _profile_from_row(row: sqlite3.Row) -> CharacterProfile:
        return CharacterProfile(
            record_id=row["record_id"],
            role_key=row["role_key"],
            name=row["name"],
            tags=tuple(json.loads(row["tags_json"])),
            summary=row["summary"],
            personality=row["personality"],
            story=row["story"],
            evidence_level=row["evidence_level"],
            analysis_status=row["analysis_status"],
            dialogue_count=int(row["dialogue_count"]),
        )


Runner = Callable[[list[str], Path], subprocess.CompletedProcess[str]]


class LarkCliBaseClient:
    def __init__(
        self,
        *,
        cli_path: Path | None = None,
        runner: Runner | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        minimum_interval: float = 0.45,
    ) -> None:
        self.cli_path = Path(cli_path) if cli_path else self._find_cli()
        self._runner = runner
        self._sleeper = sleeper
        self.minimum_interval = minimum_interval
        self._request_lock = threading.Lock()
        self._last_record_request = 0.0

    @staticmethod
    def _find_cli() -> Path | None:
        configured = os.environ.get("LARK_CLI_PATH")
        if configured and Path(configured).is_file():
            return Path(configured)
        names = ("lark-cli.cmd", "lark-cli.exe", "lark-cli")
        for name in names:
            found = shutil.which(name)
            if found:
                return Path(found)
        return None

    def check_ready(self) -> None:
        payload = self._run_json(["auth", "status", "--json", "--verify"])
        data = payload.get("data", payload)
        user = data.get("identities", {}).get("user", {})
        if (
            user.get("status") != "ready"
            or user.get("tokenStatus") != "valid"
        ):
            raise LarkAuthenticationRequired(
                "飞书用户授权无效"
            )

    def begin_login(self) -> LarkLoginRequest:
        payload = self._run_json(
            [
                "auth",
                "login",
                "--scope",
                "base:record:read base:view:read",
                "--no-wait",
                "--json",
            ]
        )
        verification_url = _text(
            payload.get("verification_url")
            or payload.get("verification_uri_complete")
        )
        device_code = _text(payload.get("device_code"))
        if not verification_url or not device_code:
            raise CharacterCatalogError("飞书授权响应缺少验证地址")
        return LarkLoginRequest(verification_url, device_code)

    def complete_login(self, device_code: str) -> None:
        if not device_code:
            raise CharacterCatalogError("飞书授权设备码为空")
        self._run_json(
            ["auth", "login", "--device-code", device_code, "--json"],
            timeout=300,
        )
        self.check_ready()

    def fetch_index(self) -> CharacterIndex:
        with self._request_lock:
            self.check_ready()
            role_rows = self._record_list(
                ROLE_TABLE_ID,
                (
                    "角色键",
                    "角色名",
                    "性格标签",
                    "设定摘要",
                    "性格分析",
                    "故事经历",
                    "证据等级",
                    "分析状态",
                    "台词数量",
                    "源状态",
                ),
                view_id=NAMED_ROLE_VIEW_ID,
            )
            npc_rows = self._record_list(
                NPC_TABLE_ID,
                ("NPC.id", "关联角色", "源状态"),
                filter_json={
                    "logic": "and",
                    "conditions": [
                        ["源状态", "intersects", ["有效"]],
                    ],
                },
            )

        profiles = tuple(
            profile
            for row in role_rows
            if (profile := self._profile_from_record(row)) is not None
        )
        profile_ids = {profile.record_id for profile in profiles}
        npc_links: dict[int, str] = {}
        for row in npc_rows:
            npc_id = _integer(row.get("NPC.id"))
            links = _link_ids(row.get("关联角色"))
            if (
                npc_id > 0
                and len(links) == 1
                and links[0] in profile_ids
                and _active(row.get("源状态"))
            ):
                npc_links[npc_id] = links[0]
        return CharacterIndex(profiles, npc_links, _utc_now())

    def _record_list(
        self,
        table_id: str,
        fields: Iterable[str],
        *,
        view_id: str | None = None,
        filter_json: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        with tempfile.TemporaryDirectory(prefix="configlinker-base-") as temp:
            directory = Path(temp)
            output_name = "records.ndjson"
            args = [
                "base",
                "+record-list",
                "--base-token",
                BASE_TOKEN,
                "--table-id",
                table_id,
            ]
            for field in fields:
                args.extend(("--field-id", field))
            if view_id is not None:
                args.extend(("--view-id", view_id))
            if filter_json is not None:
                filter_path = directory / "filter.json"
                filter_path.write_text(
                    json.dumps(filter_json, ensure_ascii=False),
                    encoding="utf-8",
                )
                args.extend(("--filter-json", "@filter.json"))
            args.extend(
                (
                    "--limit",
                    "2000",
                    "--format",
                    "ndjson",
                    "--output",
                    f"./{output_name}",
                    "--overwrite",
                    "--as",
                    "user",
                )
            )
            self._throttle()
            payload = self._run_json(args, cwd=directory, retry_rate_limit=True)
            self._last_record_request = time.monotonic()
            if payload.get("has_more"):
                raise CharacterCatalogError(
                    f"表 {table_id} 的角色筛选结果超过 2000 条，"
                    "为避免显示不完整已停止刷新。"
                )
            output_path = directory / output_name
            if not output_path.is_file():
                raise CharacterCatalogError(
                    f"飞书返回成功，但未生成记录文件：{table_id}"
                )
            records = []
            with output_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if line.strip():
                        value = json.loads(line)
                        if isinstance(value, dict):
                            records.append(value)
            return records

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_record_request
        remaining = self.minimum_interval - elapsed
        if remaining > 0:
            self._sleeper(remaining)

    def _run_json(
        self,
        args: list[str],
        *,
        cwd: Path | None = None,
        retry_rate_limit: bool = False,
        timeout: int = 120,
    ) -> dict[str, Any]:
        attempts = 4 if retry_rate_limit else 1
        for attempt in range(attempts):
            result = self._invoke(args, cwd or Path.cwd(), timeout)
            payload = self._decode_payload(
                result.stdout if result.returncode == 0 else result.stderr
            )
            if result.returncode == 0:
                if payload.get("ok") is False:
                    raise CharacterCatalogError(
                        self._error_message(payload)
                    )
                return payload.get("data", payload)
            error = payload.get("error", {})
            if (
                retry_rate_limit
                and error.get("code") == RATE_LIMIT_CODE
                and attempt + 1 < attempts
            ):
                self._sleeper(1.5 * (2**attempt))
                continue
            message = self._error_message(payload)
            if error.get("type") == "authorization":
                raise LarkAuthenticationRequired(message)
            raise CharacterCatalogError(message)
        raise CharacterCatalogError("飞书请求重试后仍未成功")

    def _invoke(
        self,
        args: list[str],
        cwd: Path,
        timeout: int,
    ) -> subprocess.CompletedProcess[str]:
        if self._runner is not None:
            return self._runner(args, cwd)
        if self.cli_path is None or not self.cli_path.is_file():
            raise LarkCliUnavailable(
                "未检测到 lark-cli。请安装 @larksuite/cli 并完成用户授权。"
            )
        executable = str(self.cli_path)
        if os.name == "nt" and self.cli_path.suffix.casefold() in {
            ".cmd",
            ".bat",
        }:
            command_line = subprocess.list2cmdline([executable, *args])
            command = [
                os.environ.get("COMSPEC", "cmd.exe"),
                "/d",
                "/s",
                "/c",
                command_line,
            ]
        else:
            command = [executable, *args]
        env = os.environ.copy()
        env["LARKSUITE_CLI_NO_UPDATE_NOTIFIER"] = "1"
        env["LARKSUITE_CLI_NO_SKILLS_NOTIFIER"] = "1"
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            return subprocess.run(
                command,
                cwd=cwd,
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                creationflags=creation_flags,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise LarkCliUnavailable(f"无法运行 lark-cli：{exc}") from exc

    @staticmethod
    def _decode_payload(text: str) -> dict[str, Any]:
        try:
            payload = json.loads(text.strip())
        except json.JSONDecodeError as exc:
            raise CharacterCatalogError(
                "lark-cli 返回了无法识别的结果"
            ) from exc
        if not isinstance(payload, dict):
            raise CharacterCatalogError("lark-cli 返回格式无效")
        return payload

    @staticmethod
    def _error_message(payload: dict[str, Any]) -> str:
        error = payload.get("error")
        if isinstance(error, dict):
            message = _text(error.get("message"))
            hint = _text(error.get("hint"))
            if hint and hint not in message:
                return f"{message or '飞书请求失败'}：{hint}"
            return message or "飞书请求失败"
        return _text(payload.get("message")) or "飞书请求失败"

    @staticmethod
    def _profile_from_record(
        row: dict[str, Any],
    ) -> CharacterProfile | None:
        record_id = _text(row.get("record_id"))
        name = _text(row.get("角色名"))
        if (
            not record_id
            or not name
            or not _active(row.get("源状态"))
        ):
            return None
        return CharacterProfile(
            record_id=record_id,
            role_key=_text(row.get("角色键")),
            name=name,
            tags=_split_tags(row.get("性格标签")),
            summary=_text(row.get("设定摘要")),
            personality=_text(row.get("性格分析")),
            story=_text(row.get("故事经历")),
            evidence_level=_first_option(row.get("证据等级")),
            analysis_status=_first_option(row.get("分析状态")),
            dialogue_count=_integer(row.get("台词数量")),
        )


class CharacterCatalogService:
    INDEX_MAX_AGE = timedelta(hours=24)

    def __init__(
        self,
        cache: CharacterCatalogCache,
        client: LarkCliBaseClient | None = None,
    ) -> None:
        self.cache = cache
        self.client = client or LarkCliBaseClient()

    @classmethod
    def create_default(cls) -> "CharacterCatalogService":
        return cls(CharacterCatalogCache(default_character_cache_path()))

    def profile_for_npc(self, npc_id: int) -> CharacterProfile | None:
        return self.cache.profile_for_npc(npc_id)

    def npc_ids_for_character(self, character_id: str) -> tuple[int, ...]:
        return self.cache.npc_ids_for_character(character_id)

    def refresh_index(self) -> CharacterIndex:
        index = self.client.fetch_index()
        self.cache.replace_index(index)
        return index

    def begin_login(self) -> LarkLoginRequest:
        return self.client.begin_login()

    def complete_login(self, device_code: str) -> None:
        self.client.complete_login(device_code)

    def index_is_fresh(self) -> bool:
        fetched_at = self.cache.index_fetched_at()
        return (
            fetched_at is not None
            and _utc_now() - fetched_at <= self.INDEX_MAX_AGE
        )

    def status_text(self) -> str:
        count = self.cache.profile_count()
        fetched_at = self.cache.index_fetched_at()
        if count == 0 or fetched_at is None:
            return "角色资料：未同步"
        local_time = fetched_at.astimezone()
        return f"角色资料：{count} 名 · {local_time:%m-%d %H:%M}"
