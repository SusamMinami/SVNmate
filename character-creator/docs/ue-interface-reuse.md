# UE 写入能力与接口复用

核对日期：2026-09-29。已启动当前 Seria 策划工程（`<res>/Seria.uproject`）并连接本机
`127.0.0.1:12031`，在线确认 UE 4.27.2、当前工程、插件反射能力与写入链路。
只操作自动生成的隔离 LevelSequence 和 Actor Blueprint；没有修改业务资产。
测试资产已通过 UE 回读确认删除，最终 dirty content/map 均为空。

## 结论

已有 UE 写入基础设施，可直接复用通信、反射、已有属性写入和部分资产制作流程。
但它尚不是完整的技能制作接口。任务图、对话图、普通 K2 图和 Sequence Director
应共用协议及可靠性层，分别适配原生编辑器工厂；不应为每个工具重写一套通信服务。

本轮角色工具先实现表侧技能/Buff 配置、复制和多表审核。
既有 Ability 可填写复用路径；新 Ability、命中入口及图节点结构暂不由本面板写入。
Excel 写入成功不表示 UE 资产、导表或游戏运行已验证。

## 能力矩阵

| 工作 | 已有证据 | 可复用部分 | 尚需 UE 侧实现或验证 |
| --- | --- | --- | --- |
| 连接、调用反射/Python | 在线确认当前 OmniMcpCore、工程路径、PIE 与 dirty 状态 | 同一端口、`unreal_invoke`、超时与错误解析 | 写入超时后仍需 request ID 结果查询 |
| 已有对话节点字段 | 沙盘单节点配置与批量对白写入业务链路 | 精确目标、预检、审核、回读、保存策略 | 不推广为任意图节点创建 |
| 对话图创建/连线 | 既有探测可读图与 EdGraphNode；未验证写入 | Snapshot/Patch 信封、节点 GUID 与稳定 Pin 标识 | 调用 Seria Schema Action、维护 NodeData/业务 ID/NextID/内部索引 |
| 任务节点配置 | 在线读取 `SeriaTaskGraph` 样本、NodeData、`Mission.id`、GUID、空名 Pin 与边；任务 Subsystem 无创建接口 | 任务表编辑可复用 Excel；图编辑复用公共 Patch 层 | 原生节点工厂、Schema 连接、内部索引和导出重建；不能套用对话图类 |
| 普通 Blueprint / 技能 Ability | 在线创建临时 Actor BP 与 Branch 节点并编译成功；普通 BP 工具齐全 | K2 节点帮助器、编译、模板资产复制基础能力 | Ability 效果引用读取、模板白名单与项目语义；普通 BP 成功不等于 Ability 已验证 |
| NPC 动画蓝图模板 | 在线确认 Sequence 库已有 AnimGraph 节点创建/连接；迁移已有模板继承流程 | 复用模板、Skeleton、AnimGraph 帮助器与编译 | 仍需 Handler 白名单、目标图和写后连接校验 |
| LevelSequence 字幕/标记 | 临时 Sequence 在线写入字幕轨/Section/ID/时间与 skip 标记，保存、回读和失败恢复通过 | 现有 Python 业务链路，按秒配置、TickResolution 转换、回读 | 清理受源控回调影响时需要异步结果查询 |
| Sequence 跳过按钮蓝图节点 | 能读事件键、Director 和 Endpoint；完整创建链路尚缺 | 字幕时间/事件时间/标记部分 | 正确父类的内嵌 Director、原生 Event Endpoint 创建与绑定、Show/Hide 调用节点 |

普通 BP 的 `bp.add_component` 操作 SCS 组件，不是 K2 图节点创建。
旧 `connect_pins` 以名称定位，而实测对话图引脚名称为 `None`，所以参数类型兼容
不足以证明可正确连接。独立对话插件只是未编译原型；定制 UE 开发包缺失的旧结论，
也不能当作已编译、已部署的能力。

