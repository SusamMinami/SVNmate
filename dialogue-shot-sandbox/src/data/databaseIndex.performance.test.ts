import { afterEach, describe, expect, it, vi } from "vitest";
import { getDialogueDatabaseIndex } from "./databaseIndex";
import { demoDatabase } from "./demo";

afterEach(() => vi.restoreAllMocks());

describe("lazy dialogue search index", () => {
  it("does not normalize dialogue text during exact-ID lookup", () => {
    const normalize = vi.spyOn(String.prototype, "toLocaleLowerCase");
    const database = { ...demoDatabase };
    const index = getDialogueDatabaseIndex(database);
    expect(index.dialogueRowsById.get(database.dialogueRows[0].id)).toBe(database.dialogueRows[0]);
    expect(normalize).not.toHaveBeenCalled();
    expect(getDialogueDatabaseIndex(database)).toBe(index);
  });

  it("builds once on first text search and preserves filtering and row identity", () => {
    const database = { ...demoDatabase };
    const normalize = vi.spyOn(String.prototype, "toLocaleLowerCase");
    const index = getDialogueDatabaseIndex(database);
    const rows = index.searchableDialogueRows;
    const expected = database.dialogueRows.filter((row) =>
      row.state !== 4 && row.content && /^\d{4,}$/.test(row.id));
    expect(rows.map((entry) => entry.row)).toEqual(expected);
    expect(normalize).toHaveBeenCalledTimes(expected.length);
    expect(index.searchableDialogueRows).toBe(rows);
    expect(normalize).toHaveBeenCalledTimes(expected.length);
    expect(rows[0].normalizedContent).toBe(
      "钥匙失踪后封锁区的巡逻路线已经改变",
    );
  });

  it("does not reuse a search index across replacement databases", () => {
    const first = getDialogueDatabaseIndex({ ...demoDatabase });
    const second = getDialogueDatabaseIndex({ ...demoDatabase, dialogueRows: [] });
    expect(first.searchableDialogueRows.length).toBeGreaterThan(0);
    expect(second.searchableDialogueRows).toEqual([]);
    expect(first.searchableDialogueRows).not.toBe(second.searchableDialogueRows);
  });
});
