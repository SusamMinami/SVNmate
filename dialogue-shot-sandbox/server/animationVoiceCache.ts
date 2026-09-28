import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  SequenceSnapshotSchema,
  type AnimationVoiceCache,
  type SequenceSnapshot,
} from "../src/animationVoice";
import { storyboardRuntimeRoot } from "./storyboardRuntime";

const CACHE_SCHEMA = 1;
const CatalogItemSchema = z.object({
  path: z.string(),
  name: z.string(),
});
const CacheFileSchema = z.object({
  schema: z.literal(CACHE_SCHEMA),
  roots: z.record(z.string(), z.object({
    catalog: z.array(CatalogItemSchema),
    catalogCachedAt: z.string(),
    snapshots: z.record(z.string(), z.object({
      snapshot: SequenceSnapshotSchema,
      cachedAt: z.string(),
    })),
  })),
});
type CacheFile = z.infer<typeof CacheFileSchema>;

let writeQueue = Promise.resolve();

export function animationVoiceCachePath(): string {
  return join(storyboardRuntimeRoot(), ".storyboard-data", "animation-voice-cache.json");
}

function emptyCacheFile(): CacheFile {
  return { schema: CACHE_SCHEMA, roots: {} };
}

async function readCacheFile(): Promise<CacheFile> {
  try {
    const parsed = CacheFileSchema.safeParse(JSON.parse(await readFile(animationVoiceCachePath(), "utf8")));
    return parsed.success ? parsed.data : emptyCacheFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return emptyCacheFile();
    }
    throw error;
  }
}

async function updateCacheFile(update: (cache: CacheFile) => void): Promise<void> {
  const pending = writeQueue.then(async () => {
    const cache = await readCacheFile();
    update(cache);
    const path = animationVoiceCachePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(cache), "utf8");
  });
  writeQueue = pending.catch(() => undefined);
  return pending;
}

export async function readAnimationVoiceCache(root: string): Promise<AnimationVoiceCache> {
  await writeQueue;
  const entry = (await readCacheFile()).roots[root];
  return {
    root,
    catalog: entry?.catalog ?? [],
    catalogCachedAt: entry?.catalogCachedAt ?? null,
    snapshots: entry?.snapshots ?? {},
  };
}

export async function cacheAnimationVoiceCatalog(
  root: string,
  catalog: Array<{ path: string; name: string }>,
): Promise<void> {
  await updateCacheFile((cache) => {
    const previous = cache.roots[root];
    const paths = new Set(catalog.map((asset) => asset.path));
    cache.roots[root] = {
      catalog,
      catalogCachedAt: new Date().toISOString(),
      snapshots: Object.fromEntries(
        Object.entries(previous?.snapshots ?? {}).filter(([path]) => paths.has(path)),
      ),
    };
    const roots = Object.entries(cache.roots)
      .sort((left, right) => right[1].catalogCachedAt.localeCompare(left[1].catalogCachedAt));
    cache.roots = Object.fromEntries(roots.slice(0, 8));
  });
}

export async function cacheAnimationVoiceSnapshot(
  root: string,
  snapshot: SequenceSnapshot,
): Promise<void> {
  await updateCacheFile((cache) => {
    const previous = cache.roots[root] ?? {
      catalog: [],
      catalogCachedAt: new Date().toISOString(),
      snapshots: {},
    };
    previous.snapshots[snapshot.assetPath] = {
      snapshot,
      cachedAt: new Date().toISOString(),
    };
    cache.roots[root] = previous;
  });
}
