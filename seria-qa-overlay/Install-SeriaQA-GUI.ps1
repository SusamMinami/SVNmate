[CmdletBinding()]
param(
    [string]$ManifestPath = "",
    [string]$TargetPath = "",
    [switch]$SkipRecovery,
    [switch]$SkipUpdateCheck,
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class SeriaQaDpi
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);

    [DllImport("shcore.dll")]
    public static extern int SetProcessDpiAwareness(int value);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@

function Enable-PerMonitorDpi {
    try {
        if ([SeriaQaDpi]::SetThreadDpiAwarenessContext(
            [IntPtr](-4)
        ) -ne [IntPtr]::Zero) {
            return
        }
    }
    catch {
    }
    try {
        if ([SeriaQaDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))) {
            return
        }
    }
    catch {
    }
    try {
        if ([SeriaQaDpi]::SetProcessDpiAwareness(2) -eq 0) {
            return
        }
    }
    catch {
    }
    try {
        [void][SeriaQaDpi]::SetProcessDPIAware()
    }
    catch {
    }
}

Enable-PerMonitorDpi
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public sealed class SeriaQaForm : Form
{
    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr window);

    public Size LogicalWindowSize { get; set; }
    public Size LogicalMinimumSize { get; set; }
    public Rectangle LaunchWorkingArea { get; set; }
    public uint ExpectedDpi { get; set; }
    private float contentScale = 1.0f;

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        BeginInvoke(new Action(delegate
        {
            uint windowDpi = GetDpiForWindow(Handle);
            uint effectiveDpi = Math.Max(
                windowDpi,
                Math.Max(96u, ExpectedDpi));
            ApplyInitialDpiLayout(effectiveDpi);
        }));
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        ApplyContentBounds();
    }

    private void ApplyContentBounds()
    {
        if (Controls.Count == 0 || contentScale <= 0.0f)
            return;

        Control root = Controls[0];
        root.Dock = DockStyle.None;
        root.Bounds = new Rectangle(
            0,
            0,
            (int)Math.Floor(ClientSize.Width / contentScale),
            (int)Math.Floor(ClientSize.Height / contentScale));
        root.PerformLayout();
    }

    private void ApplyInitialDpiLayout(uint dpi)
    {
        float dpiScale = Math.Max(1.0f, dpi / 96.0f);
        float windowScale = dpiScale;
        contentScale = dpiScale;
        int width = (int)Math.Round(LogicalWindowSize.Width * windowScale);
        int height = (int)Math.Round(LogicalWindowSize.Height * windowScale);
        float fitScale = Math.Min(
            1.0f,
            Math.Min(
                LaunchWorkingArea.Width / (float)width,
                LaunchWorkingArea.Height / (float)height));

        if (fitScale < 1.0f)
            Scale(new SizeF(fitScale, fitScale));

        width = (int)Math.Floor(width * fitScale);
        height = (int)Math.Floor(height * fitScale);
        int minimumWidth = Math.Min(
            (int)Math.Floor(
                LogicalMinimumSize.Width * windowScale * fitScale),
            width);
        int minimumHeight = Math.Min(
            (int)Math.Floor(
                LogicalMinimumSize.Height * windowScale * fitScale),
            height);

        Size = new Size(width, height);
        MinimumSize = new Size(minimumWidth, minimumHeight);
        Location = new Point(
            LaunchWorkingArea.Left +
                Math.Max(0, (LaunchWorkingArea.Width - width) / 2),
            LaunchWorkingArea.Top +
                Math.Max(0, (LaunchWorkingArea.Height - height) / 2));
        PerformLayout();
        ApplyContentBounds();
    }
}

public sealed class SeriaQaStatusDot : Control
{
    private Color fillColor = Color.Gray;

    public Color FillColor
    {
        get { return fillColor; }
        set
        {
            fillColor = value;
            Invalidate();
        }
    }

    public SeriaQaStatusDot()
    {
        SetStyle(
            ControlStyles.AllPaintingInWmPaint |
            ControlStyles.OptimizedDoubleBuffer |
            ControlStyles.ResizeRedraw |
            ControlStyles.UserPaint,
            true);
        AccessibleRole = AccessibleRole.PushButton;
        Cursor = Cursors.Hand;
        TabStop = true;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode =
            System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        Rectangle circle = new Rectangle(3, 3, Width - 7, Height - 7);
        Color border = Enabled
            ? Color.FromArgb(96, 0, 0, 0)
            : SystemColors.GrayText;
        using (Brush brush = new SolidBrush(
            Enabled ? fillColor : SystemColors.GrayText))
        using (Pen pen = new Pen(border, 1.0f))
        {
            e.Graphics.FillEllipse(brush, circle);
            e.Graphics.DrawEllipse(pen, circle);
        }
        if (Focused && ShowFocusCues)
            ControlPaint.DrawFocusRectangle(e.Graphics, ClientRectangle);
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space)
        {
            OnClick(EventArgs.Empty);
            e.Handled = true;
        }
    }
}
"@
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$toolRoot = $PSScriptRoot
function Resolve-QAManifestPath {
    param(
        [string]$Root,
        [string]$RequestedPath
    )

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        $candidate = if ([IO.Path]::IsPathRooted($RequestedPath)) {
            $RequestedPath
        }
        else {
            Join-Path $Root $RequestedPath
        }
        return [IO.Path]::GetFullPath($candidate)
    }

    $probe = [IO.DirectoryInfo][IO.Path]::GetFullPath($Root)
    for ($depth = 0; $depth -lt 3 -and $null -ne $probe; $depth++) {
        foreach ($name in @("manifest.qa.json", "manifest.json")) {
            $candidate = Join-Path $probe.FullName $name
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return [IO.Path]::GetFullPath($candidate)
            }
        }
        $probe = $probe.Parent
    }
    return [IO.Path]::GetFullPath((Join-Path $Root "manifest.json"))
}

$ManifestPath = Resolve-QAManifestPath `
    -Root $toolRoot `
    -RequestedPath $ManifestPath

$installerPath = Join-Path $toolRoot "Install-SeriaTool.ps1"
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    $installerPath = Join-Path $toolRoot "Reapply-DLSS5.ps1"
}
$recoveryPath = Join-Path $toolRoot "Publish-Persistent-Recovery.ps1"
$selfUpdatePath = Join-Path $toolRoot "SeriaQA-SelfUpdate.ps1"
$updateStateRoot = Join-Path (
    [Environment]::GetFolderPath("LocalApplicationData")
) "SVNmate\SeriaQAOverlay"
$updateStatePath = Join-Path $updateStateRoot "update-state.json"
$updateDownloadPath = Join-Path $updateStateRoot "updates"

try {
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw (
            "安装清单不存在：$ManifestPath`r`n`r`n" +
            "请直接双击完整的 Seria QA Overlay Setup.exe。不要在 ZIP " +
            "压缩包预览中单独运行 CMD 或 PS1；如需解压，请先完整解压全部文件。"
        )
    }
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
        throw "安装核心不存在：$installerPath"
    }
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    if ([string]$manifest.packageId -ne "seria-qa-overlay") {
        throw "此界面仅支持 Seria QA Overlay 安装包。"
    }
}
catch {
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        "Seria QA Overlay",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}

function Resolve-TargetCandidate {
    param([string]$InputPath)

    if ([string]::IsNullOrWhiteSpace($InputPath)) {
        return $null
    }
    $expanded = [Environment]::ExpandEnvironmentVariables(
        $InputPath.Trim().Trim('"')
    )
    $candidates = New-Object System.Collections.Generic.List[string]
    if ([IO.Path]::GetFileName($expanded) -ieq "Seria.exe") {
        $candidates.Add((Split-Path -Parent $expanded))
    }
    else {
        $candidates.Add($expanded)
        $candidates.Add((Join-Path $expanded "Seria\Binaries\Win64"))
        $candidates.Add((Join-Path $expanded "CoAGame\Seria\Binaries\Win64"))
        $candidates.Add((
            Join-Path $expanded "bin\WindowsNoEditor\Client\Seria\Binaries\Win64"
        ))
    }
    foreach ($candidate in $candidates) {
        try {
            $full = [IO.Path]::GetFullPath($candidate)
            if (Test-Path -LiteralPath (Join-Path $full "Seria.exe") -PathType Leaf) {
                return $full
            }
        }
        catch {
            continue
        }
    }
    return $null
}

