# 工作区 AI 导航

本仓库包含多个独立 Windows 工具，不是一个统一 Web 应用。先确定目标项目，
再读取该行入口；不要默认加载所有 Markdown，也不要跨项目套用 UI 或数据规则。

## 项目路由

| 任务或路径 | 技术栈与边界 | 开始阅读 |
| --- | --- | --- |
| SVNmate、一键更新 SVN、根目录 `svn_auto_tool.py` | Python/Tkinter，SVN 更新、脚本、托盘 | [SVNmate 开发指南](docs/svnmate-development.md) |
| `svnmate_core/`、`svnmate_ipc.py`、`module_updates.py`、`tool_modules.py` | 共享更新/IPC，改动须验证调用方 | [SVNmate 开发指南](docs/svnmate-development.md) |
| MigrationGuard、迁移核验、`migration_guard/`、根目录迁移入口与测试 | Python/Tkinter，Jira/SVN 证据与 UE 迁移 | [迁移助手 AI 指南](migration_guard/AGENTS.md) |
| ConfigLinker、配置关系检索、`config_id_lookup/` | Python/Tkinter，只读 CSV 关系查询 | [ConfigLinker AI 指南](config_id_lookup/AGENTS.md) |
| 镜头沙盘、运镜沙盒、`dialogue-shot-sandbox/` | Electron/React/TypeScript/Three.js，UE4 制作工具 | [镜头沙盘 AI 指南](dialogue-shot-sandbox/AGENTS.md) |
| Seria QA、任务 Overlay、DLSS5、`seria-qa-overlay/` | C++/Lua/PowerShell，游戏内只读任务工具与独立 DLSS5 安装包 | [Seria QA AI 入口](seria-qa-overlay/AGENTS.md) |
| `rust/seria-config-*`、跨工具 CSV 核心 | Rust，只读双表头解析与关系索引；各产品私有打包 | [Rust 数据核心](rust/README.md) |

KindleLarkStatus 在此仓库仅有模块启动、更新与交接资料，其产品源码不在这里。
`build/`、`dist/`、`release/`、`artifacts/` 是产物，不是优先编辑的源码入口。

## 工作规则

- 先看 `git status --short` 与目标文件的 diff，保留已有未提交改动。
- AI 入口只维护项目边界、必守约束、任务路由和验证命令。功能细节只在对应专题
  维护；UI 改动再读该项目 `PRODUCT.md` / `DESIGN.md`，无需为后端小改全读。
- 现行规范规定预期行为，源码和测试证明当前实现。发现不一致先核对并说明，
  不凭旧文档“修回”已经更新的代码。
- 研究、历史计划、测试记录不是当前待办；其中的日期、版本和测试数量只是当时证据。
- 不提交运行时配置、Token、私钥、业务 CSV/Excel、缓存、日志或本机绝对路径。
- UE、Excel、SVN 和飞书写入只执行用户授权的任务范围；整理文档或运行普通测试
  不构成访问生产数据、创建测试资产、下载模型、发布附件或发消息的授权。
- 不自动提交、推送、发布、升级版本或覆盖已安装 EXE。不同产品独立版本、独立通道。

## 验证范围

- 纯文档：检查相对链接、引用的代码/命令是否存在、冲突规则、`git diff --check`；
  不要求因此启动 UE、Excel 或全量应用测试。
- 代码：先跑目标模块测试；共享组件改动覆盖调用方，UI 改动补桌面交互与 DPI 验收。
  各项目命令见对应 AI/开发指南。
- 构建成功、测试通过、本机安装与远端发布是不同结论，只报告实际完成的步骤。
- 当前 GitHub 工作流主要是发布工作流，不应假定推送后会替代本地验证。
  `migration_guard/**` 和 `config_id_lookup/**` 的文档改动也可能触发发布。

完整目录见 [文档索引](docs/README.md)；新增或整理指南时读
[文档维护约定](docs/documentation-maintenance.md)。
