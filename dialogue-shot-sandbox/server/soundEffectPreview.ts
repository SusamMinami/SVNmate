import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  SoundEffectPreviewInfo,
  SoundEffectPreviewPrepared,
} from "../src/types";
import { getConfigCsvDirectory } from "./configRepository";
import {
  downloadRemoteSoundEffect,
  loadSoundEffectLibrary,
  type RemoteSoundEffectEntry,
  updateRemoteSoundEffectMetadata,
  uploadRemoteSoundEffect,
} from "./soundEffectLibraryStore";

const execFileAsync = promisify(execFile);
const SOUND_EFFECT_NAME_PATTERN = /^A_SFX_[A-Za-z0-9_]+$/;
const conversionLocks = new Map<string, Promise<string>>();

interface WwiseMedia {
  Id?: string;
  Path?: string;
}

interface WwiseEventMetadata {
  DurationMax?: string;
  DurationMin?: string;
}

interface WwiseEventFile {
  SoundBanksInfo?: {
    SoundBanks?: Array<{
      ShortName?: string;
      Media?: WwiseMedia[];
      Events?: WwiseEventMetadata[];
    }>;
  };
}

interface SoundEffectPreviewOptions {
  wwiseRoot?: string;
  cacheRoot?: string;
  vgmstreamPath?: string;
  convert?: (
    executable: string,
    sourcePath: string,
    outputPath: string,
  ) => Promise<void>;
  remoteLibrary?: readonly RemoteSoundEffectEntry[] | false;
}

interface ResolvedSoundEffectPreview extends SoundEffectPreviewInfo {
  eventPath?: string;
  mediaId?: string;
  mediaPath?: string;
  remoteEntry?: RemoteSoundEffectEntry;
}

export interface PreparedSoundEffectPreview
  extends SoundEffectPreviewPrepared {
  filePath: string;
}

function runtimeRoot(): string {
  return process.env.STORYBOARD_PROJECT_ROOT || process.cwd();
}

function configuredWwiseRoot(): string {
  if (process.env.STORYBOARD_WWISE_WINDOWS_DIR) {
    return resolve(process.env.STORYBOARD_WWISE_WINDOWS_DIR);
  }
  const projectRoot = dirname(dirname(getConfigCsvDirectory()));
  return join(
    projectRoot,
    "res",
    "Content",
    "Seria",
    "WwiseAudio",
    "Windows",
  );
}

