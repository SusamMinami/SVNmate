# 任务目标物与 Blueprint 工作流

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
模型资源栏只显示 `模型 ID · 资源名`，会移除 Generated Class 的重复
`.资源名_C` 后缀；完整类路径通过悬停查看。首次搜索任务 ID 使用当前内存
数据；同一任务 ID 连续搜索时，第二次会从实时目录重新读取任务表，并从配置
文档目录补齐 NPC、模型、目标物和地图表，适合确认外部配表修改。

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
- `Mission.ShowNPC` 为空、包含非数字、零值、空元素或重复 ID；重复时会列出
  具体 ID，便于回到任务表定位。
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
7. 调用 `world.open_level` 时允许最长 3 分钟加载，并在界面持续显示
   “正在等待 UE 加载地图”；随后回读并确认目标地图。
8. 清除上一批由镜头沙盘生成的预览。
9. 仅按当前勾选项的世界坐标与旋转生成实际资产或 TargetPoint。
10. 将预览 Actor 设置为 Editor Only。
11. 任一对象生成失败时删除本次已生成对象，避免部分加载。

大型关卡加载时，UE 可能暂时不响应 OmniMcpCore 或主动关闭当前连接。这种情况
不会直接判定切图失败；界面会保留目标地图和任务计划，待 UE 完成后可点击
“检查并加载”。资产缺失、当前关卡未保存等不可通过等待解决的问题仍保留原始
错误，并返回地图加载方式选择。

预览 Actor 使用名称前缀：

```text
ShotSandboxMissionTargetPreview_<TaskId>_<TargetId>
```

当前实现不会调用地图保存、Excel、VBA、CSV 导出或配置生成工具。预览 Actor
仍位于编辑器关卡世界中，检查结束后应点击“清除预览”，并在保存关卡前确认
不存在上述前缀的对象。

“清除预览”不会只依赖镜头沙盘进程内保存的 Actor 引用。每次执行时都会扫描
UE 当前关卡中名称或标签以 `ShotSandboxMissionTargetPreview_` 开头的 Actor，
先在 UE 编辑器中统一选中，再通过一次 Python 调用在 UE 主线程完成整批销毁，
随后等待 UE 完成销毁并多次扫描确认。因此开发服务热更新、重启或重新打开页面
后，当前关卡中的预览对象仍可被清理，也不会因 Actor 在删除后的下一个编辑器
Tick 才消失而误报失败。若最终仍有残留，工具会把残留对象重新选中，便于在
World Outliner 中检查关卡锁定。重新加载目标物前也会执行相同流程，避免重复生成。

## 创建镜头 Blueprint 内容

“创建 BP”只填充用户已经在 Content Browser 中创建并放好目录的空
Blueprint，不负责新建、复制、移动或重命名 `.uasset`。用户输入 BP 文件名
或完整 `/Game/` 资产路径后，工具会在 `/Game/Seria/Task/Mod` 中精确查找
同名 Blueprint；不存在时停止，多处同名时要求改用完整路径。
BP 输入框只处理四位 BP 简写、BP 资产名或完整 `/Game/` 路径。输入四位
ID（例如 `7352`）时，会自动展开为 `BP_735200` 后搜索，并且只进入 BP
注册到对话流程，不生成或加载站位预览。六位对话节点 ID（例如 `735201`）
只能填写在 BP 文件名右侧展开的“对话节点 ID”中，并作为调度终点；六位纯
数字填入 BP 输入框时会直接提示更正。修改 BP 文件名会清空旧节点值，避免
静默读取错误对话。

六位节点的加载分为两个明确步骤：

1. “计算节点站位”从开始节点沿 `NextID` 链读取到指定节点，包括关闭 UI 或
   没有对白的中间节点。
2. 每个节点先应用 `Dialog.RelativeTransformsString`，再按顺序执行
   `ERotate`、`EWalk` 和 `EStateMachineWalk`；走位终点采用动作中的 UE
   局部坐标，朝向采用明确的节点旋转或移动方向。
