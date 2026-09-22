# 一键更新 SVN

SVNmate 是 Windows 桌面工具，负责批量 SVN 更新、清理、项目脚本、定时任务与独立
辅助模块。当前版本以 `svn_auto_tool.py` 中的 `APP_VERSION` 为准。

本仓库还包含迁移核验助手、ConfigLinker、镜头沙盘和 Seria QA Overlay。
AI 开发从 [AGENTS.md](AGENTS.md) 开始；全部文档见 [索引](docs/README.md)。

## 功能与使用

- 两栏目录按勾选顺序 update，失败 cleanup 后只重试一次。
- 支持每日 `Update.bat`、cleanup 后 `Build.bat` 和自定义脚本路径。
- 每日定时、实时日志与成功/失败/跳过摘要，脚本失败窗口保留 5 秒。
- Windows 单实例、托盘、Per-Monitor DPI 与自动昼夜主题。
- 工具模块按需安装、打开、独立更新；Kindle 可设置启动联动。
- 更新提示点、音乐与托盘图标，低频操作在“更多”菜单。

解压分享包后运行 `SVNAutoTool.exe`。关闭窗口只是隐藏到托盘，双击托盘切换显示；
彻底退出使用菜单。重复启动会唤醒原实例。首次运行生成本机配置与日志，不上传仓库。

完整操作、脚本顺序、自更新恢复与定时设置见
[README_svn_auto_tool.md](README_svn_auto_tool.md)；历史更新见
[RELEASE_NOTES.md](RELEASE_NOTES.md)，不在概览重复逐版本内容。

## 独立产品

| 产品 | 用途 | 文档 |
| --- | --- | --- |
| MigrationGuard | Jira/SVN 文件级证据、按需更新与分阶段 UE 迁移 | [用户指南](README_migration_guard.md) |
| ConfigLinker | 只读配置关系、命名角色与正式服武器查询 | [README](config_id_lookup/README.md)、[使用指南](config_id_lookup/USER_GUIDE.md) |
| 镜头沙盘 | UE4 对白、站位、分镜、NPC/目标物与动画语音制作 | [README](dialogue-shot-sandbox/README.md) |
| Seria QA Overlay | 游戏内只读任务诊断；DLSS5 作为独立可选安装包 | [README](seria-qa-overlay/README.txt) |
| KindleLarkStatus | 外部桌面提示板，源码不在此仓库 | [公共更新通道交接](KINDLE_PUBLIC_CHANNEL_HANDOFF.md) |

SVNmate 的工具模块入口管理 ConfigLinker、MigrationGuard 与 KindleLarkStatus，
状态对应“安装/打开/更新”。各自版本和发布通道独立，升级不覆盖用户配置、缓存
或凭据。SVNmate 不读取 ConfigLinker 的业务 CSV，也不读取 Kindle 的 Token/私钥。
镜头沙盘是本仓库的另一独立工程，不因此成为上述模块管理器的一项。

## 模块调用 SVN 更新

本机模块通过统一客户端请求指定目录更新：

```python
from migration_guard import update_working_copies

result = update_working_copies(
    [r"C:\trunk\res", r"D:\Oversea\OStrunk\res"]
)
```

SVNmate 运行时通过 `\\.\pipe\SVNmate.Command.v1` 执行；未运行时调用共享 core。
运行但 IPC 不可用时返回 `ipc-unavailable`，不并发启动第二套更新。
外部请求只执行 SVN 更新和失败恢复，不运行用户 BAT 或每日任务。
实现边界见 [开发指南](docs/svnmate-development.md)。

## 开发与分享

源码运行：`python -B svn_auto_tool.py`；构建：`.\build_exe.bat`，
产物为 `dist/SVNAutoTool.exe`。测试和发布要求见开发指南。

仓库的 `一键更新SVN.zip` 是分享产物，包含主程序、背景音乐与使用指南，
不代表随源码修改自动更新，也不预装其他模块。不要用旧 ZIP 的版本推断当前源码。
工具内在线指南：
[飞书使用文档](https://bytedance.larkoffice.com/docx/BdDod9tjIo4rPbx2oWHchVRUnwh)。
