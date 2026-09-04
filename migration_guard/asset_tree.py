from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from .batch_workflow import AssetMigrationItem
from .remote_asset_progress import RemoteAssetProgress


CHECKED = "checked"
PARTIAL = "partial"
UNCHECKED = "unchecked"


@dataclass
class AssetTreeNode:
    node_id: str
    name: str
    path: str
    parent_id: str
    package_name: str = ""
    source_issues: tuple[str, ...] = ()
    target_issues: tuple[str, ...] = ()
    children: list[str] = field(default_factory=list)

    @property
    def is_asset(self) -> bool:
        return bool(self.package_name)


class AssetTreeSelection:
    def __init__(self, assets: Iterable[AssetMigrationItem]) -> None:
        self.nodes: dict[str, AssetTreeNode] = {}
        self.root_ids: list[str] = []
        self._path_nodes: dict[str, str] = {}
        self._package_order: list[str] = []
        self._leaf_by_package: dict[str, str] = {}
        self._selected: set[str] = set()
        self._next_id = 0
        for asset in assets:
            self._add_asset(asset)
        self.select_all()

    def _add_asset(self, asset: AssetMigrationItem) -> None:
        package_name = asset.package_name.strip()
        parts = [part for part in package_name.strip("/").split("/") if part]
        if not parts:
            return
        parent_id = ""
        current_path = ""
        for part in parts[:-1]:
            current_path += "/" + part
            node_id = self._path_nodes.get(current_path.casefold())
            if node_id is None:
                node_id = self._new_id()
                self.nodes[node_id] = AssetTreeNode(
                    node_id=node_id,
                    name=part,
                    path=current_path,
                    parent_id=parent_id,
                )
                self._path_nodes[current_path.casefold()] = node_id
                if parent_id:
                    self.nodes[parent_id].children.append(node_id)
                else:
                    self.root_ids.append(node_id)
            parent_id = node_id

        package_key = package_name.casefold()
        if package_key in self._leaf_by_package:
            return
        leaf_id = self._new_id()
        self.nodes[leaf_id] = AssetTreeNode(
            node_id=leaf_id,
            name=parts[-1],
            path=package_name,
            parent_id=parent_id,
            package_name=package_name,
            source_issues=asset.source_issues,
            target_issues=asset.target_issues,
        )
        self._leaf_by_package[package_key] = leaf_id
        self._package_order.append(package_name)
        if parent_id:
            self.nodes[parent_id].children.append(leaf_id)
        else:
            self.root_ids.append(leaf_id)

    def _new_id(self) -> str:
        node_id = f"asset-tree-{self._next_id}"
        self._next_id += 1
        return node_id

    def node_id_for_path(self, path: str) -> str:
        key = path.casefold()
        if key in self._path_nodes:
            return self._path_nodes[key]
        return self._leaf_by_package.get(key, "")

    def state(self, node_id: str) -> str:
        node = self.nodes[node_id]
        if node.is_asset:
            return (
                CHECKED
                if node.package_name.casefold() in self._selected
                else UNCHECKED
            )
        packages = self.descendant_packages(node_id)
        selected_count = sum(
            package.casefold() in self._selected
            for package in packages
        )
        if selected_count == 0:
            return UNCHECKED
        if selected_count == len(packages):
            return CHECKED
        return PARTIAL

    def toggle(self, node_id: str) -> None:
        node = self.nodes[node_id]
        packages = (
            (node.package_name,)
            if node.is_asset
            else self.descendant_packages(node_id)
        )
        if self.state(node_id) == CHECKED:
            for package in packages:
                self._selected.discard(package.casefold())
        else:
            for package in packages:
                self._selected.add(package.casefold())

    def select_all(self) -> None:
        self._selected = {
            package.casefold()
            for package in self._package_order
        }

    def clear(self) -> None:
        self._selected.clear()

    def selected_packages(self) -> tuple[str, ...]:
        return tuple(
            package
            for package in self._package_order
            if package.casefold() in self._selected
        )

    def selected_folder_count(self) -> int:
        return len(
            {
                self.nodes[self._leaf_by_package[package.casefold()]].parent_id
                for package in self.selected_packages()
                if self.nodes[
                    self._leaf_by_package[package.casefold()]
                ].parent_id
            }
        )

    def descendant_packages(self, node_id: str) -> tuple[str, ...]:
        result = []
        pending = [node_id]
        while pending:
            current_id = pending.pop()
            current = self.nodes[current_id]
            if current.is_asset:
                result.append(current.package_name)
                continue
            pending.extend(reversed(current.children))
        return tuple(result)

    def asset_count(self, node_id: str) -> int:
        return len(self.descendant_packages(node_id))


