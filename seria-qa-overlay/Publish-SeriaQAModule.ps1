[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$Publish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$releaseTag = "seria-qa-overlay-latest"
$repository = "SusamMinami/SVNmate"
$releaseTitle = "Seria QA Overlay latest module"
$releaseNotes = @"
Manual installation: download the asset ending in -Setup.exe, exit Seria, and
double-click it to open the graphical installer.

The graphical installer checks this fixed channel once per day and can download
the next SHA-256 verified Setup directly. SVNmate uses the same manifest and ZIP.
"@
$sourceManifestPath = Join-Path $PSScriptRoot "manifest.json"
$sourceManifest = Get-Content -LiteralPath $sourceManifestPath -Raw |
    ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace([string]$sourceManifest.moduleVersion)) {
    throw "manifest.json is missing moduleVersion."
}

if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot "src\SeriaQAOverlay\Build-SeriaQAOverlay.ps1")
}

foreach ($entry in @($sourceManifest.payloadFiles)) {
    $payloadPath = Join-Path (
        Join-Path $PSScriptRoot "payload"
    ) ([string]$entry.path)
    if (-not (Test-Path -LiteralPath $payloadPath -PathType Leaf)) {
        throw "Payload file is missing: $payloadPath"
    }
    $actual = (Get-FileHash -LiteralPath $payloadPath -Algorithm SHA256).Hash
    if ($actual -ne ([string]$entry.sha256).ToUpperInvariant()) {
        throw "Payload hash mismatch: $($entry.path)"
    }
}

$dist = Join-Path $PSScriptRoot "dist"
& (Join-Path $PSScriptRoot "Build-SeriaQA-Distribution.ps1") `
    -Package QA `
    -OutputDirectory $dist

$archiveName = (
    "$($sourceManifest.archivePrefix)-" +
    "$($sourceManifest.packageVersion).zip"
)
$archivePath = Join-Path $dist $archiveName
if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    throw "Expected module archive was not produced: $archivePath"
}
$setupName = (
    "$($sourceManifest.archivePrefix)-" +
    "$($sourceManifest.packageVersion)-Setup.exe"
)
$setupPath = Join-Path $dist $setupName
if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) {
    throw "Expected GUI setup executable was not produced: $setupPath"
}

$sha256 = (
    Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
).Hash.ToLowerInvariant()
$downloadUrl = (
    "https://github.com/$repository/releases/download/" +
    "$releaseTag/$archiveName"
)
$setupSha256 = (
    Get-FileHash -LiteralPath $setupPath -Algorithm SHA256
).Hash.ToLowerInvariant()
$setupDownloadUrl = (
    "https://github.com/$repository/releases/download/" +
    "$releaseTag/$setupName"
)
$moduleManifest = [ordered]@{
    id = "seria-qa-overlay"
    version = [string]$sourceManifest.moduleVersion
    download_url = $downloadUrl
    sha256 = $sha256
    entrypoint = [string]$sourceManifest.installerCmd
    setup_url = $setupDownloadUrl
    setup_sha256 = $setupSha256
} | ConvertTo-Json
$moduleManifestPath = Join-Path $dist "module-manifest.json"
[IO.File]::WriteAllText(
    $moduleManifestPath,
    $moduleManifest + [Environment]::NewLine,
    (New-Object Text.UTF8Encoding($false))
)

Write-Host "Built module archive: $archivePath" -ForegroundColor Green
Write-Host "Built GUI setup: $setupPath" -ForegroundColor Green
Write-Host "Built update manifest: $moduleManifestPath" -ForegroundColor Green
Write-Host "SHA256: $sha256"

if (-not $Publish) {
    Write-Host "Remote release was not changed. Pass -Publish to upload." -ForegroundColor Yellow
    exit 0
}

if ($null -eq (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) was not found."
}

function Get-RemoteReleaseAssets {
    $json = & gh api "repos/$repository/releases/tags/$releaseTag"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read the remote module release."
    }
    $release = $json | ConvertFrom-Json
    $json = & gh api (
        "repos/$repository/releases/$($release.id)/assets?per_page=100"
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read the remote module assets."
    }
    $parsedAssets = $json | ConvertFrom-Json
    foreach ($asset in @($parsedAssets)) {
        Write-Output $asset
    }
}

function Publish-ReleaseAsset {
    param([string]$Path)

    $name = [IO.Path]::GetFileName($Path)
    $digest = "sha256:$(
        (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    )"
    $existing = @(Get-RemoteReleaseAssets | Where-Object {
        [string]$_.name -eq $name
    }) | Select-Object -First 1
    if ($null -ne $existing -and
        [string]$existing.state -eq "uploaded" -and
        [string]$existing.digest -eq $digest) {
        Write-Host "Remote asset already matches: $name" -ForegroundColor Green
        return
    }

    if ($null -ne $existing) {
        & gh api --method DELETE (
            "repos/$repository/releases/assets/$($existing.id)"
        )
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to remove stale release asset: $name"
        }
        for ($attempt = 0; $attempt -lt 10; $attempt++) {
            Start-Sleep -Milliseconds 500
            $stillPresent = @(Get-RemoteReleaseAssets | Where-Object {
                [string]$_.name -eq $name
            }).Count -gt 0
            if (-not $stillPresent) {
                break
            }
        }
        if ($stillPresent) {
            throw "Timed out while removing stale release asset: $name"
        }
    }

    & gh release upload $releaseTag $Path --repo $repository
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upload release asset: $name"
    }
}

$previousPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& gh release view $releaseTag --repo $repository 2> $null | Out-Null
$releaseExists = $LASTEXITCODE -eq 0
$ErrorActionPreference = $previousPreference

if ($releaseExists) {
    Publish-ReleaseAsset -Path $archivePath
    Publish-ReleaseAsset -Path $setupPath
    Publish-ReleaseAsset -Path $moduleManifestPath

    foreach ($asset in @(Get-RemoteReleaseAssets)) {
        $name = [string]$asset.name
        $obsoleteArchive = (
            $name -like "$($sourceManifest.archivePrefix)-*.zip" -and
            $name -ne $archiveName
        )
        $obsoleteSetup = (
            $name -like "$($sourceManifest.archivePrefix)-*-Setup.exe" -and
            $name -ne $setupName
        )
        if ($obsoleteArchive -or $obsoleteSetup) {
            & gh api --method DELETE (
                "repos/$repository/releases/assets/$($asset.id)"
            )
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to remove obsolete release asset: $name"
            }
            Write-Host "Removed obsolete remote asset: $name"
        }
    }
    & gh release edit $releaseTag `
        --repo $repository `
        --title $releaseTitle `
        --notes $releaseNotes `
        --latest=false
}
else {
    & gh release create $releaseTag `
        $archivePath `
        $setupPath `
        $moduleManifestPath `
        --repo $repository `
        --title $releaseTitle `
        --notes $releaseNotes `
        --latest=false
}
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create or update the module release."
}

Write-Host "Published: $releaseTag" -ForegroundColor Green
