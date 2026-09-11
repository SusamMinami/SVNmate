# Local Dialogue Schema Probe

实验性 Editor-only 插件源码，**未编译、未安装、未验证 C++ 运行行为**。
不依赖 Seria 私有头文件，不修改原插件，不包含节点创建或连接写入接口。

## 本轮目标

验证独立 C++ 模块能否通过公共 `UEdGraphSchema` 虚函数枚举 Seria 创建动作：

```text
已加载的 SeriaDialogGraph
 -> 反射读取 EdDialogGraph
 -> UEdGraph::GetSchema()
 -> UEdGraphSchema::GetGraphContextActions()
 -> 返回动作类型、标题、类别
```

动作枚举成功后，才有依据在下一阶段研究 `PerformAction`。动作可能依赖
编辑器 Toolkit、FromPin、配置表或当前选择；空列表并不等于没有创建能力。

## 构建

要求匹配 `++UE4+Seria-4.27` 的完整开发环境。标准 UE4.27 SDK 不能作为
二进制兼容性的替代证明。BuildId 不匹配时不得改清单强制加载。

只检查必需文件，不启动构建：

```powershell
pwsh -File tools/local-dialogue-probe/Build-Probe.ps1 `
  -EngineRoot "C:/trunk/bin/Engine/UE4Engine"
```

在具备匹配环境后请求构建，输出目录必须不存在且与源码/引擎目录无重叠：

```powershell
pwsh -File tools/local-dialogue-probe/Build-Probe.ps1 `
  -EngineRoot "C:/MatchingUE" -Build `
  -PackagePath "C:/LocalTools/Builds/LocalDialogueProbe-build1"
```

脚本使用 UAT BuildPlugin 的临时宿主工程，不构建生产 Seria.uproject；
不会自动安装、启用插件、替换 DLL 或保存资产。必需文件检查失败时不启动 UAT。
文件齐备也不保证编译通过，需依据匹配 SDK 调整 API 差异。

本机实际检查结果：缺少 CoreMinimal.h、UnrealType.h、EdGraphSchema.h、
Editor.h 和 UnrealEd.Build.cs，构建被前置检查阻断，未生成 DLL。

## 安装后的人工实验步骤

以下尚未执行，必须先编译通过并取得本地插件安装许可：

1. 核对构建兼容性，关闭 UE 后部署独立插件目录，单独启用它。
2. 首先只读取已打开的对话资产，`bEnumerateActions=false`。
3. 在隔离工程中准备测试副本，路径必须位于
   `/Game/Developers/LocalDialogueToolsProbe/`，保持原 Seria 节点类型。
4. 测试副本应已加载、没有未保存修改，再执行动作枚举。
5. 保存结果，确认脏状态、节点数量及字段/边均未改变，再讨论创建实验。

新增函数经 UFUNCTION 暴露，可通过现有 MCP/Python 调用，不另开端口：

```python
unreal.LocalDialogueProbeLibrary.inspect_loaded_dialog_graph(
    "/Game/Developers/LocalDialogueToolsProbe/100000.100000",
    True
)
```

路径只是示例，本工具不会创建或复制该资产。

## 安全边界与未验证项

- 默认仅检查已加载资产，不自动加载、选中、保存或修改原图。
- 枚举只允许测试目录中的干净资产。Schema 自定义枚举逻辑可能创建临时模板对象，
  因此不能把枚举描述为绝对无副作用。
- 提供基础 Game Thread、GC、异步加载、保存和 PIE 检查；不宣称覆盖定制编辑器
  的所有编译/重载忙状态，需在空闲隔离环境试验。
- 枚举后的脏状态与节点数组检查只是有限检查，不能替代完整字段/边快照。
  检测异常时报告失败，不擅自回滚或保存。
- 不执行 `PerformAction`、`TryCreateConnection`，不修改 NodeData 或 ID。
- 动作索引仅属于本次枚举结果，不能缓存用于下一次写入。
- 当前样本的输入和输出 Pin 都叫 `None`。正式连线应按准确 PinId/方向定位，
  不能直接依赖仅按名称匹配的 MCP `connect_pins`。
- 不调用 Seria 导出函数，避免对正式 CSV 产生副作用。

只有“枚举成功 -> 隔离创建 -> 精确连线 -> ID/运行数据校验 -> Undo/Redo ->
失败恢复 -> 保存重开与导出检查”均通过，才能提供 AI Graph Patch 写入。
