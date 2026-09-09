import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfiguredDatabase, loadDocFiles } from "./csvLoader";
import { demoDatabase } from "./demo";

class ParserWorker {
  static latest: ParserWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { ParserWorker.latest = this; }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", ParserWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CSV worker ownership", () => {
  it("delegates configured-directory I/O to the worker and releases it after success", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = loadConfiguredDatabase();
    const worker = ParserWorker.latest;
    expect(worker.postMessage).toHaveBeenCalledWith({ kind: "configured" });
    expect(fetch).not.toHaveBeenCalled();
    worker.onmessage!({ data: { ok: true, database: demoDatabase } });
    await expect(result).resolves.toBe(demoDatabase);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes File handles without reading CSV text on the UI thread", async () => {
    const files = ["对话表.csv", "对话表_开始节点.csv", "NPC表.csv"].map((name) => ({
      name,
      webkitRelativePath: `doc/csvdir/${name}`,
      text: vi.fn(),
    }));
    const result = loadDocFiles(files as unknown as FileList);
    const worker = ParserWorker.latest;
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "files",
      sourceName: "doc",
      files: expect.objectContaining({ dialogueText: files[0], npcText: files[2] }),
    }));
    expect(files.every((file) => file.text.mock.calls.length === 0)).toBe(true);
    worker.onmessage!({ data: { ok: true, database: demoDatabase } });
    await expect(result).resolves.toBe(demoDatabase);
  });

  it("releases the worker after a parse failure", async () => {
    const result = loadConfiguredDatabase();
    const worker = ParserWorker.latest;
    worker.onmessage!({ data: { ok: false, message: "Invalid CSV headers" } });
    await expect(result).rejects.toThrow("Invalid CSV headers");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["error", "messageerror"] as const)("cleans up on worker %s", async (kind) => {
    const result = loadConfiguredDatabase();
    const worker = ParserWorker.latest;
    if (kind === "error") worker.onerror!({ message: "Worker failure" });
    else worker.onmessageerror!();
    await expect(result).rejects.toBeInstanceOf(Error);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("terminates a stalled read and rejects instead of leaving loading permanent", async () => {
    const result = loadConfiguredDatabase();
    const rejected = expect(result).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
    expect(ParserWorker.latest.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up if postMessage throws synchronously", async () => {
    class BrokenWorker extends ParserWorker {
      override postMessage = vi.fn(() => { throw new Error("DataCloneError"); });
    }
    vi.stubGlobal("Worker", BrokenWorker);
    await expect(loadConfiguredDatabase()).rejects.toThrow("DataCloneError");
    expect(ParserWorker.latest.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
