[CmdletBinding()]
param(
    [string]$TargetPath = "",
    [string]$ManifestPath = "",
    [switch]$Yes,
    [switch]$VerifyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$toolRoot = $PSScriptRoot
$payloadRoot = Join-Path $toolRoot "payload"
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $dlssManifest = Join-Path $toolRoot "manifest.dlss5.json"
    if ([IO.Path]::GetFileName($PSCommandPath) -ieq "Reapply-DLSS5.ps1" -and
        (Test-Path -LiteralPath $dlssManifest -PathType Leaf)) {
        $ManifestPath = $dlssManifest
    }
    else {
        $ManifestPath = Join-Path $toolRoot "manifest.json"
    }
}
elseif (-not [IO.Path]::IsPathRooted($ManifestPath)) {
    $ManifestPath = Join-Path $toolRoot $ManifestPath
}
$ManifestPath = [IO.Path]::GetFullPath($ManifestPath)
$logRoot = Join-Path $toolRoot "logs"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$logPath = Join-Path $logRoot "install-$timestamp.log"
$script:backupPath = $null

function Write-Status {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::Gray
    )

    Write-Host $Message -ForegroundColor $Color
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff') $Message" -Encoding UTF8
}

function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Resolve-SeriaTarget {
    param([string]$InputPath)

    if ([string]::IsNullOrWhiteSpace($InputPath)) {
        return $null
    }

    $expanded = [Environment]::ExpandEnvironmentVariables($InputPath.Trim().Trim('"'))
    $candidates = New-Object System.Collections.Generic.List[string]
    if ([IO.Path]::GetFileName($expanded) -ieq "Seria.exe") {
        $candidates.Add((Split-Path -Parent $expanded))
    }
    else {
        $candidates.Add($expanded)
        $candidates.Add((Join-Path $expanded "Seria\Binaries\Win64"))
        $candidates.Add((Join-Path $expanded "CoAGame\Seria\Binaries\Win64"))
        $candidates.Add((Join-Path $expanded "bin\WindowsNoEditor\Client\Seria\Binaries\Win64"))
    }

    foreach ($candidate in $candidates) {
        $fullCandidate = [IO.Path]::GetFullPath($candidate)
        if (Test-Path -LiteralPath (Join-Path $fullCandidate "Seria.exe") -PathType Leaf) {
            return $fullCandidate
        }
    }
    return $null
}

function Get-TreeHash {
    param([string]$Root)

    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd("\")
    $lines = New-Object System.Collections.Generic.List[string]
    $relativePaths = New-Object System.Collections.Generic.List[string]

    Get-ChildItem -LiteralPath $fullRoot -Recurse -File | ForEach-Object {
        $relativePaths.Add($_.FullName.Substring($fullRoot.Length).TrimStart("\"))
    }
    $relativePaths.Sort([StringComparer]::Ordinal)

    foreach ($relativePath in $relativePaths) {
        $relative = $relativePath.Replace("\", "/")
        $lines.Add("$relative|$((Get-Sha256 (Join-Path $fullRoot $relativePath)).ToLowerInvariant())")
    }

    $content = [string]::Join("`n", $lines)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($content)
        return [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "")
    }
    finally {
        $sha.Dispose()
    }
}

function Ensure-BackupPath {
    if ($null -eq $script:backupPath) {
        $script:backupPath = Join-Path (Join-Path $toolRoot "backups") $timestamp
        New-Item -ItemType Directory -Path $script:backupPath -Force | Out-Null
        Write-Status "Backup directory: $script:backupPath"
    }
    return $script:backupPath
}

function Backup-File {
    param(
        [string]$Path,
        [string]$RelativePath
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    $backupRoot = Ensure-BackupPath
    $backupFile = Join-Path $backupRoot $RelativePath
    $backupParent = Split-Path -Parent $backupFile
    New-Item -ItemType Directory -Path $backupParent -Force | Out-Null
    Copy-Item -LiteralPath $Path -Destination $backupFile -Force
}

function Set-IniValue {
    param(
        [string]$Path,
        [string]$Section,
        [string]$Key,
        [string]$Value,
        [switch]$OnlyIfMissing
    )

    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Get-Content -LiteralPath $Path | ForEach-Object { $lines.Add($_) }
    }

    $sectionHeader = "[$Section]"
    $sectionIndex = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -ieq $sectionHeader) {
            $sectionIndex = $i
            break
        }
    }

    if ($sectionIndex -lt 0) {
        if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -ne "") {
            $lines.Add("")
        }
        $lines.Add($sectionHeader)
        $lines.Add("$Key=$Value")
    }
    else {
        $sectionEnd = $lines.Count
        for ($i = $sectionIndex + 1; $i -lt $lines.Count; $i++) {
            if ($lines[$i].Trim().StartsWith("[") -and $lines[$i].Trim().EndsWith("]")) {
                $sectionEnd = $i
                break
            }
        }

        $keyIndex = -1
        for ($i = $sectionIndex + 1; $i -lt $sectionEnd; $i++) {
            if ($lines[$i] -match "^\s*$([Regex]::Escape($Key))\s*=") {
                $keyIndex = $i
                break
            }
        }

        if ($keyIndex -ge 0) {
            if (-not $OnlyIfMissing) {
                $lines[$keyIndex] = "$Key=$Value"
            }
        }
        else {
            $lines.Insert($sectionEnd, "$Key=$Value")
        }
    }

    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($Path, $lines, $utf8NoBom)
}