function configuredVgmstreamPath(): string {
  if (process.env.VGMSTREAM_CLI_PATH) {
    return resolve(process.env.VGMSTREAM_CLI_PATH);
  }
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  const candidates = [
    ...(resourcesPath
      ? [join(resourcesPath, "tools", "vgmstream", "vgmstream-cli.exe")]
      : []),
    join(process.cwd(), "tools", "vgmstream", "vgmstream-cli.exe"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function assertAssetName(assetName: string): void {
  if (!SOUND_EFFECT_NAME_PATTERN.test(assetName)) {
    throw new Error("音效资产名无效");
  }
}

export function wwiseShortId(name: string): number {
  let hash = 2_166_136_261;
  for (const character of name.toLowerCase()) {
    hash = Math.imul(hash, 16_777_619) >>> 0;
    hash ^= character.charCodeAt(0);
  }
  return hash >>> 0;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findEventMetadataPath(
  wwiseRoot: string,
  assetName: string,
): Promise<string | null> {
  const bucket = String(wwiseShortId(assetName)).slice(0, 2);
  const direct = join(wwiseRoot, "Event", bucket, `${assetName}.json`);
  if (await exists(direct)) {
    return direct;
  }
  const eventRoot = join(wwiseRoot, "Event");
  let directories: string[];
  try {
    directories = await readdir(eventRoot);
  } catch {
    return null;
  }
  for (const directory of directories) {
    const candidate = join(eventRoot, directory, `${assetName}.json`);
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function inspectSoundEffectPreview(
  assetName: string,
  options: SoundEffectPreviewOptions = {},
): Promise<ResolvedSoundEffectPreview> {
  assertAssetName(assetName);
  const remoteEntries =
    options.remoteLibrary === false
      ? []
      : options.remoteLibrary ??
        (options.wwiseRoot ? [] : await loadSoundEffectLibrary());
  const remoteEntry = remoteEntries.find(
    (entry) => entry.assetName === assetName,
  );
  if (remoteEntry?.attachment) {
    return {
      assetName,
      available: true,
      reason: "已找到远端多维表格试听附件",
      durationSeconds: remoteEntry.durationSeconds,
      mediaCount: remoteEntry.mediaCount || 1,
      mediaId: remoteEntry.mediaId,
      remoteEntry,
    };
  }
  const wwiseRoot = options.wwiseRoot ?? configuredWwiseRoot();
  const eventPath = await findEventMetadataPath(wwiseRoot, assetName);
  if (!eventPath) {
    return {
      assetName,
      available: false,
      reason: "当前 UE 项目的 Wwise 生成数据中未找到该事件",
      durationSeconds: null,
      mediaCount: 0,
      remoteEntry,
    };
  }
  const payload = JSON.parse(
    await readFile(eventPath, "utf8"),
  ) as WwiseEventFile;
  const banks = payload.SoundBanksInfo?.SoundBanks ?? [];
  const bank =
    banks.find((candidate) => candidate.ShortName === assetName) ?? banks[0];
  const media = bank?.Media ?? [];
  const resolvedMedia: Array<WwiseMedia & { fullPath: string }> = [];
  for (const item of media) {
    if (!item.Path || !item.Id) {
      continue;
    }
    const fullPath = resolve(wwiseRoot, ...item.Path.split(/[\\/]/));
    if (
      fullPath.toLowerCase().startsWith(`${resolve(wwiseRoot).toLowerCase()}\\`) &&
      (await exists(fullPath))
    ) {
      resolvedMedia.push({ ...item, fullPath });
    }
  }
  if (resolvedMedia.length === 0) {
    return {
      assetName,
      available: false,
      reason: "Wwise 事件存在，但对应 WEM 媒体文件缺失",
      durationSeconds: null,
      mediaCount: media.length,
      eventPath,
      remoteEntry,
    };
  }
  const vgmstreamPath =
    options.vgmstreamPath ?? configuredVgmstreamPath();
  if (!(await exists(vgmstreamPath))) {
    return {
      assetName,
      available: false,
      reason: "缺少 Wwise WEM 解码器 vgmstream",
      durationSeconds: null,
      mediaCount: resolvedMedia.length,
      eventPath,
      remoteEntry,
    };
  }
  const event = bank?.Events?.[0];
  const duration = Number(event?.DurationMax ?? event?.DurationMin);
  return {
    assetName,
    available: true,
    reason:
      resolvedMedia.length > 1
        ? `事件包含 ${resolvedMedia.length} 个媒体，试听第一个代表文件`
        : "已找到 UE/Wwise 试听媒体",
    durationSeconds: Number.isFinite(duration) ? duration : null,
    mediaCount: resolvedMedia.length,
    eventPath,
    mediaId: String(resolvedMedia[0].Id),
    mediaPath: resolvedMedia[0].fullPath,
    remoteEntry,
  };
}

async function defaultConvert(
  executable: string,
  sourcePath: string,
  outputPath: string,
): Promise<void> {
  await execFileAsync(
    executable,
    ["-i", "-o", outputPath, sourcePath],
    {
      cwd: dirname(executable),
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

export async function prepareSoundEffectPreview(
  assetName: string,
  options: SoundEffectPreviewOptions = {},
): Promise<PreparedSoundEffectPreview> {
  const info = await inspectSoundEffectPreview(assetName, options);
  if (!info.available) {
    throw new Error(info.reason);
  }
  const cacheRoot =
    options.cacheRoot ??
    join(runtimeRoot(), ".storyboard-data", "sound-effect-preview");
  await mkdir(cacheRoot, { recursive: true });
  if (info.remoteEntry?.attachment) {
    const remoteFilePath = join(
      cacheRoot,
      `${assetName}-remote-${info.remoteEntry.attachment.fileToken}.wav`,
    );
    try {
      const cached = await stat(remoteFilePath);
      if (
        cached.size > 44 &&
        (info.remoteEntry.attachment.size <= 0 ||
          cached.size === info.remoteEntry.attachment.size)
      ) {
        return {
          ...info,
          available: true,
          url: `/api/ue/sound-effects/preview-file?assetName=${encodeURIComponent(assetName)}`,
          filePath: remoteFilePath,
        };
      }
    } catch {
      // Download the remote attachment on first playback.
    }
    await downloadRemoteSoundEffect(info.remoteEntry, remoteFilePath);
    return {
      ...info,
      available: true,
      url: `/api/ue/sound-effects/preview-file?assetName=${encodeURIComponent(assetName)}`,
      filePath: remoteFilePath,
    };
  }
  if (!info.mediaPath || !info.mediaId) {
    throw new Error("音效试听媒体信息不完整");
  }
  const filePath = join(
    cacheRoot,
    `${assetName}-${info.mediaId}.wav`,
  );
  const sourceInfo = await stat(info.mediaPath);
  try {
    const cached = await stat(filePath);
    if (cached.size > 44 && cached.mtimeMs >= sourceInfo.mtimeMs) {
      if (info.remoteEntry && options.remoteLibrary !== false) {
        void publishPreparedSoundEffectPreview(
          assetName,
          filePath,
          info,
        ).catch((error) => {
          console.error("[sound-effect-preview] remote upload failed", error);
        });
      }
      return {
        ...info,
        available: true,
        url: `/api/ue/sound-effects/preview-file?assetName=${encodeURIComponent(assetName)}`,
        filePath,
      };
    }
  } catch {
    // First preview converts the source WEM.
  }
  const existing = conversionLocks.get(filePath);
  if (existing) {
    await existing;
  } else {
    const conversion = (async () => {
      const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp.wav`;
      try {
        await (options.convert ?? defaultConvert)(
          options.vgmstreamPath ?? configuredVgmstreamPath(),
          info.mediaPath!,
          temporary,
        );
        const outputInfo = await stat(temporary);
        if (outputInfo.size <= 44) {
          throw new Error("Wwise 音效解码结果为空");
        }
        await rm(filePath, { force: true });
        await rename(temporary, filePath);
        return filePath;
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    })();
    conversionLocks.set(filePath, conversion);
    try {
      await conversion;
    } finally {
      conversionLocks.delete(filePath);
    }
  }
  if (info.remoteEntry && options.remoteLibrary !== false) {
    void publishPreparedSoundEffectPreview(assetName, filePath, info).catch(
      (error) => {
        console.error("[sound-effect-preview] remote upload failed", error);
      },
    );
  }
  return {
    ...info,
    available: true,
    url: `/api/ue/sound-effects/preview-file?assetName=${encodeURIComponent(assetName)}`,
    filePath,
  };
}

export async function publishPreparedSoundEffectPreview(
  assetName: string,
  filePath: string,
  info: ResolvedSoundEffectPreview,
  remoteEntries?: readonly RemoteSoundEffectEntry[],
): Promise<boolean> {
  const availableRemoteEntries =
    remoteEntries ?? (await loadSoundEffectLibrary());
  const remoteEntry = availableRemoteEntries.find(
    (entry) => entry.assetName === assetName,
  );
  if (!remoteEntry || remoteEntry.attachment) {
    return Boolean(remoteEntry?.attachment);
  }
  await uploadRemoteSoundEffect(remoteEntry, filePath);
  let wemSizeKb: number | null = null;
  let wemUpdatedAt: string | null = null;
  if (info.mediaPath) {
    const sourceInfo = await stat(info.mediaPath);
    wemSizeKb = Math.round((sourceInfo.size / 1024) * 100) / 100;
    wemUpdatedAt = new Date(sourceInfo.mtimeMs)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
  }
  await updateRemoteSoundEffectMetadata(remoteEntry.recordId, {
    提取状态: ["可试听"],
    Wwise媒体ID: info.mediaId ?? "",
    事件时长秒: info.durationSeconds,
    媒体数量: info.mediaCount,
    源WEM大小KB: wemSizeKb,
    源WEM更新时间: wemUpdatedAt,
    同步时间: new Date().toISOString().slice(0, 16).replace("T", " "),
    同步说明:
      info.mediaCount > 1
        ? `事件包含 ${info.mediaCount} 个媒体，附件为第一个代表媒体`
        : "从 UE/Wwise 生成数据提取并上传",
  });
  return true;
}
