[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Trunk', 'OB17', 'OSOB', 'OStrunk')]
    [string]$Profile
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$profileDefinitions = @{
    Trunk = @{
        DisplayName = '国内主干'
        Target = 'C:\trunk\res\Content\Seria\WwiseAudio'
        SoundData = 'C:\trunk\res\Content\Seria\WwiseSoundData'
        Managed = @('Android', 'iOS', 'Mac', 'OpenHarmony', 'PS5', 'Windows')
    }
    OB17 = @{
        DisplayName = '国内 OB17'
        Target = 'D:\server\17.0\res\Content\Seria\WwiseAudio'
        SoundData = 'D:\server\17.0\res\Content\Seria\WwiseSoundData'
        Managed = @('Android', 'iOS', 'Mac', 'OpenHarmony', 'PS5', 'Windows')
    }
    OSOB = @{
        DisplayName = '海外 OB'
        Target = 'D:\Oversea\OSOB\res\Content\Seria\WwiseAudio'
        SoundData = 'D:\Oversea\OSOB\res\Content\Seria\WwiseSoundData'
        Managed = @('Android', 'iOS', 'PS5', 'Windows')
    }
    OStrunk = @{
        DisplayName = '海外主干'
        Target = 'D:\Oversea\OStrunk\res\Content\Seria\WwiseAudio'
        SoundData = 'D:\Oversea\OStrunk\res\Content\Seria\WwiseSoundData'
        Managed = @('Android', 'iOS', 'PS5', 'Windows')
    }
}

$definition = $profileDefinitions[$Profile]
$migrationScript = Join-Path $PSScriptRoot 'Invoke-WwiseMigrationWorkflow.ps1'
$sourceRoot = $env:SERIA_WWISE_SOURCE_ROOT
if ([string]::IsNullOrWhiteSpace($sourceRoot)) {
    $projectRoot = $env:SERIA_WWISE_PROJECT_ROOT
    if ([string]::IsNullOrWhiteSpace($projectRoot)) {
        $projectRoot = 'C:\Sound\SeriaWwiseProject'
    }
    $sourceRoot = Join-Path $projectRoot 'GeneratedSoundBanks_2022'
}
$sourceRoot = [IO.Path]::GetFullPath($sourceRoot)
$targetRoot = [string]$definition.Target
$soundDataRoot = [string]$definition.SoundData
$logRoot = Join-Path $env:LOCALAPPDATA 'SeriaWwiseMigration\Logs'
$uiLogRoot = Join-Path $env:TEMP 'SeriaWwiseMigrationUI'

$colorWindow = [System.Drawing.ColorTranslator]::FromHtml('#F3F5F7')
$colorSurface = [System.Drawing.Color]::White
$colorText = [System.Drawing.ColorTranslator]::FromHtml('#202124')
$colorSecondary = [System.Drawing.ColorTranslator]::FromHtml('#5F6368')
$colorBorder = [System.Drawing.ColorTranslator]::FromHtml('#D7DBDF')
$colorAccent = [System.Drawing.ColorTranslator]::FromHtml('#0B6B58')
$colorAccentHover = [System.Drawing.ColorTranslator]::FromHtml('#085848')
$colorSuccess = [System.Drawing.ColorTranslator]::FromHtml('#137333')
$colorWarning = [System.Drawing.ColorTranslator]::FromHtml('#A15C00')
$colorError = [System.Drawing.ColorTranslator]::FromHtml('#B3261E')
$colorLog = [System.Drawing.ColorTranslator]::FromHtml('#161A1D')
$colorLogText = [System.Drawing.ColorTranslator]::FromHtml('#DCE2E5')
$colorLogMuted = [System.Drawing.ColorTranslator]::FromHtml('#9AA5AA')
$highContrast = [System.Windows.Forms.SystemInformation]::HighContrast
if ($highContrast) {
    $colorWindow = [System.Drawing.SystemColors]::Control
    $colorSurface = [System.Drawing.SystemColors]::Window
    $colorText = [System.Drawing.SystemColors]::WindowText
    $colorSecondary = [System.Drawing.SystemColors]::WindowText
    $colorBorder = [System.Drawing.SystemColors]::WindowFrame
    $colorAccent = [System.Drawing.SystemColors]::WindowText
    $colorAccentHover = [System.Drawing.SystemColors]::Highlight
    $colorSuccess = [System.Drawing.SystemColors]::WindowText
    $colorWarning = [System.Drawing.SystemColors]::WindowText
    $colorError = [System.Drawing.SystemColors]::WindowText
    $colorLog = [System.Drawing.SystemColors]::Window
    $colorLogText = [System.Drawing.SystemColors]::WindowText
    $colorLogMuted = [System.Drawing.SystemColors]::WindowText
}
$uiFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$titleFont = New-Object System.Drawing.Font(
    'Microsoft YaHei UI',
    18,
    [System.Drawing.FontStyle]::Bold
)
$sectionFont = New-Object System.Drawing.Font(
    'Microsoft YaHei UI',
    10,
    [System.Drawing.FontStyle]::Bold
)
$logFont = New-Object System.Drawing.Font('Consolas', 9)

$script:MigrationProcess = $null
$script:UiOutputPath = $null
$script:UiOutputStream = $null
$script:UiOutputReader = $null
$script:LastRunLogDirectory = $logRoot
$script:RunMode = ''
$script:IsClosing = $false
$script:UserStopped = $false

function New-FlatButton {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][System.Drawing.Color]$BackColor,
        [Parameter(Mandatory = $true)][System.Drawing.Color]$ForeColor,
        [int]$Width = 116
    )

    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.Width = $Width
    $button.Height = 36
    $button.Margin = New-Object System.Windows.Forms.Padding(8, 9, 0, 9)
    if ($highContrast) {
        $button.FlatStyle = [System.Windows.Forms.FlatStyle]::System
        $button.UseVisualStyleBackColor = $true
        return $button
    }
    $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderSize = 1
    $button.FlatAppearance.BorderColor = if ($BackColor -eq $colorSurface) {
        $colorBorder
    }
    else {
        $BackColor
    }
    $button.BackColor = $BackColor
    $button.ForeColor = $ForeColor
    $button.Font = $uiFont
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $button.UseVisualStyleBackColor = $false
    return $button
}

