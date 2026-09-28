import { describe, expect, it } from "vitest";
import { classifyConfigurationWindow } from "./configurationActivity";

describe("configuration foreground detection", () => {
  it("requires both a UE process and an exact dialogue caption", () => {
    const window = { processId: 42, processName: "UE4Editor", title: "526700*" };
    expect(classifyConfigurationWindow(window).state).toBe("dialogue");
    expect(classifyConfigurationWindow({ ...window, processName: "notepad" }).state).toBe("other");
    expect(classifyConfigurationWindow({ ...window, title: "BP_526700" }).state).toBe("unknown");
    expect(classifyConfigurationWindow({ ...window, title: "ABP_N113_Ratking_withWheelchair" }).state).toBe("unknown");
    expect(classifyConfigurationWindow({ ...window, title: "Seria - 虚幻编辑器" }).state).toBe("unknown");
    expect(classifyConfigurationWindow({ ...window, title: "" }).state).toBe("unknown");
  });

  it("accepts explicit dialogue editor captions without treating other editors as active", () => {
    const window = { processId: 42, processName: "UE4Editor", title: "Seria对话编辑器" };
    expect(classifyConfigurationWindow(window).state).toBe("dialogue");
    expect(classifyConfigurationWindow({ ...window, title: "Dialogue Editor - 526700" }).state).toBe("dialogue");
    expect(classifyConfigurationWindow({ ...window, title: "Blueprint Editor - 526700" }).state).toBe("unknown");
  });
});
