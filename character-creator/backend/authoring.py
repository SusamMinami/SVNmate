"""Typed table modules and explicit multi-row drafts; no UE mutations."""
import copy
import re

from .authoring_schema import GROUPS, REFERENCES, NONNEGATIVE, ARRAYS, INTEGERS, CHOICES
from .catalog import TABLES
from .repository import inspect_workbook


def positive_id(value, table):
    value = str(value)
    limit = 2**63 - 1 if table == "damage" else 2**31 - 1
    if not re.fullmatch(r"[1-9]\d{0,18}", value) or int(value) > limit:
        raise ValueError(f"{TABLES[table][2]} ID 必须为有效正整数")
    return value


def record(repo, key, identity):
    if key not in GROUPS or key not in repo.tables:
        raise ValueError("不支持或缺失的配置模块")
    table = repo.tables[key]
    row = table.row(identity)
    groups = []
    for title, members in GROUPS[key].items():
        fields = []
        for full in members.split():
            if full not in table.headers:
                continue
            positions = table.positions(full)
            fields.append({"name": full, "member": full,
                           "label": table.labels[positions[0]].lstrip("#") or full,
                           "values": [row[p] for p in positions],
                           "labels": [table.labels[p] for p in positions],
                           "choices": CHOICES.get(full)})
        if fields:
            groups.append({"title": title, "fields": fields})
    return {"table": key, "sourceId": str(identity), "targetId": str(identity),
            "title": TABLES[key][2], "groups": groups, "edits": {}}


