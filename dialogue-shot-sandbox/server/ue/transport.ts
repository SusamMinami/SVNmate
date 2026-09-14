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
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

interface UnrealResponse {
  success?: boolean;
  Value?: unknown;
  Output?: { ReturnValue?: unknown };
  errorLogs?: string;
}

function errorMessageFromResponse(
  response: UnrealResponse,
  action: string,
): string {
  const returnValue = response.Output?.ReturnValue;
  const details =
    returnValue && typeof returnValue === "object"
      ? (returnValue as { Message?: unknown; Result?: unknown })
      : null;
  const candidates = [
    details?.Message,
    details?.Result,
    typeof returnValue === "string" ? returnValue : "",
    response.errorLogs,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  return (
    candidates.reduce(
      (longest, value) =>
        value.trim().length > longest.length ? value.trim() : longest,
      "",
    ) || `UE 操作失败：${action}`
  );
}

export interface UnrealInvoker {
  connect(): Promise<void>;
  invoke(
    action: string,
    args: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown>;
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
  private readonly header = Buffer.alloc(4);
  private headerOffset = 0;
  private responseBuffer: Buffer | null = null;
  private responseOffset = 0;
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

  async invoke(
    action: string,
    args: Record<string, unknown>,
    options: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    // #region debug-point A-B-C:ue-request
    const debugTrace = process.env.DEBUG_SESSION_ID === "ue-search-compact-crash" ? { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, startedAt: Date.now(), connectionPort: this.socket.localPort } : null;
    if (debugTrace) void fetch(process.env.DEBUG_SERVER_URL || "http://127.0.0.1:7777/event", { method: "POST", signal: AbortSignal.timeout(750), body: JSON.stringify({ sessionId: "ue-search-compact-crash", runId: process.env.DEBUG_RUN_ID || "pre-fix", hypothesisId: "A-B-C", traceId: debugTrace.id, location: "server/ue/transport.ts:invoke", msg: "[DEBUG] UE request begin", ts: debugTrace.startedAt, data: { action, propertyName: args.PropertyName, connectionPort: debugTrace.connectionPort, pendingOnConnection: this.waiters.length, socketState: this.socket.readyState, selectionProbe: typeof args.Expression === "string" && args.Expression.includes("get_current_selected_dialog_node_info") } }) }).catch(() => {});
    // #endregion
    const response = await this.request(
      {
        proto_type: "tool_call",
        tool_name: "unreal_invoke",
        tool_args: { action, args },
      },
      options.timeoutMs,
      action,
    );
    // #region debug-point A-B-C:ue-response
    if (debugTrace) void fetch(process.env.DEBUG_SERVER_URL || "http://127.0.0.1:7777/event", { method: "POST", signal: AbortSignal.timeout(750), body: JSON.stringify({ sessionId: "ue-search-compact-crash", runId: process.env.DEBUG_RUN_ID || "pre-fix", hypothesisId: "A-B-C", traceId: debugTrace.id, location: "server/ue/transport.ts:invoke", msg: "[DEBUG] UE request returned", ts: Date.now(), data: { action, propertyName: args.PropertyName, connectionPort: debugTrace.connectionPort, durationMs: Date.now() - debugTrace.startedAt, success: response.success !== false, emptySelectionError: response.errorLogs?.includes("'NoneType' object is not iterable") ?? false } }) }).catch(() => {});
    // #endregion
    if (response.success === false) {
      throw new Error(errorMessageFromResponse(response, action));
    }
    return response.Value ?? response.Output?.ReturnValue;
  }

  close(): void {
    this.rejectAll(new Error("UE 编辑器连接已关闭"));
    this.socket.destroy();
  }

  private request(
    payload: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
    action = "UE 操作",
  ): Promise<UnrealResponse> {
    if (this.socket.destroyed || this.socket.readyState !== "open") {
      return Promise.reject(new Error("UE 编辑器连接已关闭"));
    }
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectAll(
          new Error(
            `UE 编辑器执行 ${action} 超时（${Math.ceil(timeoutMs / 1_000)} 秒）`,
          ),
        );
        this.socket.destroy();
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
      this.socket.write(Buffer.concat([header, body]));
    });
  }

  private consume(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.responseBuffer === null) {
        const count = Math.min(4 - this.headerOffset, chunk.length - offset);
        chunk.copy(this.header, this.headerOffset, offset, offset + count);
        this.headerOffset += count;
        offset += count;
        if (this.headerOffset < 4) return;
        const length = this.header.readUInt32BE(0);
        this.headerOffset = 0;
        if (length > MAX_RESPONSE_BYTES) {
          this.rejectAll(new Error("UE 编辑器响应超过大小限制"));
          this.socket.destroy();
          return;
        }
        // Allocate once per frame, instead of copying the accumulated body per packet.
        this.responseBuffer = Buffer.allocUnsafe(length);
        this.responseOffset = 0;
      }
      const count = Math.min(
        this.responseBuffer.length - this.responseOffset,
        chunk.length - offset,
      );
      chunk.copy(this.responseBuffer, this.responseOffset, offset, offset + count);
      this.responseOffset += count;
      offset += count;
      if (this.responseOffset < this.responseBuffer.length) return;
      const payload = this.responseBuffer;
      this.responseBuffer = null;
      this.responseOffset = 0;
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
    // #region debug-point B-D:ue-connection-failure
    if (process.env.DEBUG_SESSION_ID === "ue-search-compact-crash" && this.waiters.length > 0) void fetch(process.env.DEBUG_SERVER_URL || "http://127.0.0.1:7777/event", { method: "POST", signal: AbortSignal.timeout(750), body: JSON.stringify({ sessionId: "ue-search-compact-crash", runId: process.env.DEBUG_RUN_ID || "pre-fix", hypothesisId: "B-D", location: "server/ue/transport.ts:rejectAll", msg: "[DEBUG] UE pending requests rejected", ts: Date.now(), data: { connectionPort: this.socket.localPort, pendingOnConnection: this.waiters.length, socketState: this.socket.readyState, error: error.message.slice(0, 200) } }) }).catch(() => {});
    // #endregion
    this.responseBuffer = null;
    this.responseOffset = 0;
    this.headerOffset = 0;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}
