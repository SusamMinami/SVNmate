"""Explicit opt-in integration check. Creates only synthetic temporary workbooks."""
import sys
from pathlib import Path
import tempfile
from concurrent.futures import ThreadPoolExecutor

import pythoncom
import win32com.client

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.excel import apply_plan
from backend.repository import fingerprint
from backend.service import Service
from test_pipeline import fixture


def main():
    if "--run" not in sys.argv:
        raise SystemExit("Use --run to open Excel with synthetic workbooks.")
    pythoncom.CoInitialize()
    opened_paths = []
    try:
        with tempfile.TemporaryDirectory(prefix="character-synthetic-") as temp:
            root = Path(temp)
            path = fixture(root)
            before = fingerprint(path)
            def worker(plans, mode):
                # Match HTTP execution: COM lives on the request worker, test inspection on main.
                with ThreadPoolExecutor(max_workers=1) as pool:
                    return pool.submit(apply_plan, plans, mode).result()
            service = Service(writer=worker)
            service.load(root)
            review = service.prepare({"sourceId": "100", "targetId": "101", "mode": "copy",
                                      "edits": {"career": {"name": ["合成副本测试"]}}})
            result = service.commit(review["token"])
            opened_paths.extend(result["paths"])
            assert fingerprint(path) == before, "Synthetic source changed on disk"
            pythoncom.CoInitialize()
            app = win32com.client.GetActiveObject("Excel.Application")
            book = next(b for b in app.Workbooks if str(b.FullName) in opened_paths)
            sheet = book.Worksheets("Sheet1")
            assert sheet.Cells(4, 2).Value2 == 101
            assert sheet.Cells(4, 3).Value2 == "合成副本测试"
            assert sheet.Cells(4, 10).Formula == "=1+1", "Formula was lost"
            assert sheet.Cells(4, 3).Font.Color == 255
            assert not book.Saved
            # A concurrent unsaved change in an open source must block the whole batch.
            second = service.prepare({"sourceId": "100", "mode": "source",
                                      "edits": {"career": {"name": ["不得写入"]}}})
            source = app.Workbooks.Open(str(path), UpdateLinks=0, ReadOnly=False)
            opened_paths.append(str(path))
            source.Worksheets("Sheet1").Cells(3, 3).Value2 = "并发修改"
            try:
                service.commit(second["token"])
            except ValueError as exc:
                assert "未保存改动" in str(exc), str(exc)
            else:
                raise AssertionError("Concurrent change was not blocked")
            assert source.Worksheets("Sheet1").Cells(3, 3).Value2 == "并发修改"
            source.Close(SaveChanges=False)
            opened_paths.remove(str(path))
            print("PASS: copy clone, ID/name readback, formula preserved, red/unsaved; concurrent edit blocked")
    finally:
        try:
            pythoncom.CoInitialize()
            app = win32com.client.GetActiveObject("Excel.Application")
            for book in list(app.Workbooks):
                if str(book.FullName) in opened_paths:
                    book.Close(SaveChanges=False)
        finally:
            pythoncom.CoUninitialize()


if __name__ == "__main__":
    main()
