import { describe, expect, it } from "vitest";
import { classifyLarkScopes } from "./larkBridge";

describe("classifyLarkScopes", () => {
  it("separates Mira and Base authorization requirements", () => {
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
      ].join(" "),
    );

    expect(result).toEqual({
      missingScopes: [],
      miraMissingScopes: [],
      baseMissingScopes: [],
    });
  });

  it("reports Base permissions when only Mira is authorized", () => {
    const result = classifyLarkScopes(
      "search:bot im:message.send_as_user",
    );

    expect(result.miraMissingScopes).toEqual([]);
    expect(result.baseMissingScopes).toContain("base:record:create");
    expect(result.missingScopes).toEqual(result.baseMissingScopes);
  });
});
