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
3. 当前关卡不匹配时，先查询 Dirty Map Packages。
4. 存在未保存关卡时停止自动切图。
5. 调用 `world.open_level` 打开目标地图并回读确认。
6. 清除上一批由镜头沙盘生成的预览。
7. 仅按当前勾选项的世界坐标与旋转生成实际资产或 TargetPoint。
8. 将预览 Actor 设置为 Editor Only。
9. 任一对象生成失败时删除本次已生成对象，避免部分加载。

预览 Actor 使用名称前缀：

```text
ShotSandboxMissionTargetPreview_<TaskId>_<TargetId>
```

当前实现不会调用地图保存、Excel、VBA、CSV 导出或配置生成工具。预览 Actor
仍位于编辑器关卡世界中，检查结束后应点击“清除预览”，并在保存关卡前确认
不存在上述前缀的对象。

## 主要代码

- `src/data/csv.ts`：读取任务、目标物、NPC、模型、地图和场景资源 CSV。
- `src/data/missionTargetResolver.ts`：执行跨表解析和加载前硬校验。
- `server/ueBridge.ts`：自动开图、资产预检、生成和失败清理。
- `src/components/MissionTargetModal.tsx`：任务输入、变更摘要与目标物详情。
- `src/ue/client.ts`：前端 UE API 客户端。