function Find-TargetFromHint {
    param(
        [string]$HintPath,
        [int]$MaxDepth = 4,
        [int]$MaxDirectories = 1500
    )

    if ([string]::IsNullOrWhiteSpace($HintPath)) {
        return $null
    }

    $resolved = Resolve-TargetCandidate $HintPath
    if ($null -ne $resolved) {
        return $resolved
    }

    try {
        $expanded = [Environment]::ExpandEnvironmentVariables(
            $HintPath.Trim().Trim('"')
        )
        $fullHint = [IO.Path]::GetFullPath($expanded)
    }
    catch {
        return $null
    }

    $probe = $fullHint
    if (Test-Path -LiteralPath $probe -PathType Leaf) {
        $probe = Split-Path -Parent $probe
    }

    $searchRoot = $null
    while (-not [string]::IsNullOrWhiteSpace($probe)) {
        $resolved = Resolve-TargetCandidate $probe
        if ($null -ne $resolved) {
            return $resolved
        }
        if ($null -eq $searchRoot -and
            (Test-Path -LiteralPath $probe -PathType Container)) {
            $searchRoot = $probe
        }

        $parent = Split-Path -Parent $probe
        if ([string]::IsNullOrWhiteSpace($parent) -or
            [string]::Equals(
                $parent,
                $probe,
                [StringComparison]::OrdinalIgnoreCase
            )) {
            break
        }
        $probe = $parent
    }

    if ([string]::IsNullOrWhiteSpace($searchRoot)) {
        return $null
    }

    $pending = New-Object System.Collections.Queue
    $pending.Enqueue([pscustomobject]@{
        Path = $searchRoot
        Depth = 0
    })
    $visited = @{}
    $directoryCount = 0

    while ($pending.Count -gt 0 -and $directoryCount -lt $MaxDirectories) {
        $current = $pending.Dequeue()
        $currentPath = [string]$current.Path
        if ($visited.ContainsKey($currentPath)) {
            continue
        }
        $visited[$currentPath] = $true
        $directoryCount++

        $resolved = Resolve-TargetCandidate $currentPath
        if ($null -ne $resolved) {
            return $resolved
        }
        if ([int]$current.Depth -ge $MaxDepth) {
            continue
        }

        $children = @(
            Get-ChildItem -LiteralPath $currentPath -Directory -Force `
                -ErrorAction SilentlyContinue |
                Where-Object {
                    -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
                } |
                Sort-Object `
                    @{ Expression = {
                        if ($_.Name -ieq "trunk") { 0 } else { 1 }
                    } },
                    Name
        )
        foreach ($child in $children) {
            $pending.Enqueue([pscustomobject]@{
                Path = $child.FullName
                Depth = [int]$current.Depth + 1
            })
        }
    }

    return $null
}

function Find-DefaultTarget {
    param([string]$HintPath = "")

    $roots = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($HintPath)) {
        $roots.Add($HintPath)
    }
    if (-not [string]::IsNullOrWhiteSpace($TargetPath)) {
        $roots.Add($TargetPath)
    }
    if (-not [string]::IsNullOrWhiteSpace($env:SERIA_TRUNK)) {
        $roots.Add($env:SERIA_TRUNK)
    }
    $roots.Add((Join-Path $env:SystemDrive "trunk"))

    $seen = @{}
    foreach ($root in $roots) {
        $rootKey = $root.Trim().Trim('"')
        if ($seen.ContainsKey($rootKey)) {
            continue
        }
        $seen[$rootKey] = $true
        $resolved = Find-TargetFromHint $root
        if ($null -ne $resolved) {
            return $resolved
        }
    }
    return ""
}

if ($ValidateOnly) {
    [pscustomobject]@{
        Manifest = $ManifestPath
        Installer = $installerPath
        PackageId = [string]$manifest.packageId
        PackageVersion = [string]$manifest.packageVersion
        DefaultTarget = Find-DefaultTarget
    } | Format-List
    exit 0
}

$colorWindow = [Drawing.Color]::FromArgb(243, 243, 243)
$colorPanel = [Drawing.Color]::White
$colorField = [Drawing.Color]::White
$colorText = [Drawing.Color]::FromArgb(26, 26, 26)
$colorMuted = [Drawing.Color]::FromArgb(102, 102, 102)
$colorAccent = [Drawing.Color]::FromArgb(0, 103, 192)
$colorAccentHover = [Drawing.Color]::FromArgb(25, 118, 210)
$colorAccentPressed = [Drawing.Color]::FromArgb(0, 90, 158)
$colorButton = [Drawing.Color]::FromArgb(247, 247, 247)
$colorButtonHover = [Drawing.Color]::FromArgb(233, 233, 233)
$colorButtonPressed = [Drawing.Color]::FromArgb(221, 221, 221)
$colorRule = [Drawing.Color]::FromArgb(209, 209, 209)
$colorSuccess = [Drawing.Color]::FromArgb(21, 59, 27)
$colorError = [Drawing.Color]::FromArgb(180, 35, 24)
$colorUpdateOk = [Drawing.Color]::FromArgb(16, 124, 16)
$colorUpdateAvailable = [Drawing.Color]::FromArgb(196, 43, 28)
$colorUpdateChecking = [Drawing.Color]::FromArgb(0, 103, 192)
$colorUpdateUnknown = [Drawing.Color]::FromArgb(118, 118, 118)
$colorUpdateError = [Drawing.Color]::FromArgb(157, 93, 0)
$colorPrimaryText = [Drawing.Color]::White
if ([Windows.Forms.SystemInformation]::HighContrast) {
    $colorWindow = [Windows.Forms.SystemColors]::Window
    $colorPanel = [Windows.Forms.SystemColors]::Control
    $colorField = [Windows.Forms.SystemColors]::Window
    $colorText = [Windows.Forms.SystemColors]::WindowText
    $colorMuted = [Windows.Forms.SystemColors]::GrayText
    $colorAccent = [Windows.Forms.SystemColors]::Highlight
    $colorAccentHover = [Windows.Forms.SystemColors]::Highlight
    $colorAccentPressed = [Windows.Forms.SystemColors]::Highlight
    $colorButton = [Windows.Forms.SystemColors]::Control
    $colorButtonHover = [Windows.Forms.SystemColors]::Control
    $colorButtonPressed = [Windows.Forms.SystemColors]::Control
    $colorRule = [Windows.Forms.SystemColors]::WindowText
    $colorSuccess = [Windows.Forms.SystemColors]::WindowText
    $colorError = [Windows.Forms.SystemColors]::WindowText
    $colorUpdateOk = [Windows.Forms.SystemColors]::Highlight
    $colorUpdateAvailable = [Windows.Forms.SystemColors]::Highlight
    $colorUpdateChecking = [Windows.Forms.SystemColors]::Highlight
    $colorUpdateUnknown = [Windows.Forms.SystemColors]::GrayText
    $colorUpdateError = [Windows.Forms.SystemColors]::Highlight
    $colorPrimaryText = [Windows.Forms.SystemColors]::HighlightText
}

function New-UiLabel {
    param(
        [string]$Text,
        [float]$Size = 9.0,
        [Drawing.FontStyle]$Style = [Drawing.FontStyle]::Regular,
        [Drawing.Color]$Color = $colorText
    )
    $label = New-Object Windows.Forms.Label
    $label.Text = $Text
    $family = if ($Style -band [Drawing.FontStyle]::Bold) {
        "Segoe UI Semibold"
    }
    else {
        "Segoe UI"
    }
    $label.Font = New-Object Drawing.Font(
        $family,
        $Size,
        [Drawing.FontStyle]::Regular,
        [Drawing.GraphicsUnit]::Point
    )
    $label.ForeColor = $Color
    $label.AutoSize = $true
    $label.Margin = New-Object Windows.Forms.Padding(0)
    $label.UseCompatibleTextRendering = $false
    return $label
}

