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
                "Install-SeriaQA-GUI.ps1",
                SearchOption.AllDirectories);
            if (launchers.Length != 1)
            {
                throw new InvalidOperationException(
                    "The embedded package does not contain exactly one GUI installer.");
            }

            string powershellPath = Path.Combine(
                Environment.SystemDirectory,
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe");
            if (!File.Exists(powershellPath))
            {
                throw new FileNotFoundException(
                    "Windows PowerShell was not found.",
                    powershellPath);
            }

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = powershellPath,
                Arguments = BuildPowerShellArguments(launchers[0], args),
                WorkingDirectory = Path.GetDirectoryName(launchers[0]),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

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

    private static string BuildPowerShellArguments(string scriptPath, string[] args)
    {
        StringBuilder builder = new StringBuilder();
        builder.Append("-NoLogo -NoProfile -ExecutionPolicy Bypass -Sta ");
        builder.Append("-WindowStyle Hidden -File ");
        builder.Append(QuoteArgument(scriptPath));

        foreach (string argument in args)
        {
            builder.Append(' ');
            builder.Append(QuoteArgument(argument));
        }
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
