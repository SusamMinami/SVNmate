from __future__ import annotations

import argparse
import ast
import csv
import json
import os
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path


REGISTRATION_PATTERN = re.compile(
    r"self:Add(ClientCmd|SceneCmd|MultiCmd|ClientAndLogicServerGM)\s*\("
)
COMMAND_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
LOG_COMMAND_PATTERN = re.compile(r"\bGM is\s+(?:gm:)?([^\s]+)", re.IGNORECASE)
SOURCE_BY_REGISTRATION = {
    "ClientCmd": "client",
    "SceneCmd": "scene",
    "MultiCmd": "client+scene",
    "ClientAndLogicServerGM": "client+logic",
}

SAFE_CANDIDATES = {
    "debugtaskinfo",
    "diagnoseinputcontrol",
    "getfubenlefttime",
    "getparam",
    "getrotation",
    "getsceneversion",
    "gettod",
    "getversion",
    "messagecurrentdatetime",
    "printbossattributes",
    "printcurrenttask",
    "printgamedebuginfo",
    "printlevelmanagermapinfo",
    "printmonsterattribute",
    "printpuppetinfo",
    "printselfbuff",
    "printuistack",
    "sceneonlinenum",
    "showlocation",
    "showmissiondialoginfo",
    "tasklistprint",
}
ARBITRARY_EXECUTION = {
    "calllua",
    "debug.eval",
    "execenginecmd",
    "runlua",
    "runluastring",
    "runscript",
}
DESTRUCTIVE_WORDS = (
    "crash",
    "deadloop",
    "delete",
    "destroy",
    "finish",
    "kill",
    "remove",
    "reset",
    "stopscene",
)
MUTATING_PREFIXES = (
    "add",
    "awake",
    "change",
    "clear",
    "close",
    "create",
    "disable",
    "enable",
    "enter",
    "force",
    "goto",
    "kick",
    "leave",
    "lock",
    "open",
    "pass",
    "release",
    "reload",
    "replace",
    "set",
    "skip",
    "spawn",
    "start",
    "switch",
    "teleport",
    "trans",
    "trigger",
    "unlock",
    "update",
)


@dataclass
class CommandRecord:
    name: str
    sources: set[str] = field(default_factory=set)
    gm_types: set[str] = field(default_factory=set)
    descriptions: set[str] = field(default_factory=set)
    arguments: set[str] = field(default_factory=set)
    locations: set[str] = field(default_factory=set)
    gm_level: str = ""
    gm_level_description: str = ""

    @property
    def risk(self) -> str:
        lowered = self.name.casefold()
        if lowered in ARBITRARY_EXECUTION:
            return "arbitrary-execution"
        if lowered in SAFE_CANDIDATES:
            return "read-only-candidate"
        if any(word in lowered for word in DESTRUCTIVE_WORDS):
            return "destructive"
        if lowered.startswith(MUTATING_PREFIXES):
            return "mutating"
        return "review-required"


