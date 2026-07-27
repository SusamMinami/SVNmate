# 一键更新SVN

一个 Windows 桌面小工具，用来批量执行 SVN 更新、清理和项目脚本。

## 功能

- 管理两栏 SVN 文件夹列表，只执行已勾选项目
- 自动执行 SVN update 和 cleanup
- 支持每日更新 `bin\WindowsNoEditor\Update.bat`
- 支持 cleanup 后自动运行 `res\Build.bat`
- 支持手动选择 `Update.bat` 和 `Build.bat` 的位置
- 支持启动时联动打开 KindleLarkStatus 提示板，并避免重复启动
- 支持每天定时执行
- Metro 风格紧凑界面，定时与联动设置并排显示
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

## v1.3.2 更新摘要

- 修复程序启动 `Update.bat` 和 `Build.bat` 时路径引号被错误转义的问题。
- BAT 继续在脚本所在目录的可见 CMD 中串行执行，行为与手动双击保持一致。
- 新增 Windows BAT 启动回归测试，覆盖含空格的脚本路径。
- 重构为 Metro 风格紧凑界面，保留下方实时输出空间。
- 定时执行与 KindleLarkStatus 联动启动合并到“自动化”区域。
- 新增 Windows 系统托盘，关闭窗口后继续运行，双击托盘图标恢复。
- 启用 Per-Monitor V2 DPI 感知，修复高缩放显示器上的字体发虚。
- 更新分享包内 EXE、使用指南和 Metro 蓝色图标。

## 联动 Kindle 提示板

勾选“启动 SVNmate 时同步打开 Kindle 提示板”后，每次只需启动 SVNmate。

程序会自动识别默认位置，也可以通过“选择程序”指定独立维护的 `KindleLarkStatus.exe`。联动只负责启动，不会复制或修改 KindleLarkStatus 的代码和配置；关闭 SVNmate 也不会结束提示板服务。

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

## 使用指南

工具内点击“使用指南”会打开：

```text
https://bytedance.larkoffice.com/docx/BdDod9tjIo4rPbx2oWHchVRUnwh
```
