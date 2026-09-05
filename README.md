# 一键更新SVN

一个 Windows 桌面小工具，用来批量执行 SVN 更新、清理和项目脚本，并管理独立辅助工具。

多项目的产品、设计、现行规范与历史文档入口见
[`docs/README.md`](docs/README.md)。

## 功能

- 管理两栏 SVN 文件夹列表，只执行已勾选项目
- 右键列表中的文件夹可直接在资源管理器中打开
- 自动执行 SVN update 和 cleanup
- SVN update 失败时自动 cleanup，并重试一次 update
- 支持每日更新 `bin\WindowsNoEditor\Update.bat`
- 支持 cleanup 后自动运行 `res\Build.bat`
- 支持手动选择 `Update.bat` 和 `Build.bat` 的位置
- 支持按需安装、打开和独立更新 ConfigLinker
- 支持从工具模块区域打开迁移核验助手
- 支持选择已有 KindleLarkStatus EXE、打开和启动时联动
- 支持启动时联动打开 KindleLarkStatus，并避免重复启动
- 支持每天定时执行
- Metro 风格紧凑界面，执行设置与工具模块分栏显示
- 支持 Per-Monitor DPI，125%/150% 缩放下保持字体清晰
- 支持 Windows 单实例运行，重复启动时提示并唤醒已有窗口
- 常驻实例通过本机 Named Pipe 接收其他 SVNmate 模块的指定目录更新请求
- 支持 Windows 系统托盘，双击图标切换窗口显示/隐藏
- 托盘右键菜单可直接打开 ConfigLinker 或 KindleLarkStatus
- 实时输出执行日志，并固定显示成功、失败和跳过数量
- 右上角音乐图标开关，默认播放同目录 `.mp3` / `.wav` 音乐，任务完成后淡出暂停
- 右上角托盘图标用于直接隐藏窗口，辅助操作收纳在“更多”菜单
- 右下角签名左侧有更新圆点，检测到新版本后变红，点击即可更新
- 19:00 后自动切换暗黑主题，白天恢复浅色主题

## 使用

下载或解压分享包后，双击：

```text
SVNAutoTool.exe
```

首次启动会自动生成本机配置文件。配置、日志不会上传到仓库。

点击窗口关闭按钮或“隐藏到托盘”后，程序会继续在系统托盘运行，以保证定时任务有效。双击托盘图标可切换主窗口显示/隐藏；右键托盘图标可打开窗口、立即执行、直接打开任一工具模块或彻底退出。软件已经运行时再次双击 EXE，会先提示当前状态，再恢复并激活已有窗口。

## 模块调用 SVN 更新

迁移核验助手等本机模块通过 `migration_guard.update_working_copies`
请求更新指定工作副本：

```python
from migration_guard import update_working_copies

result = update_working_copies(
    [r"C:\trunk\res", r"D:\Oversea\OStrunk\res"]
)
```

- SVNmate 正在运行：请求通过 `\\.\pipe\SVNmate.Command.v1` 交给常驻实例。
- SVNmate 未运行：调用方直接使用 `svnmate_core`。
- SVNmate 正在运行但 IPC 不可用：返回 `ipc-unavailable`，不会并发启动 core。
- 两条执行路径都返回每个目录的 Update、Cleanup 和重试结果。

外部请求只执行指定目录的 SVN 更新和失败恢复，不会运行 SVNmate 中配置的
`Update.bat`、`Build.bat` 或每日任务。

## v1.4.5 更新摘要

- 音乐与隐藏到托盘改为图标按钮，提供 Tooltip 和键盘快捷键。
- 运行状态移到产品名称右侧，减少右上角命令区的视觉拥挤。
- 保存、日志、指南、更新与退出收纳到顶部“更多”菜单。
- 工具模块行改为动态主动作与更多菜单，状态和按钮位置保持稳定。
- “执行与自动化”将定时设置并入标题行并移除重复说明，为实时输出释放高度。
- 实时输出新增成功、失败、跳过摘要，部分失败不再显示绿色完成状态。
- 主题 token 与 ttk 样式提取到独立模块，DPI 切换同步更新最小窗口尺寸。
- 在线升级兼容平铺和带外层目录的 ZIP，并在替换前校验主程序文件。

## v1.4.4 更新摘要

- 正式提供 Named Pipe 外部更新接口和共享 `svnmate_core`。
- 新增并发布迁移核验助手，支持通过独立通道安装和更新。
- 迁移核验助手按单据提交记录发现文件，仅更新落后的相关目录。
- 增加迁移阶段进度条、逐文件绿色完成状态和 checkout 后完整复核。

