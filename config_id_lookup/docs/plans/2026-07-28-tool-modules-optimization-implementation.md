# 工具模块与配置检索器优化实施计划

> **For Coco:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**Goal:** 优化 ConfigLinker 的 DPI、窗口、复制和配置查询体验，并为 SVNmate、ConfigLinker 与 KindleLarkStatus 建立可独立发布和更新的 Windows 工具模块体系。

**Architecture:** ConfigLinker 继续作为独立 Tkinter EXE，SVNmate 只负责模块目录、启动和更新管理。SVNmate 仓库提供共享的模块清单解析、哈希校验和原子替换核心；ConfigLinker 自更新与 SVNmate 模块管理器使用同一协议。KindleLarkStatus 保持独立仓库和进程，通过固定 GitHub Release 通道发布 Windows 模块。

**Tech Stack:** Python 3.11、Tkinter/ttk、`unittest`、PyInstaller、PowerShell、GitHub Actions、GitHub Releases。

---

## 实施约束

- SVNmate 仓库：`C:\Users\Admin\Downloads\ezxss`
- KindleLarkStatus 仓库：`C:\Users\Admin\Downloads\提示板\KindleLarkStatus`
- 游戏配置仓只读：`C:\trunk\doc`
- 不修改 `.xlsm`、CSV、XML 或导表脚本。
- 不运行配置仓 VBA、`configcheck.bat` 或 `configgen.bat`。
- 不读取、打印或提交 KindleLarkStatus 的私有配置、Token、SSH 私钥。
- 模块更新只替换白名单程序文件。
- 每个仓库单独提交，发布前再合并或推送到 `main`。
- 测试命令使用 `python -B`，避免沙箱生成字节码缓存。

## 版本目标

```text
SVNmate:          v1.4.0
ConfigLinker:     1.1.0
KindleLarkStatus: 读取其 VERSION，当前为 0.4.0
```

## 目标文件

### SVNmate 仓库

```text
module_updates.py
tool_modules.py
test_module_updates.py
test_tool_modules.py
config_id_lookup/VERSION
config_id_lookup/config_linker/dpi.py
config_id_lookup/config_linker/update_controller.py
.github/workflows/publish-config-linker.yml
```

并修改：

```text
svn_auto_tool.py
test_svn_auto_tool.py
config_id_lookup/config_linker_app.py
config_id_lookup/config_linker/models.py
config_id_lookup/config_linker/repository.py
config_id_lookup/config_linker/settings.py
config_id_lookup/config_linker/theme.py
config_id_lookup/config_linker/ui.py
config_id_lookup/ConfigLinker.spec
config_id_lookup/tests/*
README.md
README_svn_auto_tool.md
RELEASE_NOTES.md
.github/workflows/publish-release.yml
```

### KindleLarkStatus 仓库

修改：

```text
.github/workflows/build-desktop.yml
README.md
README.zh-CN.md
MAINTENANCE.md
```

### Task 1: 建立双仓基线和功能分支

**Files:**
- Verify only; no source edit

**Step 1: 检查两个仓库状态**

Run in SVNmate:

```powershell
git status --short --branch
git log -3 --oneline
```

Run in KindleLarkStatus:

```powershell
git status --short --branch
git log -3 --oneline
```

Expected: 两个工作区均无未提交改动。

**Step 2: 创建功能分支**

Run:

```powershell
git switch -c tool-modules-v1.4
```

分别在两个仓库执行。Kindle 分支可命名为：

```powershell
git switch -c windows-module-release
```

**Step 3: 运行 SVNmate 基线测试**

Run:

```powershell
python -B -m unittest -v test_svn_auto_tool.py
Push-Location config_id_lookup
python -B -m unittest discover -s tests -v
Pop-Location
```

Expected: 当前测试全部通过。

**Step 4: 运行 KindleLarkStatus 基线测试**

Run:

```powershell
python -B -m unittest discover -s tests -v
```

