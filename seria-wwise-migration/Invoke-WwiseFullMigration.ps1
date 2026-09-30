[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Trunk', 'OB17', 'OSOB', 'OStrunk')]
    [string]$Profile,

    [switch]$Preview,

    [switch]$Detail,

    [string]$SourceRoot,

    [string]$TargetRoot,

    [string]$LogRoot,

    [string]$SvnmateRoot,

    [switch]$SkipRemoteCheck,

    [switch]$SkipEditorStop
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:SvnCommand = $null
$script:SvnVersionCommand = $null
$script:RunDirectory = $null
$script:CommandSequence = 0

function Stop-Migration {
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
    try {
        return @(
            Get-CimInstance Win32_Process -ErrorAction Stop |
                Where-Object {
                    $_.Name -in @('UE4Editor.exe', 'UnrealEditor.exe') -and
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
                'UnrealEditor'
            ) -ErrorAction SilentlyContinue
        )
    }
}

function Test-IsUnderPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    return $Path.StartsWith(
        $Root.TrimEnd('\') + '\',
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Get-RelativeTargetPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $normalizedPath = Get-NormalizedPath -Path $Path
    $normalizedRoot = Get-NormalizedPath -Path $Root
    if ($normalizedPath.Equals(
            $normalizedRoot,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        return ''
    }
    if (-not (Test-IsUnderPath -Path $normalizedPath -Root $normalizedRoot)) {
        return $null
    }
    return $normalizedPath.Substring($normalizedRoot.Length + 1)
}

function Get-Sha256Text {
    param([Parameter(Mandatory = $true)][string]$Text)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        return ([System.BitConverter]::ToString(
                $sha256.ComputeHash($bytes)
            )).Replace('-', '')
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-Sha256File {
    param([Parameter(Mandatory = $true)][string]$Path)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read
    )
    try {
        return ([System.BitConverter]::ToString(
                $sha256.ComputeHash($stream)
            )).Replace('-', '')
    }
    finally {
        $stream.Dispose()
        $sha256.Dispose()
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
        [Parameter(Mandatory = $true)][string]$StdoutPath,
        [Parameter(Mandatory = $true)][string]$StderrPath,
        [string]$FileName,
        [string]$ProgressLabel = 'SVN command',
        [int]$ProgressIntervalSeconds = 10
    )

    if ([string]::IsNullOrWhiteSpace($FileName)) {
        $FileName = $script:SvnCommand
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FileName
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
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $startedAt = [System.DateTime]::UtcNow
    $nextProgressAt = $ProgressIntervalSeconds
    $reportedProgress = $false
    while (-not $process.WaitForExit(1000)) {
        $elapsedSeconds = [int][Math]::Floor(
            ([System.DateTime]::UtcNow - $startedAt).TotalSeconds
        )
        if ($ProgressIntervalSeconds -gt 0 -and
            $elapsedSeconds -ge $nextProgressAt) {
            Write-Host (
                '  {0} is still running... {1}s elapsed.' -f
                $ProgressLabel,
                $elapsedSeconds
            )
            $reportedProgress = $true
            $nextProgressAt += $ProgressIntervalSeconds
        }
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $nativeExitCode = $process.ExitCode
    $process.Dispose()
    if ($reportedProgress) {
        $elapsedSeconds = [int][Math]::Floor(
            ([System.DateTime]::UtcNow - $startedAt).TotalSeconds
        )
        Write-Host (
            '  {0} completed after {1}s.' -f
            $ProgressLabel,
            $elapsedSeconds
        )
    }

    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($StdoutPath, $stdout, $utf8WithoutBom)
    [System.IO.File]::WriteAllText($StderrPath, $stderr, $utf8WithoutBom)
    return [pscustomobject]@{
        ExitCode = $nativeExitCode
        Stdout = $stdout
        Stderr = $stderr
    }
}

function Invoke-SvnXml {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Operation
    )

    $script:CommandSequence++
    $stdoutPath = Join-Path $script:RunDirectory (
        'svn-{0:D3}-stdout.xml' -f $script:CommandSequence
    )
    $stderrPath = Join-Path $script:RunDirectory (
        'svn-{0:D3}-stderr.txt' -f $script:CommandSequence
    )

    $result = Invoke-SvnProcess `
        -Arguments $Arguments `
        -StdoutPath $stdoutPath `
        -StderrPath $stderrPath `
        -ProgressLabel $Operation
    if ($result.ExitCode -ne 0) {
        Stop-Migration -Code 4 -Message (
            '{0} failed with SVN exit code {1}. {2}' -f
            $Operation,
            $result.ExitCode,
            $result.Stderr.Trim()
        )
    }

    try {
        return [xml]$result.Stdout
    }
    catch {
        Stop-Migration -Code 4 -Message (
            '{0} returned invalid XML: {1}' -f
            $Operation,
            $_.Exception.Message
        )
    }
}

function Invoke-SvnCommand {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Operation,
        [switch]$PassThru
    )

    $script:CommandSequence++
    $stdoutPath = Join-Path $script:RunDirectory (
        'svn-{0:D3}-stdout.txt' -f $script:CommandSequence
    )
    $stderrPath = Join-Path $script:RunDirectory (
        'svn-{0:D3}-stderr.txt' -f $script:CommandSequence
    )

    $result = Invoke-SvnProcess `
        -Arguments $Arguments `
        -StdoutPath $stdoutPath `
        -StderrPath $stderrPath `
        -ProgressLabel $Operation
    if ($result.ExitCode -ne 0) {
        Stop-Migration -Code 4 -Message (
            '{0} failed with SVN exit code {1}. {2}' -f
            $Operation,
            $result.ExitCode,
            $result.Stderr.Trim()
        )
    }
    if ($PassThru) {
        return $result
    }
}

function Get-SvnWorkingCopyVersion {
    param([Parameter(Mandatory = $true)][string]$Path)

    $script:CommandSequence++
    $stdoutPath = Join-Path $script:RunDirectory (
        'svn-{0:D3}-svnversion.txt' -f $script:CommandSequence
    )
    $stderrPath = Join-Path $script:RunDirectory (
        'svn-{0:D3}-stderr.txt' -f $script:CommandSequence
    )
    $result = Invoke-SvnProcess `
        -FileName $script:SvnVersionCommand `
        -Arguments @('-n', $Path) `
        -StdoutPath $stdoutPath `
        -StderrPath $stderrPath `
        -ProgressLabel 'SVN working-copy revision check'
    if ($result.ExitCode -ne 0) {
        Stop-Migration -Code 4 -Message (
            'svnversion failed with exit code {0}. {1}' -f
            $result.ExitCode,
            $result.Stderr.Trim()
        )
    }

    $value = $result.Stdout.Trim()
    if ($value -notmatch
        '^(?<Minimum>\d+)(?::(?<Maximum>\d+))?(?<Flags>[A-Za-z]*)$') {
        Stop-Migration -Code 4 -Message (
            "Unexpected svnversion result for ${Path}: $value"
        )
    }
    $minimum = [long]$Matches['Minimum']
    $maximum = if ($Matches['Maximum']) {
        [long]$Matches['Maximum']
    }
    else {
        $minimum
    }
    $flags = [string]$Matches['Flags']
    return [pscustomobject]@{
        Raw = $value
        MinimumRevision = $minimum
        MaximumRevision = $maximum
        IsMixed = $minimum -ne $maximum
        IsModified = $flags.Contains('M')
        IsSwitched = $flags.Contains('S')
        IsPartial = $flags.Contains('P')
    }
}

function Get-SvnWorkingCopyDescriptor {
    param([Parameter(Mandatory = $true)][string]$Path)

    $document = Invoke-SvnXml `
        -Arguments @('info', '--xml', '--', $Path) `
        -Operation 'SVN working-copy info'
    $entry = $document.info.entry
    $workingCopyRoot = [string]$entry.'wc-info'.'wcroot-abspath'
    if ([string]::IsNullOrWhiteSpace($workingCopyRoot)) {
        Stop-Migration -Code 4 -Message (
            "SVN did not report a working-copy root for: $Path"
        )
    }
    return [pscustomobject]@{
        WorkingCopyRoot = Get-NormalizedPath -Path $workingCopyRoot
        Url = [string]$entry.url
        RepositoryRoot = [string]$entry.repository.root
        RepositoryUuid = [string]$entry.repository.uuid
        Revision = [long]$entry.revision
    }
}

function Get-SvnFreshnessState {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$CheckRemote
    )

    $normalizedPath = Get-NormalizedPath -Path $Path
    $descriptor = Get-SvnWorkingCopyDescriptor -Path $normalizedPath
    $version = Get-SvnWorkingCopyVersion -Path $normalizedPath
    $reasons = New-Object System.Collections.Generic.List[string]
    if ($version.IsMixed) {
        $reasons.Add("mixed revisions ($($version.Raw))")
    }
    if ($version.IsSwitched) {
        $reasons.Add('switched paths')
    }
    if ($version.IsPartial) {
        $reasons.Add('sparse or partial working copy')
    }

    $repositoryHeadRevision = $version.MaximumRevision
    $remoteChangeRevision = $null
    if ($CheckRemote) {
        $headDocument = Invoke-SvnXml `
            -Arguments @(
                'info',
                '--xml',
                '-r', 'HEAD',
                '--',
                $normalizedPath
            ) `
            -Operation 'SVN repository HEAD check'
        $repositoryHeadRevision = [long]$headDocument.info.entry.revision
        if ($repositoryHeadRevision -gt $version.MaximumRevision) {
            $range = '{0}:{1}' -f (
                $version.MaximumRevision + 1
            ), $repositoryHeadRevision
            $logDocument = Invoke-SvnXml `
                -Arguments @(
                    'log',
                    '--xml',
                    '--limit', '1',
                    '-r', $range,
                    '--',
                    $normalizedPath
                ) `
                -Operation 'SVN scoped remote-change check'
            $remoteEntry = $logDocument.SelectSingleNode('/log/logentry')
            if ($remoteEntry) {
                $remoteChangeRevision = [long]$remoteEntry.revision
                $reasons.Add(
                    "remote source change at r$remoteChangeRevision"
                )
            }
        }
    }

    return [pscustomobject]@{
        CheckedPath = $normalizedPath
        Descriptor = $descriptor
        Version = $version
        RepositoryHeadRevision = $repositoryHeadRevision
        RemoteChangeRevision = $remoteChangeRevision
        RequiresUpdate = $reasons.Count -gt 0
        Reasons = $reasons.ToArray()
    }
}

function Resolve-SvnmateCommand {
    param([string]$ConfiguredRoot)

    $candidates = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($ConfiguredRoot)) {
        $candidates.Add($ConfiguredRoot)
    }
    if (-not [string]::IsNullOrWhiteSpace($env:SVNMATE_CLI)) {
        $candidates.Add($env:SVNMATE_CLI)
    }
    if (-not [string]::IsNullOrWhiteSpace($env:SVNMATE_ROOT)) {
        $candidates.Add($env:SVNMATE_ROOT)
    }
    $managedRoot = [System.IO.Path]::GetFullPath(
        (Join-Path $PSScriptRoot '..\..')
    )
    $candidates.Add($managedRoot)
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $candidates.Add(
            (Join-Path $env:USERPROFILE 'Downloads\ezxss')
        )
    }

    foreach ($candidate in $candidates) {
        $path = Get-NormalizedPath -Path $candidate
        $root = if (Test-Path -LiteralPath $path -PathType Leaf) {
            Split-Path -Parent $path
        }
        else {
            $path
        }
        $executableCandidates = @(
            $path
            (Join-Path $root 'SVNmateCLI.exe')
            (Join-Path $root 'dist\SVNmateCLI.exe')
        )
        foreach ($executable in $executableCandidates) {
            if ((Split-Path -Leaf $executable) -eq 'SVNmateCLI.exe' -and
                (Test-Path -LiteralPath $executable -PathType Leaf)) {
                return [pscustomobject]@{
                    Kind = 'Executable'
                    FilePath = $executable
                    WorkingDirectory = Split-Path -Parent $executable
                    ModuleName = ''
                }
            }
        }
        foreach ($moduleName in @(
                'svnmate_cli',
                'migration_guard.svn_update_cli'
            )) {
            $relativePath = $moduleName.Replace('.', '\') + '.py'
            $modulePath = Join-Path $root $relativePath
            if (Test-Path -LiteralPath $modulePath -PathType Leaf) {
                return [pscustomobject]@{
                    Kind = 'PythonModule'
                    FilePath = ''
                    WorkingDirectory = $root
                    ModuleName = $moduleName
                }
            }
        }
    }
    Stop-Migration -Code 3 -Message (
        'SVNmateCLI.exe was not found. Install or update SVNmate v1.5.0+, ' +
        'or set SVNMATE_CLI to the managed command-line client.'
    )
}

function Invoke-SvnmateUpdate {
    param(
        [Parameter(Mandatory = $true)][string[]]$Paths,
        [Parameter(Mandatory = $true)][string]$Caller,
        [Parameter(Mandatory = $true)][object]$Command
    )

    Write-Host (
        '  Updating {0} working-copy path(s) through SVNmate:' -f
        $Paths.Count
    )
    $Paths | ForEach-Object { Write-Host "    $_" }
    Push-Location $Command.WorkingDirectory
    try {
        $arguments = @(
            '--source', $Caller,
            '--response-timeout', '3600'
        )
        $arguments += $Paths
        if ($Command.Kind -eq 'Executable') {
            $executable = [string]$Command.FilePath
            $outputLines = @(
                & $executable @arguments 2>&1 | ForEach-Object {
                    $line = [string]$_
                    Write-Host "  $line"
                    $line
                }
            )
        }
        else {
            $python = Get-Command python.exe -ErrorAction SilentlyContinue
            if (-not $python) {
                Stop-Migration -Code 3 -Message (
                    'Python is required only for a source-tree SVNmate client.'
                )
            }
            $pythonArguments = @(
                '-B',
                '-m', [string]$Command.ModuleName
            ) + $arguments
            $outputLines = @(
                & $python.Source @pythonArguments 2>&1 | ForEach-Object {
                    $line = [string]$_
                    Write-Host "  $line"
                    $line
                }
            )
        }
        $bridgeExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    $prefix = 'SVNMATE_UPDATE_RESULT_JSON='
    $resultLine = @(
        $outputLines | Where-Object { $_.StartsWith($prefix) }
    ) | Select-Object -Last 1
    if (-not $resultLine) {
        Stop-Migration -Code 4 -Message (
            'SVNmate update bridge did not return a machine-readable result.'
        )
    }
    try {
        $result = $resultLine.Substring($prefix.Length) |
            ConvertFrom-Json
    }
    catch {
        Stop-Migration -Code 4 -Message (
            'SVNmate update bridge returned invalid JSON: {0}' -f
            $_.Exception.Message
        )
    }
    if ($bridgeExitCode -ne 0 -or $result.ok -ne $true) {
        Stop-Migration -Code 4 -Message (
            'SVNmate update failed ({0}, exit {1}): {2}' -f
            [string]$result.status,
            $bridgeExitCode,
            [string]$result.message
        )
    }
    $requiredCapabilities = @(
        'update.batch',
        'update.cleanup_retry',
        'update.multi_root_parallel',
        'update.same_root_serial'
    )
    if ([int]$result.protocol_version -ne 2 -or
        [version]$result.core_version -lt [version]'1.1.0') {
        Stop-Migration -Code 4 -Message (
            'SVNmate runtime is incompatible; protocol 2 and core 1.1.0+ ' +
            'are required.'
        )
    }
    foreach ($capability in $requiredCapabilities) {
        if ([int]$result.capabilities.$capability -lt 1) {
            Stop-Migration -Code 4 -Message (
                "SVNmate runtime is missing capability: $capability"
            )
        }
    }
    Write-Host (
        '  SVN update completed by {0}.' -f
        [string]$result.executed_by
    )
    return $result
}

function Get-SvnOutdatedRecords {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$StatusRecords
    )

    return @(
        $StatusRecords | Where-Object {
            $_.RepositoryItem -and
            $_.RepositoryItem -notin @('none', 'normal')
        }
    )
}

function Get-TargetSvnPreflight {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$CheckRemote
    )

    $descriptor = Get-SvnWorkingCopyDescriptor -Path $Path
    if (-not $descriptor.WorkingCopyRoot.Equals(
            $Path,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        Stop-Migration -Code 3 -Message (
            'Target must be the root of its own SVN working copy/external.'
        )
    }
    $snapshot = Get-SvnStatusSnapshot `
        -Path $Path `
        -CheckRemote:$CheckRemote `
        -IncludeIgnored
    $records = @($snapshot.Records)
    Assert-NoSvnConflicts -StatusRecords $records
    return [pscustomobject]@{
        Snapshot = $snapshot
        Records = $records
        OutdatedRecords = @(
            if ($CheckRemote) {
                Get-SvnOutdatedRecords -StatusRecords $records
            }
        )
    }
}

function Get-SvnStatusSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$CheckRemote,
        [ValidateSet('empty', 'files', 'immediates', 'infinity')]
        [string]$Depth = 'infinity',
        [switch]$IncludeIgnored
    )

    $arguments = @(
        'status',
        '--xml',
        '--depth', $Depth,
        '--ignore-externals'
    )
    if ($IncludeIgnored) {
        $arguments += '--no-ignore'
    }
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
        $entryPath = Get-NormalizedPath -Path ([string]$entry.path)
        $records.Add([pscustomobject]@{
                Path = $entryPath
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
    $against = $document.SelectSingleNode('/status/target/against')
    return [pscustomobject]@{
        Records = $records.ToArray()
        RepositoryRevision = if ($against -and $against.revision) {
            [long]$against.revision
        }
        else {
            $null
        }
    }
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

    foreach ($conflict in $conflicts | Select-Object -First 20) {
        Write-Host (
            '  SVN conflict: {0} [{1}]' -f
            $conflict.Path,
            $conflict.Item
        )
    }
    Stop-Migration -Code 4 -Message (
        'The target contains {0} unresolved SVN conflict(s).' -f
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
    Stop-Migration -Code 4 -Message (
        ('The target is not up to date in SVN ({0} remote change(s)). ' +
            'Update the WwiseAudio working copy and resolve conflicts first.') -f
        $outdated.Count
    )
}

function Split-PathBatches {
    param(
        [Parameter(Mandatory = $true)][string[]]$Paths,
        [int]$MaximumCharacters = 24000,
        [int]$MaximumItems = 200
    )

    $batch = New-Object System.Collections.Generic.List[string]
    $characters = 0
    foreach ($path in $Paths) {
        $literalPath = $path + '@'
        $argumentLength = $literalPath.Length + 3
        if ($batch.Count -gt 0 -and
            ($batch.Count -ge $MaximumItems -or
                $characters + $argumentLength -gt $MaximumCharacters)) {
            ,$batch.ToArray()
            $batch.Clear()
            $characters = 0
        }
        $batch.Add($literalPath)
        $characters += $argumentLength
    }
    if ($batch.Count -gt 0) {
        ,$batch.ToArray()
    }
}

function Get-TopmostPaths {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Paths
    )

    $selected = New-Object System.Collections.Generic.List[string]
    foreach ($path in $Paths | Sort-Object Length, @{Expression = { $_ } }) {
        $covered = $false
        foreach ($parent in $selected) {
            if ($path.Equals(
                    $parent,
                    [System.StringComparison]::OrdinalIgnoreCase
                ) -or
                $path.StartsWith(
                    $parent.TrimEnd('\') + '\',
                    [System.StringComparison]::OrdinalIgnoreCase
                )) {
                $covered = $true
                break
            }
        }
        if (-not $covered) {
            $selected.Add($path)
        }
    }
    return $selected.ToArray()
}

function Invoke-SvnPathOperation {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('add', 'delete', 'revert')]
        [string]$Action,
        [Parameter(Mandatory = $true)][string[]]$Paths
    )

    if ($Paths.Count -eq 0) {
        return
    }

    $topmostPaths = @(Get-TopmostPaths -Paths $Paths)
    foreach ($batch in Split-PathBatches -Paths $topmostPaths) {
        $arguments = @($Action)
        switch ($Action) {
            'add' {
                $arguments += @('--force', '--parents', '--quiet')
            }
            'delete' {
                $arguments += @('--force', '--quiet')
            }
            'revert' {
                $arguments += @('--depth', 'infinity', '--quiet')
            }
        }
        $arguments += '--'
        $arguments += $batch
        Invoke-SvnCommand `
            -Arguments $arguments `
            -Operation ("SVN {0}" -f $Action)
    }
}

function Invoke-SvnAddRoots {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Paths
    )

    $addedPaths = New-Object System.Collections.Generic.List[string]
    foreach ($batch in @(Split-PathBatches -Paths $Paths)) {
        $arguments = @(
            'add',
            '--force',
            '--parents',
            '--no-ignore',
            '--'
        )
        $arguments += @($batch)
        $result = Invoke-SvnCommand `
            -Arguments $arguments `
            -Operation 'SVN add discovery' `
            -PassThru
        foreach ($line in @($result.Stdout -split '\r?\n')) {
            if ($line -match '^A(?:\s+\(bin\))?\s+(.+?)\s*$') {
                $addedPaths.Add((Get-NormalizedPath -Path $Matches[1]))
            }
        }
    }
    return @(Get-TopmostPaths -Paths $addedPaths.ToArray())
}

function Get-RobocopyDeletedPaths {
    param(
        [Parameter(Mandatory = $true)][string[]]$LogPaths,
        [Parameter(Mandatory = $true)][string]$TargetRoot,
        [AllowEmptyCollection()]
        [string[]]$AdditionalPaths = @()
    )

    $normalizedRoot = Get-NormalizedPath -Path $TargetRoot
    $targetPrefix = $normalizedRoot.TrimEnd('\') + '\'
    $candidateMap = @{}
    foreach ($logPath in $LogPaths) {
        if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
            Stop-Migration -Code 9 -Message (
                "Robocopy mirror log was not found: $logPath"
            )
        }
        foreach ($line in Get-Content -LiteralPath $logPath) {
            $pathStart = $line.IndexOf(
                $targetPrefix,
                [System.StringComparison]::OrdinalIgnoreCase
            )
            if ($pathStart -lt 0) {
                continue
            }
            $candidate = Get-NormalizedPath -Path (
                $line.Substring($pathStart).Trim()
            )
            if (-not (Test-IsUnderPath -Path $candidate -Root $normalizedRoot)) {
                continue
            }
            $relativePath = $candidate.Substring($targetPrefix.Length)
            if (($relativePath -split '\\') -contains '.svn') {
                continue
            }
            $candidateMap[$candidate.ToLowerInvariant()] = $candidate
        }
    }
    foreach ($path in $AdditionalPaths) {
        if ([string]::IsNullOrWhiteSpace($path)) {
            continue
        }
        $candidate = Get-NormalizedPath -Path $path
        if (Test-IsUnderPath -Path $candidate -Root $normalizedRoot) {
            $candidateMap[$candidate.ToLowerInvariant()] = $candidate
        }
    }
    return @(Get-TopmostPaths -Paths @($candidateMap.Values))
}

function Get-SvnStatusForPaths {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Paths
    )

    $records = New-Object System.Collections.Generic.List[object]
    foreach ($batch in @(Split-PathBatches -Paths $Paths)) {
        $arguments = @(
            'status',
            '--xml',
            '--depth', 'empty',
            '--no-ignore',
            '--ignore-externals',
            '--'
        )
        $arguments += @($batch)
        $document = Invoke-SvnXml `
            -Arguments $arguments `
            -Operation 'Targeted SVN status check'
        foreach ($entry in $document.SelectNodes('//entry')) {
            $wcStatus = $entry.SelectSingleNode('wc-status')
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
                    RepositoryItem = ''
                })
        }
    }
    return $records.ToArray()
}

function Assert-SvnRemoteUnchanged {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][long]$BaselineRevision
    )

    $headDocument = Invoke-SvnXml `
        -Arguments @('info', '--xml', '-r', 'HEAD', '--', $Path) `
        -Operation 'SVN repository revision check'
    $headRevision = [long]$headDocument.info.entry.revision
    if ($headRevision -le $BaselineRevision) {
        return
    }

    $range = '{0}:{1}' -f ($BaselineRevision + 1), $headRevision
    $logDocument = Invoke-SvnXml `
        -Arguments @('log', '--xml', '--limit', '1', '-r', $range, '--', $Path) `
        -Operation 'SVN target change check'
    if ($logDocument.SelectSingleNode('/log/logentry')) {
        Stop-Migration -Code 4 -Message (
            ('The WwiseAudio repository changed during migration ' +
                '(after r{0}). Update and run the migration again.') -f
            $BaselineRevision
        )
    }
    Write-Host (
        '  Repository advanced to r{0}, but WwiseAudio did not change.' -f
        $headRevision
    )
}

function Read-SourceManifest {
    param([Parameter(Mandatory = $true)][string]$Root)

    $manifestPath = Join-Path $Root 'ProjectInfo.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        Stop-Migration -Code 2 -Message (
            "Source ProjectInfo.json does not exist: $manifestPath"
        )
    }

    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw |
            ConvertFrom-Json
    }
    catch {
        Stop-Migration -Code 2 -Message (
            'Source ProjectInfo.json is invalid: {0}' -f
            $_.Exception.Message
        )
    }

    $projectInfo = $manifest.ProjectInfo
    if (-not $projectInfo -or -not $projectInfo.Project) {
        Stop-Migration -Code 2 -Message (
            'Source ProjectInfo.json does not contain ProjectInfo.Project.'
        )
    }
    if ([string]$projectInfo.Project.Name -ne 'Seria_WwiseProject' -or
        [string]$projectInfo.Project.GUID -ne
        '{80F762E0-19EE-46F0-A6D1-A54C00970FC8}') {
        Stop-Migration -Code 2 -Message (
            'Source ProjectInfo.json is not the expected Seria Wwise project.'
        )
    }
    if ([string]$projectInfo.Project.Generator -notmatch
        '^\d+\.\d+\.\d+\.\d+$') {
        Stop-Migration -Code 2 -Message (
            'Source ProjectInfo.json has an invalid Wwise Generator version.'
        )
    }
    if ([string]::IsNullOrWhiteSpace([string]$projectInfo.FileHash)) {
        Stop-Migration -Code 2 -Message (
            'Source ProjectInfo.json does not contain ProjectInfo.FileHash.'
        )
    }

    $platforms = @($projectInfo.Platforms)
    $languages = @($projectInfo.Languages)
    if ($platforms.Count -eq 0 -or $languages.Count -eq 0) {
        Stop-Migration -Code 2 -Message (
            'Source ProjectInfo.json must declare platforms and languages.'
        )
    }

    $platformNames = @{}
    $platformPaths = @{}
    foreach ($platform in $platforms) {
        $name = [string]$platform.Name
        $relativePath = [string]$platform.Path
        if ([string]::IsNullOrWhiteSpace($name) -or
            [string]::IsNullOrWhiteSpace($relativePath) -or
            [string]::IsNullOrWhiteSpace([string]$platform.GUID)) {
            Stop-Migration -Code 2 -Message (
                'Every source platform must have Name, Path, and GUID.'
            )
        }
        if ([System.IO.Path]::IsPathRooted($relativePath) -or
            $relativePath.Contains('\') -or
            $relativePath.Contains('/') -or
            $relativePath -in @('.', '..')) {
            Stop-Migration -Code 2 -Message (
                "Unsafe source platform path in ProjectInfo.json: $relativePath"
            )
        }
        $nameKey = $name.ToLowerInvariant()
        $pathKey = $relativePath.ToLowerInvariant()
        if ($platformNames.ContainsKey($nameKey) -or
            $platformPaths.ContainsKey($pathKey)) {
            Stop-Migration -Code 2 -Message (
                'Source ProjectInfo.json contains duplicate platform names or paths.'
            )
        }
        $platformNames[$nameKey] = $true
        $platformPaths[$pathKey] = $true
    }

    $languageNames = @{}
    foreach ($language in $languages) {
        $name = [string]$language.Name
        if ([string]::IsNullOrWhiteSpace($name) -or
            [string]::IsNullOrWhiteSpace([string]$language.Id) -or
            [string]::IsNullOrWhiteSpace([string]$language.GUID)) {
            Stop-Migration -Code 2 -Message (
                'Every source language must have Name, Id, and GUID.'
            )
        }
        $key = $name.ToLowerInvariant()
        if ($languageNames.ContainsKey($key)) {
            Stop-Migration -Code 2 -Message (
                "Duplicate source language: $name"
            )
        }
        $languageNames[$key] = $true
    }

    $declaredDirectories = @{}
    foreach ($platform in $platforms) {
        $declaredDirectories[[string]$platform.Path.ToLowerInvariant()] = $true
    }
    $unexpectedDirectories = @(
        Get-ChildItem -LiteralPath $Root -Directory -Force |
            Where-Object {
                -not $declaredDirectories.ContainsKey(
                    $_.Name.ToLowerInvariant()
                )
            }
    )
    if ($unexpectedDirectories.Count -gt 0) {
        Stop-Migration -Code 2 -Message (
            'Source contains undeclared top-level directories: {0}' -f
            (($unexpectedDirectories | Select-Object -ExpandProperty Name) -join ', ')
        )
    }

    $unexpectedFiles = @(
        Get-ChildItem -LiteralPath $Root -File -Force |
            Where-Object { $_.Name -ne 'ProjectInfo.json' }
    )
    if ($unexpectedFiles.Count -gt 0) {
        Stop-Migration -Code 2 -Message (
            'Source contains unsupported top-level files: {0}' -f
            (($unexpectedFiles | Select-Object -ExpandProperty Name) -join ', ')
        )
    }

    return [pscustomobject]@{
        Path = $manifestPath
        Document = $manifest
        ProjectInfo = $projectInfo
        Platforms = $platforms
        Languages = $languages
    }
}

function Assert-PlatformSource {
    param(
        [Parameter(Mandatory = $true)][object]$Platform,
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $platformRoot = Join-Path $Root ([string]$Platform.Path)
    $platformInfoPath = Join-Path $platformRoot 'PlatformInfo.json'
    $soundbanksInfoPath = Join-Path $platformRoot 'SoundbanksInfo.json'
    if (-not (Test-Path -LiteralPath $platformRoot -PathType Container) -or
        -not (Test-Path -LiteralPath $platformInfoPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $soundbanksInfoPath -PathType Leaf)) {
        Stop-Migration -Code 2 -Message (
            'Source platform {0} is incomplete.' -f $Platform.Name
        )
    }

    try {
        $platformInfo = Get-Content -LiteralPath $platformInfoPath -Raw |
            ConvertFrom-Json
    }
    catch {
        Stop-Migration -Code 2 -Message (
            'Invalid PlatformInfo.json for {0}: {1}' -f
            $Platform.Name,
            $_.Exception.Message
        )
    }

    $info = $platformInfo.PlatformInfo.Platform
    if ([string]$info.Name -ne [string]$Platform.Name -or
        [string]$info.Generator -ne
        [string]$Manifest.ProjectInfo.Project.Generator) {
        Stop-Migration -Code 2 -Message (
            'PlatformInfo.json for {0} does not match ProjectInfo.json.' -f
            $Platform.Name
        )
    }

    foreach ($language in $Manifest.Languages) {
        $languagePath = Join-Path $platformRoot ([string]$language.Name)
        if (-not (Test-Path -LiteralPath $languagePath -PathType Container)) {
            Stop-Migration -Code 2 -Message (
                'Source platform {0} is missing language directory {1}.' -f
                $Platform.Name,
                $language.Name
            )
        }
    }
}

function Find-WwiseProjectRoot {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$WorkingCopyRoot
    )

    $current = Get-Item -LiteralPath $SourceRoot
    $normalizedWorkingCopyRoot = Get-NormalizedPath -Path $WorkingCopyRoot
    while ($current) {
        $projects = @(
            Get-ChildItem `
                -LiteralPath $current.FullName `
                -File `
                -Filter '*.wproj' `
                -ErrorAction Stop
        )
        if ($projects.Count -eq 1) {
            return Get-NormalizedPath -Path $current.FullName
        }
        if ($projects.Count -gt 1) {
            Stop-Migration -Code 2 -Message (
                "Multiple Wwise projects were found in: $($current.FullName)"
            )
        }
        if ((Get-NormalizedPath -Path $current.FullName).Equals(
                $normalizedWorkingCopyRoot,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            break
        }
        $current = $current.Parent
    }
    Stop-Migration -Code 2 -Message (
        'Could not find the Wwise .wproj file above the generated ' +
        "SoundBanks directory: $SourceRoot"
    )
}

function Get-LatestWwiseAuthoringInput {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$GeneratedRoot
    )

    $latest = $null
    foreach ($file in Get-ChildItem `
            -LiteralPath $ProjectRoot `
            -File `
            -Filter '*.wproj' `
            -ErrorAction Stop) {
        if ($null -eq $latest -or
            $file.LastWriteTimeUtc -gt $latest.LastWriteTimeUtc) {
            $latest = $file
        }
    }

    $normalizedGeneratedRoot = Get-NormalizedPath -Path $GeneratedRoot
    $directories = @(
        Get-ChildItem -LiteralPath $ProjectRoot -Directory -Force |
            Where-Object {
                $_.Name -notin @('.svn', '.vs', 'Tests') -and
                -not (Get-NormalizedPath -Path $_.FullName).Equals(
                    $normalizedGeneratedRoot,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            }
    )
    foreach ($directory in $directories) {
        if ($directory.Name -eq 'Originals') {
            $inputFiles = Get-ChildItem `
                -LiteralPath $directory.FullName `
                -Recurse `
                -File `
                -Force `
                -ErrorAction Stop
            foreach ($file in $inputFiles) {
                if ($null -eq $latest -or
                    $file.LastWriteTimeUtc -gt $latest.LastWriteTimeUtc) {
                    $latest = $file
                }
            }
            continue
        }

        foreach ($extension in @('*.wwu', '*.wsources')) {
            $inputFiles = Get-ChildItem `
                -LiteralPath $directory.FullName `
                -Recurse `
                -File `
                -Filter $extension `
                -Force `
                -ErrorAction Stop
            foreach ($file in $inputFiles) {
                if ($null -eq $latest -or
                    $file.LastWriteTimeUtc -gt $latest.LastWriteTimeUtc) {
                    $latest = $file
                }
            }
        }
    }

    if ($null -eq $latest) {
        Stop-Migration -Code 2 -Message (
            "No Wwise authoring input was found below: $ProjectRoot"
        )
    }
    return $latest
}

