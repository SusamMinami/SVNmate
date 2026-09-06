import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadRuleAdvisorModel,
  inspectRuleAdvisorModel,
} from "./ruleAdvisorRuntime";

afterEach(() => {
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
});