function Get-IniValue {
    param(
        [string]$Path,
        [string]$Section,
        [string]$Key
    )

    $currentSection = ""
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.StartsWith("[") -and $trimmed.EndsWith("]")) {
            $currentSection = $trimmed.Substring(1, $trimmed.Length - 2)
            continue
        }
        if ($currentSection -ieq $Section -and
            $line -match "^\s*$([Regex]::Escape($Key))\s*=(.*)$") {
            return $Matches[1].Trim()
        }
    }
    return $null
}

function Test-Installed {
    param(
        [object]$Manifest,
        [string]$Target
    )

    $errors = New-Object System.Collections.Generic.List[string]

    foreach ($relative in @($Manifest.obsoleteFiles)) {
        if (Test-Path -LiteralPath (Join-Path $Target ([string]$relative)) -PathType Leaf) {
            $errors.Add("Obsolete file still present: $relative")
        }
    }

    foreach ($entry in @($Manifest.payloadFiles)) {
        $targetFile = Join-Path $Target ([string]$entry.path)
        if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) {
            $errors.Add("Missing: $($entry.path)")
            continue
        }

        $actual = Get-Sha256 $targetFile
        if ($actual -ne ([string]$entry.sha256).ToUpperInvariant()) {
            $errors.Add("Hash mismatch: $($entry.path)")
        }
    }

    foreach ($tree in @($Manifest.payloadTrees)) {
        $treeSource = Join-Path $payloadRoot ([string]$tree.path)
        $treeTarget = Join-Path $Target ([string]$tree.path)
        foreach ($file in Get-ChildItem -LiteralPath $treeSource -Recurse -File) {
            $relative = $file.FullName.Substring($treeSource.Length).TrimStart("\")
            $targetFile = Join-Path $treeTarget $relative
            if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) {
                $errors.Add("Missing resource: $($tree.path)\$relative")
                continue
            }

            if ((Get-Sha256 $file.FullName) -ne (Get-Sha256 $targetFile)) {
                $errors.Add("Resource hash mismatch: $($tree.path)\$relative")
            }
        }
    }

    $iniPath = Join-Path $Target "ReShade.ini"
    if (-not (Test-Path -LiteralPath $iniPath -PathType Leaf)) {
        $errors.Add("Missing: ReShade.ini")
    }
    else {
        foreach ($setting in @($Manifest.iniValues)) {
            $value = Get-IniValue -Path $iniPath -Section ([string]$setting.section) -Key ([string]$setting.key)
            if ($null -eq $value) {
                $errors.Add("ReShade.ini is missing [$($setting.section)] $($setting.key)")
            }
            elseif ([bool]$setting.verifyExact -and $value -ne [string]$setting.value) {
                $errors.Add("ReShade.ini value mismatch: [$($setting.section)] $($setting.key)")
            }
        }
    }

    if ($Manifest.PSObject.Properties.Name -contains "compatibleResolution") {
        $settingsPath = [IO.Path]::GetFullPath(
            (Join-Path $Target "..\..\Saved\Config\WindowsNoEditor\GameUserSettings.ini")
        )
        if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
            $errors.Add("Missing: GameUserSettings.ini")
        }
        else {
            $settings = Get-Content -LiteralPath $settingsPath -Raw
            $width = [int]$Manifest.compatibleResolution.width
            $height = [int]$Manifest.compatibleResolution.height
            if ($settings -notmatch "(?mi)^ResolutionSizeX=$width\s*$" -or
                $settings -notmatch "(?mi)^ResolutionSizeY=$height\s*$") {
                $errors.Add("Game resolution is not the compatible ${width}x${height}")
            }
        }
    }

    return @($errors)
}

