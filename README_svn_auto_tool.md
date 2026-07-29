# 一键更新SVN

这是一个 Windows 桌面小工具，用来批量执行多个文件夹的 SVN 更新、清理和项目脚本。

## v1.4.0 更新摘要

本版本新增独立工具模块体系：

- 设置区调整为“执行与自动化”和“工具模块”两张卡片。
- ConfigLinker 可按需安装；KindleLarkStatus 已预留公共更新端点，两者都可选择已有 EXE，且不进入 SVNmate 主安装包。
- 支持打开、选择现有 EXE、检查和在线安装模块；Kindle 公共通道已经启用。
- 两个模块使用各自的固定 Release 端点，不会覆盖 SVNmate 主程序更新。
- 下载前校验 manifest 模块 ID、HTTPS 地址、版本、入口文件和 SHA-256。
- ZIP 解压拒绝目录穿越；替换只允许模块 EXE 和公开 `VERSION`。
- 模块配置、日志、OAuth Token、SSH 私钥和其他运行文件不在更新白名单内。
- 运行中的模块会在用户确认后关闭、替换并按原状态重启。
- ConfigLinker `1.2.1` 使用独立关系网络图标，修复高 DPI 字体和默认窗口尺寸。
- ConfigLinker 支持查询中心高亮、双击 ID 复制、长路径横滚/选择复制，坐标和旋转在选中详情中同一行显示。
- ConfigLinker 数据入口改为 `doc` 根目录，自动定位 `doc\csvdir` 下的三张 CSV。

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

界面采用紧凑的 Metro 风格：Segoe UI 字体、扁平卡片、蓝色强调按钮和高对比度昼夜主题。设置区左侧是“执行与自动化”，右侧是“工具模块”。Windows 端启用 Per-Monitor V2 DPI 感知，在 125%/150% 缩放和多显示器环境下会按当前显示器 DPI 重新校准字体，避免系统拉伸造成文字发虚。

界面右下角会显示作者签名 `SusamMinami`，签名左侧的圆点用于检查更新；检测到新版本后圆点会变红，点击即可下载并应用更新。软件会根据时间自动切换外观：19:00 后进入暗黑主题，白天保持浅色主题。

点击“使用指南”按钮会打开在线文档：

```text
https://bytedance.larkoffice.com/docx/BdDod9tjIo4rPbx2oWHchVRUnwh
```

## 工具模块

“工具模块”卡片提供两个独立程序：

```text
配置关系检索器（ConfigLinker）
Kindle 提示板（KindleLarkStatus）
```

每行包含模块状态/版本、安装或打开、检查或更新、选择现有程序。

### 按需安装

模块未安装时点击“安装”。SVNmate 会读取对应的固定 manifest、下载 ZIP、校验 SHA-256，再安装到：

```text
modules\ConfigLinker\ConfigLinker.exe
modules\KindleLarkStatus\KindleLarkStatus.exe
```

模块不随 `SVNmate.zip` 预装。安装失败不会删除当前可用版本，也不会覆盖模块配置。

### 选择已有程序

已有独立 EXE 时点击对应行的“选择”：

- ConfigLinker 必须选择 `ConfigLinker.exe`。
- Kindle 提示板必须选择 `KindleLarkStatus.exe`。
- 新的 `tool_module_paths` 会保存到 `svn_auto_tool_config.json`。
- 旧版 `kindle_status_path` 会自动迁移，不需要重新选择。

### 检查与更新

SVNmate 启动后会后台检查两个模块。网络失败只把模块状态改为“检查失败”，不影响 SVN 更新和已安装模块启动。

- 无更新时保持当前版本。
- 有更新时“检查”变为“更新”。
- 更新前必须人工确认，不会静默替换。
- 模块正在运行时会先提示关闭；更新完成后按原状态重启。
- 更新只替换 EXE 和公开 `VERSION`，不覆盖 JSON/INI 配置、日志、Token、缓存或 SSH 私钥。

ConfigLinker 还可以在自身标题区点击更新圆点独立更新。SVNmate、ConfigLinker 和 KindleLarkStatus Windows 模块拥有各自版本，互不覆盖。

