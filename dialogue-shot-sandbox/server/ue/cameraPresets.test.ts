import { describe, expect, it, vi } from "vitest";
import { cameraMoveFromPreset, captureDialogueCameraPresets } from "./cameraPresets";
import { buildDefaultDialogueCameraMove } from "../ueBridge";
import type { UnrealInvoker } from "./transport";

const camera = {
  name: "3", label: "3 | +25 deg", componentPath: "/Preview/Role.3",
  local: { position: { X: 110, Y: 240, Z: 175 }, rotation: { Pitch: -6, Yaw: 145, Roll: 3 } },
  world: { position: { X: 2040, Y: -110, Z: 200 }, rotation: { Pitch: -6, Yaw: -125, Roll: 3 } },
};
const snapshot = {
  formationActorPath: "/Temp/Preview:PersistentLevel.Formation",
  formationClassPath: "/Game/Test/BP_Form.BP_Form_C",
  roles: [{
    modelIndex: 0, label: "Player", actorPath: "/Preview/Role",
    cameraClassPath: "/Game/Test/Camera.Camera_C", cameras: [camera],
  }],
};
function connectionWith(result: unknown): UnrealInvoker {
  return { connect: vi.fn(), close: vi.fn(), invoke: vi.fn(async () => result) };
}

describe("cameraMoveFromPreset", () => {
  it("uses existing defaults for a new camera, not the Camera BP lens settings", () => {
    const defaults = buildDefaultDialogueCameraMove();
    expect(cameraMoveFromPreset([], defaults, camera)).toEqual([{
      ...defaults,
      PushCameraArg: {
        ...defaults.PushCameraArg as object,
        StartPoint: camera.local.position, EndPoint: camera.local.position,
        StartRotation: camera.local.rotation, EndRotation: camera.local.rotation,
      },
    }]);
    expect(defaults).toEqual(buildDefaultDialogueCameraMove());
  });

  it.each([true, false])("replaces only pose fields while preserving relative=%s and all user settings", (relative) => {
    const defaults = buildDefaultDialogueCameraMove();
    const before = {
      ...defaults,
      FOV: 51.25,
      CustomFutureSetting: { preserved: true },
      PushCameraArg: {
        ...defaults.PushCameraArg as object,
        bRelative: relative, BlendOutTime: 2.75, Velocity: 8.5, bWaitOptionShow: true,
      },
    };
    const input = structuredClone(before);
    const pose = relative ? camera.local : camera.world;
    const [result] = cameraMoveFromPreset([input], defaults, camera);
    expect(result).toEqual({
      ...before,
      PushCameraArg: {
        ...before.PushCameraArg,
        StartPoint: pose.position, EndPoint: pose.position,
        StartRotation: pose.rotation, EndRotation: pose.rotation,
      },
    });
    expect(input).toEqual(before);
    expect(result.PushCameraArg).not.toBe(input.PushCameraArg);
  });

  it("preserves zero FOV override, zero velocity and zero blend time", () => {
    const base = buildDefaultDialogueCameraMove();
    const [result] = cameraMoveFromPreset([{
      ...base, FOV: 0,
      PushCameraArg: { ...base.PushCameraArg as object, Velocity: 0, BlendOutTime: 0 },
    }], base, camera);
    expect(result).toMatchObject({ FOV: 0, PushCameraArg: { Velocity: 0, BlendOutTime: 0 } });
  });

  it("refuses multiple moves instead of discarding animation segments", () => {
    const move = buildDefaultDialogueCameraMove();
    expect(() => cameraMoveFromPreset([move, move], move, camera)).toThrow("多段");
  });

  it.each([
    [{ CameraMoveType: "ERotate" }, "不是 EPush"],
    [{ CameraMoveType: "EPush" }, "不完整"],
    [{ CameraMoveType: "EPush", PushCameraArg: {} }, "坐标空间"],
  ])("refuses unsupported/incomplete moves: %j", (move, reason) => {
    expect(() => cameraMoveFromPreset([move], buildDefaultDialogueCameraMove(), camera)).toThrow(String(reason));
  });
});

describe("captureDialogueCameraPresets", () => {
  it("uses one read-only invocation and binds the fingerprint to node and effective pose", async () => {
    const connection = connectionWith({ bSuccess: true, Result: `'${JSON.stringify(snapshot)}'` });
    const first = await captureDialogueCameraPresets(connection, snapshot.formationClassPath, "735201");
    expect(first).toMatchObject({ ...snapshot, dialogueNodeId: "735201", fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(connection.invoke).toHaveBeenCalledTimes(1);
    expect(connection.invoke).toHaveBeenCalledWith("script.eval_python_expression", expect.any(Object));
    const again = await captureDialogueCameraPresets(connection, snapshot.formationClassPath, "735201");
    expect(again.fingerprint).toBe(first.fingerprint);
    const otherNode = await captureDialogueCameraPresets(connection, snapshot.formationClassPath, "735202");
    expect(otherNode.fingerprint).not.toBe(first.fingerprint);
    const moved = structuredClone(snapshot);
    moved.roles[0].cameras[0].local.position.X += 1;
    const changed = await captureDialogueCameraPresets(
      connectionWith({ bSuccess: true, Result: JSON.stringify(moved) }), snapshot.formationClassPath, "735201",
    );
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it("propagates missing-preview errors without a guessed transform", async () => {
    await expect(captureDialogueCameraPresets(
      connectionWith({ bSuccess: false, Message: "No preview" }), snapshot.formationClassPath, "735201",
    )).rejects.toThrow("No preview");
  });

  it("refuses an absent Formation before invoking UE", async () => {
    const connection = connectionWith({});
    await expect(captureDialogueCameraPresets(connection, "", "735201")).rejects.toThrow("Formation");
    expect(connection.invoke).not.toHaveBeenCalled();
  });

  it.each(["role", "camera"])("rejects ambiguous %s identities", async (kind) => {
    const ambiguous = structuredClone(snapshot);
    if (kind === "role") ambiguous.roles.push(structuredClone(ambiguous.roles[0]));
    else ambiguous.roles[0].cameras.push(structuredClone(camera));
    await expect(captureDialogueCameraPresets(
      connectionWith({ bSuccess: true, Result: JSON.stringify(ambiguous) }), snapshot.formationClassPath, "735201",
    )).rejects.toThrow("编号重复");
  });
});
