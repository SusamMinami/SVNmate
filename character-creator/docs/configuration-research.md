# 角色配置研究与工具结构

状态：2026-09-29，本地正式配置快照、源工作簿结构和 Lua 静态核对。
本文中的数量是此次快照，不代表所有分支。没有执行游戏导表、VBA、SVN 或 UE 写入。
技能/Buff 的后续模块实现见 [现行模块契约](skill-buff-authoring.md)，
UE 能力与复用结论见 [接口核对](ue-interface-reuse.md)。

## 结论与范围

可以通过一个 UI 完成跨表配置，但应以角色/职业聚合编辑，底层仍保持现有各表职责。
技能的 CD、解锁、成长、伤害、Buff 可配置化；新增攻击动作、命中时机、投射物、
GameplayAbility 蓝图等仍需 UE 资产制作。配置正确不等于游戏内已可用。

这里研究的 Eric、Jodie、Nino 是可玩角色族，不是 `NPC表` 的三条记录。
`NPC.resource_id → Model.id → MissionPosition.NPCID` 是另一条场景实体注册链，
不能作为可玩职业创建的主模型。

## 三个角色族的真实入口

| 角色族 | 基础职业 | 转职/分支 | 创角记录 |
| --- | --- | --- | --- |
| Eric | 100 剑士，`Eric/BP_Eric` | 101 魔剑士、102 狂战士、103 鬼刃 | `CreateRole.id=1`，`careerid=100` |
| Jodie | 600 发明家，`Jodie/BP_Jodie` | 601 机械师、602 狂想家、603 药剂师 | `CreateRole.id=6`，`careerid=600` |
| Nino | 700 影武者，`Nino/BP_Nino` | 701 影刺、702 幻刃 | `CreateRole.id=7`，`careerid=700` |

另有 `100100` 剑士复用 Eric BP，`IsIntroChar=1`，用于新手本。
因此不能用 BP 路径去重职业，也不能默认创角表与所有分支一一对应。

| 示例技能 | 职业初始技能 | 技能系统行 | Ability | CD |
| --- | --- | --- | --- | --- |
| Eric 上挑 | `100001;1` | `1000001 → skillid=100001` | `Eric/Skills/BP_GA_Eric_Skill01` | 5000ms |
| Jodie 跃击砰砰 | `600010;1` | `6000001 → skillid=600010` | `Jodie/Skills/BP_GA_Jodie_Skill01` | 5000ms |
| Nino 空切 | `700010;1` | `7000001 → skillid=700010` | `Nino/Skills/BP_GA_Nino_Skill01` | 5000ms |

基础初始技能分别为：

- Eric：100001、100002、100003、100006。
- Jodie：600010、600020、600030、600040。
- Nino：700010、700020、700030、700060。

`Skill.career` 在 Jodie 基础技能中为 -1，`Skill.level` 也为 -1，不能仅筛选
`career=600`，更不能把搜不到解释为没有技能。以职业显式技能引用为主，
职业字段为补充，Ability 路径仅用于候选发现，不能把名称猜测当成已证实归属。
601 的初始技能快照中 `601060;1` 出现两次，应原样展示供人工判断，不自动去重。

## 表清单与模块职责

路径均相对用户选择的 doc。CSV 位于 `csvdir`；xlsm 在 `xlsdir` 下递归按名称定位，
找到多个同名工作簿时必须阻断并要求明确来源，不能选第一个。