function Get-WwiseReceiptPath {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$RepositoryUuid
    )

    $receiptRoot = $env:SERIA_WWISE_RECEIPT_ROOT
    if ([string]::IsNullOrWhiteSpace($receiptRoot)) {
        $receiptRoot = Join-Path $env:LOCALAPPDATA (
            'SeriaWwiseMigration\Receipts'
        )
    }
    $identity = '{0}|{1}' -f (
        $SourceRoot.ToLowerInvariant()
    ), $RepositoryUuid.ToLowerInvariant()
    $name = (Get-Sha256Text -Text $identity).ToLowerInvariant() + '.json'
    return Join-Path (Get-NormalizedPath -Path $receiptRoot) $name
}

function Confirm-WwiseGenerationReceipt {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][object]$SourceSvnState,
        [switch]$Preview
    )

    $projectInfo = Get-Item -LiteralPath $Manifest.Path
    $latestInput = Get-LatestWwiseAuthoringInput `
        -ProjectRoot $ProjectRoot `
        -GeneratedRoot $SourceRoot
    $generationTolerance = [TimeSpan]::FromMinutes(5)
    if ($projectInfo.LastWriteTimeUtc + $generationTolerance -lt
        $latestInput.LastWriteTimeUtc) {
        $relativeInput = $latestInput.FullName.Substring(
            $ProjectRoot.Length + 1
        )
        Stop-Migration -Code 2 -Message (
            ('Generated SoundBanks are stale. ProjectInfo.json is from {0:u}, ' +
                'but authoring input {1} was changed at {2:u}. Regenerate all ' +
                'SoundBanks in Wwise before migrating.') -f
            $projectInfo.LastWriteTimeUtc,
            $relativeInput,
            $latestInput.LastWriteTimeUtc
        )
    }

    $platforms = @(
        $Manifest.Platforms | ForEach-Object { [string]$_.Name }
    )
    $languages = @(
        $Manifest.Languages | ForEach-Object { [string]$_.Name }
    )
    $relativeLatestInput = $latestInput.FullName.Substring(
        $ProjectRoot.Length + 1
    )
    $receipt = [ordered]@{
        SchemaVersion = 1
        SourcePath = $SourceRoot
        SourceWorkingCopyRoot = (
            $SourceSvnState.Descriptor.WorkingCopyRoot
        )
        SourceUrl = $SourceSvnState.Descriptor.Url
        RepositoryUuid = $SourceSvnState.Descriptor.RepositoryUuid
        SourceRevision = (
            $SourceSvnState.Version.MaximumRevision
        )
        ProjectInfoSha256 = Get-Sha256File -Path $Manifest.Path
        ProjectInfoFileHash = [string]$Manifest.ProjectInfo.FileHash
        GeneratedAtUtc = $projectInfo.LastWriteTimeUtc.ToString('o')
        LatestAuthoringInputPath = $relativeLatestInput
        LatestAuthoringInputUtc = $latestInput.LastWriteTimeUtc.ToString('o')
        Platforms = $platforms
        Languages = $languages
        RecordedAtUtc = [System.DateTime]::UtcNow.ToString('o')
    }
    $receiptPath = Get-WwiseReceiptPath `
        -SourceRoot $SourceRoot `
        -RepositoryUuid $SourceSvnState.Descriptor.RepositoryUuid
    $existing = $null
    if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
        try {
            $existing = Get-Content -LiteralPath $receiptPath -Raw |
                ConvertFrom-Json
        }
        catch {
            Write-Host '  Existing generation receipt is invalid; refreshing it.'
        }
    }

    $receiptIsCurrent = $null -ne $existing -and
        [int]$existing.SchemaVersion -eq $receipt.SchemaVersion -and
        [string]$existing.SourcePath -eq $receipt.SourcePath -and
        [string]$existing.SourceUrl -eq $receipt.SourceUrl -and
        [string]$existing.RepositoryUuid -eq $receipt.RepositoryUuid -and
        [long]$existing.SourceRevision -eq $receipt.SourceRevision -and
        [string]$existing.ProjectInfoSha256 -eq $receipt.ProjectInfoSha256 -and
        [string]$existing.ProjectInfoFileHash -eq
            $receipt.ProjectInfoFileHash -and
        [string]$existing.GeneratedAtUtc -eq $receipt.GeneratedAtUtc -and
        [string]$existing.LatestAuthoringInputPath -eq
            $receipt.LatestAuthoringInputPath -and
        [string]$existing.LatestAuthoringInputUtc -eq
            $receipt.LatestAuthoringInputUtc -and
        (@($existing.Platforms) | ConvertTo-Json -Compress) -eq
            ($platforms | ConvertTo-Json -Compress) -and
        (@($existing.Languages) | ConvertTo-Json -Compress) -eq
            ($languages | ConvertTo-Json -Compress)

    if ($receiptIsCurrent) {
        Write-Host (
            '  SoundBanks generation receipt is current at source r{0}.' -f
            $receipt.SourceRevision
        )
        return [pscustomobject]@{
            Path = $receiptPath
            Status = 'Current'
            SourceRevision = $receipt.SourceRevision
        }
    }

    if ($Preview) {
        Write-Host (
            '  SoundBanks generation receipt would be refreshed at source r{0}.' -f
            $receipt.SourceRevision
        )
        return [pscustomobject]@{
            Path = $receiptPath
            Status = 'WouldRefresh'
            SourceRevision = $receipt.SourceRevision
        }
    }

    $receiptDirectory = Split-Path -Parent $receiptPath
    New-Item -ItemType Directory -Path $receiptDirectory -Force | Out-Null
    $temporaryPath = '{0}.{1}.tmp' -f $receiptPath, $PID
    try {
        $receipt |
            ConvertTo-Json -Depth 5 |
            Set-Content -LiteralPath $temporaryPath -Encoding UTF8
        Move-Item `
            -LiteralPath $temporaryPath `
            -Destination $receiptPath `
            -Force
    }
    finally {
        Remove-Item `
            -LiteralPath $temporaryPath `
            -Force `
            -ErrorAction SilentlyContinue
    }
    Write-Host (
        '  SoundBanks generation receipt recorded at source r{0}.' -f
        $receipt.SourceRevision
    )
    return [pscustomobject]@{
        Path = $receiptPath
        Status = 'Refreshed'
        SourceRevision = $receipt.SourceRevision
    }
}

