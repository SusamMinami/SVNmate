# 一键更新SVN v1.1.2

本版本修正工具启动 `Update.bat` / `Build.bat` 时与手动双击环境不一致的问题。

## 功能

- 批量执行 SVN Update / Cleanup。
- 支持双栏文件夹配置和勾选执行。
- 按勾选顺序逐个处理文件夹，减少 SVN 工作副本锁冲突。
- 支持定时执行日常更新任务。
- 支持每日首次自动更新 `bin\WindowsNoEditor\Update.bat`。
- 支持 Cleanup 完成后自动执行 `res\Build.bat`。
- 支持手动选择 `Update.bat` 和 `Build.bat` 的位置，留空时使用默认规则。
- `Update.bat` 和 `Build.bat` 都会使用可见 CMD 窗口运行，失败时保留窗口 120 秒，避免错误一闪而过。
- 实时输出执行过程，并在任务完成后显示完成状态。
- 支持音乐开关、任务完成后音乐淡出暂停、昼夜主题、右下角签名和使用指南入口。

## 使用

下载 `一键更新SVN.zip`，解压后运行 `SVNAutoTool.exe`。

发布包文件：`一键更新SVN.zip`