try {
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "Manifest not found: $ManifestPath"
    }

    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    if ([int]$manifest.schemaVersion -ne 2) {
        throw "Unsupported manifest schema: $($manifest.schemaVersion)"
    }
    if ([string]::IsNullOrWhiteSpace($TargetPath)) {
        $localRoot = Split-Path -Parent $toolRoot
        $TargetPath = Resolve-SeriaTarget (Join-Path $localRoot ([string]$manifest.targetRelativePath))
        if ([string]::IsNullOrWhiteSpace($TargetPath)) {
            $TargetPath = Resolve-SeriaTarget (
                Join-Path (Join-Path $env:SystemDrive "trunk") ([string]$manifest.targetRelativePath))
        }
        if ([string]::IsNullOrWhiteSpace($TargetPath)) {
            Write-Host ""
            Write-Host "Paste the game folder, Seria.exe path, or Seria\\Binaries\\Win64 folder." -ForegroundColor Yellow
            $TargetPath = Resolve-SeriaTarget (Read-Host "Game path")
        }
    }
    else {
        $TargetPath = Resolve-SeriaTarget $TargetPath
    }
    if ([string]::IsNullOrWhiteSpace($TargetPath)) {
        throw "Could not locate Seria.exe from the supplied path."
    }
    $TargetPath = [IO.Path]::GetFullPath($TargetPath)
    $targetExe = Join-Path $TargetPath "Seria.exe"

    Write-Status "$($manifest.displayName) Installer $($manifest.packageVersion)" Cyan
    Write-Status "Target: $TargetPath"

    if (-not (Test-Path -LiteralPath $targetExe -PathType Leaf)) {
        throw "Target executable not found: $targetExe"
    }

    $runningTarget = Get-CimInstance Win32_Process -Filter "Name='Seria.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace($_.ExecutablePath) -and
            [string]::Equals(
                [IO.Path]::GetFullPath($_.ExecutablePath),
                [IO.Path]::GetFullPath($targetExe),
                [StringComparison]::OrdinalIgnoreCase
            )
        }
    if ($null -ne $runningTarget) {
        throw "Seria.exe is running from the target directory. Exit the game and run this tool again."
    }

    Write-Status "Validating packaged payload ..."
    foreach ($entry in @($manifest.payloadFiles)) {
        $payloadFile = Join-Path $payloadRoot ([string]$entry.path)
        if (-not (Test-Path -LiteralPath $payloadFile -PathType Leaf)) {
            throw "Payload file missing: $($entry.path)"
        }

        $actual = Get-Sha256 $payloadFile
        $expected = ([string]$entry.sha256).ToUpperInvariant()
        if ($actual -ne $expected) {
            throw "Payload hash mismatch for $($entry.path): $actual"
        }
    }

    foreach ($tree in @($manifest.payloadTrees)) {
        $treeSource = Join-Path $payloadRoot ([string]$tree.path)
        if (-not (Test-Path -LiteralPath $treeSource -PathType Container)) {
            throw "Resource payload missing: $treeSource"
        }
        $treeFiles = @(Get-ChildItem -LiteralPath $treeSource -Recurse -File)
        if ($treeFiles.Count -ne [int]$tree.fileCount) {
            throw "Resource payload file count mismatch for $($tree.path): $($treeFiles.Count)"
        }
        $treeHash = Get-TreeHash $treeSource
        if ($treeHash -ne ([string]$tree.sha256).ToUpperInvariant()) {
            throw "Resource payload tree hash mismatch for $($tree.path): $treeHash"
        }
    }

    if ($VerifyOnly) {
        $verifyErrors = @(Test-Installed -Manifest $manifest -Target $TargetPath)
        if ($verifyErrors.Count -gt 0) {
            foreach ($verifyError in $verifyErrors) {
                Write-Status $verifyError Red
            }
            throw "Installed component verification failed."
        }
        Write-Status "Verification passed. No files were changed." Green
        exit 0
    }

    if (-not $Yes) {
        Write-Host ""
        Write-Host "This will install verified $($manifest.displayName) components into the target." -ForegroundColor Yellow
        Write-Host "Different existing files will be backed up outside the packaged output." -ForegroundColor Yellow
        $answer = Read-Host "Press ENTER to continue, or type Q to cancel"
        if ($answer -match "^[Qq]") {
            Write-Status "Cancelled by user." Yellow
            exit 3
        }
    }

    foreach ($relative in @($manifest.obsoleteFiles)) {
        $obsoleteFile = Join-Path $TargetPath ([string]$relative)
        if (Test-Path -LiteralPath $obsoleteFile -PathType Leaf) {
            Backup-File -Path $obsoleteFile -RelativePath ([string]$relative)
            Remove-Item -LiteralPath $obsoleteFile -Force
            Write-Status "Removed obsolete duplicate: $relative" Green
        }
    }

    foreach ($entry in @($manifest.payloadFiles)) {
        $relative = [string]$entry.path
        $sourceFile = Join-Path $payloadRoot $relative
        $targetFile = Join-Path $TargetPath $relative
        $targetParent = Split-Path -Parent $targetFile
        New-Item -ItemType Directory -Path $targetParent -Force | Out-Null

        if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
            if ((Get-Sha256 $targetFile) -eq (Get-Sha256 $sourceFile)) {
                Write-Status "Already current: $relative" DarkGray
                continue
            }
            Backup-File -Path $targetFile -RelativePath $relative
        }

        Copy-Item -LiteralPath $sourceFile -Destination $targetFile -Force
        Write-Status "Installed: $relative" Green
    }

    foreach ($tree in @($manifest.payloadTrees)) {
        $treeSource = Join-Path $payloadRoot ([string]$tree.path)
        $treeFiles = @(Get-ChildItem -LiteralPath $treeSource -Recurse -File)
        $treeTarget = Join-Path $TargetPath ([string]$tree.path)
        foreach ($file in $treeFiles) {
            $relative = $file.FullName.Substring($treeSource.Length).TrimStart("\")
            $targetFile = Join-Path $treeTarget $relative
            $targetParent = Split-Path -Parent $targetFile
            New-Item -ItemType Directory -Path $targetParent -Force | Out-Null

            if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
                if ((Get-Sha256 $targetFile) -eq (Get-Sha256 $file.FullName)) {
                    continue
                }
                Backup-File -Path $targetFile -RelativePath (Join-Path ([string]$tree.path) $relative)
            }

            Copy-Item -LiteralPath $file.FullName -Destination $targetFile -Force
        }
        Write-Status "Installed resources: $($tree.path) ($($treeFiles.Count) files)" Green
    }

    $iniPath = Join-Path $TargetPath "ReShade.ini"
    if (Test-Path -LiteralPath $iniPath -PathType Leaf) {
        Backup-File -Path $iniPath -RelativePath "ReShade.ini"
    }
    else {
        $iniTemplate = Join-Path $payloadRoot ([string]$manifest.iniTemplate)
        Copy-Item -LiteralPath $iniTemplate -Destination $iniPath
    }

    foreach ($setting in @($manifest.iniValues)) {
        $arguments = @{
            Path = $iniPath
            Section = [string]$setting.section
            Key = [string]$setting.key
            Value = [string]$setting.value
        }
        if ([bool]$setting.onlyIfMissing) {
            $arguments.OnlyIfMissing = $true
        }
        Set-IniValue @arguments
    }
    Write-Status "Updated: ReShade.ini" Green

    if ($manifest.PSObject.Properties.Name -contains "compatibleResolution") {
        $settingsPath = [IO.Path]::GetFullPath(
            (Join-Path $TargetPath "..\..\Saved\Config\WindowsNoEditor\GameUserSettings.ini")
        )
        if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
            throw "Game settings not found: $settingsPath"
        }
        Backup-File -Path $settingsPath -RelativePath "GameUserSettings.ini"
        $width = [string]$manifest.compatibleResolution.width
        $height = [string]$manifest.compatibleResolution.height
        $settingsSection = "/Script/Seria.SeriaGameUserSettings"
        Set-IniValue -Path $settingsPath -Section $settingsSection -Key "ResolutionSizeX" -Value $width
        Set-IniValue -Path $settingsPath -Section $settingsSection -Key "ResolutionSizeY" -Value $height
        Set-IniValue -Path $settingsPath -Section $settingsSection -Key "LastUserConfirmedResolutionSizeX" -Value $width
        Set-IniValue -Path $settingsPath -Section $settingsSection -Key "LastUserConfirmedResolutionSizeY" -Value $height
        Write-Status "Set compatible resolution: ${width}x${height}" Green
    }

    $verifyErrors = @(Test-Installed -Manifest $manifest -Target $TargetPath)
    if ($verifyErrors.Count -gt 0) {
        foreach ($verifyError in $verifyErrors) {
            Write-Status $verifyError Red
        }
        throw "Post-install verification failed."
    }

    Write-Status ""
    Write-Status "SUCCESS: $($manifest.displayName) is installed and verified." Green
    Write-Status "Log: $logPath"
    if ($null -ne $script:backupPath) {
        Write-Status "Backup: $script:backupPath"
    }
    exit 0
}
catch {
    Write-Status "ERROR: $($_.Exception.Message)" Red
    Write-Status "No running game process was terminated."
    exit 1
}
