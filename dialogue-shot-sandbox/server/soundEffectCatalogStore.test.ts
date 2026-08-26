import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadSoundEffectCatalog,
  syncSoundEffectCatalog,
} from "./soundEffectCatalogStore";

let temporaryRoot = "";

afterEach(async () => {
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = "";
  }
});

describe("sound effect catalog store", () => {
  it("persists a manually synced Lark document snapshot", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "sound-catalog-"));
    const path = join(temporaryRoot, "catalog.json");

    const synced = await syncSoundEffectCatalog(
      async () => ({
        revisionId: 52,
        content: `
## **特殊音效**
| **编号** | **资产描述** | **资产名** |
|-|-|-|
| 001 | 系统报警。 | A_SFX_Dialog_900001 |
`,
      }),
      path,
    );
    const loaded = await loadSoundEffectCatalog(path);

    expect(synced).toMatchObject({
      revisionId: 52,
      source: "lark",
    });
    expect(loaded).toEqual(synced);
    expect(loaded.entries).toEqual([
      {
        category: "special",
        assetName: "A_SFX_Dialog_900001",
        description: "系统报警。",
      },
    ]);
  });

  it("uses the bundled catalog when no sync file exists", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "sound-catalog-"));

    const snapshot = await loadSoundEffectCatalog(
      join(temporaryRoot, "missing.json"),
    );

    expect(snapshot.source).toBe("bundled");
    expect(snapshot.entries.length).toBeGreaterThan(90);
  });

  it("keeps concurrent sync writes isolated", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "sound-catalog-"));
    const path = join(temporaryRoot, "catalog.json");
    const document = (revisionId: number) => async () => ({
      revisionId,
      content: `
## **特殊音效**
| **编号** | **资产描述** | **资产名** |
|-|-|-|
| 001 | 系统报警。 | A_SFX_Dialog_900001 |
`,
    });

    const results = await Promise.all([
      syncSoundEffectCatalog(document(52), path),
      syncSoundEffectCatalog(document(53), path),
    ]);
    const loaded = await loadSoundEffectCatalog(path);

    expect(results.map((result) => result.revisionId).sort()).toEqual([52, 53]);
    expect([52, 53]).toContain(loaded.revisionId);
  });

  it("rejects a document larger than the director contract allows", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "sound-catalog-"));
    const path = join(temporaryRoot, "catalog.json");
    const rows = Array.from(
      { length: 129 },
      (_, index) =>
        `| ${index + 1} | 音效 ${index + 1}。 | A_SFX_Dialog_${900000 + index} |`,
    );

    await expect(
      syncSoundEffectCatalog(
        async () => ({
          revisionId: 54,
          content: [
            "## **特殊音效**",
            "| **编号** | **资产描述** | **资产名** |",
            "|-|-|-|",
            ...rows,
          ].join("\n"),
        }),
        path,
      ),
    ).rejects.toThrow("超过当前支持的 128 项上限");
  });
});
