# 仓库文档索引

结构核对：2026-09-11。AI 从 [根目录 AGENTS.md](../AGENTS.md) 开始；
本页是目录，不要求逐项通读。

## 项目关系

| 项目 | 所在位置 | 边界 |
| --- | --- | --- |
| SVNmate | 根目录、`svnmate_core/` | 主程序管理更新、脚本、托盘及独立 EXE 模块 |
| MigrationGuard | `migration_guard/`，入口/测试在根目录 | 复用 SVNmate core/IPC，编排 Jira/SVN/UE 迁移核验 |
| ConfigLinker | `config_id_lookup/` | 独立只读 CSV 查询，复用根目录模块更新能力 |
| 镜头沙盘 | `dialogue-shot-sandbox/` | 独立 Node/Electron 工程，直接读配置并调用 UE，不依赖 ConfigLinker 进程 |
| Seria QA Overlay | `seria-qa-overlay/` | C++/Lua 游戏内任务诊断；DLSS5 为独立可选安装包 |
| Seria Config Core | `rust/` | 镜头沙盘与 ConfigLinker 可复用的只读 Rust 数据核心；各产品私有打包 |

各项目独立版本与交付；同仓不等于共享 UI。KindleLarkStatus 只作为外部模块接入。
不编辑产物目录中的 README 副本来代替源码文档。

## SVNmate

- [开发指南](svnmate-development.md)：代码地图、串行规则、IPC、验证与发布。
- [README](../README.md)：产品概览。
- [使用指南](../README_svn_auto_tool.md)：操作、更新恢复与维护。
- [版本历史](../RELEASE_NOTES.md)：只追溯，不作为现行实现规范。

## MigrationGuard

- [AI 入口](../migration_guard/AGENTS.md)：代码地图、硬约束与测试。
- [产品](../migration_guard/PRODUCT.md) / [视觉设计](../migration_guard/DESIGN.md)：
  产品目标与桌面 UI，不代替技术协议。
- [需求](migration-guard-requirements.md)：状态、业务流程和验收口径。
- [技术设计](migration-guard-design.md)：当前架构与数据流；明确区分未落地设计。
- [单号路由](migration-ticket-routing.md)：SERIA/OSCOA、飞书页签、国内 OB。
- [用户指南](../README_migration_guard.md)：实际使用步骤。

## ConfigLinker

- [AI 入口](../config_id_lookup/AGENTS.md)：只读边界、模块职责与测试。
- [专题索引](../config_id_lookup/docs/README.md)：产品、设计、用户指南与历史计划。

## 镜头沙盘

- [AI 入口](../dialogue-shot-sandbox/AGENTS.md)：任务到专题/代码的路由。
- [专题索引](../dialogue-shot-sandbox/docs/README.md)：现行协议、待接入方案、
  研究与验证记录分开列出。

## Seria QA Overlay

- [AI 入口](../seria-qa-overlay/AGENTS.md)：边界、源码入口与验证命令。
- [QA 使用说明](../seria-qa-overlay/README.txt)。
- [技术规格](../seria-qa-overlay/TECHNICAL_SPEC.md)。

## 共享 Rust 数据核心

- [开发与协议](../rust/README.md)：当前实现范围、跨产品边界、JSON Lines
  协议和验证命令。

## 历史与外部资料

- [设计审查记录](impeccable-design-review.md)：当时的问题与执行记录；判断现状前查源码。
- [Kindle 公共通道交接](../KINDLE_PUBLIC_CHANNEL_HANDOFF.md)：外部模块发布资料。
- [ConfigLinker 历史计划](../config_id_lookup/docs/plans/)：不重放提交/发布步骤。
- 根目录 `debug-ticket-paste-freeze.md` 是被 Git 忽略的本机调试记录，不是项目入口。
- `tools/vgmstream` 内文档属于第三方工具，保留原始许可与说明，不按本仓指南裁剪。

## 维护

“指南太长”的主要风险是加载无关上下文与同一规则多处漂移，而不是 Markdown 数量。
新增文档前先确认归属与状态；具体写法、整理结论和检查方法见
[文档维护约定](documentation-maintenance.md)。
