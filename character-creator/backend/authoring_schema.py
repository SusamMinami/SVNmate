"""Module allowlists use full members: Buff and Buffbase share one workbook."""

GROUPS = {
    "skill": {
        "身份与执行": "Skill.skillname Skill.career Skill.level Skill.skillgameplay Skill.skilliconid",
        "冷却与充能": "Skill.skillcd Skill.skillcdid Skill.topupmaxtime Skill.costawakenenergy Skill.accumulate_stages",
        "组合与结束": "Skill.subskills Skill.EndRemoveBuff Skill.skillcustomtag",
        "PVP 与矿战": "Skill.skillgameplay_pvp Skill.startskillcd_pvp Skill.skillcd_pvp Skill.topupmaxtime_pvp Skill.accumulate_stages_pvp Skill.startskillcd_gvg",
    },
    "tree": {
        "解锁与技能树": "Skillsystem.skillid Skillsystem.skillname Skillsystem.skillmaxlv Skillsystem.chiefskill Skillsystem.partnerskillid Skillsystem.rowlv Skillsystem.skillset Skillsystem.learntype Skillsystem.isopen Skillsystem.taskid_unlock_skill Skillsystem.Replaceskillid",
        "描述与展示": "Skillsystem.description Skillsystem.skilliconid Skillsystem.skilltype Skillsystem.awakentype Skillsystem.video Skillsystem.skilltab Skillsystem.costenergy",
        "PVP 展示": "Skillsystem.description_pvp Skillsystem.video_pvp Skillsystem.skilltab_pvp",
    },
    "upgrade": {
        "等级消耗": "Skillupgrade.needsp Skillupgrade.needlv Skillupgrade.score",
        "成长参数": "Skillupgrade.effectperlvnew Skillupgrade.para Skillupgrade.effectperlvnew_pvp Skillupgrade.para_pvp",
    },
    "buff": {
        "身份与显示": "Buffbase.name Buff.showicon Buff.icon Buff.bufftips Buffbase.shownumber Buff.bshowtimeinfor Buff.priority",
        "叠加与生命周期": "Buffbase.overridetimetype Buffbase.overrideeffecttype Buffbase.timeoverlaplimit Buffbase.attroverlaplimit Buffbase.periodtype Buffbase.period Buffbase.time Buff.updatetime Buff.deadable Buff.fubenendable Buff.townable Buff.sequencetype Buff.PolymorphInfortype",
        "属性与表现": "Buff.attr Buffbase.effect Buff.onetimeeffect Buff.disappearonetimeeffect Buff.effect_hostile Buff.immunityid Buff.textdisplayrules Buff.textcontent",
        "触发与后继": "Buff.onetimedamage Buff.behavior Buff.auraid Buff.nextbuff",
        "技能替换与冷却": "Buff.changeskill Buff.changeskilltimes Buff.change_current_cdtime_skillid Buff.change_current_cdtime_function",
    },
    "damage": {
        "伤害类型与公式": "Skilldamage.attacktype Skilldamage.elementtype Skilldamage.commontype Skilldamage.hit_formula Skilldamage.cirt_formula Skilldamage.skillattr Skilldamage.stiffshieldformula",
        "附带 Buff": "Skilldamage.stacknumber_buffid Skilldamage.skillbuff",
        "能量与反馈": "Skilldamage.addanger Skilldamage.jueying Skilldamage.overhealtoshield Skilldamage.gainawakenenergy Skilldamage.energyattr",
    },
    "behavior": {
        "触发条件": "Behavior.skillid Behavior.triggertype Behavior.triggercount Behavior.conditionid Behavior.probability Behavior.cd Behavior.objecttype Behavior.objectset",
        "触发效果": "Behavior.buff Behavior.onetimedamage Behavior.onetimeeffect Behavior.buffremove Behavior.behaviorskillid Behavior.followingBehavior Behavior.sort",
    },
    "aura": {
        "范围与挂点": "Aura.shape Aura.para1 Aura.para2 Aura.para3 Aura.rotationZ Aura.socket Aura.AttachComponentTag Aura.collisionProfile",
        "阵营与 Buff": "Aura.selfeffect Aura.friendeffect Aura.enemyeffect Aura.neutraleffect Aura.buffinfo Aura.buffchecktick",
    },
}

# Explicit brace-delimited spans. Nested named members must remain positional.
ARRAYS = {
    "CareerInfor.initial_skill", "Skill.accumulate_stages", "Skill.accumulate_stages_pvp",
    "Skillsystem.skilltab", "Skillsystem.skilltab_pvp", "Skillupgrade.para",
    "Skillupgrade.para_pvp", "Skilldamage.skillattr", "Skilldamage.skillbuff",
    "Skilldamage.energyattr", "Aura.buffinfo",
}

REFERENCES = {
    "Skill.subskills": ("skill", "list"), "Skill.EndRemoveBuff": ("buff", "list"),
    "Skillsystem.skillid": ("skill", "one"),
    "Skillsystem.partnerskillid": ("skill", "list"),
    "Skillsystem.chiefskill": ("tree", "one"),
    "Skillsystem.Replaceskillid": ("tree", "list"),
    "Buff.onetimedamage": ("damage", "one"), "Buff.behavior": ("behavior", "list"),
    "Buff.auraid": ("aura", "list"), "Buff.nextbuff": ("buff", "stacks"),
    "Buff.changeskill": ("skill", "pairs"), "Buff.change_current_cdtime_skillid": ("skill", "list"),
    "Behavior.skillid": ("skill", "list"), "Behavior.buff": ("buff", "list"),
    "Behavior.onetimedamage": ("damage", "one"), "Behavior.buffremove": ("buff", "list"),
    "Behavior.behaviorskillid": ("skill", "levels"), "Behavior.followingBehavior": ("behavior", "list"),
    "Skilldamage.stacknumber_buffid": ("buff", "one"),
    "Skill.career": ("career", "one"),
}

NONNEGATIVE = set("""Skill.skillcdid Skill.skilliconid
Skillsystem.skillmaxlv Skillsystem.rowlv Skillupgrade.needsp Skillupgrade.needlv
Skillupgrade.score Aura.buffchecktick""".split())

INTEGERS = NONNEGATIVE | set("""Skill.career Skill.level Skill.costawakenenergy
Skillsystem.skilltype Skillsystem.awakentype Skillsystem.learntype Skillsystem.isopen
Skillsystem.costenergy Skillsystem.skilliconid Buff.showicon Buffbase.shownumber
Buff.priority Buffbase.timeoverlaplimit Buffbase.periodtype Buffbase.period
Buff.updatetime Buff.deadable Buff.fubenendable Buff.townable Buff.sequencetype
Buff.PolymorphInfortype Buffbase.effect Buff.immunityid Buff.textdisplayrules
Buff.effect_hostile Behavior.triggertype Behavior.objecttype Behavior.objectset
Behavior.onetimeeffect Behavior.sort""".split())

CHOICES = {
    "Buffbase.overridetimetype": ["取新buff时间", "取旧buff时间", "相加", "取剩余时间较长的"],
    "Buffbase.overrideeffecttype": ["取新buff数值", "数值相加", "取数值高的"],
    "Buff.bshowtimeinfor": ["True", "False"],
    **{f"Aura.{name}": ["TRUE", "FALSE"] for name in
       ("selfeffect", "friendeffect", "enemyeffect", "neutraleffect")},
    **{name: ["0", "1"] for name in ("Buff.showicon", "Buffbase.shownumber", "Buff.deadable",
                                    "Buff.fubenendable", "Buff.townable", "Skillsystem.isopen")},
}
