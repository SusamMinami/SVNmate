# 开发、联调与发布

> 状态：现行操作指南。以下命令在 `dialogue-shot-sandbox/` 执行。
> 日常编码先读 [AGENTS.md](../AGENTS.md)，不需要默认运行所有联调脚本。

## 本地开发

需要 Node.js/npm；Windows 正式交付使用 Electron，Vite 页面只是开发与验收载体。
依赖约束和命令以 [package.json](../package.json)、lockfile 为准。

```powershell
npm ci
npm run dev
```

Vite 绑定本机，通常为 `http://127.0.0.1:5173`，实际地址看启动输出。
Electron 本地运行使用 `npm run desktop`，它会先构建。
普通桌面用户不需要安装 Node.js。

在设置中选择两个独立根目录，不将真实数据拷进仓库：

| 根目录 | 读取范围 |
| --- | --- |
| `res` | `Content/Seria/Tables/csvdir` 中对话、开始节点、任务 |
| `doc` | `csvdir` 中 NPC、模型、目标物、地图等配置 |
| 从 `doc` 推导 | `xlsdir` 下 Excel 源表，不能从实时 `res` 推导 |

设置通过 `server/configRepository.ts` 管理。任一新目录加载失败时保留原数据源，
不只替换路径。浏览器目录读取回退与 Worker 调度在 `src/data/csvLoader.ts`；
CSV 不上传，正式界面不回退主线程解析。

## 端口与进程

| 服务 | 默认地址 | 说明 |
| --- | --- | --- |
| Vite 开发服务 | `127.0.0.1:5173` | 本地 API 与前端 |
| UE OmniMcpCore | `127.0.0.1:12031` | UE 编辑器插件，不是 TRAE MCP |
| 桌面分镜 MCP | `http://127.0.0.1:43127/mcp` | TRAE 领取任务 |
| Ollama | `127.0.0.1:11434` | 可选按需运行，配置见端侧顾问专题 |

源码可通过 `UE_MCP_HOST/UE_MCP_PORT` 覆盖 UE 地址。桌面设置保存在
`%APPDATA%/Shot Sandbox/desktop-state.json`；任务队列为同目录下 `runtime`。
不探测无关端口，也不启动第二个 UE 写入进程。

## TRAE 与飞书

1. 桌面设置中生成 TRAE 配置，在 `%APPDATA%/Shot Sandbox/trae-integration`
   创建独立集成工作区；用 TRAE 打开并启用 MCP 与 `.agents` Skill。
2. 桌面使用生成配置中的 HTTP MCP，不能把便携 EXE 当作 stdio command。
   源码配置模板为 [trae-integration/mcp.json](../trae-integration/mcp.json)。
3. 分镜任务规则位于仓库根目录
   [.agents/skills/internal-storyboard-director/SKILL.md](../../.agents/skills/internal-storyboard-director/SKILL.md)；
   只在处理分镜任务时加载，不当作全仓编码指南。
4. 在沙盘提交任务后，向 TRAE 发出“处理待分镜任务”。只有 MCP 实际访问过，
   界面才显示真实连接；仅启动软件不表示 TRAE 已连接。
5. 源码 MCP 升级后在 TRAE 中停用再启用；刷新前端不会重启 MCP。
   桌面启动会同步内置配置/Skill；已打开旧集成目录时需重载 TRAE 窗口。

任务默认排队等待 30 分钟、领取后等待 20 分钟，分别可用
`STORYBOARD_TRAE_QUEUE_TIMEOUT_MS`、`STORYBOARD_TRAE_PROCESSING_TIMEOUT_MS` 覆盖。
5 分钟无心跳导致租约取消，与界面等待超时不同；状态约束见
[分镜工作流](storyboard-workflow.md)。

飞书使用本机 `lark-cli` 的当前用户身份，凭据由 CLI 持久化，不能写入仓库或包。
音效/音乐目录仅在设置中手动同步，不后台定时刷新；附件按需下载。
Mira 候选有歧义时可设置 `MIRA_BOT_OPEN_ID`、`MIRA_BOT_NAME`。

| 数据库 | 可替换配置 | 禁用远端访问 |
| --- | --- | --- |
| 共享分镜 | `STORYBOARD_SHARED_BASE_TOKEN`、`STORYBOARD_SHARED_TABLE_ID` | `STORYBOARD_SHARED_LIBRARY_DISABLED=1` |
| 返修案例 | `STORYBOARD_CASE_TABLE_ID` | `STORYBOARD_CASE_LIBRARY_DISABLED=1` |
| 导演偏好 | `DIRECTOR_PREFERENCE_TABLE_ID` | `DIRECTOR_PREFERENCE_LIBRARY_DISABLED=1` |

具体最小授权以 `server` 中实际 CLI 调用和设置页为准，不复制可能过期的全量 scope
清单。这些禁用开关不代替测试 mock，也不授权其他网络读写。

## 验证命令

```powershell
npm test
npm run build
npm run test:e2e
```

- 聚焦测试：`npx vitest run src/data/dialogueRepository.test.ts`。
- 聚焦 E2E：`npx playwright test e2e/dialogue-strip.spec.ts`。
- Playwright 使用已安装 Microsoft Edge（`msedge`），默认 `1440x900` 桌面项目。
  它会自行启动/关闭开发服务，不复用已有服务；端口被占用时先设置
  `$env:PLAYWRIGHT_PORT = "4174"`。不新增移动端矩阵。
- UI/Three.js 变更检查桌面截图、Canvas 非空、减少动态效果和文字溢出。
  纯文档改动按根目录指南做链接与 diff 检查，无需构建和启动 UE。

以下均不是默认回归测试，运行前确认副作用与用户授权：

| 任务 | 指南与副作用 |
| --- | --- |
| 端侧模型 smoke / 安装 | [端侧顾问](rule-director-edge-advisor.md)，可能启动推理或下载模型 |
| 全库音乐分析 | [音乐分析](music-analysis.md)，`analyze:music` 默认带发布，写飞书 Base |
| 音效附件同步 | [音效试听](sound-effect-preview.md)，会上传/更新远端附件 |
| ASR 安装与 UE 写探针 | [动画语音](animation-voice-workspace.md)，下载环境或创建/删除测试资产 |
| 图编辑探测 | [插件可行性](local-dialog-plugin-feasibility.md)，需核对测试环境与当前插件能力 |

## Windows 发布

仅在明确要求打包/发布时操作：

```powershell
npm run dist:win
```

构建安装版和便携版到 `artifacts/`，同时生成 `latest.yml` 与 blockmap。
该命令使用 `--publish never`，构建成功不代表远端已有附件。
版本源为 `package.json`；应用内更新摘要使用 `UPDATE_NOTES.md`，
完整逐版本记录使用 `RELEASE_NOTES.md`，不要把两者当成现行规范。

GitHub CLI 已登录后，发布入口是：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish-update.ps1
```

脚本重新构建并上传固定通道 `shot-sandbox-update` 的安装版、便携版、更新元数据
与校验和。逐项核对上传、版本与哈希；本机安装是另一步。当前无商业签名配置时，
不能承诺 SmartScreen 不提示未知发布者。
