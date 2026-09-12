# MigrationGuard AI 指南

范围：本目录，以及根目录的 `migration_guard_app.py`、`MigrationGuard.spec`、
迁移构建/启动脚本和 `test_*migration*` 等相关测试。产品是 Windows Python/Tkinter
桌面工具，核心是文件级迁移证据，不是 Jira 状态看板。

## 按任务阅读

| 任务 | 必读入口 |
| --- | --- |
| 文件状态、迁移范围、完成口径 | [需求与验收](../docs/migration-guard-requirements.md) |
| 源快照、增量复核、SVN 路径与缓存 | [技术设计](../docs/migration-guard-design.md) |
| SERIA/OSCOA 解析、飞书页签、国内 OB | [单号路由](../docs/migration-ticket-routing.md) |
| 桌面交互与样式 | [PRODUCT.md](PRODUCT.md)、[DESIGN.md](DESIGN.md) |
| 运行和用户操作 | [用户指南](../README_migration_guard.md) |
| 共享更新、IPC、模块升级 | [SVNmate 开发指南](../docs/svnmate-development.md) |

## 核心约束

- 完成依据是正确目标单号覆盖文件的 SVN 提交证据与干净、已更新的本地状态；
  Jira 版本登记、文件存在、打开或关闭提交窗口都不证明完成。
- 先只读发现单号涉及文件，再让用户选本批资产；选择持续约束更新、核验、UE 迁移、
  提交和 OB 第二阶段。空选择不写入，未选文件不得重新进入批次。
- 国内 trunk -> 海外 trunk -> 海外 OB 必须逐阶段复核；国内 trunk -> 国内 OB
  是独立单阶段路线，使用相同 `SERIA-*`，不依赖飞书映射或海外远端状态。
- 路径身份使用模块、仓库信息和相对路径；externals 单独解析，禁止整条绝对路径
  字符串替换。源快照 revision 覆盖实际扫描提交，不用工作副本根 mixed revision。
- SVNmate 运行时用 IPC；运行但 IPC 不可用时阻断，不并发回退 core。
- UE 执行前校验工程与 `BranchContentPath`。表格、删除和归属不明的依赖留给人工；
  不自动 commit、revert、解决冲突或把额外改动加入当前单。
- 只读刷新幂等；旧任务可取消且不得回写新任务。网络异常保留其他任务的证据。
- 持久任务库、`commit_info.json` 导入、逐文件源漂移展示等计划不等于已实现；
  当前类型以 `models.py` 为准，不照抄技术文档中的提议模型。

## 代码地图

`app.py` 编排 UI；`audit.py` 负责证据与快照；`batch_workflow.py` 负责选区、
迁移和提交分组；`selective_update.py` 规划最小更新目录；`svn_client.py` 解析
SVN XML；`remote_asset_progress.py` 负责远端进度与缓存；`ticket_mapping.py`
负责映射/路线；`ue_client.py` 负责 UE 协议。测试在仓库根目录。

## 验证

在仓库根目录执行，按变更范围选择；发布前覆盖整组：

```powershell
python -B -m unittest test_migration_audit test_batch_workflow test_selective_update test_ticket_mapping test_remote_asset_progress test_jira_client test_asset_tree test_migration_guard_app test_svnmate_core test_svnmate_ipc -v
```

运行：`.\run_migration_guard.bat`；构建：`.\build_migration_guard.bat`。
版本源为 `VERSION`；产物为根目录 `dist/MigrationGuard.exe` 和 `dist/VERSION`。
构建会覆盖这些本地产物，文档修改不需要构建。发布工作流见
[publish-migration-guard.yml](../.github/workflows/publish-migration-guard.yml)。
