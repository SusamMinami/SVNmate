from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from .character_catalog import LarkCliBaseClient


WEAPON_ICON_TABLE_ID = "tblSOKLfpRQ1nsnQ"


@dataclass(frozen=True)
class WeaponIconAsset:
    icon_id: int
    record_id: str
    file_token: str
    file_name: str


@dataclass(frozen=True)
class WeaponIconIndex:
    assets: tuple[WeaponIconAsset, ...]
    fetched_at: datetime


def default_weapon_icon_cache_path() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    root = (
        Path(local_app_data)
        if local_app_data
        else Path.home() / "AppData" / "Local"
    )
    return root / "SVNmate" / "ConfigLinker" / "weapon_icons.sqlite3"


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _first_option(value: Any) -> str:
    if isinstance(value, list) and value:
        return _text(value[0])
    return _text(value)


def _attachment(value: Any) -> tuple[str, str]:
    if not isinstance(value, list) or not value:
        return "", ""
    item = value[0]
    if not isinstance(item, dict):
        return "", ""
    return _text(item.get("file_token")), _text(item.get("name"))


def _image_suffix(file_name: str) -> str:
    suffix = Path(file_name).suffix.lower()
    return suffix if suffix in {".png", ".jpg", ".jpeg", ".webp"} else ".png"


class WeaponIconCatalogCache:
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
                CREATE TABLE IF NOT EXISTS weapon_icons (
                    icon_id INTEGER PRIMARY KEY,
                    record_id TEXT NOT NULL,
                    file_token TEXT NOT NULL,
                    file_name TEXT NOT NULL
                );
                """
            )

    def replace(self, index: WeaponIconIndex) -> None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM weapon_icons")
            connection.executemany(
                """
                INSERT INTO weapon_icons(
                    icon_id, record_id, file_token, file_name
                ) VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        asset.icon_id,
                        asset.record_id,
                        asset.file_token,
                        asset.file_name,
                    )
                    for asset in index.assets
                ],
            )
            connection.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)",
                ("fetched_at", index.fetched_at.isoformat()),
            )

    def asset(self, icon_id: int) -> WeaponIconAsset | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT icon_id, record_id, file_token, file_name
                FROM weapon_icons
                WHERE icon_id = ?
                """,
                (icon_id,),
            ).fetchone()
        if row is None:
            return None
        return WeaponIconAsset(
            icon_id=int(row["icon_id"]),
            record_id=str(row["record_id"]),
            file_token=str(row["file_token"]),
            file_name=str(row["file_name"]),
        )

    def count(self) -> int:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM weapon_icons"
            ).fetchone()
        return int(row["count"]) if row is not None else 0

    def fetched_at(self) -> datetime | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT value FROM meta WHERE key = ?",
                ("fetched_at",),
            ).fetchone()
        if row is None:
            return None
        try:
            value = datetime.fromisoformat(str(row["value"]))
        except ValueError:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class WeaponIconCatalogService:
    def __init__(
        self,
        cache: WeaponIconCatalogCache,
        client: LarkCliBaseClient,
    ) -> None:
        self.cache = cache
        self.client = client
        self.image_directory = cache.path.parent / "weapon_icons"
        self.image_directory.mkdir(parents=True, exist_ok=True)

    @classmethod
    def create_default(cls) -> "WeaponIconCatalogService":
        return cls(
            WeaponIconCatalogCache(default_weapon_icon_cache_path()),
            LarkCliBaseClient(),
        )

    def index_is_fresh(self, max_age: timedelta = timedelta(days=1)) -> bool:
        fetched_at = self.cache.fetched_at()
        return (
            fetched_at is not None
            and datetime.now(timezone.utc) - fetched_at <= max_age
            and self.cache.count() > 0
        )

    def refresh_index(self) -> WeaponIconIndex:
        self.client.check_ready()
        rows = self.client.list_records(
            WEAPON_ICON_TABLE_ID,
            ("图标ID", "预览图", "导出状态", "源状态"),
        )
        assets_by_icon: dict[int, WeaponIconAsset] = {}
        for row in rows:
            if (
                _first_option(row.get("源状态")) != "有效"
                or _first_option(row.get("导出状态")) != "已导出"
            ):
                continue
            raw_icon_id = _text(row.get("图标ID"))
            record_id = _text(row.get("record_id"))
            file_token, file_name = _attachment(row.get("预览图"))
            try:
                icon_id = int(raw_icon_id)
            except ValueError:
                continue
            if not all((record_id, file_token, file_name)):
                continue
            candidate = WeaponIconAsset(
                icon_id=icon_id,
                record_id=record_id,
                file_token=file_token,
                file_name=file_name,
            )
            current = assets_by_icon.get(icon_id)
            if current is None or (
                candidate.record_id,
                candidate.file_token,
                candidate.file_name,
            ) < (
                current.record_id,
                current.file_token,
                current.file_name,
            ):
                assets_by_icon[icon_id] = candidate
        index = WeaponIconIndex(
            assets=tuple(
                assets_by_icon[icon_id]
                for icon_id in sorted(assets_by_icon)
            ),
            fetched_at=datetime.now(timezone.utc),
        )
        self.cache.replace(index)
        return index

    def asset_for_icon(self, icon_id: int | None) -> WeaponIconAsset | None:
        if icon_id is None or icon_id <= 0:
            return None
        return self.cache.asset(icon_id)

    def asset_path(self, asset: WeaponIconAsset | None) -> Path | None:
        if asset is None:
            return None
        suffix = _image_suffix(asset.file_name)
        return self.image_directory / f"weapon_icon_{asset.icon_id}{suffix}"

    def ensure_icon(self, icon_id: int) -> Path | None:
        asset = self.asset_for_icon(icon_id)
        destination = self.asset_path(asset)
        if asset is None or destination is None:
            return None
        if destination.is_file():
            return destination
        return self.client.download_record_attachment(
            WEAPON_ICON_TABLE_ID,
            asset.record_id,
            asset.file_token,
            destination,
            resource_label=str(icon_id),
        )
