# ConfigLinker AI 指南

范围：`config_id_lookup/`。这是 Windows Python/Tkinter 只读配置查询工具，
不使用镜头沙盘的 React/Three.js 栈，也不具备 Excel 注册或 UE 写入职责。

## 按任务阅读

- 数据目录、字段关系、运行与构建：[README.md](README.md)。
- 用户操作：[USER_GUIDE.md](USER_GUIDE.md)。
- UI/交互改动：[PRODUCT.md](PRODUCT.md)、[DESIGN.md](DESIGN.md)。
- 共享安装更新：根目录 [SVNmate 开发指南](../docs/svnmate-development.md)。
- 只有追溯历史决策时才读 [docs/plans/](docs/plans/)；其中步骤已执行，不重放。

## 核心约束

- 本地 `doc/csvdir` 是主数据源；武器只读正式服配置，不读 `csvspecial`。
- 通过成员名和中文表头定位列，不能依赖 Excel 列号；重复 ID 要保留，
  关联缺失不能清空已找到的主记录，数字多义时展示全部命中。
- 不修改 CSV/`.xlsm`，不运行 VBA、导表器或配置检查脚本。
- 刷新原子替换数据库，失败保留上一份成功数据并标明来源；不先更新路径再
  把旧数据伪装成新目录的结果。
- 飞书角色资料与图标只是增强层，离线不能阻断本地查询；只显示有效命名角色，
  不把通用/待确认角色伪装成已确认档案。
- 资料索引每天最多自动刷新一次，附件按需缓存；Token 由 `lark-cli` 管理，
  不写入应用配置或发布包。任务、台词和剧情从本地读取，不从飞书下载。
- 单击跳转与双击复制互斥；保留多级返回历史、长路径完整复制和 DPI 适配。
- 更新只替换 EXE 与公开 `VERSION`，保留用户配置和缓存；与 SVNmate 独立版本。

## 代码地图

以下文件均在 `config_linker/`：

| 职责 | 模块 |
| --- | --- |
| CSV/武器解析、索引 | `repository.py`、`weapon_repository.py` |
| 关系查询 | `query_service.py`、`weapon_query_service.py` |
| 主 UI、武器 UI、角色详情 | `ui.py`、`weapon_ui.py`、`character_detail.py` |
| 本地剧情、飞书档案与图像 | `local_character_content.py`、`character_catalog.py`、`character_visuals.py`、`weapon_icon_catalog.py` |
| 状态、点击行为、DPI、主题 | `view_state.py`、`interactions.py`、`dpi.py`、`theme.py` |
| 设置与升级 | `settings.py`、`update_controller.py` |

## 验证

以下命令在 `config_id_lookup/` 执行：

```powershell
python -m pip install -r requirements.txt
python -B config_linker_app.py
python -B -m unittest discover -s tests -v
```

窄范围可指定 `tests.test_repository` 等测试模块。UI 改动额外验证 Windows
96/120/144 DPI、复制与返回行为。需要打包时执行 `.\build_exe.bat`，产物在
`dist/ConfigLinker.exe`；版本源为 `VERSION`。发布入口见
[publish-config-linker.yml](../.github/workflows/publish-config-linker.yml)。
