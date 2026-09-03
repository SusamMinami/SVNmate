import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Callable, TypeVar

from .weapon_models import (
    CareerRecord,
    WeaponAppearanceRecord,
    WeaponGroupRecord,
    WeaponLoadReport,
    WeaponRecord,
)


EQUIPMENT_FILENAME = "z装备表.csv"
WEAPON_GROUP_FILENAME = "w武器转换表.csv"
WEAPON_APPEARANCE_FILENAME = "w武器外观表.csv"
CAREER_FILENAME = "z职业配置表.csv"
REQUIRED_ENVIRONMENT_FILENAMES = (
    EQUIPMENT_FILENAME,
    WEAPON_GROUP_FILENAME,
    WEAPON_APPEARANCE_FILENAME,
)


class WeaponDataError(Exception):
    """Base error for weapon CSV loading and validation failures."""


class WeaponSchemaError(WeaponDataError):
    """Raised when a required weapon table field is missing."""


class WeaponDataValueError(WeaponDataError):
    """Raised when a required weapon table value cannot be parsed."""


def _normalize_member(value: str) -> str:
    return value.strip().removeprefix("##&")


def normalize_weapon_search_text(value: str) -> str:
    return " ".join(value.split()).casefold()


def _find_column(
    filename: str,
    members: list[str],
    labels: list[str],
    *,
    member: str | None = None,
    label: str | None = None,
) -> int:
    if member is not None:
        normalized = [_normalize_member(value) for value in members]
        if member in normalized:
            return normalized.index(member)
        expected = member
    elif label is not None:
        stripped = [value.strip().removeprefix("##") for value in labels]
        if label in stripped:
            return stripped.index(label)
        expected = label
    else:
        raise ValueError("A member or label selector is required.")
    raise WeaponSchemaError(f"{filename} 缺少必需字段：{expected}")


def _cell(row: list[str], index: int) -> str:
    return row[index].strip() if index < len(row) else ""


def _parse_required_id(filename: str, row_number: int, value: str) -> int:
    try:
        return int(value)
    except ValueError as exc:
        raise WeaponDataValueError(
            f"{filename} 第 {row_number} 行主键不是整数：{value!r}"
        ) from exc


def _parse_optional_id(
    filename: str,
    row_number: int,
    value: str,
    field: str,
) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise WeaponDataValueError(
            f"{filename} 第 {row_number} 行 {field} 不是整数：{value!r}"
        ) from exc


def _parse_id_list(
    filename: str,
    row_number: int,
    values: list[str],
    field: str,
) -> tuple[int, ...]:
    result: list[int] = []
    for raw_value in values:
        for value in raw_value.replace("{", "").replace("}", "").split(";"):
            value = value.strip()
            if not value or value == "0":
                continue
            parsed = _parse_optional_id(filename, row_number, value, field)
            if parsed is not None and parsed not in result:
                result.append(parsed)
    return tuple(result)


T = TypeVar("T")


def _read_records(
    path: Path,
    build_record: Callable[[list[str], list[str], list[str], int], T | None],
) -> list[T]:
    try:
        handle = path.open("r", encoding="utf-8-sig", newline="")
    except OSError as exc:
        raise WeaponDataError(f"无法读取 {path.name}：{exc}") from exc
    with handle:
        reader = csv.reader(handle)
        try:
            members = next(reader)
            labels = next(reader)
        except StopIteration as exc:
            raise WeaponSchemaError(f"{path.name} 缺少双表头") from exc

        records: list[T] = []
        for row_number, row in enumerate(reader, start=3):
            if not any(value.strip() for value in row):
                continue
            record = build_record(members, labels, row, row_number)
            if record is not None:
                records.append(record)
        return records