Expected: 当前测试全部通过。

### Task 2: 修复 ConfigLinker DPI 和初始窗口尺寸

**Files:**
- Create: `config_id_lookup/config_linker/dpi.py`
- Modify: `config_id_lookup/config_linker_app.py`
- Modify: `config_id_lookup/config_linker/ui.py`
- Test: `config_id_lookup/tests/test_dpi.py`
- Test: `config_id_lookup/tests/test_ui_smoke.py`

**Step 1: 写窗口尺寸计算失败测试**

Create `test_dpi.py`:

```python
import unittest

from config_linker.dpi import window_geometry


class DpiTests(unittest.TestCase):
    def test_geometry_scales_and_stays_inside_work_area(self) -> None:
        geometry = window_geometry(
            dpi=120,
            screen_width=2560,
            screen_height=1440,
            work_width=2560,
            work_height=1400,
        )
        self.assertGreaterEqual(geometry.width, 1500)
        self.assertGreaterEqual(geometry.height, 900)
        self.assertLessEqual(geometry.width, 2560)
        self.assertLessEqual(geometry.height, 1400)

    def test_small_screen_is_capped(self) -> None:
        geometry = window_geometry(144, 1366, 768, 1366, 728)
        self.assertLessEqual(geometry.width, 1366)
        self.assertLessEqual(geometry.height, 728)
```

**Step 2: 运行测试并确认失败**

Run:

```powershell
Push-Location config_id_lookup
python -B -m unittest tests.test_dpi -v
Pop-Location
```

Expected: FAIL，`config_linker.dpi` 不存在。

**Step 3: 实现 DPI 工具**

`dpi.py` 至少提供：

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class WindowGeometry:
    width: int
    height: int
    minimum_width: int
    minimum_height: int


def window_geometry(
    dpi: int,
    screen_width: int,
    screen_height: int,
    work_width: int | None = None,
    work_height: int | None = None,
) -> WindowGeometry:
    scale = max(dpi, 96) / 96.0
    available_width = work_width or screen_width
    available_height = work_height or screen_height
    width = min(round(1320 * scale), max(980, available_width - 48))
    height = min(round(820 * scale), max(640, available_height - 72))
    return WindowGeometry(
        width=width,
        height=height,
        minimum_width=min(round(1120 * scale), width),
        minimum_height=min(round(680 * scale), height),
    )
```

同时实现：

- `enable_windows_dpi_awareness()`
- `get_window_dpi(root)`
- `configure_tk_dpi(root)`

逻辑以 `svn_auto_tool.py` 的已验证实现为参考。

**Step 4: 调整初始化顺序**

`config_linker_app.py` 必须：

1. 导入 `ctypes/os/sys` 和 DPI 工具。
2. 调用 `enable_windows_dpi_awareness()`。
3. 再导入 `Tk` 和 `ConfigLinkerApp`。

禁止把 DPI awareness 调用留在 `main()` 创建 Tk 之后。

**Step 5: 接入初始尺寸和 DPI tick**

`ConfigLinkerApp.__init__`：

```python
self.current_dpi = configure_tk_dpi(root)
self._set_initial_window_geometry(self.current_dpi)
self.root.after(1000, self._dpi_tick)
```

`_dpi_tick()` 在 DPI 变化时：

- 更新 Tk scaling。
- 重新应用主题。
- 不覆盖用户手动调整后的窗口尺寸。

**Step 6: 运行测试**

Run:

```powershell
Push-Location config_id_lookup
python -B -m unittest tests.test_dpi tests.test_ui_smoke -v
Pop-Location
```

Expected: PASS。

**Step 7: 提交**

```powershell
git add config_id_lookup/config_linker/dpi.py config_id_lookup/config_linker_app.py config_id_lookup/config_linker/ui.py config_id_lookup/tests
git commit -m "Fix ConfigLinker DPI and window sizing"
```

### Task 3: 扩展目标物位置数据并迁移 doc 目录

**Files:**
- Modify: `config_id_lookup/config_linker/models.py`
- Modify: `config_id_lookup/config_linker/repository.py`
- Modify: `config_id_lookup/config_linker/settings.py`
- Modify: `config_id_lookup/tests/fixture_factory.py`
- Modify: `config_id_lookup/tests/test_repository.py`
- Modify: `config_id_lookup/tests/test_settings.py`

**Step 1: 写位置字段失败测试**

```python
def test_target_includes_position_and_rotation(self) -> None:
    repository = CsvRepository.load(self.directory)
    target = repository.targets_by_id[1001][0]
    self.assertEqual(target.position, "(X=1,Y=2,Z=3)")
    self.assertEqual(target.rotation, "(Pitch=0,Yaw=90,Roll=0)")