def bundle(repo, key, identity):
    result = [record(repo, key, identity)]
    if key == "skill":
        tree, upgrade = repo.tables.get("tree"), repo.tables.get("upgrade")
        if tree:
            result += [record(repo, "tree", r[0]) for r in tree.rows
                       if tree.get(r, "skillid") == str(identity)]
        if upgrade:
            result += [record(repo, "upgrade", r[0]) for r in upgrade.rows
                       if r[0].isdigit() and int(r[0]) // 1000 == int(identity)]
    return result


def search(repo, key, query):
    if key not in GROUPS or key not in repo.tables:
        return []
    table = repo.tables[key]
    fields = {"skill": "skillname", "tree": "skillname", "buff": "name"}
    found = []
    for row in table.rows:
        label = table.get(row, fields.get(key, "")) or (row[1] if len(row) > 1 else "")
        if query.lower() in f"{row[0]} {label}".lower():
            found.append({"id": row[0], "name": label[:100]})
            if len(found) == 60:
                break
    return found


def clone_bundle(repo, request):
    key, source = request.get("table"), str(request.get("sourceId", ""))
    if key not in GROUPS:
        raise ValueError("未知配置模块")
    target = positive_id(request.get("targetId", ""), key)
    if source == target or target in repo.tables[key].index:
        raise ValueError("新 ID 已存在或与模板相同")
    result = bundle(repo, key, source)
    tree_ids = request.get("treeIds", {})
    for item in result:
        if item["table"] == key:
            item["targetId"] = target
            if key == "skill":
                career = str(request.get("careerId", ""))
                repo.tables["career"].row(career)
                item["edits"]["Skill.career"] = [career]
        elif item["table"] == "tree":
            item["targetId"] = positive_id(tree_ids.get(item["sourceId"], ""), "tree")
            item["edits"]["Skillsystem.skillid"] = [target]
        elif item["table"] == "upgrade":
            item["targetId"] = positive_id(int(target) * 1000 + int(item["sourceId"]) % 1000, "upgrade")
        if item["targetId"] in repo.tables[item["table"]].index:
            raise ValueError(f"{item['title']} ID {item['targetId']} 已存在")
    return result


def reference_ids(full, values):
    if full == "Skilldamage.skillbuff":
        return "buff", [v for v in values[1:-1:4] if v not in {"", "0", "-1"}]
    if full == "Aura.buffinfo":
        refs = []
        for v in values[1:-1]:
            if not v:
                continue
            if not re.fullmatch(r"[1-9]\d*;[-+]?\d+", v):
                raise ValueError("光环 Buff 槽位格式为 BuffID;参数")
            refs.append(v.split(";")[0])
        return "buff", refs
    if full not in REFERENCES:
        return "", []
    target, shape = REFERENCES[full]
    value = values[0].strip()
    if not value or re.fullmatch(r"-?\d+", value) and int(value) <= 0:
        return target, []
    if shape == "pairs":
        if not re.fullmatch(r"\d+;\d+(,\d+;\d+)*", value):
            raise ValueError(f"{full} 格式为 旧技能ID;新技能ID，多组用逗号分隔")
        refs = re.split("[;,]", value)
    elif shape == "stacks":
        if not re.fullmatch(r"\d+(,\d+)?(;\d+(,\d+)?)*", value):
            raise ValueError("后继 Buff 格式为 ID 或 ID,层数，多组用分号分隔")
        refs = [v.split(",")[0] for v in value.split(";")]
    elif shape == "levels":
        if not re.fullmatch(r"\d+:\d+(;\d+:\d+)*", value):
            raise ValueError("触发技能格式为 技能ID:等级，多组用分号分隔")
        refs = [v.split(":")[0] for v in value.split(";")]
    else:
        pattern = r"\d+" if shape == "one" else r"\d+(;\d+)*"
        if not re.fullmatch(pattern, value):
            raise ValueError(f"{full} 需要{'单个 ID' if shape == 'one' else '分号分隔的 ID'}")
        refs = value.split(";")
    return target, [v for v in refs if int(v) > 0]


def validate_operations(repo, operations):
    if not isinstance(operations, list) or len(operations) > 200:
        raise ValueError("每批最多 200 条配置记录")
    result, occupied = [], set()
    for operation in operations:
        if not isinstance(operation, dict):
            raise ValueError("配置草稿格式错误")
        key = operation.get("table")
        if key not in GROUPS:
            raise ValueError("未知配置表")
        source = positive_id(operation.get("sourceId", ""), key)
        target = positive_id(operation.get("targetId", source), key)
        original = record(repo, key, source)
        if (key, target) in occupied:
            raise ValueError(f"同一批次重复目标：{key} {target}")
        occupied.add((key, target))
        if target != source and target in repo.tables[key].index:
            raise ValueError(f"{key} 新 ID {target} 已存在")
        fields = {f["name"]: f for g in original["groups"] for f in g["fields"]}
        edits = operation.get("edits", {})
        if not isinstance(edits, dict):
            raise ValueError("字段编辑格式错误")
        for full, values in edits.items():
            if full not in fields or not isinstance(values, list) or len(values) != len(fields[full]["values"]):
                raise ValueError(f"字段或数组宽度不匹配：{full}")
            if any(not isinstance(v, str) or len(v) > 8000 or "\x00" in v for v in values):
                raise ValueError(f"字段内容类型错误或过长：{full}")
            if full in ARRAYS and (values[0] != "{" or values[-1] != "}"):
                raise ValueError(f"不能修改数组边界：{full}")
            if values == fields[full]["values"]:
                continue
            if full in INTEGERS and values[0] and (not re.fullmatch(r"-?\d+", values[0]) or
                                                   not -(2**31) <= int(values[0]) < 2**31):
                raise ValueError(f"{full} 必须为 32 位整数")
            if full in NONNEGATIVE and not re.fullmatch(r"\d+", values[0]):
                raise ValueError(f"{full} 必须为非负整数")
            if full in CHOICES and values[0].casefold() not in {v.casefold() for v in CHOICES[full]}:
                raise ValueError(f"{full} 请选择已定义的选项")
            if "skillgameplay" in full and (not values[0] or "\\" in values[0] or ".." in values[0]):
                raise ValueError("Ability 需要有效的正斜杠资源路径")
        result.append({**original, "targetId": target, "edits": copy.deepcopy(edits)})
    new_ids = {(o["table"], o["targetId"]) for o in result if o["targetId"] != o["sourceId"]}
    for operation in result:
        for full, values in operation["edits"].items():
            field = next(f for g in operation["groups"] for f in g["fields"] if f["name"] == full)
            if values == field["values"]:
                continue
            target, ids = reference_ids(full, values)
            for identity in ids:
                table = repo.tables.get(target)
                if (target, identity) not in new_ids and (not table or len(table.index.get(identity, [])) != 1):
                    raise ValueError(f"{full} 引用 {target} {identity} 缺失或不唯一")
    # A new execution skill must bring its existing tree and level rows along.
    for operation in result:
        if operation["table"] != "skill" or operation["sourceId"] == operation["targetId"]:
            continue
        for related in bundle(repo, "skill", operation["sourceId"])[1:]:
            matches = [o for o in result if o["table"] == related["table"] and o["sourceId"] == related["sourceId"]
                       and o["targetId"] != o["sourceId"]]
            if len(matches) != 1:
                raise ValueError("新技能必须同时复制模板的全部技能树与升级记录")
            item = matches[0]
            if item["table"] == "tree" and item["edits"].get("Skillsystem.skillid") != [operation["targetId"]]:
                raise ValueError("新技能树必须指向新技能 ID")
            if item["table"] == "upgrade" and int(item["targetId"]) != int(operation["targetId"]) * 1000 + int(item["sourceId"]) % 1000:
                raise ValueError("升级 ID 必须为 新技能ID × 1000 + 等级")
    return result


def prepare_operations(repo, operations, cache):
    plans = []
    for operation in operations:
        changes = {n: v for n, v in operation["edits"].items()
                   if v != next(f["values"] for g in operation["groups"] for f in g["fields"] if f["name"] == n)}
        if not changes and operation["sourceId"] == operation["targetId"]:
            continue
        key = operation["table"]
        plan = inspect_workbook(repo.workbook(key), repo.tables[key], operation["sourceId"],
                                operation["targetId"], changes, cache)
        plan["table"] = key
        plans.append(plan)
    return plans
