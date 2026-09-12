# SVNmate 开发指南

> 状态：现行开发入口。范围：根目录主程序、共享 SVN core、IPC 与模块更新。
> 使用步骤见 [用户指南](../README_svn_auto_tool.md)，不套用镜头沙盘的界面规范。

## 从哪里改

| 职责 | 文件 |
| --- | --- |
| Tk 界面、定时任务、托盘、单实例、BAT 编排、自更新 | `svn_auto_tool.py` |
| 无 UI 的 Update/Cleanup/重试及结果模型 | `svnmate_core/update.py` |
| Windows Named Pipe 服务与客户端 | `svnmate_ipc.py` |
| 迁移工具的 IPC 优先/core 回退 | `migration_guard/svn_update_client.py` |
| 模块定义、发现和启动 | `tool_modules.py` |
| manifest、下载校验和模块替换 | `module_updates.py` |
| Metro 昼夜主题与 ttk 样式 | `svnmate_theme.py` |
| EXE 构建 | `SVNAutoTool.spec`、`build_exe.bat` |

路径相对仓库根目录。查实现用文件名和函数名，不依赖会漂移的行号。

## 不可破坏的约束

- SVN update 之间串行，失败后 cleanup 并只重试一次；不得并发更新同一工作副本。
- 主程序的 `Update.bat` 使用单线程后台队列，可与后续目录 SVN update 重叠；
  全部 update 与后台 BAT 完成后，才串行执行 cleanup 和对应 `Build.bat`。
  不把“SVN 串行”误解为所有类型任务完全串行。
- 外部更新请求只处理指定目录的 SVN update/失败恢复，不运行每日任务或用户 BAT。
- IPC 地址为 `\\.\pipe\SVNmate.Command.v1`。检测到 SVNmate 在运行但 IPC 不可用时
  返回 `ipc-unavailable`，禁止并发回退 core；未运行才可直接使用 core。
- `svnmate_core` 不导入 Tkinter、不访问 `StringVar`，以结构化进度/结果与 UI 通信。
- BAT 的工作目录为脚本所在目录，失败窗口保留 5 秒；命令行引号使用
  `_windows_cmd_command_line`，不手动拼入 `\"`。
- Windows 子进程使用独立空输入句柄；句柄无效时停止本轮并走已有重启恢复，
  不在坏进程内反复 Update/Cleanup。
- 关闭窗口隐藏到托盘；重复启动唤醒原实例。处理 Explorer 的 `TaskbarCreated`
  并重建托盘，图标不可用时保留窗口入口。
- 模块下载验证 HTTPS、manifest、入口白名单、ZIP 路径和 SHA-256；只替换允许的
  EXE/公开 `VERSION`，不覆盖配置、缓存、日志或凭据。Kindle 保持弱耦合。
- UI 沿用 `svnmate_theme.py` 的 Metro/Segoe UI、昼夜主题与 Per-Monitor V2 DPI；
  后台结果回 UI 线程，不让网络、SVN 或长日志阻塞主循环。

## 运行与验证

以下命令在仓库根目录执行；开发需要 Windows 与可用的 Python/Tkinter。

```powershell
python -B svn_auto_tool.py
python -B -m unittest test_svn_auto_tool test_svnmate_core test_svnmate_ipc test_tool_modules test_module_updates -v
```

共享 SVN/IPC 改动同时验证迁移调用方：

```powershell
python -B -m unittest test_migration_audit test_batch_workflow test_selective_update -v
```

需要构建时执行 `.\build_exe.bat`；产物为 `dist/SVNAutoTool.exe`。托盘、自更新和
跨显示器 DPI 行为需 Windows 实机验证，单元测试不代替这些验收。

## 发布入口

- 主版本：`svn_auto_tool.py` 的 `APP_VERSION`。
- 主程序发布：[publish-release.yml](../.github/workflows/publish-release.yml)；
  上传的是仓库内分享 ZIP，不会自动重新构建源码，也不自动运行测试。
- 模块发布：[ConfigLinker](../.github/workflows/publish-config-linker.yml)、
  [MigrationGuard](../.github/workflows/publish-migration-guard.yml) 各有固定通道。
- Kindle 外部模块：[交接说明](../KINDLE_PUBLIC_CHANNEL_HANDOFF.md)。

只在明确要求发布时核对版本、干净分享包、测试结果、远端附件与哈希；不要根据
历史发布记录推断当前 ZIP 或已安装 EXE 已包含最新源码。
