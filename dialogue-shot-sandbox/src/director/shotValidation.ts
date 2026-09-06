import type { ShotProjectionValidation, ShotValidationIssue } from "../types";

export function projectionIssues(
  projection: Pick<ShotProjectionValidation, "issues" | "warnings" | "valid">,
): ShotValidationIssue[] {
  return projection.issues ?? projection.warnings.map((message) => ({
    ruleId: "LEGACY",
    severity: projection.valid ? "warning" : "error",
    message,
  }));
}

export function projectionStatus(projection: ShotProjectionValidation): "valid" | "warning" | "invalid" {
  if (!projection.valid) return "invalid";
  return projectionIssues(projection).some((issue) => issue.severity === "warning")
    ? "warning" : "valid";
}

export function projectionStatusLabel(projection: ShotProjectionValidation): string {
  const status = projectionStatus(projection);
  return status === "invalid" ? "未通过" : status === "warning" ? "有建议" : "通过";
}
