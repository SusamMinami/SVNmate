# 工具模块与配置检索器优化设计

- 日期：2026-07-28
- 状态：已确认
- 涉及仓库：
  - `C:\Users\Admin\Downloads\ezxss`
  - `C:\Users\Admin\Downloads\提示板\KindleLarkStatus`

## 1. 目标

本轮优化同时解决以下问题：

- 修复 ConfigLinker 在高 DPI 或跨显示器场景中的字体发虚。
- 调整默认窗口尺寸，确保三张关系卡片完整可用。
- 精简模型资源展示，强化长路径查看和复制。
- 增加 ID、坐标和旋转的快捷复制。
- 把数据目录选择改成面向 `doc` 根目录的引导流程。
- 在 SVNmate 中建立统一的“工具模块”区域。
- 让 ConfigLinker 和 KindleLarkStatus Windows 客户端可以独立于 SVNmate 主程序更新。
- 更新 SVNmate、ConfigLinker 和 KindleLarkStatus 的使用与维护文档。

## 2. DPI 根因调查

### 2.1 已确认事实

ConfigLinker 打包 EXE 的进程 DPI awareness 为 `Per-Monitor`，当前 125% 显示器上的运行数据为：

```text
DPI = 120
Tk scaling ≈ 1.666
```

源码方式启动 SVNmate 时的数据一致，因此问题不是“ConfigLinker 完全没有声明 DPI awareness”。

### 2.2 与 SVNmate 的差异

SVNmate 还有以下已验证机制，而 ConfigLinker 缺失：

- 在导入和创建 Tk 窗口前启用 Per-Monitor V2。
- 创建窗口后按窗口实际 DPI 显式设置 `tk scaling`。
- 根据 DPI 计算初始窗口和最小窗口尺寸。
- 每秒检测窗口 DPI，跨显示器时重新设置 scaling 和样式。

ConfigLinker 当前固定使用 `1180×760`，不会按 DPI 扩大窗口，也不会在跨显示器后同步 scaling。

### 2.3 修复方向

复用 SVNmate 的已验证模式：

1. DPI awareness 初始化移动到 Tk 导入前。
2. 创建窗口后读取 `GetDpiForWindow`。
3. 设置 `tk scaling = dpi / 72`。
4. 初始窗口按 DPI 和屏幕工作区计算。
5. 监听 DPI 变化并重新应用字体和主题。

不通过替换字体、无依据加粗或关闭 DPI awareness 掩盖问题。

## 3. ConfigLinker 窗口与关系卡片

### 3.1 初始窗口

- 初始窗口使用当前屏幕工作区约 85%～90%。
- 窗口居中显示，并设置能容纳三卡片的 DPI 感知最小尺寸。
- 屏幕较小时自动收敛到可用区域，不超出任务栏边界。
- 用户仍可自由调整窗口大小。
- 三张卡片继续使用等宽响应式布局。

### 3.2 查询中心高亮

单击 ID 切换查询中心后：

- 当前类型卡片使用蓝色边框。
- 卡片标题旁显示标签，例如 `查询中心 · NPC 100007`。
- 对应记录行使用强调底色和粗体。
- 结果列表自动滚动到查询记录。
- “返回上一步”后恢复对应历史高亮。

### 3.3 模型资源卡片

删除“自动生成路径”展示，卡片只保留：

```text
资源 ID | 配置路径
```

配置路径列使用足够大的固定宽度，不强制压缩到卡片宽度。资源卡片底部增加横向滚动条，可左右查看完整路径。

选中资源记录后，下方详情区使用只读输入框展示完整配置路径：

- 支持鼠标框选。
- 支持 `Ctrl+C`。
- 不自动修改路径内容。

### 3.4 目标物位置详情

目标物卡片保持默认四列：

```text
目标物 ID | 类型 | 描述 | NPC ID
```

选中目标物后，下方详情区显示默认折叠的“位置详情”。展开后显示：

- `MissionPosition.Position`
- `MissionPosition.Rotation`

两个字段均使用只读输入框，支持选择复制和双击整值复制。

## 4. 单击、双击与复制

### 4.1 ID

所有目标物 ID、NPC ID 和资源 ID：

- 单击：切换查询中心。
- 双击：复制 ID，不切换查询中心。

为区分单双击：

