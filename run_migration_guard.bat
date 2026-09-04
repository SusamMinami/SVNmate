@echo off
setlocal
cd /d "%~dp0"
python -m migration_guard.app
if errorlevel 1 (
  echo.
  echo Failed to start Migration Guard. Please check Python and SVN CLI.
  pause
)
