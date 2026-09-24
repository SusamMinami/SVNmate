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
    supports_updates: bool = True
    module_kind: str = "application"
    allow_custom_path: bool = True
    process_name: str = ""
    can_stop_process: bool = True
    installer_script: str = ""
    recovery_publisher: str = ""


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

MIGRATION_GUARD = ToolModuleSpec(
    module_id="migration-guard",
    display_name="迁移核验助手",
    manifest_url=(
        "https://github.com/SusamMinami/SVNmate/releases/download/"
        "migration-guard-latest/manifest.json"
    ),
    executable_name="MigrationGuard.exe",
    install_folder="MigrationGuard",
)

SERIA_QA_OVERLAY = ToolModuleSpec(
    module_id="seria-qa-overlay",
    display_name="Seria QA Overlay",
    manifest_url=(
        "https://github.com/SusamMinami/SVNmate/releases/download/"
        "seria-qa-overlay-latest/module-manifest.json"
    ),
    executable_name="Install-SeriaQA.cmd",
    install_folder="SeriaQAOverlay",
    module_kind="installer",
    allow_custom_path=False,
    process_name="Seria.exe",
    can_stop_process=False,
    installer_script="Install-SeriaTool.ps1",
    recovery_publisher="Publish-Persistent-Recovery.ps1",
)

TOOL_MODULES = (
    CONFIG_LINKER,
    MIGRATION_GUARD,
    SERIA_QA_OVERLAY,
    KINDLE_STATUS,
)


