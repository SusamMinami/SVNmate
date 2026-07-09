@echo off
setlocal
cd /d "%~dp0"
python svn_auto_tool.py
if errorlevel 1 (
  echo.
  echo Failed to start. Please make sure Python is installed and added to PATH.
  pause
)
