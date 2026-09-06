import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import { createShotPlan } from "./shotPlanner";
import { projectionIssues, projectionStatus, projectionStatusLabel } from "./shotValidation";

describe("projection status", () => {
  const base = createShotPlan(findDialogueSequence(demoDatabase, "2048"))[0].projection;
  it("distinguishes advice, informational changes and hard failures", () => {
    const warning = { ...base, valid: true, issues: [{ ruleId: "CON-003", severity: "warning" as const, message: "cut" }] };
    expect(projectionStatus(warning)).toBe("warning");
    expect(projectionStatusLabel(warning)).toBe("有建议");
    expect(projectionStatus({ ...warning, valid: false })).toBe("invalid");
    expect(projectionStatus({ ...warning, issues: [{ ruleId: "FRM-002", severity: "info", message: "relabel" }] })).toBe("valid");
  });
  it("keeps historical invalid warnings visible without silently reclassifying them", () => {
    expect(projectionIssues({ valid: false, warnings: ["legacy"] }))
      .toEqual([{ ruleId: "LEGACY", severity: "error", message: "legacy" }]);
  });
});