function Set-UiState {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Ready', 'Running', 'Success', 'Warning', 'Error')]
        [string]$State,
        [Parameter(Mandatory = $true)][string]$Text
    )

    $statusLabel.Text = $Text
    switch ($State) {
        'Ready' {
            $statusLabel.ForeColor = $colorSecondary
            $progressBar.Value = 0
        }
        'Running' {
            $statusLabel.ForeColor = $colorAccent
        }
        'Success' {
            $statusLabel.ForeColor = $colorSuccess
            $progressBar.Value = 100
        }
        'Warning' {
            $statusLabel.ForeColor = $colorWarning
        }
        'Error' {
            $statusLabel.ForeColor = $colorError
        }
    }
}

function Add-LogLine {
    param([AllowEmptyString()][string]$Line)

    $lineColor = $colorLogText
    if ($highContrast) {
        $lineColor = $colorLogText
    }
    elseif ($Line -match '^\[WORKFLOW ([12])/2\]') {
        $lineColor = [System.Drawing.ColorTranslator]::FromHtml('#74D8C2')
        $workflowStage = [int]$Matches[1]
        if ($workflowStage -eq 1) {
            $stageLabel.Text = '阶段 1/2 · 迁移 WwiseAudio'
            $progressBar.Value = 4
        }
        else {
            $stageLabel.Text = '阶段 2/2 · 生成 WwiseSoundData'
            $progressBar.Value = 70
        }
    }
    elseif ($Line -match '^\[\d/8\]') {
        $lineColor = [System.Drawing.ColorTranslator]::FromHtml('#74D8C2')
        if ($Line -match '^\[(\d)/8\]') {
            $stage = [int]$Matches[1]
            $progressBar.Value = [Math]::Min(
                68,
                [Math]::Max(5, 5 + [int](($stage / 8.0) * 60))
            )
        }
    }
    elseif ($Line -match '^\[ASSET ([1-6])/6\]') {
        $lineColor = [System.Drawing.ColorTranslator]::FromHtml('#74D8C2')
        $assetStage = [int]$Matches[1]
        $progressBar.Value = [Math]::Min(
            96,
            [Math]::Max(70, 70 + [int](($assetStage / 6.0) * 26))
        )
    }
    elseif ($Line -match '^ERROR:|Migration failed') {
        $lineColor = [System.Drawing.ColorTranslator]::FromHtml('#FF9B92')
    }
    elseif ($Line -match 'Complete|completed|zero diff|usable') {
        $lineColor = [System.Drawing.ColorTranslator]::FromHtml('#82D99A')
    }
    elseif ($Line -match 'conflict|Remote change|excluded|UPDATE|DELETE') {
        $lineColor = [System.Drawing.ColorTranslator]::FromHtml('#F1BF78')
    }
    elseif ([string]::IsNullOrWhiteSpace($Line)) {
        $lineColor = $colorLogMuted
    }

    $logBox.SelectionStart = $logBox.TextLength
    $logBox.SelectionLength = 0
    $logBox.SelectionColor = $lineColor
    $logBox.AppendText($Line + [Environment]::NewLine)
    $logBox.SelectionColor = $colorLogText
    $logBox.ScrollToCaret()

    if ($Line -match '^(?:Logs|Workflow logs):\s+(.+)$') {
        $script:LastRunLogDirectory = $Matches[1].Trim()
    }
}

