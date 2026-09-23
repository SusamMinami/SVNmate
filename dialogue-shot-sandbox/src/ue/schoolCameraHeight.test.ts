import { describe, expect, it } from "vitest";
import {
  adaptSchoolCameraMovesForHeight,
  schoolCameraHeightDeltaCm,
} from "./schoolCameraHeight";

function pushMove(startZ: number, endZ: number) {
  return {
    CameraMoveType: "EPush",
    PushCameraArg: {
      bRelative: true,
      Velocity: 2.5,
      StartPoint: { X: 120, Y: -30, Z: startZ },
      EndPoint: { X: 180, Y: -10, Z: endZ },
      StartRotation: { Pitch: -8, Yaw: 25, Roll: 1 },
      EndRotation: { Pitch: -6, Yaw: 30, Roll: 1 },
      BlendOutTime: 1.25,
    },
    FOV: 52,
    FutureField: { preserved: true },
  };
}

describe("school camera height adaptation", () => {
  it("uses fixed player capsule-height groups", () => {
    expect(schoolCameraHeightDeltaCm("ENone", "ERing")).toBe(-13);
    expect(schoolCameraHeightDeltaCm("ENone", "ENino")).toBe(-13);
    expect(schoolCameraHeightDeltaCm("ENone", "EJodie")).toBe(-24);
    expect(schoolCameraHeightDeltaCm("ERing", "ENino")).toBe(0);
    expect(schoolCameraHeightDeltaCm("EJodie", "ERing")).toBe(11);
  });

  it("shifts every EPush start and end Z without changing other fields", () => {
    const source = [pushMove(160, 175), pushMove(90.5, 94.25)];

    const adjusted = adaptSchoolCameraMovesForHeight(
      source,
      "ENone",
      "ERing",
    );

    expect(adjusted).toEqual([
      {
        ...source[0],
        PushCameraArg: {
          ...source[0].PushCameraArg,
          StartPoint: { X: 120, Y: -30, Z: 147 },
          EndPoint: { X: 180, Y: -10, Z: 162 },
        },
      },
      {
        ...source[1],
        PushCameraArg: {
          ...source[1].PushCameraArg,
          StartPoint: { X: 120, Y: -30, Z: 77.5 },
          EndPoint: { X: 180, Y: -10, Z: 81.25 },
        },
      },
    ]);
    expect(source[0].PushCameraArg.StartPoint.Z).toBe(160);
  });

  it("preserves unsupported movement types and rejects malformed EPush Z", () => {
    const rotate = {
      CameraMoveType: "ERotate",
      RotateCameraArg: { CameraName: "c_ring", RotationSpeed: 1.25 },
    };
    expect(
      adaptSchoolCameraMovesForHeight([rotate], "ENone", "ERing"),
    ).toEqual([rotate]);

    const invalid = pushMove(160, 175);
    invalid.PushCameraArg.EndPoint.Z = Number.NaN;
    expect(() =>
      adaptSchoolCameraMovesForHeight([invalid], "ENone", "ENino"),
    ).toThrow("EndPoint.Z 必须是有限数值");
  });
});