```

夹具成员行增加：

```text
MissionPosition.Position
MissionPosition.Rotation
```

**Step 2: 写模型字段精简测试**

```python
def test_resource_keeps_only_configured_path(self) -> None:
    resource = self.repository.resources_by_id[3001][0]
    self.assertEqual(resource.configured_path, "/Game/Test/BP_Test")
    self.assertFalse(hasattr(resource, "generated_path"))
```

**Step 3: 写 doc 目录解析和迁移测试**

`settings.py` 新增纯函数：

```python
def normalize_doc_directory(selected: Path) -> Path:
    if selected.name.lower() == "csvdir":
        return selected.parent
    return selected


def csv_directory(settings: AppSettings) -> Path:
    return settings.doc_directory / "csvdir"
```

测试覆盖：

- 默认 `C:\trunk\doc`
- 选择 `doc`
- 误选 `doc\csvdir`
- 旧 JSON 的 `data_directory`
- 新 JSON 的 `doc_directory`

**Step 4: 运行失败测试**

Run:

```powershell
Push-Location config_id_lookup
python -B -m unittest tests.test_repository tests.test_settings -v
Pop-Location
```

Expected: FAIL。

**Step 5: 实现模型和解析**

`TargetRecord`：

```python
position: str
rotation: str
```

`ResourceRecord` 删除：

```python
generated_path: str
```

仓库按成员名读取：

```text
MissionPosition.Position
MissionPosition.Rotation
```

ConfigLinker 加载仓库时使用：

```python
CsvRepository.load(self.settings.doc_directory / "csvdir")
```

**Step 6: 实现旧设置迁移**

读取优先级：

1. `doc_directory`
2. 旧 `data_directory`
3. 默认 `C:\trunk\doc`

保存时只写 `doc_directory`。

**Step 7: 运行测试并提交**

Run:

```powershell
Push-Location config_id_lookup
python -B -m unittest tests.test_repository tests.test_settings -v
Pop-Location
```

Expected: PASS。

Commit:

```powershell
git add config_id_lookup/config_linker config_id_lookup/tests
git commit -m "Add target positions and doc directory discovery"
```

### Task 4: 精简资源卡片并实现可选择详情

**Files:**
- Modify: `config_id_lookup/config_linker/ui.py`
- Modify: `config_id_lookup/config_linker/theme.py`
- Test: `config_id_lookup/tests/test_ui_smoke.py`

**Step 1: 写列定义失败测试**

```python
def test_resource_card_excludes_generated_path(self) -> None:
    columns = CARD_COLUMNS[QueryKind.RESOURCE]
    self.assertEqual([column[0] for column in columns], ["id", "configured_path"])
