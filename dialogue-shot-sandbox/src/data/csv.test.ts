import { describe, expect, it } from "vitest";
import { findDocCsvFile } from "./csv";

function fixtureFile(relativePath: string): File {
  return {
    name: relativePath.split("/").at(-1) ?? "",
    webkitRelativePath: relativePath,
  } as File;
}

describe("doc CSV file selection", () => {
  it("selects NPC表.csv from csvdir when csvspecial has the same filename", () => {
    const special = fixtureFile("doc/csvspecial/NPC表.csv");
    const configured = fixtureFile("doc/csvdir/NPC表.csv");

    expect(
      findDocCsvFile([special, configured], "NPC表.csv"),
    ).toBe(configured);
  });

  it("supports selecting the csvdir folder directly", () => {
    const configured = fixtureFile("csvdir/NPC表.csv");

    expect(findDocCsvFile([configured], "NPC表.csv")).toBe(configured);
  });
});
