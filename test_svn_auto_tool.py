import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from svn_auto_tool import SvnAutoTool


@unittest.skipUnless(os.name == "nt", "Windows cmd.exe behavior only")
class WindowsBatchCommandTests(unittest.TestCase):
    def test_quoted_batch_command_runs_after_console_wrapping(self) -> None:
        with tempfile.TemporaryDirectory(prefix="SVNmate test ") as temp_dir:
            bat_path = Path(temp_dir) / "Update test.bat"
            bat_path.write_bytes(b"@echo off\r\necho batch-ok\r\nexit /b 0\r\n")
            command = SvnAutoTool._bat_command(bat_path)
            command = SvnAutoTool._add_console_title(command, "SVNmate Test")

            launch_command = SvnAutoTool._windows_cmd_command_line(command)

            self.assertIsInstance(launch_command, str)
            self.assertIn(f'call "{bat_path}"', launch_command)
            self.assertNotIn(f'\\"{bat_path}\\"', launch_command)

            process = subprocess.run(
                launch_command,
                cwd=temp_dir,
                capture_output=True,
                text=True,
                shell=False,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )

            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertIn("batch-ok", process.stdout)


if __name__ == "__main__":
    unittest.main()
