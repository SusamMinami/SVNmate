# 一键更新SVN v1.4.0

本版本新增工具模块管理，并发布 ConfigLinker `1.2.1`。

## SVNmate

- 设置区调整为“执行与自动化”和“工具模块”两张卡片。
- 支持按需安装、打开、选择和独立更新 ConfigLinker。
- KindleLarkStatus 已预留公共更新端点，并支持选择已有 EXE、打开和启动时联动。
- 模块启动时后台检查版本；网络失败不阻断 SVN 更新或模块启动。
- 已选择的旧 `kindle_status_path` 自动迁移到 `tool_module_paths`。
- KindleLarkStatus 继续支持“启动时联动”，并避免重复启动。
- SVNmate 主程序仍使用 `SVNmate.zip` 和 `v1.4.0` Release 更新。

## ConfigLinker 1.2.1

- 使用独立的关系节点网络图标，不再复用 SVNmate 图标。
- 修复高 DPI 和跨显示器场景下的字体缩放，扩大默认三栏窗口。
- 模型资源卡片移除自动生成路径，配置路径支持横向滚动、选择和复制。
- 双击目标物、NPC、资源 ID 可复制完整数字并显示提示。
- 当前查询 ID 和查询中心有明确高亮，多级返回会恢复焦点。
- 目标物坐标和旋转在选中详情中同一行显示，可单独复制。
- 数据入口改为选择配置仓 `doc` 根目录，并自动定位 `doc\csvdir`。
- 支持从 SVNmate 更新，也支持标题区圆点独立检查和更新。

## KindleLarkStatus Windows 模块

- SVNmate 可选择、启动已有的 `KindleLarkStatus.exe`。
- Windows 模块已切换到 SVNmate 公共仓库的独立固定 Release 端点，首次资产发布后可匿名安装和更新。
- 更新器支持关闭、替换和按原运行状态重启。
- 应用内“更新 Kindle”仍只通过 SSH 更新 KUAL 和 Kindle 端 Shell 文件。
- Windows 模块更新与 Kindle 端更新是两条独立链路。

## 更新安全

- 模块清单校验模块 ID、版本、HTTPS 下载地址、SHA-256 和安全入口文件。
- ZIP 解压拒绝绝对路径和目录穿越。
- 更新仅替换模块 EXE 与公开 `VERSION` 文件。
- 不覆盖 ConfigLinker JSON 配置、KindleLarkStatus `%APPDATA%` 配置、Token、日志、缓存或 SSH 私钥。
- ConfigLinker 与 KindleLarkStatus 使用各自的独立固定 Release 通道，不覆盖 SVNmate 主程序的 latest Release。

## 安装

从 GitHub Release 下载 `SVNmate.zip`，解压后运行 `SVNAutoTool.exe`。

ConfigLinker 与 KindleLarkStatus 不预装，均可按需在线安装或选择已有 EXE。
