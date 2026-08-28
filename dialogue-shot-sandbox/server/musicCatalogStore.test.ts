import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadMusicCatalog,
  musicAttachmentPath,
  parseMusicStateMap,
} from "./musicCatalogStore";
import { configureConfigCsvDirectory } from "./configRepository";

let temporaryRoot = "";

afterEach(async () => {
  configureConfigCsvDirectory("");
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = "";
  }
});

describe("music catalog store", () => {
  it("rejects state-map loading until a doc directory is selected", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "music-catalog-unset-"));
    const recordsPath = join(temporaryRoot, "music-catalog.ndjson");
    await writeFile(
      recordsPath,
      JSON.stringify({ record_id: "recTest", 资源标识: "Test" }),
      "utf8",
    );

    await expect(
      loadMusicCatalog(undefined, { records: recordsPath }),
    ).rejects.toThrow("尚未选择 doc 文件夹");
  });

  it("parses quoted CSV cells and maps Wwise state names to IDs", () => {
    const stateMap = parseMusicStateMap([
      "##&DialogMusicState.id,,DialogMusicState.Name,DialogMusicState.WwiseState",
      "##id,备注,状态名,状态",
      '13,"备注,包含逗号",情绪-危机爆发,Crisis_Breakout',
    ].join("\n"));

    expect(stateMap.get("Crisis_Breakout")).toBe(13);
  });

  it("loads mapped Base records and reports skipped entries", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "music-catalog-"));
    const recordsPath = join(temporaryRoot, "music-catalog.ndjson");
    const statePath = join(temporaryRoot, "music-states.csv");
    const analysisPath = join(temporaryRoot, "music-analysis.ndjson");
    await writeFile(
      recordsPath,
      [
        JSON.stringify({
          record_id: "recDanger",
          BGM名称: "情绪-危机爆发",
          资源标识: "Crisis_Breakout",
          标签: ["危险战斗"],
          备注: "非常危险",
          BGM文件: [
            {
              file_token: "fileDanger",
              name: "danger.wav",
            },
          ],
        }),
        JSON.stringify({
          record_id: "recCalm",
          BGM名称: "情绪-真诚",
          资源标识: "Sincere",
          标签: ["日常轻松"],
          备注: "温馨",
          BGM文件: [],
        }),
        JSON.stringify({
          record_id: "recUnknown",
          BGM名称: "未映射",
          资源标识: "Unknown_State",
          标签: [],
          备注: "",
          BGM文件: [],
        }),
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      recordsPath.replace(".ndjson", ".manifest.json"),
      JSON.stringify({ rev: 206 }),
      "utf8",
    );
    await writeFile(
      statePath,
      [
        "##&DialogMusicState.id,,DialogMusicState.Name,DialogMusicState.WwiseState",
        "##id,备注,状态名,状态",
        "13,,情绪-危机爆发,Crisis_Breakout",
        "18,,情绪-真诚,Sincere",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      analysisPath,
      JSON.stringify({
        资源标识: "Crisis_Breakout",
        文件Token: "fileDanger",
        分析状态: ["完成"],
        估算BPM: 128,
        BPM来源: "音频估算",
        节奏置信度: 0.8,
        综合响度LUFS: -14,
        响度范围LU: 5,
        真峰值dBFS: -1,
        动态范围dB: 9,
        频谱重心Hz: 1900,
        低频占比: 0.3,
        中频占比: 0.5,
        高频占比: 0.2,
        速度等级: ["快"],
        能量等级: ["高"],
        音色明暗: ["均衡"],
        音频特征摘要: "快节奏、高能量",
      }),
      "utf8",
    );

    const snapshot = await loadMusicCatalog(undefined, {
      records: recordsPath,
      stateMaps: [statePath],
      analysis: analysisPath,
    });

    expect(snapshot).toMatchObject({
      revision: 206,
      unmappedCount: 1,
      missingAttachmentCount: 1,
      analyzedCount: 1,
    });
    expect(snapshot.syncedAt).not.toBeNull();
    expect(snapshot.entries).toEqual([
      expect.objectContaining({
        recordId: "recDanger",
        stateId: 13,
        fileToken: "fileDanger",
        analysis: expect.objectContaining({
          estimatedBpm: 128,
          bpmSource: "音频估算",
          integratedLufs: -14,
        }),
      }),
      expect.objectContaining({
        recordId: "recCalm",
        stateId: 18,
        fileToken: null,
      }),
    ]);
  });

  it("keeps attachment cache paths distinct for duplicate file names", () => {
    const first = musicAttachmentPath("fileOne123", "music.wav");
    const second = musicAttachmentPath("fileTwo456", "music.wav");

    expect(first).not.toBe(second);
    expect(first).toContain("fileOne123-music.wav");
  });
});
