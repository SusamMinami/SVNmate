import { readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";

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

function isSplitDirectory(directory: string, role: "body" | "face"): boolean {
  return new RegExp(`(?:^|[_ -])${role}$`, "i").test(basename(directory));
}

async function containsNpcFaceFbx(
  directory: string,
  facePrefix: string,
): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (await containsNpcFaceFbx(path, facePrefix)) {
        return true;
      }
    } else if (
      entry.isFile() &&
      extname(entry.name).toLowerCase() === ".fbx" &&
      entry.name.toLowerCase().startsWith(facePrefix) &&
      /_face\.fbx$/i.test(entry.name)
    ) {
      return true;
    }
  }
  return false;
}

export async function resolveNpcAnimationFamilyDirectory(
  npcName: string,
  bodyDirectory: string,
): Promise<string> {
  const directory = resolve(bodyDirectory);
  if (!isSplitDirectory(directory, "body")) {
    return directory;
  }
  const parent = dirname(directory);
  let siblings;
  try {
    siblings = await readdir(parent, { withFileTypes: true });
  } catch {
    return directory;
  }
  const facePrefix = `a_${npcName.trim().toLowerCase()}_`;
  for (const sibling of siblings) {
    const siblingPath = resolve(parent, sibling.name);
    if (
      sibling.isDirectory() &&
      isSplitDirectory(siblingPath, "face") &&
      (await containsNpcFaceFbx(siblingPath, facePrefix))
    ) {
      return parent;
    }
  }
  return directory;
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
  const matches = new Map<
    string,
    { path: string; count: number; latestModifiedTimeMs: number }
  >();

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
      const modifiedTimeMs = await stat(path).then(
        (value) => value.mtimeMs,
        () => 0,
      );
      matches.set(key, {
        path: directory,
        count: (current?.count ?? 0) + 1,
        latestModifiedTimeMs: Math.max(
          current?.latestModifiedTimeMs ?? 0,
          modifiedTimeMs,
        ),
      });
    }
  };

  for (const root of normalizeNpcAnimationDirectories(roots)) {
    await visit(root);
  }

  const familyMatches = new Map<
    string,
    { path: string; count: number; latestModifiedTimeMs: number }
  >();
  for (const match of matches.values()) {
    const path = await resolveNpcAnimationFamilyDirectory(
      normalizedNpcName,
      match.path,
    );
    const key = path.toLowerCase();
    const current = familyMatches.get(key);
    familyMatches.set(key, {
      path,
      count: (current?.count ?? 0) + match.count,
      latestModifiedTimeMs: Math.max(
        current?.latestModifiedTimeMs ?? 0,
        match.latestModifiedTimeMs,
      ),
    });
  }

  const candidates = Array.from(familyMatches.values()).sort(
    (left, right) =>
      right.count - left.count ||
      right.latestModifiedTimeMs - left.latestModifiedTimeMs ||
      left.path.localeCompare(right.path, "en", { sensitivity: "base" }),
  );
  const selected = candidates[0];
  return {
    directoryPath: selected?.path ?? "",
    matchedFileCount: selected?.count ?? 0,
    candidateDirectories: candidates.map((candidate) => candidate.path),
  };
}
