import os
import shutil
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from module_updates import (
    ModuleManifest,
    ModuleUpdateError,
    fetch_manifest,
    safe_extract_zip,
    verify_sha256,
    version_key,
)


@dataclass(frozen=True)
class ToolModuleSpec:
    module_id: str
    display_name: str
    manifest_url: str
    executable_name: str
    install_folder: str


CONFIG_LINKER = ToolModuleSpec(
    module_id="config-linker",
    display_name="配置关系检索器",
    manifest_url=(
        "https://github.com/SusamMinami/SVNmate/releases/download/"
        "config-linker-latest/manifest.json"
    ),
    executable_name="ConfigLinker.exe",
    install_folder="ConfigLinker",
)

KINDLE_STATUS = ToolModuleSpec(
    module_id="kindle-lark-status",
    display_name="Kindle 提示板",
    manifest_url=(
        "https://github.com/SusamMinami/SVNmate/releases/download/"
        "kindle-windows-latest/manifest.json"
    ),
    executable_name="KindleLarkStatus.exe",
    install_folder="KindleLarkStatus",
)

TOOL_MODULES = (CONFIG_LINKER, KINDLE_STATUS)


def module_paths_from_config(
    data: object,
    *,
    detected_config_linker: str,
    detected_kindle_status: str,
) -> dict[str, str]:
    paths = {
        CONFIG_LINKER.module_id: detected_config_linker,
        KINDLE_STATUS.module_id: detected_kindle_status,
    }
    if not isinstance(data, dict):
        return paths

    legacy_kindle = data.get("kindle_status_path")
    if isinstance(legacy_kindle, str) and legacy_kindle.strip():
        paths[KINDLE_STATUS.module_id] = legacy_kindle.strip()

    configured = data.get("tool_module_paths")
    if isinstance(configured, dict):
        for module_id in paths:
            value = configured.get(module_id)
            if isinstance(value, str) and value.strip():
                paths[module_id] = value.strip()
    return paths


class ToolModuleManager:
    def __init__(
        self,
        app_dir: Path,
        *,
        process_checker: Callable[[str], bool] | None = None,
        process_stopper: Callable[[str], bool] | None = None,
        launcher: Callable[[Path], None] | None = None,
        manifest_fetcher: Callable[[str, str], ModuleManifest] | None = None,
    ) -> None:
        self.app_dir = Path(app_dir)
        self._process_checker = process_checker or self._default_process_checker
        self._process_stopper = process_stopper or self._default_process_stopper
        self._launcher = launcher or self._default_launcher
        self._manifest_fetcher = manifest_fetcher or fetch_manifest

    def executable_path(
        self,
        spec: ToolModuleSpec,
        configured_path: Path | str | None = None,
    ) -> Path:
        if configured_path:
            return Path(configured_path).expanduser()
        return (
            self.app_dir
            / "modules"
            / spec.install_folder
            / spec.executable_name
        )

    def is_installed(
        self,
        spec: ToolModuleSpec,
        configured_path: Path | str | None = None,
    ) -> bool:
        return self.executable_path(spec, configured_path).is_file()

    def is_running(self, spec: ToolModuleSpec) -> bool:
        return self._process_checker(spec.executable_name)

    def local_version(
        self,
        spec: ToolModuleSpec,
        configured_path: Path | str | None = None,
    ) -> str:
        executable = self.executable_path(spec, configured_path)
        version_file = executable.parent / "VERSION"
        if not executable.is_file() or not version_file.is_file():
            return "0.0.0"
        try:
            value = version_file.read_text(encoding="utf-8").strip()
            version_key(value)
        except (OSError, UnicodeError, ModuleUpdateError):
            return "0.0.0"
        return value

    def launch(
        self,
        spec: ToolModuleSpec,
        configured_path: Path | str | None = None,
    ) -> str:
        executable = self.executable_path(spec, configured_path)
        if not executable.is_file():
            return "install-required"
        if self.is_running(spec):
            return "already-running"
        self._launcher(executable)
        return "started"

    def stop(self, spec: ToolModuleSpec, timeout: float = 5.0) -> bool:
        if not self.is_running(spec):
            return True
        if not self._process_stopper(spec.executable_name):
            return False
        deadline = time.monotonic() + timeout
        while self.is_running(spec) and time.monotonic() < deadline:
            time.sleep(0.1)
        return not self.is_running(spec)

    def check_update(self, spec: ToolModuleSpec) -> ModuleManifest:
        return self._manifest_fetcher(spec.manifest_url, spec.module_id)

    def update_available(
        self,
        spec: ToolModuleSpec,
        manifest: ModuleManifest,
        configured_path: Path | str | None = None,
    ) -> bool:
        return version_key(manifest.version) > version_key(
            self.local_version(spec, configured_path)
        )

    def install_archive(
        self,
        spec: ToolModuleSpec,
        manifest: ModuleManifest,
        archive: Path,
        configured_path: Path | str | None = None,
    ) -> Path:
        if manifest.module_id != spec.module_id:
            raise ModuleUpdateError("模块清单与安装目标不匹配")
        verify_sha256(archive, manifest.sha256)
        target = self.executable_path(spec, configured_path)
        update_root = self.app_dir / "_module_updates" / spec.module_id
        extract_dir = update_root / "extract"
        shutil.rmtree(extract_dir, ignore_errors=True)
        safe_extract_zip(archive, extract_dir)
        candidates = list(extract_dir.rglob(manifest.entrypoint))
        if len(candidates) != 1 or not candidates[0].is_file():
            raise ModuleUpdateError(
                f"模块压缩包缺少唯一入口文件：{manifest.entrypoint}"
            )

        target.parent.mkdir(parents=True, exist_ok=True)
        staged_target = target.with_name(target.name + ".new")
        backup_target = target.with_name(target.name + ".bak")
        version_file = target.parent / "VERSION"
        staged_version = version_file.with_name("VERSION.new")
        try:
            shutil.copy2(candidates[0], staged_target)
            staged_version.write_text(manifest.version + "\n", encoding="utf-8")
            if target.is_file():
                shutil.copy2(target, backup_target)
            os.replace(staged_target, target)
            os.replace(staged_version, version_file)
        except Exception as exc:
            staged_target.unlink(missing_ok=True)
            staged_version.unlink(missing_ok=True)
            if backup_target.is_file():
                shutil.copy2(backup_target, target)
            raise ModuleUpdateError(f"模块替换失败：{exc}") from exc
        finally:
            shutil.rmtree(extract_dir, ignore_errors=True)
        return target

    @staticmethod
    def _default_process_checker(executable_name: str) -> bool:
        if os.name != "nt":
            return False
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"IMAGENAME eq {executable_name}", "/NH"],
                capture_output=True,
                text=True,
                errors="ignore",
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except OSError:
            return False
        return executable_name.casefold() in result.stdout.casefold()

    @staticmethod
    def _default_process_stopper(executable_name: str) -> bool:
        if os.name != "nt":
            return False
        try:
            result = subprocess.run(
                ["taskkill", "/IM", executable_name, "/T", "/F"],
                capture_output=True,
                text=True,
                errors="ignore",
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except OSError:
            return False
        return result.returncode == 0

    @staticmethod
    def _default_launcher(executable: Path) -> None:
        if os.name == "nt":
            os.startfile(str(executable))
            return
        subprocess.Popen([str(executable)], cwd=str(executable.parent))
