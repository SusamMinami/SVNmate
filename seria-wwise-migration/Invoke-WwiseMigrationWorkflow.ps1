[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Trunk', 'OB17', 'OSOB', 'OStrunk')]
    [string]$Profile,

    [switch]$Preview,

    [string]$LogRoot,

    [string]$SourceRoot,

    [string]$SvnmateRoot,

    [switch]$SkipRemoteCheck,

    [switch]$SkipEditorStop,

    [string]$MigrationScript,

    [string]$ReconcileScript
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Stop-Workflow {
    param(
        [Parameter(Mandatory = $true)][int]$Code,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $exception = New-Object System.InvalidOperationException($Message)
    $exception.Data['ExitCode'] = $Code
    throw $exception
}

function Get-WorkflowMutexName {
    param([Parameter(Mandatory = $true)][string]$Text)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes(
            $Text.ToLowerInvariant()
        )
        $hash = (
            [System.BitConverter]::ToString(
                $sha256.ComputeHash($bytes)
            )
        ).Replace('-', '')
        return 'Local\SeriaWwiseWorkflow_{0}' -f $hash.Substring(0, 24)
    }
    finally {
        $sha256.Dispose()
    }
}

function Invoke-WorkflowScript {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$StageName
    )

    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $Path `
        @Arguments
    $childExitCode = $LASTEXITCODE
    if ($childExitCode -ne 0) {
        Stop-Workflow -Code $childExitCode -Message (
            '{0} failed with exit code {1}.' -f
            $StageName,
            $childExitCode
        )
    }
}

$mutex = $null
$lockAcquired = $false
$transcriptStarted = $false
$exitCode = 0
$workflowDirectory = $null

try {
    if ([string]::IsNullOrWhiteSpace($MigrationScript)) {
        $MigrationScript = Join-Path $PSScriptRoot (
            'Invoke-WwiseFullMigration.ps1'
        )
    }
    if ([string]::IsNullOrWhiteSpace($ReconcileScript)) {
        $ReconcileScript = Join-Path $PSScriptRoot (
            'Invoke-WwiseUnrealReconcile.ps1'
        )
    }
    foreach ($requiredScript in @($MigrationScript, $ReconcileScript)) {
        if (-not (Test-Path -LiteralPath $requiredScript -PathType Leaf)) {
            Stop-Workflow -Code 2 -Message (
                "Required workflow script was not found: $requiredScript"
            )
        }
    }

    if ([string]::IsNullOrWhiteSpace($LogRoot)) {
        $LogRoot = Join-Path $env:LOCALAPPDATA (
            'SeriaWwiseMigration\Logs'
        )
    }
    $LogRoot = [System.IO.Path]::GetFullPath($LogRoot)
    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
    $runName = '{0}-{1}-Workflow-{2}' -f (
        Get-Date -Format 'yyyyMMdd-HHmmss'
    ), $Profile, ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $workflowDirectory = Join-Path $LogRoot $runName
    New-Item -ItemType Directory -Path $workflowDirectory | Out-Null
    Start-Transcript `
        -LiteralPath (Join-Path $workflowDirectory 'workflow.log') |
        Out-Null
    $transcriptStarted = $true

    Write-Host '========== Wwise Migration Workflow =========='
    Write-Host "Profile:       $Profile"
    Write-Host ('Mode:          {0}' -f $(if ($Preview) { 'preview' } else { 'execute' }))
    Write-Host "Workflow logs: $workflowDirectory"
    Write-Host

    $mutexName = Get-WorkflowMutexName -Text $Profile
    $mutex = New-Object System.Threading.Mutex($false, $mutexName)
    try {
        $lockAcquired = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $lockAcquired = $true
    }
    if (-not $lockAcquired) {
        Stop-Workflow -Code 3 -Message (
            "Another $Profile migration workflow is already running."
        )
    }

    $audioLogRoot = Join-Path $workflowDirectory '01-WwiseAudio'
    $assetLogRoot = Join-Path $workflowDirectory '02-WwiseSoundData'

    Write-Host '[WORKFLOW 1/2] Migrating WwiseAudio...'
    $migrationArguments = @(
        '-Profile', $Profile,
        '-LogRoot', $audioLogRoot
    )
    if (-not [string]::IsNullOrWhiteSpace($SourceRoot)) {
        $migrationArguments += @('-SourceRoot', $SourceRoot)
    }
    if ($Preview) {
        $migrationArguments += '-Preview'
    }
    if ($SkipRemoteCheck) {
        $migrationArguments += '-SkipRemoteCheck'
    }
    if ($SkipEditorStop) {
        $migrationArguments += '-SkipEditorStop'
    }
    if (-not [string]::IsNullOrWhiteSpace($SvnmateRoot)) {
        $migrationArguments += @('-SvnmateRoot', $SvnmateRoot)
    }
    Invoke-WorkflowScript `
        -Path $MigrationScript `
        -Arguments $migrationArguments `
        -StageName 'WwiseAudio migration'

    Write-Host
    Write-Host '[WORKFLOW 2/2] Generating and saving WwiseSoundData...'
    $reconcileArguments = @(
        '-Profile', $Profile,
        '-LogRoot', $assetLogRoot
    )
    if ($Preview) {
        $reconcileArguments += '-Preview'
    }
    if ($SkipRemoteCheck) {
        $reconcileArguments += '-SkipRemoteCheck'
    }
    if ($SkipEditorStop) {
        $reconcileArguments += '-SkipEditorCheck'
    }
    Invoke-WorkflowScript `
        -Path $ReconcileScript `
        -Arguments $reconcileArguments `
        -StageName 'WwiseSoundData generation'

    Write-Host
    Write-Host '========== Workflow Complete =========='
    Write-Host "Workflow logs: $workflowDirectory"
    if ($Preview) {
        Write-Host 'No files or SVN state were changed.'
    }
    else {
        Write-Host (
            'WwiseAudio migration and WwiseSoundData generation both completed.'
        )
    }
}
catch {
    $exitCode = 1
    if ($_.Exception.Data.Contains('ExitCode')) {
        $exitCode = [int]$_.Exception.Data['ExitCode']
    }
    Write-Host
    Write-Host ('ERROR: {0}' -f $_.Exception.Message) -ForegroundColor Red
    if ($workflowDirectory) {
        Write-Host "Workflow logs: $workflowDirectory"
    }
}
finally {
    if ($lockAcquired -and $mutex) {
        $mutex.ReleaseMutex()
    }
    if ($mutex) {
        $mutex.Dispose()
    }
    if ($transcriptStarted) {
        try {
            Stop-Transcript | Out-Null
        }
        catch {
        }
    }
}

exit $exitCode
