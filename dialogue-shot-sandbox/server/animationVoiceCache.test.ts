import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SequenceSnapshot } from "../src/animationVoice";
import {
  cacheAnimationVoiceCatalog,
  cacheAnimationVoiceSnapshot,
  readAnimationVoiceCache,
} from "./animationVoiceCache";

const originalRoot = process.env.STORYBOARD_PROJECT_ROOT;
let runtimeRoot = "";

function snapshot(assetPath: string): SequenceSnapshot {
  return {
    assetPath,
    name: assetPath.split("/").at(-1)!.split(".")[0],
    revision: "revision",
    stateRevision: "state",
    dirty: false,
    displayRate: 30,
    tickResolution: 24000,
    start: 0,
    end: 10,
    director: { path: "", parent: "" },
    tracks: [],
    events: [],
    marks: [],
    warnings: [],
    voices: [],
    skipBlockedReasons: [],
  };
}

beforeEach(async () => {
  runtimeRoot = await mkdtemp(join(tmpdir(), "animation-voice-cache-"));
  process.env.STORYBOARD_PROJECT_ROOT = runtimeRoot;
});

afterEach(async () => {
  if (originalRoot === undefined) delete process.env.STORYBOARD_PROJECT_ROOT;
  else process.env.STORYBOARD_PROJECT_ROOT = originalRoot;
  await rm(runtimeRoot, { recursive: true, force: true });
});

describe("animation voice cache", () => {
  it("persists scanned snapshots and prunes assets removed from a refreshed catalog", async () => {
    const root = "/Game/Seria/Sequences";
    const first = { path: "/Game/Seria/Sequences/LS_First.LS_First", name: "LS_First" };
    const second = { path: "/Game/Seria/Sequences/LS_Second.LS_Second", name: "LS_Second" };

    await cacheAnimationVoiceCatalog(root, [first, second]);
    await cacheAnimationVoiceSnapshot(root, snapshot(first.path));
    const cached = await readAnimationVoiceCache(root);

    expect(cached.catalog).toEqual([first, second]);
    expect(cached.snapshots[first.path].snapshot.revision).toBe("revision");
    expect(cached.snapshots[first.path].cachedAt).toMatch(/T/);

    await cacheAnimationVoiceCatalog(root, [second]);
    expect((await readAnimationVoiceCache(root)).snapshots[first.path]).toBeUndefined();
  });
});
