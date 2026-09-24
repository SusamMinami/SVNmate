[CmdletBinding()]
param(
    [ValidateSet("QA", "DLSS5", "All")]
    [string]$Package = "All",
    [string]$OutputDirectory = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $PSScriptRoot "dist"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

function Build-Package {
    param([string]$SourceManifestPath)

    $manifest = Get-Content -LiteralPath $SourceManifestPath -Raw | ConvertFrom-Json
    $packageName = "$($manifest.archivePrefix)-$($manifest.packageVersion)"
    $stagingRoot = Join-Path $env:TEMP "$packageName-staging"
    $packageRoot = Join-Path $stagingRoot $packageName
    $payloadTarget = Join-Path $packageRoot "payload"
    $archivePath = Join-Path $OutputDirectory "$packageName.zip"

    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $payloadTarget -Force | Out-Null

    try {
        Copy-Item -LiteralPath $SourceManifestPath `
            -Destination (Join-Path $packageRoot "manifest.json") -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Reapply-DLSS5.ps1") `
            -Destination (Join-Path $packageRoot "Install-SeriaTool.ps1") -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Publish-Persistent-Recovery.ps1") `
            -Destination $packageRoot -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot ([string]$manifest.installerCmd)) `
            -Destination $packageRoot -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot ([string]$manifest.restoreCmd)) `
            -Destination $packageRoot -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot ([string]$manifest.readme)) `
            -Destination (Join-Path $packageRoot "README.txt") -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot "payload\$($manifest.iniTemplate)") `
            -Destination (Join-Path $payloadTarget ([string]$manifest.iniTemplate)) -Force

        if ([string]$manifest.packageId -eq "seria-qa-overlay") {
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot "QUICK_START_CN.txt") `
                -Destination $packageRoot -Force
            foreach ($guiFile in @(
                "Install-SeriaQA-GUI.cmd",
                "Install-SeriaQA-GUI.ps1"
            )) {
                Copy-Item -LiteralPath (Join-Path $PSScriptRoot $guiFile) `
                    -Destination $packageRoot -Force
            }
        }
        else {
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot "DLSS5_UPDATE_AUDIT_2026-09-17.md") `
                -Destination $packageRoot -Force
        }

        foreach ($entry in @($manifest.payloadFiles)) {
            $source = Join-Path (Join-Path $PSScriptRoot "payload") ([string]$entry.path)
            $destination = Join-Path $payloadTarget ([string]$entry.path)
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            Copy-Item -LiteralPath $source -Destination $destination -Force
        }
        foreach ($tree in @($manifest.payloadTrees)) {
            $source = Join-Path (Join-Path $PSScriptRoot "payload") ([string]$tree.path)
            $destination = Join-Path $payloadTarget ([string]$tree.path)
            Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
        }

        if (Test-Path -LiteralPath $archivePath) {
            Remove-Item -LiteralPath $archivePath -Force
        }
        Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -CompressionLevel Optimal
    }
    finally {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    Write-Host "Built: $archivePath"
    Write-Host "SHA256: $hash"
}

if ($Package -in @("QA", "All")) {
    Build-Package (Join-Path $PSScriptRoot "manifest.json")
}
if ($Package -in @("DLSS5", "All")) {
    Build-Package (Join-Path $PSScriptRoot "manifest.dlss5.json")
}
