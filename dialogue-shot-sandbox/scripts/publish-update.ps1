param(
  [string]$Repository = "SusamMinami/SVNmate",
  [string]$Tag = "shot-sandbox-update",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$packagePath = Join-Path $PSScriptRoot "..\package.json"
$releaseNotesPath = Join-Path $PSScriptRoot "..\RELEASE_NOTES.md"
$package = [System.IO.File]::ReadAllText(
  $packagePath,
  [System.Text.Encoding]::UTF8
) | ConvertFrom-Json
$artifacts = Join-Path $PSScriptRoot "..\artifacts"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is required to publish online updates."
}

gh auth status
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI is not authenticated."
}

if (-not $SkipBuild) {
  npm run dist:win
  if ($LASTEXITCODE -ne 0) {
    throw "Windows packaging failed."
  }
}

$ErrorActionPreference = "Continue"
gh release view $Tag --repo $Repository *> $null
$releaseExists = $LASTEXITCODE -eq 0
$ErrorActionPreference = "Stop"
if (-not $releaseExists) {
  gh release create $Tag `
    --repo $Repository `
    --title "Shot Sandbox v$($package.version)" `
    --notes-file $releaseNotesPath `
    --latest=false
} else {
  gh release edit $Tag `
    --repo $Repository `
    --title "Shot Sandbox v$($package.version)" `
    --notes-file $releaseNotesPath
}
if ($LASTEXITCODE -ne 0) {
  throw "Update release metadata failed."
}

$checksumTargets = @(
  (Join-Path $artifacts "Shot-Sandbox-Setup-$($package.version)-x64.exe"),
  (Join-Path $artifacts "Shot-Sandbox-Portable-$($package.version)-x64.exe")
)
$checksumLines = $checksumTargets | ForEach-Object {
  $hash = (Get-FileHash $_ -Algorithm SHA256).Hash
  "$hash  $(Split-Path $_ -Leaf)"
}
[System.IO.File]::WriteAllLines(
  (Join-Path $artifacts "SHA256SUMS.txt"),
  $checksumLines,
  [System.Text.UTF8Encoding]::new($false)
)

$files = @(
  (Join-Path $artifacts "latest.yml"),
  (Join-Path $artifacts "Shot-Sandbox-Setup-$($package.version)-x64.exe"),
  (Join-Path $artifacts "Shot-Sandbox-Setup-$($package.version)-x64.exe.blockmap"),
  (Join-Path $artifacts "Shot-Sandbox-Portable-$($package.version)-x64.exe"),
  (Join-Path $artifacts "SHA256SUMS.txt")
)

gh release upload $Tag $files --repo $Repository --clobber
if ($LASTEXITCODE -ne 0) {
  throw "Update upload failed."
}

Write-Host "Published Shot Sandbox $($package.version) to $Repository/$Tag"
