import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";

export function audioContentType(fileName: string): string {
  const types: Record<string, string> = {
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
  };
  return types[extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) {
    throw new Error("无效的音频 Range 请求");
  }
  const suffixLength = match[1] ? null : Number(match[2]);
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - (suffixLength ?? 0));
  const end =
    match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    throw new Error("音频 Range 超出文件范围");
  }
  return { start, end };
}

export async function streamAudioFile(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  fileName: string,
): Promise<void> {
  const info = await stat(path);
  let range: { start: number; end: number } | null;
  try {
    range = parseByteRange(request.headers.range, info.size);
  } catch {
    response.statusCode = 416;
    response.setHeader("Content-Range", `bytes */${info.size}`);
    response.end();
    return;
  }
  response.statusCode = range ? 206 : 200;
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "private, max-age=86400");
  response.setHeader("Content-Type", audioContentType(fileName));
  response.setHeader(
    "Content-Length",
    String(range ? range.end - range.start + 1 : info.size),
  );
  if (range) {
    response.setHeader(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${info.size}`,
    );
  }
  const stream = createReadStream(path, range ?? undefined);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}
