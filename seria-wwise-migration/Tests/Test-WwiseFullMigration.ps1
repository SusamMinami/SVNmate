$ErrorActionPreference = 'Stop'

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]$Expected,
        [Parameter(Mandatory = $true)]$Actual,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if ($Expected -ne $Actual) {
        throw (
            '{0} Expected [{1}], actual [{2}].' -f
            $Message,
            $Expected,
            $Actual
        )
    }
}

function Assert-PathListEqual {
    param(
        [Parameter(Mandatory = $true)][string[]]$Expected,
        [Parameter(Mandatory = $true)][string[]]$Actual,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $expectedPaths = @(
        $Expected | ForEach-Object {
            (Get-Item -LiteralPath $_).FullName
        }
    )
    $actualPaths = @(
        $Actual | ForEach-Object {
            (Get-Item -LiteralPath $_).FullName
        }
    )
    Assert-Equal `
        -Expected ($expectedPaths -join '|') `
        -Actual ($actualPaths -join '|') `
        -Message $Message
}

$testRoot = Join-Path $env:TEMP (
    'SeriaWwiseFullMigrationTest-' + [guid]::NewGuid().ToString('N')
)
$repositoryPath = Join-Path $testRoot 'repository'
$sourceWorkingCopy = Join-Path $testRoot 'Sound'
$sourceProjectRoot = Join-Path $sourceWorkingCopy 'SeriaWwiseProject'
$sourceRoot = Join-Path $sourceProjectRoot 'GeneratedSoundBanks_2022'
$sourcePublisherRoot = Join-Path $testRoot 'SoundPublisher'
$targetRoot = Join-Path $testRoot 'WwiseAudio'
$targetPublisherRoot = Join-Path $testRoot 'WwiseAudioPublisher'
$fakeSvnmateRoot = Join-Path $testRoot 'FakeSvnmate'
$bridgeMarker = Join-Path $testRoot 'svnmate-updates.txt'
$receiptRoot = Join-Path $testRoot 'Receipts'
$logRoot = Join-Path $testRoot 'Logs'
$scriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) (
    'Invoke-WwiseFullMigration.ps1'
)

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    & svnadmin.exe create $repositoryPath
    if ($LASTEXITCODE -ne 0) {
        throw 'svnadmin create failed.'
    }
    $repositoryUrl = ([System.Uri]$repositoryPath).AbsoluteUri
    & svn.exe mkdir `
        "$repositoryUrl/Sound" `
        "$repositoryUrl/WwiseAudio" `
        -m 'Initialize test data'
    if ($LASTEXITCODE -ne 0) {
        throw 'svn mkdir failed.'
    }
    & svn.exe checkout "$repositoryUrl/Sound" $sourceWorkingCopy
    if ($LASTEXITCODE -ne 0) {
        throw 'Source svn checkout failed.'
    }
    & svn.exe checkout "$repositoryUrl/WwiseAudio" $targetRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'Target svn checkout failed.'
    }

    $fakePackage = Join-Path $fakeSvnmateRoot 'migration_guard'
    New-Item -ItemType Directory -Path $fakePackage -Force | Out-Null
    Set-Content `
        -LiteralPath (Join-Path $fakePackage '__init__.py') `
        -Value '' `
        -Encoding ASCII
    Set-Content `
        -LiteralPath (Join-Path $fakePackage 'svn_update_cli.py') `
        -Encoding UTF8 `
        -Value @'
import argparse
import json
import os
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--source")
parser.add_argument("--response-timeout")
parser.add_argument("folders", nargs="+")
args = parser.parse_args()
ok = True
for folder in args.folders:
    process = subprocess.run(
        ["svn", "update"],
        cwd=folder,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    print(process.stdout, end="", flush=True)
    ok = ok and process.returncode == 0
marker = os.environ.get("FAKE_SVNMATE_MARKER")
if marker:
    with open(marker, "a", encoding="utf-8") as stream:
        stream.write("|".join(args.folders) + "\n")
result = {
    "protocol_version": 2,
    "core_version": "1.1.0",
    "capabilities": {
        "update.batch": 1,
        "update.cleanup_retry": 1,
        "update.multi_root_parallel": 1,
        "update.same_root_serial": 1,
    },
    "ok": ok,
    "status": "completed" if ok else "failed",
    "executed_by": "fake-svnmate",
    "folders": args.folders,
}
print(
    "SVNMATE_UPDATE_RESULT_JSON="
    + json.dumps(result, separators=(",", ":")),
    flush=True,
)
raise SystemExit(0 if ok else 1)
'@
    $env:FAKE_SVNMATE_MARKER = $bridgeMarker
    $env:SERIA_WWISE_RECEIPT_ROOT = $receiptRoot

    $projectInfo = [ordered]@{
        ProjectInfo = [ordered]@{
            Project = [ordered]@{
                Name = 'Seria_WwiseProject'
                GUID = '{80F762E0-19EE-46F0-A6D1-A54C00970FC8}'
                Generator = '2022.1.18.8567'
            }
            Platforms = @(
                [ordered]@{
                    Name = 'Windows'
                    Path = 'Windows'
                    GUID = '{11111111-1111-1111-1111-111111111111}'
                }
            )
            Languages = @(
                [ordered]@{
                    Name = 'CN'
                    Id = 1
                    GUID = '{22222222-2222-2222-2222-222222222222}'
                }
            )
            FileHash = '{33333333-3333-3333-3333-333333333333}'
        }
    }
    $platformInfo = [ordered]@{
        PlatformInfo = [ordered]@{
            Platform = [ordered]@{
                Name = 'Windows'
                Generator = '2022.1.18.8567'
            }
        }
    }

    New-Item -ItemType Directory -Path $sourceProjectRoot -Force | Out-Null
    $wprojPath = Join-Path $sourceProjectRoot 'Seria_WwiseProject.wproj'
    $workUnitPath = Join-Path $sourceProjectRoot 'Events\Default Work Unit.wwu'
    $originalPath = Join-Path $sourceProjectRoot 'Originals\SFX\Source.wav'
    New-Item `
        -ItemType Directory `
        -Path (Split-Path -Parent $workUnitPath) `
        -Force |
        Out-Null
    New-Item `
        -ItemType Directory `
        -Path (Split-Path -Parent $originalPath) `
        -Force |
        Out-Null
    Set-Content -LiteralPath $wprojPath -Value '<WwiseProject />' -Encoding ASCII
    Set-Content -LiteralPath $workUnitPath -Value '<WorkUnit />' -Encoding ASCII
    Set-Content -LiteralPath $originalPath -Value 'audio-source' -Encoding ASCII

    $sourcePlatform = Join-Path $sourceRoot 'Windows'
    $sourceMedia = Join-Path $sourcePlatform 'Media\CN'
    New-Item -ItemType Directory -Path $sourceMedia -Force | Out-Null
    New-Item `
        -ItemType Directory `
        -Path (Join-Path $sourcePlatform 'CN') `
        -Force |
        Out-Null
    $projectInfo |
        ConvertTo-Json -Depth 6 |
        Set-Content (Join-Path $sourceRoot 'ProjectInfo.json') -Encoding UTF8
    $platformInfo |
        ConvertTo-Json -Depth 6 |
        Set-Content (Join-Path $sourcePlatform 'PlatformInfo.json') -Encoding UTF8
    Set-Content `
        -LiteralPath (Join-Path $sourcePlatform 'SoundbanksInfo.json') `
        -Value '{}' `
        -Encoding ASCII
    Set-Content `
        -LiteralPath (Join-Path $sourceMedia 'Existing.wem') `
        -Value 'new-content' `
        -Encoding ASCII
    Set-Content `
        -LiteralPath (Join-Path $sourceMedia 'New.wem') `
        -Value 'new-file' `
        -Encoding ASCII
    $oldInputTime = [System.DateTime]::UtcNow.AddMinutes(-10)
    [System.IO.File]::SetLastWriteTimeUtc($wprojPath, $oldInputTime)
    [System.IO.File]::SetLastWriteTimeUtc($workUnitPath, $oldInputTime)
    [System.IO.File]::SetLastWriteTimeUtc($originalPath, $oldInputTime)
    [System.IO.File]::SetLastWriteTimeUtc(
        (Join-Path $sourceRoot 'ProjectInfo.json'),
        [System.DateTime]::UtcNow
    )
    & svn.exe add --force -- $sourceWorkingCopy
    if ($LASTEXITCODE -ne 0) {
        throw 'Source svn add failed.'
    }
    & svn.exe commit $sourceWorkingCopy -m 'Add source project and banks'
    if ($LASTEXITCODE -ne 0) {
        throw 'Source svn commit failed.'
    }

    $targetPlatform = Join-Path $targetRoot 'Windows'
    $targetMedia = Join-Path $targetPlatform 'Media\CN'
    New-Item -ItemType Directory -Path $targetMedia -Force | Out-Null
    Set-Content `
        -LiteralPath (Join-Path $targetRoot 'ProjectInfo.json') `
        -Value '{}' `
        -Encoding ASCII
    Set-Content `
        -LiteralPath (Join-Path $targetPlatform 'PlatformInfo.json') `
        -Value '{}' `
        -Encoding ASCII
    Set-Content `
        -LiteralPath (Join-Path $targetPlatform 'SoundbanksInfo.json') `
        -Value '{}' `
        -Encoding ASCII
    Set-Content `
        -LiteralPath (Join-Path $targetMedia 'Existing.wem') `
        -Value 'old-content' `
        -Encoding ASCII
    Set-Content `
        -LiteralPath (Join-Path $targetMedia 'Stale.wem') `
        -Value 'stale-file' `
        -Encoding ASCII
    & svn.exe add --force -- $targetRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'svn add failed.'
    }
    & svn.exe commit $targetRoot -m 'Add initial target data'
    if ($LASTEXITCODE -ne 0) {
        throw 'svn commit failed.'
    }

    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -SourceRoot $sourceRoot `
        -TargetRoot $targetRoot `
        -LogRoot $logRoot `
        -SvnmateRoot $fakeSvnmateRoot `
        -SkipEditorStop
    Assert-Equal `
        -Expected 0 `
        -Actual $LASTEXITCODE `
        -Message 'Migration exit code.'

    Assert-Equal `
        -Expected 'new-content' `
        -Actual (Get-Content -LiteralPath (
                Join-Path $targetMedia 'Existing.wem'
            ) -Raw).Trim() `
        -Message 'Existing file content.'
    Assert-Equal `
        -Expected $true `
        -Actual (Test-Path -LiteralPath (Join-Path $targetMedia 'New.wem')) `
        -Message 'New file existence.'
    Assert-Equal `
        -Expected $false `
        -Actual (Test-Path -LiteralPath (Join-Path $targetMedia 'Stale.wem')) `
        -Message 'Stale file removal.'

    [xml]$statusDocument = (
        & svn.exe status --xml --depth infinity --no-ignore -- $targetRoot
    ) -join [Environment]::NewLine
    $statusByName = @{}
    foreach ($entry in $statusDocument.SelectNodes('//entry')) {
        $statusByName[(Split-Path -Leaf ([string]$entry.path))] = [string](
            $entry.SelectSingleNode('wc-status').item
        )
    }
    Assert-Equal `
        -Expected 'modified' `
        -Actual $statusByName['Existing.wem'] `
        -Message 'Existing file SVN status.'
    Assert-Equal `
        -Expected 'added' `
        -Actual $statusByName['New.wem'] `
        -Message 'New file SVN status.'
    Assert-Equal `
        -Expected 'deleted' `
        -Actual $statusByName['Stale.wem'] `
        -Message 'Stale file SVN status.'
    $unreconciled = @(
        $statusDocument.SelectNodes('//entry') | Where-Object {
            [string]$_.SelectSingleNode('wc-status').item -in @(
                'unversioned',
                'ignored',
                'missing'
            )
        }
    )
    Assert-Equal `
        -Expected 0 `
        -Actual $unreconciled.Count `
        -Message 'Unreconciled SVN path count.'

    $runDirectory = Get-ChildItem $logRoot -Directory |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    $summary = Get-Content `
        -LiteralPath (Join-Path $runDirectory.FullName 'summary.json') `
        -Raw |
        ConvertFrom-Json
    Assert-Equal `
        -Expected 'Targeted' `
        -Actual $summary.SvnReconcileMode `
        -Message 'SVN reconciliation mode.'
    Assert-Equal `
        -Expected 'Refreshed' `
        -Actual $summary.GenerationReceipt `
        -Message 'Initial generation receipt status.'
    Assert-Equal `
        -Expected 1 `
        -Actual @(Get-ChildItem $receiptRoot -File -Filter '*.json').Count `
        -Message 'Generation receipt count.'

    & svn.exe commit $targetRoot -m 'Commit synchronized test data'
    if ($LASTEXITCODE -ne 0) {
        throw 'Synchronized test commit failed.'
    }
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -SourceRoot $sourceRoot `
        -TargetRoot $targetRoot `
        -LogRoot $logRoot `
        -SvnmateRoot $fakeSvnmateRoot `
        -SkipEditorStop
    Assert-Equal `
        -Expected 0 `
        -Actual $LASTEXITCODE `
        -Message 'No-change migration exit code.'
    $noChangeRunDirectory = Get-ChildItem $logRoot -Directory |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    $noChangeSummary = Get-Content `
        -LiteralPath (Join-Path $noChangeRunDirectory.FullName 'summary.json') `
        -Raw |
        ConvertFrom-Json
    Assert-Equal `
        -Expected 0 `
        -Actual $noChangeSummary.SvnAddRoots `
        -Message 'No-change SVN add root count.'
    Assert-Equal `
        -Expected 0 `
        -Actual $noChangeSummary.SvnDeleteRoots `
        -Message 'No-change SVN delete root count.'
    Assert-Equal `
        -Expected 'Current' `
        -Actual $noChangeSummary.GenerationReceipt `
        -Message 'No-change generation receipt status.'

    & svn.exe checkout "$repositoryUrl/Sound" $sourcePublisherRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'Source publisher checkout failed.'
    }
    $publisherProjectRoot = Join-Path $sourcePublisherRoot 'SeriaWwiseProject'
    $publisherGeneratedRoot = Join-Path $publisherProjectRoot (
        'GeneratedSoundBanks_2022'
    )
    Set-Content `
        -LiteralPath (Join-Path $publisherProjectRoot (
                'Events\Default Work Unit.wwu'
            )) `
        -Value '<WorkUnit Revision="2" />' `
        -Encoding ASCII
    Set-Content `
        -LiteralPath (Join-Path $publisherGeneratedRoot (
                'Windows\Media\CN\Existing.wem'
            )) `
        -Value 'remote-source-content' `
        -Encoding ASCII
    $publisherProjectInfoPath = Join-Path $publisherGeneratedRoot (
        'ProjectInfo.json'
    )
    $publisherProjectInfo = Get-Content `
        -LiteralPath $publisherProjectInfoPath `
        -Raw |
        ConvertFrom-Json
    $publisherProjectInfo.ProjectInfo.FileHash = (
        '{44444444-4444-4444-4444-444444444444}'
    )
    $publisherProjectInfo |
        ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath $publisherProjectInfoPath -Encoding UTF8
    & svn.exe commit $sourcePublisherRoot -m 'Publish newer Sound source'
    if ($LASTEXITCODE -ne 0) {
        throw 'Source publisher commit failed.'
    }

    Remove-Item -LiteralPath $bridgeMarker -ErrorAction SilentlyContinue
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -SourceRoot $sourceRoot `
        -TargetRoot $targetRoot `
        -LogRoot $logRoot `
        -SvnmateRoot $fakeSvnmateRoot `
        -SkipEditorStop
    Assert-Equal `
        -Expected 0 `
        -Actual $LASTEXITCODE `
        -Message 'Source-behind migration exit code.'
    Assert-PathListEqual `
        -Expected @($sourceProjectRoot) `
        -Actual @(
            Get-Content -LiteralPath $bridgeMarker |
                Select-Object -First 1
        ) `
        -Message 'Source update path.'
    Assert-Equal `
        -Expected 'remote-source-content' `
        -Actual (Get-Content -LiteralPath (
                Join-Path $targetMedia 'Existing.wem'
            ) -Raw).Trim() `
        -Message 'Remote source content after SVNmate update.'
    & svn.exe commit $targetRoot -m 'Commit remote source synchronization'
    if ($LASTEXITCODE -ne 0) {
        throw 'Remote source synchronization commit failed.'
    }

    & svn.exe checkout "$repositoryUrl/WwiseAudio" $targetPublisherRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'Target publisher checkout failed.'
    }
    $remoteOnlyPath = Join-Path $targetPublisherRoot (
        'Windows\Media\CN\RemoteOnly.wem'
    )
    Set-Content -LiteralPath $remoteOnlyPath -Value 'remote-only' -Encoding ASCII
    & svn.exe add -- $remoteOnlyPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Target publisher svn add failed.'
    }
    & svn.exe commit $targetPublisherRoot -m 'Publish newer target data'
    if ($LASTEXITCODE -ne 0) {
        throw 'Target publisher commit failed.'
    }

    Remove-Item -LiteralPath $bridgeMarker -ErrorAction SilentlyContinue
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -SourceRoot $sourceRoot `
        -TargetRoot $targetRoot `
        -LogRoot $logRoot `
        -SvnmateRoot $fakeSvnmateRoot `
        -SkipEditorStop
    Assert-Equal `
        -Expected 0 `
        -Actual $LASTEXITCODE `
        -Message 'Target-behind migration exit code.'
    Assert-PathListEqual `
        -Expected @($targetRoot) `
        -Actual @(
            Get-Content -LiteralPath $bridgeMarker |
                Select-Object -First 1
        ) `
        -Message 'Target update path.'
    Assert-Equal `
        -Expected $false `
        -Actual (Test-Path -LiteralPath (
                Join-Path $targetRoot 'Windows\Media\CN\RemoteOnly.wem'
            )) `
        -Message 'Remote-only target file removal.'
    & svn.exe commit $targetRoot -m 'Commit target update reconciliation'
    if ($LASTEXITCODE -ne 0) {
        throw 'Target update reconciliation commit failed.'
    }

    Set-Content `
        -LiteralPath (Join-Path $publisherProjectRoot (
                'Events\Default Work Unit.wwu'
            )) `
        -Value '<WorkUnit Revision="3" />' `
        -Encoding ASCII
    Set-Content `
        -LiteralPath (Join-Path $publisherGeneratedRoot (
                'Windows\Media\CN\Existing.wem'
            )) `
        -Value 'batched-source-content' `
        -Encoding ASCII
    $publisherProjectInfo = Get-Content `
        -LiteralPath $publisherProjectInfoPath `
        -Raw |
        ConvertFrom-Json
    $publisherProjectInfo.ProjectInfo.FileHash = (
        '{66666666-6666-6666-6666-666666666666}'
    )
    $publisherProjectInfo |
        ConvertTo-Json -Depth 6 |
        Set-Content -LiteralPath $publisherProjectInfoPath -Encoding UTF8
    & svn.exe commit $sourcePublisherRoot -m 'Publish batched source update'
    if ($LASTEXITCODE -ne 0) {
        throw 'Batched source publisher commit failed.'
    }

    & svn.exe update $targetPublisherRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'Target publisher update failed.'
    }
    $remoteBatchPath = Join-Path $targetPublisherRoot (
        'Windows\Media\CN\RemoteBatch.wem'
    )
    Set-Content -LiteralPath $remoteBatchPath -Value 'remote-batch' -Encoding ASCII
    & svn.exe add -- $remoteBatchPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Batched target publisher svn add failed.'
    }
    & svn.exe commit $targetPublisherRoot -m 'Publish batched target update'
    if ($LASTEXITCODE -ne 0) {
        throw 'Batched target publisher commit failed.'
    }

    Remove-Item -LiteralPath $bridgeMarker -ErrorAction SilentlyContinue
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -SourceRoot $sourceRoot `
        -TargetRoot $targetRoot `
        -LogRoot $logRoot `
        -SvnmateRoot $fakeSvnmateRoot `
        -SkipEditorStop
    Assert-Equal `
        -Expected 0 `
        -Actual $LASTEXITCODE `
        -Message 'Batched source/target update exit code.'
    Assert-PathListEqual `
        -Expected @($sourceProjectRoot, $targetRoot) `
        -Actual @(
            (
                Get-Content -LiteralPath $bridgeMarker |
                    Select-Object -First 1
            ) -split '\|'
        ) `
        -Message 'Batched SVNmate update paths.'
    Assert-Equal `
        -Expected 'batched-source-content' `
        -Actual (Get-Content -LiteralPath (
                Join-Path $targetMedia 'Existing.wem'
            ) -Raw).Trim() `
        -Message 'Batched source content.'
    Assert-Equal `
        -Expected $false `
        -Actual (Test-Path -LiteralPath (
                Join-Path $targetRoot 'Windows\Media\CN\RemoteBatch.wem'
            )) `
        -Message 'Batched remote-only target file removal.'
    & svn.exe commit $targetRoot -m 'Commit batched update reconciliation'
    if ($LASTEXITCODE -ne 0) {
        throw 'Batched update reconciliation commit failed.'
    }

    Set-Content `
        -LiteralPath $workUnitPath `
        -Value '<WorkUnit Revision="local-stale" />' `
        -Encoding ASCII
    $staleInputTime = [System.DateTime]::UtcNow.AddMinutes(10)
    [System.IO.File]::SetLastWriteTimeUtc($workUnitPath, $staleInputTime)
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -SourceRoot $sourceRoot `
        -TargetRoot $targetRoot `
        -LogRoot $logRoot `
        -SvnmateRoot $fakeSvnmateRoot `
        -SkipEditorStop
    Assert-Equal `
        -Expected 2 `
        -Actual $LASTEXITCODE `
        -Message 'Stale SoundBanks exit code.'

    $regeneratedProjectInfo = Get-Content `
        -LiteralPath (Join-Path $sourceRoot 'ProjectInfo.json') `
        -Raw |
        ConvertFrom-Json
    $regeneratedProjectInfo.ProjectInfo.FileHash = (
        '{55555555-5555-5555-5555-555555555555}'
    )
    $regeneratedProjectInfo |
        ConvertTo-Json -Depth 6 |
        Set-Content `
            -LiteralPath (Join-Path $sourceRoot 'ProjectInfo.json') `
            -Encoding UTF8
    [System.IO.File]::SetLastWriteTimeUtc(
        (Join-Path $sourceRoot 'ProjectInfo.json'),
        $staleInputTime.AddMinutes(1)
    )
    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $scriptPath `
        -Profile Trunk `
        -SourceRoot $sourceRoot `
        -TargetRoot $targetRoot `
        -LogRoot $logRoot `
        -SvnmateRoot $fakeSvnmateRoot `
        -SkipEditorStop
    Assert-Equal `
        -Expected 0 `
        -Actual $LASTEXITCODE `
        -Message 'Regenerated SoundBanks exit code.'
    $regeneratedRunDirectory = Get-ChildItem $logRoot -Directory |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    $regeneratedSummary = Get-Content `
        -LiteralPath (Join-Path $regeneratedRunDirectory.FullName (
                'summary.json'
            )) `
        -Raw |
        ConvertFrom-Json
    Assert-Equal `
        -Expected 'Refreshed' `
        -Actual $regeneratedSummary.GenerationReceipt `
        -Message 'Regenerated SoundBanks receipt status.'

    Write-Host (
        ('PASS: exact mirror, SVNmate source/target updates, stale bank ' +
            'blocking, receipt renewal, and no-change rerun.')
    )
}
finally {
    Remove-Item Env:FAKE_SVNMATE_MARKER -ErrorAction SilentlyContinue
    Remove-Item Env:SERIA_WWISE_RECEIPT_ROOT -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