```

**Step 2: 写滚动条和详情控件失败测试**

UI 冒烟测试确认：

- 资源 Treeview 具有 `xscrollcommand`。
- 资源卡片存在水平 Scrollbar。
- 下方存在 `resource_path_entry`。
- Entry 状态为 `readonly`。

**Step 3: 运行测试并确认失败**

```powershell
Push-Location config_id_lookup
python -B -m unittest tests.test_ui_smoke -v
Pop-Location
```

**Step 4: 修改资源卡片**

列定义：

```python
QueryKind.RESOURCE: (
    ("id", "资源 ID", 100),
    ("configured_path", "配置路径", 620),
)
```

资源 Treeview：

- `stretch=False`
- 增加水平滚动条
- 绑定 `xscrollcommand`

**Step 5: 修改详情区**

详情区由单一 Label 调整为按类型显示的只读字段。

资源详情：

```text
资源 ID
配置路径 [readonly Entry]
```

Entry 保留原始路径，不能使用截断文本。

**Step 6: 运行测试并提交**

```powershell
Push-Location config_id_lookup
python -B -m unittest tests.test_ui_smoke -v
Pop-Location
git add config_id_lookup/config_linker config_id_lookup/tests/test_ui_smoke.py
git commit -m "Improve ConfigLinker resource path display"
```

### Task 5: 实现查询高亮、单双击复制和位置详情

**Files:**
- Create: `config_id_lookup/config_linker/interactions.py`
- Modify: `config_id_lookup/config_linker/ui.py`
- Modify: `config_id_lookup/config_linker/theme.py`
- Test: `config_id_lookup/tests/test_interactions.py`
- Test: `config_id_lookup/tests/test_ui_smoke.py`

**Step 1: 写单双击仲裁失败测试**

使用不依赖 Tk 的状态类：

```python
class ClickArbiter:
    def __init__(self, schedule, cancel, delay_ms=220):
        ...

    def single(self, key, callback):
        ...

    def double(self, copy_callback):
        ...
```

测试：

```python
def test_double_click_cancels_pending_navigation(self) -> None:
    arbiter.single(key, navigate)
    arbiter.double(copy)
    self.assertEqual(cancelled, [scheduled_token])
    self.assertEqual(copied, [key])
    self.assertEqual(navigated, [])
```

**Step 2: 运行并确认失败**

```powershell
Push-Location config_id_lookup
python -B -m unittest tests.test_interactions -v
Pop-Location
```

**Step 3: 实现复制和 toast**

`ConfigLinkerApp._copy_text(value, label)`：

```python
self.root.clipboard_clear()
self.root.clipboard_append(value)
self._show_toast(f"已复制 {label}")
```

Toast：

- 右下角浮动。
- 1500ms 后销毁。
- 新 toast 覆盖旧 toast。

**Step 4: 实现查询中心高亮**

每张卡片标题旁增加 `StringVar`：

```text
查询中心 · NPC 100007
```

渲染当前结果时：

- 查询卡片使用强调边框。
- 焦点行使用 `focus` tag。
- 自动 `tree.see(item_id)`。
- focus tag 使用强调底色和粗体。

**Step 5: 实现目标物位置详情**

目标物详情显示：

- 基本信息
- 默认折叠按钮 `位置详情 ▸`
- 展开后的 Position 和 Rotation readonly Entry

两个 Entry：

- 支持选择和 `Ctrl+C`
- `<Double-1>` 复制完整值

**Step 6: 更新 UI 测试**

覆盖：

- 双击 ID 不导航。
- 单击延迟完成后导航。
- toast 文本正确。
- 当前查询标签正确。
- 返回历史后高亮恢复。
- Position/Rotation 默认隐藏，展开后可见。

**Step 7: 运行测试并提交**

```powershell
Push-Location config_id_lookup
python -B -m unittest tests.test_interactions tests.test_ui_smoke -v
Pop-Location
git add config_id_lookup/config_linker config_id_lookup/tests
git commit -m "Add ConfigLinker copy and focus interactions"
```

### Task 6: 实现 doc 目录引导窗口

**Files:**
- Modify: `config_id_lookup/config_linker/ui.py`
- Test: `config_id_lookup/tests/test_ui_smoke.py`

**Step 1: 写目录校验失败测试**

把目录验证提取为纯函数：

```python
def validate_doc_directory(path: Path) -> tuple[Path | None, tuple[str, ...]]:
    ...