def _mask_lua_comments(text: str) -> str:
    result = list(text)
    index = 0
    quote = ""
    while index < len(text):
        char = text[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = ""
            index += 1
            continue
        if char in {'"', "'"}:
            quote = char
            index += 1
            continue
        if text.startswith("--[[", index):
            end = text.find("]]", index + 4)
            end = len(text) if end < 0 else end + 2
            for offset in range(index, end):
                if result[offset] not in "\r\n":
                    result[offset] = " "
            index = end
            continue
        if text.startswith("--", index):
            end = text.find("\n", index + 2)
            end = len(text) if end < 0 else end
            for offset in range(index, end):
                if result[offset] != "\r":
                    result[offset] = " "
            index = end
            continue
        index += 1
    return "".join(result)


def _find_call_end(text: str, open_index: int) -> int:
    depth = 0
    quote = ""
    index = open_index
    while index < len(text):
        char = text[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = ""
            index += 1
            continue
        if char in {'"', "'"}:
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    raise ValueError(f"Unclosed Lua call at character {open_index}")


def _split_lua_arguments(value: str) -> list[str]:
    arguments: list[str] = []
    start = 0
    quote = ""
    depths = {"(": 0, "[": 0, "{": 0}
    matching = {")": "(", "]": "[", "}": "{"}
    index = 0
    while index < len(value):
        char = value[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = ""
            index += 1
            continue
        if char in {'"', "'"}:
            quote = char
        elif char in depths:
            depths[char] += 1
        elif char in matching:
            depths[matching[char]] -= 1
        elif char == "," and all(depth == 0 for depth in depths.values()):
            arguments.append(value[start:index].strip())
            start = index + 1
        index += 1
    arguments.append(value[start:].strip())
    return arguments


def _lua_string(value: str) -> str:
    value = value.strip()
    if len(value) < 2 or value[0] not in {'"', "'"} or value[-1] != value[0]:
        return ""
    try:
        decoded = ast.literal_eval(value)
    except (SyntaxError, ValueError):
        decoded = value[1:-1]
    return decoded if isinstance(decoded, str) else ""


def _record_for(
    records: dict[str, CommandRecord],
    name: str,
) -> CommandRecord:
    key = name.casefold()
    record = records.get(key)
    if record is None:
        record = CommandRecord(name=name)
        records[key] = record
    return record


def collect_registered_commands(
    path: Path,
    records: dict[str, CommandRecord],
) -> None:
    original = path.read_text(encoding="utf-8")
    masked = _mask_lua_comments(original)
    for match in REGISTRATION_PATTERN.finditer(masked):
        call_end = _find_call_end(masked, match.end() - 1)
        arguments = _split_lua_arguments(
            original[match.end():call_end]
        )
        if not arguments:
            continue
        name = _lua_string(arguments[0])
        if not COMMAND_NAME_PATTERN.fullmatch(name):
            continue
        record = _record_for(records, name)
        record.sources.add(SOURCE_BY_REGISTRATION[match.group(1)])
        if len(arguments) > 1 and "." in arguments[1]:
            record.gm_types.add(arguments[1].rsplit(".", 1)[-1])
        if len(arguments) > 3:
            description = _lua_string(arguments[3])
            if description:
                record.descriptions.add(description)
        for argument in arguments[5:]:
            parameter = _lua_string(argument)
            if parameter:
                record.arguments.add(parameter)
        line = original.count("\n", 0, match.start()) + 1
        record.locations.add(f"{path.name}:{line}")


def collect_level_table(
    path: Path,
    records: dict[str, CommandRecord],
) -> None:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.reader(handle):
            if len(row) < 4 or row[0].startswith("##"):
                continue
            name = row[1].strip()
            if not COMMAND_NAME_PATTERN.fullmatch(name):
                continue
            record = _record_for(records, name)
            record.sources.add("gm-level-table")
            record.gm_level_description = row[2].strip()
            record.gm_level = row[3].strip()
            record.locations.add(path.name)


def collect_composite_references(
    path: Path,
    records: dict[str, CommandRecord],
) -> None:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for line_number, row in enumerate(csv.reader(handle), start=1):
            for cell in row[2:]:
                command_text = cell.strip()
                if not command_text or command_text in {"{", "}"}:
                    continue
                name = command_text.split(maxsplit=1)[0]
                if not COMMAND_NAME_PATTERN.fullmatch(name):
                    continue
                record = _record_for(records, name)
                record.sources.add("composite-reference")
                record.locations.add(f"{path.name}:{line_number}")


def collect_executed_commands(
    logs_root: Path,
    records: dict[str, CommandRecord],
) -> None:
    if not logs_root.is_dir():
        return
    for path in logs_root.glob("*.log*"):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for match in LOG_COMMAND_PATTERN.finditer(text):
            name = match.group(1).strip()
            if not COMMAND_NAME_PATTERN.fullmatch(name):
                continue
            record = _record_for(records, name)
            record.sources.add("executed-log")
            record.locations.add(path.name)


def _joined(values: set[str]) -> str:
    return " | ".join(sorted(values, key=str.casefold))


def write_csv(path: Path, records: list[CommandRecord]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "command",
                "risk",
                "sources",
                "gm_types",
                "description",
                "arguments",
                "gm_level",
                "gm_level_description",
                "locations",
            ]
        )
        for record in records:
            writer.writerow(
                [
                    record.name,
                    record.risk,
                    _joined(record.sources),
                    _joined(record.gm_types),
                    _joined(record.descriptions),
                    _joined(record.arguments),
                    record.gm_level,
                    record.gm_level_description,
                    _joined(record.locations),
                ]
            )


def write_json(path: Path, records: list[CommandRecord]) -> None:
    payload = [
        {
            "command": record.name,
            "risk": record.risk,
            "sources": sorted(record.sources),
            "gm_types": sorted(record.gm_types),
            "descriptions": sorted(record.descriptions),
            "arguments": sorted(record.arguments),
            "gm_level": record.gm_level,
            "gm_level_description": record.gm_level_description,
            "locations": sorted(record.locations),
        }
        for record in records
    ]
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_summary(path: Path, records: list[CommandRecord]) -> None:
    risk_counts = Counter(record.risk for record in records)
    source_counts = Counter(
        source
        for record in records
        for source in record.sources
    )
    safe = [
        record
        for record in records
        if record.risk == "read-only-candidate"
    ]
    observed = [
        record
        for record in records
        if "executed-log" in record.sources
    ]
    lines = [
        "# GM command collection",
        "",
        f"- Unique command names: {len(records)}",
        f"- Static client/scene registrations: "
        f"{sum('client' in r.sources or 'scene' in r.sources or 'client+scene' in r.sources or 'client+logic' in r.sources for r in records)}",
        f"- GM level table entries: {source_counts['gm-level-table']}",
        f"- Composite-list references: {source_counts['composite-reference']}",
        f"- Commands observed in local logs: {source_counts['executed-log']}",
        "",
        "## Risk counts",
        "",
    ]
    for risk, count in sorted(risk_counts.items()):
        lines.append(f"- {risk}: {count}")
    lines.extend(
        [
            "",
            "## Read-only candidates",
            "",
            "| Command | Source | Description |",
            "| --- | --- | --- |",
        ]
    )
    for record in safe:
        description = _joined(record.descriptions) or record.gm_level_description
        sources = ", ".join(sorted(record.sources, key=str.casefold))
        lines.append(
            f"| `{record.name}` | {sources} | "
            f"{description.replace('|', '/')} |"
        )
    lines.extend(
        [
            "",
            "## Observed commands",
            "",
            ", ".join(f"`{record.name}`" for record in observed) or "None",
            "",
            "## Coverage boundary",
            "",
            "Logic-server commands are sent at runtime in `SGMCommandList` and are "
            "filtered by the account GM level. They are not fully recoverable "
            "from a static checkout. The catalog therefore distinguishes "
            "registered commands, configuration references, and commands "
            "actually observed in local logs.",
            "",
            "Risk labels are conservative triage, not authorization. Any "
            "automatic execution surface should use an explicit fixed-command "
            "allowlist and must not expose `RunLuaString`, engine execution, "
            "or arbitrary text submission.",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Collect Seria GM command evidence without changing trunk."
    )
    parser.add_argument(
        "--trunk",
        type=Path,
        default=Path(os.environ.get("SERIA_TRUNK", r"C:\trunk")),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / ".generated",
    )
    args = parser.parse_args()

    script_root = (
        args.trunk / "res" / "Content" / "Seria" / "Script"
    )
    gm_root = script_root / "UI" / "GM"
    client_path = gm_root / "GMManagerClient.lua"
    base_path = gm_root / "GMManagerBase.lua"
    level_path = args.trunk / "doc" / "csvdir" / "gm指令分级表.csv"
    composite_path = args.trunk / "doc" / "csvdir" / "gmlist.csv"
    logs_root = (
        args.trunk
        / "bin"
        / "WindowsNoEditor"
        / "Client"
        / "Seria"
        / "Saved"
        / "Logs"
    )
    required = [client_path, base_path, level_path, composite_path]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        parser.error("missing source files: " + ", ".join(missing))

    records: dict[str, CommandRecord] = {}
    collect_registered_commands(client_path, records)
    collect_registered_commands(base_path, records)
    collect_level_table(level_path, records)
    collect_composite_references(composite_path, records)
    collect_executed_commands(logs_root, records)
    sorted_records = sorted(records.values(), key=lambda item: item.name.casefold())

    args.output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = args.output_dir / "gm-command-catalog.csv"
    json_path = args.output_dir / "gm-command-catalog.json"
    summary_path = args.output_dir / "gm-command-summary.md"
    write_csv(csv_path, sorted_records)
    write_json(json_path, sorted_records)
    write_summary(summary_path, sorted_records)

    print(f"Collected {len(sorted_records)} unique GM command names.")
    print(csv_path)
    print(json_path)
    print(summary_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
