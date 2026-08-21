from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path


class QueryKind(str, Enum):
    TARGET = "target"
    NPC = "npc"
    NPC_NAME = "npc_name"
    RESOURCE = "resource"


@dataclass(frozen=True)
class QueryKey:
    kind: QueryKind
    value: int | str


@dataclass(frozen=True)
class TargetRecord:
    id: int
    target_type: str
    description: str
    npc_id: int | None
    row_number: int
    position: str = ""
    rotation: str = ""


@dataclass(frozen=True)
class NpcRecord:
    id: int
    note: str
    name: str
    resource_id: int | None
    row_number: int


@dataclass(frozen=True)
class ResourceRecord:
    id: int
    configured_path: str
    row_number: int


@dataclass(frozen=True)
class LoadReport:
    directory: Path
    loaded_at: datetime
    target_count: int
    npc_count: int
    resource_count: int
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class QueryResult:
    key: QueryKey
    targets: tuple[TargetRecord, ...]
    npcs: tuple[NpcRecord, ...]
    resources: tuple[ResourceRecord, ...]
    warnings: tuple[str, ...] = ()
