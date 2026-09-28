import { expect, it, vi } from "vitest";
import { PersistentDialogueSelectionReader } from "./dialogueSelection";

it("discards the previous legacy selection on resume without exceeding the reflection cadence", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  let selected = 734219;
  const invoke = vi.fn(async (action: string, args: Record<string, unknown>) => {
    if (action === "script.eval_python_expression") return {
      bSuccess: true, Result: JSON.stringify(["/Game/734200.734200", "1"]),
    };
    if (action === "editor.get_editor_subsystem") return "Subsystem";
    if (args.PropertyName === "CurrentDialogGraphSelectionCount") return 1;
    if (args.PropertyName === "CurrentSelectedDialogNode") return "Node";
    if (args.PropertyName === "DialogGraphNodeData") return "Data";
    if (args.PropertyName === "CommonDialogGraphProperties") return [{ Alias: "id", CurrentUint32: selected }];
    return [];
  });
  const reader = new PersistentDialogueSelectionReader(() => ({
    connect: async () => {}, close: () => {}, invoke,
  }), 15_000);
  try {
    expect((await reader.read()).dialogueNodeId).toBe("734219");
    selected = 734220;
    vi.setSystemTime(11_200);
    expect((await reader.read(true)).dialogueNodeId).toBeNull();
    expect((await reader.read(true)).dialogueNodeId).toBeNull();
    expect(invoke.mock.calls.filter(([, args]) => args.PropertyName === "CommonDialogGraphProperties")).toHaveLength(1);
    vi.setSystemTime(14_800);
    expect((await reader.read()).dialogueNodeId).toBe("734220");
    expect(invoke.mock.calls.filter(([, args]) => args.PropertyName === "CommonDialogGraphProperties")).toHaveLength(2);
  } finally {
    reader.dispose();
    vi.useRealTimers();
  }
});