function Close-UiOutputReader {
    if ($script:UiOutputReader) {
        $script:UiOutputReader.Dispose()
        $script:UiOutputReader = $null
    }
    if ($script:UiOutputStream) {
        $script:UiOutputStream.Dispose()
        $script:UiOutputStream = $null
    }
}

function Update-UiOutput {
    if ([string]::IsNullOrWhiteSpace($script:UiOutputPath) -or
        -not (Test-Path -LiteralPath $script:UiOutputPath -PathType Leaf)) {
        return
    }

    if (-not $script:UiOutputReader) {
        try {
            $script:UiOutputStream = New-Object System.IO.FileStream(
                $script:UiOutputPath,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::ReadWrite
            )
            $script:UiOutputReader = New-Object System.IO.StreamReader(
                $script:UiOutputStream,
                (New-Object System.Text.UTF8Encoding($false)),
                $true
            )
        }
        catch {
            Close-UiOutputReader
            return
        }
    }

    while (-not $script:UiOutputReader.EndOfStream) {
        $line = $script:UiOutputReader.ReadLine()
        if ($null -ne $line) {
            Add-LogLine -Line ([string]$line)
        }
    }
}

function Set-ControlsRunning {
    param([Parameter(Mandatory = $true)][bool]$Running)

    $previewButton.Enabled = -not $Running
    $migrateButton.Enabled = -not $Running
    $stopButton.Enabled = $Running -and $script:RunMode -eq 'Preview'
    $openTargetButton.Enabled = -not $Running
    $openAssetsButton.Enabled = -not $Running
}

function ConvertTo-PowerShellLiteral {
    param([Parameter(Mandatory = $true)][string]$Value)

    return "'" + $Value.Replace("'", "''") + "'"
}

