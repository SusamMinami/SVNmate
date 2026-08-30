# UE Blueprint 站位集成

## 当前范围

Blueprint 站位查询本身只读。用户确认基于 BP 站位生成的分镜后，可通过独立
导出流程预检并写回对应 Dialog Graph 台词节点；只有用户二次确认后才修改并
保存对话 `.uasset`。该集成只面向 Windows 桌面版，不提供移动端运行或测试
目标。

用户查询真实配置中的四位数对话 ID 后，程序会：

1. 根据开始节点定位完整对话链。
2. 优先读取 `DialogStart.Formation` 指定的 Blueprint。
3. 当 Formation 为空时，通过 UE Asset Registry 搜索
   `BP_<开始节点ID>`。
4. 读取 Blueprint SCS 中数字命名的 `ChildActorComponent`。
5. 读取对话资产实际保存的 `DialogModels`，与 BP 数字槽共同确定场内角色；
   CSV `DialogStart.Model` 仅作为离线回退。
6. 将 BP 站位与自动站位同时展示，由用户选择；选择 BP 时可勾选是否固定
   0 号玩家位置，默认仅解锁 0 号位。
7. 用户确认站位后，才使用所选站位计算角色关系轴和镜头。

完成首次选择后，工作台保留 BP、规则导演以及随后完成的 AI 占位方案。左侧状态
只显示 `BP_xxxx00` 等简短方案名，点击切换按钮可重新打开对比并直接载入已有
方案，不重复读取 UE 或调用 AI。

BP 查询期间会立即显示新对话的梗概、角色和完整台词，但不会先把自动站位
规则分镜写入主画布，因此一次分析只会展示最终选定站位生成的方案。当前
对话 ID 未改变时，从规则导演切换到 TRAE 协作会复用当前对话和已选站位
而不重新读取 Blueprint，但会在提交前先让用户选择“BP 占位”或“TRAE 自主
占位”。选择 BP 时可同时决定是否固定 0 号玩家；未固定时，其他 BP 角色保持
原位，仅 0 号玩家按导演的 `blocking.position` 调整。确认策略后只发起一次
AI 分析，完成后直接应用对应方案，不再进行第二轮占位重算。

Blueprint 不存在、UE 未启动、OmniMcpCore 未连接、桥接异常或单步查询超时时，
程序不会中断对话加载，而是显示原因、跳过 BP 并继续使用自动站位执行当前导演
分析。BP 查询不再使用固定的前端总时限；读取超过 8 秒时会显示“结构较复杂，
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

任务目标物工作区在检查已有 BP 时可附带对话文件 ID。系统沿完整 `NextID`
链读取所有节点（包括关闭 UI 和无对白节点），先应用每个节点的
`RelativeTransformsString`，再按顺序执行该节点动作，得到每个数字模型槽在
对话结束时的局部 Transform。最终结果通过对话根 Transform 转为关卡世界坐标，
并以“BP 原位 → 对话最终站位”的俯视图和逐槽统计展示。首次操作只计算预览，
用户确认后再加载到 UE；加载完成后自动选中发生变化的非玩家角色，供现有
“注册 NPC”流程直接读取并写入目标物表。

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
刷新；也可逐项勾选忽略，全部确认后保留对白并使用自动站位继续分镜。刷新后
仍然缺失的 NPC 会保留原有勾选状态。其他身份歧义继续按原规则跳过 BP。

## 坐标转换

UE 使用厘米和 `X 前 / Y 右 / Z 上`，Three.js 舞台使用米和
`X 右 / Y 上 / Z 后`。当前转换为：

```text
Three.x = UE.y / 100
Three.y = 0
Three.z = -UE.x / 100
```

导入后以有效角色的中心点平移到沙盘原点，只改变预览坐标，不改变 UE 原始
Transform。Yaw 被转换为角色朝向向量，镜头求解和正面偏角验收都使用该真实
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
新增动作初始不选择 Montage；输入名称或资源路径关键词后，从最多 8 条匹配结果
中确认选择。未选 Montage 的空白编辑行不参与导出。右下角统一导出入口先展示
本地待导出清单，用户确认范围后才连接 UE；只勾选动作时仅检查涉及的节点和
角色槽，跳过相机、音效、音乐以及其他角色槽读取。UE 预检同时显示 NPC 名称，
未映射 NPC 时显示 `DialogModels` 模型名。

## 通信

前端调用：

```text
POST /api/ue/formation/read
```

Electron 主进程中的 UE 传输服务默认通过 `127.0.0.1:12031` 连接项目现有的
`OmniMcpCore`。`12031` 是当前插件约定的默认端口，不是 TRAE 的分镜 MCP
端口。首次启动页会直接调用 OmniMcpCore 验证连接；若同事的插件配置不同，
可在该页面修改端口并保存。

- `asset.asset_search`
- `bp.get_blueprint_by_path`
- `reflect.read_object_property`
- `reflect.write_object_property`

通信默认仅限本机。源码运行时仍可通过 `UE_MCP_HOST` 和 `UE_MCP_PORT`
覆盖；桌面版会把用户确认的端口保存到
`%APPDATA%\Shot Sandbox\desktop-state.json`。不要让 TRAE 扫描 UE 端口，
因为 TRAE 使用的是独立的 `127.0.0.1:43127/mcp`。

基础站位查询是只读操作；任务目标物预览、BP 填充、DialogGraph 注册和配表
草稿属于显式写操作，均由各自界面中的确认步骤触发。已注册 BP 还支持目标物
与数字角色槽的双向 Transform 同步，以及把 UE 当前选择写入非数字背景组件。
背景组件不进入 DialogModels；Blueprint Actor、Skeletal Mesh 和 Static Mesh
分别写为 ChildActor、SkeletalMesh 和 StaticMesh 组件，并保留缩放。
任务目标物与已有数字槽位 BP 同时加载时，原槽位固定保留；只有未映射且经用户
勾选的实际模型目标物会从当前最大槽位号后连续追加，随后所有数字槽位共同注册
到 DialogModels。对话缺失空间配置时，写入流程会先启用并回读 Virtual，再写入
主角初始坐标、朝向和预览地图。
普通 UE MCP 调用的单步响应上限为 20 秒；自动打开地图属于长操作，单独允许
最长 3 分钟。切图期间连接关闭或暂时无法回读关卡时，界面会提示继续等待，并
允许地图加载完成后使用“检查并加载”继续目标物预览。
分镜导出同样先回读并展示逐节点差异。默认只预检当前激活镜头；切换“全部导出”
后可逐镜头勾选范围。确认后只更新所选镜头对应节点的 `CameraPosition` 与
`MoveCameras`，以及用户在动作编辑器中明确修改并勾选的
`CharacterBehaviours` 槽位；未选镜头、节点和角色动作保持原状。

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
