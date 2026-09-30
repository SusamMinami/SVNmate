"""Opt-in real COM integration using only generated synthetic xlsx files."""
import sys
from pathlib import Path
import tempfile
from concurrent.futures import ThreadPoolExecutor

import pythoncom
import win32com.client

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.authoring import bundle, clone_bundle
from backend.excel import apply_plan
from backend.repository import fingerprint
from backend.service import Service
from test_authoring import authoring_fixture


def main():
    if "--run" not in sys.argv:
        raise SystemExit("Use --run for synthetic Excel integration.")
    opened = []
    pythoncom.CoInitialize()
    try:
        with tempfile.TemporaryDirectory(prefix="character-authoring-synthetic-") as tmp:
            root = Path(tmp)
            authoring_fixture(root)
            hashes = {p: fingerprint(p) for p in (root / "xlsdir").glob("*.xlsx")}
            def writer(plans, mode):
                with ThreadPoolExecutor(max_workers=1) as pool:
                    return pool.submit(apply_plan, plans, mode).result()
            service = Service(writer)
            service.load(root)
            operations = clone_bundle(service.repo, {
                "table": "skill", "sourceId": "100001", "targetId": "100002",
                "careerId": "100", "treeIds": {"1000001": "1000002"},
            })
            old_level = bundle(service.repo, "upgrade", "100001001")[0]
            old_level["edits"] = {"Skillupgrade.needsp": ["9"]}
            operations.append(old_level)
            buff = bundle(service.repo, "buff", "100001")[0]
            buff["targetId"] = "100002"
            buff["edits"] = {"Buffbase.name": ["合成新Buff"], "Buff.behavior": ["1"]}
            operations.append(buff)
            review = service.prepare({"sourceId": "100", "operations": operations, "mode": "copy"})
            result = service.commit(review["token"])
            opened.extend(result["paths"])
            assert len(opened) == 4, "Same workbook copied more than once"
            app = win32com.client.GetActiveObject("Excel.Application")
            books = [b for b in app.Workbooks if str(b.FullName) in opened]
            levels = next(b for b in books if "j技能升级消耗表" in b.Name)
            sheet = levels.Worksheets(1)
            assert [int(sheet.Cells(i, 2).Value2) for i in range(3, 7)] == [
                100001001, 100001002, 100002001, 100002002]
            assert str(sheet.Cells(3, 3).Value2) in {"9", "9.0"}
            assert str(sheet.Cells(5, 3).Value2) == "1", "Clone inherited another operation's edit"
            assert str(sheet.Cells(6, 3).Value2) == "2"
            assert sheet.Cells(5, 8).Formula == "=1+1"
            assert sheet.Cells(6, 8).Formula == "=1+1"
            assert sheet.Cells(5, 2).Font.Color == 255
            buffs = next(b for b in books if "buff表" in b.Name)
            assert buffs.Worksheets(1).Cells(4, 3).Value2 == "合成新Buff"
            assert str(buffs.Worksheets(1).Cells(4, 5).Value2) == "1"
            assert all(not b.Saved for b in books)
            assert hashes == {p: fingerprint(p) for p in hashes}
            print("PASS: 4 isolated workbooks, distinct level rows, source-edit isolation, mixed Buff prefixes, formulas/red/unsaved, source hashes unchanged")
    finally:
        try:
            app = win32com.client.GetActiveObject("Excel.Application")
            for book in list(app.Workbooks):
                if str(book.FullName) in opened:
                    book.Close(SaveChanges=False)
        finally:
            pythoncom.CoUninitialize()


if __name__ == "__main__":
    main()