function Start-Migration {
    param([switch]$PreviewMode)

    if ($script:MigrationProcess -and
        -not $script:MigrationProcess.HasExited) {
        return
    }

    if (-not (Test-Path -LiteralPath $migrationScript -PathType Leaf)) {
        [System.Windows.Forms.MessageBox]::Show(
            $form,
            "找不到迁移核心脚本：`r`n$migrationScript",
            '无法启动',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
        return
    }

    New-Item -ItemType Directory -Path $uiLogRoot -Force | Out-Null
    $script:UiOutputPath = Join-Path $uiLogRoot (
        '{0}-{1}.log' -f $Profile, [guid]::NewGuid().ToString('N')
    )
    Close-UiOutputReader
    $script:RunMode = if ($PreviewMode) { 'Preview' } else { 'Migration' }
    $script:UserStopped = $false
    $script:LastRunLogDirectory = $logRoot
    $logBox.Clear()

    $modeArgument = if ($PreviewMode) { ' -Preview' } else { '' }
    $command = @"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding(`$false)
`$utf8 = New-Object System.Text.UTF8Encoding(`$false)
`$writer = New-Object System.IO.StreamWriter(
    $(ConvertTo-PowerShellLiteral -Value $script:UiOutputPath),
    `$false,
    `$utf8
)
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $(ConvertTo-PowerShellLiteral -Value $migrationScript) -Profile $(ConvertTo-PowerShellLiteral -Value $Profile) -SourceRoot $(ConvertTo-PowerShellLiteral -Value $sourceRoot)$modeArgument 2>&1 |
        ForEach-Object {
            `$writer.WriteLine(`$_.ToString())
            `$writer.Flush()
        }
    `$migrationExitCode = `$LASTEXITCODE
}
finally {
    `$writer.Dispose()
}
exit `$migrationExitCode
"@
    $encodedCommand = [Convert]::ToBase64String(
        [System.Text.Encoding]::Unicode.GetBytes($command)
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = 'powershell.exe'
    $startInfo.Arguments = (
        '-NoProfile -ExecutionPolicy Bypass -EncodedCommand {0}' -f
        $encodedCommand
    )
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

    $script:MigrationProcess = New-Object System.Diagnostics.Process
    $script:MigrationProcess.StartInfo = $startInfo
    if (-not $script:MigrationProcess.Start()) {
        Set-UiState -State Error -Text '无法启动迁移进程'
        return
    }

    Set-ControlsRunning -Running $true
    $progressBar.Value = 2
    $stageLabel.Text = if ($PreviewMode) {
        '预览两阶段流程'
    }
    else {
        '准备两阶段流程'
    }
    Set-UiState `
        -State Running `
        -Text $(if ($PreviewMode) {
            '正在检查迁移与资源生成计划...'
        }
        else {
            '正在执行完整流程...'
        })
    Add-LogLine -Line $(if ($PreviewMode) {
        '正在启动只读预览...'
    }
    else {
        '正在启动迁移与资源生成流程...'
    })
    $outputTimer.Start()
}

function Stop-MigrationProcess {
    if (-not $script:MigrationProcess -or
        $script:MigrationProcess.HasExited) {
        return
    }

    Set-UiState -State Warning -Text '正在停止任务...'
    $stopButton.Enabled = $false
    $script:UserStopped = $true
    & taskkill.exe /PID $script:MigrationProcess.Id /T /F *> $null
}

function Start-ConfirmedMigration {
    $editors = @(Get-Process -Name UE4Editor -ErrorAction SilentlyContinue)
    if ($editors.Count -gt 0) {
        $choice = [System.Windows.Forms.MessageBox]::Show(
            $form,
            (
                "检测到 UE4Editor 正在运行。`r`n`r`n" +
                "完整流程会自动关闭 UE4Editor，然后迁移 WwiseAudio，" +
                "并无界面生成及保存 WwiseSoundData。`r`n`r`n" +
                "未保存的编辑器内容可能丢失，请先确认工作已经保存。"
            ),
            '确认开始完整流程',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning,
            [System.Windows.Forms.MessageBoxDefaultButton]::Button2
        )
        if ($choice -ne [System.Windows.Forms.DialogResult]::Yes) {
            Set-UiState -State Ready -Text '已取消迁移'
            return
        }
    }
    Start-Migration
}

function Open-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        [System.Windows.Forms.MessageBox]::Show(
            $form,
            "目录不存在：`r`n$Path",
            '无法打开目录',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
    }
    Start-Process -FilePath 'explorer.exe' -ArgumentList @($Path)
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Wwise 资源迁移与生成'
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.ClientSize = New-Object System.Drawing.Size(940, 760)
$form.MinimumSize = New-Object System.Drawing.Size(860, 680)
$form.BackColor = $colorWindow
$form.ForeColor = $colorText
$form.Font = $uiFont
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$form.Icon = [System.Drawing.SystemIcons]::Application

$statusStrip = New-Object System.Windows.Forms.StatusStrip
$statusStrip.BackColor = $colorSurface
$statusStrip.SizingGrip = $true

$statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
$statusLabel.Spring = $true
$statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$statusLabel.Text = '就绪'
$statusLabel.ForeColor = $colorSecondary

$stageLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
$stageLabel.AutoSize = $false
$stageLabel.Width = 220
$stageLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$stageLabel.Text = '两阶段流程'
$stageLabel.ForeColor = $colorSecondary

$progressBar = New-Object System.Windows.Forms.ToolStripProgressBar
$progressBar.Width = 190
$progressBar.Minimum = 0
$progressBar.Maximum = 100
$progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous

[void]$statusStrip.Items.Add($statusLabel)
[void]$statusStrip.Items.Add($stageLabel)
[void]$statusStrip.Items.Add($progressBar)

$rootLayout = New-Object System.Windows.Forms.TableLayoutPanel
$rootLayout.Dock = [System.Windows.Forms.DockStyle]::Fill
$rootLayout.BackColor = $colorWindow
$rootLayout.ColumnCount = 1
$rootLayout.RowCount = 4
$rootLayout.Padding = New-Object System.Windows.Forms.Padding(20, 16, 20, 14)
[void]$rootLayout.RowStyles.Add(
    (New-Object System.Windows.Forms.RowStyle(
            [System.Windows.Forms.SizeType]::Absolute,
            82
        ))
)
[void]$rootLayout.RowStyles.Add(
    (New-Object System.Windows.Forms.RowStyle(
            [System.Windows.Forms.SizeType]::Absolute,
            318
        ))
)
[void]$rootLayout.RowStyles.Add(
    (New-Object System.Windows.Forms.RowStyle(
            [System.Windows.Forms.SizeType]::Absolute,
            58
        ))
)
[void]$rootLayout.RowStyles.Add(
    (New-Object System.Windows.Forms.RowStyle(
            [System.Windows.Forms.SizeType]::Percent,
            100
        ))
)

$headerPanel = New-Object System.Windows.Forms.Panel
$headerPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
$headerPanel.BackColor = $colorSurface
$headerPanel.Padding = New-Object System.Windows.Forms.Padding(18, 12, 18, 10)
$headerPanel.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 10)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = 'Wwise 资源迁移与生成'
$titleLabel.Font = $titleFont
$titleLabel.ForeColor = $colorText
$titleLabel.AutoSize = $true
$titleLabel.Location = New-Object System.Drawing.Point(18, 12)

