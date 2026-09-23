import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedAdvisorResult } from "./advisorCache";

afterEach(() => vi.restoreAllMocks());

describe("advisor inference cache", () => {
  it("reuses successful output without allowing caller mutation", async () => {
    const work = vi.fn(async () => ({ scores: [85] }));
    const first = await cachedAdvisorResult("clone", work);
    first.scores[0] = 0;
    expect(await cachedAdvisorResult("clone", work)).toEqual({ scores: [85] });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("invalidates on prompt, image, model or settings changes and supports bypass", async () => {
    const work = vi.fn(async () => 85);
    const key = { prompt: "turn", image: "frame", model: "qwen", temperature: 0.1 };
    await cachedAdvisorResult(key, work);
    for (const change of [
      { prompt: "reveal" }, { image: "moved" }, { model: "other" }, { temperature: 0.2 },
    ]) await cachedAdvisorResult({ ...key, ...change }, work);
    await cachedAdvisorResult(key, work, undefined, true);
    expect(work).toHaveBeenCalledTimes(6);
  });

  it("expires old results and bounds retained entries", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const work = vi.fn(async () => "ok");
    await cachedAdvisorResult("ttl", work);
    now.mockReturnValue(1000 + 16 * 60_000);
    await cachedAdvisorResult("ttl", work);
    for (let i = 0; i < 256; i++) await cachedAdvisorResult(`evict-${i}`, async () => i);
    await cachedAdvisorResult("ttl", work);
    expect(work).toHaveBeenCalledTimes(3);
  });

  it("does not cache failures or late success after cancellation", async () => {
    const work = vi.fn(async () => { throw new Error("invalid output"); });
    await expect(cachedAdvisorResult("failed", work)).rejects.toThrow("invalid output");
    await expect(cachedAdvisorResult("failed", work)).rejects.toThrow("invalid output");
    expect(work).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    await expect(cachedAdvisorResult("aborted", async () => {
      controller.abort();
      return 1;
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(await cachedAdvisorResult("aborted", async () => 2)).toBe(2);
    await expect(cachedAdvisorResult("aborted", async () => 3, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
