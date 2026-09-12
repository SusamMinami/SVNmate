# MigrationGuard 技术设计

> 状态：现行架构与维护指南，按 2026-09-11 工作区源码整理。
> 行为/验收归 [需求](migration-guard-requirements.md)，UI 归
> [DESIGN](../migration_guard/DESIGN.md)，入口与测试归
> [AGENTS](../migration_guard/AGENTS.md)。版本源为 `migration_guard/VERSION`。

## 架构

Python/Tkinter 独立 EXE，复用 SVNmate 的更新能力，不驱动 SVNmate GUI。
网络、SVN 和 UE 操作在后台执行，通过队列回传界面。

```text
MigrationGuard UI
  -> ticket_mapping / jira_client / remote_asset_progress
  -> MigrationAuditService -> SvnClient -> svn.exe XML
  -> selective_update -> MigrationUpdateClient
       -> SVNmate Named Pipe -> svnmate_core
       -> 无常驻实例时直接 svnmate_core
  -> BatchMigrationExecutor -> UE OmniMcpCore / TortoiseSVN Commit
  -> 增量提交与本地状态复核
```

| 代码 | 职责 |
| --- | --- |
| `migration_guard/app.py` | 路线、选区、后台任务、阶段耗时与 UI 状态 |
| `models.py` | 不可变证据数据类、文件状态和完成判定 |
| `audit.py` | 完整审计、源快照、增量源检查、目标状态/提交复核 |
| `svn_client.py` | `info/log/status/externals`、严格单号匹配、退出码与 XML |
| `selective_update.py` | 按所选文件规划最小更新目录 |
| `batch_workflow.py` | 更新前选区、资源去重、迁移、提交分组和窗口等待 |
| `svn_update_client.py` | IPC 优先，未运行才回退 core |
| `ticket_mapping.py` | SERIA/OSCOA 与工作簿路线、页签、离线缓存 |
| `jira_client.py` | Jira 状态、版本、创建时间和短期缓存 |
| `remote_asset_progress.py` | 无工程三阶段 SVN 证据、磁盘缓存与取消 |
| `ue_client.py` | 长度前缀 TCP 协议、工程校验与迁移调用 |
| `config.py` | 四个工作区、固定表、扫描与刷新配置 |

未写完整路径的文件均在 `migration_guard/`；共享模块在根目录
`svnmate_core/`、`svnmate_ipc.py`。不要把历史提议的 Service 名当作已存在类。

## 两条读取路径

### 无工程查询

解析选定单号后查询 Jira 与三套远端 SVN URL，不需要本地工作副本，但需要
`svn.exe` 和只读权限。Jira 版本登记只能表示中间状态，最终资产颜色取 SVN 证据。

- 查询起点优先最早 Jira 创建时间前 3 天，受最大回溯配置约束。
- Jira 内存缓存和远端磁盘缓存为 5 分钟；无工程 UI 默认每 2 分钟强制刷新，
  可改 5 分钟，手动刷新绕过缓存。
- 切任务、进入写流程或退出取消旧 SVN 子进程，旧结果不得覆盖新任务。
- “单号/资产”视图复用同一证据；资产以模块与相对路径去重，不因切页重新查询。
- 无工程结果不能证明本地没有遗留修改；国内 OB 不复用海外远端三阶段。

飞书固定表按路线向前查最多 12 个可见页签，精确规则归
[单号路由](migration-ticket-routing.md)。映射选定单号后仍需用户确认资产范围。

### 本地核验与迁移

1. `audit_batch` 只读建立选定任务的源文件与目标证据。
2. `build_update_selection_plan` 显示所有候选，用户选资产；`select_audit_files`
   将范围保存到快照，后续阶段持续继承。
3. `selective_update` 只检查/更新所选源文件与需更新的目标文件所在最小目录。
   目录去重并消除父子覆盖；无法定位或超 IPC 限制才保守回退模块根。
4. 必要更新完成后重新核验所选文件；无落后项可复用筛选后的审计。
5. 迁移前复用快照并检查新增源提交、刷新目标状态；所选 `.uasset/.umap`
   按包路径去重，校验 UE 工程/`BranchContentPath` 后一次调用
   `SeriaMigrateInfo.migrate_by_package_names`。
6. 迁移后 `refresh_batch_status` 只回读目标状态，不重新扫描全部源/目标日志。
7. 按目标 Jira 分组打开 TortoiseSVN，等待窗口结束后 `refresh_batch_commits`
   增量查询并复核。打开/关闭窗口都不是成功证据。
8. 国内 -> 海外 trunk 通过最终复核后才进入海外 OB；纯海外只做第二阶段；
   国内 OB 只做同一 `SERIA-*` 的单阶段。

纯核验入口尚无资产选择时，迁移前仍展示资源目录树。空选择退出写流程，
不把所有候选当成默认授权。表格、删除和归属不明的共享资产保留人工处理。

