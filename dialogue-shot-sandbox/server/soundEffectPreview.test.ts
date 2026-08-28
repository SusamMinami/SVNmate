import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectSoundEffectPreview,
  prepareSoundEffectPreview,
  wwiseShortId,
} from "./soundEffectPreview";

let temporaryRoot = "";

afterEach(async () => {
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = "";
  }
});

async function createWwiseFixture(assetName: string) {
  temporaryRoot = await mkdtemp(join(tmpdir(), "sound-preview-"));
  const wwiseRoot = join(temporaryRoot, "WwiseAudio", "Windows");
  const mediaPath = join(wwiseRoot, "Media", "89", "89313708.wem");
  const eventPath = join(
    wwiseRoot,
    "Event",
    String(wwiseShortId(assetName)).slice(0, 2),
    `${assetName}.json`,
  );
  const toolPath = join(temporaryRoot, "vgmstream-cli.exe");
  await mkdir(join(wwiseRoot, "Media", "89"), { recursive: true });
  await mkdir(join(eventPath, ".."), { recursive: true });
  await writeFile(mediaPath, Buffer.alloc(80, 1));
  await writeFile(toolPath, Buffer.alloc(1));
  await writeFile(
    eventPath,
    JSON.stringify({
      SoundBanksInfo: {
        SoundBanks: [
          {
            ShortName: assetName,
            Media: [
              {
                Id: "89313708",
                Path: "Media/89/89313708.wem",
              },
            ],
            Events: [
              {
                DurationMin: "6.9760833",
                DurationMax: "6.9760833",
              },
            ],
          },
        ],
      },
    }),
  );
  return {
    wwiseRoot,
    mediaPath,
    toolPath,
    cacheRoot: join(temporaryRoot, "cache"),
  };
}

describe("sound effect preview", () => {
  it("matches the Wwise event bucket algorithm", () => {
    expect(wwiseShortId("A_SFX_Dialog_516918")).toBe(3_955_400_654);
  });

  it("resolves event metadata and caches the decoded preview", async () => {
    const assetName = "A_SFX_Dialog_516918";
    const paths = await createWwiseFixture(assetName);
    let conversions = 0;
    const convert = async (
      _executable: string,
      _sourcePath: string,
      outputPath: string,
    ) => {
      conversions += 1;
      await writeFile(outputPath, Buffer.alloc(100, 2));
    };

    const info = await inspectSoundEffectPreview(assetName, paths);
    const first = await prepareSoundEffectPreview(assetName, {
      ...paths,
      convert,
    });
    const second = await prepareSoundEffectPreview(assetName, {
      ...paths,
      convert,
    });

    expect(info).toMatchObject({
      available: true,
      durationSeconds: 6.9760833,
      mediaCount: 1,
      mediaId: "89313708",
    });
    expect(first.url).toContain(
      "assetName=A_SFX_Dialog_516918",
    );
    expect(second.filePath).toBe(first.filePath);
    expect(conversions).toBe(1);
  });

  it("returns a concrete reason when the generated event is missing", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "sound-preview-"));
    const info = await inspectSoundEffectPreview(
      "A_SFX_Dialog_999999",
      {
        wwiseRoot: join(temporaryRoot, "WwiseAudio", "Windows"),
        vgmstreamPath: join(temporaryRoot, "vgmstream-cli.exe"),
      },
    );

    expect(info).toEqual({
      assetName: "A_SFX_Dialog_999999",
      available: false,
      reason: "当前 UE 项目的 Wwise 生成数据中未找到该事件",
      durationSeconds: null,
      mediaCount: 0,
    });
  });

  it("prefers a remote Base attachment over local Wwise media", async () => {
    const info = await inspectSoundEffectPreview(
      "A_SFX_Dialog_516918",
      {
        remoteLibrary: [
          {
            recordId: "recRemote",
            assetName: "A_SFX_Dialog_516918",
            category: "特殊",
            description: "报警声",
            status: "可试听",
            mediaId: "89313708",
            durationSeconds: 6.976,
            mediaCount: 1,
            attachment: {
              fileToken: "fileRemote",
              fileName: "A_SFX_Dialog_516918.wav",
              size: 781_364,
            },
          },
        ],
      },
    );

    expect(info).toMatchObject({
      available: true,
      reason: "已找到远端多维表格试听附件",
      durationSeconds: 6.976,
      mediaId: "89313708",
    });
  });
});
