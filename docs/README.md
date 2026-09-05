# 仓库文档索引

最近核对：2026-09-05

本仓库包含多个独立产品。开始设计或实现前，应先进入目标项目并读取该项目自己的
现行产品与设计文档，不要把根目录 SVNmate 的上下文套用到子项目。

## SVNmate

- `../README.md`：功能概览。
- `../README_svn_auto_tool.md`：完整使用和维护说明。
- `../RELEASE_NOTES.md`：版本历史。
- `impeccable-design-review.md`：设计问题、执行顺序与完成记录。

## MigrationGuard

- `migration-guard-requirements.md`：现行需求、状态模型和验收口径。
- `migration-guard-design.md`：现行架构、算法、数据模型和实施状态。
- `migration-ticket-routing.md`：SERIA/OSCOA 与飞书合并表路由协议。
- `../README_migration_guard.md`：用户操作说明。

## ConfigLinker

- `../config_id_lookup/README.md`：功能与数据范围。
- `../config_id_lookup/USER_GUIDE.md`：用户操作说明。
- `../config_id_lookup/docs/plans/`：带日期的历史设计和实施记录。

## 镜头沙盘

- `../dialogue-shot-sandbox/docs/README.md`：产品、设计、功能专题、研究和历史问题
  的分层索引。

## 非现行文档

- `debug-ticket-paste-freeze.md` 是一次性调试记录，并已由 `.gitignore` 排除。
- `KINDLE_PUBLIC_CHANNEL_HANDOFF.md` 是外部模块发布交接，不是本仓库产品设计入口。
- `config_id_lookup/docs/plans/` 中的带日期方案是历史记录；其顶部状态声明会指向
  当前文档。