## 快照与增量

- 源 revision 基线覆盖完整扫描中实际读到的最高匹配提交，包含目录和 externals，
  不仅取工作副本根的 mixed revision。
- `ModuleAudit` 保存源/目标基线；`BatchMigrationAuditResult.selected_paths`
  保存选区。刷新结果必须携带选区，不重新放入未选文件。
- `_ensure_source_snapshot_current` 检查基线后的源单提交；有新增提交要求完整复核，
  不能沿用旧完成结论。工作区映射变化也使旧快照失效。
- 同一迁移阶段复用工作副本与 externals 上下文，按需要增量取目标日志。
- “有新增源单提交”的门禁已实现；“同一路径后来被其他 Jira 修改”的逐文件漂移
  展示尚未实现，不能把两者混为一种能力。

## 当前数据模型

权威字段见 [models.py](../migration_guard/models.py)，此处只标职责，不复制字段列表。

| 类型 | 用途 |
| --- | --- |
| `WorkspaceModule` / `SvnInfo` | 模块路径、URL、仓库 UUID、revision 与工作副本根 |
| `SvnCommit` / `SvnChange` | revision、动作、复制来源与提交说明 |
| `WorkingCopyStatus` | 本地状态、远端落后、阻断状态 |
| `ExpectedChange` | 源/目标身份、任务、动作、源提交、external 与映射/删除证据 |
| `FileVerification` | 单文件状态、目标提交与理由 |
| `ModuleAudit` | 源/目标基线和扫描统计 |
| `MigrationCase` | 源/目标单号与标签，不是持久任务库记录 |
| `MigrationAuditResult` / `BatchMigrationAuditResult` | 不可变核验结果、选区、聚合完成状态 |

当前 `VerificationState` 为 `complete`、`submitted`、`source_deleted`、
`pending_commit`、`not_migrated`、`needs_update`、`needs_review`、`blocked`。
非空文件集合全部属于前三类时才聚合完成；`source_deleted` 以灰色表达无需迁移，
不能伪装成“已迁移”。计划中的 `WAIVED` 人工豁免不是当前枚举。
业务决策表见 [需求的文件判定](migration-guard-requirements.md#8-文件级判定规则)。

## SVN 与路径

- 参数数组传给 subprocess，用户输入不经 `shell=True` 拼命令。解析 XML，
  检查退出码；失败不解释成空日志或干净目录。
- `svn log --xml -v --search` 后仍做严格单号边界匹配；作者筛选仅影响显示，
  不能减少完整性清单。不用很小的 `-l` 截断历史匹配。
- 模块以 `svn info` 确认根、URL、UUID；路径按模块相对根映射，校验分支角色、
  目录越界和来源。externals 使用自身仓库根，禁止字符串替换整条绝对路径。
- 单号相同路径聚合动作时保留 revision 证据。删除、替换、copyfrom、父目录删除
  不能静默丢弃；源已不存在需确认后续删除证据，否则仍视作缺失。
- 新增目标逐级检查未版本化父目录；目标落后先标需更新。清单外本地修改不得
  默认加入提交。
- update 失败后 cleanup 并只重试一次，不自动破锁、revert 或解决冲突。

更新分发严格使用：

```text
IPC 可用                       -> 常驻 SVNmate 串行执行
IPC 不可用，但单实例锁存在       -> 阻断，提示重启新版
IPC 不可用，且 SVNmate 未运行    -> 调用共享 core
```

外部请求不运行 SVNmate 的用户 BAT/每日任务；详见
[共享更新指南](svnmate-development.md)。

## 尚未落地

这些是方向，不是现行接口或默认待执行步骤：

- SQLite 本地任务历史、人工豁免审计与 schema 迁移。
- `commit_info.json` 导入、schema v2 的实际依赖/失败项清单；SVN 独立扫描仍应是
  核验依据，不能仅信迁移器自报成功。
- Markdown 报告导出、逐文件源漂移、表格语义差异和依赖资源精确 Jira 归属。
- 外部 `SeriaTableUtil` 可能包含 merge/revert，不能因为“复用”就自动调用。
- 二进制 `.uasset` 语义一致性不由当前路径/提交证据保证。

外部旧脚本曾只看本地状态或打开提交窗口，不足以证明迁移完成；保留此设计理由，
不继续维护过时的旧代码行号、完整未实现数据结构和已完成实施步骤。

## 验证

命令归 [AI 指南](../migration_guard/AGENTS.md)。按变更覆盖：
选区贯穿两阶段、源快照新提交失效、取消提交仍待提交、同路径跨任务、源删除、
externals、工作区映射改变、缓存取消、更新失败重试、IPC 占用和本地额外修改。
UI 验收按视觉文档；实机 UE/SVN 迁移需要明确授权，普通测试不能代替真实提交证据。
