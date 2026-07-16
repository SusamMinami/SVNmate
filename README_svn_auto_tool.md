# 一键更新SVN

这是一个 Windows 桌面小工具，用来批量执行多个文件夹的 SVN 更新、清理和项目脚本。

## 启动方式

双击：

```text
dist\SVNAutoTool.exe
```

如果你想用源码方式运行，也可以双击：

```bat
run_svn_auto_tool.bat
```

或在当前目录执行：

```bat
python svn_auto_tool.py
```

运行 exe 不需要额外安装 Python。工具会优先使用 TortoiseSVN 的 `TortoiseProc.exe` 执行 update/cleanup，这和右键菜单行为更接近；如果找不到 TortoiseSVN，才会回退到命令行 `svn.exe`。

执行 TortoiseSVN update 时，工具会在确认窗口已经完成后自动点击 `OK/确定/确认/关闭`；执行 cleanup 时会使用 TortoiseSVN 的 `/noui` 静默清理，避免弹出确认窗口。

右上角有音乐播放开关。默认开启，工具会优先播放 exe 所在目录下的 `.mp3` 音乐文件，也兼容 `.wav`。

全部任务完成后，音乐会淡出并暂停。

界面右下角会显示作者签名 `SusamMinami`，签名左侧的圆点用于检查更新；检测到新版本后圆点会变红，点击即可下载并应用更新。软件会根据时间自动切换外观：19:00 后进入暗黑主题，白天保持浅色主题。

点击“使用指南”按钮会打开在线文档：

```text
https://bytedance.larkoffice.com/docx/BdDod9tjIo4rPbx2oWHchVRUnwh
```

## 重新打包

如果修改了 `svn_auto_tool.py`，双击下面的文件可以重新生成 exe：

```bat
build_exe.bat
```

打包结果会输出到：

```text
dist\SVNAutoTool.exe
```

## 文件夹配置

文件夹分为“栏目一”和“栏目二”两栏，每栏左上角都有“添加文件夹”按钮。

列表中的 `[x]` 表示会参与执行，`[ ]` 表示暂时不执行。点击第一列或双击选中行可以切换勾选状态。

点击“保存配置”后，文件夹路径、勾选状态、执行选项和定时设置都会保存；下次打开软件会自动恢复。

## 执行流程

工具会按勾选顺序逐个处理文件夹，避免多个 SVN 工作副本操作同时抢锁。

每个文件夹内部按以下顺序执行：

1. `svn update`
2. 如果开启“每日更新主干Bin包”，并且当天还没有成功执行过，则识别 `bin\\WindowsNoEditor` 并在 `bin\\WindowsNoEditor` 文件夹内执行 `Update.bat`
3. `svn cleanup`
4. 如果开启“Clean up完成后，自动运行res目录Build.bat”，并识别到 `res` 文件夹，则在 `res` 文件夹内执行 `Build.bat`

如果 `svn update` 时 SVN 提示需要先执行 cleanup，工具会自动执行一次 `svn cleanup`，然后重试一次 `svn update`。

执行 `Update.bat` 和 `Build.bat` 时会显示原始 CMD 窗口；工具会自动给窗口发送 Enter 来通过脚本里的 `pause`。脚本成功结束后窗口会关闭，如果脚本返回错误，窗口会保留 5 秒方便查看错误。全部任务完成后，工具状态会显示“已完成”，实时输出区域会变成绿色。

## 自定义脚本位置

执行选项里可以手动选择 `Update.bat` 和 `Build.bat` 的位置。

- 不选择时，继续使用默认规则：`bin\\WindowsNoEditor\\Update.bat` 和 `res\\Build.bat`
- 如果选择的 bat 位于已配置的 SVN 文件夹下，工具会优先保存相对路径，便于切换不同分支时复用相同层级
- 如果选择的 bat 不在已配置文件夹下，工具会保存并执行绝对路径
- 点击“默认”可以清空自定义位置并恢复默认识别规则

## 路径识别规则

工具支持两种添加方式：

- 直接添加项目根目录：工具会检查 `bin\\WindowsNoEditor` 和 `res`
- 直接添加 `bin` 或 `res` 文件夹：工具也会按对应规则执行

## 配置和日志

配置会自动保存到：

```text
svn_auto_tool_config.json
```

执行日志会按天保存到：

```text
logs\svn_auto_tool_YYYY-MM-DD.log
```

配置文件和日志目录会在第一次使用后自动生成。使用 exe 时，它们会保存在 `SVNAutoTool.exe` 所在目录。

工具启动时会自动清理 7 天前的日志文件。

## 定时执行

勾选“启用每天定时执行”，填写 `HH:MM` 格式时间即可，例如：

```text
09:00
```

工具需要保持打开状态，才能按时触发任务。