| 模块 | 表及关键配置类 | 作用与关系 |
| --- | --- | --- |
| 职业主档 | z职业配置表 / CareerInfor（36 行） | id、name、bp、普通攻击 Ability、初始技能、闪避/受身/复活等、初始属性/装备、开放开关 |
| 创角展示 | c创建角色 / CreateRole（10 行） | careerid→CareerInfor.id；独立创角 BP、站位、群像/镜头动作、头像、视频 |
| 职业成长 | z职业升级属性成长表 / CareerLevelupaddattr（32 行） | id 对应职业；攻击、生命、力量等每级成长 |
| 职业说明 | z职业介绍表 / Careerintroduction（32 行） | 同职业 id 的护甲/武器专精、伤害类型、核心机制 |
| 头像登记 | z职业头像表 / CareerHead（32 行） | 同职业 id；注意不是主表所有图标字段的替代品 |
| 技能执行 | j技能表 / Skill（7298 行） | Ability BP、CD/冷却组、充能、子技能、移除 Buff、PVE/PVP 差异、职业等级 |
| 技能树 | j技能系统配置表 / Skillsystem（1111 行） | skillid→Skill.id；前置、伴随升级、技能位置、描述、等级上限、解锁任务、替换技能 |
| 升级成本 | j技能升级消耗表 / Skillupgrade（21439 行） | id = Skill.id×1000 + 技能等级；需求等级、技能点、战力、效果描述与参数 |
| 技能栏 | j技能栏解锁表 / skillslotunlock | 全局栏位解锁等级，不按职业复制整表 |
| 技能描述模板 | j技能描述表 / SkillDescribeLocal | type→描述模板，不是 Skill.id 一一对应的技能说明表 |
| 特殊参数 | j技能特殊参数表 / Skillspecialpara | PVE/PVP 参数；消费者和作用域需逐类适配 |
| 标签 | j技能标签定义表 / SkillCustomTag | 技能自定义标签字典 |
| 伤害 | j技能伤害表 / Skilldamage（7354 行） | 命中/暴击公式、属性伤害数组、附带 Buff 数组、增怒/能量、免疫标记 |
| 伤害增幅 | j技能伤害增幅表 / DamageCorrect | 公式字典，需联查程序消费者 |
| 附加伤害 | f附加伤害表 / AdditionalDamage | skillid 生效范围、概率、比例和额外伤害；Buff.additionaldamage 引用 |
| 被动 | b被动技能配置表 / Passiveskill（4765 行） | skillid→Skill.id、career、conditionid→PassiveskillCondition；paratype 决定参数含义 |
| 被动条件 | b被动技能条件表 / PassiveskillCondition | 条件类型、运算符、参数 |
| Buff | buff表 / Buffbase+Buff（9818 行） | 叠加、持续/周期公式、属性、表现、伤害、行为、技能替换、光环、后继 Buff |
| Buff 互斥 | buff互斥关系表 / Buffoverlay | Buff ID 间免疫、替换、表现优先关系 |
| 标记互斥 | buff标记组互斥关系表 / Signoverlay | sign 标记组间/对 Buff 的关系，不能与 Buff ID 混用 |
| 标记触发 | buff标记组获取时触发效果表 / Buffbehavior | signid、onetimedamage、conditionid |
| Buff 融合 | buff融合表 / Bufffusion | 催化 Buff、融合产物、伤害、表现及清除策略 |
| 行为触发 | x行为表 / Behavior | 触发时机、条件、概率、CD、对象、Buff、一次性伤害/表现、触发技能、衍生行为 |
| 行为叠层 | x行为叠层表 | 行为层数控制，进一步按运行时定义适配 |
| 光环 | g光环定义表 / Aura | 区域、挂点、阵营、buffinfo、重上间隔 |
| 属性字典 | s属性id表 / AttrID（342 行） | 属性 id、变量名、上下界、显示倍率；初始属性/公式编辑的词典 |
| 变身 | b变身效果配置表 / PolymorphInfor | 独立 BP/技能/属性/Buff 与继承处理，CareerInforID 关联 |
| 外观装备 | z造型表、w玩家外观表、z装备表、w武器外观表、w武器转换表 | 默认发/脸/衣、装扮、初始装备、职业武器；各自 ID 空间不同 |
| 表现字典 | ui资源表、t图标资源表、t特效资源表、y音效资源表、s受击表现表、s受击免疫类型表 | 图标、特效、音效、受击反应与免疫字典；逐字段确认资源命名空间 |
| 分支/玩法 | z转职体验配置表、z职业平衡系数配置表、j技能伤害与副本类型映射表、buff与副本映射表 | 转职体验、PVP/副本覆盖与职业平衡，不默认复制全局行 |

已核实主工作簿路径：`xlsdir/j角色相关/z职业配置表.xlsm`、
`xlsdir/c创建角色.xlsm`、`xlsdir/j技能相关/*.xlsm`、`xlsdir/buff相关/*.xlsm`、
`xlsdir/s属性相关/s属性id表.xlsm`。存在不等于已适配写入。

## 关系图

```mermaid
flowchart LR
  CR["创角展示 CreateRole"] -->|careerid| C["职业 CareerInfor"]
  C --> G["成长 / 介绍 / 头像"]
  C -->|initial_skill 与功能技能| S["执行技能 Skill"]
  C --> BP["角色 BP / 普攻 Ability"]
  ST["技能树 Skillsystem"] -->|skillid| S
  S -->|id × 1000 + level| LV["升级消耗 Skillupgrade"]
  S --> GA["GameplayAbility / Montage / Notify"]
  GA -. "资产内引用，需 UE 检查" .-> D["伤害 Skilldamage"]
  D -->|skillbuff[].buffid| B["Buff"]
  B -->|behavior| A["行为 Behavior"]
  A -->|buff / onetimedamage / behaviorskillid| B
  A --> D
  A --> S
  B -->|nextbuff| B
  B --> H["光环 / 表现 / 附加伤害"]
  B --> X["互斥 / 标记 / 融合"]
```

关系可以有环。UI 应显示引用路径、来源字段、直接引用/派生引用/候选，限制图遍历深度，
不能强行排成无环树。

特别注意：`Skill.id=100001` 是上挑，`Buffbase.id=100001` 是共鸣，二者
同号不构成关系。示例技能 ID 在伤害表中没有同号记录；伤害入口通常位于 Ability、
Montage Notify 等资产，不能通过整数前缀自动补齐依赖。

## 源码证据与结构陷阱

在所选 res 内：

- `Content/Seria/Script/UI/Skill/SkillManager.lua`：
  `Skillupgrade[Skillid*1000 + Dynamicinfo.study_level + 1]`。
