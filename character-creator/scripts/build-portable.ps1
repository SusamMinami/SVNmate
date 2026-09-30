param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$metadata = Get-Content (Join-Path $project "package.json") -Raw | ConvertFrom-Json
$releaseName = "Character-Creator-Test-$($metadata.version)-win64"
$artifacts = Join-Path $project "artifacts"
$stage = Join-Path $project ".local\package"
$work = Join-Path $project ".local\pyinstaller"
$release = Join-Path $artifacts $releaseName
$zip = Join-Path $artifacts "$releaseName.zip"
$checksum = Join-Path $artifacts "$releaseName.sha256.txt"

Push-Location $project
try {
    if (-not $SkipBuild) {
        npm run build
    }
    if (-not (Test-Path "dist\index.html")) {
        throw "Frontend build is missing. Run npm run build first."
    }

    Remove-Item $stage, $work, $release, $zip, $checksum -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $stage, $work, $release -Force | Out-Null

    pyinstaller `
        --noconfirm `
        --clean `
        --onedir `
        --windowed `
        --name CharacterCreator `
        --distpath $stage `
        --workpath (Join-Path $work "build") `
        --specpath (Join-Path $work "spec") `
        --add-data "$project\dist;dist" `
        --hidden-import pythoncom `
        --hidden-import pywintypes `
        --hidden-import win32com.client `
        --hidden-import win32com.client.dynamic `
        --hidden-import win32com.client.gencache `
        (Join-Path $project "packaged_main.py")
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller failed with exit code $LASTEXITCODE."
    }

    Copy-Item (Join-Path $stage "CharacterCreator\*") $release -Recurse -Force
    Copy-Item "便携版使用说明.txt" (Join-Path $release "使用说明.txt") -Force

    $compressed = $false
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        try {
            Remove-Item $zip -Force -ErrorAction SilentlyContinue
            Compress-Archive -Path $release -DestinationPath $zip -CompressionLevel Optimal
            $compressed = $true
            break
        }
        catch {
            if ($attempt -eq 6) {
                throw
            }
            Start-Sleep -Seconds 2
        }
    }
    if (-not $compressed) {
        throw "Portable archive was not created."
    }
    $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -Path $checksum -Value "$hash  $releaseName.zip" -Encoding ascii

    Write-Output "Portable folder: $release"
    Write-Output "Archive: $zip"
    Write-Output "SHA-256: $hash"
}
finally {
    Pop-Location
}
