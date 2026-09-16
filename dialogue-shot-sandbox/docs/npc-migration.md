# NPC 一键迁移与配置

> 文档状态：现行专题规范
>
> 最近核对：2026-09-16，当前工作区基于镜头沙盘 `0.24.10` 继续修复。工作区包含
> “全新 NPC”、“动作补充与修改”和“面部补充”三个入口。

## 结论

NPC 迁移可以自动化，但不能安全地压缩成一次无审核的写入。美术 UE 与策划 UE
是两个工程，当前 OmniMcpCore 端口一次只连接一个编辑器；胶囊体尺寸、角色朝向、
动作语义和特殊脸部结构也包含视觉判断。

工具因此采用“同一任务、两阶段执行”：

1. 美术 UE：读取内容浏览器中选中的 `SK_` Skeletal Mesh，递归收集项目内依赖，
   生成物理文件迁移清单。
2. 文件迁移：保持 `/Game` 包路径复制到策划工程 `Content`。同路径且内容一致的
   文件直接复用；内容不同时整批阻断，始终不覆盖。
3. 策划 UE：校验迁移后的 Mesh、Skeleton、`NPCBase` 和
   `SeriaNPCAnimInstance`。
4. 自动配置：导入 Body / Face FBX，Face 动作锁定根骨骼，创建并绑定 BP 与
   ABP，按 Mesh 包围盒估算胶囊体，绑定转头曲线，为可播放动作生成 Montage
   及语义插槽，并通过标准模板配置状态机和 Look 混合空间，最后编译、保存并
   回读。
5. 人工复核：胶囊体与 Mesh 的视觉贴合、角色正面、ABP 状态机运行效果、
   Look 三个采样点、面部曲线/Montage 输出和后处理动画蓝图。

动物 NPC 是同一两阶段管线中的独立模板配置。首版以
`BP_E05_CAT01_NPC` / `ABP_E05_CAT01_NPC` 为逻辑模板；新 BP/ABP 绑定所选
Skeletal Mesh 自带的 Skeleton。动作库命中当前 NPC 时，会导入对应 Body FBX，
并用新 NPC 的 IdleStand / Walk 替换模板状态机引用；未命中时才复用模板动作集。
`AM_Sleep` 继续来自模板，不套用人形 Look 与 SpecialAction 规则；动作兼容性由
蓝图编译和人工预览确认。

## 工作区分流

进入 NPC 迁移工作区后先选择本次任务：

1. **全新 NPC**：保留原有的美术 UE 扫描、文件迁移和策划 UE 完整配置流程。
   标准模板可选男性、女性或动物；动物模板会复制猫 BP/ABP，并使用独立命名、
   目录和胶囊体规则。
2. **动作补充与修改**：读取策划 UE 中已有的 NPC BP、Body Skeletal Mesh 或
   Body Skeleton，只导入本次勾选的 Body FBX。同名资产按“更新”审核，新资产
   按“新增”审核；符合规则的可播放动作会创建 Montage。若同一来源
   目录树内存在严格同名加 `_Face` 后缀的 FBX，则自动配对并在 Body 导入后使用
   Face Skeleton 连续导入、锁根和复制曲线，不再要求分两次执行。选择 Skeleton
   时只在唯一匹配到引用它的非 Face Skeletal Mesh 后继续。
3. **面部补充**：读取已有 NPC、Body Skeleton、Face Skeletal Mesh 与
   Face Skeleton，只处理以 `_Face` 结尾且能找到同名 Body 动作的 FBX。

目标动作目录统一位于 NPC 命名目录下：Body 写入 `<NPC>/Animation`，Face
写入 `<NPC>/Animation/Face`。当 Body Mesh 或 Skeleton 位于 `<NPC>/body`
等子目录时，工具会沿包路径向上定位与 NPC 名称相同的目录，不把网格体分类目录
误当作 NPC 根目录；若路径中没有同名目录，才回退到 Body Mesh 的直接父目录。

动作和面部增补不再执行美术 UE 依赖扫描、跨工程文件复制、NPC BP/ABP 创建、
胶囊体和状态机配置。清单勾选变化后由工具自动刷新审核令牌，无需再次点击生成
清单；同步完成前写入按钮保持禁用。清单首列表头的三态复选框负责全选和全部
取消，部分选择时显示中间态，阻断项不计入可选数量。名称/时间排序直接位于
“动作 / 修改时间”表头，不再额外占用一行清单标题栏。

## 单独面部补充

根据《NPC表情配置自动化工具》文档，独立面部补充采用以下流程：

1. 在策划 UE 内容浏览器中选择已有 NPC BP、Body Skeletal Mesh 或 Body
   Skeleton。
