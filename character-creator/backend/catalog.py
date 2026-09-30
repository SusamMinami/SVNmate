"""Explicit table and editable-field contracts; never infer links from equal IDs."""

TABLES = {
    "career": ("z职业配置表", "CareerInfor", "基础配置"),
    "growth": ("z职业升级属性成长表", "CareerLevelupaddattr", "成长属性"),
    "intro": ("z职业介绍表", "Careerintroduction", "职业介绍"),
    "head": ("z职业头像表", "CareerHead", "头像登记"),
    "create": ("c创建角色", "CreateRole", "创角展示"),
    "skill": ("j技能表", "Skill", "技能执行"),
    "tree": ("j技能系统配置表", "Skillsystem", "技能树"),
    "upgrade": ("j技能升级消耗表", "Skillupgrade", "升级消耗"),
    "damage": ("j技能伤害表", "Skilldamage", "伤害"),
    "buff": ("buff表", "Buffbase", "Buff"),
    "behavior": ("x行为表", "Behavior", "行为"),
    "aura": ("g光环定义表", "Aura", "光环"),
    "passive": ("b被动技能配置表", "Passiveskill", "被动技能"),
    "attr": ("s属性id表", "AttrID", "属性字典"),
    "overlay": ("buff互斥关系表", "Buffoverlay", "Buff 互斥"),
    "sign": ("buff标记组互斥关系表", "Signoverlay", "标记互斥"),
    "fusion": ("buff融合表", "Bufffusion", "Buff 融合"),
}

# Only these members may become Excel edits. Array spans retain blank slots.
EDITABLE = {
    "career": {
        "name", "bp", "attack", "Gender", "transferable", "onoffswitch",
        "IsIntroChar", "Isouterchar", "sort", "DamageType", "initial_skill",
        "initialattr", "initialscore", "levelscore", "initialequip", "initialitem",
        "headicon", "teamheadicon", "teamheadicon2", "schoolicon",
    },
    "growth": {"adatk", "apatk", "basehp", "str", "mag", "cons", "agi", "spr", "res"},
    "intro": {"armortype", "weapontype", "damagetype", "mainmechanism"},
    "head": {"name", "headicon"},
}
BOOLEAN = {"Gender", "transferable", "onoffswitch", "IsIntroChar", "Isouterchar"}
INTEGER = {"sort", "DamageType", "initialscore", "levelscore", "headicon",
           "teamheadicon", "teamheadicon2", "schoolicon"}
SKILL_REFS = {
    "rollskill", "rollbackskill", "Crollskill", "Srollskillforward", "Srollskillback",
    "Srollskillleft", "Srollskillright", "accumulate_ground", "accumulate_air",
    "counterattackskill", "landingpursuitskill", "angerskill", "protectskill",
    "protectskillland", "safeguardskill", "safeguardskillland", "reviveskill_dead",
    "reviveskill_down", "crouch_in", "crouch_out", "recall", "battlefieldteleport",
    "MagneticAttractSkill", "MagneticRepelSkill", "Awake2ndID", "holymixskill",
}

RELATIONS = [
    ("CreateRole", "careerid", "CareerInfor", "职业 ID"),
    ("CareerInfor", "initial_skill / 功能技能", "Skill", "显式引用；保留空槽与重复"),
    ("CareerInfor", "id", "成长 / 介绍 / 头像", "同职业 ID"),
    ("Skillsystem", "skillid", "Skill", "技能执行"),
    ("Skill", "id × 1000 + level", "Skillupgrade", "Lua 消费者已核对"),
    ("Skill", "skillgameplay", "GameplayAbility", "UE 资产；本面板未验证"),
    ("GameplayAbility", "资产内部伤害引用", "Skilldamage", "需 UE 检查，不按同号关联"),
    ("Skilldamage", "skillbuff[].buffid", "Buff", "跨列数组"),
    ("Buff", "behavior / nextbuff", "Behavior / Buff", "可循环依赖"),
    ("Behavior", "buff / onetimedamage / behaviorskillid", "Buff / 伤害 / 技能", "按字段解析"),
]
