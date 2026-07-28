# 配置关系检索器实施计划

> **For Coco:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**Goal:** 构建一个只读的 Windows 桌面 EXE，可从目标物 ID、NPC ID 或模型资源 ID 出发，展示三表正反向关系并支持逐级返回。

**Architecture:** 使用 Python 标准库实现分层结构：CSV 仓库负责双表头解析和索引，查询服务负责关系展开，视图状态负责历史与分页，Tkinter/ttk 负责 Metro 风格界面。每次刷新先创建新的仓库实例，成功后再替换当前数据，确保失败刷新不会破坏上一份可用结果。

**Tech Stack:** Python 3.11、`csv`、`dataclasses`、`unittest`、Tkinter/ttk、PyInstaller 6.21。

---

## 实施约束

- 工作目录：`C:\Users\Admin\Downloads\ezxss\config_id_lookup`
- 默认数据目录：`C:\trunk\doc\csvdir`
- 只读 `m目标物表.csv`、`NPC表.csv`、`m模型资源表.csv`
- 不修改 `.xlsm` 或 CSV
- 不运行 VBA、导表器、`.bat` 配置脚本或 JAR
- 不引入 pandas、第三方 UI 框架或数据库
- 当前目标目录属于独立的 ezxss Git 项目；用户已明确授权提交
- 提交只包含 `config_id_lookup` 和为跟踪 spec 所需的根 `.gitignore` 例外
- 每个任务完成后运行对应测试；最终再运行全量测试和主仓 `svn status`、`svn diff`

## 目标文件结构

```text
config_id_lookup/
  config_linker/
    __init__.py
    models.py
    repository.py
    query_service.py
    view_state.py
    settings.py
    theme.py
    ui.py
  tests/
    __init__.py
    fixture_factory.py
    test_repository.py
    test_query_service.py
    test_view_state.py
    test_settings.py
    test_ui_smoke.py
  docs/plans/
    2026-07-28-config-id-lookup-design.md
    2026-07-28-config-id-lookup-implementation.md
  config_linker_app.py
  config_linker_config.json.example
  ConfigLinker.spec
  build_exe.bat
  run_config_linker.bat
  README.md
```

### Task 1: 建立数据模型和测试夹具

**Files:**
- Create: `config_linker/__init__.py`
- Create: `config_linker/models.py`
- Create: `tests/__init__.py`
- Create: `tests/fixture_factory.py`

**Step 1: 定义不可变记录模型**

在 `config_linker/models.py` 中定义：

```python
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path


class QueryKind(str, Enum):
    TARGET = "target"
    NPC = "npc"
    RESOURCE = "resource"


@dataclass(frozen=True)
class QueryKey:
    kind: QueryKind
    value: int


@dataclass(frozen=True)
class TargetRecord:
    id: int
    target_type: str
    description: str
    npc_id: int | None
    row_number: int


@dataclass(frozen=True)
class NpcRecord:
    id: int
    note: str
    name: str
    resource_id: int | None
    row_number: int


@dataclass(frozen=True)
class ResourceRecord:
    id: int
    configured_path: str
    generated_path: str
    row_number: int


@dataclass(frozen=True)
class LoadReport:
    directory: Path
    loaded_at: datetime
    target_count: int
    npc_count: int
    resource_count: int
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class QueryResult:
    key: QueryKey
    targets: tuple[TargetRecord, ...]
    npcs: tuple[NpcRecord, ...]
    resources: tuple[ResourceRecord, ...]
    warnings: tuple[str, ...] = ()
```

**Step 2: 建立最小双表头 CSV 夹具生成器**

`tests/fixture_factory.py` 使用 `csv.writer` 和 `encoding="utf-8-sig"` 创建三张测试表。测试数据至少包含：

```text
目标物 1001 -> NPC 2001
目标物 1002 -> NPC 2001
目标物 1003 -> NPC 2002
NPC 2001 -> 资源 3001
NPC 2002 -> 资源 3001
资源 3001 -> 含逗号和换行的模型路径
```

成员行必须模拟真实表：

```python
TARGET_MEMBER_ROW = [
    "##&MissionPosition.ID",
    "",
    "",
    "MissionPosition.type",
    "MissionPosition.NPCID",
]
TARGET_LABEL_ROW = ["##ID", "类型", "描述", "坐标类型", "NPCID"]

NPC_MEMBER_ROW = ["##&NPC.id", "", "NPC.name", "NPC.resource_id"]
NPC_LABEL_ROW = ["##id", "备注", "NPC名字", "资源id"]

RESOURCE_MEMBER_ROW = ["##&Model.id", "", "Model.path"]
RESOURCE_LABEL_ROW = [
    "##id",
    "配置填写在此列，Model.path保存时自动生成，由程序调用",
    "ID段规划",
]
```