$profileLabel = New-Object System.Windows.Forms.Label
$profileLabel.Text = ('{0}  ·  {1}' -f $definition.DisplayName, $Profile)
$profileLabel.Font = $uiFont
$profileLabel.ForeColor = $colorAccent
$profileLabel.AutoSize = $true
$profileLabel.Location = New-Object System.Drawing.Point(20, 50)

$headerPanel.Controls.Add($titleLabel)
$headerPanel.Controls.Add($profileLabel)

$infoPanel = New-Object System.Windows.Forms.TableLayoutPanel
$infoPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
$infoPanel.BackColor = $colorSurface
$infoPanel.Padding = New-Object System.Windows.Forms.Padding(16, 12, 16, 12)
$infoPanel.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 10)
$infoPanel.ColumnCount = 3
$infoPanel.RowCount = 4
[void]$infoPanel.ColumnStyles.Add(
    (New-Object System.Windows.Forms.ColumnStyle(
            [System.Windows.Forms.SizeType]::Absolute,
            96
        ))
)
[void]$infoPanel.ColumnStyles.Add(
    (New-Object System.Windows.Forms.ColumnStyle(
            [System.Windows.Forms.SizeType]::Percent,
            100
        ))
)
[void]$infoPanel.ColumnStyles.Add(
    (New-Object System.Windows.Forms.ColumnStyle(
            [System.Windows.Forms.SizeType]::Absolute,
            96
        ))
)
[void]$infoPanel.RowStyles.Add(
    (New-Object System.Windows.Forms.RowStyle(
            [System.Windows.Forms.SizeType]::Absolute,
            38
        ))
)
[void]$infoPanel.RowStyles.Add(
    (New-Object System.Windows.Forms.RowStyle(
            [System.Windows.Forms.SizeType]::Absolute,
            38
        ))
)
[void]$infoPanel.RowStyles.Add(
    (New-Object System.Windows.Forms.RowStyle(
            [System.Windows.Forms.SizeType]::Absolute,
            38
        ))
)
[void]$infoPanel.RowStyles.Add(
    (New-Object System.Windows.Forms.RowStyle(
            [System.Windows.Forms.SizeType]::Percent,
            100
        ))
)

$sourceLabel = New-Object System.Windows.Forms.Label
$sourceLabel.Text = '源目录'
$sourceLabel.Dock = [System.Windows.Forms.DockStyle]::Fill
$sourceLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$sourceLabel.ForeColor = $colorSecondary

$sourceBox = New-Object System.Windows.Forms.TextBox
$sourceBox.Text = $sourceRoot
$sourceBox.ReadOnly = $true
$sourceBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$sourceBox.Dock = [System.Windows.Forms.DockStyle]::Fill
$sourceBox.Margin = New-Object System.Windows.Forms.Padding(0, 6, 8, 5)
$sourceBox.BackColor = $colorSurface
$sourceBox.AccessibleName = 'Wwise 源目录'