function New-UiButton {
    param(
        [string]$Text,
        [switch]$Primary
    )
    $button = New-Object Windows.Forms.Button
    $button.Text = $Text
    $button.Font = New-Object Drawing.Font(
        $(if ($Primary) { "Segoe UI Semibold" } else { "Segoe UI" }),
        $(if ($Primary) { 10.0 } else { 9.0 }),
        [Drawing.FontStyle]::Regular,
        [Drawing.GraphicsUnit]::Point
    )
    if ([Windows.Forms.SystemInformation]::HighContrast) {
        $button.FlatStyle = [Windows.Forms.FlatStyle]::System
        $button.UseVisualStyleBackColor = $true
    }
    else {
        $button.FlatStyle = [Windows.Forms.FlatStyle]::Flat
        $button.UseVisualStyleBackColor = $false
        $button.FlatAppearance.BorderSize = 1
        $button.FlatAppearance.BorderColor = if ($Primary) {
            $colorAccent
        }
        else {
            $colorRule
        }
        $button.FlatAppearance.MouseOverBackColor = if ($Primary) {
            $colorAccentHover
        }
        else {
            $colorButtonHover
        }
        $button.FlatAppearance.MouseDownBackColor = if ($Primary) {
            $colorAccentPressed
        }
        else {
            $colorButtonPressed
        }
    }
    $button.BackColor = if ($Primary) { $colorAccent } else { $colorButton }
    $button.ForeColor = if ($Primary) { $colorPrimaryText } else { $colorText }
    $button.Height = 34
    $button.AutoSize = $false
    $button.MinimumSize = New-Object Drawing.Size(72, 34)
    $button.Padding = New-Object Windows.Forms.Padding(12, 0, 12, 0)
    $button.Margin = New-Object Windows.Forms.Padding(6, 0, 0, 0)
    $button.UseCompatibleTextRendering = $false
    return $button
}

function Quote-ProcessArgument {
    param([string]$Value)
    return '"' + $Value.Replace('"', '\"') + '"'
}

$form = New-Object SeriaQaForm
$form.Text = "Seria QA Overlay 安装与配置"
$form.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
$form.BackColor = $colorWindow
$form.ForeColor = $colorText
$form.Font = New-Object Drawing.Font(
    "Segoe UI",
    10.0,
    [Drawing.FontStyle]::Regular,
    [Drawing.GraphicsUnit]::Point
)
$form.AutoScaleMode = [Windows.Forms.AutoScaleMode]::None
$baseFormSize = New-Object Drawing.Size(1000, 760)
$baseMinimumSize = New-Object Drawing.Size(900, 660)
$form.Size = $baseFormSize
$form.MinimumSize = $baseMinimumSize

$main = New-Object Windows.Forms.TableLayoutPanel
$main.Dock = [Windows.Forms.DockStyle]::Fill
$main.Padding = New-Object Windows.Forms.Padding(18)
$main.ColumnCount = 1
$main.RowCount = 8
$main.BackColor = $colorWindow
$null = $main.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 74
)))
$null = $main.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 150
)))
$null = $main.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 142
)))
$null = $main.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 44
)))
$null = $main.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 44
)))
$null = $main.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 28
)))
$null = $main.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Percent, 100
)))
$null = $main.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 28
)))
$form.Controls.Add($main)

$header = New-Object Windows.Forms.Panel
$header.Dock = [Windows.Forms.DockStyle]::Fill
$header.BackColor = $colorWindow
$title = New-UiLabel -Text "Seria QA Overlay" -Size 22 -Style Bold
$title.Location = New-Object Drawing.Point(0, 0)
$subtitle = New-UiLabel `
    -Text "安装、更新并配置游戏内任务工具" `
    -Size 9 `
    -Color $colorMuted
$subtitle.Location = New-Object Drawing.Point(1, 43)
$header.Controls.Add($title)
$header.Controls.Add($subtitle)
$main.Controls.Add($header, 0, 0)

$targetGroup = New-Object Windows.Forms.Panel
$targetGroup.Dock = [Windows.Forms.DockStyle]::Fill
$targetGroup.ForeColor = $colorText
$targetGroup.BackColor = $colorPanel
$targetGroup.BorderStyle = [Windows.Forms.BorderStyle]::FixedSingle
$targetGroup.Padding = New-Object Windows.Forms.Padding(12, 9, 12, 9)
$targetGroup.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 10)
$targetLayout = New-Object Windows.Forms.TableLayoutPanel
$targetLayout.Dock = [Windows.Forms.DockStyle]::Fill
$targetLayout.BackColor = $colorPanel
$targetLayout.ColumnCount = 4
$targetLayout.RowCount = 3
$null = $targetLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle(
    [Windows.Forms.SizeType]::Percent, 50
)))
$null = $targetLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle(
    [Windows.Forms.SizeType]::Percent, 22
)))
$null = $targetLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle(
    [Windows.Forms.SizeType]::Percent, 14
)))
$null = $targetLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle(
    [Windows.Forms.SizeType]::Percent, 14
)))
$null = $targetLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 25
)))
$null = $targetLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 40
)))
$null = $targetLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Percent, 100
)))
$targetGroup.Controls.Add($targetLayout)

$targetTitle = New-UiLabel -Text "游戏目录" -Size 11 -Style Bold
$targetTitle.Dock = [Windows.Forms.DockStyle]::Fill
$targetTitle.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
$targetLayout.Controls.Add($targetTitle, 0, 0)
$targetLayout.SetColumnSpan($targetTitle, 4)

$targetBox = New-Object Windows.Forms.TextBox
$targetBox.Dock = [Windows.Forms.DockStyle]::Fill
$targetBox.BackColor = $colorField
$targetBox.ForeColor = $colorText
$targetBox.BorderStyle = [Windows.Forms.BorderStyle]::FixedSingle
$targetBox.Font = New-Object Drawing.Font(
    "Segoe UI",
    10.0,
    [Drawing.FontStyle]::Regular,
    [Drawing.GraphicsUnit]::Point
)
$targetBox.Text = if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    ""
}
else {
    $TargetPath.Trim().Trim('"')
}
$targetBox.ShortcutsEnabled = $true
$targetBox.AccessibleName = "游戏目录"
$targetBox.AccessibleDescription = "可输入 trunk 大概位置、游戏根目录、Seria.exe 或 Win64 目录"
$targetBox.TabIndex = 0
$targetBox.Margin = New-Object Windows.Forms.Padding(0, 5, 8, 5)
$pasteButton = New-UiButton -Text "粘贴"
$pasteButton.Dock = [Windows.Forms.DockStyle]::Fill
$pasteButton.AccessibleName = "粘贴游戏目录"
$pasteButton.TabIndex = 1
$pasteButton.Margin = New-Object Windows.Forms.Padding(0, 4, 8, 4)
$browseButton = New-UiButton -Text "浏览..."
$browseButton.Dock = [Windows.Forms.DockStyle]::Fill
$browseButton.AccessibleName = "浏览游戏目录"
$browseButton.TabIndex = 2
$browseButton.Margin = New-Object Windows.Forms.Padding(0, 4, 8, 4)
$detectButton = New-UiButton -Text "自动检测"
$detectButton.Dock = [Windows.Forms.DockStyle]::Fill
$detectButton.AccessibleName = "自动检测游戏目录"
$detectButton.TabIndex = 3
$detectButton.Margin = New-Object Windows.Forms.Padding(0, 4, 0, 4)
$targetLayout.Controls.Add($targetBox, 0, 1)
$targetLayout.SetColumnSpan($targetBox, 3)
$targetLayout.Controls.Add($pasteButton, 3, 1)

$targetFeedback = New-UiLabel `
    -Text "输入 trunk 大概位置，点击自动检测即可定位到具体游戏目录。" `
    -Size 9 `
    -Color $colorMuted