@dataclass
class AssetProgressTreeNode:
    node_id: str
    name: str
    path: str
    parent_id: str
    asset_index: int | None = None
    children: list[str] = field(default_factory=list)

    @property
    def is_asset(self) -> bool:
        return self.asset_index is not None


class AssetProgressTree:
    def __init__(self, assets: Iterable[RemoteAssetProgress]) -> None:
        self.assets = tuple(assets)
        self.nodes: dict[str, AssetProgressTreeNode] = {}
        self.root_ids: list[str] = []
        self._path_nodes: dict[str, str] = {}
        self._next_id = 0
        for index, asset in enumerate(self.assets):
            self._add_asset(index, asset)

    def _add_asset(
        self,
        asset_index: int,
        asset: RemoteAssetProgress,
    ) -> None:
        parts = [
            part
            for part in asset.display_path.replace("\\", "/").split("/")
            if part
        ]
        if not parts:
            return
        parent_id = ""
        current_path = ""
        for part in parts[:-1]:
            current_path += "/" + part
            key = current_path.casefold()
            node_id = self._path_nodes.get(key)
            if node_id is None:
                node_id = self._new_id()
                self.nodes[node_id] = AssetProgressTreeNode(
                    node_id=node_id,
                    name=part,
                    path=current_path,
                    parent_id=parent_id,
                )
                self._path_nodes[key] = node_id
                if parent_id:
                    self.nodes[parent_id].children.append(node_id)
                else:
                    self.root_ids.append(node_id)
            parent_id = node_id
        leaf_id = self._new_id()
        self.nodes[leaf_id] = AssetProgressTreeNode(
            node_id=leaf_id,
            name=parts[-1],
            path=asset.display_path,
            parent_id=parent_id,
            asset_index=asset_index,
        )
        if parent_id:
            self.nodes[parent_id].children.append(leaf_id)
        else:
            self.root_ids.append(leaf_id)

    def _new_id(self) -> str:
        node_id = f"progress-tree-{self._next_id}"
        self._next_id += 1
        return node_id

    def asset_for_node(
        self,
        node_id: str,
    ) -> RemoteAssetProgress | None:
        node = self.nodes.get(node_id)
        if node is None or node.asset_index is None:
            return None
        return self.assets[node.asset_index]

    def descendant_assets(
        self,
        node_id: str,
    ) -> tuple[RemoteAssetProgress, ...]:
        result = []
        pending = [node_id]
        while pending:
            current = self.nodes[pending.pop()]
            if current.asset_index is not None:
                result.append(self.assets[current.asset_index])
            else:
                pending.extend(reversed(current.children))
        return tuple(result)

    def stage_label(self, node_id: str, stage: str) -> str:
        node = self.nodes[node_id]
        if node.asset_index is not None:
            evidence = getattr(self.assets[node.asset_index], stage)
            return evidence.short_label
        assets = self.descendant_assets(node_id)
        done = sum(
            getattr(asset, stage).present
            for asset in assets
        )
        return f"{done}/{len(assets)}"

    def stage(self, node_id: str) -> str:
        assets = self.descendant_assets(node_id)
        if not assets:
            return "empty"
        if any(asset.has_action_mismatch for asset in assets):
            return "warning"
        if all(asset.osob.present for asset in assets):
            return "osob"
        if all(asset.overseas_trunk.present for asset in assets):
            return "overseas_trunk"
        if all(asset.domestic.present for asset in assets):
            return "domestic"
        return "partial"