function Get-SourceFingerprint {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][object[]]$Platforms
    )

    $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
    $files.Add((Get-Item -LiteralPath (Join-Path $Root 'ProjectInfo.json')))
    foreach ($platform in $Platforms) {
        $platformRoot = Join-Path $Root ([string]$platform.Path)
        foreach ($file in Get-ChildItem -LiteralPath $platformRoot -File -Force) {
            $files.Add($file)
        }
    }

    $records = New-Object System.Collections.Generic.List[object]
    foreach ($file in $files | Sort-Object FullName) {
        $records.Add([pscustomobject]@{
                RelativePath = $file.FullName.Substring($Root.Length + 1)
                Length = $file.Length
                LastWriteTimeUtcTicks = $file.LastWriteTimeUtc.Ticks
                Sha256 = Get-Sha256File -Path $file.FullName
            })
    }
    return $records.ToArray()
}

function Assert-FingerprintUnchanged {
    param(
        [Parameter(Mandatory = $true)][object[]]$Expected,
        [Parameter(Mandatory = $true)][object[]]$Actual,
        [Parameter(Mandatory = $true)][string]$Stage
    )

    $expectedJson = $Expected | ConvertTo-Json -Compress
    $actualJson = $Actual | ConvertTo-Json -Compress
    if ($expectedJson -ne $actualJson) {
        Stop-Migration -Code 5 -Message (
            ('The Wwise source changed during {0}. No further deletion was allowed; ' +
                'regenerate the banks if needed and run the migration again.') -f
            $Stage
        )
    }
}

