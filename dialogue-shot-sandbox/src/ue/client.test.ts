import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissionTargetPreviewPlan } from "../types";
import { refreshMissionTargetPlan } from "./client";

afterEach(() => {
  vi.restoreAllMocks();
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
