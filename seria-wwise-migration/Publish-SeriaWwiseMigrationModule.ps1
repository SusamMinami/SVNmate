[CmdletBinding()]
param(
    [string]$OutputRoot,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $PSScriptRoot 'artifacts\SeriaWwiseMigration'
}
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$packageRoot = Join-Path $OutputRoot 'package'
$archivePath = Join-Path $OutputRoot 'SeriaWwiseMigration.zip'
$manifestPath = Join-Path $OutputRoot 'manifest.json'
$version = (Get-Content -LiteralPath (
        Join-Path $PSScriptRoot 'VERSION'
    ) -Raw).Trim()

$runtimeFiles = @(
    'SeriaWwiseMigration.exe'
    'Invoke-WwiseFullMigration.ps1'
    'Invoke-WwiseMigrationWorkflow.ps1'
    'Invoke-WwiseUnrealReconcile.ps1'
    'Show-WwiseMigration.ps1'
    'Run-WwiseFullMigration.bat'
)

Remove-Item -LiteralPath $packageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

& (Join-Path $PSScriptRoot 'Build-SeriaWwiseMigration.ps1') `
    -OutputPath (Join-Path $packageRoot 'SeriaWwiseMigration.exe')
foreach ($name in $runtimeFiles | Where-Object { $_ -ne 'SeriaWwiseMigration.exe' }) {
    $source = Join-Path $PSScriptRoot $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required runtime file is missing: $source"
    }
    Copy-Item -LiteralPath $source -Destination (
        Join-Path $packageRoot $name
    ) -Force
}
Copy-Item `
    -LiteralPath (Join-Path $PSScriptRoot 'VERSION') `
    -Destination (Join-Path $packageRoot 'VERSION') `
    -Force

Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
Compress-Archive `
    -Path (Join-Path $packageRoot '*') `
    -DestinationPath $archivePath `
    -CompressionLevel Optimal
$sha256 = (Get-FileHash $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    id = 'seria-wwise-migration'
    version = $version
    download_url = (
        'https://github.com/SusamMinami/SVNmate/releases/download/' +
        'seria-wwise-migration-latest/SeriaWwiseMigration.zip'
    )
    sha256 = $sha256
    entrypoint = 'SeriaWwiseMigration.exe'
    files = @($runtimeFiles)
    requires = [ordered]@{
        svnmate_core = '1.1.0'
        capabilities = [ordered]@{
            'update.batch' = 1
            'update.cleanup_retry' = 1
            'update.multi_root_parallel' = 1
            'update.same_root_serial' = 1
        }
    }
}
[IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine,
    (New-Object Text.UTF8Encoding($false))
)

Write-Host "Built module archive: $archivePath"
Write-Host "Manifest:             $manifestPath"
Write-Host "Version:              $version"
Write-Host "SHA-256:              $sha256"

if (-not $Publish) {
    return
}
if (-not (Get-Command gh.exe -ErrorAction SilentlyContinue)) {
    throw 'gh.exe was not found.'
}

$tag = 'seria-wwise-migration-latest'
& gh.exe release view $tag 2>$null | Out-Null
$releaseExists = $LASTEXITCODE -eq 0
if ($releaseExists) {
    & gh.exe release upload `
        $tag `
        $archivePath `
        $manifestPath `
        --clobber
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to upload the Wwise migration module.'
    }
    & gh.exe release edit $tag --latest=false
}
else {
    & gh.exe release create `
        $tag `
        $archivePath `
        $manifestPath `
        --title 'Seria Wwise Migration latest module' `
        --notes 'Fixed update channel managed by SVNmate.' `
        --latest=false
}
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create or update the module release.'
}
