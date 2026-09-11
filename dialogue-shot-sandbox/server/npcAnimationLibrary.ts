import { readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

export interface NpcAnimationDirectoryResolution {
  directoryPath: string;
  matchedFileCount: number;
  candidateDirectories: string[];
}

export function normalizeNpcAnimationDirectories(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const directories = new Map<string, string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      continue;
    }
    const directory = resolve(entry.trim());
    directories.set(directory.toLowerCase(), directory);
  }
  return Array.from(directories.values());
}

export async function resolveNpcAnimationDirectory(
  npcName: string,
  roots: readonly string[],
): Promise<NpcAnimationDirectoryResolution> {
  const normalizedNpcName = npcName.trim();
  if (!/^[A-Za-z0-9_]+$/.test(normalizedNpcName)) {
    return {
      directoryPath: "",
      matchedFileCount: 0,
      candidateDirectories: [],
    };
  }
  const bodyPrefix = `a_${normalizedNpcName.toLowerCase()}_`;
  const matches = new Map<string, { path: string; count: number }>();

  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (
        !entry.isFile() ||
        extname(entry.name).toLowerCase() !== ".fbx" ||
        /_face\.fbx$/i.test(entry.name) ||
        !entry.name.toLowerCase().startsWith(bodyPrefix)
      ) {
        continue;
      }
      const key = directory.toLowerCase();
      const current = matches.get(key);
      matches.set(key, {
        path: directory,
        count: (current?.count ?? 0) + 1,
      });
    }
  };

  for (const root of normalizeNpcAnimationDirectories(roots)) {
    await visit(root);
  }

  const candidates = Array.from(matches.values()).sort(
    (left, right) =>
      right.count - left.count ||
      left.path.localeCompare(right.path, "en", { sensitivity: "base" }),
  );
  return {
    directoryPath: candidates.length === 1 ? candidates[0].path : "",
    matchedFileCount:
      candidates.length === 1 ? candidates[0].count : 0,
    candidateDirectories: candidates.map((candidate) => candidate.path),
  };
}