```

测试：

- 合法 doc 返回 doc。
- 合法 csvdir 返回父 doc。
- 缺少 csvdir 返回 `csvdir`。
- 缺少某张表返回完整相对路径。

**Step 2: 实现引导**

按钮改名：

```text
选择 doc 目录
```

点击后先显示说明：

```text
请选择配置仓的 doc 根目录。
程序会自动读取 doc\csvdir 下的三张配置表。
```

确认后再打开目录选择器。

**Step 3: 失败时不保存**

只有验证成功后才：

- 更新设置。
- 保存 JSON。
- 重新加载。

失败时显示缺失项并保留旧目录。

**Step 4: 运行测试并提交**

```powershell
Push-Location config_id_lookup
python -B -m unittest tests.test_settings tests.test_ui_smoke -v
Pop-Location
git add config_id_lookup/config_linker config_id_lookup/tests
git commit -m "Guide ConfigLinker doc directory selection"
```

### Task 7: 创建共享模块更新核心

**Files:**
- Create: `module_updates.py`
- Create: `test_module_updates.py`

**Step 1: 写清单校验失败测试**

```python
def test_manifest_requires_expected_id_https_hash_and_safe_entrypoint(self) -> None:
    manifest = ModuleManifest.from_dict(
        payload,
        expected_id="config-linker",
    )
    self.assertEqual(manifest.version, "1.1.0")
```

失败用例：

- ID 不匹配
- 非 HTTPS
- SHA 不是 64 位十六进制
- entrypoint 包含 `..`
- version 为空

**Step 2: 写 SHA 和安全解压失败测试**

```python
def test_hash_mismatch_rejects_archive(self) -> None:
    with self.assertRaises(ModuleUpdateError):
        verify_sha256(path, "0" * 64)

def test_zip_path_traversal_is_rejected(self) -> None:
    ...
```

**Step 3: 写替换脚本测试**

`build_replace_script()` 生成的 PowerShell 必须包含：

- 等待指定 PID
- 备份现有 EXE
- 替换白名单 entrypoint
- 失败恢复备份
- 可选重启

不得包含删除配置目录或通配复制整个模块目录。

**Step 4: 运行并确认失败**

```powershell
python -B -m unittest -v test_module_updates.py
```

**Step 5: 实现核心**

核心 API：

```python
@dataclass(frozen=True)
class ModuleManifest:
    module_id: str
    version: str
    download_url: str
    sha256: str
    entrypoint: str


def version_key(value: str) -> tuple[int, ...]: ...
def fetch_manifest(url: str, expected_id: str) -> ModuleManifest: ...
def download_archive(url: str, destination: Path) -> None: ...
def verify_sha256(path: Path, expected: str) -> None: ...
def safe_extract_zip(path: Path, destination: Path) -> None: ...
def build_replace_script(...) -> str: ...
```

使用标准库，不新增 requests 依赖。

**Step 6: 运行测试并提交**

```powershell
python -B -m unittest -v test_module_updates.py
git add module_updates.py test_module_updates.py
git commit -m "Add secure tool module update core"
```

### Task 8: 构建 SVNmate 工具模块管理器

**Files:**
- Create: `tool_modules.py`
- Create: `test_tool_modules.py`
- Modify: `svn_auto_tool.py`
- Modify: `test_svn_auto_tool.py`

**Step 1: 写模块目录和现有路径迁移测试**

模块定义：

```python
CONFIG_LINKER = ToolModuleSpec(
    module_id="config-linker",
    display_name="配置关系检索器",
    manifest_url="https://github.com/SusamMinami/SVNmate/releases/download/config-linker-latest/manifest.json",
    executable_name="ConfigLinker.exe",
)

