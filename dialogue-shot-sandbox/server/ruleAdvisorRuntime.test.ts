import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadRuleAdvisorModel,
  inspectRuleAdvisorModel,
  releaseIdleRuleAdvisorResourcesNow,
  releaseRuleAdvisorResources,
  retainRuleAdvisorResources,
  ruleAdvisorKeepAlive,
  stopManagedRuleAdvisorRuntime,
} from "./ruleAdvisorRuntime";

afterEach(() => {
  stopManagedRuleAdvisorRuntime();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("rule advisor runtime", () => {
  it("reports a missing runtime when Ollama is unavailable", async () => {
    vi.stubEnv("LOCALAPPDATA", "Z:\\missing-ollama");
    vi.stubEnv("RULE_ADVISOR_RUNTIME_PATH", "");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(inspectRuleAdvisorModel()).resolves.toMatchObject({
      state: "missing_runtime",
      runtimeAvailable: false,
      modelInstalled: false,
    });
  });

  it("distinguishes a running service without the configured model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        return url.endsWith("/api/version")
          ? new Response("{}", { status: 200 })
          : Response.json({ models: [] });
      }),
    );

    await expect(inspectRuleAdvisorModel()).resolves.toMatchObject({
      state: "missing_model",
      runtimeAvailable: true,
      serviceAvailable: true,
      modelInstalled: false,
    });
  });

  it("reports the configured model as ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        return url.endsWith("/api/version")
          ? new Response("{}", { status: 200 })
          : Response.json({ models: [{ name: "qwen3-vl:4b" }] });
      }),
    );

    await expect(inspectRuleAdvisorModel()).resolves.toMatchObject({
      state: "ready",
      model: "qwen3-vl:4b",
      modelInstalled: true,
    });
  });

  it("streams model download progress and verifies installation", async () => {
    let tagRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/version")) {
          return new Response("{}", { status: 200 });
        }
        if (url.endsWith("/api/tags")) {
          tagRequests += 1;
          return Response.json({
            models:
              tagRequests === 1 ? [] : [{ model: "qwen3-vl:4b" }],
          });
        }
        if (url.endsWith("/api/pull")) {
          return new Response(
            [
              '{"status":"pulling manifest"}',
              '{"status":"downloading","completed":50,"total":100}',
              '{"status":"success","completed":100,"total":100}',
              "",
            ].join("\n"),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );
    const progress: number[] = [];

    const result = await downloadRuleAdvisorModel({
      onProgress: (snapshot) => progress.push(snapshot.percent ?? 0),
    });

    expect(progress).toEqual([0, 0, 50, 100]);
    expect(result).toMatchObject({
      state: "ready",
      percent: 100,
      modelInstalled: true,
    });
  });

  it("unloads the model after the last resource lease becomes idle", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RULE_ADVISOR_MODEL_IDLE_MS", "25");
    vi.stubEnv("RULE_ADVISOR_RUNTIME_IDLE_MS", "1000");
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response("{}", { status: 200 });
      }),
    );

    retainRuleAdvisorResources();
    expect(ruleAdvisorKeepAlive()).toBe("1s");
    releaseRuleAdvisorResources();
    await vi.advanceTimersByTimeAsync(24);
    expect(requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:11434/api/generate",
        body: {
          model: "qwen3-vl:4b",
          keep_alive: 0,
          stream: false,
        },
      },
    ]);
  });

  it("cancels a pending unload when a new inference lease starts", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RULE_ADVISOR_MODEL_IDLE_MS", "10");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    retainRuleAdvisorResources();
    releaseRuleAdvisorResources();
    await vi.advanceTimersByTimeAsync(5);
    retainRuleAdvisorResources();
    await vi.advanceTimersByTimeAsync(20);
    expect(fetchMock).not.toHaveBeenCalled();
    releaseRuleAdvisorResources();
  });

  it("releases an idle model immediately without interrupting active inference", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    retainRuleAdvisorResources();
    await expect(releaseIdleRuleAdvisorResourcesNow()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    releaseRuleAdvisorResources();
    await expect(releaseIdleRuleAdvisorResourcesNow()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/generate",
      expect.objectContaining({
        body: JSON.stringify({
          model: "qwen3-vl:4b",
          keep_alive: 0,
          stream: false,
        }),
      }),
    );
  });
});
