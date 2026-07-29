# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


project_dir = Path(SPECPATH).resolve()
icon_path = project_dir / "config_linker.ico"
datas = [(str(project_dir / "VERSION"), ".")]
if icon_path.is_file():
    datas.append((str(icon_path), "."))

a = Analysis(
    ["config_linker_app.py"],
    pathex=[str(project_dir), str(project_dir.parent)],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ConfigLinker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[str(icon_path)] if icon_path.is_file() else [],
)
