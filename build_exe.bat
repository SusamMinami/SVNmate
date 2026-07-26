@echo off
setlocal
cd /d "%~dp0"
python -m PyInstaller --noconfirm --onefile --windowed --name SVNAutoTool --icon svnmate.ico --add-data "svnmate.ico;." svn_auto_tool.py
if errorlevel 1 (
  echo.
  echo Build failed. Please make sure Python and PyInstaller are installed.
  pause
  exit /b 1
)
echo.
echo Build complete: dist\SVNAutoTool.exe
pause
