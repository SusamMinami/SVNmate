$ErrorActionPreference = 'Stop'

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if ($Expected -ne $Actual) {
        throw (
            '{0} Expected [{1}], actual [{2}].' -f
            $Message,
            $Expected,
            $Actual
        )
    }
}

$testRoot = Join-Path $env:TEMP (
    'SeriaWwiseReconcileTest-' + [guid]::NewGuid().ToString('N')
)
$repositoryPath = Join-Path $testRoot 'repository'
$projectRoot = Join-Path $testRoot 'Project'
$soundDataRoot = Join-Path $projectRoot 'Content\Seria\WwiseSoundData'
$logRoot = Join-Path $testRoot 'Logs'
$projectFile = Join-Path $projectRoot 'Seria.uproject'
$gameConfig = Join-Path $projectRoot 'Config\DefaultGame.ini'
$projectInfo = Join-Path $projectRoot (
    'Content\Seria\WwiseAudio\ProjectInfo.json'
)
$pluginBinary = Join-Path $projectRoot (
    'Plugins\Wwise\Binaries\Win64\UE4Editor-WwiseReconcile.dll'
)
$fakeEditor = Join-Path $testRoot 'Fake-UE4Editor-Cmd.cmd'
$markerPath = Join-Path $testRoot 'commandlet-ran.txt'
$launchCountPath = Join-Path $testRoot 'commandlet-launches.txt'
$workflowMarker = Join-Path $testRoot 'workflow-ran.txt'
$scriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) (
    'Invoke-WwiseUnrealReconcile.ps1'
)
$workflowScriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) (
    'Invoke-WwiseMigrationWorkflow.ps1'
)

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    New-Item -ItemType Directory -Path $projectRoot | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $pluginBinary) |
        Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $gameConfig) |
        Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $projectInfo) |
        Out-Null
    Set-Content -LiteralPath $projectFile -Value '{}' -Encoding ASCII
    Set-Content -LiteralPath $gameConfig -Value @(
        'RootOutputPath=(Path="Seria/WwiseAudio")',
        'DefaultAssetCreationPath=/Game/Seria/WwiseSoundData'
    ) -Encoding ASCII
    Set-Content -LiteralPath $projectInfo -Value '{}' -Encoding ASCII
    Set-Content -LiteralPath $pluginBinary -Value 'test' -Encoding ASCII

    & svnadmin.exe create $repositoryPath
    if ($LASTEXITCODE -ne 0) {
        throw 'svnadmin create failed.'
    }
    $repositoryUrl = ([System.Uri]$repositoryPath).AbsoluteUri
    & svn.exe mkdir "$repositoryUrl/WwiseSoundData" -m 'Initialize test data'
    if ($LASTEXITCODE -ne 0) {
        throw 'svn mkdir failed.'
    }
    New-Item `
        -ItemType Directory `
        -Path (Split-Path -Parent $soundDataRoot) `
        -Force |
        Out-Null
    & svn.exe checkout "$repositoryUrl/WwiseSoundData" $soundDataRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'svn checkout failed.'
    }

    Set-Content `
        -LiteralPath (Join-Path $soundDataRoot 'Existing.uasset') `
        -Value 'before' `
        -Encoding ASCII
    Set-Content `
        -LiteralPath (Join-Path $soundDataRoot 'Deleted.uasset') `
        -Value 'delete me' `
        -Encoding ASCII
    & svn.exe add --force -- $soundDataRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'svn add failed.'
    }
    & svn.exe commit $soundDataRoot -m 'Add test assets'
    if ($LASTEXITCODE -ne 0) {
        throw 'svn commit failed.'
    }

    $fakeEditorContent = @'
@echo off
setlocal EnableExtensions
set "MODE="
if defined FAKE_LAUNCH_COUNT >>"%FAKE_LAUNCH_COUNT%" echo launch
echo %* | findstr /I /C:"-modes=all" >nul
if not errorlevel 1 set "MODE=all"
echo %* | findstr /I /C:"-modes=dryrun" >nul
if not errorlevel 1 set "MODE=dryrun"
if /I "%MODE%"=="all" (
    if defined FAKE_NO_CHANGES (
        echo LogWwiseReconcile: No Wwise Assets to Reconcile...
        exit /b 0
    )
    if defined FAKE_MANUAL_WORK (
        echo LogWwiseReconcile: Error: Renaming through the commandlet is only supported with Unreal Engine 5.
        exit /b 1
    )
    >"%FAKE_RECONCILE_MARKER%" echo all
    >>"%FAKE_SOUND_DATA%\Existing.uasset" echo changed
    >"%FAKE_SOUND_DATA%\New.uasset" echo new
    del /q "%FAKE_SOUND_DATA%\Deleted.uasset"
    echo LogWwiseReconcile: Successfully did 3 operations out of 3.
    exit /b 0
)
if /I "%MODE%"=="dryrun" (
    echo LogWwiseReconcile: No Wwise Assets to Reconcile...
    exit /b 0
)
echo LogWwiseReconcile: Error: unexpected arguments
exit /b 9
'@
    Set-Content `
        -LiteralPath $fakeEditor `
        -Value $fakeEditorContent `
        -Encoding ASCII

    $env:FAKE_SOUND_DATA = $soundDataRoot
    $env:FAKE_RECONCILE_MARKER = $markerPath
    $env:FAKE_LAUNCH_COUNT = $launchCountPath

    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -Preview `
        -ProjectFile $projectFile `
        -SoundDataRoot $soundDataRoot `
        -EditorCommand $fakeEditor `
        -LogRoot $logRoot `
        -SkipRemoteCheck
    Assert-Equal -Expected 0 -Actual $LASTEXITCODE -Message (
        'Preview exit code.'
    )
    Assert-Equal `
        -Expected $false `
        -Actual (Test-Path -LiteralPath $markerPath) `
        -Message 'Preview must not invoke the commandlet.'

    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -ProjectFile $projectFile `
        -SoundDataRoot $soundDataRoot `
        -EditorCommand $fakeEditor `
        -LogRoot $logRoot `
        -SkipRemoteCheck
    Assert-Equal -Expected 0 -Actual $LASTEXITCODE -Message (
        'Execute exit code.'
    )
    Assert-Equal `
        -Expected $true `
        -Actual (Test-Path -LiteralPath $markerPath) `
        -Message 'Execute must invoke the commandlet.'
    Assert-Equal `
        -Expected 2 `
        -Actual @(Get-Content -LiteralPath $launchCountPath).Count `
        -Message 'Changed assets require an independent dry-run launch.'

    $statusDocument = [xml](
        & svn.exe status --xml --depth infinity -- $soundDataRoot
    )
    $statusByName = @{}
    foreach ($entry in $statusDocument.SelectNodes('//entry')) {
        $statusByName[(Split-Path -Leaf ([string]$entry.path))] = [string](
            $entry.SelectSingleNode('wc-status').item
        )
    }
    Assert-Equal `
        -Expected 'modified' `
        -Actual $statusByName['Existing.uasset'] `
        -Message 'Existing asset status.'
    Assert-Equal `
        -Expected 'added' `
        -Actual $statusByName['New.uasset'] `
        -Message 'New asset status.'
    Assert-Equal `
        -Expected 'deleted' `
        -Actual $statusByName['Deleted.uasset'] `
        -Message 'Deleted asset status.'

    & svn.exe revert --recursive -- $soundDataRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'svn revert failed.'
    }
    Remove-Item `
        -LiteralPath (Join-Path $soundDataRoot 'New.uasset') `
        -Force `
        -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $launchCountPath -Force
    $env:FAKE_NO_CHANGES = '1'
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -ProjectFile $projectFile `
        -SoundDataRoot $soundDataRoot `
        -EditorCommand $fakeEditor `
        -LogRoot $logRoot `
        -SkipRemoteCheck
    Assert-Equal `
        -Expected 0 `
        -Actual $LASTEXITCODE `
        -Message 'No-change execute exit code.'
    Assert-Equal `
        -Expected 1 `
        -Actual @(Get-Content -LiteralPath $launchCountPath).Count `
        -Message 'No-change execute must skip the second Unreal launch.'
    Remove-Item Env:FAKE_NO_CHANGES

    Remove-Item -LiteralPath $launchCountPath -Force
    $env:FAKE_MANUAL_WORK = '1'
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -ProjectFile $projectFile `
        -SoundDataRoot $soundDataRoot `
        -EditorCommand $fakeEditor `
        -LogRoot $logRoot `
        -SkipRemoteCheck
    Assert-Equal `
        -Expected 6 `
        -Actual $LASTEXITCODE `
        -Message 'UE4 manual-work exit code.'
    Remove-Item Env:FAKE_MANUAL_WORK

    $migrationStub = Join-Path $testRoot 'MigrationStub.ps1'
    $reconcileStub = Join-Path $testRoot 'ReconcileStub.ps1'
    Set-Content -LiteralPath $migrationStub -Encoding UTF8 -Value @'
param(
    [string]$Profile,
    [string]$LogRoot,
    [string]$SvnmateRoot,
    [switch]$Preview,
    [switch]$SkipRemoteCheck,
    [switch]$SkipEditorStop
)
Add-Content `
    -LiteralPath $env:FAKE_WORKFLOW_MARKER `
    -Value "migration:${Preview}:$SvnmateRoot"
Write-Host '[1/8] Migration stub'
exit 0
'@
    Set-Content -LiteralPath $reconcileStub -Encoding UTF8 -Value @'
param(
    [string]$Profile,
    [string]$LogRoot,
    [switch]$Preview,
    [switch]$SkipRemoteCheck,
    [switch]$SkipEditorCheck
)
Add-Content -LiteralPath $env:FAKE_WORKFLOW_MARKER -Value "reconcile:$Preview"
Write-Host '[ASSET 1/6] Reconcile stub'
if ($env:FAKE_RECONCILE_EXIT) {
    exit [int]$env:FAKE_RECONCILE_EXIT
}
exit 0
'@
    $env:FAKE_WORKFLOW_MARKER = $workflowMarker
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $workflowScriptPath `
        -Profile Trunk `
        -Preview `
        -LogRoot $logRoot `
        -SvnmateRoot $testRoot `
        -SkipRemoteCheck `
        -SkipEditorStop `
        -MigrationScript $migrationStub `
        -ReconcileScript $reconcileStub
    Assert-Equal `
        -Expected 0 `
        -Actual $LASTEXITCODE `
        -Message 'Workflow preview exit code.'
    $workflowRuns = @(Get-Content -LiteralPath $workflowMarker)
    Assert-Equal `
        -Expected 2 `
        -Actual $workflowRuns.Count `
        -Message 'Workflow must invoke both stages.'
    Assert-Equal `
        -Expected "migration:True:$testRoot" `
        -Actual $workflowRuns[0] `
        -Message 'Workflow must preview migration.'
    Assert-Equal `
        -Expected 'reconcile:True' `
        -Actual $workflowRuns[1] `
        -Message 'Workflow must preview reconcile.'

    Remove-Item -LiteralPath $workflowMarker
    $env:FAKE_RECONCILE_EXIT = '6'
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $workflowScriptPath `
        -Profile Trunk `
        -LogRoot $logRoot `
        -SvnmateRoot $testRoot `
        -SkipRemoteCheck `
        -SkipEditorStop `
        -MigrationScript $migrationStub `
        -ReconcileScript $reconcileStub
    Assert-Equal `
        -Expected 6 `
        -Actual $LASTEXITCODE `
        -Message 'Workflow must preserve a manual-work exit code.'

    Write-Host (
        'PASS: preview, commandlet execution, SVN Add/Delete, dry-run, and workflow.'
    )
}
finally {
    Remove-Item Env:FAKE_SOUND_DATA -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_RECONCILE_MARKER -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_LAUNCH_COUNT -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_NO_CHANGES -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_MANUAL_WORK -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_WORKFLOW_MARKER -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_RECONCILE_EXIT -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
