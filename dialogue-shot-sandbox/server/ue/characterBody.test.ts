import { describe, expect, it, vi } from "vitest";
import type { BlueprintFormationSlot } from "../../src/types";
import { readCharacterBodies } from "./characterBody";

function slot(index = 0): BlueprintFormationSlot {
  return {
    modelIndex: index, componentName: "/Game/Test.Default__BP:Slot",
    componentGuid: "test", modelClassPath: "/Game/Test.BP_C",
    transform: {
      location: { x: 100, y: 200, z: 90 },
      rotation: { pitch: 0, yaw: 90, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function connection(rows: unknown) {
  return {
    connect: vi.fn(), close: vi.fn(),
    invoke: vi.fn().mockResolvedValue({ bSuccess: true, Result: JSON.stringify(rows) }),
  };
}

const bounds = { modelIndex: 0, meshPath: "/Game/Body.Body", min: [-20, -30, -90], max: [20, 30, 90], error: "" };

describe("readCharacterBodies", () => {
  it("converts actor-space centimetres and applies slot scaling exactly once", async () => {
    const actor = slot();
    actor.transform.scale = { x: 2, y: 1, z: 0.5 };
    const bridge = connection([bounds]);
    expect(await readCharacterBodies(bridge, [actor])).toEqual([]);
    expect(actor.bodyProfile).toMatchObject({
      height: 0.9, width: 0.6, depth: 0.8, source: "mesh_bounds",
      footOffset: [0, -0.45, -0], landmarkSource: "proportional",
    });
    expect(actor.transform.location.z).toBe(90);
    expect(bridge.invoke).toHaveBeenCalledOnce();
    expect(bridge.invoke.mock.calls[0][0]).toBe("script.eval_python_expression");
    expect(bridge.invoke.mock.calls[0][1].Expression).not.toContain("spawn_actor");
  });

  it("handles mirrored scale without producing negative dimensions", async () => {
    const actor = slot();
    actor.transform.scale = { x: -1, y: -1, z: -1 };
    await readCharacterBodies(connection([{ ...bounds, min: [10, 20, -90], max: [50, 80, 90] }]), [actor]);
    expect(actor.bodyProfile).toMatchObject({ height: 1.8, width: 0.6, depth: 0.4 });
    expect(actor.bodyProfile!.footOffset).toEqual([-0.5, -0.9, 0.3]);
  });

  it("keeps successful slots when another mesh cannot be read", async () => {
    const actors = [slot(), slot(1)];
    const warnings = await readCharacterBodies(connection([
      bounds, { ...bounds, modelIndex: 1, error: "missing mesh" },
    ]), actors);
    expect(actors[0].bodyProfile?.height).toBe(1.8);
    expect(actors[1].bodyProfile).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("missing mesh");
  });

  it("reports degenerate bounds and does not accept malformed bridge output", async () => {
    const actor = slot();
    const warnings = await readCharacterBodies(connection([{ ...bounds, max: bounds.min }]), [actor]);
    expect(warnings).toHaveLength(1);
    expect(actor.bodyProfile).toBeUndefined();
    await expect(readCharacterBodies(connection({}), [actor])).rejects.toThrow();
  });
});
