[CmdletBinding()]
param(
    [string]$SeriaRoot = "",
    [switch]$SkipTests,
    [switch]$SkipPackage
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-NuGetPackage {
    param(
        [string]$Id,
        [string]$Version
    )

    $packageRoot = Join-Path $env:USERPROFILE ".nuget\packages\$($Id.ToLowerInvariant())\$Version"
    if (Test-Path -LiteralPath $packageRoot -PathType Container) {
        return $packageRoot
    }

    $cacheRoot = Join-Path $env:TEMP "SeriaQAOverlaySdk"
    $archive = Join-Path $cacheRoot "$Id.$Version.nupkg"
    New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing `
        -Uri "https://www.nuget.org/api/v2/package/$Id/$Version" `
        -OutFile $archive
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $packageRoot, $true)
    return $packageRoot
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
    throw "Visual Studio Installer vswhere.exe was not found."
}

$vsRoot = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ([string]::IsNullOrWhiteSpace($vsRoot)) {
    throw "Visual Studio C++ x64 tools are not installed."
}

$root = $PSScriptRoot
$taskDiagnosticsSource = Join-Path $root "TaskQADiagnostics.lua"
$bootstrapSource = Join-Path $root "SeriaQA.lua"
$vcToolsRoot = Join-Path $vsRoot "VC\Tools\MSVC"
$vcRoot = Get-ChildItem -LiteralPath $vcToolsRoot -Directory |
    Sort-Object Name -Descending |
    Select-Object -First 1
if ($null -eq $vcRoot) {
    throw "MSVC toolset was not found under $vcToolsRoot"
}

$sdkVersion = "10.0.26100.8249"
$sdkBaseVersion = "10.0.26100.0"
$sdkCommon = Ensure-NuGetPackage -Id "Microsoft.Windows.SDK.CPP" -Version $sdkVersion
$sdkX64 = Ensure-NuGetPackage -Id "Microsoft.Windows.SDK.CPP.x64" -Version $sdkVersion

$compilerDir = Join-Path $vcRoot.FullName "bin\Hostx64\x64"
$cl = Join-Path $compilerDir "cl.exe"
$rcDir = Join-Path $sdkCommon "c\bin\$sdkBaseVersion\x64"
$rc = Join-Path $rcDir "rc.exe"
if (-not (Test-Path -LiteralPath $cl -PathType Leaf) -or
    -not (Test-Path -LiteralPath $rc -PathType Leaf)) {
    throw "Portable MSVC/Windows SDK toolchain is incomplete."
}

$sdkInclude = Join-Path $sdkCommon "c\Include\$sdkBaseVersion"
$env:INCLUDE = @(
    (Join-Path $vcRoot.FullName "include"),
    (Join-Path $sdkInclude "ucrt"),
    (Join-Path $sdkInclude "shared"),
    (Join-Path $sdkInclude "um"),
    (Join-Path $sdkInclude "winrt")
) -join ";"
$env:LIB = @(
    (Join-Path $vcRoot.FullName "lib\x64"),
    (Join-Path $sdkX64 "c\ucrt\x64"),
    (Join-Path $sdkX64 "c\um\x64")
) -join ";"
$env:Path = "$compilerDir;$rcDir;$env:Path"

$buildDir = Join-Path $root "build"
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

