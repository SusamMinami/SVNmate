# UE 编辑器资产 Patch 接口需求

> 面向 UE 程序的接口需求  
> 覆盖范围：对话图节点自动创建与连接、LevelSequence 字幕与跳过配置  
> 原则：最小化 UE 修改，复用现有 OmniMcpCore，不新增通信协议和端口

## 1. 背景

镜头沙盘计划新增“动画语音助手”，并扩展已有的对话文件编辑能力。沙盒负责：

- 生成待创建的对话节点、连接关系和节点属性。
- 生成动画字幕 ID、字幕时间段和跳过配置。
- 展示 dry-run 差异并由用户确认。
- 处理 Excel 配表、AI 分析和交互界面。

UE 只负责按照编辑器原生规则安全修改资产。不能让沙盒直接修改 `.uasset`，也
不能依赖鼠标坐标、剪贴板或 UI 自动化完成正式写入。

当前 OmniMcpCore 已支持反射调用 UFUNCTION。因此 UE 侧只需提供两个
Editor-only UFUNCTION，由沙盒通过现有 `reflect.execute_unreal_function`
调用，不需要修改 TCP 传输层。

## 2. 目标

### 2.1 对话图

- 读取完整且稳定的 DialogGraph 快照。
- 创建普通对白、开始、结束和分支等白名单节点。
- 写入节点属性。
- 在已有节点之间插入新节点。
- 显式连接或断开 Pin。
- 批量创建并按顺序连接。
- 返回 UE 分配的业务 ID、Node GUID 和 PinId。

### 2.2 LevelSequence

- 读取轨道、Section、时间轴、Director Blueprint 和 Marked Frame。
- 创建或复用 `UMovieSceneDialogueTrack`。
- 创建字幕 Section，写入 `DialogueID` 和起止时间。
- 创建或补齐动画跳过配置：
  - 名为 `skip` 的 Event Track。
  - 显示与隐藏跳过按钮的事件键。
  - 内嵌 Sequence Director Blueprint。
  - `Show SkipButton`、`HideSkipButton` 调用节点。
  - 名为 `skip` 的 Marked Frame。
- 对已有完整配置保持幂等，不产生重复轨道、Section、事件或标记。

## 3. 非目标

- UE 不负责 Excel、CSV 或配置打表。
- UE 不负责 ASR、字幕断句或字幕时间计算。
- 不开放任意类、任意属性和任意 Python 代码执行。
- 不把普通 Blueprint、DialogGraph 和 MovieScene 强行交给同一个节点工厂。
- 首版不自动修改父类错误的已有 Director Blueprint。
- 首版应用成功后只标记资产 Dirty，不自动保存。

## 4. 最小公共接口

建议在项目 Editor-only 模块中提供一个 `UEditorSubsystem` 或等价静态
Blueprint Library。不要把 Seria 业务逻辑写入 OmniMcpCore。

```cpp
UFUNCTION(BlueprintCallable, Category = "Seria|EditorPatch")
bool GetEditorAssetSnapshot(
    const FString& AssetKind,
    const FString& AssetPath,
    FString& OutSnapshotJson,
    FString& OutError);

UFUNCTION(BlueprintCallable, Category = "Seria|EditorPatch")
bool ApplyEditorAssetPatch(
    const FString& PatchJson,
    bool bDryRun,
    FString& OutResultJson,
    FString& OutError);
```

支持的 `AssetKind`：

```text
dialog_graph
level_sequence
```

如果模块依赖关系不允许提供统一入口，也可以暴露四个函数：

```text
GetDialogGraphSnapshot
ApplyDialogGraphPatch
GetLevelSequenceSnapshot
ApplyLevelSequencePatch
```

但请求信封、结果格式、事务、版本校验和错误码应共用。

## 5. 公共请求信封

```json
{
  "schema_version": 1,
  "request_id": "29cc3547-2905-42c0-92aa-0c25eeb04865",
  "asset_kind": "dialog_graph",
  "asset_path": "/Game/Seria/Task/dialoggraph/705300.705300",
  "expected_revision": "sha256:...",
  "operations": []
}
```

