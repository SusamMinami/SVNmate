# ConfigLinker 文档索引

结构核对：2026-09-11。AI 先读 [AGENTS.md](../AGENTS.md)，再按任务选文档。

## 现行入口

- [PRODUCT.md](../PRODUCT.md)：用户、目标、能力、约束与产品原则。
- [DESIGN.md](../DESIGN.md)：视觉系统和交互约束，仅 UI 任务必读。
- [README.md](../README.md)：开发、数据源、字段关系、安装和当前功能。
- [USER_GUIDE.md](../USER_GUIDE.md)：面向使用者的完整操作说明。

## 历史记录

`plans/` 下的带日期文件记录当时已经确认的设计与实施步骤，用于追溯决策，不作为
当前功能边界，也不应重新执行其中的提交、推送或发布命令：

- [初版设计](plans/2026-07-28-config-id-lookup-design.md)
- [初版实施](plans/2026-07-28-config-id-lookup-implementation.md)
- [模块优化设计](plans/2026-07-28-tool-modules-optimization-design.md)
- [模块优化实施](plans/2026-07-28-tool-modules-optimization-implementation.md)

历史正文与日期保留，不把新功能继续追加到已完成计划。数据规则更新 README，
视觉更新 DESIGN，产品范围变化才更新 PRODUCT；不要求每次改动全套同步。
通用写法见 [文档维护约定](../../docs/documentation-maintenance.md)。
