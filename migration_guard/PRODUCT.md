# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Impeccable 使用 `web` 作为桌面界面评审配置；实际产品是仅面向 Windows 的
Python/Tkinter 桌面应用。

## Users

主要用户是负责国内主干、海外 Trunk 与海外 OB 之间内容迁移的策划、程序和资源
维护人员。项目管理员也会在没有本地工程时，仅凭 Jira 与远端 SVN 证据检查多个
单据的迁移进度。

## Product Purpose

MigrationGuard 把 Jira 单号映射、三阶段远端资产进度、本地工作副本更新、UE 资源
迁移、TortoiseSVN 提交和提交后复核串成可重复执行的证据链。成功不是“打开过提交
窗口”或“目录是干净的”，而是每个必需文件都有正确单号的目标提交证据且没有遗留
本地修改。

## Positioning

相邻工具只执行迁移或展示 SVN 状态；MigrationGuard 以“模块 + 相对路径”为统一
资产身份，同时保留源提交、本地状态、目标提交和源漂移证据，并能在第一阶段复核
通过后自动继续 Trunk 到 OB 的第二阶段。

## Operating Context

- 用户会粘贴来自网页或飞书表格的一行或多行任务文本。
- 工具自动解析 SERIA/OSCOA 单号、路线和源/目标工作区。
- 无工程模式先查询 Jira 与远端 SVN，工作副本模式再执行精确核验和迁移。
- `res`、`doc`、`bin` 与 SVN externals 可能同时出现。
- UE4、OmniMcpCore、TortoiseSVN、`svn.exe`、SVNmate IPC 和飞书数据均可能
  暂时不可用，流程必须逐项降级并保留已获得证据。

## Capabilities and Constraints

- Python 3.11、Tkinter/ttk、PyInstaller；通过后台线程保持窗口可响应。
- 单一粘贴区自动抽取多个单号，源路径与目标路线自动联动。
- 优先按提交清单更新最小目录集合，异常时才回退模块根目录。
- SVNmate 在线时通过 Named Pipe 执行更新；旧版占用但不支持 IPC 时必须阻断。
- 高风险写操作需要明确确认；工具不自动提交、revert 或解决冲突。
- 状态必须同时提供文本/图标与颜色，绿/橙/红分别表示完成、待处理和失败。
- OB 流程必须在国内到海外 Trunk 的最终复核通过后才启动第二阶段。

## Brand Commitments

- 产品名为“迁移核验助手”，可执行文件名为 `MigrationGuard.exe`。
- 应用使用独立的三阶段迁移核验图标，不复用 SVNmate 图标。
- 视觉属于安静、紧凑、工作导向的 Windows 工具；不使用营销式大标题或装饰图形。
- 业务术语 `国内 trunk`、`海外 trunk`、`海外 OB`、`未迁移`、`待提交`、
  `已完成`、`需确认`、`阻断` 必须保持一致。

## Evidence on Hand

- 需求基线：`../docs/migration-guard-requirements.md`
- 技术与交互设计：`../docs/migration-guard-design.md`
- 当前用户流程：`../README_migration_guard.md`
- 当前 UI：`app.py`
- 文件级核验模型：`models.py`、`audit.py`
- 远端资产进度：`remote_asset_progress.py`
- 未提供正式可用性研究或用户访谈记录；不得虚构成功率和效率数据。

## Product Principles

1. 证据优先，绝不把“无变化”误报为“已完成”。
2. 自动推断路线和目标，减少重复输入，但把关键推断保持可见。
3. 批量流程允许局部失败，不让一个接口错误清空其他任务结果。
4. 用户始终知道当前阶段、剩余工作和下一步动作。
5. 高风险写入保留人工控制，读操作和复核保持幂等。

## Accessibility & Inclusion

主要流程必须可用键盘完成；图标入口需要 tooltip；状态不可只靠颜色。窗口必须在
实现下限 920x640 保持可操作，并在 1024x680、1180x760 与 Windows 150% DPI 下
避免文字重叠；长路径必须可滚动和复制。
