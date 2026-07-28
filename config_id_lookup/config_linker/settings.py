import json
from dataclasses import dataclass
from pathlib import Path


DEFAULT_DATA_DIRECTORY = Path(r"C:\trunk\doc\csvdir")


@dataclass(frozen=True)
class AppSettings:
    data_directory: Path = DEFAULT_DATA_DIRECTORY


def load_settings(path: Path) -> tuple[AppSettings, str | None]:
    path = Path(path)
    if not path.is_file():
        return AppSettings(), None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return AppSettings(), f"配置文件读取失败，已使用默认目录：{exc}"

    value = data.get("data_directory") if isinstance(data, dict) else None
    if not isinstance(value, str) or not value.strip():
        return AppSettings(), "配置文件缺少有效的 data_directory，已使用默认目录"
    return AppSettings(Path(value.strip()).expanduser()), None


def save_settings(path: Path, settings: AppSettings) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = {"data_directory": str(settings.data_directory)}
    path.write_text(
        json.dumps(content, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
