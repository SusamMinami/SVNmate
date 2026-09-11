# 本地对话图插件可行性实测

## 结论

本轮完成了运行中 UE 的只读能力探测，**没有完成节点创建或连线写入实验，
也没有编译、安装插件**。当前主要限制是：

1. 这份策划 UE 安装缺少 Core/UnrealEd C++ 头文件及所检查的 UnrealEd 链接库，
   不能仅凭已安装的 Visual Studio 编译 Editor 插件。
2. 当前公开 Python/反射入口没有找到 Seria 对话节点创建方法。
3. MCP 已有连线入口，但签名兼容不等于经过 Seria 图业务验证。

这不表示独立插件不可实现，也不表示必须修改原编辑器源码。补齐匹配构建环境后，
仍可验证能否通过公开 UEdGraphSchema/Schema Action 虚函数调用原生创建逻辑。

## 实测环境

- 项目：`C:/trunk/res/Seria.uproject`
- UE：`4.27.2-0+++UE4+Seria-4.27`
- 引擎根目录：`C:/trunk/bin/Engine/UE4Engine`
- 连接：现有本机 OmniMcpCore，默认端口 `12031`
- Visual Studio 2022 C++ 工具存在；尚未验证是否满足该定制 UE 的工具链版本要求。
- `SeriaDialogEditor` 插件目录中没有找到 C++ 头文件、源码或 `.lib`。
- 引擎有 Build.bat、UnrealBuildTool.exe，但缺少
  `Engine/Source/Runtime/Core/Public/CoreMinimal.h` 和
  `Engine/Source/Editor/UnrealEd/Public/EdGraphUtilities.h`。

机器可读结果保存在
`artifacts/local-dialog-probe/20260911-capabilities.json`，包含运行版本、
插件 DLL SHA-256、函数签名、反射方法列表和探测前后脏包集合。
这是本机生成记录，不是应随插件发布的配置。

## 接口证据

| 能力 | 结果 | 解释 |
| --- | --- | --- |
| 获取 UE 版本、PIE 状态 | 成功 | 本轮 PIE 为 false |
| Seria 当前选择、属性写入接口 | 元数据可见 | 本轮没有调用属性写入 |
| `SeriaDialogGraph` 类型 | 继承 Object，而非 Blueprint | 不能直接当作普通 Blueprint 传入 |
| `add_node_from_action` | 参数 `bp (Blueprint)` | 尚无支持 Seria 图的证据 |
| `list_available_nodes` | 参数 `bp (Blueprint)` | 不是通用自定义图菜单枚举 |
| `import_subgraph` | 参数 `bp (Blueprint)` | 不能作为对话子图导入替代 |
| `connect_pins` | 参数 `node_a/node_b (EdGraphNode)` | Seria 节点继承此类，仅说明类型兼容 |
| `get_graph_node_info` | 参数 `node (EdGraphNode)` | 可作为后续读取候选 |
| `SeriaDialogGraphSchema` 反射方法 | 仅返回继承的 `ExecuteUbergraph` | 未找到反射可调用的创建/连线方法 |
| `SeriaDialogGraphFactory` | Python 可见 | 是资产工厂，不是已有图中的节点工厂 |

额外通过 `dumpbin /exports` 只读检查 SeriaDialogEditor DLL：存在 Schema 类和
Schema Action 结构的反射注册导出，未在导出名称中发现
`CreateDialogNode`、`PerformAction` 或 `TryCreateConnection`。
这不能排除经基类虚函数间接调用，也不能据此推断内部没有对应实现。

当前选择接口在无有效选中节点时返回 `None`，调用方不能直接 `list(None)`。

## 本轮保护

- 未执行节点创建、断线、连线、保存、加载资产或修改选择。
- 未改 `.uproject`、原插件 DLL、引擎文件或 SVN 配置。
- 探测前后脏内容包和脏地图包集合相同，已有未保存工作保持原状。
- 脏包集合一致仅是辅助检查，不等于逐字节的资产内容校验。
- 网络错误直接终止，无自动重试写入。
- 工作区只新增只读探测脚本及本说明，未调整现有产品流程。

## 重复探测

在 `dialogue-shot-sandbox` 目录运行，UE 需处于非 PIE、非保存/编译状态：

```powershell
node --import tsx scripts/probe-dialog-graph-capabilities.ts `
  --engine-root "C:/trunk/bin/Engine/UE4Engine" `
  --project-root "C:/trunk/res"
```

可选 `--out <新文件路径>` 保存 JSON。脚本拒绝覆盖已有报告；
不传此选项则只输出结果。插件更新后可对比方法列表和 DLL 指纹。
此脚本不执行 Graph Patch，也不能验证事务恢复与运行顺序。

## 下一阶段的最小输入

取得与当前定制 UE 构建匹配的开发包或可构建源码环境：

- 引擎头文件、生成文件和链接依赖，以及对应工具链要求。
- 如公开基类接口不足，再需要 Seria 的公开头文件/导出入口。
- 或直接取得程序/构建系统产出的匹配版本独立插件包。

不能用标准 UE 4.27 开发包替代定制构建并假设 ABI 一致，不修改 BuildId
强制加载，不通过内存地址调用未公开函数。

具备环境后，先在独立目录构建 Editor-only 插件；检查插件仅创建项目原有节点
类型。经确认部署后，在隔离测试资产验证两个普通节点、原生 Schema 连线、
内部 ID/运行数据一致性、Undo/Redo、失败恢复、保存重开及 CSV 副作用。
不以修改 `Graph.Nodes` 数组或裸 `NewObject` 代替原生节点工厂。

## 第二轮：公共 Schema 路线

已只读加载 `/Game/Seria/Task/dialoggraph/100000.100000` 并实际查询：

- Python 的 `get_editor_property('EdDialogGraph')` 报 protected，无法直接读取；
  现有 MCP `reflect.read_object_property` 成功返回内部图。
- 图的 `Schema` 为 `/Script/SeriaDialogEditor.SeriaDialogGraphSchema`。
- 图包含两个 `SeriaEdDialogGraphNode`，`bp.get_graph_node_info` 可读取两者。
- 起始节点输出连接普通对话节点输入；普通节点还存在未连接输出。
- **输入和输出 Pin 的名字均为 `None`。** 现有 `connect_pins` 仅接收名称，
  类型兼容不足以保证正确定位，仍未执行连线验证。
- 加载与查询后没有新增脏内容包，没有保存资产、改变连接或写入 CSV。

新增独立插件源码位于 `tools/local-dialogue-probe/`：

- 仅依赖公共 Core、CoreUObject、Engine、UnrealEd、Json、SlateCore 模块。
- 通过反射取得 Graph，通过公共虚函数 `GetGraphContextActions` 枚举动作。
- 默认只读已加载图；动作枚举限定测试目录，不执行创建动作或连线。
- 这是未编译原型，不是已经可用的插件。真实 Schema 动作枚举尚未执行。

已运行 `Build-Probe.ps1 -Build`，缺少必要头文件/模块规则，
前置检查阻断了 UAT 启动；没有生成 DLL，也没有部署到 UE。
后续应取得匹配的开发环境，再完成编译及测试目录内的动作枚举。

第二轮元数据探测结果：
`artifacts/local-dialog-probe/20260911-schema-followup.json`。
其中插件文件指纹与第一轮一致，探测前后脏内容包/地图包集合一致。