2. 工具从 Body Mesh 推导 NPC 名称与 `Animation` 目录，并在 NPC 资产目录中
   唯一匹配 `SK_<NPC>_Face` 及其 Face Skeleton。
3. 扫描用户选择的 FBX 目录，只保留
   `A_<NPC>_<Action>_Face.fbx`；去掉 `_Face` 后必须存在同名 Body AnimSequence。
4. 用户可临时取消不需要处理的动作。重新审核后，工具使用 Face Skeleton
   导入所选 FBX，对新增和更新分别处理，强制写入 `force_root_lock=True`，
   保存并回读。
5. 清单分别提供“复制曲线”和“生成 Montage”选项。默认值与原 Helper 的
   DataTable 规则一致：LookD/F/U 不复制曲线；Look、Turn、lean 和
   Idlestand 系列默认不生成 Montage，Walk 生成 `AM_Walk` 并使用
   `TurnSlot`。
6. 工具逐项调用 Seria 原生 Python 接口：
   `copy_face_anim_sequence_morph_targets_curve` 复制 Morph Target 曲线；
   `make_npc_montage_by_anim_sequence` 生成需要的 Montage。
7. 写入后重新使用 `get_face_anim_sequence` 校验 Body / Face 配对，并保存
   Body AnimSequence、Face AnimSequence 和新建 Montage。既有 Montage 不调用
   创建接口，因此保留人工 Slot；新建 Montage 由 Seria 原生接口设置 Slot。
   支持轨道属性的引擎版本继续回读 Slot；UE4 Python 未暴露
   `SlotAnimTracks` 时跳过二次改写并提示在 UE 中复核，不因此中断 Face 导入。

`BP_FaceConfigHelper` 本身不再参与独立面部补充。运行时反射确认
`SeriaAssetHelperBlueprintFunctionLibrary` 及以上三个逐资产函数均可由
OmniMcpCore 的 UE Python 直接调用，因此不需要修改 Helper、UE 编辑器或 Seria
C++ 代码。原来的 MakeTable 由镜头沙盒审核清单替代，Out 由逐项原生调用替代。

## 文档步骤映射

| 原步骤 | 工具模块 | 自动化程度 |
| --- | --- | --- |
| 选择 Skin 并迁移依赖 | 源资产扫描 + 文件迁移 | 自动，执行前审核 |
| 创建 `Animation` 并导入 FBX | 动作导入 | 自动 |
| 取消导入网格体并指定 Skeleton | FBX Import Task | 自动 |
| 创建 `BP_XXX` 并指定 Mesh | NPC BP 配置 | 自动 |
| 调整胶囊体和 Mesh 方向 | 胶囊体估算 | 自动按包围盒写入半径、半高和 Mesh Z 偏移，人工复核 |
| 配置转头曲线 | 行为配置 | 自动定位 `NpcBehaviourComponent` 的唯一曲线属性并写入 |
| 添加 Face 组件 | Face 配置 | 人工确认 Mesh 和 Socket |
| 锁定 Face 动作根骨骼 | Face 动作导入 | 自动 |
| 执行 `BP_FaceConfigHelper` | 原生 Seria 面部处理 | 面部补充自动，逐项审核后写入并回读 |
| 创建 `ABP_XXX` | 动画蓝图配置 | 自动继承所选标准模板并绑定当前 Mesh 的 Skeleton |
| 创建动作 Montage 与插槽 | Montage 配置 | 转身与 Walk 写入 `TurnSlot`，其他可播放动作写入 `IdleSlot` |
| 配置状态机 | 标准 ABP 模板 | 自动继承模板图表并覆盖目标动作 |
| 配置 Look 混合空间 | Look 配置 | 自动复制模板轴与采样位置并替换 LookD/F/U |
| 编译和保存 | 最终化 | 自动编译保存 + 人工终检 |

标准模板来自《普通NPC动画蓝图配置（简单方法）》：

- 男性：`ABP_N16_Villager_Male_A`
- 女性：`ABP_N18_Villager_Female_A`
- 动物：`BP_E05_CAT01_NPC` + `ABP_E05_CAT01_NPC`

文档原流程要求把模板 AnimGraph 节点复制到新 ABP。工具通过复制模板 ABP
资产保留完整图表，随后替换目标 Skeleton，并遍历复制品内的 Sequence Player
与 BlendSpace Player 节点，把 Look BlendSpace、IdleStand、Impact 和
Interact 替换为当前 NPC 资产。这样不依赖编辑器剪贴板，并能在写入后编译验证。

## 动物模板规则

动物模板按 `BP_E05_CAT01_NPC` 的真实资产结构执行：

