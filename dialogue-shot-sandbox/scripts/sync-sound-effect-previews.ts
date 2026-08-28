import { stat } from "node:fs/promises";
import { loadSoundEffectCatalog } from "../server/soundEffectCatalogStore";
import {
  ensureSoundEffectLibraryRecords,
  refreshSoundEffectLibrary,
  updateRemoteSoundEffectMetadata,
  uploadRemoteSoundEffect,
} from "../server/soundEffectLibraryStore";
import {
  inspectSoundEffectPreview,
  prepareSoundEffectPreview,
} from "../server/soundEffectPreview";

function localDateTime(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

async function main() {
  const catalog = await loadSoundEffectCatalog();
  let remoteEntries = await ensureSoundEffectLibraryRecords(catalog.entries);
  const catalogEntries = Array.from(
    new Map(
      catalog.entries.map((entry) => [entry.assetName, entry]),
    ).values(),
  );
  const remoteByAsset = new Map(
    remoteEntries.map((entry) => [entry.assetName, entry]),
  );
  let uploaded = 0;
  let skipped = 0;
  let missing = 0;
  let failed = 0;

  for (const [index, catalogEntry] of catalogEntries.entries()) {
    const remote = remoteByAsset.get(catalogEntry.assetName);
    if (!remote) {
      throw new Error(`远端表缺少记录 ${catalogEntry.assetName}`);
    }
    const prefix = `[${index + 1}/${catalogEntries.length}]`;
    if (remote.attachment) {
      skipped += 1;
      console.log(`${prefix} ${catalogEntry.assetName} remote-ready`);
      continue;
    }
    const info = await inspectSoundEffectPreview(catalogEntry.assetName, {
      remoteLibrary: false,
    });
    if (!info.available) {
      missing += 1;
      await updateRemoteSoundEffectMetadata(remote.recordId, {
        分类: [
          {
            environment: "环境",
            footstep: "脚步",
            action: "动作",
            special: "特殊",
          }[catalogEntry.category],
        ],
        描述: catalogEntry.description,
        提取状态: ["引擎缺失"],
        媒体数量: info.mediaCount,
        同步时间: localDateTime(),
        同步说明: info.reason,
      });
      console.log(`${prefix} ${catalogEntry.assetName} missing`);
      continue;
    }
    try {
      const prepared = await prepareSoundEffectPreview(
        catalogEntry.assetName,
        { remoteLibrary: false },
      );
      await uploadRemoteSoundEffect(remote, prepared.filePath);
      let sourceSizeKb: number | null = null;
      let sourceUpdatedAt: string | null = null;
      if (info.mediaPath) {
        const sourceInfo = await stat(info.mediaPath);
        sourceSizeKb = Math.round((sourceInfo.size / 1024) * 100) / 100;
        sourceUpdatedAt = localDateTime(sourceInfo.mtime);
      }
      await updateRemoteSoundEffectMetadata(remote.recordId, {
        分类: [
          {
            environment: "环境",
            footstep: "脚步",
            action: "动作",
            special: "特殊",
          }[catalogEntry.category],
        ],
        描述: catalogEntry.description,
        提取状态: ["可试听"],
        Wwise媒体ID: info.mediaId ?? "",
        事件时长秒: info.durationSeconds,
        媒体数量: info.mediaCount,
        源WEM大小KB: sourceSizeKb,
        源WEM更新时间: sourceUpdatedAt,
        同步时间: localDateTime(),
        同步说明:
          info.mediaCount > 1
            ? `事件包含 ${info.mediaCount} 个媒体，附件为第一个代表媒体`
            : "从 UE/Wwise 生成数据提取并上传",
      });
      uploaded += 1;
      console.log(`${prefix} ${catalogEntry.assetName} uploaded`);
    } catch (error) {
      failed += 1;
      const message =
        error instanceof Error ? error.message : "音效提取或上传失败";
      await updateRemoteSoundEffectMetadata(remote.recordId, {
        提取状态: ["提取失败"],
        同步时间: localDateTime(),
        同步说明: message,
      });
      console.error(`${prefix} ${catalogEntry.assetName} failed: ${message}`);
    }
  }

  remoteEntries = await refreshSoundEffectLibrary();
  const attached = remoteEntries.filter((entry) => entry.attachment).length;
  console.log(
    JSON.stringify({
      tableId: "tblky7jbQIOlk44n",
      records: remoteEntries.length,
      attached,
      uploaded,
      skipped,
      missing,
      failed,
    }),
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
