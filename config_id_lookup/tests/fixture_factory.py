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

EQUIPMENT_MEMBER_ROW = [
    "##&字段标记",
    "ItemAttr.id",
    "ItemAttr.name",
    "",
    "EquipAttr.equiplv",
    "EquipAttr.wearlv",
    "EquipAttr.part",
    "EquipAttr.partname",
    "EquipAttr.careerlimit",
    "EquipAttr.careertext",
    "EquipAttr.recommendcareer",
    "EquipAttr.weaponmesh",
    "ItemAttr.txtdes",
    "ItemAttr.icon",
]
EQUIPMENT_LABEL_ROW = [
    "##物品类型",
    "id",
    "名字",
    "备注名称",
    "等级",
    "穿戴等级",
    "部位",
    "部位名字",
    "职业限制",
    "职业",
    "推荐职业",
    "武器模型",
    "道具描述",
    "图标",
]

WEAPON_GROUP_MEMBER_ROW = [
    "##&WeaponConvert.id",
    "",
    "WeaponConvert.equip",
    "",
    "",
    "",
    "WeaponConvert.isopen",
    "WeaponConvert.preyweapontype",
]
WEAPON_GROUP_LABEL_ROW = [
    "##id",
    "备注名称",
    "装备ID",
    "装备1",
    "装备2",
    "装备ID}",
    "是否开启",
    "祈愿武器类型组",
]

WEAPON_APPEARANCE_MEMBER_ROW = [
    "##&Weaponappearance.id",
    "",
    "Weaponappearance.path",
]
WEAPON_APPEARANCE_LABEL_ROW = ["##武器模型id", "备注", "模型路径"]

CAREER_MEMBER_ROW = ["##&CareerInfor.id", "CareerInfor.name"]
CAREER_LABEL_ROW = ["##职业id", "职业名"]


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


def write_weapon_fixture(
    doc_directory: Path,
    *,
    equipment_rows: list[list[object]] | None = None,
    group_rows: list[list[object]] | None = None,
) -> None:
    default_equipment_rows = [
        [
            1,
            700501,
            "真·黑光星陨剑",
            "60级橙色武器-魔剑",
            60,
            60,
            105,
            "武器-魔剑",
            "101",
            "职业：魔剑士",
            "101",
            101102,
            "在星陨中淬炼而成的魔剑。",
            201572,
        ],
        [
            1,
            700502,
            "真·灼月斩舰刀",
            "60级橙色武器-重剑",
            60,
            60,
            106,
            "武器-重剑",
            "102",
            "职业：狂战士",
            "102",
            102102,
            "",
            201581,
        ],
        [
            1,
            700401,
            "辉·黑光星陨剑",
            "60级橙色武器-魔剑",
            60,
            60,
            105,
            "武器-魔剑",
            "101",
            "职业：魔剑士",
            "101",
            101102,
            "",
            201572,
        ],
        [
            1,
            799999,
            "未分组测试剑",
            "测试武器",
            60,
            60,
            105,
            "武器-魔剑",
            "101",
            "职业：魔剑士",
            "101",
            0,
            "",
            201572,
        ],
        [
            1,
            800001,
            "测试头盔",
            "非武器",
            60,
            60,
            200,
            "头盔-全甲",
            "101",
            "职业：魔剑士",
            "101",
            0,
            "",
            0,
        ],
    ]
    default_group_rows = [
        [16, "极T6", "{", 700501, 700502, "}", 1, 1],
        [15, "极T5", "{", 700401, "", "}", 1, 0],
        [101102, "模型ID冲突组", "{", 700502, "", "}", 1, 0],
    ]
    appearance_rows = [
        [101102, "主城换色", "/Game/Test/SK_Rapier"],
        [102102, "主城换色", "/Game/Test/SK_Claymore"],
    ]
    career_rows = [
        [101, "魔剑士"],
        [102, "狂战士"],
    ]

    csvdir = doc_directory / "csvdir"
    csvdir.mkdir(parents=True, exist_ok=True)
    _write_table(
        csvdir / "z装备表.csv",
        EQUIPMENT_MEMBER_ROW,
        EQUIPMENT_LABEL_ROW,
        default_equipment_rows if equipment_rows is None else equipment_rows,
    )
    _write_table(
        csvdir / "w武器转换表.csv",
        WEAPON_GROUP_MEMBER_ROW,
        WEAPON_GROUP_LABEL_ROW,
        default_group_rows if group_rows is None else group_rows,
    )
    _write_table(
        csvdir / "w武器外观表.csv",
        WEAPON_APPEARANCE_MEMBER_ROW,
        WEAPON_APPEARANCE_LABEL_ROW,
        appearance_rows,
    )
    _write_table(
        csvdir / "z职业配置表.csv",
        CAREER_MEMBER_ROW,
        CAREER_LABEL_ROW,
        career_rows,
    )
