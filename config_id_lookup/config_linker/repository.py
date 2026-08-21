import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Callable, TypeVar

from .models import LoadReport, NpcRecord, ResourceRecord, TargetRecord


TARGET_FILENAME = "m目标物表.csv"
NPC_FILENAME = "NPC表.csv"
RESOURCE_FILENAME = "m模型资源表.csv"
REQUIRED_FILENAMES = (TARGET_FILENAME, NPC_FILENAME, RESOURCE_FILENAME)


class CsvDataError(Exception):
    """Base error for CSV loading and validation failures."""


class SchemaError(CsvDataError):
    """Raised when a required double-header field is missing."""


class DataValueError(CsvDataError):
    """Raised when a required value cannot be parsed."""


def _normalize_member(value: str) -> str:
    return value.strip().removeprefix("##&")


def _normalize_search_text(value: str) -> str:
    return " ".join(value.split()).casefold()


def _find_column(
    filename: str,
    members: list[str],
    labels: list[str],
    *,
    member: str | None = None,
    label: str | None = None,
    label_prefix: str | None = None,
) -> int:
    if member is not None:
        normalized = [_normalize_member(value) for value in members]
        if member in normalized:
            return normalized.index(member)
        expected = member
    elif label is not None:
        stripped = [value.strip() for value in labels]
        if label in stripped:
            return stripped.index(label)
        expected = label
    elif label_prefix is not None:
        for index, value in enumerate(labels):
            if value.strip().startswith(label_prefix):
                return index
        expected = f"{label_prefix}..."
    else:
        raise ValueError("A member or label selector is required.")
    raise SchemaError(f"{filename} 缺少必需字段：{expected}")


def _cell(row: list[str], index: int) -> str:
    return row[index].strip() if index < len(row) else ""


def _parse_primary_id(filename: str, row_number: int, value: str) -> int:
    try:
        return int(value)
    except ValueError as exc:
        raise DataValueError(
            f"{filename} 第 {row_number} 行主键不是整数：{value!r}"
        ) from exc


def _parse_optional_id(filename: str, row_number: int, value: str, field: str) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise DataValueError(
            f"{filename} 第 {row_number} 行 {field} 不是整数：{value!r}"
        ) from exc


T = TypeVar("T")


def _read_records(
    path: Path,
    build_record: Callable[[list[str], list[str], list[str], int], T],
) -> list[T]:
    filename = path.name
    try:
        handle = path.open("r", encoding="utf-8-sig", newline="")
    except OSError as exc:
        raise CsvDataError(f"无法读取 {filename}：{exc}") from exc
    with handle:
        reader = csv.reader(handle)
        try:
            members = next(reader)
            labels = next(reader)
        except StopIteration as exc:
            raise SchemaError(f"{filename} 缺少双表头") from exc

        records: list[T] = []
        for row_number, row in enumerate(reader, start=3):
            if not any(value.strip() for value in row):
                continue
            record = build_record(members, labels, row, row_number)
            if record is not None:
                records.append(record)
        return records