3. 俯视图绘制 BP 原位、位移路径、节点位置和节点朝向，并逐槽显示对应世界
   坐标、位移距离及动作次数。俯视图固定在左侧，右侧角色列表独立滚动。
4. 站位图生成后隐藏“按 BP 注册到对话”，用户确认后点击“写入到 UE”。工具
   将各槽 Transform 换算为世界坐标，直接在用户当前打开的 UE 关卡中生成
   editor-only Actor；不校验或切换 `PreviewLevel`。
5. 加载后自动选中位置或朝向发生变化的非玩家角色；进入“注册 NPC”并读取
   UE 选择，即可复用现有模型/NPC 匹配和目标物表写入流程。

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

组件按当前 BP 对应对话中的有效发言次数降序创建并连续编号；关闭对话框 UI
节点不计入发言次数，同次数和未发言目标物保持任务中的相对顺序。无法从 BP
解析对话或本地没有对应对话数据时回退为任务顺序。未勾选目标物不会创建 BP
组件，也不会在 `DialogModels` 中写入 `None` 占位：

```text
0    ChildActorComponent -> /Game/Seria/Characters/Eric/BP_Eric
1..N ChildActorComponent -> 对应序号中已勾选目标物的模型资产
c1   CameraComponent
```

玩家没有任务坐标，因此仅作为占位放在 `(X=0,Y=0,Z=100)`，朝向为零。任务
顺序中第一个已选目标物仍作为局部坐标锚点；角色槽位排序不会改变该锚点。
全部目标物减去锚点世界位置并统一增加 100cm 的 Z 基准，因此保留目标物之间
的原始相对位移。
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

- 空 BP 与已解析任务配合时，列表按任务目标物原始顺序显示候选项；创建时只
  写入已勾选目标物，并按对应对话的发言次数降序连续映射到 `1..N`，平票保持
  任务顺序。
- 已包含数字站位槽的 BP 会切换为独立的 BP 槽位注册列表，主按钮改为
  “按 BP 注册到对话”；已有槽位置顶、标绿、固定勾选且不可取消。
- 同时解析任务节点时，已映射到 BP 的目标物不会在候选区重复出现；其余实际
  模型保留在下方，可勾选后从现有最大数字槽位继续追加。
- `DialogNPCTable.CharacterBPPath` 与 BP 模型类路径完全一致时，使用该行名
  作为 `DialogModels` 值。
- 一个类路径对应多个行名时，优先保留对话中已注册的名称；未注册时优先选择
  与 BP 资源名一致的行名。BP 资源名以 `_Npc` 结尾时，允许去掉该后缀后做
  唯一匹配；仍有多个候选时保持未登记，不进行模糊猜测。
- 已有非空对话槽显示“已注册”，可映射空槽显示“待注册”，无映射槽显示
  “未登记”。
- 全部数字角色位都会显示和计数。0 号位固定勾选并写为 `player`；其余模型槽
  也固定保留，并按 BP 原槽位序号写入。
- 找不到 `DialogNPCTable` 映射的已选模型保持
  `None` 并在结果中列出。

创建空 BP 时，“创建 BP”会在 BP 保存后同步注册 `player` 和已勾选目标物，
未勾选项不会进入 `DialogModels`。仅输入并检查已有 BP 时，不需要任务节点，
按钮直接切换为“注册到对话”。已有 BP 同时加载任务时，如果勾选了候选目标物，
主按钮切换为“添加到 BP 并注册”；新增组件保持任务顺序，从现有最大槽位号后
连续命名，原有组件不会重命名或删除。没有勾选候选项时仍只注册现有 BP。
写入通过 OmniMcpCore 的对象属性与资产保存接口完成，不直接修改 `.uasset`
二进制；写后回读整个数组，完全一致才执行保存。界面中的角色总数包含 0 号
玩家，不再以“非玩家模型数”代替完整角色数。

注册已有 BP 时还会检查对话空间配置。`Virtual=true`、主角初始坐标和
`PreviewLevel` 均已配置时保持原值，不扫描关卡。如果存在缺失项：