字段要求：

| 字段 | 说明 |
| --- | --- |
| `schema_version` | 协议版本，未知版本必须拒绝 |
| `request_id` | 幂等键；重复请求不得重复创建对象 |
| `asset_kind` | `dialog_graph` 或 `level_sequence` |
| `asset_path` | 完整 UE 对象路径 |
| `expected_revision` | Snapshot 返回的确定性修订指纹 |
| `operations` | 有序执行的白名单操作，最多建议 500 项 |

## 6. 公共 Snapshot

```json
{
  "schema_version": 1,
  "asset_kind": "dialog_graph",
  "asset_path": "/Game/Seria/Task/dialoggraph/705300.705300",
  "revision": "sha256:...",
  "dirty": false,
  "editor_busy": false,
  "capabilities": {
    "dry_run": true,
    "transaction": true,
    "manual_save": true
  },
  "data": {}
}
```

`revision` 必须来自规范化后的业务数据和结构，不能使用 UObject 地址、加载顺序
或不稳定的导出文本空白。

## 7. 对话图 Snapshot

```json
{
  "nodes": [
    {
      "node_id": "705302",
      "node_guid": "3D9F...",
      "node_type": "action",
      "position": { "x": 420, "y": 320 },
      "properties": {
        "NPCID": 102001,
        "Content": "已有对白"
      },
      "pins": [
        {
          "key": "exec_in:0",
          "pin_id": "A31C...",
          "category": "exec",
          "direction": "in"
        },
        {
          "key": "exec_out:0",
          "pin_id": "FA21...",
          "category": "exec",
          "direction": "out"
        }
      ]
    }
  ],
  "edges": [
    {
      "from": { "node": "705302", "pin": "exec_out:0" },
      "to": { "node": "705303", "pin": "exec_in:0" }
    }
  ]
}
```

Pin 对外使用稳定语义键。无名称 Pin 使用：

```text
<category>_<direction>:<同类同方向序号>
```

例如：

```text
exec_in:0
exec_out:0
exec_out:1
data_in:0
```

真实 PinId 只用于快照和回读，不允许调用方生成。

## 8. 对话图 Patch 示例

```json
{
  "schema_version": 1,
  "request_id": "29cc3547-2905-42c0-92aa-0c25eeb04865",
  "asset_kind": "dialog_graph",
  "asset_path": "/Game/Seria/Task/dialoggraph/705300.705300",
  "expected_revision": "sha256:before",
  "operations": [
    {
      "op": "dialog.create_node",
      "temp_id": "new_1",
      "node_type": "action",
      "position": { "x": 840, "y": 320 },
      "properties": {
        "NPCID": 102001,
        "Content": "新建对白"
      }
    },
    {
      "op": "dialog.disconnect",
      "from": { "node": "705302", "pin": "exec_out:0" },
      "to": { "node": "705303", "pin": "exec_in:0" }
    },
    {
      "op": "dialog.connect",
      "from": { "node": "705302", "pin": "exec_out:0" },
      "to": { "node": "new_1", "pin": "exec_in:0" }
    },
    {
      "op": "dialog.connect",
      "from": { "node": "new_1", "pin": "exec_out:0" },
      "to": { "node": "705303", "pin": "exec_in:0" }
    }
  ]
}
```

`temp_id` 只在本次 Patch 内有效。真实节点 ID、GUID 和 PinId 必须由 UE 创建
后返回。

首版建议支持：

```text
dialog.create_node
dialog.set_properties
dialog.move_node
dialog.connect
dialog.disconnect
```

## 9. 对话图实现要求

1. 使用对话编辑器已有 Schema Action 或节点工厂，例如
   `SeriaEdDialogGraphSchemaActionNewNode::PerformAction` 或项目现有
   `CreateDialogNode`。
2. 让节点正常执行 `PostPlacedNewNode`、默认数据初始化和 Pin 分配。
3. 属性写入复用现有节点属性校验逻辑，但按资产路径和节点 ID 定位，不依赖当前
   编辑器选择。