$openSourceButton = New-FlatButton `
    -Text '打开源目录' `
    -BackColor $colorSurface `
    -ForeColor $colorText `
    -Width 88
$openSourceButton.Height = 28
$openSourceButton.Margin = New-Object System.Windows.Forms.Padding(0, 4, 0, 4)

$targetLabel = New-Object System.Windows.Forms.Label
$targetLabel.Text = 'WwiseAudio'
$targetLabel.Dock = [System.Windows.Forms.DockStyle]::Fill
$targetLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$targetLabel.ForeColor = $colorSecondary

$targetBox = New-Object System.Windows.Forms.TextBox
$targetBox.Text = $targetRoot
$targetBox.ReadOnly = $true
$targetBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$targetBox.Dock = [System.Windows.Forms.DockStyle]::Fill
$targetBox.Margin = New-Object System.Windows.Forms.Padding(0, 6, 8, 5)
$targetBox.BackColor = $colorSurface
$targetBox.AccessibleName = 'WwiseAudio 迁移目标目录'

$openTargetButton = New-FlatButton `
    -Text '打开目标' `
    -BackColor $colorSurface `
    -ForeColor $colorText `
    -Width 88
$openTargetButton.Height = 28
$openTargetButton.Margin = New-Object System.Windows.Forms.Padding(0, 4, 0, 4)

$assetsLabel = New-Object System.Windows.Forms.Label
$assetsLabel.Text = 'Unreal 资源'
$assetsLabel.Dock = [System.Windows.Forms.DockStyle]::Fill
$assetsLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$assetsLabel.ForeColor = $colorSecondary

$assetsBox = New-Object System.Windows.Forms.TextBox
$assetsBox.Text = $soundDataRoot
$assetsBox.ReadOnly = $true
$assetsBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$assetsBox.Dock = [System.Windows.Forms.DockStyle]::Fill
$assetsBox.Margin = New-Object System.Windows.Forms.Padding(0, 6, 8, 5)
$assetsBox.BackColor = $colorSurface
$assetsBox.AccessibleName = 'WwiseSoundData 生成目录'

$openAssetsButton = New-FlatButton `
    -Text '打开资源' `
    -BackColor $colorSurface `
    -ForeColor $colorText `
    -Width 88
$openAssetsButton.Height = 28
$openAssetsButton.Margin = New-Object System.Windows.Forms.Padding(0, 4, 0, 4)

$platformLabel = New-Object System.Windows.Forms.Label
$platformLabel.Text = '平台范围'
$platformLabel.Dock = [System.Windows.Forms.DockStyle]::Fill
$platformLabel.TextAlign = [System.Drawing.ContentAlignment]::TopLeft
$platformLabel.Padding = New-Object System.Windows.Forms.Padding(0, 8, 0, 0)
$platformLabel.ForeColor = $colorSecondary

$platformList = New-Object System.Windows.Forms.ListView
$platformList.Dock = [System.Windows.Forms.DockStyle]::Fill
$platformList.View = [System.Windows.Forms.View]::Details
$platformList.FullRowSelect = $true
$platformList.HeaderStyle = [System.Windows.Forms.ColumnHeaderStyle]::Nonclickable
$platformList.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$platformList.BackColor = $colorSurface
$platformList.ForeColor = $colorText
$platformList.MultiSelect = $false
$platformList.HideSelection = $false
[void]$platformList.Columns.Add('平台', 180)
[void]$platformList.Columns.Add('迁移策略', 220)

$allPlatforms = @('Android', 'iOS', 'Mac', 'OpenHarmony', 'PS5', 'Windows')
foreach ($platform in $allPlatforms) {
    $isManaged = $definition.Managed -contains $platform
    $item = New-Object System.Windows.Forms.ListViewItem($platform)
    [void]$item.SubItems.Add(
        $(if ($isManaged) { '全量同步' } else { '不迁移' })
    )
    $item.ForeColor = if ($isManaged) { $colorAccent } else { $colorSecondary }
    [void]$platformList.Items.Add($item)
}

