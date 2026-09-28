import { describe, expect, it } from "vitest";
import { classifyLarkScopes, larkCliInvocation } from "./larkBridge";

describe("classifyLarkScopes", () => {
  it("separates Mira, Base and Docs authorization requirements", () => {
    const result = classifyLarkScopes(
      [
        "search:bot",
        "im:message.send_as_user",
        "base:app:read",
        "base:table:read",
        "base:field:read",
        "base:record:read",
        "base:record:create",
        "base:record:update",
        "docs:document.content:read",
        "docx:document:readonly",
      ].join(" "),
    );

    expect(result).toEqual({
      missingScopes: [],
      miraMissingScopes: [],
      baseMissingScopes: [],
      docsMissingScopes: [],
    });
  });

  it("reports Base permissions when only Mira is authorized", () => {
    const result = classifyLarkScopes(
      "search:bot im:message.send_as_user",
    );

    expect(result.miraMissingScopes).toEqual([]);
    expect(result.baseMissingScopes).toContain("base:record:create");
    expect(result.docsMissingScopes).toContain(
      "docs:document.content:read",
    );
    expect(result.missingScopes).toEqual([
      ...result.baseMissingScopes,
      ...result.docsMissingScopes,
    ]);
  });
});

describe("larkCliInvocation", () => {
  it("runs the native Windows binary directly so windowsHide reaches it", () => {
    const invocation = larkCliInvocation(
      ["auth", "status", "--json", "--verify"],
      {
        platform: "win32",
        appData: "C:\\Users\\Test\\AppData\\Roaming",
        execPath: "C:\\Program Files\\Shot Sandbox\\镜头沙盘.exe",
      },
    );

    expect(invocation).toEqual({
      file: "C:\\Users\\Test\\AppData\\Roaming\\npm\\node_modules\\@larksuite\\cli\\bin\\lark-cli.exe",
      args: ["auth", "status", "--json", "--verify"],
    });
  });

  it("keeps the JavaScript launcher on non-Windows platforms", () => {
    const invocation = larkCliInvocation(["auth", "status"], {
      platform: "linux",
      appData: "/home/test/.config",
      execPath: "/usr/bin/node",
    });

    expect(invocation).toEqual({
      file: "/usr/bin/node",
      args: [
        "/home/test/.config/npm/node_modules/@larksuite/cli/scripts/run.js",
        "auth",
        "status",
      ],
    });
  });
});
