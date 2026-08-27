import { describe, expect, it } from "vitest";
import { getDialogueDatabaseIndex } from "./databaseIndex";
import { demoDatabase } from "./demo";

describe("dialogue database index", () => {
  it("reuses an index for repeated queries on the same database", () => {
    const first = getDialogueDatabaseIndex(demoDatabase);
    const second = getDialogueDatabaseIndex(demoDatabase);

    expect(second).toBe(first);
    expect(first.dialogueRowsById.get("204804")?.content).toContain("钥匙");
    expect(first.dialogueRowsByPrefix.get("2048")).toHaveLength(8);
    expect(first.startsByPrefix.get("2048")).toHaveLength(1);
  });

  it("does not reuse an index after the database object is replaced", () => {
    const original = getDialogueDatabaseIndex(demoDatabase);
    const replacement = {
      ...demoDatabase,
      dialogueRows: [...demoDatabase.dialogueRows],
    };

    expect(getDialogueDatabaseIndex(replacement)).not.toBe(original);
  });
});