class CsvRepository:
    def __init__(
        self,
        directory: Path,
        targets: list[TargetRecord],
        npcs: list[NpcRecord],
        resources: list[ResourceRecord],
    ) -> None:
        self.directory = directory
        self.targets = tuple(targets)
        self.npcs = tuple(npcs)
        self.resources = tuple(resources)

        self.targets_by_id: dict[int, list[TargetRecord]] = defaultdict(list)
        self.targets_by_npc_id: dict[int, list[TargetRecord]] = defaultdict(list)
        self.npcs_by_id: dict[int, list[NpcRecord]] = defaultdict(list)
        self.npcs_by_resource_id: dict[int, list[NpcRecord]] = defaultdict(list)
        self.resources_by_id: dict[int, list[ResourceRecord]] = defaultdict(list)
        self._npc_name_search_rows: tuple[tuple[str, NpcRecord], ...] = tuple(
            (_normalize_search_text(record.name), record)
            for record in npcs
            if _normalize_search_text(record.name)
        )

        for record in targets:
            self.targets_by_id[record.id].append(record)
            if record.npc_id is not None:
                self.targets_by_npc_id[record.npc_id].append(record)
        for record in npcs:
            self.npcs_by_id[record.id].append(record)
            if record.resource_id is not None:
                self.npcs_by_resource_id[record.resource_id].append(record)
        for record in resources:
            self.resources_by_id[record.id].append(record)

        self.report = LoadReport(
            directory=directory,
            loaded_at=datetime.now(),
            target_count=len(targets),
            npc_count=len(npcs),
            resource_count=len(resources),
        )

    def find_npcs_by_name(self, query: str) -> tuple[NpcRecord, ...]:
        normalized_query = _normalize_search_text(query)
        if not normalized_query:
            return ()
        matches = [
            (normalized_name, record)
            for normalized_name, record in self._npc_name_search_rows
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
        return tuple(record for _normalized_name, record in matches)

    @classmethod
    def load(cls, directory: Path) -> "CsvRepository":
        directory = Path(directory)
        if not directory.is_dir():
            raise CsvDataError(f"数据目录不存在：{directory}")
        for filename in REQUIRED_FILENAMES:
            path = directory / filename
            if not path.is_file():
                raise CsvDataError(f"数据目录缺少文件：{filename}")

        targets = _read_records(directory / TARGET_FILENAME, _build_target)
        npcs = _read_records(directory / NPC_FILENAME, _build_npc)
        resources = _read_records(directory / RESOURCE_FILENAME, _build_resource)
        return cls(directory, targets, npcs, resources)


def _build_target(
    members: list[str],
    labels: list[str],
    row: list[str],
    row_number: int,
) -> TargetRecord | None:
    id_column = _find_column(TARGET_FILENAME, members, labels, member="MissionPosition.ID")
    type_column = _find_column(TARGET_FILENAME, members, labels, label="类型")
    description_column = _find_column(TARGET_FILENAME, members, labels, label="描述")
    npc_column = _find_column(
        TARGET_FILENAME,
        members,
        labels,
        member="MissionPosition.NPCID",
    )
    position_column = _find_column(
        TARGET_FILENAME,
        members,
        labels,
        member="MissionPosition.Position",
    )
    rotation_column = _find_column(
        TARGET_FILENAME,
        members,
        labels,
        member="MissionPosition.Rotation",
    )
    raw_id = _cell(row, id_column)
    if not raw_id:
        return None
    return TargetRecord(
        id=_parse_primary_id(TARGET_FILENAME, row_number, raw_id),
        target_type=_cell(row, type_column),
        description=_cell(row, description_column),
        npc_id=_parse_optional_id(
            TARGET_FILENAME,
            row_number,
            _cell(row, npc_column),
            "NPCID",
        ),
        row_number=row_number,
        position=_cell(row, position_column),
        rotation=_cell(row, rotation_column),
    )


def _build_npc(
    members: list[str],
    labels: list[str],
    row: list[str],
    row_number: int,
) -> NpcRecord | None:
    id_column = _find_column(NPC_FILENAME, members, labels, member="NPC.id")
    note_column = _find_column(NPC_FILENAME, members, labels, label="备注")
    name_column = _find_column(NPC_FILENAME, members, labels, member="NPC.name")
    resource_column = _find_column(
        NPC_FILENAME,
        members,
        labels,
        member="NPC.resource_id",
    )
    raw_id = _cell(row, id_column)
    if not raw_id:
        return None
    return NpcRecord(
        id=_parse_primary_id(NPC_FILENAME, row_number, raw_id),
        note=_cell(row, note_column),
        name=_cell(row, name_column),
        resource_id=_parse_optional_id(
            NPC_FILENAME,
            row_number,
            _cell(row, resource_column),
            "资源 ID",
        ),
        row_number=row_number,
    )


def _build_resource(
    members: list[str],
    labels: list[str],
    row: list[str],
    row_number: int,
) -> ResourceRecord | None:
    id_column = _find_column(RESOURCE_FILENAME, members, labels, member="Model.id")
    configured_path_column = _find_column(
        RESOURCE_FILENAME,
        members,
        labels,
        label_prefix="配置填写在此列",
    )
    raw_id = _cell(row, id_column)
    if not raw_id:
        return None
    return ResourceRecord(
        id=_parse_primary_id(RESOURCE_FILENAME, row_number, raw_id),
        configured_path=_cell(row, configured_path_column),
        row_number=row_number,
    )
