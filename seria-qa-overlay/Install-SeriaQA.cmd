@echo off
setlocal EnableDelayedExpansion

set "TARGET=%~1"
set "MANIFEST=%~dp0manifest.qa.json"
if not exist "%MANIFEST%" set "MANIFEST=%~dp0manifest.json"
set "INSTALLER=%~dp0Install-SeriaTool.ps1"
if not exist "%INSTALLER%" set "INSTALLER=%~dp0Reapply-DLSS5.ps1"
if "%TARGET%"=="" (
    echo Seria QA Overlay portable installer
    echo.
    echo Paste one of these paths:
    echo   - Seria.exe
    echo   - Seria\Binaries\Win64
    echo   - The game root containing CoAGame or bin
    echo.
    set /p "TARGET=Game path: "
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
    -File "%INSTALLER%" -ManifestPath "%MANIFEST%" -TargetPath "%TARGET%"
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
        -File "%~dp0Publish-Persistent-Recovery.ps1" -ManifestPath "%MANIFEST%" -TargetPath "%TARGET%"
    if not "!ERRORLEVEL!"=="0" set "RESULT=1"
    echo Installation completed.
    echo.
    echo Start Seria and enter a character. If task capture is offline,
    echo press Home and click Start task capture.
) else if "%RESULT%"=="3" (
    echo Installation cancelled.
) else (
    echo Installation failed. Review the logs folder.
)

echo.
pause
exit /b %RESULT%
