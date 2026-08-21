import csv
import tempfile
import unittest
from pathlib import Path

from config_linker.local_character_content import (
    DIALOGUE_FILENAME,
    DIALOG_START_FILENAME,
    MISSION_FILENAME,
    LocalCharacterContentError,
    LocalCharacterContentRepository,
)


def _write_csv(
    path: Path,
    members: list[str],
    labels: list[str],
    rows: list[list[object]],
) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(members)
        writer.writerow(labels)
        writer.writerows(rows)


def write_character_content_fixture(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    _write_csv(
        directory / DIALOGUE_FILENAME,
        ["##&Dialog.id", "Dialog.NPCID", "Dialog.Content"],
        ["##对话ID", "人物", "对话内容"],
        [
            ["100101", "1", "第一句"],
            ["100102", "2", "同角色另一实例"],
            ["200101", "1", "第二段剧情"],
            ["300101", "3", "其他角色"],
            ["400101", "not-an-id", "无效说话人"],
            ["500101", "1", ""],
        ],
    )
    _write_csv(
        directory / DIALOG_START_FILENAME,
        ["##&DialogStart.id", "DialogStart.Outline"],
        ["##对话ID", "剧情梗概"],
        [
            ["100100", "第一段剧情"],
            ["200100", "第二段剧情"],
            ["300100", "其他剧情"],
        ],
    )
    _write_csv(
        directory / MISSION_FILENAME,
        [
            "##&Mission.id",
            "Mission.Name",
            "Mission.MType",
            "Mission.Description",
            "Mission.BubbleDialogIDs",
            "Mission.Parameter1",
            "Mission.Parameter3",
        ],
        [
            "##任务ID",
            "任务名称",
            "任务内容",
            "任务描述",
            "冒泡对话ID",
            "参数1",
            "参数3",
        ],
        [
            ["10", "参数3任务", "0", "找到第一段", "", "", "100100"],
            ["2", "参数1任务", "13", "找到第二段", "", "200100", ""],
            ["30", "冒泡任务", "5", "显式冒泡", "100100;200100", "", ""],
            ["40", "错误参数", "5", "不得关联", "", "", "100100"],
            ["50", "错误参数位", "0", "不得关联", "", "100100", ""],
            ["60", "其他角色任务", "0", "不得出现", "", "", "300100"],
        ],
    )


class LocalCharacterContentTests(unittest.TestCase):
    def test_combines_npc_instances_and_builds_validated_relations(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            write_character_content_fixture(directory)

            repository = LocalCharacterContentRepository.load(directory)
            details = repository.details_for_character(
                "rec_role",
                (1, 2),
            )

            self.assertEqual(
                [item.dialogue_id for item in details.dialogues],
                ["100101", "100102", "200101"],
            )
            self.assertEqual(
                [item.start_node_id for item in details.stories],
                ["100100", "200100"],
            )
            self.assertEqual(
                [item.task_id for item in details.tasks],
                ["2", "10", "30"],
            )
            self.assertEqual(details.tasks[0].name, "参数1任务")
            self.assertNotIn(
                "错误参数",
                [item.name for item in details.tasks],
            )
            self.assertEqual(repository.report.skipped_speaker_count, 1)

    def test_quoted_multiline_dialogue_uses_csv_parser(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            write_character_content_fixture(directory)
            path = directory / DIALOGUE_FILENAME
            with path.open(
                "a",
                encoding="utf-8-sig",
                newline="",
            ) as handle:
                csv.writer(handle).writerow(
                    ["100103", "1", "包含,逗号\n以及换行"]
                )

            repository = LocalCharacterContentRepository.load(directory)
            details = repository.details_for_character("rec_role", (1,))

            contents = {
                item.dialogue_id: item.content
                for item in details.dialogues
            }
            self.assertEqual(
                contents["100103"],
                "包含,逗号\n以及换行",
            )

    def test_missing_detail_file_does_not_have_ambiguous_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            write_character_content_fixture(directory)
            (directory / MISSION_FILENAME).unlink()

            with self.assertRaisesRegex(
                LocalCharacterContentError,
                MISSION_FILENAME,
            ):
                LocalCharacterContentRepository.load(directory)


if __name__ == "__main__":
    unittest.main()
