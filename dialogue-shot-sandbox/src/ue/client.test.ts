import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissionTargetPreviewPlan } from "../types";
import {
  applyDialogNpcTableRegistration,
  getBlueprintFormation,
  inspectDialogNpcTableRegistration,
  refreshMissionTargetPlan,
} from "./client";

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

describe("DialogNPCTable registration client", () => {
  it("sends inspect and apply requests without automatic retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            reviewToken: "a".repeat(64),
            tableAssetPath: "/Game/Seria/Task/Mod/DialogNPCTable",
            rows: [],
            cameraClassPaths: [],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await inspectDialogNpcTableRegistration([
      {
        modelIndex: 1,
        targetId: "500001",
        modelClassPath: "/Game/Test/BP_New.BP_New_C",
      },
    ]);

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "/api/ue/mission-targets/dialog-npc-table/inspect",
    );
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      slots: [
        {
          modelIndex: 1,
          targetId: "500001",
          modelClassPath: "/Game/Test/BP_New.BP_New_C",
        },
      ],
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            status: "registered",
            tableAssetPath: "/Game/Seria/Task/Mod/DialogNPCTable",
            registeredRowNames: ["New"],
            saved: true,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await applyDialogNpcTableRegistration("a".repeat(64), [
      {
        rowName: "New",
        characterClassPath: "/Game/Test/BP_New.BP_New_C",
        animClassPath: "/Game/Test/ABP_New.ABP_New_C",
        cameraClassPath: "/Game/Test/Camera_New.Camera_New_C",
        meshPath: "/Game/Test/SK_New.SK_New",
      },
    ]);

    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      "/api/ue/mission-targets/dialog-npc-table/apply",
    );
    expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))).toEqual({
      reviewToken: "a".repeat(64),
      rows: [
        {
          rowName: "New",
          characterClassPath: "/Game/Test/BP_New.BP_New_C",
          animClassPath: "/Game/Test/ABP_New.ABP_New_C",
          cameraClassPath: "/Game/Test/Camera_New.Camera_New_C",
          meshPath: "/Game/Test/SK_New.SK_New",
        },
      ],
    });
  });
});
