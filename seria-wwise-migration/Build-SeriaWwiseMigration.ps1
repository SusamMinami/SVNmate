[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PSScriptRoot 'SeriaWwiseMigration.exe'
}

$sourcePath = Join-Path $PSScriptRoot 'SeriaWwiseMigration.cs'
$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Source file was not found: $sourcePath"
}
if (-not $compiler) {
    throw 'The .NET Framework C# compiler was not found.'
}

$arguments = @(
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:x64',
    '/utf8output',
    ('/out:{0}' -f $OutputPath),
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    $sourcePath
)

& $compiler @arguments
if ($LASTEXITCODE -ne 0) {
    throw "C# compilation failed with exit code $LASTEXITCODE."
}

$output = Get-Item -LiteralPath $OutputPath
Write-Host (
    'Built {0} ({1:N0} bytes).' -f
    $output.FullName,
    $output.Length
)
