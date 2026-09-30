[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Trunk', 'OB17', 'OSOB', 'OStrunk')]
    [string]$Profile,

    [switch]$Preview,

    [string]$ProjectFile,

    [string]$SoundDataRoot,

    [string]$EditorCommand,

    [string]$LogRoot,

    [switch]$SkipRemoteCheck,

    [switch]$SkipEditorCheck
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:SvnCommand = $null
$script:RunDirectory = $null
$script:CommandSequence = 0

function Stop-Reconcile {
    param(
        [Parameter(Mandatory = $true)][int]$Code,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $exception = New-Object System.InvalidOperationException($Message)
    $exception.Data['ExitCode'] = $Code
    throw $exception
}

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if ($fullPath.Length -gt 3) {
        return $fullPath.TrimEnd('\')
    }
    return $fullPath
}

function Get-ProjectUnrealEditorProcesses {
    param([Parameter(Mandatory = $true)][string]$UprojectPath)

    $projectPath = (Get-NormalizedPath -Path $UprojectPath).Replace('\', '/')
    $editorNames = @(
        'UE4Editor.exe',
        'UE4Editor-Cmd.exe',
        'UnrealEditor.exe',
        'UnrealEditor-Cmd.exe'
    )
    try {
        return @(
            Get-CimInstance Win32_Process -ErrorAction Stop |
                Where-Object {
                    $_.Name -in $editorNames -and
                    (
                        [string]::IsNullOrWhiteSpace([string]$_.CommandLine) -or
                        ([string]$_.CommandLine).Replace('\', '/').IndexOf(
                            $projectPath,
                            [System.StringComparison]::OrdinalIgnoreCase
                        ) -ge 0
                    )
                }
        )
    }
    catch {
        return @(
            Get-Process -Name @(
                'UE4Editor',
                'UE4Editor-Cmd',
                'UnrealEditor',
                'UnrealEditor-Cmd'
            ) -ErrorAction SilentlyContinue
        )
    }
}

function ConvertTo-NativeArgument {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)

    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
        return $Value
    }

    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq [char]92) {
            $backslashes++
            continue
        }
        if ($character -eq [char]34) {
            if ($backslashes -gt 0) {
                [void]$builder.Append(('\' * ($backslashes * 2)) -join '')
            }
            [void]$builder.Append('\"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * $backslashes) -join '')
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append(('\' * ($backslashes * 2)) -join '')
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Invoke-SvnProcess {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Operation
    )

    $script:CommandSequence++
    $stdoutPath = Join-Path $script:RunDirectory (
        'svn-{0:D3}-stdout.txt' -f $script:CommandSequence
    )
    $stderrPath = Join-Path $script:RunDirectory (
        'svn-{0:D3}-stderr.txt' -f $script:CommandSequence
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $script:SvnCommand
    $startInfo.Arguments = (
        $Arguments |
            ForEach-Object { ConvertTo-NativeArgument -Value $_ }
    ) -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $nativeExitCode = $process.ExitCode
    $process.Dispose()

    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($stdoutPath, $stdout, $utf8WithoutBom)
    [System.IO.File]::WriteAllText($stderrPath, $stderr, $utf8WithoutBom)
    if ($nativeExitCode -ne 0) {
        Stop-Reconcile -Code 4 -Message (
            '{0} failed with SVN exit code {1}. {2}' -f
            $Operation,
            $nativeExitCode,
            $stderr.Trim()
        )
    }

    return [pscustomobject]@{
        Stdout = $stdout
        Stderr = $stderr
    }
}

function Invoke-SvnXml {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Operation
    )

    $result = Invoke-SvnProcess -Arguments $Arguments -Operation $Operation
    try {
        return [xml]$result.Stdout
    }
    catch {
        Stop-Reconcile -Code 4 -Message (
            '{0} returned invalid XML: {1}' -f
            $Operation,
            $_.Exception.Message
        )
    }
}

function Get-SvnStatusRecords {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$CheckRemote
    )

    $arguments = @(
        'status',
        '--xml',
        '--depth', 'infinity',
        '--no-ignore',
        '--ignore-externals'
    )
    if ($CheckRemote) {
        $arguments += '--show-updates'
    }
    $arguments += @('--', $Path)

    $document = Invoke-SvnXml `
        -Arguments $arguments `
        -Operation 'SVN status check'

    $records = New-Object System.Collections.Generic.List[object]
    foreach ($entry in $document.SelectNodes('//entry')) {
        $wcStatus = $entry.SelectSingleNode('wc-status')
        $repositoryStatus = $entry.SelectSingleNode('repos-status')
        $records.Add([pscustomobject]@{
                Path = Get-NormalizedPath -Path ([string]$entry.path)
                Item = [string]$wcStatus.item
                Properties = [string]$wcStatus.props
                TreeConflicted = (
                    [string]$wcStatus.'tree-conflicted'
                ).Equals(
                    'true',
                    [System.StringComparison]::OrdinalIgnoreCase
                )
                RepositoryItem = if ($repositoryStatus) {
                    [string]$repositoryStatus.item
                }
                else {
                    ''
                }
            })
    }
    return $records.ToArray()
}

function Assert-NoSvnConflicts {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$StatusRecords
    )

    $conflicts = @(
        $StatusRecords | Where-Object {
            $_.TreeConflicted -or
            $_.Item -in @('conflicted', 'obstructed', 'incomplete') -or
            $_.Properties -eq 'conflicted'
        }
    )
    if ($conflicts.Count -eq 0) {
        return
    }

    foreach ($entry in $conflicts | Select-Object -First 20) {
        Write-Host ('  SVN conflict: {0} [{1}]' -f $entry.Path, $entry.Item)
    }
    Stop-Reconcile -Code 4 -Message (
        'WwiseSoundData contains {0} unresolved SVN conflict(s).' -f
        $conflicts.Count
    )
}

function Assert-SvnCurrent {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$StatusRecords
    )

    $outdated = @(
        $StatusRecords | Where-Object {
            $_.RepositoryItem -and
            $_.RepositoryItem -notin @('none', 'normal')
        }
    )
    if ($outdated.Count -eq 0) {
        return
    }

    foreach ($entry in $outdated | Select-Object -First 20) {
        Write-Host (
            '  Remote change: {0} [{1}]' -f
            $entry.Path,
            $entry.RepositoryItem
        )
    }
    Stop-Reconcile -Code 4 -Message (
        ('WwiseSoundData is not current in SVN ({0} remote change(s)). ' +
            'Update it and resolve conflicts before generation.') -f
        $outdated.Count
    )
}

function Assert-SvnClean {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$StatusRecords
    )

    $localChanges = @(
        $StatusRecords | Where-Object {
            $_.Item -notin @('', 'none', 'normal', 'external') -or
            $_.Properties -notin @('', 'none', 'normal')
        }
    )
    if ($localChanges.Count -eq 0) {
        return
    }

    foreach ($entry in $localChanges | Select-Object -First 20) {
        Write-Host (
            '  Local change: {0} [{1}]' -f
            $entry.Path,
            $entry.Item
        )
    }
    Stop-Reconcile -Code 4 -Message (
        ('WwiseSoundData already contains {0} local change(s). ' +
            'Commit or revert them before generation.') -f
        $localChanges.Count
    )
}

function Split-PathBatches {
    param(
        [Parameter(Mandatory = $true)][string[]]$Paths,
        [int]$MaximumCharacters = 24000,
        [int]$MaximumItems = 200
    )

    $batches = New-Object System.Collections.Generic.List[object]
    $batch = New-Object System.Collections.Generic.List[string]
    $characters = 0
    foreach ($path in $Paths) {
        $literalPath = $path + '@'
        $argumentLength = $literalPath.Length + 3
        if ($batch.Count -gt 0 -and
            ($batch.Count -ge $MaximumItems -or
                ($characters + $argumentLength) -gt $MaximumCharacters)) {
            $batches.Add($batch.ToArray())
            $batch = New-Object System.Collections.Generic.List[string]
            $characters = 0
        }
        $batch.Add($literalPath)
        $characters += $argumentLength
    }
    if ($batch.Count -gt 0) {
        $batches.Add($batch.ToArray())
    }
    return $batches.ToArray()
}

function Get-TopmostPaths {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Paths
    )

    $selected = New-Object System.Collections.Generic.List[string]
    foreach ($path in @(
            $Paths |
                Sort-Object @{ Expression = { $_.Length } }, @{ Expression = { $_ } }
        )) {
        $isChild = $false
        foreach ($parent in $selected) {
            if ($path.StartsWith(
                    $parent.TrimEnd('\') + '\',
                    [System.StringComparison]::OrdinalIgnoreCase
                )) {
                $isChild = $true
                break
            }
        }
        if (-not $isChild) {
            $selected.Add($path)
        }
    }
    return $selected.ToArray()
}

function Invoke-SvnPathOperation {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('add', 'delete')]
        [string]$Action,
        [Parameter(Mandatory = $true)][string[]]$Paths
    )

    foreach ($batch in @(Split-PathBatches -Paths $Paths)) {
        $arguments = @($Action)
        if ($Action -eq 'add') {
            $arguments += @('--parents', '--force')
        }
        else {
            $arguments += '--force'
        }
        $arguments += '--'
        $arguments += @($batch)
        [void](Invoke-SvnProcess `
                -Arguments $arguments `
                -Operation ("SVN {0}" -f $Action))
    }
}

