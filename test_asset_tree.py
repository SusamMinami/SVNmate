import unittest

from migration_guard.asset_tree import (
    CHECKED,
    PARTIAL,
    UNCHECKED,
    AssetTreeSelection,
)
from migration_guard.batch_workflow import AssetMigrationItem


def _asset(package_name: str) -> AssetMigrationItem:
    name = package_name.rsplit("/", 1)[-1]
    return AssetMigrationItem(
        package_name=package_name,
        source_local_path=f"C:/source/{name}.uasset",
        target_local_path=f"D:/target/{name}.uasset",
        source_issues=("SERIA-10",),
        target_issues=("OSCOA-20",),
    )


class AssetTreeSelectionTests(unittest.TestCase):
    def test_builds_package_hierarchy_and_selects_all(self) -> None:
        model = AssetTreeSelection(
            (
                _asset("/Game/Seria/AI/Robot/A"),
                _asset("/Game/Seria/AI/Robot/B"),
                _asset("/Game/Seria/UI/C"),
            )
        )

        self.assertEqual(len(model.root_ids), 1)
        self.assertEqual(
            model.nodes[model.root_ids[0]].name,
            "Game",
        )
        self.assertEqual(
            model.selected_packages(),
            (
                "/Game/Seria/AI/Robot/A",
                "/Game/Seria/AI/Robot/B",
                "/Game/Seria/UI/C",
            ),
        )
        self.assertEqual(
            model.state(model.node_id_for_path("/Game/Seria")),
            CHECKED,
        )

    def test_folder_toggle_updates_descendants_and_parent_state(self) -> None:
        model = AssetTreeSelection(
            (
                _asset("/Game/Seria/AI/Robot/A"),
                _asset("/Game/Seria/AI/Robot/B"),
                _asset("/Game/Seria/UI/C"),
            )
        )
        robot = model.node_id_for_path("/Game/Seria/AI/Robot")
        ai = model.node_id_for_path("/Game/Seria/AI")
        seria = model.node_id_for_path("/Game/Seria")

        model.toggle(robot)

        self.assertEqual(model.state(robot), UNCHECKED)
        self.assertEqual(model.state(ai), UNCHECKED)
        self.assertEqual(model.state(seria), PARTIAL)
        self.assertEqual(
            model.selected_packages(),
            ("/Game/Seria/UI/C",),
        )

        model.toggle(ai)

        self.assertEqual(model.state(ai), CHECKED)
        self.assertEqual(model.state(seria), CHECKED)

    def test_clear_and_select_all_preserve_package_order(self) -> None:
        model = AssetTreeSelection(
            (
                _asset("/Game/Z"),
                _asset("/Game/A"),
            )
        )

        model.clear()
        self.assertEqual(model.selected_packages(), ())
        self.assertEqual(model.state(model.root_ids[0]), UNCHECKED)

        model.select_all()
        self.assertEqual(
            model.selected_packages(),
            ("/Game/Z", "/Game/A"),
        )


if __name__ == "__main__":
    unittest.main()