class WeaponRepository:
    def __init__(
        self,
        doc_directory: Path,
        weapons: list[WeaponRecord],
        groups: list[WeaponGroupRecord],
        appearances: list[WeaponAppearanceRecord],
        careers: list[CareerRecord],
        warnings: tuple[str, ...] = (),
    ) -> None:
        self.doc_directory = Path(doc_directory)
        self.source_directory = self.doc_directory / "csvdir"
        self.weapons = tuple(weapons)
        self.groups = tuple(groups)
        self.appearances = tuple(appearances)
        self.careers = tuple(careers)

        self.weapons_by_id: dict[int, list[WeaponRecord]] = defaultdict(list)
        self.weapons_by_model_id: dict[int, list[WeaponRecord]] = defaultdict(list)
        self.weapons_by_career_id: dict[int, list[WeaponRecord]] = defaultdict(list)
        self.groups_by_id: dict[int, list[WeaponGroupRecord]] = defaultdict(list)
        self.groups_by_equipment_id: dict[int, list[WeaponGroupRecord]] = defaultdict(list)
        self.appearances_by_id: dict[int, list[WeaponAppearanceRecord]] = defaultdict(list)
        self.careers_by_id: dict[int, list[CareerRecord]] = defaultdict(list)
        self._weapon_name_rows: tuple[tuple[str, WeaponRecord], ...] = tuple(
            (normalize_weapon_search_text(record.name), record)
            for record in weapons
            if normalize_weapon_search_text(record.name)
        )

        for weapon in weapons:
            self.weapons_by_id[weapon.id].append(weapon)
            if weapon.model_id is not None and weapon.model_id > 0:
                self.weapons_by_model_id[weapon.model_id].append(weapon)
            for career_id in weapon.career_ids:
                self.weapons_by_career_id[career_id].append(weapon)
        for group in groups:
            self.groups_by_id[group.id].append(group)
            for equipment_id in group.equipment_ids:
                self.groups_by_equipment_id[equipment_id].append(group)
        for appearance in appearances:
            self.appearances_by_id[appearance.id].append(appearance)
        for career in careers:
            self.careers_by_id[career.id].append(career)

        self.report = WeaponLoadReport(
            doc_directory=self.doc_directory,
            source_directory=self.source_directory,
            loaded_at=datetime.now(),
            weapon_count=len(weapons),
            group_count=len(groups),
            appearance_count=len(appearances),
            career_count=len(careers),
            warnings=warnings,
        )

    @classmethod
    def load(
        cls,
        doc_directory: Path,
    ) -> "WeaponRepository":
        doc_directory = Path(doc_directory)
        source_directory = doc_directory / "csvdir"
        career_directory = doc_directory / "csvdir"
        if not source_directory.is_dir():
            raise WeaponDataError(f"数据目录不存在：{source_directory}")
        for filename in REQUIRED_ENVIRONMENT_FILENAMES:
            if not (source_directory / filename).is_file():
                raise WeaponDataError(f"数据目录缺少文件：{filename}")
        if not (career_directory / CAREER_FILENAME).is_file():
            raise WeaponDataError(f"数据目录缺少文件：{CAREER_FILENAME}")

        equipment_rows = _read_records(
            source_directory / EQUIPMENT_FILENAME,
            _build_equipment_candidate,
        )
        weapons = [record for record in equipment_rows if _is_weapon(record)]
        groups = _read_records(
            source_directory / WEAPON_GROUP_FILENAME,
            _build_weapon_group,
        )
        appearances = _read_records(
            source_directory / WEAPON_APPEARANCE_FILENAME,
            _build_weapon_appearance,
        )
        careers = _read_records(
            career_directory / CAREER_FILENAME,
            _build_career,
        )

        weapon_ids = {weapon.id for weapon in weapons}
        missing_equipment_ids = sorted(
            {
                equipment_id
                for group in groups
                for equipment_id in group.equipment_ids
                if equipment_id not in weapon_ids
            }
        )
        warnings = (
            (
                "转换组引用了未找到的武器装备 ID："
                + "、".join(str(value) for value in missing_equipment_ids[:10])
            ),
        ) if missing_equipment_ids else ()
        return cls(
            doc_directory,
            weapons,
            groups,
            appearances,
            careers,
            warnings,
        )

    def find_weapons_by_name(self, query: str) -> tuple[WeaponRecord, ...]:
        normalized_query = normalize_weapon_search_text(query)
        if not normalized_query:
            return ()
        matches = [
            (normalized_name, weapon)
            for normalized_name, weapon in self._weapon_name_rows
            if normalized_query in normalized_name
        ]
        matches.sort(
            key=lambda item: (
                item[0] != normalized_query,
                not item[0].startswith(normalized_query),
                len(item[0]),
                item[1].id,
                item[1].row_number,
            )
        )
        return tuple(weapon for _normalized_name, weapon in matches)


