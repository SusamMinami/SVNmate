@echo off
setlocal

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=%SystemDrive%\trunk"
set "MANIFEST=%~dp0manifest.qa.json"
if not exist "%MANIFEST%" set "MANIFEST=%~dp0manifest.json"
set "INSTALLER=%~dp0Install-SeriaTool.ps1"
if not exist "%INSTALLER%" set "INSTALLER=%~dp0Reapply-DLSS5.ps1"

echo Seria QA Overlay - restore after trunk update
echo Target: %TARGET%
echo.
echo Make sure Seria.exe is closed and the trunk update has finished.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
    -File "%INSTALLER%" -ManifestPath "%MANIFEST%" -TargetPath "%TARGET%" -Yes
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
    echo Restore completed. Start Seria and use one-click capture after entering a character.
) else (
    echo Restore failed. Close Seria, wait for the trunk update to finish, then run this file again.
)

echo.
pause
exit /b %RESULT%
