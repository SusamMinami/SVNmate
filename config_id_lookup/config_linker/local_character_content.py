from __future__ import annotations

import csv
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, TypeVar

from .character_catalog import (
    CharacterDetails,
    CharacterDialogue,
    CharacterStory,
    CharacterTask,
)


DIALOGUE_FILENAME = "对话表.csv"
DIALOG_START_FILENAME = "对话表_开始节点.csv"
MISSION_FILENAME = "任务表.csv"
REQUIRED_FILENAMES = (
    DIALOGUE_FILENAME,
    DIALOG_START_FILENAME,
    MISSION_FILENAME,
)


class LocalCharacterContentError(RuntimeError):
    """Raised when local character detail CSV files cannot be loaded."""


class LocalCharacterSchemaError(LocalCharacterContentError):
    """Raised when a required member field is missing."""


@dataclass(frozen=True)
class LocalCharacterContentReport:
    directory: Path
    loaded_at: datetime
    dialogue_count: int
    story_count: int
    task_count: int
    skipped_speaker_count: int = 0


@dataclass(frozen=True)
class _StoryRecord:
    story: CharacterStory
    start_id: str


T = TypeVar("T")


def _normalize_member(value: str) -> str:
    return value.strip().removeprefix("##&")


def _column_indexes(
    filename: str,
    members: list[str],
    required: tuple[str, ...],
) -> dict[str, int]:
    normalized = [_normalize_member(value) for value in members]
    result = {}
    for member in required:
        if member not in normalized:
            raise LocalCharacterSchemaError(
                f"{filename} 缺少必需字段：{member}"
            )
        result[member] = normalized.index(member)
    return result


def _cell(row: list[str], index: int) -> str:
    return row[index].strip() if index < len(row) else ""


def _read_records(
    path: Path,
    required: tuple[str, ...],
    build_record: Callable[[list[str], dict[str, int], int], T | None],
) -> list[T]:
    try:
        handle = path.open("r", encoding="utf-8-sig", newline="")
    except OSError as exc:
        raise LocalCharacterContentError(
            f"无法读取 {path.name}：{exc}"
        ) from exc
    with handle:
        reader = csv.reader(handle)
        try:
            members = next(reader)
            next(reader)
        except StopIteration as exc:
            raise LocalCharacterSchemaError(
                f"{path.name} 缺少双表头"
            ) from exc
        indexes = _column_indexes(path.name, members, required)
        records = []
        for row_number, row in enumerate(reader, start=3):
            if not any(value.strip() for value in row):
                continue
            record = build_record(row, indexes, row_number)
            if record is not None:
                records.append(record)
        return records


def _id_sort_key(value: str) -> tuple[int, int | str]:
    return (0, int(value)) if value.isdigit() else (1, value.casefold())


def _reference_tokens(value: str) -> tuple[str, ...]:
    return tuple(re.findall(r"(?<!\d)\d+(?!\d)", value))


