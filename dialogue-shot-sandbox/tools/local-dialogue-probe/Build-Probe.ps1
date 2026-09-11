param(
    [Parameter(Mandatory = $true)][string]$EngineRoot,
    [switch]$Build,
    [string]$PackagePath
)

$ErrorActionPreference = 'Stop'
$engine = [IO.Path]::GetFullPath($EngineRoot)
$plugin = Join-Path $PSScriptRoot 'LocalDialogueProbe.uplugin'
$required = @(
    'Engine/Source/Runtime/Core/Public/CoreMinimal.h',
    'Engine/Source/Runtime/CoreUObject/Public/UObject/UnrealType.h',
    'Engine/Source/Runtime/Engine/Classes/EdGraph/EdGraphSchema.h',
    'Engine/Source/Editor/UnrealEd/Public/Editor.h',
    'Engine/Source/Editor/UnrealEd/UnrealEd.Build.cs',
    'Engine/Binaries/DotNET/UnrealBuildTool.exe',
    'Engine/Binaries/Win64/UnrealHeaderTool.exe',
    'Engine/Build/BatchFiles/RunUAT.bat'
)
$checks = @($required | ForEach-Object {
    [pscustomobject]@{
        path = $_
        exists = Test-Path -LiteralPath (Join-Path $engine $_) -PathType Leaf
    }
})
$missing = @($checks | Where-Object { -not $_.exists })
[pscustomobject]@{
    engineRoot = $engine
    plugin = $plugin
    checks = $checks
    status = $(if ($missing.Count) { 'missing_development_files' } else { 'file_presence_check_passed' })
    buildRequested = [bool]$Build
    note = 'File presence does not establish SDK, compiler or ABI compatibility. No installation is performed.'
} | ConvertTo-Json -Depth 5
if ($missing.Count) {
    Write-Output 'Build was not started. Obtain the development files matching this custom UE build.'
    exit 2
}
if (-not $Build) {
    exit 0
}
if (-not $PackagePath) {
    throw 'A new --PackagePath directory is required for -Build.'
}
$package = [IO.Path]::GetFullPath($PackagePath)
function Test-Within([string]$Candidate, [string]$Parent) {
    $base = $Parent.TrimEnd('\', '/')
    return $Candidate.Equals($base, [StringComparison]::OrdinalIgnoreCase) -or
        $Candidate.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}
if ((Test-Path -LiteralPath $package) -or
    (Test-Within $package $engine) -or (Test-Within $engine $package) -or
    (Test-Within $package $PSScriptRoot) -or (Test-Within $PSScriptRoot $package)) {
    throw 'PackagePath must be new and must not overlap the engine or plugin source directory.'
}

# BuildPlugin uses a temporary host project, not the production Seria.uproject.
& (Join-Path $engine 'Engine/Build/BatchFiles/RunUAT.bat') `
    -nocompile BuildPlugin "-Plugin=$plugin" "-Package=$package" -TargetPlatforms=Win64
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
$dll = Join-Path $package 'Binaries/Win64/UE4Editor-LocalDialogueProbe.dll'
if (-not (Test-Path -LiteralPath $dll -PathType Leaf)) {
    throw 'UAT exited successfully but the expected editor DLL is absent.'
}
Write-Output "Built: $dll"
Write-Output 'Not installed. Verify compatibility and close UE before any separately approved installation.'
