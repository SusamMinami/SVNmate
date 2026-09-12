# UE Blueprint 站位集成

> 文档状态：现行专题规范
>
> 加载触发与坐标按 2026-09-11 工作区实现核对。本文维护 BP 读取、身份、体型
> 和坐标；交互编排归 [分镜工作流](storyboard-workflow.md)，末尾仍是待办。

## 当前范围

Blueprint 站位查询本身只读。用户确认基于 BP 站位生成的分镜后，可通过独立
导出流程预检并写回对应 Dialog Graph 台词节点；只有用户二次确认后才修改并
保存对话 `.uasset`。该集成只面向 Windows 桌面版，不提供移动端运行或测试
目标。

四位对话 ID 仅加载本地对话链与文字，不连接 UE。用户点击“读取 BP 站位”后才执行：

1. 优先读取 `DialogStart.Formation` 指定的 Blueprint。
2. 当 Formation 为空时，通过 UE Asset Registry 搜索
   `BP_<开始节点ID>`。
3. 读取 Blueprint SCS 中数字命名的 `ChildActorComponent`。
4. 读取对话资产实际保存的 `DialogModels`，与 BP 数字槽共同确定场内角色；
   CSV `DialogStart.Model` 仅作为离线回退。
5. 读取 Dialog Graph 中已有的 `CameraPosition` 与 `MoveCameras`；可识别的
   `EPush` 直接转换为沙盘镜头，没有相机时保持纯文字状态。

只读加载不调用导演或模型。占位确认、玩家锁定、方案切换和 TRAE 缓存规则统一见
[分镜工作流](storyboard-workflow.md)，无分镜节点编辑见 [节点配置](node-configuration.md)。

Blueprint 不存在、UE 未启动、OmniMcpCore 未连接、桥接异常或单步查询超时时，
程序不会中断对白加载，也不会因此自动执行导演。BP 不可用时仍会继续尝试读取
Dialog Graph 中的已有镜头；缺少 Formation 坐标基准时按 UE 原点预览并显示
警告。BP 查询不再使用固定的前端总时限；读取超过 8 秒时会显示“结构较复杂，
UE 仍在读取”，并继续等待服务端完成有限次数的属性查询。UE 返回的 `None`、
`null`、`nullptr`、`0`
和空字符串都按“资产不存在”处理，不会继续读取无效 Blueprint 属性。

镜头求解完成后的投影验收属于质量检查，不会被当成 Blueprint 查询异常。
规则导演与大模型会针对失败镜头返修一次；仍未通过的镜头会连同警告一起
保留，并在镜头列表中标红。

## 数据来源

### 开始节点表

`对话表_开始节点.csv` 提供：

- `DialogStart.Formation`：Blueprint Generated Class 路径。
- `DialogStart.Model`：按模型槽位索引排列的模型名称；`None` 表示该槽未启用。
  正式使用 BP 时以 UE 对话资产中的 `DialogModels` 回读值为准。

模型数组的索引与 Blueprint SCS 中数字命名的组件一致。例如：

```text
Model[2] <-> SCS VariableName "2"
```

### NPC 与模型资源表

角色映射沿用 ConfigLinker 的关系：

```text
NPC.id -> NPC.resource_id -> Model.id -> Model.path
```

运镜沙盒直接读取同一目录中的 `NPC表.csv` 和可选的
`m模型资源表.csv`，不依赖 ConfigLinker 进程或 EXE 必须同时运行。

### Blueprint

UE bridge 从 Blueprint 的 `SimpleConstructionScript` 读取：

- `InternalVariableName`
- `VariableGuid`
- `ChildActorClass`
- `RelativeLocation`
- 体型读取新增 `server/ue/characterBody.ts`：从角色 CDO 或可用的 ChildActorTemplate
  读取主 Skeletal Mesh 包围盒，经组件附件链和槽位缩放转换为米制体型档案。
  不生成临时 Actor、不运行 Construction Script、不修改或保存 BP。
  姿态、蓝图构造脚本动态缩放、复杂多 Mesh 和槽位俯仰/横滚仍需 UE 实测；
  眼肩关键点当前按比例估算，失败时明确回退。
