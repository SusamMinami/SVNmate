using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

internal static class Program
{
    private const string PackageResourceName = "SeriaQA.Package.zip";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string extractionRoot = Path.Combine(
            Path.GetTempPath(),
            "Seria-QA-Overlay-" + Guid.NewGuid().ToString("N"));

        try
        {
            Directory.CreateDirectory(extractionRoot);
            string archivePath = Path.Combine(extractionRoot, "package.zip");
            ExtractEmbeddedArchive(archivePath);
            ZipFile.ExtractToDirectory(archivePath, extractionRoot);
            File.Delete(archivePath);

            string[] launchers = Directory.GetFiles(
                extractionRoot,
                "Install-SeriaQA-GUI.cmd",
                SearchOption.AllDirectories);
            if (launchers.Length != 1)
            {
                throw new InvalidOperationException(
                    "The embedded package does not contain exactly one GUI installer.");
            }

            string packageRoot = Path.GetDirectoryName(launchers[0]);
            string manifestPath = Path.Combine(packageRoot, "manifest.json");
            string guiScriptPath = Path.Combine(packageRoot, "Install-SeriaQA-GUI.ps1");
            if (!File.Exists(manifestPath) || !File.Exists(guiScriptPath))
            {
                throw new InvalidOperationException(
                    "The embedded package is incomplete: manifest.json or the GUI script is missing.");
            }

            string commandProcessor = Environment.GetEnvironmentVariable("ComSpec");
            if (string.IsNullOrWhiteSpace(commandProcessor))
                commandProcessor = Path.Combine(Environment.SystemDirectory, "cmd.exe");
            if (!File.Exists(commandProcessor))
            {
                throw new FileNotFoundException(
                    "The Windows command processor was not found.",
                    commandProcessor);
            }

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = commandProcessor,
                Arguments = BuildCommandArguments(launchers[0], args),
                WorkingDirectory = packageRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            startInfo.EnvironmentVariables["SERIA_QA_SETUP_HOST"] = "1";

            using (Process process = Process.Start(startInfo))
            {
                if (process == null)
                    throw new InvalidOperationException("The GUI installer could not be started.");

                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                "Seria QA Overlay setup could not start.\r\n\r\n" + exception.Message,
                "Seria QA Overlay Setup",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            TryDeleteDirectory(extractionRoot);
        }
    }

    private static void ExtractEmbeddedArchive(string destinationPath)
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        using (Stream source = assembly.GetManifestResourceStream(PackageResourceName))
        {
            if (source == null)
                throw new InvalidOperationException("The embedded QA package is missing.");

            using (FileStream destination = File.Create(destinationPath))
                source.CopyTo(destination);
        }
    }

    private static string BuildCommandArguments(string launcherPath, string[] args)
    {
        StringBuilder builder = new StringBuilder();
        builder.Append("/d /s /c \"\"");
        builder.Append(launcherPath);
        builder.Append('"');

        foreach (string argument in args)
        {
            builder.Append(' ');
            builder.Append(QuoteArgument(argument));
        }
        builder.Append('"');
        return builder.ToString();
    }

    private static string QuoteArgument(string value)
    {
        if (string.IsNullOrEmpty(value))
            return "\"\"";

        StringBuilder quoted = new StringBuilder("\"");
        int backslashCount = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashCount++;
                continue;
            }

            if (character == '"')
            {
                quoted.Append('\\', backslashCount * 2 + 1);
                quoted.Append('"');
                backslashCount = 0;
                continue;
            }

            quoted.Append('\\', backslashCount);
            backslashCount = 0;
            quoted.Append(character);
        }

        quoted.Append('\\', backslashCount * 2);
        quoted.Append('"');
        return quoted.ToString();
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Directory.Delete(path, true);
        }
        catch
        {
        }
    }
}
