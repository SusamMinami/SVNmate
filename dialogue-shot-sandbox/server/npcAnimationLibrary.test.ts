import {
  mkdtemp,
  mkdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeNpcAnimationDirectories,
  resolveNpcAnimationDirectory,
} from "./npcAnimationLibrary";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "npc-animation-library-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("NPC animation library", () => {
  it("normalizes and deduplicates configured roots", () => {
    expect(
      normalizeNpcAnimationDirectories([
        " D:/Animations ",
        "d:/animations",
        "",
        null,
      ]),
    ).toHaveLength(1);
  });

  it("finds the unique directory containing matching Body FBX files", async () => {
    const root = await temporaryDirectory();
    const npcDirectory = join(root, "NPC", "N28", "Animation");
    const faceDirectory = join(npcDirectory, "Face");
    await mkdir(faceDirectory, { recursive: true });
    await writeFile(join(npcDirectory, "A_N28_Idle.fbx"), "body");
    await writeFile(join(npcDirectory, "A_N28_Wave.fbx"), "body");
    await writeFile(join(faceDirectory, "A_N28_Wave_Face.fbx"), "face");

    await expect(
      resolveNpcAnimationDirectory("N28", [root]),
    ).resolves.toEqual({
      directoryPath: npcDirectory,
      matchedFileCount: 2,
      candidateDirectories: [npcDirectory],
    });
  });

  it("selects the most complete directory when multiple directories match", async () => {
    const root = await temporaryDirectory();
    const current = join(root, "Current", "N28");
    const legacy = join(root, "Legacy", "N28");
    await mkdir(current, { recursive: true });
    await mkdir(legacy, { recursive: true });
    await writeFile(join(current, "A_N28_Idle.fbx"), "body");
    await writeFile(join(current, "A_N28_Talk.fbx"), "body");
    await writeFile(join(legacy, "A_N28_Wave.fbx"), "body");

    await expect(
      resolveNpcAnimationDirectory("N28", [root]),
    ).resolves.toEqual({
      directoryPath: current,
      matchedFileCount: 2,
      candidateDirectories: [current, legacy],
    });
  });

  it("uses the newest matching source when candidate counts are tied", async () => {
    const root = await temporaryDirectory();
    const current = join(root, "Current", "N28");
    const legacy = join(root, "Legacy", "N28");
    const currentFile = join(current, "A_N28_Idle.fbx");
    const legacyFile = join(legacy, "A_N28_Idle.fbx");
    await mkdir(current, { recursive: true });
    await mkdir(legacy, { recursive: true });
    await writeFile(currentFile, "current");
    await writeFile(legacyFile, "legacy");
    await utimes(currentFile, new Date(2_000), new Date(2_000));
    await utimes(legacyFile, new Date(1_000), new Date(1_000));

    await expect(
      resolveNpcAnimationDirectory("N28", [root]),
    ).resolves.toEqual({
      directoryPath: current,
      matchedFileCount: 1,
      candidateDirectories: [current, legacy],
    });
  });
});
