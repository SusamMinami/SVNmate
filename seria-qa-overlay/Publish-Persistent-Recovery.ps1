[CmdletBinding()]
param(
    [string]$ManifestPath = "",
    [string]$RecoveryDirectory = "",
    [string]$TargetPath = "",
    [switch]$NoShortcut
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $PSScriptRoot "manifest.json"
}
elseif (-not [IO.Path]::IsPathRooted($ManifestPath)) {
    $ManifestPath = Join-Path $PSScriptRoot $ManifestPath
}
$ManifestPath = [IO.Path]::GetFullPath($ManifestPath)
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    $TargetPath = if ([string]::IsNullOrWhiteSpace($env:SERIA_TRUNK)) {
        Join-Path $env:SystemDrive "trunk"
    }
    else {
        $env:SERIA_TRUNK
    }
}

if ([string]::IsNullOrWhiteSpace($RecoveryDirectory)) {
    $RecoveryDirectory = Join-Path (
        [Environment]::GetFolderPath("MyDocuments")) ([string]$manifest.recoveryDirectoryName)
}

$recoveryRoot = [IO.Path]::GetFullPath($RecoveryDirectory)
$payloadSource = Join-Path $PSScriptRoot "payload"
$payloadTarget = Join-Path $recoveryRoot "payload"

New-Item -ItemType Directory -Path $recoveryRoot -Force | Out-Null
Get-ChildItem -LiteralPath $recoveryRoot -File -ErrorAction SilentlyContinue |
    Remove-Item -Force
if (Test-Path -LiteralPath $payloadTarget) {
    Remove-Item -LiteralPath $payloadTarget -Recurse -Force
}
New-Item -ItemType Directory -Path $payloadTarget -Force | Out-Null

Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $recoveryRoot "manifest.json") -Force
$installerSource = Join-Path $PSScriptRoot "Install-SeriaTool.ps1"
if (-not (Test-Path -LiteralPath $installerSource -PathType Leaf)) {
    $installerSource = Join-Path $PSScriptRoot "Reapply-DLSS5.ps1"
}
Copy-Item -LiteralPath $installerSource `
    -Destination (Join-Path $recoveryRoot "Install-SeriaTool.ps1") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Publish-Persistent-Recovery.ps1") `
    -Destination $recoveryRoot -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot ([string]$manifest.installerCmd)) `
    -Destination $recoveryRoot -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot ([string]$manifest.restoreCmd)) `
    -Destination $recoveryRoot -Force

if ([string]$manifest.packageId -eq "seria-qa-overlay") {
    foreach ($guiFile in @(
        "Install-SeriaQA-GUI.cmd",
        "Install-SeriaQA-GUI.ps1"
    )) {
        $guiSource = Join-Path $PSScriptRoot $guiFile
        if (Test-Path -LiteralPath $guiSource -PathType Leaf) {
            Copy-Item -LiteralPath $guiSource -Destination $recoveryRoot -Force
        }
    }
}

$readmeSource = Join-Path $PSScriptRoot ([string]$manifest.readme)
if (-not (Test-Path -LiteralPath $readmeSource -PathType Leaf)) {
    $readmeSource = Join-Path $PSScriptRoot "README.txt"
}
Copy-Item -LiteralPath $readmeSource -Destination (Join-Path $recoveryRoot "README.txt") -Force
Copy-Item -LiteralPath (Join-Path $payloadSource ([string]$manifest.iniTemplate)) `
    -Destination (Join-Path $payloadTarget ([string]$manifest.iniTemplate)) -Force

foreach ($entry in @($manifest.payloadFiles)) {
    $source = Join-Path $payloadSource ([string]$entry.path)
    $destination = Join-Path $payloadTarget ([string]$entry.path)
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($actual -ne ([string]$entry.sha256).ToUpperInvariant()) {
        throw "Recovery payload hash mismatch: $($entry.path)"
    }
}

foreach ($tree in @($manifest.payloadTrees)) {
    $source = Join-Path $payloadSource ([string]$tree.path)
    $destination = Join-Path $payloadTarget ([string]$tree.path)
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

$desktop = [Environment]::GetFolderPath("Desktop")
if (-not $NoShortcut -and -not [string]::IsNullOrWhiteSpace($desktop)) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $desktop "$($manifest.shortcutName).lnk"))
    $shortcut.TargetPath = Join-Path $recoveryRoot ([string]$manifest.restoreCmd)
    $shortcut.WorkingDirectory = $recoveryRoot
    $shortcut.Arguments = "`"$TargetPath`""
    $shortcut.Description = "Restore $($manifest.displayName) after a trunk update"
    $shortcut.Save()
}

Write-Host "Persistent recovery copy published:" -ForegroundColor Green
Write-Host $recoveryRoot
Write-Host ""
Write-Host "After a trunk update, close Seria and run:" -ForegroundColor Cyan
Write-Host (Join-Path $recoveryRoot ([string]$manifest.restoreCmd))
Write-Host ""
Write-Host "Target: $TargetPath"
