import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ socket: null as unknown }));
vi.mock("node:net", () => ({
  default: {
    Socket: class extends EventEmitter {
      destroyed = false;
      readyState = "open";
      write = vi.fn();
      constructor() {
        super();
        state.socket = this;
      }
      connect() { queueMicrotask(() => this.emit("connect")); }
      destroy() { this.destroyed = true; this.emit("close"); }
      end() { this.destroy(); }
    },
  },
}));
import { UnrealMcpConnection } from "./transport";

function socket() {
  return state.socket as EventEmitter & { destroyed: boolean };
}

function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("UnrealMcpConnection response lifecycle", () => {
  it("decodes split headers, UTF-8 bodies and coalesced FIFO responses", async () => {
    const connection = new UnrealMcpConnection();
    await connection.connect();
    const first = connection.invoke("first", {});
    const second = connection.invoke("second", {});
    const bytes = Buffer.concat([
      frame({ Value: "角色相机" }),
      frame({ Output: { ReturnValue: false } }),
    ]);
    for (const byte of bytes) socket().emit("data", Buffer.from([byte]));
    await expect(first).resolves.toBe("角色相机");
    await expect(second).resolves.toBe(false);
    connection.close();
  });

  it("assembles a large fragmented body without concatenating partial responses", async () => {
    const connection = new UnrealMcpConnection();
    await connection.connect();
    const response = connection.invoke("large", {});
    const value = "x".repeat(1024 * 1024);
    const bytes = frame({ Value: value });
    const concat = vi.spyOn(Buffer, "concat");
    for (let offset = 0; offset < bytes.length; offset += 1024) {
      socket().emit("data", bytes.subarray(offset, offset + 1024));
    }
    await expect(response).resolves.toBe(value);
    expect(concat).not.toHaveBeenCalled();
    connection.close();
  });

  it("rejects oversized frames and all pending requests", async () => {
    const connection = new UnrealMcpConnection();
    await connection.connect();
    const results = Promise.allSettled([
      connection.invoke("first", {}), connection.invoke("second", {}),
    ]);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(16 * 1024 * 1024 + 1);
    socket().emit("data", header);
    expect((await results).every((result) => result.status === "rejected")).toBe(true);
    expect(socket().destroyed).toBe(true);
  });

  it("reports malformed JSON without losing the next frame", async () => {
    const connection = new UnrealMcpConnection();
    await connection.connect();
    const first = connection.invoke("first", {});
    const second = connection.invoke("second", {});
    const header = Buffer.alloc(4);
    header.writeUInt32BE(1);
    socket().emit("data", Buffer.concat([header, Buffer.from("{"), frame({ Value: 42 })]));
    await expect(first).rejects.toThrow("无效 JSON");
    await expect(second).resolves.toBe(42);
    connection.close();
  });

  it("releases pending requests and timers on explicit close", async () => {
    vi.useFakeTimers();
    const connection = new UnrealMcpConnection();
    await connection.connect();
    const response = connection.invoke("pending", {});
    connection.close();
    await expect(response).rejects.toThrow("连接已关闭");
    await expect(connection.invoke("after-close", {})).rejects.toThrow("连接已关闭");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes the connection on timeout so late frames cannot match another request", async () => {
    vi.useFakeTimers();
    const connection = new UnrealMcpConnection();
    await connection.connect();
    const results = Promise.allSettled([
      connection.invoke("slow", {}, { timeoutMs: 100 }),
      connection.invoke("next", {}),
    ]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await results).every((result) => result.status === "rejected")).toBe(true);
    expect(socket().destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
