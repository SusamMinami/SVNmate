import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissionTargetPreviewPlan } from "../types";
import { getBlueprintFormation, refreshMissionTargetPlan } from "./client";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getBlueprintFormation", () => {
  it("keeps waiting when a complex Blueprint takes longer than ten seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve(
                new Response(
                  JSON.stringify({
                    ok: true,
                    data: {
                      status: "not_found",
                      message: "未找到测试 BP",
                    },
                  }),
                  {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                  },
                ),
              ),
            11_000,
          );
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const lookup = getBlueprintFormation({
      dialogueId: "7350",
      startId: "735000",
    });
    await vi.advanceTimersByTimeAsync(11_000);

    await expect(lookup).resolves.toMatchObject({
      status: "not_found",
      message: "未找到测试 BP",
    });
  });
});

describe("refreshMissionTargetPlan", () => {
  it("requests a freshly resolved task plan from the server", async () => {
    const plan: MissionTargetPreviewPlan = {
      taskId: "900001",
      taskName: "测试任务",
      taskSource: "任务表",
      mapId: "1204",
      mapName: "测试地图",
      mapAssetPath: "/Game/Test/Maps/TestMap",
      targets: [],
      warnings: [],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: plan }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(refreshMissionTargetPlan("900001")).resolves.toEqual(plan);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "/api/ue/mission-targets/resolve",
    );
    expect(
      JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)),
    ).toEqual({ taskId: "900001" });
  });
});