KindleLarkStatus 源码仓保持私有；Windows 模块通过 SVNmate 仓库的独立 `kindle-windows-latest` 公共通道发布，可匿名读取 manifest、安装和更新。发布与验收记录见 [Kindle 公共更新通道交接](https://github.com/SusamMinami/SVNmate/blob/main/KINDLE_PUBLIC_CHANNEL_HANDOFF.md)。

## ConfigLinker 使用

完整操作说明：[ConfigLinker 使用指南](https://github.com/SusamMinami/SVNmate/blob/main/config_id_lookup/USER_GUIDE.md)。

1. 打开“配置关系检索器”。
2. 点击“选择 doc 目录”，选择包含 `csvdir` 的配置仓 `doc` 根目录。
3. 选择目标物 ID、NPC ID 或模型资源 ID，输入整数后搜索。
4. 单击结果中的关系 ID 可切换查询中心，点击“返回上一步”可连续回退。
5. 双击 ID 会复制完整数字并显示提示。
6. 模型资源路径可横向滚动；下方只读输入框支持框选和 `Ctrl+C`。
7. 选中目标物后，坐标和旋转会在“选中详情”中同一行显示，双击字段可复制。

程序自动读取：

```text
doc\csvdir\m目标物表.csv
doc\csvdir\NPC表.csv
doc\csvdir\m模型资源表.csv
```

如果误选 `csvdir`，程序会自动使用父级 `doc`。ConfigLinker 只读 CSV，不保存 Excel，不运行 VBA、导表器或配置检查脚本。

## Kindle 提示板联动与更新

在 Kindle 提示板模块行勾选“启动时联动”后，每次启动 SVNmate 会打开提示板；已运行时不会重复启动。退出 SVNmate 不会关闭提示板托盘服务。

必须区分两种更新：

- **更新 Windows 模块**：更新器通过公共固定端点在线检查并替换 `KindleLarkStatus.exe`。
- **更新 Kindle 端**：由 KindleLarkStatus 自身通过 SSH 更新 KUAL 元数据和 Kindle Shell 文件，不替换 Windows EXE。

## 系统托盘

SVNmate 启动后会在 Windows 通知区域显示 Metro 蓝色图标。

- 点击窗口关闭按钮或“隐藏到托盘”只会隐藏窗口，定时任务仍会继续。
- 双击托盘图标可恢复并激活主窗口。
- 右键托盘图标可选择“打开 SVNmate”“立即执行”或“退出”。
- 只有选择托盘菜单中的“退出”才会彻底关闭 SVNmate。

## 重新打包

如果修改了 `svn_auto_tool.py`、`tool_modules.py`、`module_updates.py` 或相关资源，双击下面的文件可以重新生成 exe：

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

点击“保存配置”后，文件夹路径、勾选状态、执行选项、定时设置、工具模块路径和 Kindle 联动设置都会保存；下次打开软件会自动恢复。

## 执行流程

工具使用分阶段流水线，并保持同类任务串行：

1. 按勾选顺序逐个执行各文件夹的 `svn update`。
2. `bin` 更新成功后，`Update.bat` 进入单线程后台队列，同时主流程继续后续文件夹的 `svn update`。
3. 等待全部 SVN Update 和后台 `Update.bat` 完成。
4. 按勾选顺序逐个执行 `svn cleanup`。
5. 如果开启“Clean up完成后，自动运行res目录Build.bat”，则在对应 `res` 文件夹 cleanup 成功后执行 `Build.bat`。

SVN Update 彼此不会并发，多个 `Update.bat` 也彼此串行；只有后台 `Update.bat` 会与后续文件夹的 SVN Update 重叠。

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

模块路径保存在配置中的 `tool_module_paths`。ConfigLinker 自己的 doc 目录保存在其 EXE 同目录的 `config_linker_config.json`；KindleLarkStatus 的私有配置仍位于 `%APPDATA%\KindleLarkStatus`，SVNmate 不读取这些内容。

工具启动时会自动清理 7 天前的日志文件。

## 定时执行

勾选“启用每天定时执行”，填写 `HH:MM` 格式时间即可，例如：

```text
09:00
```

工具需要保持打开状态，才能按时触发任务。