function Resolve-UnrealEditorCommand {
    param([Parameter(Mandatory = $true)][string]$UprojectPath)

    $project = Get-Content -LiteralPath $UprojectPath -Raw -Encoding UTF8 |
        ConvertFrom-Json
    $association = [string]$project.EngineAssociation
    if ([string]::IsNullOrWhiteSpace($association)) {
        Stop-Reconcile -Code 2 -Message (
            "EngineAssociation is missing from $UprojectPath"
        )
    }

    $engineRoot = $null
    $buildsKey = 'HKCU:\Software\Epic Games\Unreal Engine\Builds'
    if (Test-Path -LiteralPath $buildsKey) {
        $builds = Get-ItemProperty -LiteralPath $buildsKey
        $property = $builds.PSObject.Properties[$association]
        if ($property) {
            $engineRoot = [string]$property.Value
        }
    }

    if ([string]::IsNullOrWhiteSpace($engineRoot)) {
        foreach ($key in @(
                "HKLM:\SOFTWARE\EpicGames\Unreal Engine\$association",
                "HKLM:\SOFTWARE\WOW6432Node\EpicGames\Unreal Engine\$association"
            )) {
            if (-not (Test-Path -LiteralPath $key)) {
                continue
            }
            $candidate = [string](
                Get-ItemProperty -LiteralPath $key
            ).InstalledDirectory
            if (-not [string]::IsNullOrWhiteSpace($candidate)) {
                $engineRoot = $candidate
                break
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($engineRoot)) {
        Stop-Reconcile -Code 2 -Message (
            "No installed Unreal engine matches EngineAssociation $association."
        )
    }

    foreach ($fileName in @('UE4Editor-Cmd.exe', 'UnrealEditor-Cmd.exe')) {
        $candidate = Join-Path $engineRoot (
            "Engine\Binaries\Win64\$fileName"
        )
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return Get-NormalizedPath -Path $candidate
        }
    }

    Stop-Reconcile -Code 2 -Message (
        "The command-line Unreal editor was not found under $engineRoot"
    )
}

function Get-CommandDisplay {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    return (
        @((ConvertTo-NativeArgument -Value $Command)) +
            @($Arguments | ForEach-Object {
                    ConvertTo-NativeArgument -Value $_
                })
    ) -join ' '
}

function Invoke-ReconcileCommandlet {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('all', 'dryrun')]
        [string]$Mode,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string]$UprojectPath
    )

    $consoleLogPath = Join-Path $script:RunDirectory (
        "commandlet-$Mode-console.log"
    )
    $engineLogPath = Join-Path $script:RunDirectory (
        "commandlet-$Mode-engine.log"
    )
    $arguments = @(
        $UprojectPath,
        '-run=WwiseReconcile',
        "-modes=$Mode",
        '-unattended',
        '-nop4',
        '-nosplash',
        '-nullrhi',
        '-stdout',
        '-FullStdOutLogOutput',
        '-UTF8Output',
        '-NoSound',
        "-AbsLog=$engineLogPath"
    )

    Write-Host ('  Command: {0}' -f (
            Get-CommandDisplay -Command $Command -Arguments $arguments
        ))
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    $writer = New-Object System.IO.StreamWriter(
        $consoleLogPath,
        $false,
        $utf8WithoutBom
    )
    $failurePattern = (
        'Failed to reconcile assets|' +
        'Failed to get Wwise Reconcile implementation|' +
        'Could not save packages|' +
        'Failed to save updated Wwise assets'
    )
    $manualWorkPattern = (
        'Renaming through the commandlet is only supported|' +
        'Please delete this asset manually|' +
        'Please import this asset manually|' +
        'is referenced and will not be deleted'
    )
    $detectedFailure = $false
    $detectedManualWork = $false
    $detectedNoOperations = $false
    $completedOperations = $null
    try {
        & $Command @arguments 2>&1 |
            ForEach-Object {
                $line = $_.ToString()
                $writer.WriteLine($line)
                if ($line -match $failurePattern) {
                    $detectedFailure = $true
                }
                if ($line -match $manualWorkPattern) {
                    $detectedManualWork = $true
                }
                if ($line -match 'No Wwise Assets to Reconcile') {
                    $detectedNoOperations = $true
                }
                if ($line -match (
                        'Successfully did\s+(\d+)\s+operations out of\s+(\d+)'
                    )) {
                    $completedOperations = [int]$Matches[1]
                }
                if ($line -match (
                        'WwiseReconcile|' +
                        'Need to perform operation|' +
                        'Successfully did \d+ operations|' +
                        'No Wwise Assets to Reconcile|' +
                        'Assets need be reconciled|' +
                        'Error:|Warning:|' +
                        'Failed|Could not'
                    )) {
                    Write-Host $line
                }
            }
        $nativeExitCode = $LASTEXITCODE
    }
    finally {
        $writer.Dispose()
    }

    return [pscustomobject]@{
        ExitCode = $nativeExitCode
        DetectedFailure = $detectedFailure
        DetectedManualWork = $detectedManualWork
        DetectedNoOperations = $detectedNoOperations
        CompletedOperations = $completedOperations
        ConsoleLog = $consoleLogPath
        EngineLog = $engineLogPath
    }
}