$targetFeedback.AutoSize = $false
$targetFeedback.Dock = [Windows.Forms.DockStyle]::Fill
$targetFeedback.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
$targetFeedback.AutoEllipsis = $true
$targetFeedback.AccessibleName = "游戏目录状态"
$targetLayout.Controls.Add($targetFeedback, 0, 2)
$targetLayout.SetColumnSpan($targetFeedback, 2)
$targetLayout.Controls.Add($browseButton, 2, 2)
$targetLayout.Controls.Add($detectButton, 3, 2)
$main.Controls.Add($targetGroup, 0, 1)

$optionsGroup = New-Object Windows.Forms.Panel
$optionsGroup.Dock = [Windows.Forms.DockStyle]::Fill
$optionsGroup.ForeColor = $colorText
$optionsGroup.BackColor = $colorPanel
$optionsGroup.BorderStyle = [Windows.Forms.BorderStyle]::FixedSingle
$optionsGroup.Padding = New-Object Windows.Forms.Padding(12, 9, 12, 9)
$optionsGroup.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 10)
$optionsLayout = New-Object Windows.Forms.TableLayoutPanel
$optionsLayout.Dock = [Windows.Forms.DockStyle]::Fill
$optionsLayout.BackColor = $colorPanel
$optionsLayout.ColumnCount = 1
$optionsLayout.RowCount = 4
$null = $optionsLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle(
    [Windows.Forms.SizeType]::Percent, 100
)))
$null = $optionsLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 25
)))
$null = $optionsLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 30
)))
$null = $optionsLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Absolute, 30
)))
$null = $optionsLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle(
    [Windows.Forms.SizeType]::Percent, 100
)))
$optionsGroup.Controls.Add($optionsLayout)

$optionsTitle = New-UiLabel -Text "显示设置" -Size 11 -Style Bold
$optionsTitle.Dock = [Windows.Forms.DockStyle]::Fill
$optionsTitle.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
$optionsLayout.Controls.Add($optionsTitle, 0, 0)

$hudVisible = New-Object Windows.Forms.CheckBox
$hudVisible.Text = "显示左上角任务窗口"
$hudVisible.Checked = $true
$hudVisible.AutoSize = $true
$hudVisible.BackColor = $colorPanel
$hudVisible.ForeColor = $colorText
$hudVisible.Font = New-Object Drawing.Font(
    "Segoe UI",
    10.0,
    [Drawing.FontStyle]::Regular,
    [Drawing.GraphicsUnit]::Point
)
$hudVisible.AccessibleName = "显示左上角任务窗口"
$hudVisible.TabIndex = 4
$hudVisible.Margin = New-Object Windows.Forms.Padding(0, 4, 0, 0)
$optionsLayout.Controls.Add($hudVisible, 0, 1)

$fullReShadeHome = New-Object Windows.Forms.CheckBox
$fullReShadeHome.Text = "Home 显示完整 ReShade 页面"
$fullReShadeHome.Checked = $false
$fullReShadeHome.AutoSize = $true
$fullReShadeHome.BackColor = $colorPanel
$fullReShadeHome.ForeColor = $colorText
$fullReShadeHome.Font = New-Object Drawing.Font(
    "Segoe UI",
    10.0,
    [Drawing.FontStyle]::Regular,
    [Drawing.GraphicsUnit]::Point
)
$fullReShadeHome.AccessibleName = "Home 显示完整 ReShade 页面"
$fullReShadeHome.AccessibleDescription = "关闭时 Home 只显示 Seria QA"
$fullReShadeHome.TabIndex = 5
$fullReShadeHome.Margin = New-Object Windows.Forms.Padding(0, 4, 0, 0)
$optionsLayout.Controls.Add($fullReShadeHome, 0, 2)

$opacityPanel = New-Object Windows.Forms.FlowLayoutPanel
$opacityPanel.Dock = [Windows.Forms.DockStyle]::Fill
$opacityPanel.FlowDirection = [Windows.Forms.FlowDirection]::LeftToRight
$opacityPanel.WrapContents = $false
$opacityPanel.BackColor = $colorPanel
$opacityTitle = New-UiLabel -Text "背景不透明度" -Color $colorMuted
$opacityTitle.AutoSize = $false
$opacityTitle.Width = 120
$opacityTitle.Height = 30
$opacityTitle.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
$opacityTitle.Margin = New-Object Windows.Forms.Padding(0)
$opacity = New-Object Windows.Forms.NumericUpDown
$opacity.Minimum = 25
$opacity.Maximum = 100
$opacity.Value = 78
$opacity.Increment = 1
$opacity.DecimalPlaces = 0
$opacity.TextAlign = [Windows.Forms.HorizontalAlignment]::Right
$opacity.BackColor = $colorField
$opacity.ForeColor = $colorText
$opacity.BorderStyle = [Windows.Forms.BorderStyle]::FixedSingle
$opacity.Width = 92
$opacity.AccessibleName = "背景不透明度"
$opacity.AccessibleDescription = "范围 25% 到 100%"
$opacity.TabIndex = 6
$opacity.Margin = New-Object Windows.Forms.Padding(0, 3, 6, 0)
$opacityPanel.Controls.Add($opacityTitle)
$opacityPanel.Controls.Add($opacity)
$opacityValue = New-UiLabel -Text "%" -Color $colorAccent
$opacityValue.AutoSize = $false
$opacityValue.Width = 24
$opacityValue.Height = 30
$opacityValue.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
$opacityValue.Margin = New-Object Windows.Forms.Padding(0)
$opacityPanel.Controls.Add($opacityValue)
$optionsLayout.Controls.Add($opacityPanel, 0, 3)
$main.Controls.Add($optionsGroup, 0, 2)

$notice = New-UiLabel `
    -Text "安装前校验包内 SHA-256；不同文件自动备份。工具不会结束游戏进程。" `
    -Color $colorMuted
$notice.Dock = [Windows.Forms.DockStyle]::Fill
$notice.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
$main.Controls.Add($notice, 0, 3)

$actions = New-Object Windows.Forms.FlowLayoutPanel
$actions.Dock = [Windows.Forms.DockStyle]::Fill
$actions.FlowDirection = [Windows.Forms.FlowDirection]::LeftToRight
$actions.WrapContents = $false
$actions.BackColor = $colorWindow
$installButton = New-UiButton -Text "安装 / 更新" -Primary
$verifyButton = New-UiButton -Text "仅校验"
$closeButton = New-UiButton -Text "关闭"
$installButton.Width = [Math]::Max(
    118,
    [Windows.Forms.TextRenderer]::MeasureText(
        $installButton.Text,
        $installButton.Font
    ).Width + $installButton.Padding.Horizontal + 24
)
$verifyButton.Width = [Math]::Max(
    88,
    [Windows.Forms.TextRenderer]::MeasureText(
        $verifyButton.Text,
        $verifyButton.Font
    ).Width + $verifyButton.Padding.Horizontal + 24
)
$closeButton.Width = [Math]::Max(
    78,
    [Windows.Forms.TextRenderer]::MeasureText(
        $closeButton.Text,
        $closeButton.Font
    ).Width + $closeButton.Padding.Horizontal + 24
)
$installButton.TabIndex = 7
$verifyButton.TabIndex = 8
$closeButton.TabIndex = 9
$actions.Controls.Add($installButton)
$actions.Controls.Add($verifyButton)
$actions.Controls.Add($closeButton)
$main.Controls.Add($actions, 0, 4)
$closeButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
$form.AcceptButton = $installButton
$form.CancelButton = $closeButton