KINDLE_STATUS = ToolModuleSpec(
    module_id="kindle-lark-status",
    display_name="Kindle 提示板",
    manifest_url="https://github.com/SusamMinami/KindleLarkStatus/releases/download/windows-module-latest/manifest.json",
    executable_name="KindleLarkStatus.exe",
)
```

测试覆盖：

- 默认 managed path
- 已选择外部 EXE
- 旧 `kindle_status_path` 迁移
- 模块未安装状态
- 模块版本读取

**Step 2: 写启动测试**

- 已运行时不重复启动。
- 未安装时返回 install-required。
- 安装后启动正确 EXE。
- Kindle 联动仍遵守原布尔配置。

**Step 3: 运行并确认失败**

```powershell
python -B -m unittest -v test_tool_modules.py
```

**Step 4: 实现 ToolModuleManager**

职责：

- 保存模块路径。
- 检测进程。
- 启动模块。
- 后台检查清单。
- 发起下载和替换。
- 向 UI 返回状态，不直接创建 Tk 控件。

**Step 5: 重排 SVNmate 设置区**

保持两张卡片：

```text
执行与自动化 | 工具模块
```

工具模块每行：

```text
模块名 | 状态/版本 | 安装或打开 | 检查或更新 | 选择现有
```

Kindle 行额外保留联动开关。

**Step 6: 更新配置保存**

新增：

```json
{
  "tool_module_paths": {
    "config-linker": "...",
    "kindle-lark-status": "..."
  }
}
```

读取旧 `kindle_status_path` 并迁移。

**Step 7: 后台自动检查**

启动后延迟检查两个模块。网络错误只更新模块状态和日志。

**Step 8: 运行测试并提交**

```powershell
python -B -m unittest -v test_svn_auto_tool.py test_tool_modules.py test_module_updates.py
git add svn_auto_tool.py tool_modules.py module_updates.py test_*.py
git commit -m "Add SVNmate tool module manager"
```

### Task 9: 添加 ConfigLinker 自更新

**Files:**
- Create: `config_id_lookup/VERSION`
- Create: `config_id_lookup/config_linker/update_controller.py`
- Modify: `config_id_lookup/config_linker/ui.py`
- Modify: `config_id_lookup/ConfigLinker.spec`
- Test: `config_id_lookup/tests/test_update_controller.py`

**Step 1: 添加版本文件**

```text
1.1.0
```

PyInstaller spec 打包 VERSION，并把仓库根目录加入 `pathex`，使 ConfigLinker 能导入共享 `module_updates.py`。

**Step 2: 写更新状态测试**

测试：

- 本地版本低于清单版本 -> ready
- 相同版本 -> idle
- 网络异常 -> failed
- 用户拒绝 -> 不下载
- 下载成功 -> 校验哈希并生成替换脚本

**Step 3: 实现 UpdateController**

控制器不直接操作 Tk：

```python
class ConfigLinkerUpdateController:
    MANIFEST_URL = "https://github.com/SusamMinami/SVNmate/releases/download/config-linker-latest/manifest.json"
```

回调状态：

```text
checking / idle / ready / downloading / failed
```

**Step 4: 接入 UI**

标题区域显示：

```text
v1.1.0  ○
```

- 启动后后台检查。
- 有更新时圆点变红。
- 点击后确认下载。
- 下载完成后确认重启应用。

**Step 5: 运行测试并提交**

```powershell
Push-Location config_id_lookup
python -B -m unittest discover -s tests -v
Pop-Location
git add module_updates.py config_id_lookup
git commit -m "Add independent ConfigLinker updates"
```

### Task 10: 发布 ConfigLinker 固定模块通道

**Files:**
- Create: `.github/workflows/publish-config-linker.yml`
- Modify: `config_id_lookup/README.md`

**Step 1: 编写工作流**

触发：

- `workflow_dispatch`
- `main` 上 ConfigLinker 源码或 VERSION 变化

Windows job：

1. Checkout
2. Setup Python 3.11
3. 安装 PyInstaller
4. 运行 ConfigLinker 测试
5. 构建 `ConfigLinker.exe`
6. 创建：

```text
ConfigLinker/
  ConfigLinker.exe
