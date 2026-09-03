import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from config_linker.character_catalog import (
    CharacterCatalogCache,
    CharacterCatalogService,
    CharacterIndex,
    CharacterProfile,
    CharacterVisualAsset,
    CharacterVisuals,
    LarkCliBaseClient,
    NPC_TABLE_ID,
    ROLE_TABLE_ID,
    VISUAL_ASSET_TABLE_ID,
)


def _profile(
    *,
    record_id: str = "rec_role",
    name: str = "测试角色",
) -> CharacterProfile:
    return CharacterProfile(
        record_id=record_id,
        role_key=f"named:{name}",
        name=name,
        tags=("冷静", "谨慎"),
        summary="设定摘要",
        personality="性格分析",
        story="故事经历",
        evidence_level="中（3-19句）",
        analysis_status="已生成",
        dialogue_count=8,
    )


def _asset(
    kind: str = "avatar",
    resource_id: str = "9001",
) -> CharacterVisualAsset:
    return CharacterVisualAsset(
        kind=kind,
        resource_id=resource_id,
        record_id=f"rec_{kind}",
        file_token=f"token_{kind}",
        file_name=f"{kind}_{resource_id}.png",
    )


class CharacterCatalogCacheTests(unittest.TestCase):
    def test_index_and_reverse_npc_mapping_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = CharacterCatalogCache(Path(temp_dir) / "catalog.sqlite3")
            fetched_at = datetime.now(timezone.utc)
            profile = _profile()
            cache.replace_index(
                CharacterIndex((profile,), {100001: profile.record_id}, fetched_at)
            )

            self.assertEqual(cache.profile_for_npc(100001), profile)
            self.assertEqual(
                cache.npc_ids_for_character(profile.record_id),
                (100001,),
            )
            self.assertEqual(cache.profile_count(), 1)
            self.assertEqual(cache.index_fetched_at(), fetched_at)

    def test_visual_assets_round_trip_by_npc(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = CharacterCatalogCache(Path(temp_dir) / "catalog.sqlite3")
            visuals = CharacterVisuals(
                avatar=_asset(),
                portrait=_asset("portrait", "8001"),
            )
            cache.replace_index(
                CharacterIndex(
                    (_profile(),),
                    {100001: "rec_role"},
                    datetime.now(timezone.utc),
                    {100001: visuals},
                )
            )

            self.assertEqual(cache.visuals_for_npc(100001), visuals)
            self.assertEqual(
                cache.visuals_for_npc(999999),
                CharacterVisuals(),
            )

    def test_replacing_index_removes_stale_profiles_and_links(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = CharacterCatalogCache(Path(temp_dir) / "catalog.sqlite3")
            old_profile = _profile(record_id="rec_old", name="旧角色")
            now = datetime.now(timezone.utc)
            cache.replace_index(
                CharacterIndex((old_profile,), {1: old_profile.record_id}, now)
            )
            new_profile = _profile(record_id="rec_new", name="新角色")
            cache.replace_index(
                CharacterIndex((new_profile,), {2: new_profile.record_id}, now)
            )

            self.assertIsNone(cache.profile_for_npc(1))
            self.assertEqual(cache.npc_ids_for_character("rec_old"), ())
            self.assertEqual(cache.profile_for_npc(2), new_profile)


class FakeLarkClient(LarkCliBaseClient):
    def __init__(self, rows_by_table: dict[str, list[dict]]) -> None:
        super().__init__(
            cli_path=Path("unused"),
            sleeper=lambda _seconds: None,
            minimum_interval=0,
        )
        self.rows_by_table = rows_by_table

    def check_ready(self) -> None:
        return

    def _record_list(
        self,
        table_id: str,
        fields: tuple[str, ...],
        *,
        view_id: str | None = None,
        filter_json: dict | None = None,
    ) -> list[dict]:
        del fields, view_id, filter_json
        return self.rows_by_table.get(table_id, [])


class LarkCliBaseClientTests(unittest.TestCase):
    def test_login_device_flow_is_parsed_without_storing_tokens(self) -> None:
        calls: list[list[str]] = []

        def runner(
            args: list[str],
            _cwd: Path,
        ) -> subprocess.CompletedProcess[str]:
            calls.append(args)
            return subprocess.CompletedProcess(
                args,
                0,
                stdout=json.dumps(
                    {
                        "ok": True,
                        "data": {
                            "verification_url": "https://example.test/auth",
                            "device_code": "device-code",
                        },
                    }
                ),
                stderr="",
            )

        client = LarkCliBaseClient(
            cli_path=Path("unused"),
            runner=runner,
        )
        request = client.begin_login()

        self.assertEqual(request.verification_url, "https://example.test/auth")
        self.assertEqual(request.device_code, "device-code")
        self.assertIn("--domain", calls[0])
        self.assertEqual(calls[0][calls[0].index("--domain") + 1], "base")
        self.assertNotIn("--scope", calls[0])

    def test_index_keeps_only_active_named_profile_links(self) -> None:
        rows = {
            ROLE_TABLE_ID: [
                {
                    "record_id": "rec_named",
                    "角色键": "named:艾丽",
                    "角色名": "艾丽",
                    "性格标签": "冷静、谨慎",
                    "设定摘要": "摘要",
                    "性格分析": "分析",
                    "故事经历": "经历",
                    "证据等级": ["高（20句以上）"],
                    "分析状态": ["已生成"],
                    "台词数量": 30,
                    "源状态": ["有效"],
                },
                {
                    "record_id": "rec_stale",
                    "角色键": "named:旧角色",
                    "角色名": "旧角色",
                    "源状态": ["已失效"],
                },
            ],
            NPC_TABLE_ID: [
                {
                    "record_id": "rec_npc_named",
                    "NPC.id": "100002",
                    "关联角色": [{"id": "rec_named"}],
                    "源状态": ["有效"],
                },
                {
                    "record_id": "rec_npc_stale",
                    "NPC.id": "100003",
                    "关联角色": [{"id": "rec_stale"}],
                    "源状态": ["有效"],
                },
                {
                    "record_id": "rec_npc_ambiguous",
                    "NPC.id": "100004",
                    "关联角色": [
                        {"id": "rec_named"},
                        {"id": "rec_other"},
                    ],
                    "源状态": ["有效"],
                },
            ],
            VISUAL_ASSET_TABLE_ID: [
                {
                    "record_id": "rec_avatar",
                    "资源ID": "16",
                    "资源类型": ["圆形头像"],
                    "预览图": [
                        {
                            "file_token": "avatar-token",
                            "name": "head_16.png",
                        }
                    ],
                    "头像引用NPC": [{"id": "rec_npc_named"}],
                    "立绘引用NPC": [],
                    "源状态": ["有效"],
                },
                {
                    "record_id": "rec_portrait",
                    "资源ID": "100",
                    "资源类型": ["立绘"],
                    "预览图": [
                        {
                            "file_token": "portrait-token",
                            "name": "portrait_100.png",
                        }
                    ],
                    "头像引用NPC": [],
                    "立绘引用NPC": [{"id": "rec_npc_named"}],
                    "源状态": ["有效"],
                },
            ],
        }

        index = FakeLarkClient(rows).fetch_index()

        self.assertEqual([profile.name for profile in index.profiles], ["艾丽"])
        self.assertEqual(index.profiles[0].tags, ("冷静", "谨慎"))
        self.assertEqual(index.npc_links, {100002: "rec_named"})
        self.assertEqual(
            index.visuals_by_npc[100002].avatar.resource_id,
            "16",
        )
        self.assertEqual(
            index.visuals_by_npc[100002].portrait.resource_id,
            "100",
        )

    def test_record_list_follows_pagination_offsets(self) -> None:
        calls: list[list[str]] = []

        def runner(
            args: list[str],
            cwd: Path,
        ) -> subprocess.CompletedProcess[str]:
            calls.append(args)
            output = cwd / args[args.index("--output") + 1]
            offset = (
                int(args[args.index("--offset") + 1])
                if "--offset" in args
                else 0
            )
            rows = (
                [{"record_id": "rec_1"}, {"record_id": "rec_2"}]
                if offset == 0
                else [{"record_id": "rec_3"}]
            )
            output.write_text(
                "".join(json.dumps(row) + "\n" for row in rows),
                encoding="utf-8",
            )
            data = {
                "has_more": offset == 0,
                "next_offset": 2 if offset == 0 else 0,
            }
            return subprocess.CompletedProcess(
                args,
                0,
                stdout=json.dumps({"ok": True, "data": data}),
                stderr="",
            )

        client = LarkCliBaseClient(
            cli_path=Path("unused"),
            runner=runner,
            minimum_interval=0,
        )
        rows = client._record_list("tbl_test", ("Name",))

        self.assertEqual(
            [row["record_id"] for row in rows],
            ["rec_1", "rec_2", "rec_3"],
        )
        self.assertNotIn("--offset", calls[0])
        self.assertEqual(calls[1][calls[1].index("--offset") + 1], "2")

class CharacterCatalogServiceTests(unittest.TestCase):
    def test_cache_freshness(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache = CharacterCatalogCache(Path(temp_dir) / "catalog.sqlite3")
            service = CharacterCatalogService(
                cache,
                FakeLarkClient({ROLE_TABLE_ID: [], NPC_TABLE_ID: []}),
            )
            self.assertFalse(service.index_is_fresh())

            now = datetime.now(timezone.utc)
            cache.replace_index(CharacterIndex((_profile(),), {1: "rec_role"}, now))
            self.assertTrue(service.index_is_fresh())


if __name__ == "__main__":
    unittest.main()
