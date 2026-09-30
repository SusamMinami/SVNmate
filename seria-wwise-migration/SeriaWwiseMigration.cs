using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Seria Wwise Migration")]
[assembly: AssemblyDescription("Seria Wwise resource migration and Unreal asset generation")]
[assembly: AssemblyCompany("Seria")]
[assembly: AssemblyProduct("Seria Wwise Migration")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace SeriaWwiseMigration
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MigrationForm(ParseProfileArgument(args)));
        }

        private static string ParseProfileArgument(string[] args)
        {
            for (int index = 0; index < args.Length; index++)
            {
                string argument = args[index];
                if (argument.StartsWith(
                        "--profile=",
                        StringComparison.OrdinalIgnoreCase))
                {
                    return argument.Substring("--profile=".Length);
                }
                if (argument.Equals(
                        "--profile",
                        StringComparison.OrdinalIgnoreCase) &&
                    index + 1 < args.Length)
                {
                    return args[index + 1];
                }
            }
            return "Trunk";
        }
    }

    internal sealed class ProfileDefinition
    {
        internal ProfileDefinition(
            string id,
            string displayName,
            string audioTarget,
            string soundDataTarget,
            params string[] managedPlatforms)
        {
            Id = id;
            DisplayName = displayName;
            AudioTarget = audioTarget;
            SoundDataTarget = soundDataTarget;
            ManagedPlatforms = new HashSet<string>(
                managedPlatforms,
                StringComparer.OrdinalIgnoreCase);
        }

        internal string Id { get; private set; }
        internal string DisplayName { get; private set; }
        internal string AudioTarget { get; private set; }
        internal string SoundDataTarget { get; private set; }
        internal HashSet<string> ManagedPlatforms { get; private set; }

        public override string ToString()
        {
            return DisplayName + "  ·  " + Id;
        }
    }

    internal enum UiState
    {
        Ready,
        Running,
        Success,
        Warning,
        Error
    }

    internal sealed class MigrationForm : Form
    {
        private static readonly string[] AllPlatforms =
        {
            "Android",
            "iOS",
            "Mac",
            "OpenHarmony",
            "PS5",
            "Windows"
        };

        private readonly string baseDirectory;
        private readonly string workflowScript;
        private readonly string sourceRoot;
        private readonly string defaultLogRoot;
        private readonly List<ProfileDefinition> profiles;

        private readonly Color colorWindow;
        private readonly Color colorSurface;
        private readonly Color colorText;
        private readonly Color colorSecondary;
        private readonly Color colorBorder;
        private readonly Color colorAccent;
        private readonly Color colorAccentHover;
        private readonly Color colorSuccess;
        private readonly Color colorWarning;
        private readonly Color colorError;
        private readonly Color colorLog;
        private readonly Color colorLogText;
        private readonly Color colorLogMuted;
        private readonly bool highContrast;

        private ComboBox profileCombo;
        private Label profileSummaryLabel;
        private TextBox sourceBox;
        private TextBox audioTargetBox;
        private TextBox soundDataBox;
        private ListView platformList;
        private ColumnHeader platformColumn;
        private ColumnHeader strategyColumn;
        private Button openSourceButton;
        private Button openAudioButton;
        private Button openSoundDataButton;
        private Button previewButton;
        private Button runButton;
        private Button stopButton;
        private Button openLogButton;
        private RichTextBox logBox;
        private ToolStripStatusLabel statusLabel;
        private ToolStripStatusLabel stageLabel;
        private ToolStripProgressBar progressBar;

        private Process currentProcess;
        private bool currentRunIsPreview;
        private bool userStopped;
        private bool closeAfterStop;
        private string lastRunLogDirectory;

        internal MigrationForm(string initialProfile)
        {
            baseDirectory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar);
            workflowScript = Path.Combine(
                baseDirectory,
                "Invoke-WwiseMigrationWorkflow.ps1");
            sourceRoot = ResolveSourceRoot();
            defaultLogRoot = Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData),
                "SeriaWwiseMigration",
                "Logs");
            lastRunLogDirectory = defaultLogRoot;
            profiles = CreateProfiles();

            highContrast = SystemInformation.HighContrast;
            if (highContrast)
            {
                colorWindow = SystemColors.Control;
                colorSurface = SystemColors.Window;
                colorText = SystemColors.WindowText;
                colorSecondary = SystemColors.WindowText;
                colorBorder = SystemColors.WindowFrame;
                colorAccent = SystemColors.Highlight;
                colorAccentHover = SystemColors.HotTrack;
                colorSuccess = SystemColors.WindowText;
                colorWarning = SystemColors.WindowText;
                colorError = SystemColors.WindowText;
                colorLog = SystemColors.Window;
                colorLogText = SystemColors.WindowText;
                colorLogMuted = SystemColors.GrayText;
            }
            else
            {
                colorWindow = ColorTranslator.FromHtml("#F3F5F7");
                colorSurface = Color.White;
                colorText = ColorTranslator.FromHtml("#202124");
                colorSecondary = ColorTranslator.FromHtml("#5F6368");
                colorBorder = ColorTranslator.FromHtml("#D7DBDF");
                colorAccent = ColorTranslator.FromHtml("#0B6B58");
                colorAccentHover = ColorTranslator.FromHtml("#085848");
                colorSuccess = ColorTranslator.FromHtml("#137333");
                colorWarning = ColorTranslator.FromHtml("#A15C00");
                colorError = ColorTranslator.FromHtml("#B3261E");
                colorLog = ColorTranslator.FromHtml("#161A1D");
                colorLogText = ColorTranslator.FromHtml("#DCE2E5");
                colorLogMuted = ColorTranslator.FromHtml("#9AA5AA");
            }

            BuildInterface();
            SelectInitialProfile(initialProfile);
            ValidateInstallation();
        }

        private static List<ProfileDefinition> CreateProfiles()
        {
            return new List<ProfileDefinition>
            {
                new ProfileDefinition(
                    "Trunk",
                    "国内主干",
                    @"C:\trunk\res\Content\Seria\WwiseAudio",
                    @"C:\trunk\res\Content\Seria\WwiseSoundData",
                    "Android", "iOS", "Mac", "OpenHarmony", "PS5", "Windows"),
                new ProfileDefinition(
                    "OB17",
                    "国内 OB17",
                    @"D:\server\17.0\res\Content\Seria\WwiseAudio",
                    @"D:\server\17.0\res\Content\Seria\WwiseSoundData",
                    "Android", "iOS", "Mac", "OpenHarmony", "PS5", "Windows"),
                new ProfileDefinition(
                    "OSOB",
                    "海外 OB",
                    @"D:\Oversea\OSOB\res\Content\Seria\WwiseAudio",
                    @"D:\Oversea\OSOB\res\Content\Seria\WwiseSoundData",
                    "Android", "iOS", "PS5", "Windows"),
                new ProfileDefinition(
                    "OStrunk",
                    "海外主干",
                    @"D:\Oversea\OStrunk\res\Content\Seria\WwiseAudio",
                    @"D:\Oversea\OStrunk\res\Content\Seria\WwiseSoundData",
                    "Android", "iOS", "PS5", "Windows")
            };
        }

        private void BuildInterface()
        {
            SuspendLayout();
            Text = "Wwise 资源迁移与生成";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(960, 780);
            MinimumSize = new Size(880, 700);
            BackColor = colorWindow;
            ForeColor = colorText;
            Font = new Font("Microsoft YaHei UI", 9.0f);
            AutoScaleMode = AutoScaleMode.Dpi;
            Icon = SystemIcons.Application;

            StatusStrip statusStrip = BuildStatusStrip();
            TableLayoutPanel rootLayout = new TableLayoutPanel();
            rootLayout.Dock = DockStyle.Fill;
            rootLayout.BackColor = colorWindow;
            rootLayout.ColumnCount = 1;
            rootLayout.RowCount = 4;
            rootLayout.Padding = new Padding(20, 16, 20, 14);
            rootLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 92));
            rootLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 318));
            rootLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
            rootLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

            rootLayout.Controls.Add(BuildHeader(), 0, 0);
            rootLayout.Controls.Add(BuildInformationPanel(), 0, 1);
            rootLayout.Controls.Add(BuildActionPanel(), 0, 2);
            rootLayout.Controls.Add(BuildLogPanel(), 0, 3);

            Controls.Add(rootLayout);
            Controls.Add(statusStrip);
            statusStrip.BringToFront();
            AcceptButton = previewButton;

            FormClosing += OnFormClosing;
            Shown += OnShown;
            ResumeLayout(true);
        }

        private StatusStrip BuildStatusStrip()
        {
            StatusStrip strip = new StatusStrip();
            strip.BackColor = colorSurface;
            strip.SizingGrip = true;

            statusLabel = new ToolStripStatusLabel();
            statusLabel.Spring = true;
            statusLabel.TextAlign = ContentAlignment.MiddleLeft;
            statusLabel.Text = "就绪";
            statusLabel.ForeColor = colorSecondary;

            stageLabel = new ToolStripStatusLabel();
            stageLabel.AutoSize = false;
            stageLabel.Width = 238;
            stageLabel.TextAlign = ContentAlignment.MiddleRight;
            stageLabel.Text = "两阶段流程";
            stageLabel.ForeColor = colorSecondary;

            progressBar = new ToolStripProgressBar();
            progressBar.Width = 190;
            progressBar.Minimum = 0;
            progressBar.Maximum = 100;
            progressBar.Style = ProgressBarStyle.Continuous;

            strip.Items.Add(statusLabel);
            strip.Items.Add(stageLabel);
            strip.Items.Add(progressBar);
            return strip;
        }

        private Control BuildHeader()
        {
            TableLayoutPanel header = new TableLayoutPanel();
            header.Dock = DockStyle.Fill;
            header.BackColor = colorSurface;
            header.Margin = new Padding(0, 0, 0, 10);
            header.Padding = new Padding(18, 10, 18, 8);
            header.ColumnCount = 2;
            header.RowCount = 1;
            header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 280));

            Panel titlePanel = new Panel();
            titlePanel.Dock = DockStyle.Fill;

            Label titleLabel = new Label();
            titleLabel.Text = "Wwise 资源迁移与生成";
            titleLabel.Font = new Font(
                "Microsoft YaHei UI",
                18.0f,
                FontStyle.Bold);
            titleLabel.ForeColor = colorText;
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(0, 3);

            profileSummaryLabel = new Label();
            profileSummaryLabel.Font = Font;
            profileSummaryLabel.ForeColor = colorAccent;
            profileSummaryLabel.AutoSize = true;
            profileSummaryLabel.Location = new Point(2, 43);

            titlePanel.Controls.Add(titleLabel);
            titlePanel.Controls.Add(profileSummaryLabel);

            TableLayoutPanel selector = new TableLayoutPanel();
            selector.Dock = DockStyle.Fill;
            selector.ColumnCount = 1;
            selector.RowCount = 2;
            selector.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
            selector.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
            selector.Padding = new Padding(12, 0, 0, 0);

            Label selectorLabel = new Label();
            selectorLabel.Text = "迁移方案";
            selectorLabel.ForeColor = colorSecondary;
            selectorLabel.Dock = DockStyle.Fill;
            selectorLabel.TextAlign = ContentAlignment.BottomLeft;

            profileCombo = new ComboBox();
            profileCombo.Dock = DockStyle.Fill;
            profileCombo.DropDownStyle = ComboBoxStyle.DropDownList;
            profileCombo.FlatStyle = FlatStyle.Standard;
            profileCombo.AccessibleName = "迁移方案";
            profileCombo.Margin = new Padding(0, 2, 0, 0);
            foreach (ProfileDefinition profile in profiles)
            {
                profileCombo.Items.Add(profile);
            }
            profileCombo.SelectedIndexChanged += delegate
            {
                if (currentProcess == null)
                {
                    UpdateSelectedProfile();
                }
            };

            selector.Controls.Add(selectorLabel, 0, 0);
            selector.Controls.Add(profileCombo, 0, 1);
            header.Controls.Add(titlePanel, 0, 0);
            header.Controls.Add(selector, 1, 0);
            return header;
        }

        private Control BuildInformationPanel()
        {
            TableLayoutPanel panel = new TableLayoutPanel();
            panel.Dock = DockStyle.Fill;
            panel.BackColor = colorSurface;
            panel.Padding = new Padding(16, 12, 16, 12);
            panel.Margin = new Padding(0, 0, 0, 10);
            panel.ColumnCount = 3;
            panel.RowCount = 4;
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 104));
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));
            panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

            sourceBox = CreatePathBox("Wwise 源目录");
            audioTargetBox = CreatePathBox("WwiseAudio 迁移目标目录");
            soundDataBox = CreatePathBox("WwiseSoundData 生成目录");

            openSourceButton = CreateSmallButton("打开源目录");
            openAudioButton = CreateSmallButton("打开目标");
            openSoundDataButton = CreateSmallButton("打开资源");
            openSourceButton.Click += delegate { OpenDirectory(sourceRoot); };
            openAudioButton.Click += delegate
            {
                OpenDirectory(SelectedProfile.AudioTarget);
            };
            openSoundDataButton.Click += delegate
            {
                OpenDirectory(SelectedProfile.SoundDataTarget);
            };

            panel.Controls.Add(CreateFieldLabel("源目录", false), 0, 0);
            panel.Controls.Add(sourceBox, 1, 0);
            panel.Controls.Add(openSourceButton, 2, 0);
            panel.Controls.Add(CreateFieldLabel("WwiseAudio", false), 0, 1);
            panel.Controls.Add(audioTargetBox, 1, 1);
            panel.Controls.Add(openAudioButton, 2, 1);
            panel.Controls.Add(CreateFieldLabel("Unreal 资源", false), 0, 2);
            panel.Controls.Add(soundDataBox, 1, 2);
            panel.Controls.Add(openSoundDataButton, 2, 2);
            panel.Controls.Add(CreateFieldLabel("平台范围", true), 0, 3);

            platformList = new ListView();
            platformList.Dock = DockStyle.Fill;
            platformList.View = View.Details;
            platformList.FullRowSelect = true;
            platformList.HeaderStyle = ColumnHeaderStyle.Nonclickable;
            platformList.BorderStyle = BorderStyle.FixedSingle;
            platformList.BackColor = colorSurface;
            platformList.ForeColor = colorText;
            platformList.MultiSelect = false;
            platformList.HideSelection = false;
            platformList.AccessibleName = "平台迁移范围";
            platformColumn = new ColumnHeader();
            platformColumn.Text = "平台";
            platformColumn.Width = 180;
            strategyColumn = new ColumnHeader();
            strategyColumn.Text = "迁移策略";
            strategyColumn.Width = 260;
            platformList.Columns.AddRange(
                new ColumnHeader[] { platformColumn, strategyColumn });
            platformList.Resize += delegate
            {
                int available = platformList.ClientSize.Width -
                    platformColumn.Width - 5;
                strategyColumn.Width = Math.Max(220, available);
            };

            panel.Controls.Add(platformList, 1, 3);
            panel.SetColumnSpan(platformList, 2);
            return panel;
        }

        private Control BuildActionPanel()
        {
            FlowLayoutPanel panel = new FlowLayoutPanel();
            panel.Dock = DockStyle.Fill;
            panel.FlowDirection = FlowDirection.RightToLeft;
            panel.WrapContents = false;
            panel.BackColor = colorWindow;
            panel.Margin = new Padding(0);

            runButton = CreateButton(
                "开始完整流程(&M)",
                colorAccent,
                Color.White,
                158);
            if (!highContrast)
            {
                runButton.FlatAppearance.MouseOverBackColor = colorAccentHover;
            }
            previewButton = CreateButton(
                "预览(&P)",
                colorSurface,
                colorAccent,
                112);
            stopButton = CreateButton(
                "停止(&S)",
                colorSurface,
                colorError,
                104);
            openLogButton = CreateButton(
                "打开日志(&L)",
                colorSurface,
                colorText,
                116);
            stopButton.Enabled = false;

            runButton.Click += delegate { StartWorkflow(false); };
            previewButton.Click += delegate { StartWorkflow(true); };
            stopButton.Click += delegate { StopPreview(); };
            openLogButton.Click += delegate
            {
                Directory.CreateDirectory(lastRunLogDirectory);
                OpenDirectory(lastRunLogDirectory);
            };

            panel.Controls.Add(runButton);
            panel.Controls.Add(previewButton);
            panel.Controls.Add(stopButton);
            panel.Controls.Add(openLogButton);

            ToolTip toolTip = new ToolTip();
            toolTip.SetToolTip(
                profileCombo,
                "选择国内主干、国内 OB17、海外 OB 或海外主干。");
            toolTip.SetToolTip(
                previewButton,
                "检查迁移与资源生成条件，不启动 Unreal、不修改 SVN。");
            toolTip.SetToolTip(
                runButton,
                "依次迁移 WwiseAudio，并无界面生成、保存 WwiseSoundData。");
            toolTip.SetToolTip(
                stopButton,
                "立即停止预览；完整执行期间不可中断。");
            toolTip.SetToolTip(
                openLogButton,
                "打开最近一次运行的日志目录。");
            return panel;
        }

        private Control BuildLogPanel()
        {
            Panel panel = new Panel();
            panel.Dock = DockStyle.Fill;
            panel.BackColor = colorSurface;
            panel.Padding = new Padding(14, 10, 14, 14);
            panel.Margin = new Padding(0);

            Label title = new Label();
            title.Text = "运行记录";
            title.Font = new Font(
                "Microsoft YaHei UI",
                10.0f,
                FontStyle.Bold);
            title.ForeColor = colorText;
            title.Dock = DockStyle.Top;
            title.Height = 28;

            logBox = new RichTextBox();
            logBox.Dock = DockStyle.Fill;
            logBox.ReadOnly = true;
            logBox.BackColor = colorLog;
            logBox.ForeColor = colorLogText;
            logBox.Font = new Font("Consolas", 9.0f);
            logBox.BorderStyle = BorderStyle.None;
            logBox.DetectUrls = false;
            logBox.WordWrap = false;
            logBox.AccessibleName = "迁移与资源生成运行记录";

            panel.Controls.Add(logBox);
            panel.Controls.Add(title);
            return panel;
        }

        private Label CreateFieldLabel(string text, bool alignTop)
        {
            Label label = new Label();
            label.Text = text;
            label.Dock = DockStyle.Fill;
            label.TextAlign = alignTop
                ? ContentAlignment.TopLeft
                : ContentAlignment.MiddleLeft;
            label.Padding = alignTop
                ? new Padding(0, 8, 0, 0)
                : new Padding(0);
            label.ForeColor = colorSecondary;
            return label;
        }

        private TextBox CreatePathBox(string accessibleName)
        {
            TextBox box = new TextBox();
            box.ReadOnly = true;
            box.BorderStyle = BorderStyle.FixedSingle;
            box.Dock = DockStyle.Fill;
            box.Margin = new Padding(0, 6, 8, 5);
            box.BackColor = colorSurface;
            box.AccessibleName = accessibleName;
            return box;
        }

        private Button CreateSmallButton(string text)
        {
            Button button = CreateButton(
                text,
                colorSurface,
                colorText,
                88);
            button.Height = 28;
            button.Margin = new Padding(0, 4, 0, 4);
            return button;
        }

        private Button CreateButton(
            string text,
            Color backColor,
            Color foreColor,
            int width)
        {
            Button button = new Button();
            button.Text = text;
            button.Width = width;
            button.Height = 36;
            button.Margin = new Padding(8, 9, 0, 9);
            button.Font = Font;
            button.Cursor = Cursors.Hand;
            if (highContrast)
            {
                button.FlatStyle = FlatStyle.System;
                button.UseVisualStyleBackColor = true;
                return button;
            }

            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.BorderColor =
                backColor == colorSurface ? colorBorder : backColor;
            button.BackColor = backColor;
            button.ForeColor = foreColor;
            button.UseVisualStyleBackColor = false;
            return button;
        }

        private ProfileDefinition SelectedProfile
        {
            get { return (ProfileDefinition)profileCombo.SelectedItem; }
        }

        private void SelectInitialProfile(string profileId)
        {
            int selectedIndex = 0;
            for (int index = 0; index < profiles.Count; index++)
            {
                if (profiles[index].Id.Equals(
                        profileId,
                        StringComparison.OrdinalIgnoreCase))
                {
                    selectedIndex = index;
                    break;
                }
            }
            profileCombo.SelectedIndex = selectedIndex;
        }

        private void UpdateSelectedProfile()
        {
            if (SelectedProfile == null)
            {
                return;
            }

            ProfileDefinition profile = SelectedProfile;
            profileSummaryLabel.Text = profile.DisplayName + "  ·  " +
                profile.Id + "  ·  两阶段流程";
            sourceBox.Text = sourceRoot;
            audioTargetBox.Text = profile.AudioTarget;
            soundDataBox.Text = profile.SoundDataTarget;

            platformList.BeginUpdate();
            try
            {
                platformList.Items.Clear();
                foreach (string platform in AllPlatforms)
                {
                    bool managed = profile.ManagedPlatforms.Contains(platform);
                    ListViewItem item = new ListViewItem(platform);
                    item.SubItems.Add(managed ? "全量同步" : "不迁移");
                    item.ForeColor = managed ? colorAccent : colorSecondary;
                    platformList.Items.Add(item);
                }
            }
            finally
            {
                platformList.EndUpdate();
            }

            if (currentProcess == null)
            {
                SetUiState(UiState.Ready, "就绪");
                stageLabel.Text = "两阶段流程";
                AppendLog(
                    "已选择 " + profile.DisplayName + "（" + profile.Id + "）。");
                if (profile.Id == "OSOB" || profile.Id == "OStrunk")
                {
                    AppendLog("Mac 和 OpenHarmony 已按分支策略排除。");
                }
            }
        }

        private void ValidateInstallation()
        {
            if (!File.Exists(workflowScript))
            {
                SetUiState(UiState.Error, "缺少迁移工作流脚本");
                stageLabel.Text = "安装不完整";
                previewButton.Enabled = false;
                runButton.Enabled = false;
                AppendLog("ERROR: 找不到 " + workflowScript);
                return;
            }
            if (!Directory.Exists(sourceRoot))
            {
                SetUiState(UiState.Error, "缺少 GeneratedSoundBanks_2022");
                stageLabel.Text = "源目录不可用";
                previewButton.Enabled = false;
                runButton.Enabled = false;
                AppendLog("ERROR: 找不到 " + sourceRoot);
                return;
            }

            AppendLog(
                "完整流程：先全量迁移 WwiseAudio，再自动生成并保存 WwiseSoundData。");
            AppendLog("预览不会启动 Unreal，也不会修改文件或 SVN 状态。");
        }

        private void StartWorkflow(bool preview)
        {
            if (currentProcess != null && !currentProcess.HasExited)
            {
                return;
            }
            if (!File.Exists(workflowScript))
            {
                MessageBox.Show(
                    this,
                    "找不到迁移工作流：\r\n" + workflowScript,
                    "无法启动",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }

            if (!preview && CountRunningEditors() > 0)
            {
                DialogResult result = MessageBox.Show(
                    this,
                    "检测到 UE4Editor 正在运行。\r\n\r\n" +
                    "完整流程会自动关闭 UE4Editor，然后迁移 WwiseAudio，" +
                    "并无界面生成及保存 WwiseSoundData。\r\n\r\n" +
                    "未保存的编辑器内容可能丢失，请先确认工作已经保存。",
                    "确认开始完整流程",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button2);
                if (result != DialogResult.Yes)
                {
                    SetUiState(UiState.Ready, "已取消执行");
                    return;
                }
            }

            ProfileDefinition profile = SelectedProfile;
            string command =
                "[Console]::OutputEncoding = " +
                "New-Object System.Text.UTF8Encoding($false)\r\n" +
                "$ProgressPreference = 'SilentlyContinue'\r\n" +
                "& " + ToPowerShellLiteral(workflowScript) +
                " -Profile " + ToPowerShellLiteral(profile.Id) +
                " -SourceRoot " + ToPowerShellLiteral(sourceRoot) +
                (preview ? " -Preview" : string.Empty) + "\r\n" +
                "exit $LASTEXITCODE\r\n";
            string encodedCommand = Convert.ToBase64String(
                Encoding.Unicode.GetBytes(command));

            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe");
            startInfo.Arguments =
                "-NoProfile -ExecutionPolicy Bypass -EncodedCommand " +
                encodedCommand;
            startInfo.WorkingDirectory = baseDirectory;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            startInfo.RedirectStandardOutput = true;
            startInfo.RedirectStandardError = true;
            startInfo.StandardOutputEncoding = new UTF8Encoding(false);
            startInfo.StandardErrorEncoding = new UTF8Encoding(false);

            logBox.Clear();
            lastRunLogDirectory = defaultLogRoot;
            currentRunIsPreview = preview;
            userStopped = false;
            closeAfterStop = false;

            Process process = new Process();
            process.StartInfo = startInfo;
            process.OutputDataReceived += OnProcessOutput;
            process.ErrorDataReceived += OnProcessOutput;

            try
            {
                if (!process.Start())
                {
                    throw new InvalidOperationException("进程启动返回失败。");
                }
                currentProcess = process;
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                SetControlsRunning(true);
                progressBar.Value = 2;
                stageLabel.Text = preview
                    ? "预览两阶段流程"
                    : "准备两阶段流程";
                SetUiState(
                    UiState.Running,
                    preview
                        ? "正在检查迁移与资源生成计划..."
                        : "正在执行完整流程...");
                AppendLog(
                    preview
                        ? "正在启动只读预览..."
                        : "正在启动迁移与资源生成流程...");

                ThreadPool.QueueUserWorkItem(delegate
                {
                    process.WaitForExit();
                    int exitCode = process.ExitCode;
                    BeginInvoke(
                        new Action<Process, int>(CompleteWorkflow),
                        process,
                        exitCode);
                });
            }
            catch (Exception exception)
            {
                process.Dispose();
                currentProcess = null;
                SetControlsRunning(false);
                stageLabel.Text = "启动失败";
                SetUiState(UiState.Error, "无法启动迁移工作流");
                AppendLog("ERROR: " + exception.Message);
            }
        }

        private void OnProcessOutput(object sender, DataReceivedEventArgs args)
        {
            if (args.Data == null || IsDisposed)
            {
                return;
            }
            try
            {
                BeginInvoke(new Action<string>(AppendLog), args.Data);
            }
            catch (InvalidOperationException)
            {
            }
        }

        private void CompleteWorkflow(Process process, int exitCode)
        {
            if (currentProcess != process)
            {
                process.Dispose();
                return;
            }

            currentProcess = null;
            process.Dispose();
            SetControlsRunning(false);

            if (userStopped)
            {
                stageLabel.Text = "预览已停止";
                SetUiState(UiState.Warning, "预览已停止，未修改目标目录");
            }
            else if (exitCode == 0)
            {
                stageLabel.Text = currentRunIsPreview
                    ? "两阶段预览完成"
                    : "阶段 2/2 · 已完成";
                SetUiState(
                    UiState.Success,
                    currentRunIsPreview
                        ? "预览完成，未启动 Unreal、未修改 SVN"
                        : "迁移与资源生成均已完成");
            }
            else
            {
                ApplyExitCode(exitCode);
            }

            if (closeAfterStop)
            {
                closeAfterStop = false;
                Close();
            }
        }

        private void ApplyExitCode(int exitCode)
        {
            if (exitCode == 2)
            {
                stageLabel.Text = "配置校验失败";
                SetUiState(
                    UiState.Error,
                    "项目、引擎或 Wwise 路径配置不匹配");
            }
            else if (exitCode == 3)
            {
                stageLabel.Text = "运行条件不满足";
                SetUiState(
                    UiState.Warning,
                    "已有任务运行，或 Unreal 编辑器仍未关闭");
            }
            else if (exitCode == 4)
            {
                stageLabel.Text = "执行已停止";
                SetUiState(
                    UiState.Warning,
                    "已停止：请先处理 SVN 更新或冲突");
            }
            else if (exitCode == 5)
            {
                stageLabel.Text = "资源生成失败";
                SetUiState(
                    UiState.Error,
                    "Unreal 无界面资源生成失败，请查看日志");
            }
            else if (exitCode == 6)
            {
                stageLabel.Text = "需要人工处理";
                SetUiState(
                    UiState.Warning,
                    "已生成资源，但存在 UE4 需人工处理的残留项");
            }
            else if (exitCode == 7)
            {
                stageLabel.Text = "SVN 对账失败";
                SetUiState(
                    UiState.Error,
                    "资源已生成，但 WwiseSoundData SVN 对账失败");
            }
            else
            {
                stageLabel.Text = "执行失败";
                SetUiState(
                    UiState.Error,
                    "任务失败，退出码 " + exitCode);
            }
        }

        private void StopPreview()
        {
            Process process = currentProcess;
            if (process == null || process.HasExited || !currentRunIsPreview)
            {
                return;
            }

            userStopped = true;
            stopButton.Enabled = false;
            SetUiState(UiState.Warning, "正在停止预览...");
            try
            {
                ProcessStartInfo startInfo = new ProcessStartInfo();
                startInfo.FileName = "taskkill.exe";
                startInfo.Arguments =
                    "/PID " + process.Id + " /T /F";
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                using (Process killer = Process.Start(startInfo))
                {
                    if (killer != null)
                    {
                        killer.WaitForExit();
                    }
                }
            }
            catch (Exception exception)
            {
                AppendLog("ERROR: 无法停止预览：" + exception.Message);
            }
        }

        private void SetControlsRunning(bool running)
        {
            profileCombo.Enabled = !running;
            previewButton.Enabled = !running;
            runButton.Enabled = !running;
            stopButton.Enabled = running && currentRunIsPreview;
            openSourceButton.Enabled = !running;
            openAudioButton.Enabled = !running;
            openSoundDataButton.Enabled = !running;
        }

        private void SetUiState(UiState state, string text)
        {
            statusLabel.Text = text;
            if (state == UiState.Ready)
            {
                statusLabel.ForeColor = colorSecondary;
                progressBar.Value = 0;
            }
            else if (state == UiState.Running)
            {
                statusLabel.ForeColor = colorAccent;
            }
            else if (state == UiState.Success)
            {
                statusLabel.ForeColor = colorSuccess;
                progressBar.Value = 100;
            }
            else if (state == UiState.Warning)
            {
                statusLabel.ForeColor = colorWarning;
            }
            else
            {
                statusLabel.ForeColor = colorError;
            }
        }

        private void AppendLog(string line)
        {
            if (line == null)
            {
                return;
            }
            if (line.StartsWith("#< CLIXML", StringComparison.Ordinal) ||
                line.StartsWith(
                    "<Objs Version=",
                    StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            Color lineColor = colorLogText;
            Match workflowMatch = Regex.Match(
                line,
                @"^\[WORKFLOW ([12])/2\]");
            Match migrationMatch = Regex.Match(
                line,
                @"^\[(\d)/8\]");
            Match assetMatch = Regex.Match(
                line,
                @"^\[ASSET ([1-6])/6\]");

            if (!highContrast && workflowMatch.Success)
            {
                lineColor = ColorTranslator.FromHtml("#74D8C2");
                int stage = int.Parse(workflowMatch.Groups[1].Value);
                if (stage == 1)
                {
                    stageLabel.Text = "阶段 1/2 · 迁移 WwiseAudio";
                    progressBar.Value = 4;
                }
                else
                {
                    stageLabel.Text = "阶段 2/2 · 生成 WwiseSoundData";
                    progressBar.Value = 70;
                }
            }
            else if (!highContrast && migrationMatch.Success)
            {
                lineColor = ColorTranslator.FromHtml("#74D8C2");
                int stage = int.Parse(migrationMatch.Groups[1].Value);
                progressBar.Value = Math.Min(
                    68,
                    Math.Max(5, 5 + (int)((stage / 8.0) * 60)));
            }
            else if (!highContrast && assetMatch.Success)
            {
                lineColor = ColorTranslator.FromHtml("#74D8C2");
                int stage = int.Parse(assetMatch.Groups[1].Value);
                progressBar.Value = Math.Min(
                    96,
                    Math.Max(70, 70 + (int)((stage / 6.0) * 26)));
            }
            else if (!highContrast && Regex.IsMatch(
                line,
                @"^ERROR:|Migration failed"))
            {
                lineColor = ColorTranslator.FromHtml("#FF9B92");
            }
            else if (!highContrast && Regex.IsMatch(
                line,
                @"Complete|completed|zero diff|usable",
                RegexOptions.IgnoreCase))
            {
                lineColor = ColorTranslator.FromHtml("#82D99A");
            }
            else if (!highContrast && Regex.IsMatch(
                line,
                @"conflict|Remote change|excluded|UPDATE|DELETE",
                RegexOptions.IgnoreCase))
            {
                lineColor = ColorTranslator.FromHtml("#F1BF78");
            }
            else if (line.Length == 0)
            {
                lineColor = colorLogMuted;
            }

            if (logBox.TextLength > 2000000)
            {
                logBox.Select(0, Math.Min(500000, logBox.TextLength));
                logBox.SelectedText = string.Empty;
            }
            logBox.SelectionStart = logBox.TextLength;
            logBox.SelectionLength = 0;
            logBox.SelectionColor = lineColor;
            logBox.AppendText(line + Environment.NewLine);
            logBox.SelectionColor = colorLogText;
            logBox.ScrollToCaret();

            Match logMatch = Regex.Match(
                line,
                @"^(?:Logs|Workflow logs):\s+(.+)$");
            if (logMatch.Success)
            {
                lastRunLogDirectory = logMatch.Groups[1].Value.Trim();
            }
        }

        private void OnShown(object sender, EventArgs args)
        {
            profileCombo.Focus();
        }

        private void OnFormClosing(
            object sender,
            FormClosingEventArgs args)
        {
            Process process = currentProcess;
            if (process == null || process.HasExited)
            {
                return;
            }

            args.Cancel = true;
            if (currentRunIsPreview)
            {
                closeAfterStop = true;
                StopPreview();
            }
            else
            {
                stageLabel.Text = "完整流程执行中";
                SetUiState(
                    UiState.Warning,
                    "完整流程正在执行，完成后才能关闭窗口");
                AppendLog(
                    "流程进行中，已阻止关闭窗口，避免留下未完成的 SVN 状态。");
            }
        }

        private static int CountRunningEditors()
        {
            int count = 0;
            string[] names =
            {
                "UE4Editor",
                "UE4Editor-Cmd",
                "UnrealEditor",
                "UnrealEditor-Cmd"
            };
            foreach (string name in names)
            {
                Process[] processes = Process.GetProcessesByName(name);
                count += processes.Length;
                foreach (Process process in processes)
                {
                    process.Dispose();
                }
            }
            return count;
        }

        private void OpenDirectory(string path)
        {
            if (!Directory.Exists(path))
            {
                MessageBox.Show(
                    this,
                    "目录不存在：\r\n" + path,
                    "无法打开目录",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = "explorer.exe";
            startInfo.Arguments = QuoteNativeArgument(path);
            startInfo.UseShellExecute = false;
            Process.Start(startInfo);
        }

        private static string ToPowerShellLiteral(string value)
        {
            return "'" + value.Replace("'", "''") + "'";
        }

        private static string ResolveSourceRoot()
        {
            string explicitSource = Environment.GetEnvironmentVariable(
                "SERIA_WWISE_SOURCE_ROOT");
            if (!String.IsNullOrWhiteSpace(explicitSource))
            {
                return Path.GetFullPath(explicitSource.Trim());
            }
            string projectRoot = Environment.GetEnvironmentVariable(
                "SERIA_WWISE_PROJECT_ROOT");
            if (String.IsNullOrWhiteSpace(projectRoot))
            {
                projectRoot = @"C:\Sound\SeriaWwiseProject";
            }
            return Path.Combine(
                Path.GetFullPath(projectRoot.Trim()),
                "GeneratedSoundBanks_2022");
        }

        private static string QuoteNativeArgument(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }
    }
}
