[CmdletBinding()]
param(
    [ValidateSet("Check", "Download")]
    [string]$Mode = "Check",
    [string]$CurrentVersion = "",
    [string]$UpdateUrl = "",
    [string]$ExpectedSha256 = "",
    [string]$Version = "",
    [string]$DownloadDirectory = "",
    [string]$UpdateManifestPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$manifestUrl = (
    "https://github.com/SusamMinami/SVNmate/releases/download/" +
    "seria-qa-overlay-latest/module-manifest.json"
)
$allowedDownloadPrefix = (
    "/SusamMinami/SVNmate/releases/download/" +
    "seria-qa-overlay-latest/"
)
$headers = @{
    "User-Agent" = "Seria-QA-Overlay-Updater"
    "Accept" = "application/json"
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Convert-ModuleVersion {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "更新清单缺少版本号。"
    }
    $normalized = $Value.Trim().TrimStart("v")
    try {
        return [Version]::Parse($normalized)
    }
    catch {
        throw "更新清单包含无效版本号：$Value"
    }
}

function Assert-SetupDownload {
    param(
        [string]$Url,
        [string]$Sha256
    )

    try {
        $uri = [Uri]$Url
    }
    catch {
        throw "更新清单中的 Setup 下载地址无效。"
    }
    if ($uri.Scheme -ne "https" -or
        $uri.Host -ne "github.com" -or
        -not $uri.AbsolutePath.StartsWith(
            $allowedDownloadPrefix,
            [StringComparison]::Ordinal
        )) {
        throw "更新清单中的 Setup 下载地址不属于 Seria QA 固定发布通道。"
    }
    $fileName = [Uri]::UnescapeDataString(
        $uri.Segments[$uri.Segments.Length - 1]
    )
    if ($fileName -notmatch "^Seria-QA-Overlay-.+-Setup\.exe$") {
        throw "更新清单中的 Setup 文件名无效。"
    }
    if ($Sha256 -notmatch "^[0-9a-fA-F]{64}$") {
        throw "更新清单缺少有效的 Setup SHA-256。"
    }
    return $uri
}

function Write-Result {
    param([hashtable]$Value)
    [pscustomobject]$Value | ConvertTo-Json -Compress
}

try {
    if ($Mode -eq "Check") {
        $current = Convert-ModuleVersion $CurrentVersion
        $remote = if ([string]::IsNullOrWhiteSpace($UpdateManifestPath)) {
            Invoke-RestMethod `
                -Uri $manifestUrl `
                -Headers $headers `
                -UseBasicParsing `
                -TimeoutSec 20
        }
        else {
            Get-Content -LiteralPath $UpdateManifestPath -Raw |
                ConvertFrom-Json
        }
        if ([string]$remote.id -ne "seria-qa-overlay") {
            throw "远端更新清单的产品标识不匹配。"
        }
        if ([string]$remote.entrypoint -ne "Install-SeriaQA.cmd") {
            throw "远端更新清单的安装入口不匹配。"
        }

        $latest = Convert-ModuleVersion ([string]$remote.version)
        if ($latest -le $current) {
            Write-Result @{
                status = "up_to_date"
                version = $current.ToString()
            }
            exit 0
        }

        $setupUrl = if (
            $remote.PSObject.Properties.Name -contains "setup_url"
        ) {
            [string]$remote.setup_url
        }
        else {
            ""
        }
        $setupSha256 = if (
            $remote.PSObject.Properties.Name -contains "setup_sha256"
        ) {
            [string]$remote.setup_sha256
        }
        else {
            ""
        }
        [void](Assert-SetupDownload -Url $setupUrl -Sha256 $setupSha256)
        Write-Result @{
            status = "update_available"
            version = $latest.ToString()
            setup_url = $setupUrl
            setup_sha256 = $setupSha256.ToUpperInvariant()
        }
        exit 0
    }

    [void](Convert-ModuleVersion $Version)
    $uri = Assert-SetupDownload -Url $UpdateUrl -Sha256 $ExpectedSha256
    if ([string]::IsNullOrWhiteSpace($DownloadDirectory)) {
        $DownloadDirectory = Join-Path (
            [Environment]::GetFolderPath("LocalApplicationData")
        ) "SVNmate\SeriaQAOverlay\updates"
    }
    $DownloadDirectory = [IO.Path]::GetFullPath($DownloadDirectory)
    New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null

    $fileName = [Uri]::UnescapeDataString(
        $uri.Segments[$uri.Segments.Length - 1]
    )
    $destination = Join-Path $DownloadDirectory $fileName
    $expected = $ExpectedSha256.ToUpperInvariant()
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        $existing = (
            Get-FileHash -LiteralPath $destination -Algorithm SHA256
        ).Hash
        if ($existing -eq $expected) {
            Write-Result @{
                status = "downloaded"
                version = $Version
                path = $destination
            }
            exit 0
        }
        Remove-Item -LiteralPath $destination -Force
    }

    $partial = "$destination.partial-$([Guid]::NewGuid().ToString('N'))"
    try {
        Invoke-WebRequest `
            -Uri $uri.AbsoluteUri `
            -Headers $headers `
            -UseBasicParsing `
            -TimeoutSec 120 `
            -OutFile $partial
        $actual = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash
        if ($actual -ne $expected) {
            throw "新版 Setup SHA-256 校验失败，已阻止运行。"
        }
        Move-Item -LiteralPath $partial -Destination $destination -Force
    }
    finally {
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    }

    Write-Result @{
        status = "downloaded"
        version = $Version
        path = $destination
    }
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
