import { describe, expect, it } from "vitest";
import type { BlueprintMontageAction } from "../types";
import {
  matchingMontageActions,
  montageActionWindow,
} from "./CharacterActionEditor";

const actions: BlueprintMontageAction[] = Array.from(
  { length: 19 },
  (_, index) => ({
    name: `AM_Action_${String(index + 1).padStart(2, "0")}`,
    assetPath: `/Game/Animations/Group_${Math.floor(index / 5)}/AM_Action_${String(index + 1).padStart(2, "0")}`,
  }),
);

describe("montageActionWindow", () => {
  it("moves through the complete catalog while rendering at most eight options", () => {
    expect(montageActionWindow(actions, 0)).toMatchObject({
      total: 19,
      start: 0,
      visible: actions.slice(0, 8),
    });
    expect(montageActionWindow(actions, 8)).toMatchObject({
      total: 19,
      start: 8,
      visible: actions.slice(8, 16),
    });
    expect(montageActionWindow(actions, 16)).toMatchObject({
      total: 19,
      start: 11,
      visible: actions.slice(11),
    });
  });

  it("filters by montage name or asset path and clamps stale windows", () => {
    const nameMatches = matchingMontageActions(actions, "action_1");
    expect(montageActionWindow(nameMatches, 16)).toMatchObject({
      total: 10,
      start: 2,
      visible: actions.slice(11, 19),
    });
    expect(
      matchingMontageActions(actions, "group_2 action_12"),
    ).toEqual([actions[11]]);
  });
});