## v1.4.3 更新摘要

- Explorer 重启后自动重新注册 SVNmate 托盘图标。
- 隐藏主窗口前验证托盘图标状态；恢复失败时保持窗口可见，避免失去操作入口。
- 降低空闲状态下日志、托盘、定时任务和 DPI 检查频率，减少后台唤醒。
- 保留单实例唤醒、每日定时更新及现有 SVN 执行流程。

## v1.4.2 更新摘要

- 增加单实例保护，阻止重复后台进程和重复托盘图标。
- 托盘双击支持显示/隐藏切换，右键可直接启动两个工具模块。
- 实时日志队列和界面行数采用固定上限，超长内容只在界面截断，磁盘日志保持完整。
- 命令行 SVN 输出改为逐行写入日志，只在内存中保留有限的错误尾部。

## v1.4.1 更新摘要

- 新增工作目录右键菜单，可直接在资源管理器中打开所选文件夹。
- SVN Update 失败后立即执行一次 Cleanup；清理成功后自动重试一次 Update。
- 新增“工具模块”卡片，统一管理配置关系检索器和 Kindle 提示板。
- ConfigLinker 与 KindleLarkStatus 均可按需下载安装，也可选择已有 EXE。
- 支持选择已有 EXE、查看本地版本、打开和检查模块。
- 两个模块使用各自的固定 Release 通道，版本不与 SVNmate 主版本绑定。
- 模块下载执行 HTTPS、manifest 字段校验、SHA-256 校验和 ZIP 路径穿越防护。
- 更新仅替换模块 EXE 和公开 `VERSION`，保留用户配置、日志、Token 和 SSH 私钥。
- ConfigLinker 升级到 `1.2.1`：使用独立关系网络图标，目标物坐标和旋转在选中详情中同一行显示。
- ConfigLinker 修复高 DPI 字体、扩大三栏窗口，并支持查询高亮、双击复制和长路径选择复制。
- ConfigLinker 改为选择 `doc` 根目录，并自动读取 `doc\csvdir` 下三张配置表。

## 工具模块

SVNmate 的“工具模块”卡片包含：

- **配置关系检索器**：目标物、NPC、模型资源双向检索，正式服武器查询与在线图标，并可联网查看命名角色档案。
- **迁移核验助手**：无工程时读取 Jira 状态和三套远端 SVN 提交，按资产树展示
  国内 trunk、海外 trunk、OSOB 进度；有工作区时进一步核验本地修改。
- **Kindle 提示板**：Windows 桌面客户端，可保留“启动时联动”。

支持在线发布的模块缺失时主按钮显示“安装”，已安装时显示“打开”，发现新版后
显示“更新”。检查更新、选择已有 EXE、打开安装位置和复制路径位于每行的
“更多”菜单。迁移核验助手使用独立的 `migration-guard-latest` 更新通道。

MigrationGuard `1.0.2` 在无本地工作区模式下支持 5 分钟远端结果缓存、按 Jira
创建时间收敛查询范围、可取消旧查询，以及 2/5 分钟自动刷新。无本地工作区时点击
“更新”会强制刷新 Jira 与远端 SVN，不执行本地 SVN Update。

KindleLarkStatus 源码仓保持私有，Windows ZIP 与 manifest 发布在 SVNmate 仓库的独立 `kindle-windows-latest` 通道。发布与验收记录见 [Kindle 公共更新通道交接](KINDLE_PUBLIC_CHANNEL_HANDOFF.md)。

ConfigLinker 的完整操作说明见：[ConfigLinker 使用指南](config_id_lookup/USER_GUIDE.md)。

ConfigLinker `1.4.0` 支持按 NPC 名称片段查找对应 ID，并在命名角色的选中详情和档案页展示头像、立绘及资源 ID；角色档案、NPC 归属和视觉资源映射使用 `lark-cli` 从飞书 Base 只读同步并缓存在本机，任务、台词和剧情直接读取当前 `doc\csvdir`。通用角色和待确认角色不会展示。

ConfigLinker `1.5.2` 新增“武器查询”页签，可按武器名称、装备 ID、转换组 ID 或模型 ID 查询，并展示可复制简介、所属职业、同类武器、同职业转换系列、同模型装备和模型名称。武器索引只读取正式服 `csvdir`；“角色查询 / 武器查询”固定在版本号左侧，两类查询框统一放在返回图标右侧。

ConfigLinker `1.5.3` 接入飞书 Base 在线武器图标库。图标索引每天最多自动刷新一次，武器 PNG 在首次查看时按需下载到本机缓存，后续查看和临时断网时直接复用本地图片。

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