1. 单击后创建约 220ms 的延迟任务。
2. 超时后执行查询跳转。
3. 若期间收到双击事件，取消延迟任务并复制 ID。

### 4.2 坐标和旋转

- 双击坐标输入框：复制完整坐标。
- 双击旋转输入框：复制完整旋转。
- 仍允许手动选择局部文本并 `Ctrl+C`。

### 4.3 反馈

复制成功后不弹出阻断式对话框。窗口右下角显示约 1.5 秒的浮动提示，例如：

```text
已复制 NPC ID 100007
```

连续复制时更新同一提示，不堆叠多个窗口。

## 5. 数据模型和目录选择

### 5.1 目标物字段

`TargetRecord` 增加：

- `position`
- `rotation`

字段优先按成员名识别：

```text
MissionPosition.Position
MissionPosition.Rotation
```

Excel 中的 L/M 列只作为业务说明，不在代码中写死物理列号。

### 5.2 模型字段

`ResourceRecord` 移除未使用的 `generated_path`。只保留：

- 资源 ID
- 配置填写路径
- CSV 行号

### 5.3 doc 根目录

设置由 `data_directory` 迁移为 `doc_directory`。

默认值：

```text
C:\trunk\doc
```

实际读取：

```text
<doc>\csvdir\m目标物表.csv
<doc>\csvdir\NPC表.csv
<doc>\csvdir\m模型资源表.csv
```

点击“选择 doc 目录”时：

1. 先显示简短说明，明确要求选择包含 `csvdir` 的 `doc` 根目录。
2. 再打开目录选择器。
3. 校验 `csvdir` 和三张表。
4. 成功后保存 doc 根目录并重新加载。

若用户误选 `csvdir`，程序自动识别并归一到其父目录。旧配置若直接保存了 `csvdir`，启动时自动迁移，不要求重新设置。

## 6. SVNmate 工具模块

### 6.1 布局调整

SVNmate 原设置区域调整为两张卡片：

#### 执行与自动化

- Update.bat
- Build.bat
- 每日定时
- 现有 SVN 执行选项

#### 工具模块

- 配置关系检索器
- Kindle 提示板

每个模块行提供：

- 模块名称
- 安装路径
- 当前版本
- 安装/打开按钮
- 检查/更新按钮
- 状态提示

Kindle 行继续保留：

- 启动 SVNmate 时联动打开
- 选择现有程序
- 立即打开

### 6.2 按需安装

SVNmate 主安装包不预装模块。

- ConfigLinker 默认安装到 `APP_DIR\modules\ConfigLinker`。
- KindleLarkStatus 默认安装到 `APP_DIR\modules\KindleLarkStatus`。
- 已有外部 EXE 可以选择并由 SVNmate 接管启动和更新。
- 模块缺失时按钮显示“安装”。

模块进程独立运行。模块崩溃不影响 SVNmate 主进程。

## 7. 独立更新协议

### 7.1 清单格式

每个模块发布一个 JSON 清单，至少包含：

```json
{
  "id": "config-linker",
  "version": "1.1.0",
  "download_url": "https://...",
  "sha256": "...",
  "entrypoint": "ConfigLinker.exe"
}
```

字段要求：

- 模块 ID 必须与客户端预期一致。
- 版本必须可解析。
- 下载地址必须为 HTTPS。
- SHA-256 必须是 64 位十六进制。
- 入口文件不得包含目录穿越。

### 7.2 检查策略

- SVNmate 启动时后台检查两个模块。
- ConfigLinker 启动时后台检查自身。
- 网络失败不弹阻断窗口，只显示“检查失败”，允许手动重试。
- 发现新版本后必须由用户确认，不静默替换。

### 7.3 安装和替换

1. 下载到模块专属临时目录。
2. 校验 SHA-256。
3. 解压到 staging 目录。
4. 校验入口文件存在。
5. 备份当前 EXE。
6. 模块退出后原子替换。
7. 按更新前状态重新启动模块。
8. 替换失败时恢复备份。

配置、日志、缓存和其他模块不在替换白名单中。

### 7.4 运行中模块

- ConfigLinker 自更新时，确认后退出自身，由 PowerShell 等待进程结束后替换并重启。
- SVNmate 更新 ConfigLinker 时，若模块运行，提示用户确认关闭、替换并重启。
- SVNmate 更新 KindleLarkStatus 时，明确提示会短暂中断 Kindle 刷新服务；确认后关闭、替换并重启。