**Step 3: 验证夹具可由标准 CSV 解析器回读**

Run:

```text
python -m unittest discover -s tests -v
```

Expected: `Ran 0 tests`，且夹具模块可导入，无语法错误。

### Task 2: 实现双表头 CSV 仓库

**Files:**
- Create: `config_linker/repository.py`
- Create: `tests/test_repository.py`

**Step 1: 写字段映射失败测试**

测试仓库能按成员名和中文表头找到字段，而不是依赖 Excel 列号：

```python
class RepositoryTests(unittest.TestCase):
    def test_loads_realistic_double_headers_and_builds_indexes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            write_fixture(Path(temp_dir))
            repository = CsvRepository.load(Path(temp_dir))

            self.assertEqual(repository.targets_by_id[1001][0].description, "目标A")
            self.assertEqual(len(repository.targets_by_npc_id[2001]), 2)
            self.assertEqual(repository.npcs_by_id[2001][0].name, "测试NPC甲")
            self.assertEqual(len(repository.npcs_by_resource_id[3001]), 2)
            self.assertIn("\n", repository.resources_by_id[3001][0].configured_path)
```

**Step 2: 运行并确认测试失败**

Run:

```text
python -m unittest tests.test_repository.RepositoryTests.test_loads_realistic_double_headers_and_builds_indexes -v
```

Expected: FAIL，`config_linker.repository` 尚不存在。

**Step 3: 实现结构化 CSV 读取**

在 `config_linker/repository.py` 中：

- 固定三个文件名常量。
- 使用 `open(path, "r", encoding="utf-8-sig", newline="")`。
- 使用 `csv.reader`，不手工按逗号切分。
- 第 1 行保存成员名，第 2 行保存中文表头。
- 数据行从 CSV 第 3 行开始，记录真实行号。
- 必需字段缺失时抛出包含文件名和字段名的 `SchemaError`。

字段定位接口：

```python
def _find_column(
    members: list[str],
    labels: list[str],
    *,
    member: str | None = None,
    label: str | None = None,
    label_prefix: str | None = None,
) -> int:
    ...
```

识别规则：

- 目标物 ID：`MissionPosition.ID`
- 目标物类型：中文表头 `类型`
- 目标物描述：中文表头 `描述`
- 目标物 NPC：`MissionPosition.NPCID`
- NPC ID：`NPC.id`
- NPC 备注：中文表头 `备注`
- NPC 名称：`NPC.name`
- NPC 资源：`NPC.resource_id`
- 资源 ID：`Model.id`
- 配置路径：中文表头前缀 `配置填写在此列`
- 自动生成路径：`Model.path`

兼容成员名前的 `##&` 前缀：

```python
def _normalize_member(value: str) -> str:
    return value.removeprefix("##&").strip()
```

**Step 4: 处理空值和特殊引用值**

- 空字符串解析为 `None`。
- `0` 和 `-1` 保留原数值，不改写为空。
- 查询服务决定是否继续关联。
- 非整数主键抛出带文件名、行号的 `DataValueError`。

**Step 5: 构建列表型索引**

所有索引值均为列表，禁止覆盖重复 ID：

```python
targets_by_id: dict[int, list[TargetRecord]]
targets_by_npc_id: dict[int, list[TargetRecord]]
npcs_by_id: dict[int, list[NpcRecord]]
npcs_by_resource_id: dict[int, list[NpcRecord]]
resources_by_id: dict[int, list[ResourceRecord]]
```

**Step 6: 增加缺表、缺字段和重复 ID 测试**

覆盖：

- 缺少 `NPC表.csv`
- 缺少 `MissionPosition.NPCID`
- 同一 ID 两行均保留
- UTF-8 BOM 中文回读
- 路径字段含逗号、引号、换行

**Step 7: 运行仓库测试**

Run:

```text
python -m unittest tests.test_repository -v
```

Expected: PASS。

### Task 3: 实现三种关系查询

**Files:**
- Create: `config_linker/query_service.py`
- Create: `tests/test_query_service.py`

**Step 1: 写目标物查询失败测试**

```python
def test_target_query_includes_same_npc_targets_and_resource(self) -> None:
    result = self.service.search(QueryKey(QueryKind.TARGET, 1001))

    self.assertEqual({row.id for row in result.targets}, {1001, 1002})
    self.assertEqual({row.id for row in result.npcs}, {2001})
    self.assertEqual({row.id for row in result.resources}, {3001})
```

**Step 2: 运行并确认测试失败**

