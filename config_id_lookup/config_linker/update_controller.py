import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

try:
    from module_updates import (
        ModuleManifest,
        ModuleUpdateError,
        build_replace_script,
        download_archive,
        fetch_manifest,
        safe_extract_zip,
        verify_sha256,
        version_key,
    )
except ModuleNotFoundError:
    repository_root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(repository_root))
    from module_updates import (
        ModuleManifest,
        ModuleUpdateError,
        build_replace_script,
        download_archive,
        fetch_manifest,
        safe_extract_zip,
        verify_sha256,
        version_key,
    )


@dataclass(frozen=True)
class UpdateCheckResult:
    state: str
    manifest: ModuleManifest | None = None
    message: str = ""


@dataclass(frozen=True)
class PreparedUpdate:
    version: str
    script_path: Path
    staged_exe: Path
    staged_version: Path


class ConfigLinkerUpdateController:
    MANIFEST_URL = (
        "https://github.com/SusamMinami/SVNmate/releases/download/"
        "config-linker-latest/manifest.json"
    )

    def __init__(
        self,
        *,
        local_version: str,
        current_exe: Path,
        work_dir: Path,
        manifest_fetcher: Callable[
            [str, str],
            ModuleManifest,
        ] = fetch_manifest,
        archive_downloader: Callable[
            [str, Path],
            None,
        ] = download_archive,
        pid_provider: Callable[[], int] = os.getpid,
    ) -> None:
        self.local_version = local_version
        self.current_exe = Path(current_exe)
        self.work_dir = Path(work_dir)
        self._manifest_fetcher = manifest_fetcher
        self._archive_downloader = archive_downloader
        self._pid_provider = pid_provider

    def check(self) -> UpdateCheckResult:
        try:
            manifest = self._manifest_fetcher(
                self.MANIFEST_URL,
                "config-linker",
            )
            has_update = (
                version_key(manifest.version)
                > version_key(self.local_version)
            )
        except Exception as exc:
            return UpdateCheckResult("failed", message=str(exc))
        if not has_update:
            return UpdateCheckResult("idle")
        return UpdateCheckResult("ready", manifest=manifest)

    def prepare_update(
        self,
        manifest: ModuleManifest,
    ) -> PreparedUpdate:
        if manifest.module_id != "config-linker":
            raise ModuleUpdateError("更新清单不是 ConfigLinker 模块")
        if (
            self.current_exe.name.casefold()
            != manifest.entrypoint.casefold()
        ):
            raise ModuleUpdateError(
                f"当前程序与更新入口不匹配：{manifest.entrypoint}"
            )

        self.work_dir.mkdir(parents=True, exist_ok=True)
        archive = self.work_dir / "ConfigLinker.zip"
        extract_dir = self.work_dir / "extract"
        shutil.rmtree(extract_dir, ignore_errors=True)
        self._archive_downloader(manifest.download_url, archive)
        try:
            verify_sha256(archive, manifest.sha256)
        except Exception:
            archive.unlink(missing_ok=True)
            raise
        try:
            safe_extract_zip(archive, extract_dir)
            candidates = list(extract_dir.rglob(manifest.entrypoint))
            if len(candidates) != 1 or not candidates[0].is_file():
                raise ModuleUpdateError(
                    "更新包缺少唯一的 ConfigLinker.exe"
                )
            staged_exe = self.work_dir / "ConfigLinker.exe.new"
            staged_version = self.work_dir / "VERSION.new"
            shutil.copy2(candidates[0], staged_exe)
            staged_version.write_text(
                manifest.version + "\n",
                encoding="utf-8",
            )
        finally:
            shutil.rmtree(extract_dir, ignore_errors=True)

        script_path = self.work_dir / "apply_update.ps1"
        script_path.write_text(
            build_replace_script(
                pid_to_wait=self._pid_provider(),
                current_exe=self.current_exe,
                staged_exe=staged_exe,
                backup_exe=self.current_exe.with_name(
                    self.current_exe.name + ".bak"
                ),
                restart_exe=self.current_exe,
                current_version_file=self.current_exe.parent / "VERSION",
                staged_version_file=staged_version,
            )
            + "\n",
            encoding="utf-8",
        )
        return PreparedUpdate(
            version=manifest.version,
            script_path=script_path,
            staged_exe=staged_exe,
            staged_version=staged_version,
        )

    @staticmethod
    def launch_prepared_update(prepared: PreparedUpdate) -> None:
        creation_flags = 0
        if os.name == "nt":
            creation_flags = (
                subprocess.DETACHED_PROCESS
                | subprocess.CREATE_NEW_PROCESS_GROUP
                | subprocess.CREATE_NO_WINDOW
            )
        subprocess.Popen(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(prepared.script_path),
            ],
            creationflags=creation_flags,
            close_fds=True,
        )
