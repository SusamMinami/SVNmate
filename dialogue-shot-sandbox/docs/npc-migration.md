# NPC 一键迁移与配置

## 结论

NPC 迁移可以自动化，但不能安全地压缩成一次无审核的写入。美术 UE 与策划 UE
是两个工程，当前 OmniMcpCore 端口一次只连接一个编辑器；胶囊体尺寸、角色朝向、
动作语义和特殊脸部结构也包含视觉判断。

工具因此采用“同一任务、两阶段执行”：

1. 美术 UE：读取内容浏览器中选中的 `SK_` Skeletal Mesh，递归收集项目内依赖，
   生成物理文件迁移清单。
2. 文件迁移：保持 `/Game` 包路径复制到策划工程 `Content`，已有同路径文件时
   整批阻断，不覆盖。
3. 策划 UE：校验迁移后的 Mesh、Skeleton、`NPCBase` 和
   `SeriaNPCAnimInstance`。
4. 自动配置：导入 Body / Face FBX，Face 动作锁定根骨骼，创建并绑定 BP 与
   ABP，按 Mesh 包围盒估算胶囊体，绑定转头曲线，生成 Idle/Turn Montage
   及插槽，并通过标准模板配置状态机和 Look 混合空间，最后编译、保存并回读。
5. 人工复核：胶囊体与 Mesh 的视觉贴合、角色正面、ABP 状态机运行效果、
   Look 三个采样点、Face Helper 输出和后处理动画蓝图。

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
| 执行 `BP_FaceConfigHelper` | Face Helper | 辅助，保留清单确认 |
| 创建 `ABP_XXX` | 动画蓝图配置 | 自动继承男性或女性标准模板并绑定 Skeleton |
| 创建 Idle/Turn Montage 与插槽 | Montage 配置 | 自动按命名规则创建并写入 `IdleSlot` / `TurnSlot` |
| 配置状态机 | 标准 ABP 模板 | 自动继承模板图表并覆盖目标动作 |
| 配置 Look 混合空间 | Look 配置 | 自动复制模板轴与采样位置并替换 LookD/F/U |
| 编译和保存 | 最终化 | 自动编译保存 + 人工终检 |

标准模板来自《普通NPC动画蓝图配置（简单方法）》：

- 男性：`ABP_N16_Villager_Male_A`
- 女性：`ABP_N18_Villager_Female_A`

文档原流程要求把模板 AnimGraph 节点复制到新 ABP。工具通过复制模板 ABP
资产保留完整图表，随后替换目标 Skeleton，并遍历复制品内的 Sequence Player
与 BlendSpace Player 节点，把 Look BlendSpace、IdleStand、Impact 和
Interact 替换为当前 NPC 资产。这样不依赖编辑器剪贴板，并能在写入后编译验证。

## 安全约束

- 只接受一个选中的 Skeletal Mesh，名称必须以 `SK_` 开头。
- 源依赖存在未保存包时阻断。
- 目标目录必须是现有 Unreal 项目的 `Content` 目录。
- 跨工程复制保持原始 `/Game` 包路径，不支持在复制时改目录。
- 目标已有任何同路径文件时阻断，不执行覆盖。
- 计划使用 SHA-256 审核令牌；参数变化后必须重新预检。
- BP 或 ABP 已存在时阻断，避免覆盖人工资产。
- 多个动作映射为同一 Montage 名称时阻断。
- 转头曲线资产不存在、组件属性无法唯一识别或 Montage API 不可用时阻断。
- 启用标准 ABP 时，缺少 LookD、LookF、LookU、IdleStand、Impact 或 Interact
  任一动作都会阻断。
- 男性或女性模板不存在、模板引用资产不完整、BlendSpace 或 ABP 覆盖接口不可用
  时阻断。
- 高风险迁移和目标配置分别要求确认。

## 自动命名

界面只保留一个可编辑的 NPC 名称确认框。读取 `SK_N28_Citizen_Male_C` 后默认
得到：

- NPC 名称：`N28_Citizen_Male_C`
- NPC BP：`BP_N28_Citizen_Male_C`
- 动画 BP：`ABP_N28_Citizen_Male_C`

修改 NPC 名称会同步更新 BP 与 ABP 名称，后两者不可独立改写。

Montage 只处理文档中定义明确的动作：

- `Idle` / `Idle1` / `Idle2` → `AM_Idle1` / `AM_Idle2`
- `TurnL` / `TurnLeft90` → `AM_TurnLeft90`
- `TurnR` / `TurnRight90` → `AM_TurnRight90`
- `TurnLeft180` / `TurnRight180` → 对应 180° Montage

其他动作仍正常导入，但不会被猜测为 Montage。

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
- `server/ue/services.ts`：业务服务门面。
- `server/ue/routes.ts`：本地 HTTP API。
- `src/ue/client.ts`：前端 API 客户端。
- `src/components/NpcMigrationWorkspace.tsx`：迁移工作区。

## 使用顺序

1. 启动镜头沙盘和美术 UE，打开 `OmniMcpCore`。
2. 在美术 UE 内容浏览器中只选择一个 `SK_` 资产。
3. 进入“NPC 迁移”，读取源资产，选择策划工程 `Content` 与对应动作
   `Animation` 目录。
4. 检查计划并执行“迁移基础资产”。
5. 关闭美术 UE，启动策划 UE 和 `OmniMcpCore`。
6. 校验策划 UE，通过后执行目标配置。
7. 按工具给出的最终清单完成视觉和动作语义复核。