$infoPanel.Controls.Add($sourceLabel, 0, 0)
$infoPanel.Controls.Add($sourceBox, 1, 0)
$infoPanel.Controls.Add($openSourceButton, 2, 0)
$infoPanel.Controls.Add($targetLabel, 0, 1)
$infoPanel.Controls.Add($targetBox, 1, 1)
$infoPanel.Controls.Add($openTargetButton, 2, 1)
$infoPanel.Controls.Add($assetsLabel, 0, 2)
$infoPanel.Controls.Add($assetsBox, 1, 2)
$infoPanel.Controls.Add($openAssetsButton, 2, 2)
$infoPanel.Controls.Add($platformLabel, 0, 3)
$infoPanel.Controls.Add($platformList, 1, 3)
$infoPanel.SetColumnSpan($platformList, 2)

$actionPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$actionPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
$actionPanel.FlowDirection = [System.Windows.Forms.FlowDirection]::RightToLeft
$actionPanel.WrapContents = $false
$actionPanel.BackColor = $colorWindow
$actionPanel.Margin = New-Object System.Windows.Forms.Padding(0)

$migrateButton = New-FlatButton `
    -Text '开始完整流程(&M)' `
    -BackColor $colorAccent `
    -ForeColor ([System.Drawing.Color]::White) `
    -Width 158
$migrateButton.FlatAppearance.MouseOverBackColor = $colorAccentHover

$previewButton = New-FlatButton `
    -Text '预览(&P)' `
    -BackColor $colorSurface `
    -ForeColor $colorAccent `
    -Width 112
$previewButton.FlatAppearance.MouseOverBackColor = $colorWindow

$stopButton = New-FlatButton `
    -Text '停止(&S)' `
    -BackColor $colorSurface `
    -ForeColor $colorError `
    -Width 104
$stopButton.Enabled = $false

$openLogButton = New-FlatButton `
    -Text '打开日志(&L)' `
    -BackColor $colorSurface `
    -ForeColor $colorText `
    -Width 116

$actionPanel.Controls.Add($migrateButton)
$actionPanel.Controls.Add($previewButton)
$actionPanel.Controls.Add($stopButton)
$actionPanel.Controls.Add($openLogButton)

$logPanel = New-Object System.Windows.Forms.Panel
$logPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
$logPanel.BackColor = $colorSurface
$logPanel.Padding = New-Object System.Windows.Forms.Padding(14, 10, 14, 14)
$logPanel.Margin = New-Object System.Windows.Forms.Padding(0)

$logTitle = New-Object System.Windows.Forms.Label
$logTitle.Text = '运行记录'
$logTitle.Font = $sectionFont
$logTitle.ForeColor = $colorText
$logTitle.Dock = [System.Windows.Forms.DockStyle]::Top
$logTitle.Height = 28

$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Dock = [System.Windows.Forms.DockStyle]::Fill
$logBox.ReadOnly = $true
$logBox.BackColor = $colorLog
$logBox.ForeColor = $colorLogText
$logBox.Font = $logFont
$logBox.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$logBox.DetectUrls = $false
$logBox.WordWrap = $false
$logBox.AccessibleName = '迁移与资源生成运行记录'

$logPanel.Controls.Add($logBox)
$logPanel.Controls.Add($logTitle)

$rootLayout.Controls.Add($headerPanel, 0, 0)
$rootLayout.Controls.Add($infoPanel, 0, 1)
$rootLayout.Controls.Add($actionPanel, 0, 2)
$rootLayout.Controls.Add($logPanel, 0, 3)

$form.Controls.Add($rootLayout)
$form.Controls.Add($statusStrip)
$form.AcceptButton = $previewButton

$toolTip = New-Object System.Windows.Forms.ToolTip
$toolTip.SetToolTip(
    $previewButton,
    '检查 WwiseAudio 迁移及 WwiseSoundData 生成条件，不启动 Unreal、不修改 SVN。'
)
$toolTip.SetToolTip(
    $migrateButton,
    '依次迁移 WwiseAudio，并无界面生成、保存 WwiseSoundData。'
)
$toolTip.SetToolTip(
    $stopButton,
    '立即停止当前任务；停止后应重新运行一次迁移。'
)
$toolTip.SetToolTip($openLogButton, '打开最近一次运行的日志目录。')