$status = New-UiLabel -Text "准备就绪" -Color $colorMuted
$status.Dock = [Windows.Forms.DockStyle]::Fill
$status.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
$main.Controls.Add($status, 0, 5)

$logBox = New-Object Windows.Forms.RichTextBox
$logBox.Dock = [Windows.Forms.DockStyle]::Fill
$logBox.ReadOnly = $true
$logBox.BorderStyle = [Windows.Forms.BorderStyle]::FixedSingle
$logBox.BackColor = $colorPanel
$logBox.ForeColor = $colorText
$logBox.Font = New-Object Drawing.Font(
    "Segoe UI",
    9.0,
    [Drawing.FontStyle]::Regular,
    [Drawing.GraphicsUnit]::Point
)
$logBox.DetectUrls = $false
$logBox.WordWrap = $false
$logBox.AccessibleName = "安装输出"
$logBox.TabIndex = 10
$logBox.Text = "选择游戏目录后，可安装更新或只校验现有文件。`r`n"
$main.Controls.Add($logBox, 0, 6)

$footer = New-Object Windows.Forms.FlowLayoutPanel
$footer.Dock = [Windows.Forms.DockStyle]::Fill
$footer.FlowDirection = [Windows.Forms.FlowDirection]::LeftToRight
$footer.WrapContents = $false
$footer.BackColor = $colorWindow
$footer.Margin = New-Object Windows.Forms.Padding(0)
$updateDot = New-Object SeriaQaStatusDot
$updateDot.Width = 22
$updateDot.Height = 22
$updateDot.BackColor = $colorWindow
$updateDot.FillColor = $colorUpdateUnknown
$updateDot.AccessibleName = "更新状态"
$updateDot.AccessibleDescription = "尚未检查更新；点击检查"
$updateDot.TabIndex = 11
$updateDot.Margin = New-Object Windows.Forms.Padding(0, 1, 5, 0)
$footerLabel = New-UiLabel `
    -Text "$($manifest.displayName)  $($manifest.packageVersion)  ·  CLI 更新入口保持兼容" `
    -Color $colorMuted
$footerLabel.Margin = New-Object Windows.Forms.Padding(0, 3, 0, 0)
$footer.Controls.Add($updateDot)
$footer.Controls.Add($footerLabel)
$main.Controls.Add($footer, 0, 7)

$toolTip = New-Object Windows.Forms.ToolTip
$toolTip.AutoPopDelay = 10000
$toolTip.InitialDelay = 450
$toolTip.ReshowDelay = 100
$toolTip.ShowAlways = $true
$toolTip.SetToolTip(
    $targetBox,
    '可输入 trunk 大概位置、游戏根目录、Seria.exe 或 Win64 目录。'
)
$toolTip.SetToolTip($pasteButton, "读取剪贴板中的游戏路径")
$toolTip.SetToolTip($browseButton, "从文件夹中选择游戏目录")
$toolTip.SetToolTip(
    $detectButton,
    "优先从输入位置的上级和附近子目录查找，再检查默认 trunk 位置"
)
$toolTip.SetToolTip(
    $fullReShadeHome,
    "关闭时 Home 只打开 Seria QA；开启后 Home 显示完整 ReShade 页面。"
)
$toolTip.SetToolTip($updateDot, "尚未检查更新；点击检查")

function Get-InstalledIniValue {
    param(
        [string]$Path,
        [string]$Section,
        [string]$Key
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    $currentSection = ""
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.StartsWith("[") -and $trimmed.EndsWith("]")) {
            $currentSection = $trimmed.Substring(1, $trimmed.Length - 2)
            continue
        }
        if ($currentSection -ieq $Section -and
            $line -match "^\s*$([Regex]::Escape($Key))\s*=(.*)$") {
            return $Matches[1].Trim()
        }
    }
    return $null
}

