# 配置关系检索器

当前版本：`1.4.0`

一个只读的 Windows 桌面工具，用于检索以下三张配置表之间的关系：

```text
m目标物表.csv -> NPC表.csv -> m模型资源表.csv
```

面向小组同事的操作说明见：[ConfigLinker 使用指南](USER_GUIDE.md)。

## 功能

- 按目标物 ID、NPC ID 或模型资源 ID 精确查询
- 按 NPC 名称进行不区分大小写的子串搜索，直接列出匹配 ID
- 显示目标物类型、描述和 NPC ID
- 在选中详情中同一行显示目标物坐标和旋转
- 显示 NPC 备注、名称和资源 ID
- 显示模型配置路径，支持横向滚动、选择和复制
- 反查同一 NPC 下的其他目标物
- 反查使用同一资源的其他 NPC
- 只为飞书 Base 中的有效命名角色提供角色档案
- 在选中详情中显示对应 NPC 的头像，角色档案使用立绘作为顶部背景
- 鼠标悬停头像或立绘时显示对应的视觉资源 ID
- 展示角色标签、设定摘要、性格分析和故事经历
- 从本地配置按角色查看具体任务、台词和剧情，支持正文筛选
- 飞书仅同步命名角色档案与 NPC 归属，断网时继续使用档案缓存
- 单击任意关系 ID 切换查询中心，双击复制完整 ID
- 支持连续多级“返回上一步”
- 启动时加载数据，并支持手动重新加载
- 刷新失败时保留上一份可用数据
- 高 DPI 和跨显示器缩放
- 独立检查和安装 ConfigLinker 更新
- 使用独立的关系节点网络图标
- Metro 风格浅色/暗色界面

## 数据目录

默认选择配置仓的 `doc` 根目录：

```text
C:\trunk\doc
```

工具自动读取 `doc\csvdir` 下的以下文件：

```text
m目标物表.csv
NPC表.csv
m模型资源表.csv
```

角色详情还会读取同目录下的：

```text
对话表.csv
对话表_开始节点.csv
任务表.csv
```

可以在工具中点击“选择 doc 目录”切换位置。误选 `csvdir` 时会自动使用其父目录。选择结果保存到工具同目录的：

```text
config_linker_config.json
```

该运行时配置不会提交到仓库。

工具不读取 `csvspecial`，不读取或保存 `.xlsm`，也不会运行 VBA、导表器或配置检查脚本。

## 命名角色资料

角色档案来自飞书 Base 的“命名角色”数据，不展示通用角色或待确认角色。
NPC ID 和模型资源 ID 只用于工具内部定位，角色档案窗口不显示这些技术标识。

联网刷新依赖已安装并配置的 `lark-cli`：

```text
npm install -g @larksuite/cli
```

首次手动点击“同步角色档案”时，如果用户授权无效，ConfigLinker 会询问是否打开飞书授权页面。只申请 Base 记录和视图读取权限，Token 继续由 `lark-cli` 管理，ConfigLinker 不保存 Token。

角色档案、NPC 归属和视觉资源映射每天最多自动同步一次，缓存位置：

```text
%LOCALAPPDATA%\SVNmate\ConfigLinker\character_catalog.sqlite3
```

头像和立绘在首次查看对应 NPC 时按需下载，并缓存在同目录的 `character_art` 文件夹。任务、台词和剧情不从飞书下载。点击“重新加载”时，工具直接扫描当前 `doc\csvdir` 中的三张本地配置表并建立内存索引。飞书或网络暂时不可用时，工具保留上一份角色档案和图片缓存；本地内容仍按当前工作区读取。公开 GitHub Release 不包含角色资料。

## 安装与更新

推荐从 SVNmate 的“工具模块”卡片按需安装和打开 ConfigLinker。也可以从固定发布通道独立下载：

```text
https://github.com/SusamMinami/SVNmate/releases/tag/config-linker-latest
```

发布通道包含：

```text
ConfigLinker.zip
manifest.json
```

ConfigLinker 启动后会后台检查自身版本。标题区出现红点时，点击并确认即可下载、校验 SHA-256、重启并替换程序。SVNmate 中也可以检查和更新同一模块。

更新只替换 `ConfigLinker.exe` 和公开 `VERSION` 文件，不覆盖 `config_linker_config.json`。ConfigLinker 的版本与 SVNmate 主程序版本相互独立。

## 使用

开发模式：

```text
run_config_linker.bat
```

或者：

```text
python -B config_linker_app.py
```

## 测试

```text
python -B -m unittest discover -s tests -v
```

## 构建 EXE

双击：

```text
build_exe.bat
```

自动化构建命令：

```text
python -m PyInstaller --noconfirm ConfigLinker.spec
```

重新生成图标需要 Pillow：

```text
python generate_icon.py
```

ConfigLinker 的头像与立绘显示同样依赖 Pillow；开发运行或构建前请确保已安装：

```text
python -m pip install -r requirements.txt
```

构建产物：

```text
dist\ConfigLinker.exe
```

EXE 不包含配置 CSV、飞书 Token 或角色资料。运行时从所选数据目录读取最新导出结果；只有角色档案与 NPC 归属同步需要本机可用的 `lark-cli`。

## 字段关系

工具按成员名和中文表头识别字段，不直接依赖 Excel 列号：

```text
MissionPosition.NPCID -> NPC.id
NPC.resource_id -> Model.id
```

这样可以避免 Excel 首列“版本”未导出到 CSV 时造成列号偏移。