def _build_equipment_candidate(
    members: list[str],
    labels: list[str],
    row: list[str],
    row_number: int,
) -> WeaponRecord | None:
    filename = EQUIPMENT_FILENAME
    id_column = _find_column(filename, members, labels, member="ItemAttr.id")
    name_column = _find_column(filename, members, labels, member="ItemAttr.name")
    note_column = _find_column(filename, members, labels, label="备注名称")
    description_column = _find_column(
        filename, members, labels, member="ItemAttr.txtdes"
    )
    icon_column = _find_column(filename, members, labels, member="ItemAttr.icon")
    equipment_level_column = _find_column(
        filename, members, labels, member="EquipAttr.equiplv"
    )
    wear_level_column = _find_column(
        filename, members, labels, member="EquipAttr.wearlv"
    )
    part_column = _find_column(filename, members, labels, member="EquipAttr.part")
    part_name_column = _find_column(
        filename, members, labels, member="EquipAttr.partname"
    )
    career_limit_column = _find_column(
        filename, members, labels, member="EquipAttr.careerlimit"
    )
    career_text_column = _find_column(
        filename, members, labels, member="EquipAttr.careertext"
    )
    recommended_career_column = _find_column(
        filename, members, labels, member="EquipAttr.recommendcareer"
    )
    model_column = _find_column(
        filename, members, labels, member="EquipAttr.weaponmesh"
    )

    raw_id = _cell(row, id_column)
    if not raw_id:
        return None
    return WeaponRecord(
        id=_parse_required_id(filename, row_number, raw_id),
        name=_cell(row, name_column),
        note=_cell(row, note_column),
        description=_cell(row, description_column),
        icon_id=_parse_optional_id(
            filename,
            row_number,
            _cell(row, icon_column),
            "武器图标",
        ),
        equipment_level=_parse_optional_id(
            filename,
            row_number,
            _cell(row, equipment_level_column),
            "装备等级",
        ),
        wear_level=_parse_optional_id(
            filename,
            row_number,
            _cell(row, wear_level_column),
            "穿戴等级",
        ),
        part_id=_parse_optional_id(
            filename,
            row_number,
            _cell(row, part_column),
            "装备部位",
        ),
        part_name=_cell(row, part_name_column),
        career_ids=_parse_id_list(
            filename,
            row_number,
            [_cell(row, career_limit_column)],
            "职业限制",
        ),
        career_text=_cell(row, career_text_column),
        recommended_career=_cell(row, recommended_career_column),
        model_id=_parse_optional_id(
            filename,
            row_number,
            _cell(row, model_column),
            "武器模型",
        ),
        row_number=row_number,
    )


def _is_weapon(record: WeaponRecord) -> bool:
    return record.part_name.startswith("武器-") or (
        record.part_id is not None and 100 <= record.part_id < 200
    )


def _build_weapon_group(
    members: list[str],
    labels: list[str],
    row: list[str],
    row_number: int,
) -> WeaponGroupRecord | None:
    filename = WEAPON_GROUP_FILENAME
    id_column = _find_column(filename, members, labels, member="WeaponConvert.id")
    name_column = _find_column(filename, members, labels, label="备注名称")
    equipment_start = _find_column(
        filename, members, labels, member="WeaponConvert.equip"
    )
    is_open_column = _find_column(
        filename, members, labels, member="WeaponConvert.isopen"
    )
    pray_type_column = _find_column(
        filename, members, labels, member="WeaponConvert.preyweapontype"
    )
    raw_id = _cell(row, id_column)
    if not raw_id:
        return None
    equipment_end = is_open_column
    return WeaponGroupRecord(
        id=_parse_required_id(filename, row_number, raw_id),
        name=_cell(row, name_column),
        equipment_ids=_parse_id_list(
            filename,
            row_number,
            row[equipment_start:equipment_end],
            "装备 ID",
        ),
        is_open=_cell(row, is_open_column) == "1",
        pray_weapon_types=_parse_id_list(
            filename,
            row_number,
            [_cell(row, pray_type_column)],
            "祈愿武器类型组",
        ),
        row_number=row_number,
    )


def _build_weapon_appearance(
    members: list[str],
    labels: list[str],
    row: list[str],
    row_number: int,
) -> WeaponAppearanceRecord | None:
    filename = WEAPON_APPEARANCE_FILENAME
    id_column = _find_column(
        filename, members, labels, member="Weaponappearance.id"
    )
    note_column = _find_column(filename, members, labels, label="备注")
    path_column = _find_column(
        filename, members, labels, member="Weaponappearance.path"
    )
    raw_id = _cell(row, id_column)
    if not raw_id:
        return None
    return WeaponAppearanceRecord(
        id=_parse_required_id(filename, row_number, raw_id),
        note=_cell(row, note_column),
        path=_cell(row, path_column),
        row_number=row_number,
    )


def _build_career(
    members: list[str],
    labels: list[str],
    row: list[str],
    row_number: int,
) -> CareerRecord | None:
    filename = CAREER_FILENAME
    id_column = _find_column(filename, members, labels, member="CareerInfor.id")
    name_column = _find_column(filename, members, labels, member="CareerInfor.name")
    raw_id = _cell(row, id_column)
    if not raw_id:
        return None
    return CareerRecord(
        id=_parse_required_id(filename, row_number, raw_id),
        name=_cell(row, name_column),
        row_number=row_number,
    )
