@echo off
setlocal
start "" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Sta ^
    -WindowStyle Hidden -File "%~dp0Install-SeriaQA-GUI.ps1" %*
exit /b 0