Run:

```text
python -m unittest tests.test_query_service.QueryServiceTests.test_target_query_includes_same_npc_targets_and_resource -v
```

Expected: FAIL，查询服务尚不存在。

**Step 3: 实现目标物查询**

规则：

1. 精确读取 `targets_by_id[query_id]`。
2. 收集有效 NPC ID。
3. 读取 NPC 记录。
4. 收集资源 ID 并读取资源记录。
5. 合并同 NPC 的其他目标物。
6. 按 `(id, row_number)` 去重并保持 CSV 行序。

**Step 4: 写并实现 NPC 查询**

断言：

```python
result = self.service.search(QueryKey(QueryKind.NPC, 2001))
self.assertEqual({row.id for row in result.targets}, {1001, 1002})
self.assertEqual({row.id for row in result.npcs}, {2001, 2002})
self.assertEqual({row.id for row in result.resources}, {3001})
```

其中 `2002` 是同资源 NPC，UI 默认放在折叠关联区。

**Step 5: 写并实现资源查询**

断言：

```python
result = self.service.search(QueryKey(QueryKind.RESOURCE, 3001))
self.assertEqual({row.id for row in result.npcs}, {2001, 2002})
self.assertEqual({row.id for row in result.targets}, {1001, 1002, 1003})
```

**Step 6: 实现断链告警**

- 输入 ID 不存在：抛出 `NotFoundError`。
- NPC ID 为空：提示“未填写 NPC ID”。
- NPC ID 为 `0`：提示“NPC ID 为 0，按未配置处理”。
- NPC ID 为 `-1`：提示“NPC ID 为 -1，按特殊值处理”。
- 正数外键找不到记录：保留上游记录并写入 `QueryResult.warnings`。

资源 ID 使用同样规则。

**Step 7: 增加断链和重复记录测试**

覆盖：

- 目标物存在但 NPC 不存在
- NPC 存在但资源不存在
- 0、空值、-1 不被混为同一种提示
- 重复 ID 记录全部进入结果

**Step 8: 运行查询测试**

Run:

```text
python -m unittest tests.test_query_service -v
```

Expected: PASS。

### Task 4: 实现查询历史和分页状态

**Files:**
- Create: `config_linker/view_state.py`
- Create: `tests/test_view_state.py`

**Step 1: 写多级返回测试**

```python
def test_history_returns_through_every_previous_query(self) -> None:
    history = QueryHistory()
    history.visit(QueryKey(QueryKind.TARGET, 1001))
    history.visit(QueryKey(QueryKind.NPC, 2001))
    history.visit(QueryKey(QueryKind.RESOURCE, 3001))

    self.assertEqual(history.back(), QueryKey(QueryKind.NPC, 2001))
    self.assertEqual(history.back(), QueryKey(QueryKind.TARGET, 1001))
    self.assertFalse(history.can_go_back)
```

**Step 2: 运行并确认测试失败**

Run:

```text
python -m unittest tests.test_view_state.ViewStateTests.test_history_returns_through_every_previous_query -v
```

Expected: FAIL。

**Step 3: 实现历史栈**

要求：

- 初次查询不允许返回。
- 新查询将旧 `current` 压栈。
- 访问相同 `QueryKey` 不重复压栈。
- `back()` 返回上一项并更新当前项。
- 手动新搜索、点击关联 ID 使用同一 `visit()`。

**Step 4: 写分页测试**

```python
def test_pagination_starts_at_200_and_loads_more(self) -> None:
    pager = ResultPager(total=450, page_size=200)
    self.assertEqual(pager.visible_count, 200)
    pager.load_more()
    self.assertEqual(pager.visible_count, 400)
    pager.load_more()
    self.assertEqual(pager.visible_count, 450)
```

**Step 5: 实现分页状态并运行测试**

Run:

```text
python -m unittest tests.test_view_state -v
```

Expected: PASS。

### Task 5: 实现数据目录设置

**Files:**
- Create: `config_linker/settings.py`
- Create: `tests/test_settings.py`
- Create: `config_linker_config.json.example`

**Step 1: 写默认路径和保存回读测试**

```python
def test_defaults_to_main_csvdir(self) -> None:
    settings, warning = load_settings(self.path)
    self.assertEqual(settings.data_directory, Path(r"C:\trunk\doc\csvdir"))
    self.assertIsNone(warning)

def test_saved_directory_round_trips(self) -> None:
    save_settings(self.path, AppSettings(Path(r"D:\other\csvdir")))
    settings, _ = load_settings(self.path)
    self.assertEqual(settings.data_directory, Path(r"D:\other\csvdir"))
```

