import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MAX_SOUND_EFFECT_CATALOG_ENTRIES,
  SOUND_EFFECT_CATALOG_SOURCE,
  SOUND_EFFECT_CATEGORIES,
  bundledSoundEffectCatalog,
  parseSoundEffectCatalogMarkdown,
  type SoundEffectCatalogEntry,
  type SoundEffectCatalogSnapshot,
} from "../src/data/soundEffectCatalog";

interface SoundEffectDocument {
  content: string;
  revisionId: number;
}

const catalogFileLocks = new Map<string, Promise<void>>();

async function withCatalogFileLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = catalogFileLocks.get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  catalogFileLocks.set(path, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (catalogFileLocks.get(path) === queued) {
      catalogFileLocks.delete(path);
    }
  }
}

function catalogPath(): string {
  return join(
    process.env.STORYBOARD_PROJECT_ROOT || process.cwd(),
    ".storyboard-data",
    "sound-effect-catalog.json",
  );
}

function validEntry(value: unknown): value is SoundEffectCatalogEntry {
  const entry = value as Partial<SoundEffectCatalogEntry>;
  return (
    Boolean(entry) &&
    typeof entry.assetName === "string" &&
    entry.assetName.length > 0 &&
    typeof entry.description === "string" &&
    entry.description.length > 0 &&
    SOUND_EFFECT_CATEGORIES.includes(
      entry.category as SoundEffectCatalogEntry["category"],
    )
  );
}

function parseSnapshot(value: unknown): SoundEffectCatalogSnapshot {
  const snapshot = value as Partial<SoundEffectCatalogSnapshot>;
  if (
    !Array.isArray(snapshot.entries) ||
    snapshot.entries.length === 0 ||
    !snapshot.entries.every(validEntry) ||
    typeof snapshot.revisionId !== "number" ||
    typeof snapshot.syncedAt !== "string"
  ) {
    throw new Error("本地音效目录格式无效");
  }
  return {
    entries: snapshot.entries.map((entry) => ({ ...entry })),
    sourceUrl:
      typeof snapshot.sourceUrl === "string"
        ? snapshot.sourceUrl
        : SOUND_EFFECT_CATALOG_SOURCE,
    libraryUrl:
      typeof snapshot.libraryUrl === "string"
        ? snapshot.libraryUrl
        : bundledSoundEffectCatalog().libraryUrl,
    revisionId: snapshot.revisionId,
    syncedAt: snapshot.syncedAt,
    source: "lark",
  };
}

export async function loadSoundEffectCatalog(
  path = catalogPath(),
): Promise<SoundEffectCatalogSnapshot> {
  return withCatalogFileLock(path, async () => {
    try {
      return parseSnapshot(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[sound-effect-catalog] local cache ignored", error);
      }
      return bundledSoundEffectCatalog();
    }
  });
}

export async function syncSoundEffectCatalog(
  fetchDocument: () => Promise<SoundEffectDocument>,
  path = catalogPath(),
): Promise<SoundEffectCatalogSnapshot> {
  const document = await fetchDocument();
  const entries = parseSoundEffectCatalogMarkdown(document.content);
  if (entries.length === 0) {
    throw new Error("飞书文档中没有解析到可用音效资产");
  }
  if (entries.length > MAX_SOUND_EFFECT_CATALOG_ENTRIES) {
    throw new Error(
      `飞书音效目录包含 ${entries.length} 项，超过当前支持的 ${MAX_SOUND_EFFECT_CATALOG_ENTRIES} 项上限`,
    );
  }
  const snapshot: SoundEffectCatalogSnapshot = {
    entries,
    sourceUrl: SOUND_EFFECT_CATALOG_SOURCE,
    libraryUrl: bundledSoundEffectCatalog().libraryUrl,
    revisionId: document.revisionId,
    syncedAt: new Date().toISOString(),
    source: "lark",
  };
  await withCatalogFileLock(path, async () => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), "utf8");
      await rm(path, { force: true });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  });
  return snapshot;
}
