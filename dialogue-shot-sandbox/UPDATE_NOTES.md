# 镜头沙盘 v0.22.16

> 2026-09-03 · 小更新

## 任务目标物

- 未填写任务节点和对话节点时，读取 UE 选择会先识别目标 BP 的父类。
- `TaskActorBase` 可直接使用 UE 中选定的 BP Actor 作为坐标原点，把所选
  Blueprint、Skeletal Mesh 或 Static Mesh 写入 BP，不再要求 BP 文件名包含
  用于查找对话资产的数字 ID。
- `PositionModeBase` 继续执行原有对话资产查找、Formation、Preview Level 和
  空间配置校验，不改变现有对话站位工作流。
- 无法唯一确定目标 BP 实例、父类不受支持或 UE 选择发生变化时，仍会停止写入
  并给出明确提示。
