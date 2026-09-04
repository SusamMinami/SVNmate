# 镜头沙盘 v0.23.1

> 2026-09-04 · SceneObject NPC 与动作面部增补

## SceneObject NPC

- 关卡图加载出的 `SceneObject` 现在会识别其中的实际 NPC，不再显示为不支持。
- 未匹配任务目标物时，NPC 也会按选择顺序写入 BP 数字槽，并同步对应对话的
  `DialogModels`。
- NPC 的世界位置、旋转和缩放保持不变。
- 相同模型位于不同位置时会分别创建槽位，不会因模型重复而阻断。
- 已由旧版写成资产名组件时会提示目标数字槽，可先重命名或清理旧组件，避免
  重复生成同一个 NPC。

## NPC 工作流分流

- 进入“NPC 迁移”后，可选择“全新 NPC”“动作补充与修改”或“面部补充”。
- 全新 NPC 保留原有的美术 UE 扫描、跨工程迁移和策划 UE 完整配置流程。
- 已有 NPC 的动作和面部更新直接连接策划 UE，不再重复迁移模型或创建 BP/ABP。

## 动作补充

- 从已有 NPC BP 或 Body Skeletal Mesh 自动确定 NPC、Skeleton 和 Animation
  目录。
- 清单明确区分新增与覆盖；目标动作存在未保存修改时会阻断。
- 新识别的 Idle / Turn 动作可自动创建对应 Montage，既有 Montage 保持复用。

## 面部补充

- 自动识别 Face Skeletal Mesh 与 Face Skeleton，并将 `_Face.fbx` 与同名
  Body 动作配对。
- 每个动作可分别审核是否复制 Morph Target 曲线、是否生成 Montage。
- 自动导入或更新 Face 动作、锁定根骨骼并保存。
- 直接调用 `SeriaAssetHelperBlueprintFunctionLibrary` 完成曲线复制和 Montage
  生成，不再要求拖入或操作 `BP_FaceConfigHelper`。
- 写入后回读 Body/Face 配对、动作数量、根骨骼锁定和 Montage 结果。

## 稳定性

- NPC 目录扫描改用 Asset Registry 按类型筛选，不再递归加载全部动画资产，
  避免大量 DDC 构建导致 UE 卡顿或 MCP 断连。
- 清单勾选、曲线或 Montage 选项变化后，必须重新审核才能执行。
