import csv
from pathlib import Path
from typing import Iterable, Sequence


TARGET_MEMBER_ROW = [
    "##&MissionPosition.ID",
    "",
    "",
    "MissionPosition.type",
    "MissionPosition.NPCID",
    "MissionPosition.Position",
    "MissionPosition.Rotation",
]
TARGET_LABEL_ROW = ["##ID", "类型", "描述", "坐标类型", "NPCID", "坐标", "旋转"]

NPC_MEMBER_ROW = ["##&NPC.id", "", "NPC.name", "NPC.resource_id"]
NPC_LABEL_ROW = ["##id", "备注", "NPC名字", "资源id"]

RESOURCE_MEMBER_ROW = ["##&Model.id", "", "Model.path"]
RESOURCE_LABEL_ROW = [
    "##id",
    "配置填写在此列，Model.path保存时自动生成，由程序调用",
    "ID段规划",
]


def _write_table(
    path: Path,
    member_row: Sequence[str],
    label_row: Sequence[str],
    rows: Iterable[Sequence[object]],
) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(member_row)
        writer.writerow(label_row)
        writer.writerows(rows)


def write_fixture(
    directory: Path,
    *,
    target_rows: list[list[object]] | None = None,
    npc_rows: list[list[object]] | None = None,
    resource_rows: list[list[object]] | None = None,
) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    _write_table(
        directory / "m目标物表.csv",
        TARGET_MEMBER_ROW,
        TARGET_LABEL_ROW,
        target_rows
        if target_rows is not None
        else [
            [
                1001,
                "交互物",
                "目标A",
                3,
                2001,
                "(X=1,Y=2,Z=3)",
                "(Pitch=0,Yaw=90,Roll=0)",
            ],
            [1002, "交互物", "目标B", 3, 2001, "", ""],
            [1003, "区域", "目标C", 2, 2002, "", ""],
            [1004, "区域", "无NPC目标", 2, 0, "", ""],
            [1005, "区域", "特殊NPC目标", 2, -1, "", ""],
        ],
    )
    _write_table(
        directory / "NPC表.csv",
        NPC_MEMBER_ROW,
        NPC_LABEL_ROW,
        npc_rows
        if npc_rows is not None
        else [
            [2001, "主城NPC", "测试NPC甲", 3001],
            [2002, "活动NPC", "测试NPC乙", 3001],
            [2003, "断链NPC", "测试NPC丙", 3999],
        ],
    )
    _write_table(
        directory / "m模型资源表.csv",
        RESOURCE_MEMBER_ROW,
        RESOURCE_LABEL_ROW,
        resource_rows
        if resource_rows is not None
        else [
            [
                3001,
                "/Game/Test/含逗号,路径\n第二行",
                "/Game/Test/BP_Test.BP_Test_C",
            ],
        ],
    )