4. 连接必须调用对应 Graph Schema 的 `TryCreateConnection()`。
5. 只有 Patch 明确包含 `dialog.disconnect` 时才允许断开旧连接。
6. 更新对话编辑器内部索引、业务 ID 映射和 NodeData。
7. 调用 `NotifyGraphChanged()`、`PostEditChange()` 和 `MarkPackageDirty()`。

禁止直接：

```cpp
NewObject<USeriaEdDialogGraphNode>()
```

直接创建容易遗漏 NodeData Outer、默认属性、Pin、内部索引和编辑器通知。

## 10. LevelSequence Snapshot

时间统一返回秒，同时保留原始帧率，避免 DisplayRate 与 TickResolution 混用。

```json
{
  "display_rate": { "numerator": 30, "denominator": 1 },
  "tick_resolution": { "numerator": 24000, "denominator": 1 },
  "playback": {
    "start_seconds": 0.0,
    "end_seconds": 34.333
  },
  "dialogue": {
    "track_count": 1,
    "sections": [
      {
        "section_id": "MovieSceneDialogueSection_0",
        "dialogue_id": 9032023,
        "start_seconds": 4.2,
        "end_seconds": 5.467
      }
    ]
  },
  "skip": {
    "complete": true,
    "track_id": "MovieSceneEventTrack_0",
    "show_time_seconds": 0.5,
    "hide_time_seconds": 33.833,
    "show_endpoint": "SequenceEvent_0",
    "hide_endpoint": "SequenceEvent_1",
    "mark": {
      "label": "skip",
      "time_seconds": 34.0
    },
    "skip_mode": "EFirstTimeCanNotSkipByAccount"
  },
  "director": {
    "exists": true,
    "blueprint": "SequenceDirector",
    "class": "SequenceDirector_C",
    "parent_class": "/Game/Seria/Sequences/CommonSequenceDirector.CommonSequenceDirector_C",
    "compile_status": "up_to_date"
  }
}
```

Snapshot 不能只根据轨道显示名判断配置完整，还应校验：

- Event Key 是否绑定到有效 Endpoint。
- Endpoint 是否连接正确的 Show/Hide 函数。
- Show 节点的 `Mark` 与 `SkipMode`。
- Director 父类和编译状态。
- `skip` Marked Frame 是否唯一且时间有效。
- Dialogue Section 的 `DialogueID`、范围、重叠和越界。

## 11. LevelSequence Patch 示例

```json
{
  "schema_version": 1,
  "request_id": "44aa7411-51ab-4a21-aa56-4013a92df355",
  "asset_kind": "level_sequence",
  "asset_path": "/Game/Seria/Sequences/Demo/LS_Demo.LS_Demo",
  "expected_revision": "sha256:before",
  "operations": [
    {
      "op": "sequence.upsert_dialogue_section",
      "temp_id": "subtitle_1",
      "stable_key": "voice:9032023",
      "dialogue_id": 9032023,
      "start_seconds": 4.2,
      "end_seconds": 5.6
    },
    {
      "op": "sequence.upsert_dialogue_section",
      "temp_id": "subtitle_2",
      "stable_key": "voice:9032024",
      "dialogue_id": 9032024,
      "start_seconds": 5.8,
      "end_seconds": 7.1
    },
    {
      "op": "sequence.ensure_skip_configuration",
      "show_time_seconds": 0.5,
      "hide_time_seconds": 33.8,
      "mark_time_seconds": 34.0,
      "mark": "skip",
      "skip_mode": "EFirstTimeCanNotSkipByAccount"
    }
  ]
}
```

首版建议支持：

```text
sequence.upsert_dialogue_section
sequence.remove_dialogue_section
sequence.ensure_skip_configuration
```

`remove_dialogue_section` 必须显式请求，`upsert` 不得隐式删除未出现在 Patch 中的
现有字幕。

## 12. 字幕轨实现要求

当前项目和实时 MCP 已验证以下能力可用：

