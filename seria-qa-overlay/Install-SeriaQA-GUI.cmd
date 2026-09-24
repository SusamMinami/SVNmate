@echo off
setlocal
if /I "%SERIA_QA_SETUP_HOST%"=="1" (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Sta ^
        -WindowStyle Hidden -File "%~dp0Install-SeriaQA-GUI.ps1" %*
    exit /b %ERRORLEVEL%
)
start "" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Sta ^
    -WindowStyle Hidden -File "%~dp0Install-SeriaQA-GUI.ps1" %*
exit /b 0
