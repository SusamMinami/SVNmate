@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "Profile=%~1"
set "AppExe=%~dp0SeriaWwiseMigration.exe"
set "GuiScript=%~dp0Show-WwiseMigration.ps1"

if exist "%AppExe%" (
    if defined Profile (
        start "" "%AppExe%" --profile "%Profile%"
    ) else (
        start "" "%AppExe%"
    )
    endlocal
    exit /b 0
)

if not defined Profile (
    powershell.exe -NoProfile -STA -WindowStyle Hidden -Command ^
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('SeriaWwiseMigration.exe was not found. Rebuild the application first.','Wwise Migration')"
    exit /b 2
)

if not exist "%GuiScript%" (
    powershell.exe -NoProfile -STA -WindowStyle Hidden -Command ^
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('GUI script was not found.','Wwise Migration')"
    exit /b 3
)

start "" powershell.exe -NoProfile -STA -WindowStyle Hidden ^
    -ExecutionPolicy Bypass -File "%GuiScript%" -Profile "%Profile%"
endlocal
exit /b 0