```

7. 压缩为 `ConfigLinker.zip`
8. 计算 SHA-256
9. 生成 `manifest.json`
10. 上传或覆盖固定 release `config-linker-latest`

**Step 2: 校验 manifest**

生成示例：

```json
{
  "id": "config-linker",
  "version": "1.1.0",
  "download_url": "https://github.com/SusamMinami/SVNmate/releases/download/config-linker-latest/ConfigLinker.zip",
  "sha256": "<computed>",
  "entrypoint": "ConfigLinker.exe"
}
```

**Step 3: 更新 ConfigLinker README**

增加：

- 版本
- 自更新入口
- SVNmate 模块安装
- 固定发布通道
- 配置不会被更新覆盖

**Step 4: 提交**

```powershell
git add .github/workflows/publish-config-linker.yml config_id_lookup
git commit -m "Publish ConfigLinker as an independent module"
```

### Task 11: 发布 KindleLarkStatus Windows 模块

**Files:**
- Modify: `.github/workflows/build-desktop.yml`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `MAINTENANCE.md`

**Step 1: 扩展工作流权限**

增加：

```yaml
permissions:
  contents: write
```

**Step 2: 在 Windows job 生成模块资产**

构建完成后：

- 使用 `VERSION` 或输入版本。
- 把 `dist\KindleLarkStatus.exe` 放入 `KindleLarkStatus\`。
- 生成 `KindleLarkStatus.zip`。
- 计算 SHA-256。
- 生成 `manifest.json`。
- 上传/覆盖固定 release `windows-module-latest`。

Manifest：

```json
{
  "id": "kindle-lark-status",
  "version": "0.4.0",
  "download_url": "https://github.com/SusamMinami/KindleLarkStatus/releases/download/windows-module-latest/KindleLarkStatus.zip",
  "sha256": "<computed>",
  "entrypoint": "KindleLarkStatus.exe"
}
```

**Step 3: 保留现有 artifact**

原 `actions/upload-artifact` 继续保留，避免破坏开发构建下载。

**Step 4: 更新文档**

中英文 README 和维护文档明确：

- 固定 Windows 模块发布通道。
- SVNmate 可安装和更新 Windows EXE。
- `%APPDATA%` 配置不会进入模块包。
- “更新 Windows 模块”不等于“更新 Kindle 端”。

**Step 5: 运行 Kindle 测试**

```powershell
python -B -m unittest discover -s tests -v
```

Expected: PASS。

**Step 6: 提交**

```powershell
git add .github/workflows/build-desktop.yml README.md README.zh-CN.md MAINTENANCE.md
git commit -m "Publish KindleLarkStatus Windows module"
```

### Task 12: 更新 SVNmate 指南、版本和完整发布

**Files:**
- Modify: `README_svn_auto_tool.md`
- Modify: `README.md`
- Modify: `RELEASE_NOTES.md`
- Modify: `svn_auto_tool.py`
- Modify: `.github/workflows/publish-release.yml`
- Modify: `config_id_lookup/README.md`

**Step 1: 更新 SVNmate 版本**

```python
APP_VERSION = "v1.4.0"
```

主 release workflow 改为 `v1.4.0`。

**Step 2: 更新使用指南**

`README_svn_auto_tool.md` 新增“工具模块”章节，至少回答：

- 什么是工具模块。
- 如何安装 ConfigLinker。
- 如何选择已有 KindleLarkStatus。
- 如何打开、检查和更新模块。
- 模块配置保存在哪里。
- ConfigLinker 的 doc 目录如何选择。
- 双击复制和路径复制如何使用。
- Windows 模块更新与 Kindle 端更新有什么区别。

**Step 3: 更新发布说明**

根 README 和 RELEASE_NOTES 记录：

- 工具模块卡片。
- 两个独立更新通道。
- ConfigLinker DPI、窗口和复制优化。
- 按需安装。

**Step 4: 运行完整测试**

SVNmate：

```powershell
python -B -m unittest -v test_svn_auto_tool.py test_tool_modules.py test_module_updates.py
Push-Location config_id_lookup
python -B -m unittest discover -s tests -v
Pop-Location
```

Kindle：

```powershell
python -B -m unittest discover -s tests -v
```

**Step 5: 构建三个 Windows EXE**

SVNmate：

```powershell
python -m PyInstaller --noconfirm SVNAutoTool.spec
```

ConfigLinker：

```powershell
Push-Location config_id_lookup
python -m PyInstaller --noconfirm ConfigLinker.spec
Pop-Location
```

Kindle：

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 0.4.0
```

