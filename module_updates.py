import hashlib
import json
import re
import shutil
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse


_SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")


class ModuleUpdateError(Exception):
    """Raised when a module update is invalid or cannot be applied safely."""


@dataclass(frozen=True)
class ModuleManifest:
    module_id: str
    version: str
    download_url: str
    sha256: str
    entrypoint: str

    @classmethod
    def from_dict(
        cls,
        payload: object,
        *,
        expected_id: str,
    ) -> "ModuleManifest":
        if not isinstance(payload, dict):
            raise ModuleUpdateError("模块清单必须是 JSON 对象")
        module_id = _required_string(payload, "id")
        version = _required_string(payload, "version")
        download_url = _required_string(payload, "download_url")
        sha256 = _required_string(payload, "sha256").lower()
        entrypoint = _required_string(payload, "entrypoint")

        if module_id != expected_id:
            raise ModuleUpdateError(
                f"模块 ID 不匹配：期望 {expected_id}，实际 {module_id}"
            )
        version_key(version)
        if urlparse(download_url).scheme.lower() != "https":
            raise ModuleUpdateError("模块下载地址必须使用 HTTPS")
        if not _SHA256_PATTERN.fullmatch(sha256):
            raise ModuleUpdateError("模块清单中的 SHA-256 无效")
        normalized_entrypoint = PurePosixPath(entrypoint.replace("\\", "/"))
        if (
            normalized_entrypoint.is_absolute()
            or len(normalized_entrypoint.parts) != 1
            or ".." in normalized_entrypoint.parts
            or normalized_entrypoint.suffix.casefold() != ".exe"
        ):
            raise ModuleUpdateError("模块入口文件不安全")

        return cls(
            module_id=module_id,
            version=version,
            download_url=download_url,
            sha256=sha256,
            entrypoint=entrypoint,
        )


def _required_string(payload: dict[object, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ModuleUpdateError(f"模块清单缺少有效字段：{key}")
    return value.strip()


def version_key(value: str) -> tuple[int, ...]:
    text = value.strip().lower().lstrip("v")
    if not text:
        raise ModuleUpdateError("模块版本不能为空")
    parts: list[int] = []
    for item in text.split("."):
        match = re.match(r"^(\d+)", item)
        if not match:
            raise ModuleUpdateError(f"模块版本无效：{value}")
        parts.append(int(match.group(1)))
    return tuple(parts)


def fetch_manifest(url: str, expected_id: str) -> ModuleManifest:
    if urlparse(url).scheme.lower() != "https":
        raise ModuleUpdateError("模块清单地址必须使用 HTTPS")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "SVNmate-Module-Updater"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise ModuleUpdateError(f"模块清单读取失败：{exc}") from exc
    return ModuleManifest.from_dict(payload, expected_id=expected_id)


def download_archive(url: str, destination: Path) -> None:
    if urlparse(url).scheme.lower() != "https":
        raise ModuleUpdateError("模块下载地址必须使用 HTTPS")
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "SVNmate-Module-Updater"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            with destination.open("wb") as output:
                shutil.copyfileobj(response, output)
    except Exception as exc:
        destination.unlink(missing_ok=True)
        raise ModuleUpdateError(f"模块下载失败：{exc}") from exc


def verify_sha256(path: Path, expected: str) -> None:
    if not _SHA256_PATTERN.fullmatch(expected):
        raise ModuleUpdateError("期望的 SHA-256 无效")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual.casefold() != expected.casefold():
        raise ModuleUpdateError(
            f"模块 SHA-256 校验失败：期望 {expected}，实际 {actual}"
        )


def safe_extract_zip(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()
    try:
        with zipfile.ZipFile(archive) as handle:
            for info in handle.infolist():
                relative = PurePosixPath(info.filename.replace("\\", "/"))
                if relative.is_absolute() or ".." in relative.parts:
                    raise ModuleUpdateError(
                        f"模块压缩包包含不安全路径：{info.filename}"
                    )
                target = (destination / Path(*relative.parts)).resolve()
                if target != destination_root and destination_root not in target.parents:
                    raise ModuleUpdateError(
                        f"模块压缩包包含不安全路径：{info.filename}"
                    )
            handle.extractall(destination)
    except zipfile.BadZipFile as exc:
        raise ModuleUpdateError(f"模块压缩包无效：{exc}") from exc


def _powershell_literal(value: Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def build_replace_script(
    *,
    pid_to_wait: int,
    current_exe: Path,
    staged_exe: Path,
    backup_exe: Path,
    restart_exe: Path | None,
    current_version_file: Path | None = None,
    staged_version_file: Path | None = None,
) -> str:
    restart_literal = (
        _powershell_literal(restart_exe) if restart_exe is not None else "''"
    )
    current_version_literal = (
        _powershell_literal(current_version_file)
        if current_version_file is not None
        else "''"
    )
    staged_version_literal = (
        _powershell_literal(staged_version_file)
        if staged_version_file is not None
        else "''"
    )
    return f"""
$ErrorActionPreference = 'Stop'
$pidToWait = {int(pid_to_wait)}
$currentExe = {_powershell_literal(current_exe)}
$stagedExe = {_powershell_literal(staged_exe)}
$backupExe = {_powershell_literal(backup_exe)}
$restartExe = {restart_literal}
$currentVersionFile = {current_version_literal}
$stagedVersionFile = {staged_version_literal}

while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) {{
    Start-Sleep -Milliseconds 500
}}

try {{
    if (Test-Path -LiteralPath $currentExe) {{
        Copy-Item -LiteralPath $currentExe -Destination $backupExe -Force
    }}
    Copy-Item -LiteralPath $stagedExe -Destination $currentExe -Force
    if ($currentVersionFile -and $stagedVersionFile) {{
        Copy-Item -LiteralPath $stagedVersionFile -Destination $currentVersionFile -Force
    }}
    if ($restartExe) {{
        Start-Process -FilePath $restartExe
    }}
}} catch {{
    if (Test-Path -LiteralPath $backupExe) {{
        Copy-Item -LiteralPath $backupExe -Destination $currentExe -Force
    }}
    throw
}}
""".strip()
