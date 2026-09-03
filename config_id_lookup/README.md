# 配置关系检索器

当前版本：`1.5.3`

一个只读的 Windows 桌面工具，包含角色查询和武器查询两个功能页。

```text
m目标物表.csv -> NPC表.csv -> m模型资源表.csv
```

面向小组同事的操作说明见：[ConfigLinker 使用指南](USER_GUIDE.md)。

## 功能

- 按目标物 ID、NPC ID 或模型资源 ID 精确查询
- 按 NPC 名称进行不区分大小写的子串搜索，直接列出匹配 ID
- 按武器名称、装备 ID、转换组 ID 或模型 ID 查询武器
- 武器查询只读取正式服 `csvdir`
- 显示武器简介、所属职业、转换组、装备部位、等级与模型名称
- 在武器详情中显示飞书 Base 在线图标，首次查看时按需下载
- 反查同类武器、同职业转换系列和同模型装备
- 角色与武器查询框复用顶部工具栏，功能按钮固定在版本号左侧
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

武器查询页签读取正式服配置：

```text
doc\csvdir\z装备表.csv
doc\csvdir\w武器转换表.csv
doc\csvdir\w武器外观表.csv
doc\csvdir\z职业配置表.csv
```

可以在右上角“设置”菜单中点击“选择 doc 目录”切换位置。误选 `csvdir` 时会自动使用其父目录。选择结果保存到工具同目录的：

```text
config_linker_config.json
```

该运行时配置不会提交到仓库。

工具只读上述 CSV，不读取或保存 `.xlsm`，也不会运行 VBA、导表器或配置检查脚本。

## 武器查询

点击版本号左侧的“武器查询”，输入武器名称、装备 ID、转换组 ID 或模型 ID。名称支持不区分大小写的子串搜索；数字会同时检查三类 ID，存在多义时合并展示所有命中，不静默猜测。顶部状态会切换为正式服武器数和转换组数。

选中武器后会显示：

- 装备 ID、名称、备注、装备与穿戴等级
- `ItemAttr.txtdes` 中配置的武器简介
- 职业、装备部位、转换组
- 武器模型 ID、模型备注和模型名称
- `ItemAttr.icon` 对应的武器图标和图标 ID
- 同类武器，即同一转换组中的其他职业武器
- 同职业的其他转换组武器
- 使用相同模型的其他装备

不属于转换组或未配置模型的武器仍可查询，并在详情中显示具体原因。
名称、转换组或模型查询可能命中多把武器，因此左上保留紧凑的命中列表；武器简介位于左下只读文本区，可选择并复制。右侧三个关联分类使用固定尺寸按钮，切换时只改变颜色。

在线武器图标索引每天最多自动刷新一次，缓存位置：

```text
%LOCALAPPDATA%\SVNmate\ConfigLinker\weapon_icons.sqlite3
%LOCALAPPDATA%\SVNmate\ConfigLinker\weapon_icons
```

工具只缓存有效且已导出的图标记录。PNG 在首次查看对应武器时按需下载，后续查看和临时断网时直接复用本地图片；图标同步失败不会阻塞正式服 CSV 查询。图标读取使用与角色档案相同的飞书 Base 用户授权，完成“设置 > 同步角色档案”授权后会自动重试武器图标索引。

## 命名角色资料

角色档案来自飞书 Base 的“命名角色”数据，不展示通用角色或待确认角色。
NPC ID 和模型资源 ID 只用于工具内部定位，角色档案窗口不显示这些技术标识。

联网刷新依赖已安装并配置的 `lark-cli`：

```text
npm install -g @larksuite/cli
```

首次从“设置”菜单点击“同步角色档案”时，如果用户授权无效，ConfigLinker 会通过 `lark-cli` 的 Base 授权域打开飞书授权页面。程序本身只执行 Base 读取与附件下载命令；Token 继续由 `lark-cli` 管理，ConfigLinker 不保存 Token。

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

EXE 不包含配置 CSV、飞书 Token、角色资料或武器图标。运行时从所选数据目录读取最新导出结果；角色档案、NPC 归属和武器图标同步需要本机可用的 `lark-cli`。

## 字段关系

工具按成员名和中文表头识别字段，不直接依赖 Excel 列号：

```text
MissionPosition.NPCID -> NPC.id
NPC.resource_id -> Model.id

WeaponConvert.equip[] -> ItemAttr.id
EquipAttr.careerlimit[] -> CareerInfor.id
EquipAttr.weaponmesh -> Weaponappearance.id
ItemAttr.icon -> UIResource.id
```

这样可以避免 Excel 首列“版本”未导出到 CSV 时造成列号偏移。
