import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { storyboardRuntimeRoot } from "./storyboardRuntime";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const originalAppData = process.env.APPDATA;
const originalProjectRoot = process.env.STORYBOARD_PROJECT_ROOT;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalAppData === undefined) {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }
  if (originalProjectRoot === undefined) {
    delete process.env.STORYBOARD_PROJECT_ROOT;
  } else {
    process.env.STORYBOARD_PROJECT_ROOT = originalProjectRoot;
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("storyboardRuntimeRoot", () => {
  it("redirects a source checkout to the shared desktop queue", async () => {
    const appData = await mkdtemp(join(tmpdir(), "storyboard-appdata-"));
    temporaryDirectories.push(appData);
    process.env.APPDATA = appData;
    process.env.STORYBOARD_PROJECT_ROOT = projectRoot;

    expect(storyboardRuntimeRoot()).toBe(
      join(appData, "Shot Sandbox", "runtime"),
    );
  });

  it("preserves explicit non-source roots used by tests and services", async () => {
    const runtime = await mkdtemp(join(tmpdir(), "storyboard-runtime-"));
    temporaryDirectories.push(runtime);
    process.env.STORYBOARD_PROJECT_ROOT = runtime;

    expect(storyboardRuntimeRoot()).toBe(runtime);
  });
});