- 沙盘保留 `RelativeLocation.z`，`bodyProfile.footOffset` 单独表达脚底相对
  槽位原点的位置；预览、机位求解、投影与共享方案使用同一档案。
- `RelativeRotation`
- `RelativeScale3D`

只有变量名为整数的 `ChildActorComponent` 被视为角色站位。相机等其他组件
不会进入角色列表。任务目标物工作区导入的背景组件直接使用资产名，因此不会
参与角色站位或 DialogModels；其 `RelativeLocation`、`RelativeRotation` 和
`RelativeScale3D` 仍会写入并回读。

### 对话节点

CSV 解析器已经保留：

- `Dialog.CharacterBehaviourString`
- `Dialog.RelativeTransformsString`

`CharacterBehaviourString` 同时用于识别唯一的 `AM_Talk` 槽位，以及恢复
`ERotate`、`EWalk` 和 `EStateMachineWalk` 动作。分镜工作台按当前镜头结束
节点累计动作：转身按 Montage 名称中的方向和角度更新朝向；两类走位按 UE
起止坐标换算沙盘位移，并让角色面向移动方向。UE 回读仅补充 CSV 中不存在的
动作，避免同一动作重复应用。

任务目标物的六位节点站位从完整 `NextID` 链累计到指定节点，包含隐藏节点；
每节点先应用 `RelativeTransformsString` 再执行动作，不误算到整段对话末尾。
四位 BP 简写不触发站位预览。世界坐标、确认和加载流程见
[任务目标物](mission-target-preview.md)。

## 身份模型

NPC ID 仍是角色叙事身份和角色资料查询键。空间层额外使用实例身份：

```text
instanceId = bp:<BlueprintAssetPath>:<ModelIndex>
```

这是必要约束。同一 NPC ID 或同一模型可以同时出现在多个 BP 槽位中，不能
用 NPC ID 作为 React key、空间索引或 UE 回写目标。

场内角色数量由有效数字 BP 槽决定，不由台词说话者数量决定。`0` 号槽必须
映射为玩家；未发言 NPC 仍保留为场内背景角色，参与遮挡、画面重量、
前中后景和安全区域判断，但不作为镜头主体、注视对象或关系轴端点。
关系轴和双人/群像叙事人数只按当前对话文件中实际发言的角色计算。
身份依次使用节点显式模型槽、`DialogModels` 和模型类路径映射；无法映射 NPC
表的有效槽也保留为可见的未识别背景角色，不能静默删除。

对话行优先通过 `AM_Talk` 推断出的模型索引绑定说话实例；没有明确槽位时，
沿用该 NPC 最近一次已确定的说话实例，最后才回退到第一个候选实例。

加载 BP 时先以对话行的 NPC ID 和 NPC 表模型资源校验全部发言角色，再处理
背景角色。共享 BP 的有效槽超过 12 个时，必须优先保留玩家和全部发言角色，
剩余容量按与发言角色的空间距离选择背景槽，不能先按槽位号截断。一个发言
NPC 对应多个同模型槽且没有 `AM_Talk` 时使用最小槽位号并给出警告；多个发言
NPC 共用同一模型且没有显式槽位、`AM_Talk` 指向错误模型或 BP 缺少发言角色
模型时，不得猜测身份。属于模型缺失或槽位模型不一致的 NPC 会先进入确认弹窗，
集中显示 NPC、关联台词节点、原因和预期模型路径。用户可在 UE 中补齐后原地
刷新；也可逐项勾选忽略，全部确认后继续选择 BP 或规则占位。选择 BP 时已有
槽位保持原始 Transform，缺失模型角色保留对白并使用临时规则位置；选择规则
占位时才重新安排全部角色。刷新后仍然缺失的 NPC 会保留原有勾选状态。其他
身份歧义继续按原规则跳过 BP。

## 坐标转换

UE 使用厘米和 `X 前 / Y 右 / Z 上`，Three.js 舞台使用米和
`X 右 / Y 上 / Z 后`。当前转换为：

```text
Three.x = UE.y / 100
Three.y = UE.z / 100
Three.z = -UE.x / 100
```