Push-Location $buildDir
try {
    if (-not $SkipTests) {
        & $cl /nologo /EHsc /O2 /MT /std:c++17 /W4 /WX /utf-8 `
            (Join-Path $root "SnapshotTests.cpp") `
            (Join-Path $root "Snapshot.cpp") `
            "/Fe:$(Join-Path $buildDir 'snapshot-tests.exe')" `
        /link /SUBSYSTEM:CONSOLE /INCREMENTAL:NO /Brepro
        if ($LASTEXITCODE -ne 0) {
            throw "Snapshot parser test build failed."
        }

        if ([string]::IsNullOrWhiteSpace($SeriaRoot)) {
            $SeriaRoot = $env:SERIA_TRUNK
        }
        if ([string]::IsNullOrWhiteSpace($SeriaRoot)) {
            $SeriaRoot = Join-Path $env:SystemDrive "trunk"
        }
        $SeriaRoot = [IO.Path]::GetFullPath($SeriaRoot)
        $lua = Join-Path $SeriaRoot "res\Content\LuaCheck\lua.exe"
        $scriptRoot = (Join-Path $SeriaRoot "res\Content\Seria\Script").Replace("\", "/")
        $generatedSnapshot = Join-Path $buildDir "generated.snapshot"
        if (-not (Test-Path -LiteralPath $lua -PathType Leaf)) {
            throw "Project Lua checker was not found: $lua"
        }
        if (-not (Test-Path -LiteralPath $taskDiagnosticsSource -PathType Leaf) -or
            -not (Test-Path -LiteralPath $bootstrapSource -PathType Leaf)) {
            throw "Seria QA runtime Lua sources are incomplete."
        }

        & $lua (Join-Path $root "Test-TaskQADiagnostics.lua") $generatedSnapshot $scriptRoot
        if ($LASTEXITCODE -ne 0) {
            throw "Lua snapshot integration test failed."
        }
        & $lua "-e" "assert(loadfile([[$taskDiagnosticsSource]])); assert(loadfile([[$bootstrapSource]]))"
        if ($LASTEXITCODE -ne 0) {
            throw "Runtime Lua syntax validation failed."
        }
        & $lua (Join-Path $root "Test-SeriaQABootstrap.lua") $bootstrapSource
        if ($LASTEXITCODE -ne 0) {
            throw "Runtime Lua bootstrap test failed."
        }

        & (Join-Path $buildDir "snapshot-tests.exe") $generatedSnapshot "--generated-fixture"
        if ($LASTEXITCODE -ne 0) {
            throw "Snapshot parser tests failed."
        }
    }

    & $rc /nologo "/i$($sdkInclude)\um" "/i$($sdkInclude)\shared" `
        "/fo$(Join-Path $buildDir 'version.res')" (Join-Path $root "version.rc")
    if ($LASTEXITCODE -ne 0) {
        throw "Version resource build failed."
    }

    & $cl /nologo /LD /EHsc /O2 /MT /std:c++17 /W4 /WX /utf-8 `
        "/I$(Join-Path $root 'third_party\reshade')" `
        "/I$(Join-Path $root 'third_party\imgui')" `
        (Join-Path $root "SeriaQAOverlay.cpp") `
        (Join-Path $root "Snapshot.cpp") `
        "/Fe:$(Join-Path $buildDir 'seria-qa-overlay.addon64')" `
        /link /SUBSYSTEM:WINDOWS /INCREMENTAL:NO /Brepro `
        (Join-Path $buildDir "version.res") user32.lib
    if ($LASTEXITCODE -ne 0) {
        throw "Seria QA Overlay build failed."
    }
}
finally {
    Pop-Location
}

$artifact = Join-Path $buildDir "seria-qa-overlay.addon64"
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "Expected add-on was not produced: $artifact"
}

if (-not $SkipPackage) {
    $payloadRoot = [IO.Path]::GetFullPath((Join-Path $root "..\..\payload"))
    $addonPayload = Join-Path $payloadRoot "seria-qa-overlay.addon64"
    Copy-Item -LiteralPath $artifact -Destination $addonPayload -Force
    Copy-Item -LiteralPath $taskDiagnosticsSource `
        -Destination (Join-Path $payloadRoot "TaskQADiagnostics.lua") -Force
    Copy-Item -LiteralPath $bootstrapSource `
        -Destination (Join-Path $payloadRoot "SeriaQA.lua") -Force
    Write-Host "Packaged: $addonPayload"
    Write-Host "Packaged: $(Join-Path $payloadRoot 'TaskQADiagnostics.lua')"
    Write-Host "Packaged: $(Join-Path $payloadRoot 'SeriaQA.lua')"
}

$hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash
Write-Host "Built: $artifact"
Write-Host "SHA256: $hash"
