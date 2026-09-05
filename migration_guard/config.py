from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path


DEFAULT_TICKET_SHEET_URL = (
    "https://bytedance.larkoffice.com/wiki/"
    "N7YJwiV4FivSiuko5FCc90O0nEc?sheet=kGEBNH"
)
DEFAULT_DOMESTIC_ROOT = r"C:\trunk"
DEFAULT_OVERSEAS_TRUNK_ROOT = r"D:\Oversea\OStrunk"
DEFAULT_OVERSEAS_OB_ROOT = r"D:\Oversea\OSOB"
WORKSPACE_DOMESTIC = "domestic"
WORKSPACE_OVERSEAS_TRUNK = "overseas_trunk"


@dataclass(frozen=True)
class MigrationGuardConfig:
    domestic_root: str = DEFAULT_DOMESTIC_ROOT
    overseas_trunk_root: str = DEFAULT_OVERSEAS_TRUNK_ROOT
    overseas_ob_root: str = DEFAULT_OVERSEAS_OB_ROOT
    source_workspace: str = WORKSPACE_DOMESTIC
    enabled_modules: tuple[str, ...] = ()
    lookback_days: int = 90
    remote_refresh_minutes: int = 2
    include_externals: bool = False
    trunk_sheet_url: str = DEFAULT_TICKET_SHEET_URL
    osob_sheet_url: str = DEFAULT_TICKET_SHEET_URL

    @classmethod
    def from_dict(cls, data: object) -> "MigrationGuardConfig":
        if not isinstance(data, dict):
            return cls()
        modules = data.get("enabled_modules", ())
        if not isinstance(modules, (list, tuple)):
            modules = ()
        valid_modules = tuple(
            module
            for module in ("res", "doc", "bin")
            if module in modules
        )
        try:
            lookback_days = int(data.get("lookback_days", 90))
        except (TypeError, ValueError):
            lookback_days = 90
        try:
            remote_refresh_minutes = int(
                data.get("remote_refresh_minutes", 2)
            )
        except (TypeError, ValueError):
            remote_refresh_minutes = 2
        if remote_refresh_minutes not in {2, 5}:
            remote_refresh_minutes = 2
        legacy_source = str(data.get("source_root", "")).strip()
        legacy_target = str(data.get("target_root", "")).strip()
        legacy_sheet = str(data.get("ticket_sheet_url", "")).strip()
        configured_workspace = data.get("source_workspace")
        source_workspace = (
            str(configured_workspace)
            if configured_workspace is not None
            else ""
        )
        if source_workspace not in {
            WORKSPACE_DOMESTIC,
            WORKSPACE_OVERSEAS_TRUNK,
        }:
            source_workspace = (
                WORKSPACE_OVERSEAS_TRUNK
                if "ostrunk" in legacy_source.replace("\\", "/").casefold()
                else WORKSPACE_DOMESTIC
            )
        domestic_root = str(
            data.get("domestic_root", "")
        ).strip() or (
            legacy_source
            if source_workspace == WORKSPACE_DOMESTIC and legacy_source
            else DEFAULT_DOMESTIC_ROOT
        )
        overseas_trunk_root = str(
            data.get("overseas_trunk_root", "")
        ).strip() or (
            legacy_source
            if source_workspace == WORKSPACE_OVERSEAS_TRUNK and legacy_source
            else legacy_target
            if source_workspace == WORKSPACE_DOMESTIC and legacy_target
            else DEFAULT_OVERSEAS_TRUNK_ROOT
        )
        overseas_ob_root = str(
            data.get("overseas_ob_root", "")
        ).strip() or (
            legacy_target
            if source_workspace == WORKSPACE_OVERSEAS_TRUNK and legacy_target
            else DEFAULT_OVERSEAS_OB_ROOT
        )
        return cls(
            domestic_root=domestic_root,
            overseas_trunk_root=overseas_trunk_root,
            overseas_ob_root=overseas_ob_root,
            source_workspace=source_workspace,
            enabled_modules=valid_modules,
            lookback_days=max(1, min(lookback_days, 3650)),
            remote_refresh_minutes=remote_refresh_minutes,
            include_externals=bool(data.get("include_externals", False)),
            trunk_sheet_url=str(
                data.get(
                    "trunk_sheet_url",
                    legacy_sheet or DEFAULT_TICKET_SHEET_URL,
                )
            ).strip()
            or DEFAULT_TICKET_SHEET_URL,
            osob_sheet_url=str(
                data.get(
                    "osob_sheet_url",
                    legacy_sheet or DEFAULT_TICKET_SHEET_URL,
                )
            ).strip()
            or DEFAULT_TICKET_SHEET_URL,
        )

    def to_dict(self) -> dict[str, object]:
        data = asdict(self)
        data["enabled_modules"] = list(self.enabled_modules)
        return data


def default_data_directory() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "SVNmate" / "MigrationGuard"
    return Path.home() / ".svnmate" / "migration_guard"


def load_config(path: Path | None = None) -> MigrationGuardConfig:
    target = path or default_data_directory() / "config.json"
    if not target.is_file():
        return MigrationGuardConfig()
    try:
        return MigrationGuardConfig.from_dict(
            json.loads(target.read_text(encoding="utf-8"))
        )
    except (OSError, UnicodeError, json.JSONDecodeError):
        return MigrationGuardConfig()


def save_config(
    config: MigrationGuardConfig,
    path: Path | None = None,
) -> Path:
    target = path or default_data_directory() / "config.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(
        json.dumps(config.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    os.replace(temporary, target)
    return target
