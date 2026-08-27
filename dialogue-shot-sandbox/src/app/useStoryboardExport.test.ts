import { describe, expect, it } from "vitest";
import { getStoryboardExportAvailability } from "./useStoryboardExport";

const blueprintParticipant = {
  name: "玩家",
  positionSource: "blueprint" as const,
  modelIndex: 0,
};

describe("storyboard export availability", () => {
  it("explains each condition that prevents exporting", () => {
    expect(getStoryboardExportAvailability(0, [])).toMatchObject({
      canExport: false,
      buttonLabel: "请先生成分镜",
    });
    expect(
      getStoryboardExportAvailability(1, [blueprintParticipant]),
    ).toMatchObject({
      canExport: false,
      buttonLabel: "至少需要 2 位角色",
    });
    expect(
      getStoryboardExportAvailability(1, [
        blueprintParticipant,
        {
          name: "守卫",
          positionSource: "generated",
          modelIndex: null,
        },
      ]),
    ).toEqual({
      canExport: false,
      buttonLabel: "需绑定 BP 站位",
      unavailableReason: "守卫 未绑定 UE Blueprint 站位",
    });
    expect(
      getStoryboardExportAvailability(1, [
        blueprintParticipant,
        {
          name: "守卫",
          positionSource: "blueprint",
          modelIndex: null,
        },
      ]),
    ).toEqual({
      canExport: false,
      buttonLabel: "BP 角色槽不完整",
      unavailableReason: "守卫 缺少 UE Blueprint 模型槽编号",
    });
  });

  it("allows a generated shot when every participant is bound to a BP slot", () => {
    expect(
      getStoryboardExportAvailability(2, [
        blueprintParticipant,
        {
          name: "守卫",
          positionSource: "blueprint",
          modelIndex: 1,
        },
      ]),
    ).toEqual({
      canExport: true,
      buttonLabel: "导出到 UE",
      unavailableReason: "",
    });
  });
});
