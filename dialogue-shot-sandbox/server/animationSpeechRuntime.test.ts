import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { scanAnimationSequence } from "./animationVoice";
import { animationSpeechStatus, startAnimationSpeech, getAnimationSpeechJob, cancelAnimationSpeech } from "./animationSpeechRuntime";

vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("./animationSpeechMedia", () => ({
  getAnimationSpeechAudio: async () => ({
    audio: { assetPath: "/Game/Test.Test", revision: "r1", duration: 30 }, path: "voice.wav",
  }),
}));
vi.mock("./animationVoice", () => ({ scanAnimationSequence: vi.fn() }));

const request = {
  audioToken: "9a00eb34-5c0b-4b16-8b0e-68a8dca06c3b",
  mode: "asr", cropStart: 0, cropEnd: 10, timelineOrigin: 0, lines: [],
};

describe("speech process lifecycle", () => {
  function fakeChild() {
    return Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(),
    });
  }
  let child = fakeChild();
  beforeEach(() => {
    child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    vi.mocked(scanAnimationSequence).mockResolvedValue({ revision: "r1", start: 0, end: 30 } as never);
  });
  it("rejects simultaneous requests and waits for process exit before releasing the lease", async () => {
    const job = await startAnimationSpeech(request);
    try {
      await expect(startAnimationSpeech(request)).rejects.toThrow("已有语音任务");
      expect((await cancelAnimationSpeech({ id: job.id })).state).toBe("cancelled");
      expect(child.kill).toHaveBeenCalledOnce();
      expect((await animationSpeechStatus()).busy).toBe(true);
    } finally { child.emit("close", null); }
    expect((await animationSpeechStatus()).busy).toBe(false);
    expect((await getAnimationSpeechJob({ id: job.id })).state).toBe("cancelled");
  });
  it("parses split progress and result packets but completes only on a successful exit", async () => {
    const job = await startAnimationSpeech(request);
    child.stdout.write('{"type":"progress","stage":"识别');
    child.stdout.write('中"}\n');
    expect((await getAnimationSpeechJob({ id: job.id })).stage).toBe("识别中");
    child.stdout.write(`${JSON.stringify({ type: "result", result: {
      mode: "asr", model: "model", device: "cpu", elapsed: 1, warnings: [],
      lines: [{ key: "one", text: "台词", start: 0, end: 1, audioStart: 0, audioEnd: 1, warnings: [] }],
    } })}\n`);
    expect(job.state).toBe("running");
    child.emit("close", 0);
    expect(job.state).toBe("complete");
    expect(job.result?.lines[0].text).toBe("台词");
  });
  it("rejects stale assets before spawning a model and releases the lease", async () => {
    vi.mocked(scanAnimationSequence).mockResolvedValue({ revision: "new", start: 0, end: 30 } as never);
    const calls = vi.mocked(spawn).mock.calls.length;
    await expect(startAnimationSpeech(request)).rejects.toThrow("已变化");
    expect(vi.mocked(spawn).mock.calls.length).toBe(calls);
    expect((await animationSpeechStatus()).busy).toBe(false);
  });
  it("reports model errors and does not present malformed output as success", async () => {
    const job = await startAnimationSpeech(request);
    child.stdout.write('{"type":"error","error":"显存不足"}\n');
    child.emit("close", 1);
    expect(job.state).toBe("failed");
    expect(job.error).toBe("显存不足");
    expect(job.result).toBeUndefined();
    expect((await animationSpeechStatus()).busy).toBe(false);
  });
});