$profiles = @{
    Trunk = @{
        ProjectFile = 'C:\trunk\res\Seria.uproject'
    }
    OB17 = @{
        ProjectFile = 'D:\server\17.0\res\Seria.uproject'
    }
    OSOB = @{
        ProjectFile = 'D:\Oversea\OSOB\res\Seria.uproject'
    }
    OStrunk = @{
        ProjectFile = 'D:\Oversea\OStrunk\res\Seria.uproject'
    }
}

$mutex = $null
$lockAcquired = $false
$transcriptStarted = $false
$exitCode = 0

try {
    if ([string]::IsNullOrWhiteSpace($ProjectFile)) {
        $ProjectFile = [string]$profiles[$Profile].ProjectFile
    }
    $ProjectFile = Get-NormalizedPath -Path $ProjectFile
    $projectRoot = Split-Path -Parent $ProjectFile
    if ([string]::IsNullOrWhiteSpace($SoundDataRoot)) {
        $SoundDataRoot = Join-Path $projectRoot (
            'Content\Seria\WwiseSoundData'
        )
    }
    $SoundDataRoot = Get-NormalizedPath -Path $SoundDataRoot
    if ([string]::IsNullOrWhiteSpace($LogRoot)) {
        $LogRoot = Join-Path $env:LOCALAPPDATA (
            'SeriaWwiseMigration\Logs'
        )
    }
    $LogRoot = Get-NormalizedPath -Path $LogRoot

    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
    $runName = '{0}-{1}-WwiseSoundData-{2}' -f (
        Get-Date -Format 'yyyyMMdd-HHmmss'
    ), $Profile, ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $script:RunDirectory = Join-Path $LogRoot $runName
    New-Item -ItemType Directory -Path $script:RunDirectory | Out-Null
    Start-Transcript `
        -LiteralPath (Join-Path $script:RunDirectory 'console.log') |
        Out-Null
    $transcriptStarted = $true

    Write-Host '========== Wwise Unreal Asset Reconcile =========='
    Write-Host "Profile: $Profile"
    Write-Host "Project: $ProjectFile"
    Write-Host "Assets:  $SoundDataRoot"
    Write-Host ('Mode:    {0}' -f $(if ($Preview) { 'preview' } else { 'execute' }))
    Write-Host "Logs:    $script:RunDirectory"
    Write-Host

    Write-Host '[ASSET 1/6] Validating Unreal project and commandlet...'
    if (-not (Test-Path -LiteralPath $ProjectFile -PathType Leaf)) {
        Stop-Reconcile -Code 2 -Message (
            "Unreal project does not exist: $ProjectFile"
        )
    }
    if (-not (Test-Path -LiteralPath $SoundDataRoot -PathType Container)) {
        Stop-Reconcile -Code 2 -Message (
            "WwiseSoundData does not exist: $SoundDataRoot"
        )
    }

    $gameConfigPath = Join-Path $projectRoot 'Config\DefaultGame.ini'
    if (-not (Test-Path -LiteralPath $gameConfigPath -PathType Leaf)) {
        Stop-Reconcile -Code 2 -Message (
            "Unreal game config does not exist: $gameConfigPath"
        )
    }
    $gameConfig = Get-Content -LiteralPath $gameConfigPath -Raw
    if ($gameConfig -notmatch (
            '(?im)^\s*RootOutputPath\s*=\s*' +
            '\(\s*Path\s*=\s*"Seria[/\\]WwiseAudio"\s*\)\s*$'
        )) {
        Stop-Reconcile -Code 2 -Message (
            'RootOutputPath must be Seria/WwiseAudio in DefaultGame.ini.'
        )
    }
    if ($gameConfig -notmatch (
            '(?im)^\s*DefaultAssetCreationPath\s*=\s*' +
            '/Game/Seria/WwiseSoundData\s*$'
        )) {
        Stop-Reconcile -Code 2 -Message (
            ('DefaultAssetCreationPath must be ' +
                '/Game/Seria/WwiseSoundData in DefaultGame.ini.')
        )
    }
    $projectInfoPath = Join-Path $projectRoot (
        'Content\Seria\WwiseAudio\ProjectInfo.json'
    )
    if (-not (Test-Path -LiteralPath $projectInfoPath -PathType Leaf)) {
        Stop-Reconcile -Code 2 -Message (
            "Generated SoundBank metadata does not exist: $projectInfoPath"
        )
    }

    $pluginBinary = Join-Path $projectRoot (
        'Plugins\Wwise\Binaries\Win64\UE4Editor-WwiseReconcile.dll'
    )
    if (-not (Test-Path -LiteralPath $pluginBinary -PathType Leaf)) {
        Stop-Reconcile -Code 2 -Message (
            "WwiseReconcile commandlet binary was not found: $pluginBinary"
        )
    }
    if ([string]::IsNullOrWhiteSpace($EditorCommand)) {
        $EditorCommand = Resolve-UnrealEditorCommand -UprojectPath $ProjectFile
    }
    else {
        $EditorCommand = Get-NormalizedPath -Path $EditorCommand
        if (-not (Test-Path -LiteralPath $EditorCommand -PathType Leaf)) {
            Stop-Reconcile -Code 2 -Message (
                "Editor command does not exist: $EditorCommand"
            )
        }
    }
    Write-Host "  Editor: $EditorCommand"
    Write-Host "  Plugin: $pluginBinary"

    $svn = Get-Command svn.exe -ErrorAction SilentlyContinue
    if (-not $svn) {
        Stop-Reconcile -Code 3 -Message 'svn.exe was not found.'
    }
    $script:SvnCommand = $svn.Source

    $lockText = $SoundDataRoot.ToLowerInvariant()
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $lockBytes = [System.Text.Encoding]::UTF8.GetBytes($lockText)
        $lockHash = (
            [System.BitConverter]::ToString(
                $sha256.ComputeHash($lockBytes)
            )
        ).Replace('-', '')
    }
    finally {
        $sha256.Dispose()
    }
    $mutexName = 'Local\SeriaWwiseReconcile_{0}' -f $lockHash.Substring(0, 24)
    $mutex = New-Object System.Threading.Mutex($false, $mutexName)
    try {
        $lockAcquired = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $lockAcquired = $true
    }
    if (-not $lockAcquired) {
        Stop-Reconcile -Code 3 -Message (
            "Another asset generation is using $SoundDataRoot"
        )
    }

    Write-Host '[ASSET 2/6] Validating WwiseSoundData SVN state...'
    $infoDocument = Invoke-SvnXml `
        -Arguments @('info', '--xml', '--', $SoundDataRoot) `
        -Operation 'SVN working-copy check'
    $wcRoot = [string]$infoDocument.info.entry.'wc-info'.'wcroot-abspath'
    if ([string]::IsNullOrWhiteSpace($wcRoot) -or
        -not (Get-NormalizedPath -Path $wcRoot).Equals(
            $SoundDataRoot,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        Stop-Reconcile -Code 3 -Message (
            'WwiseSoundData must be the root of its own SVN working copy/external.'
        )
    }

    $preStatus = @(
        Get-SvnStatusRecords `
            -Path $SoundDataRoot `
            -CheckRemote:(-not $SkipRemoteCheck)
    )
    Assert-NoSvnConflicts -StatusRecords $preStatus
    Assert-SvnClean -StatusRecords $preStatus
    if (-not $SkipRemoteCheck) {
        Assert-SvnCurrent -StatusRecords $preStatus
    }
    Write-Host '  WwiseSoundData is clean and usable.'

    $runningEditors = @(
        Get-ProjectUnrealEditorProcesses -UprojectPath $ProjectFile
    )
    if ($Preview) {
        Write-Host '[ASSET 3/6] Previewing headless asset generation...'
        if ($runningEditors.Count -gt 0) {
            Write-Host (
                '  UE editor is running now; execute mode will close it before this stage.'
            )
        }
        $previewArguments = @(
            $ProjectFile,
            '-run=WwiseReconcile',
            '-modes=all',
            '-unattended',
            '-nop4',
            '-nosplash',
            '-nullrhi',
            '-stdout',
            '-FullStdOutLogOutput',
            '-UTF8Output',
            '-NoSound'
        )
        Write-Host ('  Planned command: {0}' -f (
                Get-CommandDisplay `
                    -Command $EditorCommand `
                    -Arguments $previewArguments
            ))
        Write-Host '[ASSET 4/6] SVN Add/Delete reconciliation is planned.'
        Write-Host '[ASSET 5/6] A dry-run verification is planned.'
        Write-Host '[ASSET 6/6] Preview completed without launching Unreal.'
        Write-Host
        Write-Host '========== Asset Preview Complete =========='
    }
    else {
        if (-not $SkipEditorCheck -and $runningEditors.Count -gt 0) {
            Stop-Reconcile -Code 3 -Message (
                'An Unreal editor process is still running. Close it before generation.'
            )
        }

        Write-Host '[ASSET 3/6] Generating and saving Wwise Unreal assets...'
        $reconcileResult = Invoke-ReconcileCommandlet `
            -Mode all `
            -Command $EditorCommand `
            -UprojectPath $ProjectFile
        if (-not $reconcileResult.DetectedManualWork -and
            ($reconcileResult.ExitCode -ne 0 -or
                $reconcileResult.DetectedFailure)) {
            Stop-Reconcile -Code 5 -Message (
                ('WwiseReconcile failed. Review {0} and {1}.') -f
                $reconcileResult.ConsoleLog,
                $reconcileResult.EngineLog
            )
        }
        $manualWorkRequired = $reconcileResult.DetectedManualWork
        if ($manualWorkRequired) {
            Write-Host (
                '  UE4 reported an operation that requires manual editor work.'
            )
        }
        Write-Host '  Reconcile completed and packages were saved.'

        Write-Host '[ASSET 4/6] Reconciling WwiseSoundData SVN Add/Delete...'
        $postStatus = @(Get-SvnStatusRecords -Path $SoundDataRoot)
        Assert-NoSvnConflicts -StatusRecords $postStatus
        $ignoredPaths = @(
            $postStatus | Where-Object {
                $_.Item -eq 'ignored'
            } | Select-Object -ExpandProperty Path
        )
        if ($ignoredPaths.Count -gt 0) {
            foreach ($path in $ignoredPaths | Select-Object -First 20) {
                Write-Host "  Ignored generated path: $path"
            }
            Stop-Reconcile -Code 7 -Message (
                'Generation produced {0} ignored path(s); SVN rules need review.' -f
                $ignoredPaths.Count
            )
        }

        $addPaths = @(
            $postStatus | Where-Object {
                $_.Item -eq 'unversioned'
            } | Select-Object -ExpandProperty Path
        )
        $deletePaths = @(
            $postStatus | Where-Object {
                $_.Item -eq 'missing'
            } | Select-Object -ExpandProperty Path
        )
        $addPaths = @(Get-TopmostPaths -Paths $addPaths)
        $deletePaths = @(Get-TopmostPaths -Paths $deletePaths)
        if ($addPaths.Count -gt 0) {
            Write-Host ("  Scheduling {0} SVN add root(s)..." -f $addPaths.Count)
            Invoke-SvnPathOperation -Action add -Paths $addPaths
        }
        if ($deletePaths.Count -gt 0) {
            Write-Host (
                "  Scheduling {0} SVN delete root(s)..." -f
                $deletePaths.Count
            )
            Invoke-SvnPathOperation -Action delete -Paths $deletePaths
        }
        if ($addPaths.Count -eq 0 -and $deletePaths.Count -eq 0) {
            Write-Host '  No SVN Add/Delete operation was needed.'
        }

        $reconciledStatus = @(
            Get-SvnStatusRecords `
                -Path $SoundDataRoot `
                -CheckRemote:(-not $SkipRemoteCheck)
        )
        Assert-NoSvnConflicts -StatusRecords $reconciledStatus
        if (-not $SkipRemoteCheck) {
            Assert-SvnCurrent -StatusRecords $reconciledStatus
        }
        $unreconciled = @(
            $reconciledStatus | Where-Object {
                $_.Item -in @('unversioned', 'ignored', 'missing')
            }
        )
        if ($unreconciled.Count -gt 0) {
            foreach ($entry in $unreconciled | Select-Object -First 20) {
                Write-Host (
                    '  Unreconciled: {0} [{1}]' -f
                    $entry.Path,
                    $entry.Item
                )
            }
            Stop-Reconcile -Code 7 -Message (
                'SVN reconciliation left {0} unmanaged path(s).' -f
                $unreconciled.Count
            )
        }

        Write-Host '[ASSET 5/6] Verifying zero residual Reconcile operations...'
        $dryRunMode = 'IndependentColdStart'
        # Changed packages need a fresh process to verify the persisted disk state.
        if ($reconcileResult.DetectedNoOperations) {
            $dryRunMode = 'SkippedNoChanges'
            Write-Host (
                '  First pass found no Reconcile operations; ' +
                'the second Unreal startup is unnecessary.'
            )
        }
        else {
            $dryRunResult = Invoke-ReconcileCommandlet `
                -Mode dryrun `
                -Command $EditorCommand `
                -UprojectPath $ProjectFile
            if ($manualWorkRequired -or
                $dryRunResult.ExitCode -ne 0 -or
                $dryRunResult.DetectedFailure -or
                $dryRunResult.DetectedManualWork) {
                Stop-Reconcile -Code 6 -Message (
                    ('Wwise assets still need manual Reconcile work. ' +
                        'Review {0}; UE4 rename/move/reference cases may require the editor.') -f
                    $dryRunResult.ConsoleLog
                )
            }
        }

        Write-Host '[ASSET 6/6] Writing generation summary...'
        $finalStatus = @(Get-SvnStatusRecords -Path $SoundDataRoot)
        $summary = [ordered]@{
            Result = 'Success'
            Profile = $Profile
            Project = $ProjectFile
            EditorCommand = $EditorCommand
            SoundDataRoot = $SoundDataRoot
            ChangedPaths = @(
                $finalStatus | Where-Object {
                    $_.Item -notin @('', 'none', 'normal', 'external')
                }
            ).Count
            ReconcileOperations = $reconcileResult.CompletedOperations
            DryRunVerification = $dryRunMode
            SvnAddRoots = $addPaths.Count
            SvnDeleteRoots = $deletePaths.Count
            CompletedAt = (Get-Date).ToString('o')
        }
        $summary |
            ConvertTo-Json -Depth 4 |
            Set-Content `
                -LiteralPath (Join-Path $script:RunDirectory 'summary.json') `
                -Encoding UTF8

        Write-Host
        Write-Host '========== Unreal Asset Generation Complete =========='
        Write-Host (
            'SVN reconciliation: {0} add root(s), {1} delete root(s).' -f
            $addPaths.Count,
            $deletePaths.Count
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
    if ($script:RunDirectory) {
        Write-Host "Logs retained at: $script:RunDirectory"
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
