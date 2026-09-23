import { describe, expect, it } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import { createShotPreview } from "./shotPlanner";
import {
  applyRefinement, createShotRefinementRequest, mergeRefinementPatch,
  refinementBaselinePlan, refinementTaskPacket, resolveRefinement,
  ShotRefinementRequestSchema,
} from "./shotRefinement";

function fixture() {
  const source = findDialogueSequence(demoDatabase, "2048")!;
  const preview = createShotPreview(source);
  const request = createShotRefinementRequest(
    preview.sequence, preview.shots, [0], "保留空间关系，明确镜头叙事目的",
    preview.blocking, preview.analysis,
  );
  return { preview, request: { ...request, baseline_version: "a".repeat(64) } };
}

describe("local shot refinement", () => {
  it("accepts the actual participant subset without requiring unused A-L slots", () => {
    const { request } = fixture();
    expect(request.input.participants).toHaveLength(2);
    expect(request.baseline.shots[0].facingOverrides).toHaveProperty("A");
    expect(request.baseline.shots[0].facingOverrides).not.toHaveProperty("L");
  });

  it("rejects stale versions, duplicate targets and out-of-scope replacements", () => {
    const { request } = fixture();
    const replacement = { shot_index: 0, decision: request.baseline.shots[0].decision };
    expect(() => mergeRefinementPatch(request, {
      baseline_version: "b".repeat(64), replacements: [replacement],
    })).toThrow("版本");
    for (const replacements of [[replacement, replacement], [{ ...replacement, shot_index: 1 }]]) {
      expect(() => mergeRefinementPatch(request, {
        baseline_version: request.baseline_version, replacements,
      })).toThrow("选中");
    }
    expect(() => ShotRefinementRequestSchema.parse({ ...request, baseline_version: undefined,
      target_indexes: [0, 0] })).toThrow();
  });

  it("rejects changes to dialogue coverage and extra patch fields", () => {
    const { request } = fixture();
    const patch = { baseline_version: request.baseline_version, replacements: [{
      shot_index: 0, decision: { ...request.baseline.shots[0].decision, dialogue_ids: ["other"] },
    }] };
    expect(() => mergeRefinementPatch(request, patch)).toThrow("对白覆盖");
    expect(() => mergeRefinementPatch(request, { ...patch, blocking: {} })).toThrow();
  });

  it("applies only selected shots and preserves actor direction, duration and all other objects", () => {
    const { preview, request } = fixture();
    const decision = { ...request.baseline.shots[0].decision, intent: "交代谈话关系，保留双方姿态。" };
    const plan = mergeRefinementPatch(request, { baseline_version: request.baseline_version,
      replacements: [{ shot_index: 0, decision }] });
    const before = JSON.stringify(preview);
    const next = applyRefinement(request, preview.shots, plan);
    expect(next[0].rationale).toBe(decision.intent);
    expect(next[0].actorActions).toBe(preview.shots[0].actorActions);
    expect(next[0].facingOverrides).toBe(preview.shots[0].facingOverrides);
    expect(next[0].duration).toBe(preview.shots[0].duration);
    for (let index = 1; index < next.length; index++) expect(next[index]).toBe(preview.shots[index]);
    expect(JSON.stringify(preview)).toBe(before);
  });

  it("validates against actual frozen cameras, including their motion endpoints", () => {
    const { request } = fixture();
    const index = 1;
    request.baseline.shots[index].cameraEndPosition = [321, 4, 567];
    const { shots } = resolveRefinement(request, refinementBaselinePlan(request));
    expect(shots[index].cameraPosition).toEqual(request.baseline.shots[index].cameraPosition);
    expect(shots[index].cameraEndPosition).toEqual([321, 4, 567]);
  });

  it("sends only the selected neighbourhood and no audio catalog or unrelated dialogue", () => {
    const { request } = fixture();
    const packet = refinementTaskPacket(request);
    expect(packet.shots.map((shot) => shot.shot_index)).toEqual([0, 1]);
    expect(packet.shots.map((shot) => shot.editable)).toEqual([true, false]);
    expect(packet).not.toHaveProperty("sound_effect_catalog");
    const ids = new Set(packet.shots.flatMap((shot) => shot.decision.dialogue_ids));
    expect(packet.dialogue.every((line) => ids.has(line.dialogue_id))).toBe(true);
  });
});