def module_paths_from_config(
    data: object,
    *,
    detected_config_linker: str,
    detected_kindle_status: str,
    detected_migration_guard: str = "",
) -> dict[str, str]:
    paths = {
        CONFIG_LINKER.module_id: detected_config_linker,
        MIGRATION_GUARD.module_id: detected_migration_guard,
        SERIA_QA_OVERLAY.module_id: "",
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
        package_installer: Callable[[ToolModuleSpec, Path], None] | None = None,
    ) -> None:
        self.app_dir = Path(app_dir)
        self._process_checker = process_checker or self._default_process_checker
        self._process_stopper = process_stopper or self._default_process_stopper
        self._launcher = launcher or self._default_launcher
        self._manifest_fetcher = manifest_fetcher or fetch_manifest
        self._package_installer = (
            package_installer or self._default_package_installer
        )

    def executable_path(
        self,
        spec: ToolModuleSpec,
        configured_path: Path | str | None = None,
    ) -> Path:
        if configured_path and spec.allow_custom_path:
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
        return self._process_checker(spec.process_name or spec.executable_name)

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

    def apply_installed_package(
        self,
        spec: ToolModuleSpec,
        configured_path: Path | str | None = None,
    ) -> Path:
        if spec.module_kind != "installer":
            raise ModuleUpdateError(f"{spec.display_name}不是安装包型模块")
        entrypoint = self.executable_path(spec, configured_path)
        if not entrypoint.is_file():
            raise ModuleUpdateError(f"{spec.display_name}尚未安装")
        self._package_installer(spec, entrypoint.parent)
        return entrypoint

    def stop(self, spec: ToolModuleSpec, timeout: float = 5.0) -> bool:
        if not self.is_running(spec):
            return True
        if not spec.can_stop_process:
            return False
        process_name = spec.process_name or spec.executable_name
        if not self._process_stopper(process_name):
            return False
        deadline = time.monotonic() + timeout
        while self.is_running(spec) and time.monotonic() < deadline:
            time.sleep(0.1)
        return not self.is_running(spec)

    def check_update(self, spec: ToolModuleSpec) -> ModuleManifest:
        if not spec.supports_updates or not spec.manifest_url:
            raise ModuleUpdateError(f"{spec.display_name}暂未配置更新通道")
        manifest = self._manifest_fetcher(spec.manifest_url, spec.module_id)
        if manifest.entrypoint.casefold() != spec.executable_name.casefold():
            raise ModuleUpdateError(
                f"模块入口不匹配：期望 {spec.executable_name}，"
                f"实际 {manifest.entrypoint}"
            )
        return manifest

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
        if manifest.entrypoint.casefold() != spec.executable_name.casefold():
            raise ModuleUpdateError("模块清单入口与安装目标不匹配")
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
        if spec.module_kind == "installer":
            return self._install_package(
                spec,
                manifest,
                candidates[0].parent,
                target,
                extract_dir,
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

    def _install_package(
        self,
        spec: ToolModuleSpec,
        manifest: ModuleManifest,
        package_root: Path,
        target: Path,
        extract_dir: Path,
    ) -> Path:
        target_dir = target.parent
        staged_dir = target_dir.with_name(target_dir.name + ".new")
        backup_dir = target_dir.with_name(target_dir.name + ".bak")
        shutil.rmtree(staged_dir, ignore_errors=True)
        shutil.rmtree(backup_dir, ignore_errors=True)

        try:
            self._package_installer(spec, package_root)
            shutil.copytree(package_root, staged_dir)
            for state_dir_name in ("backups", "logs"):
                current_state = target_dir / state_dir_name
                if current_state.is_dir():
                    shutil.copytree(
                        current_state,
                        staged_dir / state_dir_name,
                        dirs_exist_ok=True,
                    )
            (staged_dir / "VERSION").write_text(
                manifest.version + "\n",
                encoding="utf-8",
            )

            target_dir.parent.mkdir(parents=True, exist_ok=True)
            had_existing = target_dir.is_dir()
            if had_existing:
                os.replace(target_dir, backup_dir)
            try:
                os.replace(staged_dir, target_dir)
            except Exception:
                if had_existing and backup_dir.is_dir():
                    os.replace(backup_dir, target_dir)
                raise
            shutil.rmtree(backup_dir, ignore_errors=True)
        except ModuleUpdateError:
            raise
        except Exception as exc:
            raise ModuleUpdateError(f"安装包应用失败：{exc}") from exc
        finally:
            shutil.rmtree(staged_dir, ignore_errors=True)
            shutil.rmtree(extract_dir, ignore_errors=True)
        return target

    @staticmethod
    def _default_package_installer(
        spec: ToolModuleSpec,
        package_root: Path,
    ) -> None:
        if os.name != "nt":
            raise ModuleUpdateError("安装包型模块仅支持 Windows")
        installer = package_root / spec.installer_script
        manifest = package_root / "manifest.json"
        publisher = package_root / spec.recovery_publisher
        required = [installer, manifest, publisher]
        missing = [path.name for path in required if not path.is_file()]
        if missing:
            raise ModuleUpdateError(
                "模块安装包缺少文件：" + "、".join(missing)
            )

        system_drive = os.environ.get("SystemDrive", "C:")
        seria_root = os.environ.get(
            "SERIA_TRUNK",
            str(Path(system_drive + "\\") / "trunk"),
        )
        commands = [
            [
                "powershell.exe",
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(installer),
                "-ManifestPath",
                str(manifest),
                "-TargetPath",
                seria_root,
                "-Yes",
            ],
            [
                "powershell.exe",
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(publisher),
                "-ManifestPath",
                str(manifest),
                "-TargetPath",
                seria_root,
            ],
        ]
        for command in commands:
            try:
                result = subprocess.run(
                    command,
                    cwd=str(package_root),
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    text=True,
                    errors="replace",
                    timeout=10 * 60,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    close_fds=True,
                    check=False,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                raise ModuleUpdateError(
                    f"{spec.display_name}安装器启动失败：{exc}"
                ) from exc
            if result.returncode != 0:
                output = "\n".join(
                    (result.stdout + "\n" + result.stderr).splitlines()[-12:]
                ).strip()
                detail = f"\n{output}" if output else ""
                raise ModuleUpdateError(
                    f"{spec.display_name}安装器返回 "
                    f"{result.returncode}{detail}"
                )

    @staticmethod
    def _default_process_checker(executable_name: str) -> bool:
        if os.name != "nt":
            return False
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"IMAGENAME eq {executable_name}", "/NH"],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                errors="ignore",
                creationflags=subprocess.CREATE_NO_WINDOW,
                close_fds=True,
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
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                errors="ignore",
                creationflags=subprocess.CREATE_NO_WINDOW,
                close_fds=True,
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