## 最少新增接口

沿用已更新的 [统一 UE 制作接口需求](../../dialogue-shot-sandbox/docs/ue-editor-asset-patch-api-requirements.md)
的三个 Editor-only UFUNCTION：

1. `GetEditorAssetSnapshot(asset_kind, asset_path)`：返回版本、能力、脏状态、稳定标识、
   修订与业务字段。
2. `ApplyEditorAssetPatch(patch_json, dry_run)`：预检或应用显式白名单操作。
3. 增补 `GetEditorAssetPatchResult(request_id)`：断线/超时后查询实际结果，避免重复创建。

这些统一签名尚未部署；已部署的是各插件现有零散能力。通过原有
`reflect.execute_unreal_function` 调用即可，不需为角色工具新开 UE 端口。
公共层统一维护 revision、幂等、编辑器忙状态、差异、事务、失败恢复、回读和错误码。

业务 Handler 按能力增量加入：

| Handler | 责任 | 实施顺序 |
| --- | --- | --- |
| `dialog_graph` | Seria 对话节点工厂、ID、数据对象、边与运行数据 | 与已有对话节点自动创建需求一起交付 |
| `task_graph` | 任务节点类型、表字段、前后置边、任务校验/导出规则 | 与任务编辑器创建需求一起交付 |
| `level_sequence` | MovieScene 轨道、正确父类 Director、Endpoint | 重点只补当前缺失的 Director/Endpoint |
| `ability_blueprint` | GameplayAbility 模板、默认参数、伤害引用、K2 图校验 | 首先只做已知模板与有限参数，再扩展节点 |
| `animation_blueprint` | AnimGraph 原生节点/引脚、Skeleton、编译检查 | 真正需要结构修改时再加入 |

跨 Handler 不共用节点构造代码；共用 K2 底层帮助函数也必须经过各自 Schema。
尤其不能用独立 `bp.create_blueprint` 替代内嵌 Sequence Director，
也不能裸建 UObject 后写入 Graph.Nodes 代替编辑器原生创建。

## 技能侧优先补什么

最有价值的首个读接口，是返回指定 Ability / Montage / Notify 中**已证实**
的 `Skilldamage`、技能和 Buff 引用及来源路径。表侧已有
`Skilldamage.skillbuff → Buff`、`Buff.behavior → Behavior` 等编辑能力；
补齐资产到伤害的实际入口后，就能从一个技能连续配置它的效果。

首个写接口宜限制为“从已知 Ability 模板派生 + 白名单参数替换”，返回真实资产路径、
引用变化和编译结果。普通数值、升级参数、Buff 生命周期等已可在表侧完成，无需 UE
程序新增一套表格编辑器。复杂新技能逻辑再进入受控 K2 图 Patch。

应用规则：精确资产路径、revision 和确认的差异；编辑器安全阶段；失败明确恢复并回读；
结构 Patch 成功先标脏、不自动保存。保存另行报告，不能把跨工作簿与 UE 资产声称为
原子事务。既有对话小窗/批量导出的保存策略仍按其原专题执行。

## 证据入口

- [UE 节点创建建议](../../dialogue-shot-sandbox/docs/ue-graph-editing-support.md)
- [通用资产 Patch 需求与既有实测](../../dialogue-shot-sandbox/docs/ue-editor-asset-patch-api-requirements.md)
- [本地对话插件探测与限制](../../dialogue-shot-sandbox/docs/local-dialog-plugin-feasibility.md)
- [动画语音现行范围](../../dialogue-shot-sandbox/docs/animation-voice-workspace.md)
- [NPC 迁移与 ABP 模板](../../dialogue-shot-sandbox/docs/npc-migration.md)

本轮在线证据和程序分期已并入统一需求文档。新增插件接口后仍需先读 capabilities，
再扩展业务适配器；不能根据本次类名推定未来版本能力。本轮未修改沙盘 transport、
插件或引擎源码。
