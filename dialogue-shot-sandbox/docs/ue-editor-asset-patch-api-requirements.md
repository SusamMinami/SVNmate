# UE 编辑器统一制作接口需求

> 状态：待接入的 UE 接口需求，不是现行 API 文档。
> 覆盖范围：任务图、对话图、LevelSequence/Director、GameplayAbility 与
> AnimGraph 的受控读取、节点创建、连接和属性配置。
> 原则：最小化 UE 修改，复用现有 OmniMcpCore，不新增通信协议和端口
>
> 当前动画语音已使用受控 Python 链路，范围见
> [动画语音](animation-voice-workspace.md)；图编辑原型/限制见
> [插件可行性](local-dialog-plugin-feasibility.md)。2026-09-29 的在线能力证据见
> [第 23 节](#23-2026-09-29-在线核对)，下文建议接口不能直接当作已部署能力。

## 1. 背景

本方案提出统一的资产修改服务，供镜头沙盘、任务工具和角色创建工具复用。
调用方负责：

- 生成任务节点、任务关系和动态属性。
- 生成待创建的对话节点、连接关系和节点属性。
- 生成动画字幕 ID、字幕时间段和跳过配置。
- 生成技能 Ability/AnimGraph 的模板派生与白名单参数。
- 展示 dry-run 差异并由用户确认。
- 处理 Excel 配表、AI 分析和交互界面。

UE 只负责按照编辑器原生规则安全修改资产。不能让沙盒直接修改 `.uasset`，也
不能依赖鼠标坐标、剪贴板或 UI 自动化完成正式写入。

当前 OmniMcpCore 已支持反射调用 UFUNCTION。因此 UE 侧只需提供三个
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

### 2.3 任务图

- 读取 `SeriaTaskGraph`、`SeriaEdTaskGraph`、节点、Pin、边和动态属性定义。
- 按任务编辑器当前配置创建开始、结束、普通、分线和组任务节点。
- 区分节点类型 ID、节点 GUID 与 `Mission.id`，维护 `IDToNodeArray`。
- 通过任务 Schema 创建连接，并重建任务顺序、子任务和分线关系。
- 执行节点检查、任务图检查与导出前一致性检查。

### 2.4 Ability 与 AnimGraph

- 读取指定 GameplayAbility、Montage、Notify 中实际引用的 Skilldamage、
  Skill 和 Buff ID，并返回引用来源。
- 从批准的模板派生 Ability/Animation Blueprint，设置白名单默认参数。
- 对普通 K2/AnimGraph 节点执行白名单创建、Pin 配置、连接、编译和回读。
- 第一阶段不开放任意节点、任意函数或任意图导入。

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

UFUNCTION(BlueprintCallable, Category = "Seria|EditorPatch")
bool GetEditorAssetPatchResult(
    const FString& RequestId,
    FString& OutResultJson,
    FString& OutError);
```

支持的 `AssetKind`：

```text
task_graph
dialog_graph
level_sequence
ability_blueprint
animation_blueprint
```

如果模块依赖关系不允许提供统一入口，也可以按 Handler 暴露独立函数，
但请求信封、结果格式、事务、版本校验、幂等和错误码必须共用。

```text
GetTaskGraphSnapshot
ApplyTaskGraphPatch
GetDialogGraphSnapshot
ApplyDialogGraphPatch
GetLevelSequenceSnapshot
ApplyLevelSequencePatch
GetAbilityBlueprintSnapshot
ApplyAbilityBlueprintPatch
GetAnimationBlueprintSnapshot
ApplyAnimationBlueprintPatch
```

`GetEditorAssetPatchResult` 不得省略。网络超时后必须先查询执行结果，
不能以同一或新的 request ID 盲目重放节点创建。

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
| `NODE_ID_CONFLICT` | 对话或任务业务 ID 冲突 |
| `CONNECTION_REJECTED` | Graph Schema 拒绝连接 |
| `TASK_CONFIG_CHANGED` | 任务图内嵌配置与当前节点定义不兼容 |
| `DIRECTOR_PARENT_MISMATCH` | 已有 Director 父类不符合要求 |
| `EVENT_ENDPOINT_FAILED` | MovieScene Event Endpoint 创建或绑定失败 |
| `TIME_RANGE_INVALID` | Section 或事件时间无效 |
| `REFERENCE_NOT_FOUND` | Ability/Montage/Notify 中要求的引用不存在 |
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
├── EditorAssetPatchRequestStore
├── TaskGraphPatchHandler
├── DialogGraphPatchHandler
├── LevelSequencePatchHandler
├── AbilityBlueprintPatchHandler
└── AnimationBlueprintPatchHandler
```

公共层负责：

- JSON Schema
- revision
- dry-run
- request_id 幂等
- request_id 结果查询
- 事务与恢复
- 差异和错误格式

Handler 负责：

- TaskGraph 的节点定义、工厂、动态属性、Schema、内部索引和导出校验。
- DialogGraph 的节点工厂、Schema 和内部索引。
- LevelSequence 的 MovieScene、Director Blueprint 和 Event Endpoint。
- Ability Blueprint 的模板、项目引用语义、K2 白名单和编译。
- Animation Blueprint 的 Skeleton、AnimGraph 节点与编译。

这能复用大部分可靠性基础设施，同时保持各编辑器对象模型的正确边界。

## 23. 2026-09-29 在线核对

本轮启动当前 Seria 策划工程（`<res>/Seria.uproject`），连接本机
OmniMcpCore `127.0.0.1:12031`。
在线返回 UE `4.27.2-0+++UE4+Seria-4.27`，工程路径正确，PIE 为 false；
探测前后 dirty content 与 dirty map 均为空。

### 23.1 已实际写入并回读

| 探针 | 结果 |
| --- | --- |
| 隔离 LevelSequence | 创建临时资产，写入 `MovieSceneDialogueTrack`、字幕 Section、`DialogueID=9032023`、1.1–2.4 秒范围及 8 秒 `skip` 标记，回读一致 |
| Sequence 保存 | 保存后重新扫描，轨道、Section、字幕 ID 和标记仍存在 |
| Sequence 失败恢复 | 注入非法 skip 值，返回 `APPLY_FAILED (restored, not saved)`；字幕 ID、范围和标记恢复 |
| 隔离普通 Blueprint | 创建临时 Actor Blueprint 和 `K2Node_IfThenElse`，回读 Pin `execute/Condition/then/else`，编译成功 |
| 清理 | 两类临时资产均经 UE 删除并回读不存在；最终 dirty content/map 为空 |

LevelSequence 首次目录删除被源控迁出提示拦截，后续按已加载资产删除成功。
普通 Blueprint 在创建调用栈仍持有节点引用时不能同请求删除，下一请求释放引用后成功。
因此测试工具和正式 Handler 都必须把“应用”“保存”“删除/清理”拆开报告，并为
长耗时删除保留 request ID 查询，不能以客户端超时判断失败。

### 23.2 已部署但范围有限

- `SeriaDialogEditorSubsystem`：可读取当前唯一选中节点，可对当前节点顶层
  NodeData 属性应用 UE ExportText；没有创建节点、连接、图快照接口。
- `SeriaTaskEditorSubsystem`：只有属性包装和输出 Pin 数量帮助函数；
  `SeriaTaskEditorSubsystemPythonHelper` 只有节点检查，不提供创建或连接。
- `BlueprintModificationHelper`：具备普通 Blueprint 节点创建、连接、Pin 值、
  子图导入、编译等工具；本轮已实测 Branch 创建和编译。
- `SeriaSequenceEditorLibrary`：具备 Sequence BP/ABP 资产创建、
  AnimGraph 节点创建、`LinkGraphNode` 与编译；没有内嵌 Sequence Director
  或 MovieScene Event Endpoint 创建接口。
- `SeriaAbilityHelperSubsystem`：当前是 Ability 配置查看/选择帮助器，
  没有 GameplayAbility 图制作或效果引用快照接口。

当前定制 UE 安装含运行二进制和 UBT，但缺少本机编译所需的完整 Engine Source
头文件及 `UE4Editor-UnrealEd.lib`。本机可以验证已部署接口，不能在这套安装上
编译新增 Editor 插件；程序需在匹配 Seria 4.27 的开发环境实现并提供 DLL。

## 24. TaskGraph Handler 需求

### 24.1 已核实结构

只读导出 `/Game/Seria/LevelGraph/LevelTaskGraph/999904.999904`：

- 资产为 `SeriaTaskGraph`，内含 `SeriaEdTaskGraph` 和 `GraphGuid`。
- 节点为 `SeriaEdTaskGraphNode`，含 `NodeGuid`、位置、`TaskNodeType`、
  `TaskGraphNodeData` 和 Pin/LinkedTo。
- `TaskNodeID="14"` 表示节点定义“收副本消息”，不是业务任务 ID。
- 业务 ID 位于 `CommonTaskGraphProperties` 的 `Mission.id`，
  样本为 `99990400/01/02`。
- 图内维护 `IDToNodeArray`；任务属性由图内 `OldSeriaTaskGraphConfig`
  与当前 `taskgraphconfig.xml` 共同约束。
- Pin 名可能为空；必须用 `category + direction + 同类序号` 形成稳定键。

### 24.2 Snapshot

`task_graph` 的 `data` 至少返回：

```json
{
  "graph_guid": "...",
  "root_task_id": 99990400,
  "config_revision": "sha256:...",
  "nodes": [{
    "mission_id": 99990401,
    "node_guid": "...",
    "definition_id": 14,
    "node_type": "action",
    "position": {"x": 144, "y": 0},
    "properties": {"Mission.Name": "...", "Mission.Parameter0": "..."},
    "pins": [{"key": "exec_in:0", "pin_id": "..."}]
  }],
  "edges": []
}
```

不能把属性数组压成只按显示名索引的字典；同名字段、Common/Special 映射和动态
参数必须保留原始索引与 alias。

### 24.3 Patch

首版白名单：

```text
task.create_node
task.set_properties
task.move_node
task.connect
task.disconnect
```

创建必须复用任务编辑器右键菜单使用的 Schema Action/工厂，按
`definition_id` 从当前任务配置生成 NodeData、默认 Pin、Server/Client 标志。
连接必须调用 `SeriaTaskGraphSchema::TryCreateConnection` 或项目等效入口，
并维护 `IDToNodeArray`、任务顺序、子任务/分线字段、图通知和导出校验。
禁止 `NewObject<USeriaEdTaskGraphNode>` 后直接加入 `Nodes`。

业务 ID 由请求显式给出或 UE 按任务线规则分配；预检需同时检查主任务表、
副本任务表、任务顺序表和当前图内占用。配置 revision 变化后旧审核令牌失效。

## 25. Blueprint Handler 复用边界

### 25.1 Sequence Director

现有普通 K2 工具可以创建函数调用节点并连接命名 Pin，但不能创建
LevelSequence 内嵌 Director，也不能生成 MovieScene Event Endpoint 的
FunctionEntry、WeakEndpoint 和 FieldPath。`sequence.ensure_skip_configuration`
必须调用 LevelSequenceEditor/MovieSceneTools 原生接口完成：

1. 以 `CommonSequenceDirector` 为父类创建内嵌 Director。
2. 创建 Show/Hide Endpoint 及其 K2 调用节点。
3. 由 MovieScene 原生工具绑定事件键，不由调用方拼 FieldPath。
4. 编译 Director，回读 Endpoint、父类和 Event Key。

Director 创建完成后，允许内部复用 K2 节点/Pin 帮助函数，但不能把
`bp.create_blueprint` 的独立资产当作 Director。

### 25.2 GameplayAbility

第一阶段新增两个受控能力：

```text
ability.inspect_effect_references
ability.create_from_template
```

`inspect_effect_references` 返回 Ability CDO、Montage、Notify 中实际发现的
Skilldamage/Skill/Buff 引用、对象路径、属性或 Notify 来源；找不到时明确返回空证据，
不按同号猜测。`create_from_template` 只允许批准模板和目标目录，复制后设置
Skill ID、伤害入口等白名单默认值，编译并回读。

第二阶段才开放：

```text
blueprint.create_node
blueprint.set_pin
blueprint.connect
blueprint.disconnect
```

节点类、函数、属性和图名必须按 GameplayAbility 模板白名单；调用现有
`BlueprintModificationHelper` 的底层实现时仍要包入 revision、dry-run、事务、
编译回读和 request ID 幂等。禁止将 `import_subgraph` 直接暴露给业务 UI。

### 25.3 Animation Blueprint

已有 `SeriaSequenceEditorLibrary.AddAnimGraphNodeByClass/Object` 和
`LinkGraphNode` 可作为实现基础。Handler 还必须校验目标 ABP、Skeleton、
节点类、资产类型、目标 AnimGraph、编译结果和写后连接。NPC 模板复制继续沿用
现有迁移流程；只有确需结构变化时才使用节点 Patch。

## 26. 程序交付顺序

| 阶段 | 交付 | 复用与新增 |
| --- | --- | --- |
| P0 | 公共 Snapshot/Patch/Result、capabilities、revision、幂等、busy、事务/恢复 | 复用 OmniMcpCore transport；新增项目 Editor-only Subsystem |
| P1 | `task_graph` 与 `dialog_graph` | 分别新增原生工厂/Schema Handler，共用公共层 |
| P1 | `level_sequence.ensure_skip_configuration` | 复用现有轨道/字幕/标记；新增 Director 与 Endpoint |
| P1 | `ability.inspect_effect_references`、模板派生 | 复用 BP 编译/属性工具；新增项目语义白名单 |
| P2 | 受控 K2/AnimGraph Patch | 复用现有 K2/Sequence 帮助器；补完整审核与回读 |

每个阶段先交 capabilities 与 dry-run，再开放 apply。调用方在 capability 为 false
时保持只读，不根据类名或版本号猜测能力。

## 27. 新增验收用例

### 27.1 任务图

1. 隔离任务图创建 Start、Action、End，`Mission.id` 唯一且与 definition ID 分离。
2. 创建普通、分线和组任务节点，空名 Pin 仍能通过稳定键准确连接。
3. 插入节点只替换明确的旧边；`IDToNodeArray`、顺序与导出数据一致。
4. 配置 XML 或图内配置变化后返回 `TASK_CONFIG_CHANGED`。
5. 节点检查、保存重开和任务 CSV 导出结果一致；一个 Undo 撤销整批。

### 27.2 Ability/AnimGraph

1. 从批准模板派生测试 Ability，白名单默认值、父类和编译状态正确。
2. 能从已知样本返回真实伤害/Buff 引用及来源，不用同号补全。
3. 非白名单函数、节点、目录、属性和 Skeleton 被拒绝且资产不变。
4. AnimGraph 创建节点并连接后编译、保存重开一致。
5. 重复 request ID 不重复创建节点或资产。

### 27.3 清理与超时

1. 临时资产删除超过客户端超时时，可按 request ID 查询最终成功结果。
2. 删除前释放返回结构、编辑器页签和调用栈引用；清理后注册表与磁盘均不存在。
3. 源控迁出失败、保存回调阻断和删除失败分别返回结构化状态，不把它们合并成
   普通 `APPLY_FAILED`。