**Step 2: 运行并确认测试失败**

Run:

```text
python -m unittest tests.test_settings -v
```

Expected: FAIL。

**Step 3: 实现显式 UTF-8 JSON 读写**

- 默认路径固定为 `C:\trunk\doc\csvdir`。
- 使用工具目录下的 `config_linker_config.json`。
- 写入使用 `encoding="utf-8"`。
- JSON 损坏时回退默认路径，并返回可显示的告警。
- 不改写损坏文件，直到用户主动保存新目录。

**Step 4: 增加损坏 JSON 和不存在目录测试**

不存在目录由 UI 加载阶段报红，不在设置读取阶段静默替换。

**Step 5: 运行设置测试**

Run:

```text
python -m unittest tests.test_settings -v
```

Expected: PASS。

### Task 6: 构建 Metro 关系图 UI

**Files:**
- Create: `config_linker/theme.py`
- Create: `config_linker/ui.py`
- Create: `tests/test_ui_smoke.py`

**Step 1: 提取现有 Metro 视觉参数**

从 SVNmate 复用视觉原则，不直接复制业务代码：

- `clam` ttk theme
- Segoe UI
- 1140 × 760 基准窗口
- DPI 感知
- 浅色/暗色调色板
- 扁平卡片、细边框、蓝色强调按钮

`theme.py` 提供：

```python
LIGHT_COLORS = {...}
DARK_COLORS = {...}

def configure_styles(root: Tk, style: ttk.Style, dark: bool) -> None:
    ...
```

**Step 2: 建立窗口骨架**

`ConfigLinkerApp` 页面顺序：

1. 标题“配置关系检索器”和数据状态
2. 返回、刷新、选择目录、复制诊断
3. ID 类型下拉框、ID 输入框、搜索按钮
4. 三张固定关系卡片
5. 行内提示

三张卡片之间使用固定箭头标签，不实现自由拖拽画布。

**Step 3: 实现结果 Treeview**

目标物列：

```text
目标物 ID | 类型 | 描述 | NPC ID
```

NPC 列：

```text
NPC ID | 备注 | 名称 | 资源 ID
```

资源列：

```text
资源 ID | 配置路径 | 自动生成路径
```

每个 Treeview：

- 默认渲染前 200 条。
- 显示“已显示 X / 总计 Y”。
- 有剩余记录时显示“加载更多”。
- ID 列使用蓝色文本和手形鼠标。
- 目标物 ID、NPC ID、资源 ID 单元格均使用可点击样式。
- 单击任意 ID 单元格调用统一的 `visit_query(QueryKey)`，其中目标物卡的 NPC ID 和 NPC 卡的资源 ID 也可直接切换查询中心。

**Step 4: 实现搜索和返回**

- 空输入：行内提示“请输入 ID”。
- 非整数：行内提示“ID 必须是整数”。
- 搜索成功：历史 `visit()`，刷新三卡片。
- 点击 ID：调用同一搜索入口。
- 返回：调用 `history.back()`，不再次压栈。
- 无历史时按钮禁用。

**Step 5: 实现加载和原子刷新**

```python
def reload_data(self) -> None:
    try:
        new_repository = CsvRepository.load(self.settings.data_directory)
    except (OSError, CsvDataError) as exc:
        self._show_load_error(exc, keep_old=self.repository is not None)
        return
    self.repository = new_repository
    self.query_service = QueryService(new_repository)
    self._show_load_success(new_repository.report)
```

失败时不得先清空 `self.repository`。

**Step 6: 实现诊断与状态色**

诊断文本包含：

- 数据目录
- 三张表记录数
- 最近成功加载时间
- 最近一次错误
- 当前查询类型和 ID
- 当前查询告警

“复制诊断信息”写入系统剪贴板。

**Step 7: 增加 UI 冒烟测试**

仅在 Windows 运行：

```python
@unittest.skipUnless(os.name == "nt", "Windows Tk smoke test")
def test_window_builds_without_loading_real_data(self) -> None:
    root = Tk()
    root.withdraw()
    app = ConfigLinkerApp(root, auto_load=False)
    self.assertEqual(root.title(), "配置关系检索器")
    root.destroy()
```

**Step 8: 运行 UI 测试**

Run:

```text
python -m unittest tests.test_ui_smoke -v
```

Expected: PASS。

### Task 7: 增加入口、运行脚本和打包配置

**Files:**
- Create: `config_linker_app.py`
- Create: `run_config_linker.bat`
- Create: `ConfigLinker.spec`
- Create: `build_exe.bat`
- Create: `README.md`

**Step 1: 创建最小入口**

