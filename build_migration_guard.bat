@echo off
setlocal
cd /d "%~dp0"
python -m PyInstaller --noconfirm MigrationGuard.spec
if errorlevel 1 (
  echo.
  echo Build failed. Please make sure Python and PyInstaller are installed.
  pause
  exit /b 1
)
echo.
echo Build complete: dist\MigrationGuard.exe
pause