$outputTimer = New-Object System.Windows.Forms.Timer
$outputTimer.Interval = 250
$outputTimer.Add_Tick({
        Update-UiOutput
        if (-not $script:MigrationProcess -or
            -not $script:MigrationProcess.HasExited) {
            return
        }

        $outputTimer.Stop()
        $script:MigrationProcess.WaitForExit()
        Update-UiOutput
        Close-UiOutputReader
        $completedExitCode = $script:MigrationProcess.ExitCode
        $script:MigrationProcess.Dispose()
        $script:MigrationProcess = $null
        Set-ControlsRunning -Running $false

        if ($script:UserStopped) {
            Set-UiState -State Warning -Text '预览已停止，未修改目标目录'
            $stageLabel.Text = '预览已停止'
        }
        elseif ($completedExitCode -eq 0) {
            $completedText = if ($script:RunMode -eq 'Preview') {
                '预览完成，未启动 Unreal、未修改 SVN'
            }
            else {
                '迁移与资源生成均已完成'
            }
            $stageLabel.Text = if ($script:RunMode -eq 'Preview') {
                '两阶段预览完成'
            }
            else {
                '阶段 2/2 · 已完成'
            }
            Set-UiState -State Success -Text $completedText
        }
        elseif ($completedExitCode -eq 4) {
            $stageLabel.Text = '执行已停止'
            Set-UiState `
                -State Warning `
                -Text '已停止：请先处理 SVN 更新或冲突'
        }
        elseif ($completedExitCode -eq 2) {
            $stageLabel.Text = '配置校验失败'
            Set-UiState `
                -State Error `
                -Text '项目、引擎或 Wwise 路径配置不匹配'
        }
        elseif ($completedExitCode -eq 3) {
            $stageLabel.Text = '运行条件不满足'
            Set-UiState `
                -State Warning `
                -Text '已有任务运行，或 Unreal 编辑器仍未关闭'
        }
        elseif ($completedExitCode -eq 5) {
            $stageLabel.Text = '资源生成失败'
            Set-UiState `
                -State Error `
                -Text 'Unreal 无界面资源生成失败，请查看日志'
        }
        elseif ($completedExitCode -eq 6) {
            $stageLabel.Text = '需要人工处理'
            Set-UiState `
                -State Warning `
                -Text '已生成资源，但存在 UE4 需人工处理的残留项'
        }
        elseif ($completedExitCode -eq 7) {
            $stageLabel.Text = 'SVN 对账失败'
            Set-UiState `
                -State Error `
                -Text '资源已生成，但 WwiseSoundData SVN 对账失败'
        }
        else {
            $stageLabel.Text = '执行失败'
            Set-UiState `
                -State Error `
                -Text ("任务失败，退出码 {0}" -f $completedExitCode)
        }

        if ($script:IsClosing) {
            $script:IsClosing = $false
            $form.Close()
        }
    })

$previewButton.Add_Click({ Start-Migration -PreviewMode })
$migrateButton.Add_Click({ Start-ConfirmedMigration })
$stopButton.Add_Click({ Stop-MigrationProcess })
$openSourceButton.Add_Click({ Open-Directory -Path $sourceRoot })
$openTargetButton.Add_Click({ Open-Directory -Path $targetRoot })
$openAssetsButton.Add_Click({ Open-Directory -Path $soundDataRoot })
$openLogButton.Add_Click({
        $directory = $script:LastRunLogDirectory
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }
        Open-Directory -Path $directory
    })

$form.Add_FormClosing({
        param($sender, $eventArgs)

        if ($script:MigrationProcess -and
            -not $script:MigrationProcess.HasExited) {
            $eventArgs.Cancel = $true
            if ($script:RunMode -eq 'Preview') {
                $script:IsClosing = $true
                Stop-MigrationProcess
            }
            else {
                Set-UiState `
                    -State Warning `
                    -Text '完整流程正在执行，完成后才能关闭窗口'
                Add-LogLine -Line (
                    '流程进行中，已阻止关闭窗口，避免留下未完成的 SVN 状态。'
                )
            }
        }
        else {
            Close-UiOutputReader
        }
    })

$form.Add_Shown({
        $previewButton.Focus()
        Add-LogLine -Line (
            '完整流程：先全量迁移 WwiseAudio，再自动生成并保存 WwiseSoundData。'
        )
        Add-LogLine -Line '预览不会启动 Unreal，也不会修改文件或 SVN 状态。'
        if ($Profile -in @('OSOB', 'OStrunk')) {
            Add-LogLine -Line 'Mac 和 OpenHarmony 已按分支策略排除。'
        }
    })

[void]$form.ShowDialog()