- `UMovieSceneDialogueTrack`
- `UMovieSceneDialogueSection`
- `DialogueID`
- MovieScene Track/Section 创建
- Section 起止帧写入
- 保存并重新加载后回读

UE Handler 应：

1. 查找唯一的 `UMovieSceneDialogueTrack`，不存在时创建。
2. 使用 `stable_key` 和 `DialogueID` 匹配已有 Section。
3. 创建新 Section 时由 UE 分配对象名。
4. 将秒转换到 Sequence 的 TickResolution。
5. 校验 `0 <= start < end <= playback_end`。
6. 默认拒绝字幕重叠；如项目允许重叠，应由显式参数开启。
7. 写入后重新读取 `DialogueID` 和范围。

调用方传秒，不直接传 TickResolution FrameNumber。

## 13. 跳过配置实现要求

`sequence.ensure_skip_configuration` 是一个原子复合操作。

### 13.1 Director Blueprint

1. 没有 Director Blueprint 时，直接创建内嵌 Director Blueprint。
2. 创建时父类直接指定为：

```text
/Game/Seria/Sequences/CommonSequenceDirector.CommonSequenceDirector_C
```

3. 不先创建默认父类再由沙盒修改父类。
4. 已有 Director 且父类正确时复用。
5. 已有 Director 但父类错误时，首版返回：

```text
DIRECTOR_PARENT_MISMATCH
```

不要自动重设父类，以免破坏已有变量、覆盖函数或 Event Endpoint。

必须使用 LevelSequenceEditor/MovieSceneTools 创建 Director 的原生路径。普通
`bp.create_blueprint` 创建的是独立 Blueprint 资产，不能代替 LevelSequence
内嵌的 Sequence Director。

### 13.2 Blueprint 节点

在 Director 的 `Sequencer Events` 图中：

- 创建两个由 UE 命名的 Event Endpoint。
- Show Endpoint 调用 `CommonSequenceDirector` 的显示跳过按钮函数。
- Hide Endpoint 调用 `CommonSequenceDirector` 的隐藏跳过按钮函数。
- Show 调用写入：
  - `Mark = "skip"`
  - `SkipMode = EFirstTimeCanNotSkipByAccount`，或请求中的显式值。

`SequenceEvent_x` 名称、Graph GUID、Node GUID、函数入口和 FieldPath 必须由
UE 原生 MovieScene Event Endpoint 工具生成。调用方不得猜测。

不要直接拼装 `FMovieSceneEvent` 的 `Ptrs.Function`、`WeakEndpoint` 或
`FieldPath`。

### 13.3 Event Track

1. 查找语义上属于跳过配置的 Event Track。
2. 不能只依赖显示名 `skip`，还要检查事件 Endpoint 指向。
3. 不存在时创建 `UMovieSceneEventTrack` 和
   `UMovieSceneEventTriggerSection`。
4. 创建两个事件键并绑定 UE 创建的 Endpoint。
5. 时间由秒转换为 TickResolution。
6. 已存在正确 Endpoint 时只调整时间，不重复创建节点。

### 13.4 Marked Frame

- 保证存在且仅存在一个 Label 为 `skip` 的 Marked Frame。
- 时间由秒转换为 TickResolution。
- 同名标记存在但时间不同，应在 dry-run 中显示移动差异。
- 不得删除其他 Label 的标记。

## 14. 公共执行流程

```text
解析并校验 JSON
  -> 定位资产
  -> 检查编辑器忙状态和脏状态
  -> 生成规范化 Snapshot 与 revision
  -> 校验 expected_revision
  -> 由对应 Handler 预检全部 Operation
  -> 生成差异
  -> bDryRun=true 时直接返回
  -> 开始 FScopedTransaction
  -> Asset/Graph/MovieScene/Blueprint Modify()
  -> 按顺序应用 Operation
  -> 编译或刷新
  -> 全量回读受影响对象
  -> 返回新 revision 和差异
  -> MarkPackageDirty，不自动保存
```

## 15. 事务与恢复