### 7.5 两种 Kindle 更新

文案必须区分：

- `更新 Windows 模块`：替换 `KindleLarkStatus.exe`。
- `更新 Kindle 端`：由 KindleLarkStatus 自身通过 SSH 更新 KUAL 和 Kindle Shell 文件。

两者不得共用模糊的“更新”按钮名称。

## 8. 发布通道

### 8.1 ConfigLinker

在 SVNmate 仓库新增独立 Windows 模块发布工作流：

- 版本：`1.1.0`
- 固定发布通道：`config-linker-latest`
- 资产：
  - `ConfigLinker.zip`
  - `manifest.json`

固定通道更新不改变 SVNmate 主程序的 `latest release`。

### 8.2 KindleLarkStatus

扩展其现有 `build-desktop.yml` 或新增 Windows 模块发布工作流：

- 当前版本来源：`VERSION`
- 固定发布通道：`windows-module-latest`
- 资产：
  - `KindleLarkStatus.zip`
  - `manifest.json`

本轮允许同时修改并分别提交两个仓库。

### 8.3 SVNmate

模块管理器属于 SVNmate 主功能更新：

- 目标版本：`v1.4.0`
- 主程序仍通过原有 `SVNmate.zip` 更新。
- 模块后续更新不再要求发布新的 SVNmate 主版本。

## 9. 错误处理

### 9.1 配置数据

- doc 目录错误：显示预期的 `doc\csvdir` 路径和缺失文件。
- 刷新失败：保留上一份成功加载的数据。
- 旧设置迁移失败：保留旧文件并回退默认 doc 路径。

### 9.2 模块更新

- 清单无法访问：显示“检查失败”，不影响模块启动。
- 清单字段无效：拒绝下载。
- 哈希不一致：删除临时文件并报告安全错误。
- 下载中断：保留现有模块。
- 模块无法退出：停止替换并允许稍后重试。
- 替换失败：恢复备份。

## 10. 文档范围

### SVNmate 仓库

- `README_svn_auto_tool.md`
  - 工具模块安装和启动
  - 自动检查和手动更新
  - ConfigLinker 使用说明
  - Kindle Windows 模块更新与 Kindle 端更新区别
- `README.md`
  - 功能概览和 `v1.4.0` 摘要
- `RELEASE_NOTES.md`
  - 模块管理器和 ConfigLinker 优化
- `config_id_lookup/README.md`
  - doc 目录
  - 路径复制
  - ID 高亮和双击复制
  - 坐标/旋转详情
  - 自更新

### KindleLarkStatus 仓库

- `README.zh-CN.md`
- `README.md`
- `MAINTENANCE.md`

只记录公开发布协议，不写入本地配置、Token、密钥或私有路径内容。

## 11. 验证范围

### ConfigLinker

- 96/120/144 DPI 的窗口尺寸计算。
- 本机 125% 实际启动。
- DPI 变化后 scaling 和主题重新应用。
- 默认窗口能完整容纳三张卡片。
- 模型卡片无自动生成路径。
- 配置路径横向滚动。
- 路径输入框可选择复制。
- 单击跳转与双击复制互斥。
- 复制浮动提示自动消失。
- 目标物坐标和旋转解析、展开和复制。
- 当前查询 ID 高亮和历史恢复。
- doc 根目录、误选 csvdir、旧设置迁移和缺表错误。

### 模块管理器

- 清单解析和字段校验。
- 版本比较。
- SHA-256 校验。
- 按需安装。
- 运行中模块确认。
- 原子替换和回滚。
- 网络失败不影响主功能。
- ConfigLinker 自更新与 SVNmate 更新使用同一清单。

### 发布

- SVNmate 测试和 Windows 构建。
- ConfigLinker 测试和 Windows 构建。
- KindleLarkStatus 测试和 Windows 构建。
- 使用本地模拟清单完成端到端安装和更新。
- 发布固定模块通道后核对远端清单、哈希和下载资产。

## 12. 非目标

- 不把 ConfigLinker 或 KindleLarkStatus 代码加载进 SVNmate 进程。
- 不把两个模块预装进 SVNmate 主压缩包。
- 不修改游戏配置表。
- 不让更新器覆盖用户配置、日志、Token 或 SSH 私钥。
- 不把 Kindle 端脚本更新与 Windows 模块更新合并成一个动作。
