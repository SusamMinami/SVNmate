# 一键更新SVN

一个 Windows 桌面小工具，用来批量执行 SVN 更新、清理和项目脚本，并管理独立辅助工具。

## 功能

- 管理两栏 SVN 文件夹列表，只执行已勾选项目
- 自动执行 SVN update 和 cleanup
- 支持每日更新 `bin\WindowsNoEditor\Update.bat`
- 支持 cleanup 后自动运行 `res\Build.bat`
- 支持手动选择 `Update.bat` 和 `Build.bat` 的位置
- 支持按需安装、打开和独立更新 ConfigLinker
- 支持选择已有 KindleLarkStatus EXE、打开和启动时联动
- 支持启动时联动打开 KindleLarkStatus，并避免重复启动
- 支持每天定时执行
- Metro 风格紧凑界面，执行设置与工具模块分栏显示
- 支持 Per-Monitor DPI，125%/150% 缩放下保持字体清晰
- 支持 Windows 系统托盘，双击图标恢复窗口
- 实时输出执行日志，任务完成后变为绿色提示
- 右上角音乐开关，默认播放同目录 `.mp3` / `.wav` 音乐，任务完成后淡出暂停
- 右下角签名左侧有更新圆点，检测到新版本后变红，点击即可更新
- 19:00 后自动切换暗黑主题，白天恢复浅色主题

## 使用

下载或解压分享包后，双击：

```text
SVNAutoTool.exe
```

首次启动会自动生成本机配置文件。配置、日志不会上传到仓库。

点击窗口关闭按钮或“隐藏到托盘”后，程序会继续在系统托盘运行，以保证定时任务有效。双击托盘图标可恢复窗口；右键托盘图标可打开窗口、立即执行或彻底退出。

## v1.4.0 更新摘要

- 新增“工具模块”卡片，统一管理配置关系检索器和 Kindle 提示板。
- ConfigLinker 可按需下载安装；KindleLarkStatus 已预留公共更新端点，也可选择已有 EXE。
- 支持选择已有 EXE、查看本地版本、打开和检查模块。
- 两个模块使用各自的固定 Release 通道，版本不与 SVNmate 主版本绑定。
- 模块下载执行 HTTPS、manifest 字段校验、SHA-256 校验和 ZIP 路径穿越防护。
- 更新仅替换模块 EXE 和公开 `VERSION`，保留用户配置、日志、Token 和 SSH 私钥。
- ConfigLinker 升级到 `1.2.1`：使用独立关系网络图标，目标物坐标和旋转在选中详情中同一行显示。
- ConfigLinker 修复高 DPI 字体、扩大三栏窗口，并支持查询高亮、双击复制和长路径选择复制。
- ConfigLinker 改为选择 `doc` 根目录，并自动读取 `doc\csvdir` 下三张配置表。

## 工具模块

SVNmate 的“工具模块”卡片包含：

- **配置关系检索器**：目标物 ID、NPC ID 与模型资源 ID 的双向检索。
- **Kindle 提示板**：Windows 桌面客户端，可保留“启动时联动”。

模块缺失时点击“安装”，已安装时点击“打开”；“检查”会读取固定发布清单，有新版后按钮变为“更新”。两个模块都可以点击“选择”接管已有的独立 EXE。Kindle 公共通道已经发布，可直接在线安装和更新。

KindleLarkStatus 源码仓保持私有，Windows ZIP 与 manifest 发布在 SVNmate 仓库的独立 `kindle-windows-latest` 通道。发布与验收记录见 [Kindle 公共更新通道交接](KINDLE_PUBLIC_CHANNEL_HANDOFF.md)。

ConfigLinker 的完整操作说明见：[ConfigLinker 使用指南](config_id_lookup/USER_GUIDE.md)。

模块配置只记录在 `svn_auto_tool_config.json`。SVNmate 不读取 ConfigLinker 的配置仓数据，也不读取 KindleLarkStatus 的 OAuth Token、SSH 私钥或运行时配置。

## 分享包

仓库内提供干净分享包：

```text
一键更新SVN.zip
```

包内只包含：

```text
一键更新SVN/
  SVNAutoTool.exe
  Max Riser - Ladyfingers Lofi.mp3
  README_svn_auto_tool.md
```

ConfigLinker 与 KindleLarkStatus 不在分享包内，均可按需在线安装，也可以选择已有 EXE。

## 使用指南

工具内点击“使用指南”会打开：

```text
https://bytedance.larkoffice.com/docx/BdDod9tjIo4rPbx2oWHchVRUnwh
```
