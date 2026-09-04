# 镜头沙盘 v0.23.0

> 2026-09-04 · NPC 迁移与配置

## NPC 一键迁移

- 新增独立“NPC 迁移”工作区，可从美术 UE 读取选中的 `SK_` Skeletal Mesh，
  递归检查依赖并迁移到策划工程；目标同路径文件存在时不会覆盖。
- 根据 SK 名称自动生成 NPC、BP 和 ABP 名称，只保留 NPC 名称供最终确认。
- 批量导入 Body/Face FBX，自动指定 Skeleton，并为 Face 动作锁定根骨骼。
- 自动创建 NPC BP 与 ABP、估算胶囊体、绑定转头曲线，并创建 Idle/Turn
  Montage 与 `IdleSlot` / `TurnSlot`。
- 支持男性 `ABP_N16_Villager_Male_A` 和女性
  `ABP_N18_Villager_Female_A` 标准模板；自动复制完整状态机并替换 Look、
  IdleStand、Impact、Interact。
- 自动创建 `BS_<NPC>_Look`，复制模板轴范围与采样位置，配置 LookD/F/U 的
  Mesh Space、LookF 第 15 帧基准及 IdleStand 预览姿势。
- 源资产未保存、动作缺失、模板或接口不可用、命名冲突和写后回读不一致时，
  会在保存前阻断并显示具体原因。

## TaskActor 注册

- “注册 NPC”现在会识别 `TaskActorBase`，按任务物件处理，不再创建或复用 NPC。
- TaskActor 模型 ID 使用 `500000-599999` 段；目标物写
  `type=4`、`NPCID=0`、`ItemID=0`，并将模型 ID 写入 `BluePrint`。
- 混合选择普通 NPC 与 TaskActor 时，仅为普通 NPC 打开和写入 NPC 表。
- 桌面端复制目标物 ID 改用原生剪贴板接口，避免部分 Electron 环境中复制失败。

## 发布检查

- 移除 UE 特效识别期间的临时调试上报与本地日志配置。
- NPC 迁移、TaskActor 注册、Excel 写入、构建和桌面工作区均已纳入自动化回归。
