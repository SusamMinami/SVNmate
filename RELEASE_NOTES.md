# 一键更新SVN v1.3.4

本版本修复 BAT 完成后无法自动关闭的问题，并优化 Update.bat 与后续 SVN Update 的执行流水线。

## 功能

- 批量执行 SVN Update / Cleanup。
- 支持双栏文件夹配置和勾选执行。
- 按勾选顺序逐个处理文件夹，减少 SVN 工作副本锁冲突。
- 支持定时执行日常更新任务。
- 支持每日首次自动更新 `bin\WindowsNoEditor\Update.bat`。
- 支持 Cleanup 完成后自动执行 `res\Build.bat`。
- 支持手动选择 `Update.bat` 和 `Build.bat` 的位置，留空时使用默认规则。
- 支持启动 SVNmate 时自动打开 KindleLarkStatus，可手动选择稳定 EXE 路径。
- 自动检测 KindleLarkStatus 是否已经运行，避免重复启动。
- SVNmate 退出时不关闭 KindleLarkStatus，提示板托盘服务可继续运行。
- 使用 Segoe UI、扁平卡片和 Metro 蓝色强调色重构昼夜界面。
- 启用 Per-Monitor V2 DPI 感知，修复 125%/150% 缩放下由系统拉伸导致的字体发虚。
- 根据当前显示器 DPI 同步校准 Tk 字体缩放和初始窗口尺寸。
- 将定时执行与提示板联动压缩到同一行，扩大实时输出区域。
- 新增 Windows 系统托盘图标，双击恢复窗口，右键可立即执行或退出。
- 窗口关闭按钮改为隐藏到托盘，保证定时任务继续运行。
- 右下角签名左侧的更新圆点更小、更靠近签名，检测到新版本后变红，点击即可更新。
- 检查更新改为使用 GitHub Releases 普通跳转链接，避免未登录 API 限流导致的 403。
- 使用控制台输入和安全兜底按键自动通过 BAT 末尾的 `pause`，脚本完成后 CMD 自动关闭。
- `bin` 更新完成后立即后台执行 `Update.bat`，同时继续后续文件夹的 SVN Update。
- SVN Update 与多个 `Update.bat` 各自保持串行；全部完成后再按勾选顺序执行 Cleanup 和 Build。
- GitHub Release 统一使用稳定附件名 `SVNmate.zip`，修复中文附件被重命名后自动更新下载返回 404 的问题。
- 客户端下载地址与 Release 附件名保持一致。
- 修复 BAT 路径引号被转义为 `\"...\"` 后 `cmd.exe` 无法识别脚本的问题。
- BAT 继续在脚本所在目录的可见 CMD 中执行，行为与手动双击一致。
- 新增 Windows BAT 启动回归测试，覆盖含空格的脚本路径。
- `Update.bat` 和 `Build.bat` 都会使用可见 CMD 窗口运行，失败时保留窗口 5 秒，避免错误一闪而过。
- 发布包音乐改为压缩后的 `.mp3`，显著降低安装包体积。
- 实时输出执行过程，并在任务完成后显示完成状态。
- 支持音乐开关、任务完成后音乐淡出暂停、昼夜主题、右下角签名和使用指南入口。

## 使用

从 GitHub Release 下载 `SVNmate.zip`，解压后运行 `SVNAutoTool.exe`。

仓库内分享包：`一键更新SVN.zip`