```python
from tkinter import Tk

from config_linker.ui import ConfigLinkerApp


def main() -> None:
    root = Tk()
    ConfigLinkerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
```

入口启动前复用现有项目的 Windows DPI 感知方式，但将函数放入本工具自身模块，不从 `svn_auto_tool.py` 导入。

**Step 2: 创建开发运行脚本**

`run_config_linker.bat`：

```bat
@echo off
setlocal
cd /d "%~dp0"
python config_linker_app.py
```

**Step 3: 创建 PyInstaller spec**

要求：

- 单文件
- 窗口模式
- 名称 `ConfigLinker`
- 入口 `config_linker_app.py`
- 临时复用父目录 `svnmate.ico`
- 不打包 CSV，运行时读取用户选择的数据目录

**Step 4: 创建构建脚本**

```bat
@echo off
setlocal
cd /d "%~dp0"
python -m PyInstaller --noconfirm ConfigLinker.spec
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)
echo.
echo Build complete: dist\ConfigLinker.exe
pause
```

自动化验证时直接运行 `python -m PyInstaller --noconfirm ConfigLinker.spec`，避免 `pause` 阻塞。

**Step 5: 编写 README**

说明：

- 三种查询方式
- 点击 ID 和返回上一步
- 默认 CSV 路径
- 刷新行为
- 只读保证
- 构建和运行命令
- `csvspecial` 当前不在范围内

**Step 6: 验证模块入口**

Run:

```text
python -c "import config_linker_app; print('import-ok')"
```

Expected:

```text
import-ok
```

### Task 8: 全量验证和真实数据验收

**Files:**
- Modify only if a failing verification exposes a confirmed defect

**Step 1: 运行全量单元测试**

Run:

```text
python -m unittest discover -s tests -v
```

Expected: 全部 PASS，无意外 skip；仅非 Windows 环境允许跳过 UI 冒烟测试。

**Step 2: 对真实 csvdir 做只读加载**

Run:

```text
python -c "from pathlib import Path; from config_linker.repository import CsvRepository; r=CsvRepository.load(Path(r'C:\trunk\doc\csvdir')); print(r.report)"
```

Expected:

- 三张表记录数均大于 0
- 中文路径正常显示
- 无必需字段缺失

**Step 3: 验证真实关系查询**

从真实数据中选择：

- 一个存在完整链路的目标物 ID
- 一个关联多个目标物的 NPC ID
- 一个关联多个 NPC 的资源 ID

使用查询服务打印三类结果数量，确认与 CSV 抽查一致。不得写回 CSV。

**Step 4: 中文回读检查**

确认至少一条：

- 目标物描述
- NPC 名称
- 模型配置路径

能从真实 CSV 正确显示，不含 Unicode 替换字符 `U+FFFD`。

**Step 5: 手工 UI 验收**

Run:

```text
python config_linker_app.py
```

检查：

- 125%/150% DPI 下字体清晰
- 搜索区居中且无截断
- 三卡片连线清楚
- 一对多结果可滚动
- 单击 ID 可切换查询中心
- 连续切换后可逐级返回
- 刷新失败时旧结果仍保留
- 浅色和暗色主题可用

**Step 6: 构建 EXE**

Run:

```text
python -m PyInstaller --noconfirm ConfigLinker.spec
```

Expected:

```text
dist\ConfigLinker.exe
```

**Step 7: 验证打包产物**

启动 `dist\ConfigLinker.exe`，重复以下最小流程：

1. 搜索目标物 ID
2. 点击 NPC ID
3. 点击资源 ID
4. 连续返回两次
5. 点击重新加载

**Step 8: 检查主配置仓未被修改**

在 `C:\trunk\doc` 运行：

```text
svn status
svn diff
```

Expected: 本工具实施未造成 `xlsdir`、`csvdir`、`csvspecial`、`xmldir` 或其他主仓文件改动。

**Step 9: 检查交付目录**

确认没有把以下内容误放入源码交付清单：

- 测试临时 CSV
- 主配置 CSV 副本
- Python 缓存
- PyInstaller 中间目录
- 运行日志

需要保留的最终源码和文档应与“目标文件结构”一致；`dist\ConfigLinker.exe` 作为本地验收产物单独说明。

**Step 10: 提交 ezxss 项目改动**

在 `C:\Users\Admin\Downloads\ezxss` 运行：

```text
git status --short
git diff --check
git add .gitignore config_id_lookup
git diff --cached --check
git commit -m "Add configuration relationship lookup tool"
```

Expected: 提交只包含新工具源码、测试、文档和 `.gitignore` 的 spec 例外，不包含构建产物、运行时配置或主配置 CSV。