- `Content/Seria/Script/UI/Interface/Common/WBP_Common_Skilltips_C.lua`：
  `Skillupgrade[SkillCfg.skillid *1000 + SkillLevel]`。
- `Content/Seria/Script/Core/BP_SeriaPlayerController_C.lua`、
  `Core/BP_SeriaPlayerAIController_C.lua`：遍历 `CareerInfor[School].initial_skill`。
- `Content/Seria/Tables/cfg/skill/Skillsystem.java`：生成定义证实 skillid、
  partnerskillid、chiefskill、skillmaxlv、learntype、PVP 字段等类型；
  生成文件只用于证据，不直接编辑。

CSV 是成员名＋中文名双表头。首列可带 `##&`；空成员名列可属于跨列数组，
同名 `SkillBuffInfor.buffid` 在伤害表重复三次。普通 dict/对象按成员名覆盖会丢数据。
主工作簿前面另有“版本”列，CSV 没有；不能拿 CSV 列号直接写 Excel。
PVP 显示区、导出区可能共存，不要把说明列误当可写字段。

## 推荐构建结构

```text
character-creator/
  src/                 React 工作台、草稿状态、基础/技能/关系模块
  backend/
    catalog.py         表目录与显式关系定义
    repository.py      CSV 双表头、原始列、索引、只读工作簿定位
    service.py         职业聚合、校验、差异、审核凭证
    excel.py           串行 COM、原值复核、复制/更新与回读
    server.py          仅回环地址 HTTP、会话令牌、大小限制
  tests/               合成数据与隔离工作簿验证
  docs/                数据契约、研究与验收
```

前端复用沙盒 React/TypeScript 和视觉语言，不直接依赖其 App 状态、UE 轮询、
Three.js 或音乐服务。Python 与现有 ConfigLinker 技术栈一致，适合 CSV/ZIP 和
Excel COM。首版先用本地测试面板；稳定后以独立 Electron 外壳私有打包 Python，
配置、更新和版本独立。Rust 核心现阶段只覆盖 NPC/模型/目标物，不适合为本轮
技能全域索引直接替换；规模增长后再扩展其协议。

## UI 模块与当前边界

采用沙盒式左侧职业列表、中央编辑器、右侧引用/差异检查器和固定底栏。
切换模块保留草稿，明确显示来源目录、快照时间和未写入数量。

| 模块 | 本轮 | 后续 |
| --- | --- | --- |
| 基础配置 | 读取真实职业；编辑身份、BP/基础开关、初始技能引用、初始属性；模板复制基础草稿 | 完整新职业的枚举、资产、外观、创角展示闭环 |
| 成长与介绍 | 基础聚合中编辑已存在的成长、介绍、头像记录 | 属性预算、按等级曲线与跨职业对比 |
| 技能 | 模块编辑 Skill、Skillsystem、升级行；按模板联动新建；已有 Ability 路径复用 | 资产到伤害的明确引用检查、新 Ability 创建、超出模板的升级曲线生成 |
| Buff | 叠加/生命周期/属性/表现/触发模块编辑；Buff、伤害、行为、光环模板新建 | 被动、特殊类型参数、互斥/融合及完整公式语义适配 |
| 写入 | 精确差异、源表并发检查、隔离副本试写、显式源表写入入口 | 多表变更计划、依赖闭包与导表验证适配 |

技能新建使用同一个变更计划同时分配多个命名空间的 ID，复制等级行并校验技能树、
PVE/PVP、资源路径；不能仅在 j技能表追加一行。Buff 新建同理：根据勾选的效果模块
生成所需记录，不按每个 Buff 无差别复制所有附表。当前行为/光环按需单独从模板新建，
互斥尚未适配，不能把模板新建理解为全依赖克隆。

公式按项目 DSL 保留，不用 JS/Python eval。初期提供变量字典、语法提示和引用检查；
完整运行时公式执行需专门适配器。分支复制必须区分拥有资源与共享资源，输出重映射清单，
不能将所有匹配数字全局替换。

## 写入协议

1. 读取 CSV 供浏览；准备写入时从真实工作簿只读结构建立 baseline。
2. 草稿只保存编辑意图，未展示列、公式、批注、验证和版本列保持原结构。
3. 差异绑定数据目录、职业、工作簿指纹、sheet、成员名和原值。
4. 默认在临时目录复制所需 xlsm；用户可切换为源工作簿模式并审核清单。
5. COM 复用 Excel 会话，禁自动宏/事件，只修改审核过的单元格；执行前整批复核。
6. 写入单元格标红，回读核对，工作簿保持可见且未保存；不自动导表。
7. 失败报告具体已应用/恢复情况。不可宣称多个工作簿具备数据库事务；
   回读未知时禁止重复点击，先检查 Excel 会话。
8. Excel 保存、导表生成 CSV/运行时数据、游戏内验证是不同阶段，分别反馈。

本研究不宣称所有公式、被动类型、UE 伤害引用均已完整追踪。未证实的消费者在
关系浏览中保持“待核对”，后续以字段定义和 UE 只读资产检查逐项扩展。