导入后仅按实际选入角色的水平中心平移 X/Z，保留垂直高度；记录
`formationOrigin = [centerX, 0, centerZ]`。场景与导出复用此基准，不重新对全部
原始槽求平均。只改变预览坐标，不改变 UE 原始 Transform。
Yaw 被转换为角色朝向向量，镜头求解和正面偏角验收都使用该真实
朝向，不再默认把 `look_target` 当成角色已经面向的位置。

需要改变对话视线时，演员调度只从现有
`AM_TurnLeft/Right45/90/180` 中选择离当前目标方向最近的离散动作，并让后续
镜头继承转身后的朝向。`NPC.ifturn=false` 时不规划转身，而是保留 BP 朝向并
调整机位。

工作台 UE 页签会从每个数字槽 `ChildActorClass` 的类默认对象读取 `Montages`
映射，并按当前分镜覆盖的台词节点编辑 `CharacterBehaviours`。数组索引继续对应
Formation 模型槽；节点已有动作只读展示，本次动作按界面顺序追加。名称包含
`AM_Turn` 的新增项写为 `ERotate` 并按名称中的左右方向和角度更新沙盘朝向，
其他新增项写为 `ENone`。每项包含 Montage 名和 `StartTime` 延迟；同一槽位
原有 `EWalk`、`ERotate`、`EStateMachineWalk`、`bStop` 和位置数据不会被覆盖。
新增动作初始不选择 Montage；输入名称或资源路径关键词后连续滚动全部匹配结果，
同时只渲染约 8 条。未选 Montage 的空白编辑行不参与导出。右下角统一导出入口先展示
本地待导出清单，用户确认范围后才连接 UE；只勾选动作时仅检查涉及的节点和
角色槽，跳过相机、音效、音乐以及其他角色槽读取。UE 预检同时显示 NPC 名称，
未映射 NPC 时显示 `DialogModels` 模型名。

## 通信

前端调用：

```text
POST /api/ue/formation/read
POST /api/ue/dialogue/storyboard/read
```

UE 服务通过现有 `server/ue/transport.ts` 连接 OmniMcpCore；默认端口、配置位置
与进程区别见 [开发指南](development.md)。BP 查询使用：

- `asset.asset_search`
- `bp.get_blueprint_by_path`
- `reflect.read_object_property`

小窗轮询节奏归 [节点配置](node-configuration.md)。BP 查询不得调用属性写入；
目标物预览、BP 填充、DialogGraph 注册和配表是独立的显式操作，按各自专题确认。
普通 UE MCP 调用的单步响应上限为 20 秒；自动打开地图属于长操作，单独允许
最长 3 分钟。切图期间连接关闭或暂时无法回读关卡时，界面会提示继续等待，并
允许地图加载完成后使用“检查并加载”继续目标物预览。
分镜及动作写入、回读与保存归 [导出协议](dialogue-camera-export-design.md)。

## 主要代码

- `server/ue/transport.ts`：UE TCP 帧协议、连接超时与端口配置。
- `server/ue/services.ts`：供 HTTP 层调用的 UE 服务门面。
- `server/ue/routes.ts`：本地 HTTP 与 Vite 开发服务适配。
- `server/ueBridge.ts`：资产检索、SCS 读取和 UE 业务操作。
- `server/configRepository.ts`：CSV 数据目录与 Excel 源表路径。
- `src/ue/client.ts`：前端 UE 查询、预检与显式写入 API 客户端。
- `src/data/csv.ts`：Formation、Model、模型资源和动作字段解析。
- `src/data/blueprintFormation.ts`：模型槽与 NPC 实例映射、坐标转换。
- `src/components/BlueprintFormationModal.tsx`：BP/导演站位选择。
- `src/components/MissionTargetModal.tsx`：目标物双向同步、空间配置与背景
  资产导入。
- `src/director/blockingResolver.ts`：保留 BP 站位及单独解锁 0 号玩家的
  镜头求解模式。

## 后续阶段

1. 结合动作时长播放平滑走位；当前工作台展示节点执行完成后的准确位置。
2. 对跨越走位节点的镜头执行切镜或跟拍约束。
3. 为分镜写回增加 SVN checkout 和 UE Transaction；当前已具备差异确认、
   写后回读、单次保存和失败恢复。
4. 单独实现 DialogGraph 节点走位回写；禁止直接修改导出的 CSV。
