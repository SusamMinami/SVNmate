import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { storyboardRuntimeRoot } from "./storyboardRuntime";

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_STALE_MS = 15_000;
export const STORYBOARD_MCP_VERSION = "0.18.0";

interface StoryboardMcpHeartbeat {
  pid: number;
  serverVersion: string;
  transport: "http" | "stdio";
  startedAt: string;
  updatedAt: string;
}

export interface StoryboardMcpPresence {
  connected: boolean;
  compatible: boolean;
  serverVersion: string | null;
  transport: "http" | "stdio" | null;
  lastSeenAt: string | null;
}

function heartbeatDirectory(): string {
  return join(storyboardRuntimeRoot(), ".storyboard-data");
}

function heartbeatPath(
  transport: StoryboardMcpHeartbeat["transport"],
  pid = process.pid,
): string {
  return join(heartbeatDirectory(), `mcp-heartbeat.${transport}.${pid}.json`);
}

async function writeHeartbeat(
  startedAt: string,
  transport: StoryboardMcpHeartbeat["transport"],
): Promise<void> {
  const destination = heartbeatPath(transport);
  await mkdir(heartbeatDirectory(), { recursive: true });
  const heartbeat: StoryboardMcpHeartbeat = {
    pid: process.pid,
    serverVersion: STORYBOARD_MCP_VERSION,
    transport,
    startedAt,
    updatedAt: new Date().toISOString(),
  };
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(heartbeat, null, 2), "utf8");
  await rename(temporary, destination);
}

function isProcessRunning(pid: unknown): boolean {
  if (!Number.isInteger(pid) || Number(pid) <= 0) {
    return false;
  }
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function toPresence(
  heartbeat: Partial<StoryboardMcpHeartbeat>,
): StoryboardMcpPresence {
  const updatedAt =
    typeof heartbeat.updatedAt === "string" ? heartbeat.updatedAt : null;
  const serverVersion =
    typeof heartbeat.serverVersion === "string"
      ? heartbeat.serverVersion
      : null;
  const transport =
    heartbeat.transport === "http" || heartbeat.transport === "stdio"
      ? heartbeat.transport
      : null;
  const updatedTime = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const processRunning = isProcessRunning(heartbeat.pid);
  const connected = transport === "http"
    ? processRunning
    : processRunning &&
      Number.isFinite(updatedTime) &&
      Date.now() - updatedTime <= HEARTBEAT_STALE_MS;
  return {
    connected,
    compatible: connected && serverVersion === STORYBOARD_MCP_VERSION,
    serverVersion,
    transport,
    lastSeenAt: updatedAt,
  };
}

export async function getStoryboardMcpPresence(): Promise<StoryboardMcpPresence> {
  try {
    const filenames = (await readdir(heartbeatDirectory())).filter(
      (filename) =>
        filename === "mcp-heartbeat.json" ||
        /^mcp-heartbeat\.(?:http|stdio)\.\d+\.json$/.test(filename),
    );
    const presences = (
      await Promise.all(
        filenames.map(async (filename) => {
          try {
            const heartbeat = JSON.parse(
              await readFile(join(heartbeatDirectory(), filename), "utf8"),
            ) as Partial<StoryboardMcpHeartbeat>;
            return toPresence(heartbeat);
          } catch (error) {
            if (
              (error as NodeJS.ErrnoException).code === "ENOENT" ||
              error instanceof SyntaxError
            ) {
              return null;
            }
            throw error;
          }
        }),
      )
    ).filter((presence): presence is StoryboardMcpPresence =>
      Boolean(presence),
    );
    const selected = presences.sort((left, right) => {
      if (left.compatible !== right.compatible) {
        return Number(right.compatible) - Number(left.compatible);
      }
      if (left.connected !== right.connected) {
        return Number(right.connected) - Number(left.connected);
      }
      if (left.transport !== right.transport) {
        return left.transport === "http" ? -1 : 1;
      }
      return (right.lastSeenAt || "").localeCompare(left.lastSeenAt || "");
    })[0];
    return selected ?? {
      connected: false,
      compatible: false,
      serverVersion: null,
      transport: null,
      lastSeenAt: null,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        connected: false,
        compatible: false,
        serverVersion: null,
        transport: null,
        lastSeenAt: null,
      };
    }
    throw error;
  }
}

export async function recordStoryboardMcpActivity(
  transport: StoryboardMcpHeartbeat["transport"],
): Promise<void> {
  const timestamp = new Date().toISOString();
  await writeHeartbeat(timestamp, transport);
}

export async function startStoryboardMcpHeartbeat(): Promise<
  () => Promise<void>
> {
  const startedAt = new Date().toISOString();
  const destination = heartbeatPath("stdio");
  await writeHeartbeat(startedAt, "stdio");
  const timer = setInterval(() => {
    void writeHeartbeat(startedAt, "stdio").catch((error) => {
      console.error("[storyboard-mcp] heartbeat failed", error);
    });
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return async () => {
    clearInterval(timer);
    try {
      const heartbeat = JSON.parse(
        await readFile(destination, "utf8"),
      ) as Partial<StoryboardMcpHeartbeat>;
      if (heartbeat.pid === process.pid) {
        await rm(destination, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  };
}
