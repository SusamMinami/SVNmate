[CmdletBinding()]
param(
    [string]$ArchivePath = "",
    [string]$OutputDirectory = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$manifestPath = Join-Path $PSScriptRoot "manifest.json"
$sourcePath = Join-Path $PSScriptRoot "src\SeriaQAInstaller\Program.cs"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $PSScriptRoot "dist"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$packageName = "$($manifest.archivePrefix)-$($manifest.packageVersion)"
if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
    $ArchivePath = Join-Path $OutputDirectory "$packageName.zip"
}
$ArchivePath = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    throw "QA package archive is missing: $ArchivePath"
}
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Installer source is missing: $sourcePath"
}

$cscCandidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$cscPath = $cscCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($cscPath)) {
    throw ".NET Framework C# compiler was not found."
}

$setupName = "$packageName-Setup.exe"
$setupPath = Join-Path $OutputDirectory $setupName
$buildRoot = Join-Path $env:TEMP "$packageName-exe-build"
$assemblyInfoPath = Join-Path $buildRoot "AssemblyInfo.cs"

if (Test-Path -LiteralPath $buildRoot) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null

try {
    $versionParts = @(([string]$manifest.moduleVersion).Split("."))
    while ($versionParts.Count -lt 4) {
        $versionParts += "0"
    }
    $assemblyVersion = ($versionParts[0..3] -join ".")
    $assemblyInfo = @"
using System.Reflection;

[assembly: AssemblyTitle("Seria QA Overlay Setup")]
[assembly: AssemblyProduct("Seria QA Overlay")]
[assembly: AssemblyDescription("Self-extracting graphical installer for Seria QA Overlay")]
[assembly: AssemblyCompany("SVNmate")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
"@
    [IO.File]::WriteAllText(
        $assemblyInfoPath,
        $assemblyInfo,
        (New-Object Text.UTF8Encoding($false))
    )

    if (Test-Path -LiteralPath $setupPath) {
        Remove-Item -LiteralPath $setupPath -Force
    }

    $compilerArguments = @(
        "/nologo",
        "/target:winexe",
        "/platform:anycpu",
        "/optimize+",
        "/debug-",
        "/out:$setupPath",
        "/resource:$ArchivePath,SeriaQA.Package.zip",
        "/reference:System.dll",
        "/reference:System.Core.dll",
        "/reference:System.Drawing.dll",
        "/reference:System.Windows.Forms.dll",
        "/reference:System.IO.Compression.dll",
        "/reference:System.IO.Compression.FileSystem.dll",
        $assemblyInfoPath,
        $sourcePath
    )
    & $cscPath @compilerArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to compile the self-extracting GUI installer."
    }
}
finally {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) {
    throw "Expected setup executable was not produced: $setupPath"
}

$hash = (Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash
Write-Host "Built GUI setup: $setupPath"
Write-Host "SHA256: $hash"
