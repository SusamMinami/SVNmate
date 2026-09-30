import copy
import math
import re
import secrets
import threading
import time

from .catalog import BOOLEAN, EDITABLE, INTEGER, RELATIONS, TABLES
from .repository import Repository, inspect_workbook
from .authoring import bundle, search, clone_bundle, validate_operations, prepare_operations
from .authoring_schema import GROUPS


class Service:
    def __init__(self, writer=None):
        self.repo = None
        self.lock = threading.RLock()
        self.reviews = {}
        self.writer = writer

    def load(self, doc):
        # Construct fully before replacing current state.
        repo = Repository(doc)
        with self.lock:
            self.repo = repo
            self.reviews.clear()
            return self.summary()

    def summary(self):
        if not self.repo:
            return {"loaded": False}
        return {"loaded": True, "doc": str(self.repo.doc), "snapshot": self.repo.snapshot,
                "careers": self.repo.list_careers(), "missing": self.repo.missing,
                "tables": [{"key": k, "file": spec[0], "className": spec[1], "title": spec[2],
                            "rows": len(self.repo.tables[k].rows) if k in self.repo.tables else None,
                            "editable": k in EDITABLE or k in GROUPS} for k, spec in TABLES.items()],
                "relations": RELATIONS}

    def require_repo(self):
        if not self.repo:
            raise ValueError("请先读取数据目录")
        return self.repo

    def detail(self, career_id):
        with self.lock:
            return self.require_repo().detail(career_id)

    def authoring(self, request):
        with self.lock:
            repo = self.require_repo()
            if request.get("action") == "search":
                return {"results": search(repo, request.get("table"), str(request.get("query", "")))}
            if request.get("action") == "clone":
                return {"records": clone_bundle(repo, request)}
            return {"records": bundle(repo, request.get("table"), request.get("sourceId", ""))}

    def validate(self, request, new_skills=()):
        repo = self.require_repo()
        source_id = str(request.get("sourceId", ""))
        target_id = str(request.get("targetId", source_id))
        if not re.fullmatch(r"[1-9]\d{0,8}", target_id):
            raise ValueError("职业 ID 必须是 1–9 位正整数")
        detail = repo.detail(source_id)
        clone = target_id != source_id
        if clone and target_id in repo.tables["career"].index:
            raise ValueError("新职业 ID 已存在")
        allowed = {s["key"]: {f["name"]: f for f in s["fields"]} for s in detail["sections"]}
        edits = request.get("edits", {})
        if not isinstance(edits, dict):
            raise ValueError("草稿格式错误")
        for table_key, fields in edits.items():
            if table_key not in allowed or not isinstance(fields, dict):
                raise ValueError("不支持的编辑表")
            for name, values in fields.items():
                field = allowed[table_key].get(name)
                if not field or not isinstance(values, list) or len(values) != len(field["values"]):
                    raise ValueError(f"字段或数组宽度不匹配：{name}")
                if any(not isinstance(v, str) or len(v) > 8000 for v in values):
                    raise ValueError(f"字段内容过长或类型错误：{name}")
                if values == field["values"]:
                    continue
                value = values[0]
                if name == "name" and not value.strip():
                    raise ValueError("职业名称不能为空")
                if name in BOOLEAN and value not in {"0", "1"}:
                    raise ValueError(f"{field['label']} 必须为 0 或 1")
                if name in INTEGER and not re.fullmatch(r"\d+", value):
                    raise ValueError(f"{field['label']} 必须为非负整数")
                if table_key == "growth":
                    try:
                        valid = math.isfinite(float(value)) and float(value) >= 0
                    except ValueError:
                        valid = False
                    if not valid:
                        raise ValueError(f"{field['label']} 必须为非负有限数")
                if name in {"bp", "attack"} and (not value or "\\" in value or ".." in value):
                    raise ValueError(f"{name} 需要有效的正斜杠资源路径")
                if name == "initial_skill":
                    if values[0] != "{" or values[-1] != "}":
                        raise ValueError("初始技能数组边界不能修改")
                    for slot in values[1:-1]:
                        if not slot:
                            continue
                        match = re.fullmatch(r"([1-9]\d*);([1-9]\d*)", slot)
                        if not match:
                            raise ValueError("初始技能格式为 技能ID;等级，空槽留空")
                        skills = repo.tables.get("skill")
                        if match[1] not in new_skills and (not skills or len(skills.index.get(match[1], [])) != 1):
                            raise ValueError(f"技能 {match[1]} 缺失或不唯一")
                if name == "initialattr" and value:
                    attrs = repo.tables.get("attr")
                    for item in value.split(","):
                        pair = item.split(";")
                        if len(pair) != 2 or not pair[0].isdigit() or not pair[1]:
                            raise ValueError("初始属性格式为 属性ID;值，多项用英文逗号分隔")
                        if not attrs or pair[0] not in attrs.index:
                            raise ValueError(f"属性 {pair[0]} 不存在")
        return source_id, target_id, copy.deepcopy(edits), detail

    def prepare(self, request):
        with self.lock:
            repo = self.require_repo()
            operations = validate_operations(repo, request.get("operations", []))
            new_skills = {o["targetId"] for o in operations if o["table"] == "skill" and o["sourceId"] != o["targetId"]}
            source_id, target_id, edits, detail = self.validate(request, new_skills)
            mode = request.get("mode", "copy")
            if mode not in {"copy", "source"}:
                raise ValueError("未知写入目标")
            clone = source_id != target_id
            plans = []
            cache = {}
            for section in detail["sections"]:
                key = section["key"]
                changes = {n: v for n, v in edits.get(key, {}).items()
                           if v != next(f["values"] for f in section["fields"] if f["name"] == n)}
                if not changes and not clone:
                    continue
                plan = inspect_workbook(repo.workbook(key), repo.tables[key],
                                        source_id, target_id, changes, cache)
                plan["table"] = key
                plans.append(plan)
            plans.extend(prepare_operations(repo, operations, cache))
            if not plans:
                raise ValueError("当前职业没有待写入修改")
            token = secrets.token_urlsafe(24)
            self.reviews = {k: v for k, v in self.reviews.items() if v["expires"] > time.time()}
            self.reviews[token] = {"plans": plans, "mode": mode, "expires": time.time() + 600}
            return {"token": token, "mode": mode, "clone": clone,
                    "plans": [{k: v for k, v in p.items() if k not in {"baseline", "headers", "fingerprint"}}
                              for p in plans],
                    "warnings": ["资源路径仅做格式检查；UE 资产、公式与运行时尚未验证。",
                                 "技能 / Buff 可被多个职业共用，修改已有记录会影响所有引用方；复制只重映射技能执行、技能树指向和等级 ID，其余引用仍复用模板。"] +
                    (["复制四表中已有记录；创角展示、技能、外观与 UE 资产仍复用模板。新 ID 不代表可玩职业。"]
                     if clone else [])}

    def commit(self, token):
        with self.lock:
            review = self.reviews.pop(token, None)  # One shot, including failed attempts.
            if not review or review["expires"] < time.time():
                raise ValueError("审核已失效，请重新检查差异")
            if self.writer is None:
                from .excel import apply_plan
                writer = apply_plan
            else:
                writer = self.writer
            return writer(review["plans"], review["mode"])