`FScopedTransaction::Cancel()` 不等于资产已经恢复。

要求：

1. 应用前保存本次将修改的节点、边、Section、事件和标记快照。
2. 任一步骤失败时显式恢复本批次已修改内容。
3. 恢复后再次回读确认。
4. 回滚失败时返回 `ROLLBACK_FAILED`，不能报告普通失败。
5. 一个 Patch 必须能由一次 Undo 完整撤销。
6. 首版检测到资产已有未保存修改时拒绝执行。

## 16. 幂等与并发

- `request_id` 在编辑器会话内幂等。
- 相同 `request_id` 和相同内容重复调用，返回首次结果。
- 相同 `request_id` 但内容不同，返回 `REQUEST_ID_CONFLICT`。
- `expected_revision` 不一致返回 `REVISION_CONFLICT`。
- `stable_key` 用于匹配业务对象，不使用临时 UObject 名称。
- 写入期间锁定同一资产的其他 Patch。

## 17. 安全限制

- 所有 UObject 修改必须在 Game Thread 的安全编辑阶段执行。
- 保存、自动保存、GC、资产重载、编译或 PIE 冲突时返回 `EDITOR_BUSY`。
- 节点类型、属性名、函数和 Track 类型必须白名单化。
- 限制 Patch 大小、Operation 数量、字符串长度和坐标范围。
- 禁止访问 `/Engine`、插件内容和配置外目录，除非显式加入白名单。
- 禁止任意 Python、任意 UFunction 和任意反射属性写入。
- 错误日志不得输出完整对白正文或整份资产数据。

## 18. 返回结果

```json
{
  "status": "preview",
  "request_id": "44aa7411-51ab-4a21-aa56-4013a92df355",
  "asset_kind": "level_sequence",
  "asset_path": "/Game/Seria/Sequences/Demo/LS_Demo.LS_Demo",
  "revision_before": "sha256:before",
  "revision_after": "sha256:after",
  "dirty": true,
  "saved": false,
  "created": {
    "subtitle_1": {
      "object_name": "MovieSceneDialogueSection_3"
    }
  },
  "diff": [
    {
      "kind": "dialogue_section_added",
      "dialogue_id": 9032023,
      "start_seconds": 4.2,
      "end_seconds": 5.6
    },
    {
      "kind": "skip_configuration_completed"
    }
  ],
  "warnings": [],
  "validation": {
    "compiled": true,
    "readback": true,
    "undo_available": true
  }
}
```

`bDryRun=true` 时：

- `status = "preview"`。
- `revision_after` 可以返回预计值或留空。
- `dirty` 必须保持原值。
- `created` 返回预计对象，不返回伪造 GUID。

实际应用后：

- `status = "applied"` 或 `"no_changes"`。
- 返回真实对象名、节点 ID 和 GUID。

## 19. 错误码

| 错误码 | 说明 |
| --- | --- |
| `INVALID_REQUEST` | JSON、版本、类型或字段无效 |
| `ASSET_NOT_FOUND` | 资产不存在 |
| `ASSET_KIND_MISMATCH` | 资产类型与 Handler 不匹配 |
| `EDITOR_BUSY` | 保存、GC、编译、PIE 等忙状态 |
| `DIRTY_ASSET` | 资产已有未保存修改 |
| `REVISION_CONFLICT` | 快照后资产发生变化 |
| `REQUEST_ID_CONFLICT` | 幂等键被不同内容复用 |
| `UNSUPPORTED_OPERATION` | Operation 不在白名单 |
| `NODE_ID_CONFLICT` | 对话业务 ID 冲突 |
| `CONNECTION_REJECTED` | Graph Schema 拒绝连接 |
| `DIRECTOR_PARENT_MISMATCH` | 已有 Director 父类不符合要求 |
| `EVENT_ENDPOINT_FAILED` | MovieScene Event Endpoint 创建或绑定失败 |
| `TIME_RANGE_INVALID` | Section 或事件时间无效 |
| `COMPILE_FAILED` | Blueprint 编译失败 |
| `READBACK_MISMATCH` | 写后回读不一致 |
| `APPLY_FAILED` | 应用失败且已恢复 |
| `ROLLBACK_FAILED` | 应用失败且恢复也失败 |