| 项目 | 规则 |
| --- | --- |
| 目标 Skeleton | 使用所选 Skeletal Mesh 自带的 Skeleton，不要求与模板资产路径相同 |
| 模板 Skeleton | `ABP_E05_CAT01_NPC` 自身仍须绑定 `/Game/Seria/BioSystems/E05_Cat/SKEL_E05_Cat`，用于确认模板未被误改 |
| BP 模板 | `/Game/Seria/NPC/E05_Cat/BP_E05_CAT01_NPC` |
| ABP 模板 | `/Game/Seria/NPC/E05_Cat/ABP_E05_CAT01_NPC` |
| 动作前缀 | 从 Mesh 变体名去掉末尾两位编号；`E05_Cat02` → `A_E05_Cat_` |
| 模型与 AnimSequence | `/Game/Seria/BioSystems/E05_Cat` 及其 `Animation` 子目录 |
| BP 与 ABP | `/Game/Seria/NPC/E05_Cat` |
| Montage | `/Game/Seria/NPC/E05_Cat/Animation`；完整迁移复用模板 `AM_Sleep` |
| 胶囊体 | Radius `40`、Half Height `40`、Mesh Z `-35` |
| 转头曲线 | `/Game/Seria/NPC/Curves/Npc_head_turn` |
| Face | 首版不支持，发现 Face FBX 时阻断 |

例如读取 `SK_E05_Cat02` 后，工具生成
`BP_E05_CAT02_NPC` / `ABP_E05_CAT02_NPC`，但动作族仍为 `E05_Cat`。
完整迁移在动作库命中时导入 `A_<NPC>_*.fbx`，至少使用 IdleStand / Walk 替换
模板状态机引用；动作库未命中时复用猫模板动作。后续动作更新通过“动作补充与修改”
处理，并同时扫描 BioSystems 动作目录和 NPC Montage 目录。

动物 BP 与 ABP 均从模板复制，以保留专用事件图、状态机和 `AM_Sleep` 引用。
复制后会把 Mesh 与 ABP 重新绑定到新 NPC 自带的 Skeleton。模板中的动作引用
仍需与新骨架结构兼容；工具通过蓝图编译与目标 Skeleton 回读拦截明显失败，最终
仍需在 ABP 状态机中预览 IdleStand、Walk 和 Sleep。该选项不是任意四足动物的
自动重定向器。

## 安全约束

- 只接受一个选中的 Skeletal Mesh，名称必须以 `SK_` 开头。
- 源依赖存在未保存包时阻断。
- 目标目录必须是现有 Unreal 项目的 `Content` 目录。
- 跨工程复制保持原始 `/Game` 包路径，不支持在复制时改目录。
- Mesh 位于 `<NPC>/body` 等子目录时，BP 与 Animation 仍以匹配到的 NPC
  命名目录为根，不把模型分类目录当作目标根目录。
- 动作目录只导入匹配当前 `A_<NPC>_` 前缀的 FBX；同目录其他 NPC 文件会忽略。
- 目标同路径文件与源文件内容一致时复用；内容不同时阻断，不执行覆盖。
- 使用 SHA-256 审核令牌；参数变化后必须重新预检。
- BP 或 ABP 已存在时阻断，避免覆盖人工资产。
- 多个动作映射为同一 Montage 名称时阻断。
- 全新 NPC 配置中，转头曲线资产不存在、组件属性无法唯一识别或 Montage API
  不可用时阻断。
- 动作增补中的 Montage 逐项隔离处理；单项失败不撤销已导入动作，也不阻断后续
  Montage，结果中明确列出待补项并清理该次产生的不完整 Montage。
- 启用标准 ABP 时，缺少 LookD、LookF、LookU、IdleStand、Impact 或 Interact
  任一动作都会阻断。
- 男性或女性模板不存在、模板引用资产不完整、BlendSpace 或 ABP 覆盖接口不可用
  时阻断。
- 动物模板 BP/ABP、`IdleStand`、`Walk` 或 `AM_Sleep` 不完整时阻断。
- 迁移后 Skeletal Mesh 未绑定计划中读取的新 NPC Skeleton 时阻断；新 Skeleton
  不需要与模板 `SKEL_E05_Cat` 使用相同资产路径。
- 高风险迁移和目标配置分别要求确认。

## 自动命名

界面只保留一个可编辑的 NPC 名称确认框。读取 `SK_N28_Citizen_Male_C` 后默认
得到：

- NPC 名称：`N28_Citizen_Male_C`
- NPC BP：`BP_N28_Citizen_Male_C`
- 动画 BP：`ABP_N28_Citizen_Male_C`