function Load-InstalledPreferences {
    param([string]$InputPath)

    $resolved = Resolve-TargetCandidate $InputPath
    if ($null -eq $resolved) {
        return
    }
    $iniPath = Join-Path $resolved "ReShade.ini"
    $visible = Get-InstalledIniValue `
        -Path $iniPath `
        -Section "SeriaQAOverlay" `
        -Key "HudVisible"
    $opacityValueFromIni = Get-InstalledIniValue `
        -Path $iniPath `
        -Section "SeriaQAOverlay" `
        -Key "HudOpacity"
    $fullReShadeValue = Get-InstalledIniValue `
        -Path $iniPath `
        -Section "SeriaQAOverlay" `
        -Key "HomeOpensFullReShade"

    if ($visible -in @("0", "1")) {
        $hudVisible.Checked = $visible -eq "1"
    }
    if ($fullReShadeValue -in @("0", "1")) {
        $fullReShadeHome.Checked = $fullReShadeValue -eq "1"
    }
    $parsedOpacity = 0
    if ([int]::TryParse(
        [string]$opacityValueFromIni,
        [ref]$parsedOpacity
    ) -and $parsedOpacity -ge 25 -and $parsedOpacity -le 100) {
        $opacity.Value = $parsedOpacity
    }
    if ($null -ne $visible -or
        $null -ne $opacityValueFromIni -or
        $null -ne $fullReShadeValue) {
        $status.Text = "已读取现有显示设置。"
        $status.ForeColor = $colorSuccess
    }
}

function Update-TargetFeedback {
    if ([string]::IsNullOrWhiteSpace($targetBox.Text)) {
        $targetFeedback.Text = "输入 trunk 大概位置，点击自动检测即可定位到具体游戏目录。"
        $targetFeedback.ForeColor = $colorMuted
        $toolTip.SetToolTip($targetFeedback, $targetFeedback.Text)
        return $null
    }

    $resolved = Resolve-TargetCandidate $targetBox.Text
    if ($null -eq $resolved) {
        $targetFeedback.Text = "尚未定位到 Seria.exe；可点击自动检测继续查找附近目录。"
        $targetFeedback.ForeColor = $colorMuted
        $toolTip.SetToolTip($targetFeedback, $targetFeedback.Text)
        return $null
    }

    $targetFeedback.Text = "有效路径：$resolved"
    $targetFeedback.ForeColor = $colorSuccess
    $toolTip.SetToolTip($targetFeedback, $targetFeedback.Text)
    return $resolved
}

$script:activeProcess = $null
$script:activeMode = ""
$script:activeTarget = ""
$script:activeInstallOutput = ""
$script:updateProcess = $null
$script:updateMode = ""
$script:updateVersion = ""
$script:updateUrl = ""
$script:updateSha256 = ""
$script:updateManual = $false
$script:updateStartedAt = [DateTime]::MinValue

function Append-Log {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return
    }
    $logBox.AppendText($Text.TrimEnd() + "`r`n")
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
}

function Set-UpdateIndicator {
    param(
        [ValidateSet("Unknown", "Checking", "UpToDate", "Available", "Error")]
        [string]$State,
        [string]$Detail
    )

    $updateDot.FillColor = switch ($State) {
        "Checking" { $colorUpdateChecking }
        "UpToDate" { $colorUpdateOk }
        "Available" { $colorUpdateAvailable }
        "Error" { $colorUpdateError }
        default { $colorUpdateUnknown }
    }
    $updateDot.AccessibleDescription = $Detail
    $toolTip.SetToolTip($updateDot, $Detail)
}

function Set-Busy {
    param(
        [bool]$Busy,
        [string]$Message = "准备就绪"
    )
    $targetBox.Enabled = -not $Busy
    $pasteButton.Enabled = -not $Busy
    $browseButton.Enabled = -not $Busy
    $detectButton.Enabled = -not $Busy
    $hudVisible.Enabled = -not $Busy
    $fullReShadeHome.Enabled = -not $Busy
    $opacity.Enabled = -not $Busy
    $installButton.Enabled = -not $Busy
    $verifyButton.Enabled = -not $Busy
    $updateDot.Enabled = (
        -not $Busy -and $null -eq $script:updateProcess
    )
    $closeButton.Enabled = -not $Busy
    $status.Text = $Message
    $status.ForeColor = if ($Busy) { $colorAccent } else { $colorMuted }
    [Windows.Forms.Application]::UseWaitCursor = $Busy
}

function Set-UpdateBusy {
    param(
        [bool]$Busy,
        [string]$Message = ""
    )
    $updateDot.Enabled = (
        -not $Busy -and
        $null -eq $script:updateProcess -and
        $null -eq $script:activeProcess
    )
    $installButton.Enabled = (
        -not $Busy -and $null -eq $script:activeProcess
    )
    $verifyButton.Enabled = (
        -not $Busy -and $null -eq $script:activeProcess
    )
    if (-not [string]::IsNullOrWhiteSpace($Message)) {
        $status.Text = $Message
        $status.ForeColor = if ($Busy) { $colorAccent } else { $colorMuted }
    }
}

function Start-PowerShellStep {
    param(
        [string]$ScriptPath,
        [string[]]$Arguments,
        [string]$Mode
    )
    $powershell = Join-Path $PSHOME "powershell.exe"
    $parts = @(
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", (Quote-ProcessArgument $ScriptPath)
    )
    foreach ($argument in $Arguments) {
        $parts += Quote-ProcessArgument ([string]$argument)
    }

    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powershell
    $startInfo.Arguments = $parts -join " "
    $startInfo.WorkingDirectory = $toolRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $windowsModulePaths = @(
        (Join-Path $env:USERPROFILE "Documents\WindowsPowerShell\Modules"),
        [Environment]::GetEnvironmentVariable("PSModulePath", "Machine")
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $startInfo.EnvironmentVariables["PSModulePath"] = (
        $windowsModulePaths -join ";"
    )

    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "无法启动安装核心。"
    }
    $script:activeProcess = $process
    $script:activeMode = $Mode
}

function Start-UpdateStep {
    param(
        [ValidateSet("Check", "Download")]
        [string]$Mode,
        [string[]]$Arguments,
        [bool]$Manual
    )

    if (-not (Test-Path -LiteralPath $selfUpdatePath -PathType Leaf)) {
        throw "自更新组件不存在：$selfUpdatePath"
    }
    $powershell = Join-Path $PSHOME "powershell.exe"
    $parts = @(
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", (Quote-ProcessArgument $selfUpdatePath),
        "-Mode", $Mode
    )
    foreach ($argument in $Arguments) {
        $parts += Quote-ProcessArgument ([string]$argument)
    }

    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powershell
    $startInfo.Arguments = $parts -join " "
    $startInfo.WorkingDirectory = $toolRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "无法启动更新检查。"
    }
    $script:updateProcess = $process
    $script:updateMode = $Mode
    $script:updateManual = $Manual
    $script:updateStartedAt = [DateTime]::UtcNow
    $updatePollTimer.Start()
}

function Save-UpdateState {
    param([object]$Result)

    try {
        New-Item -ItemType Directory -Path $updateStateRoot -Force | Out-Null
        $state = [ordered]@{
            lastCheckDate = [DateTime]::Today.ToString("yyyy-MM-dd")
            status = [string]$Result.status
            version = [string]$Result.version
        }
        if ([string]$Result.status -eq "update_available") {
            $state.setupUrl = [string]$Result.setup_url
            $state.setupSha256 = [string]$Result.setup_sha256
        }
        [IO.File]::WriteAllText(
            $updateStatePath,
            ($state | ConvertTo-Json),
            (New-Object Text.UTF8Encoding($false))
        )
    }
    catch {
        Append-Log "更新检查日期未能保存：$($_.Exception.Message)"
    }
}

function Restore-UpdateState {
    try {
        if (-not (Test-Path -LiteralPath $updateStatePath -PathType Leaf)) {
            Set-UpdateIndicator `
                -State "Unknown" `
                -Detail "尚未检查更新；点击检查"
            return
        }
        $state = Get-Content -LiteralPath $updateStatePath -Raw |
            ConvertFrom-Json
        if ([string]$state.lastCheckDate -ne
            [DateTime]::Today.ToString("yyyy-MM-dd")) {
            Set-UpdateIndicator `
                -State "Unknown" `
                -Detail "今天尚未检查更新；点击立即检查"
            return
        }
        if ([string]$state.status -eq "update_available" -and
            -not [string]::IsNullOrWhiteSpace([string]$state.version) -and
            -not [string]::IsNullOrWhiteSpace([string]$state.setupUrl) -and
            -not [string]::IsNullOrWhiteSpace([string]$state.setupSha256) -and
            [Version]::Parse([string]$state.version) -gt
            [Version]::Parse([string]$manifest.moduleVersion)) {
            $script:updateVersion = [string]$state.version
            $script:updateUrl = [string]$state.setupUrl
            $script:updateSha256 = [string]$state.setupSha256
            Set-UpdateIndicator `
                -State "Available" `
                -Detail "发现新版本 v$($script:updateVersion)；点击下载并打开更新"
            return
        }
        Set-UpdateIndicator `
            -State "UpToDate" `
            -Detail "已是最新版本；点击重新检查"
    }
    catch {
        Set-UpdateIndicator `
            -State "Unknown" `
            -Detail "更新状态不可用；点击重新检查"
    }
}

function Test-UpdateDueToday {
    try {
        if (-not (Test-Path -LiteralPath $updateStatePath -PathType Leaf)) {
            return $true
        }
        $state = Get-Content -LiteralPath $updateStatePath -Raw |
            ConvertFrom-Json
        return (
            [string]$state.lastCheckDate -ne
            [DateTime]::Today.ToString("yyyy-MM-dd")
        )
    }
    catch {
        return $true
    }
}

function Start-UpdateCheck {
    param([bool]$Manual)

    if ($null -ne $script:updateProcess) {
        if ($Manual) {
            $status.Text = "更新检查已在进行。"
            $status.ForeColor = $colorAccent
        }
        return
    }
    try {
        Set-UpdateIndicator -State "Checking" -Detail "正在检查更新..."
        Set-UpdateBusy `
            -Busy $true `
            -Message $(if ($Manual) { "正在检查 Seria QA 更新..." } else { "" })
        if ($Manual) {
            Append-Log "> 手动检查更新"
        }
        Start-UpdateStep `
            -Mode "Check" `
            -Arguments @(
                "-CurrentVersion", [string]$manifest.moduleVersion
            ) `
            -Manual $Manual
    }
    catch {
        Set-UpdateIndicator `
            -State "Error" `
            -Detail "更新检查失败；点击重试"
        Set-UpdateBusy `
            -Busy $false `
            -Message $(if ($Manual) { "无法启动更新检查。" } else { "" })
        if ($Manual) {
            $status.ForeColor = $colorError
        }
        Append-Log "更新检查失败：$($_.Exception.Message)"
    }
}