## 20. 验收用例

### 20.1 对话图

1. 在 A 与 B 之间插入一个普通对白节点，连接变为 `A -> X -> B`。
2. 批量创建多个节点并顺序连接，业务 ID 和 GUID 唯一。
3. 创建分支并连接多个出口。
4. 非法节点类型、属性或 Pin 被拒绝且资产不变。
5. Schema 拒绝连接时整个 Patch 回滚。
6. 重复 `request_id` 不产生重复节点。
7. dry-run 后人工修改资产，正式应用返回 `REVISION_CONFLICT`。
8. 一个 Undo 能撤销整个批次。

### 20.2 LevelSequence

1. 空 Sequence 能创建 Dialogue Track 和多个字幕 Section。
2. `DialogueID`、开始和结束时间保存重开后保持一致。
3. 空 Sequence 能创建正确父类的 Director、Show/Hide Endpoint、事件键和
   `skip` 标记。
4. 已有完整跳过配置时返回 `no_changes`。
5. 只有轨道、只有一个事件或只有标记时能够补齐缺项。
6. 已有 Director 父类错误时返回 `DIRECTOR_PARENT_MISMATCH`。
7. 30 FPS、60 FPS 和不同 TickResolution 下秒级时间一致。
8. 非法时间、重复字幕和越界字幕被拒绝。
9. 保存重开后 Endpoint、蓝图连线、字幕和标记完整。
10. 一个 Undo 能撤销整个批次。

### 20.3 公共流程

1. `bDryRun=true` 不修改对象、不标脏。
2. 已有未保存修改时拒绝执行。
3. 中途失败后 Snapshot 与执行前一致。
4. 超时后用 `request_id` 查询或重放时不重复创建。

## 21. 已验证的现有能力

2026-09-10 使用 UE 4.27.2 和当前 OmniMcpCore 实测：

- 可读取 LevelSequence 的 Track、Section、时间和 Marked Frame。
- 可读取 EventChannel 的 KeyTime、Function 和 WeakEndpoint。
- 可读取 Director Blueprint、DirectorClass、父类及蓝图节点。
- 可创建、保存并重新加载 `UMovieSceneDialogueTrack`。
- 可创建 `UMovieSceneDialogueSection`，写入 `DialogueID` 和时间范围。
- 可创建、保存并重新加载 `skip` Marked Frame。
- 可创建 Event Track、Trigger Section 和事件时间键。
- 可调用项目已有 `CheckTrackCount` 等 Sequence 检查函数。

当前缺口：

- 没有创建 LevelSequence 内嵌 Director Blueprint 的公开接口。
- 没有创建并注册 MovieScene Event Endpoint 的公开接口。
- 没有安全设置 Director 父类的接口。
- `DirectorBlueprint`、`DirectorClass` 是非公开属性。
- MCP 无法完整序列化 `FMovieSceneEvent` 中的 FieldPath。

因此 UE 侧最关键的新增代码是：

```text
创建正确父类的内嵌 Sequence Director
创建并注册原生 MovieScene Event Endpoint
```

字幕、时间段、轨道、事件时间和 Marked Frame 已可通过现有能力实现。

## 22. 建议代码结构

```text
EditorAssetPatch
├── EditorAssetPatchSubsystem
├── EditorAssetPatchTypes
├── EditorAssetPatchRevision
├── DialogGraphPatchHandler
└── LevelSequencePatchHandler
```

公共层负责：

- JSON Schema
- revision
- dry-run
- request_id 幂等
- 事务与恢复
- 差异和错误格式

Handler 负责：

- DialogGraph 的节点工厂、Schema 和内部索引。
- LevelSequence 的 MovieScene、Director Blueprint 和 Event Endpoint。

这能复用大部分可靠性基础设施，同时保持两套编辑器对象模型的正确边界。