修改 NPC 名称会同步更新 BP 与 ABP 名称，后两者不可独立改写。

Montage 按动作语义处理：

- `Idle` / `Idle1` / `Idle2` → `AM_Idle1` / `AM_Idle2`
- `AM_Emotion_Anger` 等情绪动作 → `AM_Anger`
- `TurnL` / `TurnLeft90` → `AM_TurnLeft90`
- `TurnR` / `TurnRight90` → `AM_TurnRight90`
- `TurnLeft180` / `TurnRight180` → 对应 180° Montage
- `Walk` → `AM_Walk`，使用 `TurnSlot`
- 其他可播放动作 → `AM_<Action>`，新建时使用 `IdleSlot`

`LookD/F/U`、`BackLean`、`FrontLean` 和 `IdleStand*` 属于混合空间或状态机
素材，只导入 AnimSequence，不创建 Montage。目标目录树中已有同名 Montage 时
直接复用并保留原 Slot，不因 Body 或 Face 重导入而覆盖。
新建 Montage 优先调用项目原生
`make_npc_montage_by_anim_sequence`，随后按上述规则写入并回读 Slot；仅当原生
接口不可用时才尝试 UE Python 工厂兼容路径。

桌面版设置允许维护多个“NPC 动作库”根目录。读取全新 NPC 源资产或已有 NPC
目标后，工具会递归查找
文件名以 `A_<NPC名>_` 开头的 Body FBX，并自动填入目录、生成清单。多个目录
都包含该 NPC 时，优先选择 Body FBX 数量最多的目录；数量相同则选择最近有源
文件更新的目录。若 Body 和 Face 分别位于同级 `Body` / `Face` 或
`Animation_Body` / `Animation_Face` 目录，则自动使用两者的共同父目录，
确保动作增补能发现并配对 Face FBX；手动选择 Body 目录时也执行相同归一化。
未命中或用户需要覆盖自动结果时，仍可手动更换目录。

## 标准 ABP 与 Look

界面默认启用“标准 NPC ABP 模板”，并允许选择男性或女性。名称包含 Male/Boy/
Man 或 Female/Girl/Woman/Lady 时自动选择；无法判断时默认女性模板：

- 男性模板用于普通男性 NPC。
- 女性模板包含长裙腿部穿模处理；文档确认男性也可使用，因此默认选择女性。

工具从模板目录定位以下引用资产，并用当前 NPC 的同语义动作替换：

| 模板内容 | 当前 NPC 动作 |
| --- | --- |
| Look BlendSpace | 自动生成的 `BS_<NPC>_Look` |
| IdleStand | `A_<NPC>_Idlestand` |
| Impact | `A_<NPC>_Impact` |
| Interact | `A_<NPC>_Interact` |

LookD、LookF、LookU 会自动设置为 Mesh Space Additive，以 LookF 第 15 帧作为
基准姿势。新 Look BlendSpace 复制模板的轴名称、最小值、最大值、网格数量及
三个采样位置，并使用当前 NPC 的 IdleStand 作为预览基础姿势。

## 代码模块

- `src/data/npcMigration.ts`：命名、动作分类、流程计划和阻断规则。
- `server/npcMigration.ts`：UE 源扫描、文件预检/复制、目标 UE 校验与配置。
- `src/data/npcSupplement.ts`：动作增补清单、Face 默认处理规则和阻断条件。
- `server/npcSupplement.ts`：增补审核令牌、UE 调用与结果回读。
- `server/ue/scripts/npc_face_supplement.py`：Face 导入、锁根、曲线复制和
  Montage 生成的 UE Python 自动化。
- `server/ue/services.ts`：业务服务门面。
- `server/ue/routes.ts`：本地 HTTP API。
- `src/ue/client.ts`：前端 API 客户端。
- `src/components/NpcMigrationWorkspace.tsx`：迁移工作区。

## 使用顺序

1. 启动镜头沙盘和美术 UE，打开 `OmniMcpCore`。
2. 在美术 UE 内容浏览器中只选择一个 `SK_` 资产。
3. 进入“NPC 迁移”，读取源资产，选择策划工程 `Content` 与对应动作
   `Animation` 目录；已配置 NPC 动作库且命中时，动作目录自动填入。
4. 检查计划并执行“迁移基础资产”。
5. 关闭美术 Art UE，启动目标 Res UE 和 `OmniMcpCore`。
6. 点击“校验资产”，通过后点击“配置 BP 文件”。如果仍连接 Art UE，工具会
   明确提示关闭 Art、打开目标 Res 并重新校验。
7. 按工具给出的最终清单完成视觉和动作语义复核。
