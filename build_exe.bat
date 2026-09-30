@echo off
setlocal
cd /d "%~dp0"
python -m PyInstaller --noconfirm SVNAutoTool.spec
if errorlevel 1 (
  echo.
  echo Build failed. Please make sure Python and PyInstaller are installed.
  pause
  exit /b 1
)
python -m PyInstaller --noconfirm SVNmateCLI.spec
if errorlevel 1 (
  echo.
  echo CLI build failed. Please make sure Python and PyInstaller are installed.
  pause
  exit /b 1
)
echo.
echo Build complete: dist\SVNAutoTool.exe and dist\SVNmateCLI.exe
pause
