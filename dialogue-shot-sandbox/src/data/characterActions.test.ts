import { describe, expect, it } from "vitest";
import {
  behaviourTypeForMontageName,
  turnDegreesFromMontageName,
} from "./characterActions";

describe("character actions", () => {
  it("maps AM_Turn actions to ERotate and signed yaw deltas", () => {
    expect(behaviourTypeForMontageName("AM_TurnRight45")).toBe("ERotate");
    expect(turnDegreesFromMontageName("AM_TurnRight45")).toBe(45);
    expect(turnDegreesFromMontageName("AM_TurnLeft160")).toBe(-160);
    expect(turnDegreesFromMontageName("AM_TurnRight90_Bird")).toBe(90);
  });

  it("keeps other Montage names as ordinary actions", () => {
    expect(behaviourTypeForMontageName("AM_Wave")).toBe("ENone");
    expect(turnDegreesFromMontageName("AM_Wave")).toBeNull();
  });
});
