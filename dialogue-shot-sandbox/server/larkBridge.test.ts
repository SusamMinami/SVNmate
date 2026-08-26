import { describe, expect, it } from "vitest";
import { classifyLarkScopes } from "./larkBridge";

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
