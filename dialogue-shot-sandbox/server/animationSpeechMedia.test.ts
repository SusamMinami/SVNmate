import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { containedMediaPath, resolveSpeechMedia, wavDuration } from "./animationSpeechMedia";
import { wwiseShortId } from "./soundEffectPreview";

describe("speech media resolution", () => {
  let root: string, jsonPath: string;
  const name = "A_Voice_Test";
  const makeBank = () => ({
    ShortName: name, Language: "CN",
    Events: [{ Name: name, DurationType: "OneShot", MediaRefs: [{ Id: "1" }, { Id: "2" }] }],
    Media: [{ Id: "1", Path: "Media/1.wem", ShortName: "one.wav" }, { Id: "2", Path: "Media/2.wem", ShortName: "two.wav" }],
  });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "speech-media-test-"));
    const folder = join(root, "Event", "CN", String(wwiseShortId(name)).slice(0, 2));
    await mkdir(folder, { recursive: true });
    await mkdir(join(root, "Media"));
    await writeFile(join(root, "Media", "1.wem"), "one");
    await writeFile(join(root, "Media", "2.wem"), "two");
    jsonPath = join(folder, `${name}.json`);
    await writeFile(jsonPath, JSON.stringify({ SoundBanksInfo: { SoundBanks: [makeBank()] } }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it("returns every referenced media without silently choosing the first", async () => {
    const choices = await resolveSpeechMedia(name, root);
    expect(choices.map((m) => m.id)).toEqual(["1", "2"]);
    expect(choices[1].path).toBe(resolve(root, "Media", "2.wem"));
  });
  it("rejects loop events", async () => {
    const bank = makeBank(); bank.Events[0].DurationType = "Infinite";
    await writeFile(jsonPath, JSON.stringify({ SoundBanksInfo: { SoundBanks: [bank] } }));
    await expect(resolveSpeechMedia(name, root)).rejects.toThrow("单次播放");
  });
  it("does not guess when media references are missing", async () => {
    const bank = makeBank(); bank.Events[0].MediaRefs = [];
    await writeFile(jsonPath, JSON.stringify({ SoundBanksInfo: { SoundBanks: [bank] } }));
    await expect(resolveSpeechMedia(name, root)).rejects.toThrow("MediaRefs");
  });
  it("rejects duplicate banks and non-voice events", async () => {
    await writeFile(jsonPath, JSON.stringify({ SoundBanksInfo: { SoundBanks: [makeBank(), makeBank()] } }));
    await expect(resolveSpeechMedia(name, root)).rejects.toThrow("不唯一");
    await expect(resolveSpeechMedia("A_SFX_Test", root)).rejects.toThrow("A_Voice");
  });
  it("rejects existing paths outside the root and wrong extensions", async () => {
    await expect(containedMediaPath(join(root, "Event"), "../Media/1.wem")).rejects.toThrow("越界");
    await expect(containedMediaPath(root, jsonPath)).rejects.toThrow("类型无效");
  });
});

describe("wav duration", () => {
  function wave() {
    const buffer = Buffer.alloc(44 + 32000);
    buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28);
    buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36); buffer.writeUInt32LE(32000, 40);
    return buffer;
  }
  it("uses PCM byte rate instead of file size or event metadata", () => { expect(wavDuration(wave())).toBe(1); });
  it("rejects truncated and empty audio", () => {
    expect(() => wavDuration(wave().subarray(0, 45))).toThrow("截断");
    expect(() => wavDuration(Buffer.alloc(0))).toThrow("WAV");
    const missing = wave(); missing.writeUInt32LE(0, 28);
    expect(() => wavDuration(missing)).toThrow("有效音频");
  });
});
