# UE Blueprint 站位集成

## 当前范围

当前版本只从 UE4 编辑器读取对话 Blueprint 的初始角色站位，不修改或保存
任何 `.uasset`。该集成只面向 Windows 桌面版，不提供移动端运行或测试目标。

用户查询真实配置中的四位数对话 ID 后，程序会：

1. 根据开始节点定位完整对话链。
2. 优先读取 `DialogStart.Formation` 指定的 Blueprint。
3. 当 Formation 为空时，通过 UE Asset Registry 搜索
   `BP_<开始节点ID>`。
4. 读取 Blueprint SCS 中数字命名的 `ChildActorComponent`。
5. 使用开始节点的 `DialogStart.Model` 筛选有效模型槽。
6. 将 BP 站位与自动站位同时展示，由用户选择。
7. 用户确认站位后，才使用所选站位计算角色关系轴和镜头。

BP 查询期间不会先把自动站位规则分镜写入主画布，因此一次分析只会展示
最终选定站位生成的方案。当前对话 ID 未改变时，从规则导演切换到 TRAE
协作会复用当前对话和已选站位直接发起 AI 分析，不会重新读取 Blueprint。
TRAE 返回逐角色站位建议后，用户可采用 AI 方案，也可保留当前方案。

Blueprint 不存在、UE 未启动、OmniMcpCore 未连接、桥接异常、查询超时或
有效角色不足两位时，程序不会中断对话加载，而是显示原因、跳过 BP 并继续
使用自动站位执行当前导演分析。UE 返回的 `None`、`null`、`nullptr`、`0`
和空字符串都按“资产不存在”处理，不会继续读取无效 Blueprint 属性。

## 数据来源

### 开始节点表

`对话表_开始节点.csv` 提供：

- `DialogStart.Formation`：Blueprint Generated Class 路径。
- `DialogStart.Model`：按模型槽位索引排列的模型名称；`None` 表示该槽未启用。

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
不会进入角色列表。

### 对话节点

CSV 解析器已经保留：

- `Dialog.CharacterBehaviourString`
- `Dialog.RelativeTransformsString`

当前阶段仅从 `CharacterBehaviourString` 中识别唯一的 `AM_Talk` 槽位，用于
区分同一 NPC ID 对应的多个场内实例。节点走位播放将在后续阶段实现。

## 身份模型

NPC ID 仍是角色叙事身份和角色资料查询键。空间层额外使用实例身份：

```text
instanceId = bp:<BlueprintAssetPath>:<ModelIndex>
```

这是必要约束。同一 NPC ID 或同一模型可以同时出现在多个 BP 槽位中，不能
用 NPC ID 作为 React key、空间索引或 UE 回写目标。

对话行优先通过 `AM_Talk` 推断出的模型索引绑定说话实例；没有明确槽位时，
沿用该 NPC 最近一次已确定的说话实例，最后才回退到第一个候选实例。

## 坐标转换

UE 使用厘米和 `X 前 / Y 右 / Z 上`，Three.js 舞台使用米和
`X 右 / Y 上 / Z 后`。当前转换为：

```text
Three.x = UE.y / 100
Three.y = 0
Three.z = -UE.x / 100
```

导入后以有效角色的中心点平移到沙盘原点，只改变预览坐标，不改变 UE 原始
Transform。Yaw 被转换为角色朝向向量。

## 通信

前端调用：

```text
POST /api/ue/formation/read
```

Node/Electron 主进程通过 `127.0.0.1:12031` 连接项目现有的
`OmniMcpCore`，调用：

- `asset.asset_search`
- `bp.get_blueprint_by_path`
- `reflect.read_object_property`

通信仅限本机，当前没有任何写操作。端口可通过 `UE_MCP_HOST` 和
`UE_MCP_PORT` 覆盖。

## 主要代码

- `server/ueBridge.ts`：UE TCP 协议、资产检索和 SCS 读取。
- `src/ue/client.ts`：前端只读 API 客户端。
- `src/data/csv.ts`：Formation、Model、模型资源和动作字段解析。
- `src/data/blueprintFormation.ts`：模型槽与 NPC 实例映射、坐标转换。
- `src/components/BlueprintFormationModal.tsx`：BP/导演站位选择。
- `src/director/blockingResolver.ts`：保留输入站位的镜头求解模式。

## 后续阶段

1. 将 `RelativeTransformsString` 解析为逐节点 Transform 时间线。
2. 结合 `CharacterBehaviourString` 的 `AM_Walk` 起止点和时间播放平滑走位。
3. 对跨越走位节点的镜头执行切镜或跟拍约束。
4. 增加 BP 写回前的差异确认、SVN checkout、UE Transaction、编译和回读。
5. 单独实现 DialogGraph 节点走位回写；禁止直接修改导出的 CSV。
