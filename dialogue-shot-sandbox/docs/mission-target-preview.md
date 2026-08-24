# 任务目标物反向预览

## 数据链路

任务节点按以下关系解析：

```text
Mission.id
  -> Mission.ShowNPC
  -> MissionPosition.ID
  -> MissionPosition.MapID
  -> MapConfig.id
  -> MapConfig.resourceid
  -> Scene.id
  -> Scene.path
```

目标物资产按以下优先级解析：

```text
MissionPosition.BluePrint -> Model.id -> Model.path
MissionPosition.NPCID -> NPC.id -> NPC.resource_id -> Model.id -> Model.path
```

类型 1 的 NPC 和类型 4 的蓝图目标通常可以加载实际资产。没有可解析模型的
类型 2、类型 3 或异常配置使用 `/Script/Engine.TargetPoint` 定位标记。

解析结果会同时显示 `MissionPosition.Position` 和
`MissionPosition.Rotation`。旋转按 UE 的 `Pitch / Yaw / Roll` 顺序展示并
原样传给 UE，不进行 Three.js 坐标系转换。

列表中的目标物默认全选。用户可逐项取消或通过表头复选框全选/取消全选，
调用 UE 时只发送当前勾选项；未选择任何目标物时禁用“加载到 UE”。表格内容
独立滚动，底部“清除预览”和“加载到 UE”操作栏常驻。

勾选目标物后可以点击“修改位置”，进入 NPC 注册窗口的目标物编辑模式。该
模式保留任务列表中的目标物 ID，并可从 UE 当前选择读取移动后的世界坐标和
旋转。沙盒生成的预览 Actor 名称包含任务 ID 与目标物 ID，因此多选 Actor
不会依赖坐标或列表顺序做身份推断。也可以直接粘贴 UE Transform；写入时统一
转换为目标物表的 `X/Y/Z` 与 `Pitch/Yaw/Roll` 格式。

## 加载前校验

解析阶段发生以下情况时停止，不调用 UE：

- 任务不存在或同时存在于任务表与副本任务表。
- `Mission.ShowNPC` 为空、包含非数字、零值、空元素或重复 ID。
- 任一目标物不存在或存在重复配置。
- 任一目标物的 `MapID` 为空或无效。
- 同一任务的目标物包含不同 `MapID`。
- MapID 无法唯一解析到地图配置或缺少 `/Game/` 资源路径。
- 目标物坐标或旋转格式无效。

## UE 行为

1. 检查全部 Blueprint 资产是否存在。
2. 查询当前打开的关卡。
3. 当前关卡匹配时直接生成目标物，不执行地图切换。
4. 当前关卡不匹配时弹出选择，不会默认调用 `world.open_level`。
5. 选择手动切换后，用户在 UE 中完成切图，再点击“检查并加载”；服务端会
   再次核对当前关卡，匹配前不会生成目标物。
6. 选择软件自动切换后，先查询 Dirty Map Packages；存在未保存关卡时停止。
7. 调用 `world.open_level` 后回读并确认目标地图。
8. 清除上一批由镜头沙盘生成的预览。
9. 仅按当前勾选项的世界坐标与旋转生成实际资产或 TargetPoint。
10. 将预览 Actor 设置为 Editor Only。
11. 任一对象生成失败时删除本次已生成对象，避免部分加载。

预览 Actor 使用名称前缀：

```text
ShotSandboxMissionTargetPreview_<TaskId>_<TargetId>
```

当前实现不会调用地图保存、Excel、VBA、CSV 导出或配置生成工具。预览 Actor
仍位于编辑器关卡世界中，检查结束后应点击“清除预览”，并在保存关卡前确认
不存在上述前缀的对象。

“清除预览”不会只依赖镜头沙盘进程内保存的 Actor 引用。每次执行时都会扫描
UE 当前关卡中名称或标签以 `ShotSandboxMissionTargetPreview_` 开头的 Actor，
批量删除后再次扫描确认。因此开发服务热更新、重启或重新打开页面后，当前
关卡中的预览对象仍可被清理。重新加载目标物前也会执行相同扫描，避免重复生成。

## 创建镜头 Blueprint 内容

“创建 BP”只填充用户已经在 Content Browser 中创建并放好目录的空
Blueprint，不负责新建、复制、移动或重命名 `.uasset`。用户输入 BP 文件名
或完整 `/Game/` 资产路径后，工具会在 `/Game/Seria/Task/Mod` 中精确查找
同名 Blueprint；不存在时停止，多处同名时要求改用完整路径。