class LocalCharacterContentRepository:
    def __init__(
        self,
        directory: Path,
        dialogues_by_npc_id: dict[int, list[CharacterDialogue]],
        stories_by_prefix: dict[str, list[_StoryRecord]],
        tasks_by_start_id: dict[str, list[CharacterTask]],
        report: LocalCharacterContentReport,
    ) -> None:
        self.directory = directory
        self.dialogues_by_npc_id = dialogues_by_npc_id
        self.stories_by_prefix = stories_by_prefix
        self.tasks_by_start_id = tasks_by_start_id
        self.report = report

    @classmethod
    def load(cls, directory: Path) -> "LocalCharacterContentRepository":
        directory = Path(directory)
        if not directory.is_dir():
            raise LocalCharacterContentError(
                f"角色内容目录不存在：{directory}"
            )
        for filename in REQUIRED_FILENAMES:
            if not (directory / filename).is_file():
                raise LocalCharacterContentError(
                    f"角色内容目录缺少文件：{filename}"
                )

        skipped_speakers = 0

        def build_dialogue(
            row: list[str],
            indexes: dict[str, int],
            _row_number: int,
        ) -> tuple[int, CharacterDialogue] | None:
            nonlocal skipped_speakers
            dialogue_id = _cell(row, indexes["Dialog.id"])
            content = _cell(row, indexes["Dialog.Content"])
            raw_npc_id = _cell(row, indexes["Dialog.NPCID"])
            if not dialogue_id or not content or not raw_npc_id:
                return None
            try:
                npc_id = int(raw_npc_id)
            except ValueError:
                skipped_speakers += 1
                return None
            if npc_id <= 0 or len(dialogue_id) < 4:
                skipped_speakers += 1
                return None
            return (
                npc_id,
                CharacterDialogue(
                    dialogue_id=dialogue_id,
                    task_prefix=dialogue_id[:4],
                    content=content,
                ),
            )

        dialogue_rows = _read_records(
            directory / DIALOGUE_FILENAME,
            ("Dialog.id", "Dialog.NPCID", "Dialog.Content"),
            build_dialogue,
        )
        dialogues_by_npc_id: dict[int, list[CharacterDialogue]] = defaultdict(
            list
        )
        for npc_id, dialogue in dialogue_rows:
            dialogues_by_npc_id[npc_id].append(dialogue)

        def build_story(
            row: list[str],
            indexes: dict[str, int],
            _row_number: int,
        ) -> _StoryRecord | None:
            start_id = _cell(row, indexes["DialogStart.id"])
            if len(start_id) < 4:
                return None
            return _StoryRecord(
                story=CharacterStory(
                    task_prefix=start_id[:4],
                    start_node_id=start_id,
                    outline=_cell(row, indexes["DialogStart.Outline"]),
                ),
                start_id=start_id,
            )

        story_rows = _read_records(
            directory / DIALOG_START_FILENAME,
            ("DialogStart.id", "DialogStart.Outline"),
            build_story,
        )
        stories_by_prefix: dict[str, list[_StoryRecord]] = defaultdict(list)
        start_ids = set()
        for story in story_rows:
            stories_by_prefix[story.story.task_prefix].append(story)
            start_ids.add(story.start_id)

        def build_mission(
            row: list[str],
            indexes: dict[str, int],
            _row_number: int,
        ) -> tuple[tuple[str, ...], CharacterTask] | None:
            task_id = _cell(row, indexes["Mission.id"])
            if not task_id:
                return None
            mission_type = _cell(row, indexes["Mission.MType"])
            references = set(
                _reference_tokens(
                    _cell(row, indexes["Mission.BubbleDialogIDs"])
                )
            )
            if mission_type == "0":
                references.update(
                    _reference_tokens(
                        _cell(row, indexes["Mission.Parameter3"])
                    )
                )
            elif mission_type == "13":
                references.update(
                    _reference_tokens(
                        _cell(row, indexes["Mission.Parameter1"])
                    )
                )
            references.intersection_update(start_ids)
            if not references:
                return None
            return (
                tuple(references),
                CharacterTask(
                    task_id=task_id,
                    name=_cell(row, indexes["Mission.Name"]),
                    description=_cell(row, indexes["Mission.Description"]),
                    task_type=mission_type,
                ),
            )

        mission_rows = _read_records(
            directory / MISSION_FILENAME,
            (
                "Mission.id",
                "Mission.Name",
                "Mission.MType",
                "Mission.Description",
                "Mission.BubbleDialogIDs",
                "Mission.Parameter1",
                "Mission.Parameter3",
            ),
            build_mission,
        )
        tasks_by_start_id: dict[str, list[CharacterTask]] = defaultdict(list)
        for references, task in mission_rows:
            for start_id in references:
                tasks_by_start_id[start_id].append(task)

        report = LocalCharacterContentReport(
            directory=directory,
            loaded_at=datetime.now(timezone.utc),
            dialogue_count=sum(
                len(dialogues)
                for dialogues in dialogues_by_npc_id.values()
            ),
            story_count=len(story_rows),
            task_count=len(
                {
                    task.task_id
                    for tasks in tasks_by_start_id.values()
                    for task in tasks
                }
            ),
            skipped_speaker_count=skipped_speakers,
        )
        return cls(
            directory,
            dict(dialogues_by_npc_id),
            dict(stories_by_prefix),
            dict(tasks_by_start_id),
            report,
        )

    def details_for_character(
        self,
        character_id: str,
        npc_ids: tuple[int, ...],
    ) -> CharacterDetails:
        dialogues_by_id: dict[str, CharacterDialogue] = {}
        for npc_id in npc_ids:
            for dialogue in self.dialogues_by_npc_id.get(npc_id, ()):
                dialogues_by_id[dialogue.dialogue_id] = dialogue
        dialogues = tuple(
            sorted(
                dialogues_by_id.values(),
                key=lambda item: _id_sort_key(item.dialogue_id),
            )
        )

        prefixes = {dialogue.task_prefix for dialogue in dialogues}
        story_records_by_id: dict[str, _StoryRecord] = {}
        for prefix in prefixes:
            for story in self.stories_by_prefix.get(prefix, ()):
                story_records_by_id[story.start_id] = story
        story_records = tuple(
            sorted(
                story_records_by_id.values(),
                key=lambda item: _id_sort_key(item.start_id),
            )
        )

        tasks_by_id: dict[str, CharacterTask] = {}
        for story in story_records:
            for task in self.tasks_by_start_id.get(story.start_id, ()):
                tasks_by_id[task.task_id] = task
        tasks = tuple(
            sorted(
                tasks_by_id.values(),
                key=lambda item: _id_sort_key(item.task_id),
            )
        )

        return CharacterDetails(
            character_id=character_id,
            tasks=tasks,
            dialogues=dialogues,
            stories=tuple(record.story for record in story_records),
            loaded_at=self.report.loaded_at,
        )
