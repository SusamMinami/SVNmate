import json
from dataclasses import dataclass
from pathlib import Path


DEFAULT_DOC_DIRECTORY = Path(r"C:\trunk\doc")


@dataclass(frozen=True)
class AppSettings:
    doc_directory: Path = DEFAULT_DOC_DIRECTORY


def normalize_doc_directory(selected: Path) -> Path:
    selected = Path(selected).expanduser()
    if selected.name.casefold() == "csvdir":
        return selected.parent
    return selected


def csv_directory(settings: AppSettings) -> Path:
    return settings.doc_directory / "csvdir"


def load_settings(path: Path) -> tuple[AppSettings, str | None]:
    path = Path(path)
    if not path.is_file():
        return AppSettings(), None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return AppSettings(), f"配置文件读取失败，已使用默认目录：{exc}"

    value = data.get("doc_directory") if isinstance(data, dict) else None
    if not isinstance(value, str) or not value.strip():
        value = data.get("data_directory") if isinstance(data, dict) else None
    if not isinstance(value, str) or not value.strip():
        return AppSettings(), "配置文件缺少有效的 doc_directory，已使用默认目录"
    return AppSettings(normalize_doc_directory(Path(value.strip()))), None


def save_settings(path: Path, settings: AppSettings) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = {"doc_directory": str(settings.doc_directory)}
    path.write_text(
        json.dumps(content, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
