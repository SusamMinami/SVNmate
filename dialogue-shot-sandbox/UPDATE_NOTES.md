# 镜头沙盘 v0.23.3

> 2026-09-05 · DialogNPCTable 补登记

## 任务目标物

- BP 槽位缺少 `DialogNPCTable` 映射时，会在创建、追加或注册
  `DialogModels` 前打开补登记审核，不再静默写入 `None`。
- 自动从 Character BP 默认对象回读 Anim Class 与 Skeletal Mesh；Camera BP
  能唯一匹配时自动填写，否则由用户明确选择。
- 行名默认从 BP 资产名生成并允许修改，重复行名、无效路径和脏资产会阻止写入。

## 写入安全

- 使用整表快照哈希检查审核后的并发变化。
- 写入后逐行回读 `CharacterBPPath`、`AnimClassPath`、`CameraBPPath` 与
  `MeshPath`，完全一致才保存 UE 资产。
- 写入或回读失败时重载原包，不保留未保存的 DataTable 修改。
