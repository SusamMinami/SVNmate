import { describe, expect, it, vi } from "vitest";
import { readSceneReference } from "./sceneReference";

const request = {
  dialogueId: "2048", startId: "204800", formationClassPath: "/Game/Test.BP_C",
  stageOrigin: [0, 0, 0], radiusMeters: 20,
};
const root = {
  id: "/Game/Maps/Test.Test:PersistentLevel.Formation_1", label: "Formation_1",
  source: "selected_actor", transform: {
    location: { x: 1000, y: 2000, z: 0 }, rotation: { pitch: 0, yaw: 90, roll: 0 },
    scale: { x: 1, y: 1, z: 1 },
  },
};
function bridge(candidates = [root], truncated = false) {
  return {
    connect: vi.fn().mockResolvedValue(undefined), close: vi.fn(),
    invoke: vi.fn().mockImplementation(async (_name: string, args: { Expression: string }) => ({
      bSuccess: true,
      Result: JSON.stringify(args.Expression.includes("class_path =") ? {
        mapPath: "/Game/Maps/Test", candidates, truncated: false,
      } : {
        objects: [{ id: "component:4", label: "Fence [4]", assetPath: "/Game/Fence.Fence", kind: "mesh_instance", center: [1000, 2100, 0], extent: [10, 20, 30] }],
        truncated, skipped: 1,
      }),
    })),
  };
}
const noMetadata = async () => { throw new Error("动态玩家落点"); };

describe("read-only scene reference service", () => {
  it("lists candidates without collecting geometry before confirmation", async () => {
    const connection = bridge();
    const result = await readSceneReference(request, () => connection, noMetadata);
    expect(result.snapshot).toBeUndefined();
    expect(result.inspection.candidates).toHaveLength(1);
    expect(connection.invoke).toHaveBeenCalledTimes(1);
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it("captures instance bounds, tracks omissions and converts into stage coordinates", async () => {
    const connection = bridge([root], true);
    const inspected = await readSceneReference(request, () => connection, noMetadata);
    const result = await readSceneReference({
      ...request, anchorId: root.id, inspectionFingerprint: inspected.inspection.fingerprint,
    }, () => connection, noMetadata);
    expect(result.snapshot?.objects[0].center[2]).toBeCloseTo(-1);
    expect(result.snapshot?.objects[0].size[0]).toBeCloseTo(0.2);
    expect(result.snapshot?.truncated).toBe(true);
    expect(result.snapshot?.shareWithDirector).toBe(false);
    expect(result.snapshot?.warnings.join(" ")).toContain("已跳过");
    const script = connection.invoke.mock.calls.at(-1)![1].Expression;
    expect(script).toContain("get_instance_transform");
    expect(script).not.toMatch(/spawn_actor|save_asset|load_level|set_actor/);
  });

  it("rejects an anchor or scan-radius change after inspection", async () => {
    const connection = bridge();
    const inspected = await readSceneReference(request, () => connection, noMetadata);
    await expect(readSceneReference({
      ...request, radiusMeters: 30, anchorId: root.id, inspectionFingerprint: inspected.inspection.fingerprint,
    }, () => connection, noMetadata)).rejects.toThrow("重新读取");
    expect(connection.invoke).toHaveBeenCalledTimes(2);
  });

  it("does not offer metadata in a different map and never guesses a nearest instance", async () => {
    const connection = bridge([root, { ...root, id: "other", label: "other", source: "level_actor" }]);
    const result = await readSceneReference(request, () => connection, async () => ({
      mapPath: "/Game/Maps/Other", transform: root.transform,
    }));
    expect(result.inspection.candidates).toHaveLength(2);
    expect(result.snapshot).toBeUndefined();
    expect(result.inspection.warnings.join(" ")).toContain("不会自动切图");
  });

  it("allows explicitly configured metadata in the current map", async () => {
    const result = await readSceneReference(request, () => bridge([]), async () => ({
      mapPath: "/Game/Maps/Test", transform: root.transform,
    }));
    expect(result.inspection.candidates[0].source).toBe("dialogue_metadata");
  });

  it("blocks unsupported root scale and closes a failed connection", async () => {
    const scaled = { ...root, transform: { ...root.transform, scale: { x: 2, y: 1, z: 1 } } };
    const connection = bridge([scaled]);
    const inspected = await readSceneReference(request, () => connection, noMetadata);
    await expect(readSceneReference({
      ...request, anchorId: root.id, inspectionFingerprint: inspected.inspection.fingerprint,
    }, () => connection, noMetadata)).rejects.toThrow("单位缩放");
    connection.connect.mockRejectedValueOnce(new Error("offline"));
    await expect(readSceneReference(request, () => connection, noMetadata)).rejects.toThrow("offline");
    expect(connection.close).toHaveBeenCalledTimes(3);
  });
});
