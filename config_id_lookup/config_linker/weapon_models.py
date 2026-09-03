from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass(frozen=True)
class CareerRecord:
    id: int
    name: str
    row_number: int


@dataclass(frozen=True)
class WeaponRecord:
    id: int
    name: str
    note: str
    description: str
    icon_id: int | None
    equipment_level: int | None
    wear_level: int | None
    part_id: int | None
    part_name: str
    career_ids: tuple[int, ...]
    career_text: str
    recommended_career: str
    model_id: int | None
    row_number: int


@dataclass(frozen=True)
class WeaponGroupRecord:
    id: int
    name: str
    equipment_ids: tuple[int, ...]
    is_open: bool
    pray_weapon_types: tuple[int, ...]
    row_number: int


@dataclass(frozen=True)
class WeaponAppearanceRecord:
    id: int
    note: str
    path: str
    row_number: int


@dataclass(frozen=True)
class WeaponLoadReport:
    doc_directory: Path
    source_directory: Path
    loaded_at: datetime
    weapon_count: int
    group_count: int
    appearance_count: int
    career_count: int
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class WeaponSearchResult:
    query: str
    weapons: tuple[WeaponRecord, ...]
    match_kinds: tuple[str, ...]
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class WeaponDetails:
    weapon: WeaponRecord
    careers: tuple[CareerRecord, ...]
    groups: tuple[WeaponGroupRecord, ...]
    appearances: tuple[WeaponAppearanceRecord, ...]
    same_group_weapons: tuple[WeaponRecord, ...]
    same_career_weapons: tuple[WeaponRecord, ...]
    same_model_weapons: tuple[WeaponRecord, ...]
    warnings: tuple[str, ...] = ()
