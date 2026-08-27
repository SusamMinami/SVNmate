import { Buffer } from "node:buffer";
import net from "node:net";

const UE_MCP_HOST = process.env.UE_MCP_HOST || "127.0.0.1";
const DEFAULT_UE_MCP_PORT = 12031;
const environmentUeMcpPort = Number.parseInt(
  process.env.UE_MCP_PORT || String(DEFAULT_UE_MCP_PORT),
  10,
);
let ueMcpPort =
  Number.isInteger(environmentUeMcpPort) &&
  environmentUeMcpPort >= 1 &&
  environmentUeMcpPort <= 65_535
    ? environmentUeMcpPort
    : DEFAULT_UE_MCP_PORT;

const CONNECT_TIMEOUT_MS = 1_500;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

interface UnrealResponse {
  success?: boolean;
  Value?: unknown;
  Output?: { ReturnValue?: unknown };
  errorLogs?: string;
}

export interface UnrealInvoker {
  connect(): Promise<void>;
  invoke(action: string, args: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export function getUnrealMcpEndpoint(): { host: string; port: number } {
  return { host: UE_MCP_HOST, port: ueMcpPort };
}

export function configureUnrealMcpPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("UE MCP 端口必须是 1-65535 的整数");
  }
  ueMcpPort = port;
}

export class UnrealMcpConnection implements UnrealInvoker {
  private readonly socket = new net.Socket();
  private buffer = Buffer.alloc(0);
  private expectedLength: number | null = null;
  private waiters: Array<{
    resolve: (value: UnrealResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.destroy();
        reject(new Error("连接 UE 编辑器超时"));
      }, CONNECT_TIMEOUT_MS);
      this.socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.socket.connect(ueMcpPort, UE_MCP_HOST);
    });
    this.socket.on("data", (chunk) =>
      this.consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    this.socket.on("error", (error) => this.rejectAll(error));
    this.socket.on("close", () =>
      this.rejectAll(new Error("UE 编辑器连接已关闭")),
    );
  }

  async invoke(action: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.request({
      proto_type: "tool_call",
      tool_name: "unreal_invoke",
      tool_args: { action, args },
    });
    if (response.success === false) {
      throw new Error(response.errorLogs || `UE 操作失败：${action}`);
    }
    return response.Value ?? response.Output?.ReturnValue;
  }

  close(): void {
    this.socket.end();
  }

  private request(payload: Record<string, unknown>): Promise<UnrealResponse> {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("UE 编辑器响应超时"));
        this.socket.destroy();
      }, REQUEST_TIMEOUT_MS);
      this.waiters.push({ resolve, reject, timer });
      this.socket.write(Buffer.concat([header, body]));
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      if (this.expectedLength === null) {
        if (this.buffer.length < 4) {
          return;
        }
        this.expectedLength = this.buffer.readUInt32BE(0);
        this.buffer = this.buffer.subarray(4);
        if (this.expectedLength > MAX_RESPONSE_BYTES) {
          this.rejectAll(new Error("UE 编辑器响应超过大小限制"));
          this.socket.destroy();
          return;
        }
      }
      if (this.buffer.length < this.expectedLength) {
        return;
      }
      const payload = this.buffer.subarray(0, this.expectedLength);
      this.buffer = this.buffer.subarray(this.expectedLength);
      this.expectedLength = null;
      const waiter = this.waiters.shift();
      if (!waiter) {
        continue;
      }
      clearTimeout(waiter.timer);
      try {
        waiter.resolve(JSON.parse(payload.toString("utf8")) as UnrealResponse);
      } catch {
        waiter.reject(new Error("UE 编辑器返回了无效 JSON"));
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}