**Step 6: 实际启动验收**

- SVNmate 三秒以上稳定运行。
- 工具模块卡片可见。
- ConfigLinker 三栏完整显示。
- 当前 ID 高亮。
- 双击 ID 复制并显示 toast。
- 路径可横滚和选择复制。
- 坐标/旋转可展开和复制。
- KindleLarkStatus 启动后托盘服务正常。

所有验收进程结束前必须清理，不留后台测试实例。

**Step 7: 本地端到端更新测试**

使用本地 HTTP 服务提供：

- manifest
- zip

在临时目录安装旧版占位 EXE，验证：

- 新版被下载。
- SHA 校验通过。
- 旧版被备份。
- 新版替换成功。
- 配置文件保持不变。
- 模拟失败时旧版恢复。

**Step 8: 提交 SVNmate 文档和版本**

```powershell
git add README.md README_svn_auto_tool.md RELEASE_NOTES.md svn_auto_tool.py .github/workflows/publish-release.yml config_id_lookup/README.md
git commit -m "Release SVNmate v1.4.0 tool modules"
```

**Step 9: 审查两个仓库差异**

```powershell
git status --short
git diff --check
git log --oneline --decorate -10
```

确保：

- 无 build/dist 缓存进入提交。
- 无本地 JSON、日志、Token、SSH 私钥。
- 无游戏配置仓改动。

**Step 10: 推送功能分支并检查 Actions**

获得用户确认后分别推送两个分支。检查：

- ConfigLinker 固定模块 workflow
- Kindle Windows 模块 workflow
- SVNmate 主发布 workflow

**Step 11: 合并或推送 main 并发布**

获得用户明确授权后：

- 合并到两个仓库 main。
- 推送 ConfigLinker `config-linker-latest`。
- 推送 Kindle `windows-module-latest`。
- 发布 SVNmate `v1.4.0`。

**Step 12: 远端验证**

下载两个 `manifest.json`：

- 检查版本。
- 检查 URL。
- 下载 zip。
- 重新计算 SHA-256。
- 确认与 manifest 一致。

最后用发布版 SVNmate 完成：

1. 按需安装 ConfigLinker。
2. 打开 ConfigLinker。
3. 检查 ConfigLinker 更新。
4. 安装或选择 KindleLarkStatus。
5. 检查 Kindle Windows 模块更新。

## 完成标准

- ConfigLinker 字体在 125% 显示器清晰，跨显示器不发虚。
- 默认窗口完整容纳三张卡片。
- 模型资源卡片没有自动生成路径。
- 长路径可以横滚、选择和复制。
- 双击 ID、坐标和旋转可复制并显示浮动提示。
- 当前查询 ID 有明确高亮。
- doc 目录选择有说明、校验和旧配置迁移。
- SVNmate 工具模块卡片可管理 ConfigLinker 和 KindleLarkStatus。
- ConfigLinker 可从 SVNmate 和自身检查更新。
- KindleLarkStatus Windows EXE 可由 SVNmate 独立更新。
- 三个发布通道互不覆盖。
- 两个仓库测试、构建、发布和远端哈希验证全部通过。