function Start-UpdateDownload {
    if ([string]::IsNullOrWhiteSpace($script:updateVersion) -or
        [string]::IsNullOrWhiteSpace($script:updateUrl) -or
        [string]::IsNullOrWhiteSpace($script:updateSha256)) {
        Start-UpdateCheck -Manual $true
        return
    }
    try {
        Set-UpdateIndicator `
            -State "Checking" `
            -Detail "正在下载并校验 v$($script:updateVersion)..."
        Set-UpdateBusy `
            -Busy $true `
            -Message "正在下载 Seria QA v$($script:updateVersion)..."
        Append-Log "> 下载 Seria QA v$($script:updateVersion)"
        Start-UpdateStep `
            -Mode "Download" `
            -Arguments @(
                "-UpdateUrl", $script:updateUrl,
                "-ExpectedSha256", $script:updateSha256,
                "-Version", $script:updateVersion,
                "-DownloadDirectory", $updateDownloadPath
            ) `
            -Manual $true
    }
    catch {
        Set-UpdateIndicator `
            -State "Available" `
            -Detail "新版本 v$($script:updateVersion) 下载失败；点击重试"
        Set-UpdateBusy -Busy $false -Message "无法启动更新下载。"
        $status.ForeColor = $colorError
        Append-Log "更新下载失败：$($_.Exception.Message)"
    }
}

function Complete-Operation {
    param(
        [bool]$Succeeded,
        [string]$Message
    )
    Set-Busy -Busy $false -Message $Message
    $status.ForeColor = if ($Succeeded) { $colorSuccess } else { $colorError }
    $script:activeProcess = $null
    $script:activeMode = ""
    $script:activeTarget = ""
    $script:activeInstallOutput = ""
}

function Start-Operation {
    param([ValidateSet("Install", "Verify")][string]$Mode)

    $resolved = Resolve-TargetCandidate $targetBox.Text
    if ($null -eq $resolved) {
        [Windows.Forms.MessageBox]::Show(
            "无法从所选路径找到 Seria.exe。请选择游戏根目录、Seria.exe 或 Win64 目录。",
            "游戏目录无效",
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
    }
    $targetBox.Text = $resolved
    $script:activeTarget = $resolved
    $script:activeInstallOutput = ""

    $arguments = @(
        "-ManifestPath", $ManifestPath,
        "-TargetPath", $resolved,
        "-HudVisibility", $(if ($hudVisible.Checked) { "On" } else { "Off" }),
        "-HudOpacity", [string]$opacity.Value,
        "-FullReShadeHome", $(if ($fullReShadeHome.Checked) { "On" } else { "Off" })
    )
    try {
        if ($Mode -eq "Install") {
            $arguments += "-Yes"
            Set-Busy -Busy $true -Message "正在安装并校验..."
            Append-Log "> 安装 / 更新 $resolved"
            Start-PowerShellStep `
                -ScriptPath $installerPath `
                -Arguments $arguments `
                -Mode "Install"
        }
        else {
            $arguments += "-VerifyOnly"
            Set-Busy -Busy $true -Message "正在校验安装与显示设置..."
            Append-Log "> 仅校验 $resolved"
            Start-PowerShellStep `
                -ScriptPath $installerPath `
                -Arguments $arguments `
                -Mode "Verify"
        }
        $pollTimer.Start()
    }
    catch {
        Append-Log "ERROR: $($_.Exception.Message)"
        Complete-Operation -Succeeded $false -Message "无法启动操作，请查看下方输出。"
    }
}

$pollTimer = New-Object Windows.Forms.Timer
$pollTimer.Interval = 250
$pollTimer.Add_Tick({
    if ($null -eq $script:activeProcess -or
        -not $script:activeProcess.HasExited) {
        return
    }

    $pollTimer.Stop()
    $output = $script:activeProcess.StandardOutput.ReadToEnd()
    $errorOutput = $script:activeProcess.StandardError.ReadToEnd()
    $exitCode = $script:activeProcess.ExitCode
    $script:activeProcess.Dispose()
    $script:activeProcess = $null
    Append-Log $output
    Append-Log $errorOutput

    if ($exitCode -ne 0) {
        Complete-Operation -Succeeded $false -Message "操作失败，请查看下方输出。"
        return
    }

    if ($script:activeMode -eq "Install" -and
        -not $SkipRecovery -and
        (Test-Path -LiteralPath $recoveryPath -PathType Leaf)) {
        $script:activeInstallOutput = $output
        Set-Busy -Busy $true -Message "正在更新持久恢复副本..."
        Append-Log "> 更新桌面恢复副本"
        try {
            Start-PowerShellStep `
                -ScriptPath $recoveryPath `
                -Arguments @(
                    "-ManifestPath", $ManifestPath,
                    "-TargetPath", $script:activeTarget
                ) `
                -Mode "Recovery"
            $pollTimer.Start()
        }
        catch {
            Append-Log "ERROR: $($_.Exception.Message)"
            Complete-Operation `
                -Succeeded $false `
                -Message "安装完成，但恢复副本更新失败。"
        }
        return
    }

    $completedMode = $script:activeMode
    $completedTarget = $script:activeTarget
    $message = if ($completedMode -eq "Verify") {
        "校验通过，未修改文件。"
    }
    else {
        "安装完成并通过校验。"
    }
    Complete-Operation -Succeeded $true -Message $message
    if ($completedMode -ne "Verify") {
        $form.Activate()
        [Windows.Forms.MessageBox]::Show(
            $form,
            "Seria QA Overlay 已安装并通过校验。`r`n`r`n安装位置：$completedTarget`r`n`r`n现在可以启动游戏。",
            "安装完成",
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
})

$updatePollTimer = New-Object Windows.Forms.Timer
$updatePollTimer.Interval = 250
$updatePollTimer.Add_Tick({
    if ($null -eq $script:updateProcess) {
        return
    }

    $timedOut = $false
    if (-not $script:updateProcess.HasExited) {
        $timeoutSeconds = if ($script:updateMode -eq "Download") {
            180
        }
        else {
            30
        }
        if (
            ([DateTime]::UtcNow - $script:updateStartedAt).TotalSeconds -lt
            $timeoutSeconds
        ) {
            return
        }
        $timedOut = $true
        try {
            $script:updateProcess.Kill()
            $script:updateProcess.WaitForExit()
        }
        catch {
        }
    }

    $updatePollTimer.Stop()
    $output = $script:updateProcess.StandardOutput.ReadToEnd()
    $errorOutput = $script:updateProcess.StandardError.ReadToEnd()
    $exitCode = $script:updateProcess.ExitCode
    $completedUpdateMode = $script:updateMode
    $wasManual = $script:updateManual
    $script:updateProcess.Dispose()
    $script:updateProcess = $null
    $script:updateMode = ""
    $script:updateManual = $false
    $script:updateStartedAt = [DateTime]::MinValue

    if ($timedOut -or $exitCode -ne 0) {
        $message = if ($timedOut) {
            "更新检查超时；安装功能仍可正常使用。"
        }
        elseif ([string]::IsNullOrWhiteSpace($errorOutput)) {
            "更新服务暂时不可用。"
        }
        else {
            ($errorOutput.Trim() -split "\r?\n")[-1]
        }
        Set-UpdateIndicator `
            -State "Error" `
            -Detail "$message 点击重试"
        Set-UpdateBusy `
            -Busy $false `
            -Message $(if ($wasManual) { $message } else { "" })
        if ($wasManual) {
            $status.ForeColor = $colorError
        }
        Append-Log "更新失败：$message"
        return
    }

    try {
        $result = $output.Trim() | ConvertFrom-Json
    }
    catch {
        Set-UpdateIndicator `
            -State "Error" `
            -Detail "更新服务返回异常；点击重试"
        Set-UpdateBusy `
            -Busy $false `
            -Message $(if ($wasManual) {
                "更新服务返回了无法识别的数据。"
            } else { "" })
        if ($wasManual) {
            $status.ForeColor = $colorError
        }
        Append-Log "更新数据解析失败：$($_.Exception.Message)"
        return
    }

    if ($completedUpdateMode -eq "Check") {
        if ([string]$result.status -eq "up_to_date") {
            $script:updateVersion = ""
            $script:updateUrl = ""
            $script:updateSha256 = ""
            Save-UpdateState -Result $result
            Set-UpdateIndicator `
                -State "UpToDate" `
                -Detail "已是最新版本 v$($result.version)；点击重新检查"
            Set-UpdateBusy `
                -Busy $false `
                -Message $(if ($wasManual) {
                    "当前已是最新版本 v$($result.version)。"
                } else { "" })
            if ($wasManual) {
                $status.ForeColor = $colorSuccess
                Append-Log "当前已是最新版本 v$($result.version)。"
            }
            return
        }
        if ([string]$result.status -ne "update_available") {
            Set-UpdateIndicator `
                -State "Error" `
                -Detail "更新服务返回未知状态；点击重试"
            Set-UpdateBusy `
                -Busy $false `
                -Message $(if ($wasManual) {
                    "更新服务返回了未知状态。"
                } else { "" })
            if ($wasManual) {
                $status.ForeColor = $colorError
            }
            Append-Log "更新失败：更新服务返回了未知状态。"
            return
        }

        $script:updateVersion = [string]$result.version
        $script:updateUrl = [string]$result.setup_url
        $script:updateSha256 = [string]$result.setup_sha256
        Save-UpdateState -Result $result
        Set-UpdateIndicator `
            -State "Available" `
            -Detail "发现新版本 v$($script:updateVersion)；点击下载并打开更新"
        Set-UpdateBusy `
            -Busy $false `
            -Message $(if ($wasManual) {
                "发现新版本 v$($script:updateVersion)。"
            } else { "" })
        if ($wasManual) {
            $status.ForeColor = $colorUpdateAvailable
        }
        Append-Log "发现新版本 v$($script:updateVersion)。"
        return
    }

    if ([string]$result.status -ne "downloaded" -or
        -not (Test-Path -LiteralPath ([string]$result.path) -PathType Leaf)) {
        Set-UpdateIndicator `
            -State "Available" `
            -Detail "新版本 v$($script:updateVersion) 下载失败；点击重试"
        Set-UpdateBusy -Busy $false -Message "新版 Setup 下载结果无效。"
        $status.ForeColor = $colorError
        Append-Log "更新失败：新版 Setup 下载结果无效。"
        return
    }

    try {
        $setupPath = [IO.Path]::GetFullPath([string]$result.path)
        $resolvedTarget = Resolve-TargetCandidate $targetBox.Text
        $startInfo = New-Object Diagnostics.ProcessStartInfo
        $startInfo.FileName = $setupPath
        $startInfo.WorkingDirectory = Split-Path -Parent $setupPath
        $startInfo.UseShellExecute = $true
        if ($null -ne $resolvedTarget) {
            $startInfo.Arguments = (
                "-TargetPath " + (Quote-ProcessArgument $resolvedTarget)
            )
        }
        if ($null -eq [Diagnostics.Process]::Start($startInfo)) {
            throw "新版 Setup 无法启动。"
        }
    }
    catch {
        Set-UpdateIndicator `
            -State "Available" `
            -Detail "新版本 v$($script:updateVersion) 启动失败；点击重试"
        Set-UpdateBusy -Busy $false -Message "新版 Setup 无法启动。"
        $status.ForeColor = $colorError
        Append-Log "更新失败：$($_.Exception.Message)"
        return
    }

    Set-UpdateBusy `
        -Busy $false `
        -Message "新版 Setup 已启动，请在新窗口继续安装。"
    Append-Log "已启动新版 Setup：$setupPath"
    $form.Close()
})