function Invoke-RobocopyPass {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Additive', 'Mirror', 'Preview', 'Verify')]
        [string]$Mode,
        [Parameter(Mandatory = $true)][string]$LogName
    )

    $logPath = Join-Path $script:RunDirectory $LogName
    $arguments = @(
        $Source,
        $Target,
        '*',
        '/XJ',
        '/XD', '.svn',
        '/R:2',
        '/W:1',
        '/COPY:DAT',
        '/DCOPY:DAT',
        '/NP'
    )

    switch ($Mode) {
        'Additive' {
            $arguments += @(
                '/E',
                '/MT:32',
                '/FP',
                '/BYTES',
                '/NJH',
                '/NJS',
                "/UNILOG:$logPath"
            )
        }
        'Mirror' {
            $arguments += @(
                '/MIR',
                '/MT:32',
                '/FP',
                '/BYTES',
                '/NJH',
                '/NJS',
                "/UNILOG:$logPath"
            )
        }
        'Preview' {
            $arguments += @(
                '/MIR',
                '/L',
                '/BYTES',
                '/FP',
                "/UNILOG:$logPath"
            )
            if (-not $Detail) {
                $arguments += @('/NFL', '/NDL')
            }
        }
        'Verify' {
            $arguments += @(
                '/MIR',
                '/L',
                '/R:0',
                '/W:0',
                '/NFL',
                '/NDL',
                '/NJH',
                '/NJS'
            )
        }
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = 'robocopy.exe'
    $startInfo.Arguments = (
        $arguments |
            ForEach-Object { ConvertTo-NativeArgument -Value $_ }
    ) -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    $startedAt = [System.DateTime]::UtcNow
    $nextProgressAt = 10
    $reportedProgress = $false
    $progressLabel = 'Robocopy {0} for {1}' -f (
        $Mode.ToLowerInvariant()
    ), (Split-Path -Leaf $Target)
    while (-not $process.WaitForExit(1000)) {
        $elapsedSeconds = [int][Math]::Floor(
            ([System.DateTime]::UtcNow - $startedAt).TotalSeconds
        )
        if ($elapsedSeconds -ge $nextProgressAt) {
            Write-Host (
                '  {0} is still running... {1}s elapsed.' -f
                $progressLabel,
                $elapsedSeconds
            )
            $reportedProgress = $true
            $nextProgressAt += 10
        }
    }
    $process.WaitForExit()
    $exitCode = $process.ExitCode
    $process.Dispose()
    if ($reportedProgress) {
        $elapsedSeconds = [int][Math]::Floor(
            ([System.DateTime]::UtcNow - $startedAt).TotalSeconds
        )
        Write-Host (
            '  {0} completed after {1}s.' -f
            $progressLabel,
            $elapsedSeconds
        )
    }
    if ($exitCode -ge 8) {
        Stop-Migration -Code 8 -Message (
            'Robocopy {0} failed for {1} with exit code {2}.' -f
            $Mode,
            $Source,
            $exitCode
        )
    }
    if ($Mode -eq 'Verify' -and $exitCode -ne 0) {
        Stop-Migration -Code 9 -Message (
            ('Post-copy verification found a remaining difference in {0} ' +
                '(Robocopy exit code {1}).') -f
            $Target,
            $exitCode
        )
    }
    if ($Mode -eq 'Preview' -and
        (Test-Path -LiteralPath $logPath -PathType Leaf)) {
        $logLines = @(Get-Content -LiteralPath $logPath)
        if ($Detail) {
            $logLines | ForEach-Object { Write-Host $_ }
        }
        else {
            $summaryLines = @(
                $logLines | Where-Object {
                    $_ -match '^\s*(Dirs|Files|Bytes)\s*:\s+\d'
                }
            )
            $summaryLines | ForEach-Object { Write-Host $_ }
        }
    }
    return $exitCode
}