1. 优先读取 UE 当前选择中与目标 BP Generated Class 完全一致的 Actor。
2. 当前选择没有匹配项时，扫描当前地图中的同类 BP Actor。
3. 唯一匹配时，用 Actor 世界位置补 `PlayerInitPosition`，用世界旋转补
   `PlayerForward`，并把当前地图写入 `PreviewLevel`。
4. 多个匹配实例时停止写入，要求用户在 UE 中只选择一个。
5. 已存在的坐标或地图字段不会被覆盖；只补缺失值并勾选虚拟场景。

写入缺失空间配置时会先单独启用并回读 `Virtual`，再写
`PlayerInitPosition`、`PlayerForward` 和 `PreviewLevel`，兼容 UE 只有在虚拟
场景启用后才接受主角初始 Transform 的条件字段行为。

空间配置回读按 UE 语义比较：布尔值兼容布尔、数值和字符串表示，
`PreviewLevel` 兼容包路径、对象路径、软对象引用和 UE 返回的
`World_<地图资源名>` 简写。完整路径之间仍严格比较，只有一侧为短名称时才按
资源名回退匹配。若仍不一致，错误会分别指出 `Virtual`、
`PlayerInitPosition`、`PlayerForward` 或 `PreviewLevel` 的实际问题。

如果关卡中没有对应 BP Actor，但同时提供了任务节点，仍可使用任务目标物
映射推算坐标和地图。两种方式都不可用时只完成模型注册并提示空间配置仍
不完整，不猜测世界坐标。

## BP 与目标物位置同步

同时输入任务节点 ID 和已有 BP 后，检查流程会从桌面端保存的 `csvdir` 路径
重新读取任务、目标物、NPC、模型和地图配置，不再要求重新选择 doc 文件夹。
如果 BP 的 Formation、DialogModels 和目标物模型能够可靠对应，窗口提供两个
显式操作：

- “修改 BP 位置”：以最新目标物世界坐标更新 BP 中对应数字槽位的
  `RelativeLocation` 和 `RelativeRotation`。
- “BP → 目标物”：结合对话开始节点的 `PlayerInitPosition` 和
  `PlayerForward`，把 BP 局部变换还原为世界坐标，再按目标物 ID 写入 Excel
  源表；位置和旋转单元格标红，工作簿保持未保存。

映射不依赖任务顺序。工具优先按模型类路径匹配；同一模型存在多个实例时，
使用当前 BP 世界位置进行距离消歧。没有匹配的目标物和 BP 额外槽位都会列出
并保持不变。缺少有效 `PlayerInitPosition` 时允许“目标物 → BP”建立坐标
原点，但阻止“BP → 目标物”，避免把局部坐标误写成世界坐标。

正向同步还会补齐同一开始节点上的空间配置：

- `Formation` 指向当前 BP Generated Class。
- `PreviewLevel` 使用任务 MapID 对应地图的完整对象路径。
- `CommonDialogGraphProperties.Virtual=true`，并同步特殊属性镜像。
- `PlayerInitPosition` 写入 BP 在地图中的世界坐标。

新建 BP 时，首个实际目标物仍位于局部 `(0,0,100)`，因此 BP 世界坐标为该
目标物世界坐标减去 `(0,0,100)`。已有 BP 优先保留已配置的世界原点。

## 导入背景资产

输入 BP 文件名后，可以在 UE 关卡中选择 Actor，并点击任务目标物工作区
右上角的“读取 UE 选择”。如果当前已经解析任务节点，工具会先识别所选 Actor
是否属于当前任务目标物：

- 优先按 `ShotSandboxMissionTargetPreview_<任务ID>_<目标物ID>` 精确匹配。
- 普通关卡 Actor 按模型类路径匹配；同模型存在多个实例时按世界坐标距离
  一对一消歧。
- 匹配成功后只勾选对应目标物并取消其他可追加项；已经存在于 BP 的槽位仍固定
  保留。
