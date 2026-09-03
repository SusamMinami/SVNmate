from collections.abc import Iterable
from typing import TypeVar

from .weapon_models import (
    CareerRecord,
    WeaponDetails,
    WeaponRecord,
    WeaponSearchResult,
)
from .weapon_repository import WeaponRepository


class WeaponNotFoundError(LookupError):
    """Raised when a weapon query has no matching records."""


T = TypeVar("T")


def _unique(records: Iterable[T], key) -> tuple[T, ...]:
    result: list[T] = []
    seen: set[object] = set()
    for record in records:
        record_key = key(record)
        if record_key in seen:
            continue
        seen.add(record_key)
        result.append(record)
    return tuple(result)


def _weapon_key(record: WeaponRecord) -> tuple[int, int]:
    return record.id, record.row_number


def _weapon_sort_key(record: WeaponRecord) -> tuple[int, str, int]:
    return record.id, record.name, record.row_number


class WeaponQueryService:
    def __init__(self, repository: WeaponRepository) -> None:
        self.repository = repository

    def search(self, query: str) -> WeaponSearchResult:
        query = query.strip()
        if not query:
            raise ValueError("请输入武器名称或 ID")

        warnings: list[str] = []
        match_kinds: list[str] = []
        weapons: list[WeaponRecord] = []

        try:
            numeric_query = int(query)
        except ValueError:
            numeric_query = None

        if numeric_query is None:
            weapons.extend(self.repository.find_weapons_by_name(query))
            if weapons:
                match_kinds.append("武器名称")
        else:
            direct_weapons = self.repository.weapons_by_id.get(numeric_query, [])
            if direct_weapons:
                match_kinds.append("装备 ID")
                weapons.extend(direct_weapons)

            groups = self.repository.groups_by_id.get(numeric_query, [])
            if groups:
                match_kinds.append("转换组 ID")
                for group in groups:
                    for equipment_id in group.equipment_ids:
                        linked_weapons = self.repository.weapons_by_id.get(
                            equipment_id,
                            [],
                        )
                        if not linked_weapons:
                            warnings.append(
                                f"转换组 {group.id} 引用的装备 ID "
                                f"{equipment_id} 未找到"
                            )
                        weapons.extend(linked_weapons)

            model_weapons = self.repository.weapons_by_model_id.get(
                numeric_query,
                [],
            )
            if model_weapons:
                match_kinds.append("模型 ID")
                weapons.extend(model_weapons)

        unique_weapons = _unique(weapons, _weapon_key)
        if not unique_weapons:
            raise WeaponNotFoundError(f"未找到“{query}”对应的武器")
        return WeaponSearchResult(
            query=query,
            weapons=unique_weapons,
            match_kinds=tuple(match_kinds),
            warnings=tuple(dict.fromkeys(warnings)),
        )

    def details(self, weapon: WeaponRecord) -> WeaponDetails:
        warnings: list[str] = []
        careers: list[CareerRecord] = []
        for career_id in weapon.career_ids:
            linked_careers = self.repository.careers_by_id.get(career_id, [])
            if not linked_careers:
                warnings.append(f"职业 ID {career_id} 未找到")
            careers.extend(linked_careers)

        groups = list(
            self.repository.groups_by_equipment_id.get(weapon.id, [])
        )
        if not groups:
            warnings.append("该武器不属于任何武器转换组")

        appearances = []
        if weapon.model_id is not None and weapon.model_id > 0:
            appearances.extend(
                self.repository.appearances_by_id.get(weapon.model_id, [])
            )
            if not appearances:
                warnings.append(f"武器模型 ID {weapon.model_id} 未找到")
        else:
            warnings.append("该武器未配置武器模型")

        same_group_weapons: list[WeaponRecord] = []
        for group in groups:
            for equipment_id in group.equipment_ids:
                if equipment_id != weapon.id:
                    same_group_weapons.extend(
                        self.repository.weapons_by_id.get(equipment_id, [])
                    )

        same_career_weapons: list[WeaponRecord] = []
        for career_id in weapon.career_ids:
            for linked_weapon in self.repository.weapons_by_career_id.get(
                career_id,
                [],
            ):
                if (
                    linked_weapon.id != weapon.id
                    and linked_weapon.id
                    in self.repository.groups_by_equipment_id
                ):
                    same_career_weapons.append(linked_weapon)

        same_model_weapons = (
            [
                linked_weapon
                for linked_weapon in self.repository.weapons_by_model_id.get(
                    weapon.model_id,
                    [],
                )
                if linked_weapon.id != weapon.id
            ]
            if weapon.model_id is not None and weapon.model_id > 0
            else []
        )

        return WeaponDetails(
            weapon=weapon,
            careers=_unique(careers, lambda record: (record.id, record.row_number)),
            groups=tuple(groups),
            appearances=tuple(appearances),
            same_group_weapons=tuple(
                sorted(
                    _unique(same_group_weapons, _weapon_key),
                    key=_weapon_sort_key,
                )
            ),
            same_career_weapons=tuple(
                sorted(
                    _unique(same_career_weapons, _weapon_key),
                    key=_weapon_sort_key,
                )
            ),
            same_model_weapons=tuple(
                sorted(
                    _unique(same_model_weapons, _weapon_key),
                    key=_weapon_sort_key,
                )
            ),
            warnings=tuple(dict.fromkeys(warnings)),
        )
