# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Impeccable 使用 `web` 作为桌面界面评审配置；实际交付是仅面向 Windows 的
Python/Tkinter 桌面应用。

## Users

主要用户是需要快速追踪游戏配置关系的策划、程序和资源维护人员。他们会在角色、
目标物、NPC、模型资源、武器、职业和在线视觉资料之间频繁往返，希望通过粘贴或
输入一个已知 ID/名称立即得到完整上下游关系。

## Product Purpose

ConfigLinker 是只读配置关系检索器。它加载本地正式服 CSV 并建立内存索引，提供
角色关系、命名角色资料和武器关系三类查询；点击结果可把任意 ID 设为新的查询中心，
并可沿历史逐级返回。成功意味着用户无需手工打开多张表即可确认配置引用、复制路径
或定位缺失关系。

## Positioning

工具不是通用表格浏览器。它理解项目内已确认的成员名、双表头、反向索引和职业/
武器转换关系，并把飞书中的命名角色资料与武器图标作为按需增强层；网络失败不会
阻塞本地配置查询。

## Operating Context

- 数据通常来自所选 `<doc>\csvdir`，启动和手动刷新时原子重建索引。
- 用户会在角色查询与武器查询之间切换，并连续追踪多级引用。
- 长模型路径、坐标、旋转、ID 和简介需要快速复制。
- 命名角色资料和武器图标来自飞书 Base，按需同步并缓存到本机。
- 高 DPI、多显示器、浅色/暗色主题是日常使用条件。

## Capabilities and Constraints

- Python、Tkinter/ttk、PyInstaller；发布为 `ConfigLinker.exe`。
- 本地 CSV 只读，不修改 `.xlsm`，不运行 VBA、导表器或配置检查脚本。
- 支持目标物/NPC/模型 ID、NPC 名称片段、武器名称及三类武器 ID 查询。
- 重复 ID 必须保留，关联缺失时继续展示已找到的主记录。
- 刷新失败时保留上一份成功数据，并清楚标记当前使用旧数据。
- 在线角色资料与图标是增强功能，不得成为本地查询的前置条件。
- 单击 ID 切换查询中心，双击复制；两种行为必须互斥。

## Brand Commitments

- 产品名为“配置关系检索器”，可执行文件名为 `ConfigLinker.exe`。
- 既有风格是紧凑的 Metro/Fluent 桌面工具，使用 Segoe UI、蓝色强调和浅色/暗色
  双主题。
- 业务名称应优先使用用户熟悉的中文字段；成员名、路径和 ID 作为辅助技术信息。

## Evidence on Hand

- 当前产品说明：`README.md`、`USER_GUIDE.md`
- 初版角色关系设计：`docs/plans/2026-07-28-config-id-lookup-design.md`
- DPI、复制与模块更新设计：`docs/plans/2026-07-28-tool-modules-optimization-design.md`
- 当前主题：`config_linker/theme.py`
- 当前界面：`config_linker/ui.py`、`config_linker/weapon_ui.py`、
  `config_linker/character_detail.py`
- UI 烟雾测试：`tests/test_ui_smoke.py`
- 未提供正式用户研究或业务指标；后续设计不得虚构。

## Product Principles

1. 从一个已知线索快速展开完整关系。
2. 默认展示最有用字段，诊断细节按需展开。
3. 查询历史、复制与批量结果浏览服务于专家效率。
4. 本地数据是主能力，联网资料只能增强不能阻断。
5. 数据异常应局部呈现并保留已找到的上下文。

## Accessibility & Inclusion

主要查询和历史导航必须支持键盘。图标按钮需要 tooltip，焦点和选中态不能只依赖
颜色。文字与关系卡片应在 96/120/144 DPI 下保持清晰，长路径必须可横向查看、
框选和复制。