function Test-IsManagedStatusPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$ManagedPlatforms,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$ExcludedPlatforms,
        [switch]$IncludeExcluded
    )

    $relativePath = Get-RelativeTargetPath -Path $Path -Root $Root
    if ($null -eq $relativePath) {
        return $false
    }
    if ($relativePath.Equals(
            'ProjectInfo.json',
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        return $true
    }

    $platforms = @($ManagedPlatforms)
    if ($IncludeExcluded) {
        $platforms += @($ExcludedPlatforms)
    }
    foreach ($platform in $platforms) {
        $platformPath = [string]$platform.Path
        if ($relativePath.Equals(
                $platformPath,
                [System.StringComparison]::OrdinalIgnoreCase
            ) -or
            $relativePath.StartsWith(
                $platformPath + '\',
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            return $true
        }
    }
    return $false
}

function Test-SourceCounterpartExists {
    param(
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][object[]]$ManagedPlatforms
    )

    $relativePath = Get-RelativeTargetPath -Path $TargetPath -Root $Target
    if ($null -eq $relativePath) {
        return $false
    }
    if ($relativePath.Equals(
            'ProjectInfo.json',
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        return Test-Path -LiteralPath (
            Join-Path $Source 'ProjectInfo.json'
        )
    }

    foreach ($platform in $ManagedPlatforms) {
        $platformPath = [string]$platform.Path
        if ($relativePath.Equals(
                $platformPath,
                [System.StringComparison]::OrdinalIgnoreCase
            ) -or
            $relativePath.StartsWith(
                $platformPath + '\',
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            return Test-Path -LiteralPath (Join-Path $Source $relativePath)
        }
    }
    return $false
}

function Copy-RootManifest {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Target
    )

    Copy-Item `
        -LiteralPath (Join-Path $Source 'ProjectInfo.json') `
        -Destination (Join-Path $Target 'ProjectInfo.json') `
        -Force
}

function Remove-ExcludedPlatform {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    Remove-Item -LiteralPath $Path -Recurse -Force
    if (Test-Path -LiteralPath $Path) {
        Stop-Migration -Code 8 -Message (
            "Failed to remove excluded platform directory: $Path"
        )
    }
}

$profiles = @{
    Trunk = @{
        TargetRoot = 'C:\trunk\res\Content\Seria\WwiseAudio'
        ProjectFile = 'C:\trunk\res\Seria.uproject'
        PlatformNames = $null
    }
    OB17 = @{
        TargetRoot = 'D:\server\17.0\res\Content\Seria\WwiseAudio'
        ProjectFile = 'D:\server\17.0\res\Seria.uproject'
        PlatformNames = $null
    }
    OSOB = @{
        TargetRoot = 'D:\Oversea\OSOB\res\Content\Seria\WwiseAudio'
        ProjectFile = 'D:\Oversea\OSOB\res\Seria.uproject'
        PlatformNames = @('Android', 'iOS', 'PS5', 'Windows')
    }
    OStrunk = @{
        TargetRoot = 'D:\Oversea\OStrunk\res\Content\Seria\WwiseAudio'
        ProjectFile = 'D:\Oversea\OStrunk\res\Seria.uproject'
        PlatformNames = @('Android', 'iOS', 'PS5', 'Windows')
    }
}

$mutex = $null
$lockAcquired = $false
$transcriptStarted = $false
$exitCode = 0

try {
    if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
        $SourceRoot = Join-Path $PSScriptRoot 'GeneratedSoundBanks_2022'
    }
    if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
        $TargetRoot = [string]$profiles[$Profile].TargetRoot
    }
    if ([string]::IsNullOrWhiteSpace($LogRoot)) {
        $LogRoot = Join-Path $env:LOCALAPPDATA 'SeriaWwiseMigration\Logs'
    }

    $SourceRoot = Get-NormalizedPath -Path $SourceRoot
    $TargetRoot = Get-NormalizedPath -Path $TargetRoot
    $LogRoot = Get-NormalizedPath -Path $LogRoot

    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
    $runName = '{0}-{1}-{2}' -f (
        Get-Date -Format 'yyyyMMdd-HHmmss'
    ), $Profile, ([guid]::NewGuid().ToString('N').Substring(0, 8))
    $script:RunDirectory = Join-Path $LogRoot $runName
    New-Item -ItemType Directory -Path $script:RunDirectory | Out-Null
    Start-Transcript `
        -LiteralPath (Join-Path $script:RunDirectory 'console.log') |
        Out-Null
    $transcriptStarted = $true

    Write-Host '========== Wwise Full Migration =========='
    Write-Host "Profile: $Profile"
    Write-Host "Source:  $SourceRoot"
    Write-Host "Target:  $TargetRoot"
    Write-Host ('Mode:    {0}' -f $(if ($Preview) { 'preview' } else { 'execute' }))
    Write-Host "Logs:    $script:RunDirectory"
    Write-Host

    if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
        Stop-Migration -Code 2 -Message (
            "Source directory does not exist: $SourceRoot"
        )
    }
    if (-not (Test-Path -LiteralPath $TargetRoot -PathType Container)) {
        Stop-Migration -Code 3 -Message (
            'Target must already exist as an SVN working copy: {0}' -f
            $TargetRoot
        )
    }
    if (-not (Get-Command robocopy.exe -ErrorAction SilentlyContinue)) {
        Stop-Migration -Code 3 -Message 'robocopy.exe was not found.'
    }
    $svn = Get-Command svn.exe -ErrorAction SilentlyContinue
    if (-not $svn) {
        Stop-Migration -Code 3 -Message 'svn.exe was not found.'
    }
    $script:SvnCommand = $svn.Source
    $svnVersion = Get-Command svnversion.exe -ErrorAction SilentlyContinue
    if (-not $svnVersion) {
        Stop-Migration -Code 3 -Message 'svnversion.exe was not found.'
    }
    $script:SvnVersionCommand = $svnVersion.Source

    $lockHash = Get-Sha256Text -Text $TargetRoot.ToLowerInvariant()
    $mutexName = 'Local\SeriaWwiseMigration_{0}' -f $lockHash.Substring(0, 24)
    $mutex = New-Object System.Threading.Mutex($false, $mutexName)
    try {
        $lockAcquired = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
        $lockAcquired = $true
    }
    if (-not $lockAcquired) {
        Stop-Migration -Code 3 -Message (
            "Another migration is already using this target: $TargetRoot"
        )
    }

    Write-Host '[1/8] Checking source and target SVN freshness...'
    $generatedSourceDescriptor = Get-SvnWorkingCopyDescriptor `
        -Path $SourceRoot
    $wwiseProjectRoot = Find-WwiseProjectRoot `
        -SourceRoot $SourceRoot `
        -WorkingCopyRoot $generatedSourceDescriptor.WorkingCopyRoot
    $sourceSvnState = Get-SvnFreshnessState `
        -Path $wwiseProjectRoot `
        -CheckRemote:(-not $SkipRemoteCheck)

    $targetPreflight = $null
    $updatePaths = New-Object System.Collections.Generic.List[string]
    if ($sourceSvnState.RequiresUpdate) {
        Write-Host (
            '  Source update required: {0}.' -f
            ($sourceSvnState.Reasons -join ', ')
        )
        $updatePaths.Add($sourceSvnState.CheckedPath)
        $targetPreflight = Get-TargetSvnPreflight `
            -Path $TargetRoot `
            -CheckRemote:(-not $SkipRemoteCheck)
        if ($targetPreflight.OutdatedRecords.Count -gt 0) {
            foreach ($entry in $targetPreflight.OutdatedRecords |
                    Select-Object -First 20) {
                Write-Host (
                    '  Remote target change: {0} [{1}]' -f
                    $entry.Path,
                    $entry.RepositoryItem
                )
            }
            $updatePaths.Add($TargetRoot)
        }
    }

    if ($updatePaths.Count -gt 0) {
        if ($Preview) {
            Stop-Migration -Code 4 -Message (
                ('Preview does not modify SVN working copies. SVNmate update ' +
                    'is required for: {0}. Run execute mode, then preview again.') -f
                ($updatePaths -join ', ')
            )
        }
        $svnmateCommand = Resolve-SvnmateCommand `
            -ConfiguredRoot $SvnmateRoot
        [void](Invoke-SvnmateUpdate `
                -Paths $updatePaths.ToArray() `
                -Caller 'seria-wwise-preflight' `
                -Command $svnmateCommand)
    }

    if ($sourceSvnState.RequiresUpdate) {
        $sourceSvnState = Get-SvnFreshnessState `
            -Path $wwiseProjectRoot `
            -CheckRemote:(-not $SkipRemoteCheck)
        if ($sourceSvnState.RequiresUpdate) {
            Stop-Migration -Code 4 -Message (
                'The source remains unsuitable after SVNmate update: {0}.' -f
                ($sourceSvnState.Reasons -join ', ')
            )
        }
    }
    Write-Host (
        '  Source is current at r{0} ({1}).' -f
        $sourceSvnState.Version.MaximumRevision,
        $sourceSvnState.CheckedPath
    )

    Write-Host '[2/8] Validating source metadata and generation receipt...'
    $manifest = Read-SourceManifest -Root $SourceRoot
    $configuredPlatformNames = $profiles[$Profile].PlatformNames
    if ($null -eq $configuredPlatformNames) {
        $managedPlatforms = @($manifest.Platforms)
    }
    else {
        $configuredNames = @($configuredPlatformNames)
        $managedPlatforms = @(
            foreach ($configuredName in $configuredNames) {
                $matches = @(
                    $manifest.Platforms | Where-Object {
                        ([string]$_.Name).Equals(
                            $configuredName,
                            [System.StringComparison]::OrdinalIgnoreCase
                        )
                    }
                )
                if ($matches.Count -ne 1) {
                    Stop-Migration -Code 2 -Message (
                        'Profile {0} requires source platform {1}.' -f
                        $Profile,
                        $configuredName
                    )
                }
                $matches[0]
            }
        )
    }
    $managedNameMap = @{}
    foreach ($platform in $managedPlatforms) {
        $managedNameMap[([string]$platform.Name).ToLowerInvariant()] = $true
        Assert-PlatformSource `
            -Platform $platform `
            -Manifest $manifest `
            -Root $SourceRoot
    }
    $excludedPlatforms = @(
        $manifest.Platforms | Where-Object {
            -not $managedNameMap.ContainsKey(
                ([string]$_.Name).ToLowerInvariant()
            )
        }
    )

    Write-Host (
        '  Wwise: {0}; languages: {1}' -f
        $manifest.ProjectInfo.Project.Generator,
        (($manifest.Languages | ForEach-Object { $_.Name }) -join ', ')
    )
    Write-Host (
        '  Managed platforms: {0}' -f
        (($managedPlatforms | ForEach-Object { $_.Name }) -join ', ')
    )
    if ($excludedPlatforms.Count -gt 0) {
        Write-Host (
            '  Excluded by profile: {0}' -f
            (($excludedPlatforms | ForEach-Object { $_.Name }) -join ', ')
        )
    }
    $generationReceipt = Confirm-WwiseGenerationReceipt `
        -SourceRoot $SourceRoot `
        -ProjectRoot $wwiseProjectRoot `
        -Manifest $manifest `
        -SourceSvnState $sourceSvnState `
        -Preview:$Preview

    Write-Host '[3/8] Validating target SVN and layout...'
    if ($null -eq $targetPreflight -or
        $targetPreflight.OutdatedRecords.Count -gt 0) {
        $targetPreflight = Get-TargetSvnPreflight `
            -Path $TargetRoot `
            -CheckRemote:(-not $SkipRemoteCheck)
    }
    if ($targetPreflight.OutdatedRecords.Count -gt 0) {
        foreach ($entry in $targetPreflight.OutdatedRecords |
                Select-Object -First 20) {
            Write-Host (
                '  Remote target change: {0} [{1}]' -f
                $entry.Path,
                $entry.RepositoryItem
            )
        }
        if ($Preview) {
            Stop-Migration -Code 4 -Message (
                'Preview does not modify SVN working copies. The target ' +
                'requires an SVNmate update before it can be previewed.'
            )
        }
        $svnmateCommand = Resolve-SvnmateCommand `
            -ConfiguredRoot $SvnmateRoot
        [void](Invoke-SvnmateUpdate `
                -Paths @($TargetRoot) `
                -Caller 'seria-wwise-target' `
                -Command $svnmateCommand)
        $targetPreflight = Get-TargetSvnPreflight `
            -Path $TargetRoot `
            -CheckRemote
        Assert-SvnCurrent `
            -StatusRecords $targetPreflight.Records
    }
    $preStatusSnapshot = $targetPreflight.Snapshot
    $preStatus = @($targetPreflight.Records)
    if (-not $SkipRemoteCheck -and
        $null -eq $preStatusSnapshot.RepositoryRevision) {
        Stop-Migration -Code 4 -Message (
            'SVN did not report the repository baseline revision.'
        )
    }
    Write-Host '  Target SVN working copy is current and conflict-free.'

    $allowedTargetDirectories = @{}
    foreach ($platform in $manifest.Platforms) {
        $allowedTargetDirectories[
            ([string]$platform.Path).ToLowerInvariant()
        ] = $true
    }
    $unknownTargetDirectories = @(
        Get-ChildItem -LiteralPath $TargetRoot -Directory -Force |
            Where-Object {
                $_.Name -ne '.svn' -and
                -not $allowedTargetDirectories.ContainsKey(
                    $_.Name.ToLowerInvariant()
                )
            }
    )
    if ($unknownTargetDirectories.Count -gt 0) {
        Stop-Migration -Code 3 -Message (
            ('Target contains unknown top-level directories that will not be ' +
                'deleted automatically: {0}') -f
            (($unknownTargetDirectories |
                    Select-Object -ExpandProperty Name) -join ', ')
        )
    }
    Write-Host '  Target layout is compatible with the source manifest.'

    Write-Host '[4/8] Capturing source stability fingerprint...'
    $sourceFingerprint = @(
        Get-SourceFingerprint `
            -Root $SourceRoot `
            -Platforms $managedPlatforms
    )
    $sourceFingerprint |
        ConvertTo-Json -Depth 4 |
        Set-Content `
            -LiteralPath (Join-Path $script:RunDirectory 'source-fingerprint.json') `
            -Encoding UTF8
    Write-Host (
        '  Fingerprinted {0} generated metadata file(s).' -f
        $sourceFingerprint.Count
    )

    $restorePaths = @(
        $preStatus | Where-Object {
            $_.Item -in @('deleted', 'replaced') -and
            (Test-SourceCounterpartExists `
                -TargetPath $_.Path `
                -Target $TargetRoot `
                -Source $SourceRoot `
                -ManagedPlatforms $managedPlatforms)
        } | Select-Object -ExpandProperty Path
    )

    if ($Preview) {
        Write-Host '[5/8] Previewing the exact mirror plan...'
        $sourceManifestHash = Get-Sha256File -Path $manifest.Path
        $targetManifestPath = Join-Path $TargetRoot 'ProjectInfo.json'
        $targetManifestHash = if (
            Test-Path -LiteralPath $targetManifestPath -PathType Leaf
        ) {
            Get-Sha256File -Path $targetManifestPath
        }
        else {
            ''
        }
        if ($sourceManifestHash -ne $targetManifestHash) {
            Write-Host "  [UPDATE] $targetManifestPath"
        }
        else {
            Write-Host '  ProjectInfo.json is current.'
        }

        foreach ($path in $restorePaths) {
            Write-Host "  [SVN RESTORE] $path"
        }
        foreach ($platform in $managedPlatforms) {
            Write-Host
            Write-Host ("  ----- {0} -----" -f $platform.Name)
            [void](Invoke-RobocopyPass `
                    -Source (Join-Path $SourceRoot ([string]$platform.Path)) `
                    -Target (Join-Path $TargetRoot ([string]$platform.Path)) `
                    -Mode Preview `
                    -LogName ("preview-{0}.log" -f $platform.Name))
        }
        foreach ($platform in $excludedPlatforms) {
            $excludedPath = Join-Path $TargetRoot ([string]$platform.Path)
            if (Test-Path -LiteralPath $excludedPath) {
                Write-Host "  [DELETE EXCLUDED PLATFORM] $excludedPath"
            }
        }

        $finalPreviewFingerprint = @(
            Get-SourceFingerprint `
                -Root $SourceRoot `
                -Platforms $managedPlatforms
        )
        Assert-FingerprintUnchanged `
            -Expected $sourceFingerprint `
            -Actual $finalPreviewFingerprint `
            -Stage 'preview'
        Write-Host
        Write-Host '========== Preview Complete =========='
    }
    else {
        if (-not $SkipEditorStop) {
            Write-Host '[5/8] Stopping the target UE4Editor if it is running...'
            $editors = @(
                Get-ProjectUnrealEditorProcesses `
                    -UprojectPath ([string]$profiles[$Profile].ProjectFile)
            )
            if ($editors.Count -gt 0) {
                $editors | ForEach-Object {
                    Stop-Process -Id $_.ProcessId -Force
                }
                Write-Host ("  Stopped {0} process(es)." -f $editors.Count)
            }
            else {
                Write-Host '  The target UE4Editor is not running.'
            }
        }
        else {
            Write-Host '[5/8] UE4Editor stop skipped by request.'
        }

        if ($restorePaths.Count -gt 0) {
            Write-Host (
                '  Restoring {0} source-owned SVN deletion(s) before copy...' -f
                $restorePaths.Count
            )
            Invoke-SvnPathOperation -Action revert -Paths $restorePaths
        }

        Write-Host '[6/8] Additive copy (no target deletions)...'
        Copy-RootManifest -Source $SourceRoot -Target $TargetRoot
        foreach ($platform in $managedPlatforms) {
            Write-Host ("  Copying {0}..." -f $platform.Name)
            [void](Invoke-RobocopyPass `
                    -Source (Join-Path $SourceRoot ([string]$platform.Path)) `
                    -Target (Join-Path $TargetRoot ([string]$platform.Path)) `
                    -Mode Additive `
                    -LogName ("additive-{0}.log" -f $platform.Name))
        }

        $afterAdditiveFingerprint = @(
            Get-SourceFingerprint `
                -Root $SourceRoot `
                -Platforms $managedPlatforms
        )
        Assert-FingerprintUnchanged `
            -Expected $sourceFingerprint `
            -Actual $afterAdditiveFingerprint `
            -Stage 'the additive copy'
        Write-Host '  Source remained stable; deletions are now allowed.'

        Write-Host '[7/8] Removing stale target files and excluded platforms...'
        $mirrorLogPaths = New-Object System.Collections.Generic.List[string]
        foreach ($platform in $managedPlatforms) {
            Write-Host ("  Mirroring {0}..." -f $platform.Name)
            $mirrorLogName = "mirror-{0}.log" -f $platform.Name
            [void](Invoke-RobocopyPass `
                    -Source (Join-Path $SourceRoot ([string]$platform.Path)) `
                    -Target (Join-Path $TargetRoot ([string]$platform.Path)) `
                    -Mode Mirror `
                    -LogName $mirrorLogName)
            $mirrorLogPaths.Add((Join-Path $script:RunDirectory $mirrorLogName))
        }
        $removedExcludedPaths = New-Object System.Collections.Generic.List[string]
        foreach ($platform in $excludedPlatforms) {
            $excludedPath = Join-Path $TargetRoot ([string]$platform.Path)
            if (Test-Path -LiteralPath $excludedPath) {
                Write-Host ("  Removing excluded {0}..." -f $platform.Name)
                $removedExcludedPaths.Add($excludedPath)
                Remove-ExcludedPlatform -Path $excludedPath
            }
        }

        Write-Host '[8/8] Verifying zero diff and reconciling SVN...'
        Write-Host (
            '  Checking exact mirrors for {0} platform(s)...' -f
            $managedPlatforms.Count
        )
        $sourceManifestHash = Get-Sha256File -Path $manifest.Path
        $targetManifestHash = Get-Sha256File -Path (
            Join-Path $TargetRoot 'ProjectInfo.json'
        )
        if ($sourceManifestHash -ne $targetManifestHash) {
            Stop-Migration -Code 9 -Message (
                'ProjectInfo.json differs after synchronization.'
            )
        }
        $verifyIndex = 0
        foreach ($platform in $managedPlatforms) {
            $verifyIndex++
            Write-Host (
                '  [verify {0}/{1}] Checking {2}...' -f
                $verifyIndex,
                $managedPlatforms.Count,
                $platform.Name
            )
            [void](Invoke-RobocopyPass `
                    -Source (Join-Path $SourceRoot ([string]$platform.Path)) `
                    -Target (Join-Path $TargetRoot ([string]$platform.Path)) `
                    -Mode Verify `
                    -LogName ("verify-{0}.log" -f $platform.Name))
        }
        foreach ($platform in $excludedPlatforms) {
            $excludedPath = Join-Path $TargetRoot ([string]$platform.Path)
            if (Test-Path -LiteralPath $excludedPath) {
                Stop-Migration -Code 9 -Message (
                    "Excluded platform still exists: $excludedPath"
                )
            }
        }
        Write-Host '  File mirrors have zero differences.'

        Write-Host (
            '  Discovering new SVN paths without hashing every copied file...'
        )
        $svnAddScanRoots = @(
            (Join-Path $TargetRoot 'ProjectInfo.json')
            $managedPlatforms | ForEach-Object {
                Join-Path $TargetRoot ([string]$_.Path)
            }
        )
        $addPaths = @(Invoke-SvnAddRoots -Paths $svnAddScanRoots)
        if ($addPaths.Count -gt 0) {
            Write-Host ("  Scheduled {0} SVN add root(s)." -f $addPaths.Count)
        }
        else {
            Write-Host '  No SVN add operation was needed.'
        }

        $preMissingPaths = @(
            $preStatus | Where-Object {
                $_.Item -eq 'missing' -and
                (Test-IsManagedStatusPath `
                    -Path $_.Path `
                    -Root $TargetRoot `
                    -ManagedPlatforms $managedPlatforms `
                    -ExcludedPlatforms $excludedPlatforms `
                    -IncludeExcluded)
            } | Select-Object -ExpandProperty Path
        )
        $deleteCandidates = @(Get-RobocopyDeletedPaths `
                -LogPaths $mirrorLogPaths.ToArray() `
                -TargetRoot $TargetRoot `
                -AdditionalPaths @(
                    $preMissingPaths
                    $removedExcludedPaths.ToArray()
                ))
        $deleteCandidateStatus = @(
            if ($deleteCandidates.Count -gt 0) {
                Get-SvnStatusForPaths -Paths $deleteCandidates
            }
        )
        Assert-NoSvnConflicts -StatusRecords $deleteCandidateStatus
        $deletePaths = @(
            $deleteCandidateStatus | Where-Object {
                $_.Item -eq 'missing'
            } | Select-Object -ExpandProperty Path
        )
        $deletePaths = @(Get-TopmostPaths -Paths $deletePaths)
        if ($deletePaths.Count -gt 0) {
            Write-Host (
                "  Scheduling {0} SVN delete path(s)..." -f
                $deletePaths.Count
            )
            Invoke-SvnPathOperation -Action delete -Paths $deletePaths
        }
        else {
            Write-Host '  No SVN delete operation was needed.'
        }

        $targetedVerificationPaths = @(Get-TopmostPaths -Paths @(
                $addPaths
                $deleteCandidates
            ))
        $targetedStatus = @(
            if ($targetedVerificationPaths.Count -gt 0) {
                Get-SvnStatusForPaths -Paths $targetedVerificationPaths
            }
        )
        Assert-NoSvnConflicts -StatusRecords $targetedStatus
        $unreconciled = @(
            $targetedStatus | Where-Object {
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
            Stop-Migration -Code 9 -Message (
                'SVN reconciliation left {0} unmanaged change(s).' -f
                $unreconciled.Count
            )
        }
        if (-not $SkipRemoteCheck) {
            Write-Host '  Checking for remote changes since the preflight...'
            Assert-SvnRemoteUnchanged `
                -Path $TargetRoot `
                -BaselineRevision $preStatusSnapshot.RepositoryRevision
        }
        Write-Host '  Targeted SVN reconciliation completed.'

        $finalFingerprint = @(
            Get-SourceFingerprint `
                -Root $SourceRoot `
                -Platforms $managedPlatforms
        )
        Assert-FingerprintUnchanged `
            -Expected $sourceFingerprint `
            -Actual $finalFingerprint `
            -Stage 'final verification'

        $summary = [ordered]@{
            Result = 'Success'
            Profile = $Profile
            Source = $SourceRoot
            Target = $TargetRoot
            Generator = [string]$manifest.ProjectInfo.Project.Generator
            Languages = @($manifest.Languages | ForEach-Object { $_.Name })
            ManagedPlatforms = @(
                $managedPlatforms | ForEach-Object { $_.Name }
            )
            ExcludedPlatforms = @(
                $excludedPlatforms | ForEach-Object { $_.Name }
            )
            SourceRevision = $generationReceipt.SourceRevision
            GenerationReceipt = $generationReceipt.Status
            SvnAddRoots = $addPaths.Count
            SvnDeleteRoots = $deletePaths.Count
            SvnReconcileMode = 'Targeted'
            CompletedAt = (Get-Date).ToString('o')
        }
        $summary |
            ConvertTo-Json -Depth 5 |
            Set-Content `
                -LiteralPath (Join-Path $script:RunDirectory 'summary.json') `
                -Encoding UTF8

        Write-Host
        Write-Host '========== Migration Complete =========='
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
