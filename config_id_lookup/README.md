# 配置关系检索器

当前版本：`1.1.0`

一个只读的 Windows 桌面工具，用于检索以下三张配置表之间的关系：

```text
m目标物表.csv -> NPC表.csv -> m模型资源表.csv
```

## 功能

- 按目标物 ID、NPC ID 或模型资源 ID 精确查询
- 显示目标物类型、描述和 NPC ID
- 在详情区展开目标物坐标和旋转
- 显示 NPC 备注、名称和资源 ID
- 显示模型配置路径，支持横向滚动、选择和复制
- 反查同一 NPC 下的其他目标物
- 反查使用同一资源的其他 NPC
- 单击任意关系 ID 切换查询中心，双击复制完整 ID
- 支持连续多级“返回上一步”
- 启动时加载数据，并支持手动重新加载
- 刷新失败时保留上一份可用数据
- 高 DPI 和跨显示器缩放
- 独立检查和安装 ConfigLinker 更新
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

可以在工具中点击“选择 doc 目录”切换位置。误选 `csvdir` 时会自动使用其父目录。选择结果保存到工具同目录的：

```text
config_linker_config.json
```

该运行时配置不会提交到仓库。

工具不读取 `csvspecial`，不读取或保存 `.xlsm`，也不会运行 VBA、导表器或配置检查脚本。

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

构建产物：

```text
dist\ConfigLinker.exe
```

EXE 不包含配置 CSV。运行时仍从所选数据目录读取最新导出结果。

## 字段关系

工具按成员名和中文表头识别字段，不直接依赖 Excel 列号：

```text
MissionPosition.NPCID -> NPC.id
NPC.resource_id -> Model.id
```

这样可以避免 Excel 首列“版本”未导出到 CSV 时造成列号偏移。