- 混合选择时，已匹配 Actor 不进入背景审核，只有未匹配 Actor 继续下面的
  背景资源流程。没有解析任务节点或完全未匹配时，保持原背景资源导入行为。
- 已匹配 Actor 的引用、位置和旋转会保留在当前工作区。随后进入“修改位置”时
  直接以该 Transform 填充待修改草稿，无需在编辑页重复执行“读取 UE 选择”；
  编辑页仍保留重新读取入口用于 UE 选择已经变化的情况。

背景资源流程只向 BP 添加非数字命名的展示组件，不新增目标物，不修改
`DialogModels`：

- Blueprint Actor 写为 `ChildActorComponent` 和对应 Generated Class。
- 关卡图生成的 `SceneObject` NPC 从 `child_preview_class` 解析实际 NPC
  Generated Class，使用包装 Actor 的世界 Transform，并继续参与任务目标物
  模型匹配；匹配成功后沿用 BP 数字槽和 `DialogModels` 注册流程。
- SkeletalMeshActor 写为 `SkeletalMeshComponent` 和实际 Skeletal Mesh。
- StaticMeshActor 写为 `StaticMeshComponent` 和实际 Static Mesh。
- Cascade Emitter 写为 `ParticleSystemComponent` 和实际 Particle System。
- Niagara Actor 写为 `NiagaraComponent` 和实际 Niagara System。
- 其他 Actor 显示为不支持，不参与写入。
- 任务节点与对话节点都为空时，工具按 BP 父类分流。`TaskActorBase` 不要求
  BP 文件名包含对话数字 ID，优先使用 UE 当前选择中的目标 BP Actor 作为
  坐标原点；未选中目标 BP 时，可回退到当前关卡中的唯一同类 BP 实例。无法
  唯一确定实例时停止写入并提示用户选择。`PositionModeBase` 仍按原流程查找
  对话资产并校验空间配置。

组件名直接使用资产名，例如 `SK_Banner` 或 `BP_BackgroundNpc`。BP 中已有同名
同资产组件时更新 Transform；已有同名不同资产或一次选择中存在多个同名资产
时停止该项，不自动重命名。

`PositionModeBase` 使用 `PlayerInitPosition` 和 `PlayerForward` 把所选 Actor
的世界 Transform 转换为 BP 局部 Transform，并校验当前地图与
`PreviewLevel` 一致。双节点输入为空的 `TaskActorBase` 改用 UE 中目标 BP
Actor 的世界 Transform 完成相同换算。两种路径都会完整写入位置、旋转和
`RelativeScale3D`，因此均匀、非均匀和负缩放都可保留。BP 或选择变化会使
预检令牌失效并要求重新检查。

如果对话缺少 `Formation`、`PreviewLevel`、虚拟场景或主角初始 Transform，
审核层会提供“补齐对话配置”。该操作保留现有 `DialogModels`，优先使用当前
选择或地图中的唯一同类 BP Actor 确定世界位置；已有主角位置与地图时不会覆盖。
补齐后自动重新读取 UE 选择，用户仍需勾选并确认后才会写入 BP。

## 主要代码

- `src/data/csv.ts`：分块解析任务、目标物、NPC、模型、地图和场景资源 CSV。
- `src/data/csvLoader.ts` 与 `src/data/csv.worker.ts`：读取目录并在独立 Worker
  中执行解析。
- `src/data/databaseIndex.ts`：缓存任务、目标物和地图 ID 索引。
- `src/data/missionTargetResolver.ts`：执行跨表解析和加载前硬校验。
- `src/data/missionTargetBlueprintSync.ts`：目标物与 BP 槽位映射及双向坐标换算。
- `server/ueBridge.ts`：自动开图、目标物预览及 Blueprint 业务实现。
- `server/ue/transport.ts`、`server/ue/services.ts`、`server/ue/routes.ts`：
  分别负责 UE TCP、服务门面和本地 HTTP 接口。
- `src/components/MissionTargetModal.tsx`：任务输入、变更摘要与目标物详情。
- `src/ue/client.ts`：前端 UE API 客户端。