写入前会从 `BP_<对话ID>` 提取对话 ID，在
`/Game/Seria/Task/dialoggraph` 中搜索同名 DialogGraph，并通过 UE 导出的
文本读取 `Formation` 和 `DialogModels`。工具按顺序比较对话模型槽与当前
勾选的目标物模型；Formation 未指向目标 BP、模型缺失、多余或顺序不同都会
弹出确认提示。用户取消时不会调用任何 BP 写操作，确认后可继续。

写入前必须满足：

- Blueprint 继承
  `/Game/Seria/Task/Mod/PositionMode/PositionModeBase.PositionModeBase_C`。
- Blueprint 中不存在数字命名的站位组件，也不存在名为 `c1` 的摄像机。
- 所选目标物都能解析到实际模型资产；定位标记不会写入 Blueprint。
- 玩家和全部目标物模型资产均能通过 UE Asset Registry 加载。

组件按任务目标物原始顺序创建。未勾选目标物不创建组件，但保留其槽位序号，
因此取消中间目标物不会让后续模型错位：

```text
0    ChildActorComponent -> /Game/Seria/Characters/Eric/BP_Eric
1..N ChildActorComponent -> 对应序号中已勾选目标物的模型资产
c1   CameraComponent
```

玩家没有任务坐标，因此仅作为占位放在 `(X=0,Y=0,Z=100)`，朝向为零。第一个
目标物作为局部坐标锚点并放在 `(X=0,Y=0,Z=100)`；后续目标物减去该锚点的
世界位置并统一增加 100cm 的 Z 基准，因此保留目标物之间的原始相对位移。
目标物旋转和缩放原样写入。`c1` 使用现有镜头 BP 的常见初值：
`(X=0,Y=0,Z=99)`、`Yaw=-90`。

桥接依次调用：

- `asset.asset_search`
- `bp.get_blueprint_by_path`
- `bp.get_blueprint_basic_info`
- `bp.add_component`
- `bp.set_component_property`
- `bp.compile_blueprint`
- `bp.save_asset_and_capture_log`

编译后会回读组件名称、类型和 ChildActorClass，确认 `0 / 1..N / c1` 均已
创建后才保存。当前 OmniMcpCore 没有跨多次调用的批量事务；如果写入中途
失败，工具不会保存，但 Blueprint 可能在编辑器内保留未保存修改，界面会
明确提示用户检查并撤销。

## 注册 DialogModels

BP 输入框右侧的检查按钮会读取 BP、对应数字槽位、同名 DialogGraph 和
`/Game/Seria/Task/Mod/DialogNPCTable`：

- 空 BP 与已解析任务配合时，列表按任务目标物原始顺序显示对话模型状态。
- 已包含数字站位槽的 BP 会切换为 BP 模型列表，主按钮改为“注册到对话”。
- `DialogNPCTable.CharacterBPPath` 与 BP 模型类路径完全一致时，使用该行名
  作为 `DialogModels` 值。
- 一个类路径对应多个行名时，优先保留对话中已注册的名称；未注册时优先选择
  与 BP 资源名一致的行名，不进行模糊猜测。
- 已有非空对话槽显示“已注册”，可映射空槽显示“待注册”，无映射槽显示
  “未登记”。
- 模型槽默认全选。取消勾选的槽位写为 `None`，不会压缩后续槽位序号。
- 0 号位固定写为 `player`；找不到 `DialogNPCTable` 映射的已选模型保持
  `None` 并在结果中列出。

创建空 BP 时，“创建 BP”会在 BP 保存后同步执行上述 DialogModels 注册。
仅输入并检查已有 BP 时，不需要任务节点，按钮直接切换为“注册到对话”。
写入通过 OmniMcpCore 的对象属性与资产保存接口完成，不直接修改 `.uasset`
二进制；写后回读整个数组，完全一致才执行保存。

## 主要代码

- `src/data/csv.ts`：读取任务、目标物、NPC、模型、地图和场景资源 CSV。
- `src/data/missionTargetResolver.ts`：执行跨表解析和加载前硬校验。
- `server/ueBridge.ts`：自动开图、目标物预览及空 Blueprint 填充。
- `src/components/MissionTargetModal.tsx`：任务输入、变更摘要与目标物详情。
- `src/ue/client.ts`：前端 UE API 客户端。