$pasteButton.Add_Click({
    try {
        if (-not [Windows.Forms.Clipboard]::ContainsText()) {
            [Windows.Forms.MessageBox]::Show(
                "剪贴板中没有可粘贴的文本路径。",
                "无法粘贴",
                [Windows.Forms.MessageBoxButtons]::OK,
                [Windows.Forms.MessageBoxIcon]::Information
            ) | Out-Null
            return
        }
        $clipboardPath = [Windows.Forms.Clipboard]::GetText().Trim()
        if ([string]::IsNullOrWhiteSpace($clipboardPath)) {
            return
        }
        $targetBox.Text = $clipboardPath
        $targetBox.SelectionStart = $targetBox.TextLength
        $targetBox.Focus()
        $resolved = Update-TargetFeedback
        if ($null -ne $resolved) {
            Load-InstalledPreferences $resolved
        }
    }
    catch {
        [Windows.Forms.MessageBox]::Show(
            "无法读取剪贴板，请稍后重试或直接按 Ctrl+V。`r`n`r`n$($_.Exception.Message)",
            "无法粘贴",
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
    }
})

$browseButton.Add_Click({
    $dialog = New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description = "选择游戏根目录或 Seria\Binaries\Win64"
    $dialog.ShowNewFolderButton = $false
    $current = Resolve-TargetCandidate $targetBox.Text
    if ($null -ne $current) {
        $dialog.SelectedPath = $current
    }
    if ($dialog.ShowDialog($form) -eq [Windows.Forms.DialogResult]::OK) {
        $resolved = Resolve-TargetCandidate $dialog.SelectedPath
        $targetBox.Text = if ($null -ne $resolved) {
            $resolved
        }
        else {
            $dialog.SelectedPath
        }
        $validated = Update-TargetFeedback
        if ($null -ne $validated) {
            Load-InstalledPreferences $validated
        }
    }
    $dialog.Dispose()
})

$detectButton.Add_Click({
    Set-Busy -Busy $true -Message "正在根据输入位置查找游戏目录..."
    [Windows.Forms.Application]::DoEvents()
    try {
        $detected = Find-DefaultTarget -HintPath $targetBox.Text
    }
    finally {
        Set-Busy -Busy $false
    }
    if ([string]::IsNullOrWhiteSpace($detected)) {
        [Windows.Forms.MessageBox]::Show(
            "未在输入位置、其上级目录或附近子目录找到 Seria.exe。请缩小范围后重试，或点击浏览选择游戏目录。",
            "未找到游戏",
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
    else {
        $targetBox.Text = $detected
        [void](Update-TargetFeedback)
        Load-InstalledPreferences $detected
        if ($status.Text -ne "已读取现有显示设置。") {
            $status.Text = "已找到游戏目录。"
            $status.ForeColor = $colorSuccess
        }
    }
})

$targetBox.Add_TextChanged({
    [void](Update-TargetFeedback)
})

$targetBox.Add_Leave({
    $validated = Update-TargetFeedback
    if ($null -ne $validated) {
        Load-InstalledPreferences $validated
    }
})

$installButton.Add_Click({ Start-Operation -Mode "Install" })
$verifyButton.Add_Click({ Start-Operation -Mode "Verify" })
$updateDot.Add_Click({
    if ([string]::IsNullOrWhiteSpace($script:updateVersion)) {
        Start-UpdateCheck -Manual $true
    }
    else {
        Start-UpdateDownload
    }
})
$closeButton.Add_Click({ $form.Close() })

$form.Add_FormClosing({
    param($sender, $eventArgs)
    if ($null -ne $script:activeProcess -and
        -not $script:activeProcess.HasExited) {
        [Windows.Forms.MessageBox]::Show(
            "安装或校验仍在进行，请等待操作完成。",
            "操作进行中",
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
        $eventArgs.Cancel = $true
        return
    }
    if ($null -ne $script:updateProcess -and
        -not $script:updateProcess.HasExited) {
        try {
            $script:updateProcess.Kill()
        }
        catch {
        }
    }
})

$form.Add_Shown({
    if (-not $SkipUpdateCheck -and (Test-UpdateDueToday)) {
        [void]$form.BeginInvoke([Action]{
            Start-UpdateCheck -Manual $false
        })
    }
})

$initialTarget = Update-TargetFeedback
if ($null -ne $initialTarget) {
    Load-InstalledPreferences $initialTarget
}
Restore-UpdateState

$launchWorkingArea = [Windows.Forms.Screen]::FromPoint(
    [Windows.Forms.Cursor]::Position
).WorkingArea
$expectedDpi = 96
try {
    $appliedDpi = [int](Get-ItemPropertyValue `
        -LiteralPath "HKCU:\Control Panel\Desktop\WindowMetrics" `
        -Name "AppliedDPI")
    if ($appliedDpi -ge 96 -and $appliedDpi -le 480) {
        $expectedDpi = $appliedDpi
    }
}
catch {
}
$form.LogicalWindowSize = $baseFormSize
$form.LogicalMinimumSize = $baseMinimumSize
$form.LaunchWorkingArea = $launchWorkingArea
$form.ExpectedDpi = [uint32]$expectedDpi
[void]$form.ShowDialog()
$pollTimer.Dispose()
$updatePollTimer.Dispose()
$toolTip.Dispose()
$form.Dispose()
