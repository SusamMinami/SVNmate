import tempfile
import unittest
from pathlib import Path

from config_linker.weapon_icon_catalog import (
    WeaponIconCatalogCache,
    WeaponIconCatalogService,
)


class FakeLarkClient:
    def __init__(self) -> None:
        self.ready_checks = 0
        self.downloads: list[tuple[str, str, str, Path]] = []

    def check_ready(self) -> None:
        self.ready_checks += 1

    def list_records(
        self,
        _table_id: str,
        _fields: tuple[str, ...],
        **_kwargs,
    ) -> list[dict]:
        return [
            {
                "record_id": "rec_active",
                "图标ID": "201572",
                "预览图": [
                    {
                        "file_token": "token-active",
                        "name": "weapon_icon_201572.png",
                    }
                ],
                "导出状态": ["已导出"],
                "源状态": ["有效"],
            },
            {
                "record_id": "rec_pending",
                "图标ID": "201573",
                "预览图": [],
                "导出状态": ["待导出"],
                "源状态": ["有效"],
            },
            {
                "record_id": "rec_duplicate",
                "图标ID": "201572",
                "预览图": [
                    {
                        "file_token": "token-duplicate",
                        "name": "weapon_icon_201572.exe",
                    }
                ],
                "导出状态": ["已导出"],
                "源状态": ["有效"],
            },
        ]

    def download_record_attachment(
        self,
        table_id: str,
        record_id: str,
        file_token: str,
        destination: Path,
        *,
        resource_label: str,
    ) -> Path:
        del resource_label
        self.downloads.append(
            (table_id, record_id, file_token, destination)
        )
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"png")
        return destination


class WeaponIconCatalogTests(unittest.TestCase):
    def test_refresh_keeps_only_active_exported_icons(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = WeaponIconCatalogCache(Path(temp_dir) / "icons.sqlite3")
            client = FakeLarkClient()
            service = WeaponIconCatalogService(cache, client)

            index = service.refresh_index()

            self.assertEqual(client.ready_checks, 1)
            self.assertEqual([asset.icon_id for asset in index.assets], [201572])
            self.assertEqual(cache.count(), 1)
            self.assertTrue(service.index_is_fresh())
            self.assertIsNone(service.asset_for_icon(201573))
            self.assertEqual(
                service.asset_for_icon(201572).record_id,
                "rec_active",
            )
            self.assertEqual(
                service.asset_path(service.asset_for_icon(201572)).suffix,
                ".png",
            )

    def test_ensure_icon_downloads_once_then_reuses_cache(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = WeaponIconCatalogCache(Path(temp_dir) / "icons.sqlite3")
            client = FakeLarkClient()
            service = WeaponIconCatalogService(cache, client)
            service.refresh_index()

            first = service.ensure_icon(201572)
            second = service.ensure_icon(201572)

            self.assertEqual(first, second)
            self.assertIsNotNone(first)
            self.assertTrue(first.is_file())
            self.assertEqual(len(client.downloads), 1)


if __name__ == "__main__":
    unittest.main()
