import { describe, expect, it } from "vitest";
import {
  powerShellFileArguments,
  readablePowerShellError,
} from "./excelRegistration";

describe("Excel PowerShell errors", () => {
  it("turns Excel busy CLIXML into an actionable message", () => {
    const clixml =
      '#< CLIXML <Objs><S S="Error">异常来自 HRESULT:0x800AC472_x000D__x000A_</S></Objs>';

    expect(readablePowerShellError(clixml)).toBe(
      "Excel 当前正忙或处于单元格编辑状态。请在 Excel 中按 Enter 或 Esc 退出编辑，关闭弹窗后重试",
    );
  });

  it("extracts and decodes ordinary CLIXML error text", () => {
    const clixml =
      '#< CLIXML <Objs><S S="Error">目标物 500001 不存在_x000D__x000A_请刷新</S></Objs>';

    expect(readablePowerShellError(clixml)).toBe(
      "目标物 500001 不存在\r\n请刷新",
    );
  });

  it("runs scripts from a file instead of the Windows command line", () => {
    const scriptPath =
      "C:\\Users\\Admin\\AppData\\Local\\Temp\\shot-sandbox-excel-1\\operation.ps1";
    const arguments_ = powerShellFileArguments(scriptPath);

    expect(arguments_).toContain("-File");
    expect(arguments_).toContain(scriptPath);
    expect(arguments_).not.toContain("-EncodedCommand");
    expect(arguments_.join(" ").length).toBeLessThan(1_000);
  });
});
