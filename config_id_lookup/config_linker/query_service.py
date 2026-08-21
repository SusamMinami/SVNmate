from collections.abc import Iterable
from typing import TypeVar

from .models import (
    NpcRecord,
    QueryKey,
    QueryKind,
    QueryResult,
    ResourceRecord,
    TargetRecord,
)
from .repository import CsvRepository


class NotFoundError(LookupError):
    """Raised when the query's focus ID does not exist."""


T = TypeVar("T", TargetRecord, NpcRecord, ResourceRecord)


def _unique(records: Iterable[T]) -> tuple[T, ...]:
    result: list[T] = []
    seen: set[tuple[int, int]] = set()
    for record in records:
        key = (record.id, record.row_number)
        if key not in seen:
            seen.add(key)
            result.append(record)
    return tuple(result)


def _reference_for_lookup(
    value: int | None,
    label: str,
    owner: str,
    warnings: list[str],
) -> int | None:
    if value is None:
        warnings.append(f"{owner} 未填写 {label}")
        return None
    if value == 0:
        warnings.append(f"{owner} 的 {label} 为 0，按未配置处理")
        return None
    if value < 0:
        warnings.append(f"{owner} 的 {label} 为 {value}，按特殊值处理")
        return None
    return value


class QueryService:
    def __init__(self, repository: CsvRepository) -> None:
        self.repository = repository

    def search(self, key: QueryKey) -> QueryResult:
        if key.kind == QueryKind.TARGET:
            return self._search_target(key)
        if key.kind == QueryKind.NPC:
            return self._search_npc(key)
        if key.kind == QueryKind.NPC_NAME:
            return self._search_npc_name(key)
        if key.kind == QueryKind.RESOURCE:
            return self._search_resource(key)
        raise ValueError(f"不支持的查询类型：{key.kind}")

    def _search_target(self, key: QueryKey) -> QueryResult:
        focus_targets = self.repository.targets_by_id.get(key.value, [])
        if not focus_targets:
            raise NotFoundError(f"目标物 ID {key.value} 未找到")

        warnings: list[str] = []
        targets: list[TargetRecord] = list(focus_targets)
        npcs: list[NpcRecord] = []
        resources: list[ResourceRecord] = []

        for target in focus_targets:
            npc_id = _reference_for_lookup(
                target.npc_id,
                "NPC ID",
                f"目标物 ID {target.id}",
                warnings,
            )
            if npc_id is None:
                continue
            targets.extend(self.repository.targets_by_npc_id.get(npc_id, []))
            linked_npcs = self.repository.npcs_by_id.get(npc_id, [])
            if not linked_npcs:
                warnings.append(f"NPC ID {npc_id} 未找到")
                continue
            npcs.extend(linked_npcs)
            for npc in linked_npcs:
                resource_id = _reference_for_lookup(
                    npc.resource_id,
                    "资源 ID",
                    f"NPC ID {npc.id}",
                    warnings,
                )
                if resource_id is None:
                    continue
                linked_resources = self.repository.resources_by_id.get(resource_id, [])
                if not linked_resources:
                    warnings.append(f"资源 ID {resource_id} 未找到")
                resources.extend(linked_resources)

        return QueryResult(
            key=key,
            targets=_unique(targets),
            npcs=_unique(npcs),
            resources=_unique(resources),
            warnings=tuple(dict.fromkeys(warnings)),
        )

    def _search_npc_name(self, key: QueryKey) -> QueryResult:
        query = str(key.value).strip()
        focus_npcs = self.repository.find_npcs_by_name(query)
        if not focus_npcs:
            raise NotFoundError(f"NPC 名称“{query}”未找到")

        warnings: list[str] = []
        targets: list[TargetRecord] = []
        resources: list[ResourceRecord] = []

        for npc in focus_npcs:
            linked_targets = self.repository.targets_by_npc_id.get(npc.id, [])
            if not linked_targets:
                warnings.append(f"没有目标物使用 NPC ID {npc.id}")
            targets.extend(linked_targets)

            resource_id = _reference_for_lookup(
                npc.resource_id,
                "资源 ID",
                f"NPC ID {npc.id}",
                warnings,
            )
            if resource_id is None:
                continue
            linked_resources = self.repository.resources_by_id.get(resource_id, [])
            if not linked_resources:
                warnings.append(f"资源 ID {resource_id} 未找到")
            resources.extend(linked_resources)

        return QueryResult(
            key=key,
            targets=_unique(targets),
            npcs=_unique(focus_npcs),
            resources=_unique(resources),
            warnings=tuple(dict.fromkeys(warnings)),
        )

    def _search_npc(self, key: QueryKey) -> QueryResult:
        focus_npcs = self.repository.npcs_by_id.get(key.value, [])
        if not focus_npcs:
            raise NotFoundError(f"NPC ID {key.value} 未找到")

        warnings: list[str] = []
        targets = list(self.repository.targets_by_npc_id.get(key.value, []))
        if not targets:
            warnings.append(f"没有目标物使用 NPC ID {key.value}")
        npcs: list[NpcRecord] = list(focus_npcs)
        resources: list[ResourceRecord] = []

        for npc in focus_npcs:
            resource_id = _reference_for_lookup(
                npc.resource_id,
                "资源 ID",
                f"NPC ID {npc.id}",
                warnings,
            )
            if resource_id is None:
                continue
            npcs.extend(self.repository.npcs_by_resource_id.get(resource_id, []))
            linked_resources = self.repository.resources_by_id.get(resource_id, [])
            if not linked_resources:
                warnings.append(f"资源 ID {resource_id} 未找到")
            resources.extend(linked_resources)

        return QueryResult(
            key=key,
            targets=_unique(targets),
            npcs=_unique(npcs),
            resources=_unique(resources),
            warnings=tuple(dict.fromkeys(warnings)),
        )

    def _search_resource(self, key: QueryKey) -> QueryResult:
        focus_resources = self.repository.resources_by_id.get(key.value, [])
        if not focus_resources:
            raise NotFoundError(f"模型资源 ID {key.value} 未找到")

        warnings: list[str] = []
        npcs = list(self.repository.npcs_by_resource_id.get(key.value, []))
        if not npcs:
            warnings.append(f"没有 NPC 使用资源 ID {key.value}")
        targets: list[TargetRecord] = []
        for npc in npcs:
            linked_targets = self.repository.targets_by_npc_id.get(npc.id, [])
            if not linked_targets:
                warnings.append(f"没有目标物使用 NPC ID {npc.id}")
            targets.extend(linked_targets)

        return QueryResult(
            key=key,
            targets=_unique(targets),
            npcs=_unique(npcs),
            resources=_unique(focus_resources),
            warnings=tuple(dict.fromkeys(warnings)),
        )
