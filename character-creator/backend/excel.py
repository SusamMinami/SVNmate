"""Visible, unsaved Excel edits. No VBA, export, save, or CSV mutation."""
from contextlib import contextmanager
from pathlib import Path
import os
import shutil
import tempfile
import threading

from .repository import fingerprint, member, text

_mutex = threading.Lock()


@contextmanager
def excel_lock():
    # Shared with the sandbox's registration adapter. Never evict another owner.
    path = Path(tempfile.gettempdir()) / "shot-sandbox-excel-registration.lock"
    with _mutex:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise ValueError("Excel 正被其他配置任务使用；任务结束后重新审核")
        try:
            yield
        finally:
            os.close(fd)
            path.unlink(missing_ok=True)


def apply_plan(plans, mode):
    if mode not in {"copy", "source"}:
        raise ValueError("未知写入模式")
    import pythoncom
    import win32com.client
    with excel_lock():
        pythoncom.CoInitializeEx(pythoncom.COINIT_APARTMENTTHREADED)
        app = None
        settings = {}
        applied = []
        prepared = []
        output = []
        try:
            for plan in plans:
                if fingerprint(plan["path"]) != plan["fingerprint"]:
                    raise ValueError("工作簿在审核后已变化，请重新审核")
            try:
                app = win32com.client.GetActiveObject("Excel.Application")
            except Exception:
                app = win32com.client.DispatchEx("Excel.Application")
            for key in ("AutomationSecurity", "EnableEvents", "DisplayAlerts"):
                settings[key] = getattr(app, key)
            app.AutomationSecurity = 3  # Force-disable macros on open.
            app.EnableEvents = False
            app.DisplayAlerts = False
            app.Visible = True
            copy_root = Path(tempfile.mkdtemp(prefix="character-creator-")) if mode == "copy" else None
            copies = {}
            next_rows = {}
            targets = set()
            # Entire batch preflight before the first cell mutation.
            for plan in plans:
                identity = (plan["path"], plan["sheet"], plan["targetId"])
                if identity in targets:
                    raise ValueError("批次中存在重复目标行")
                targets.add(identity)
                path = Path(plan["path"])
                if copy_root:
                    if str(path) not in copies:
                        destination = copy_root / f"{len(copies)}_{path.stem}_{copy_root.name[-8:]}{path.suffix}"
                        shutil.copy2(path, destination)
                        copies[str(path)] = destination
                    path = copies[str(path)]
                book = next((b for b in app.Workbooks
                             if os.path.normcase(b.FullName) == os.path.normcase(str(path))), None)
                if book is None:
                    if any(b.Name.casefold() == path.name.casefold() for b in app.Workbooks):
                        raise ValueError(f"Excel 已打开另一路径下的同名文件 {path.name}，请先关闭该同名文件")
                    book = app.Workbooks.Open(str(path), UpdateLinks=0, ReadOnly=False,
                                              IgnoreReadOnlyRecommended=True, AddToMru=False)
                if book is None:
                    raise ValueError(f"Excel 未能打开 {path.name}，请检查文件占用与会话提示")
                if book.ReadOnly:
                    raise ValueError(f"{path.name} 为只读或被另一个 Excel 实例占用")
                sheet = book.Worksheets(plan["sheet"])
                if sheet.ProtectContents:
                    raise ValueError(f"{path.name} 工作表受保护")
                width = len(plan["headers"])
                headers = [member(v) for v in sheet.Range(sheet.Cells(1, 1), sheet.Cells(1, width)).Value2[0]]
                if headers != plan["headers"]:
                    raise ValueError(f"{path.name} 的打开会话表头已变化")
                baseline = [text(v) for v in sheet.Range(
                    sheet.Cells(plan["row"], 1), sheet.Cells(plan["row"], width)).Formula[0]]
                if baseline != plan["baseline"]:
                    raise ValueError(f"{path.name} 原行在 Excel 中有未保存改动，请先处理")
                last = sheet.UsedRange.Row + sheet.UsedRange.Rows.Count - 1
                ids = sheet.Range(sheet.Cells(3, plan["idColumn"]),
                                  sheet.Cells(max(3, last), plan["idColumn"])).Value2
                ids = [text(r[0]) for r in ids] if isinstance(ids, tuple) else [text(ids)]
                if ids.count(plan["sourceId"]) != 1:
                    raise ValueError(f"{path.name} 源 ID 不唯一")
                if plan["clone"] and plan["targetId"] in ids:
                    raise ValueError(f"{path.name} 新 ID 已被占用")
                sheet_key = (str(path), plan["sheet"])
                row = next_rows.get(sheet_key, last + 1) if plan["clone"] else plan["row"]
                if plan["clone"]:
                    next_rows[sheet_key] = row + 1
                prepared.append((plan, sheet, row))
                if str(path) not in output:
                    output.append(str(path))
            # Clone all source rows before any edits to a source row in this batch.
            for plan, sheet, row in prepared:
                if plan["clone"]:
                    applied.append(("row", sheet, row, None, None))
                    sheet.Rows(plan["row"]).Copy(Destination=sheet.Rows(row))
            for plan, sheet, row in prepared:
                if plan["clone"]:
                    cell = sheet.Cells(row, plan["idColumn"])
                    cell.Value2 = int(plan["targetId"])
                    cell.Font.Color = 255
                for change in plan["changes"]:
                    cell = sheet.Cells(row, change["column"])
                    applied.append(("cell", cell, cell.Formula, cell.Font.Color, cell.NumberFormat))
                    value = change["after"]
                    # Preserve scalar numeric types. Other strings are literal text, never formulas.
                    if isinstance(cell.Value2, (int, float)) and value:
                        try:
                            numeric = float(value)
                            if text(numeric) == value:
                                cell.Value2 = numeric
                            else:
                                cell.NumberFormat = "@"
                                cell.Value2 = value
                        except ValueError:
                            cell.NumberFormat = "@"
                            cell.Value2 = value
                    else:
                        cell.NumberFormat = "@"
                        cell.Value2 = value
                    cell.Font.Color = 255
                    if text(cell.Value2) != value:
                        raise ValueError(f"{change['member']} 回读不一致")
                if text(sheet.Cells(row, plan["idColumn"]).Value2) != plan["targetId"]:
                    raise ValueError("职业 ID 回读不一致")
            app.CutCopyMode = False
            return {"status": "written", "paths": output, "mode": mode,
                    "message": "已写入 Excel，修改标红，工作簿保持未保存。请人工检查后保存、导表。"}
        except Exception as exc:
            failures = []
            for kind, target, old, color, number_format in reversed(applied):
                try:
                    if kind == "row":
                        target.Rows(old).Delete()
                    else:
                        target.NumberFormat = number_format
                        target.Formula = old
                        target.Font.Color = color
                        if text(target.Formula) != text(old):
                            failures.append("回读失败")
                except Exception:
                    failures.append("恢复失败")
            suffix = ("；恢复存在未知状态，请检查 Excel，勿重复写入" if failures else
                      "；已尝试恢复本次改动，请检查 Excel" if applied else "；未修改单元格")
            raise ValueError(str(exc) + suffix) from exc
        finally:
            if app is not None:
                for key, value in settings.items():
                    try:
                        setattr(app, key, value)
                    except Exception:
                        pass
            pythoncom.CoUninitialize()
