import type { DialogueSequence, ShotPlan } from "../types";
import type { DirectorDecision } from "./contracts";
import {
  resolveShotDecisions,
  type ShotCameraOverride,
} from "./shotResolver";

const MAX_CAMERA_CANDIDATES_PER_SHOT = 3;
const MAX_GEOMETRY_SOLUTIONS_TO_SCAN = 12;

export interface RuleCameraCandidate {
  candidateId: string;
  shotIndex: number;
  geometryCandidateIndex: number;
  label: string;
  isBaseline: boolean;
  legal: boolean;
  cameraOverride: ShotCameraOverride;
  shot: ShotPlan;
}

export interface RuleCameraCandidateSet {
  shotIndex: number;
  dialogueIds: string[];
  candidates: RuleCameraCandidate[];
}

function cameraKey(shot: ShotPlan): string {
  return [
    ...shot.cameraPosition,
    ...shot.cameraTarget,
    shot.compositionPlan.visualAnchor,
  ]
    .map((value) =>
      typeof value === "number" ? value.toFixed(3) : value,
    )
    .join(":");
}

function candidateLabel(candidateIndex: number): string {
  return candidateIndex === 0
    ? "规则基线"
    : `几何候选 ${String.fromCharCode(65 + candidateIndex)}`;
}

function candidateFromShot(
  shot: ShotPlan,
  geometryCandidateIndex: number,
  legal: boolean,
): RuleCameraCandidate {
  return {
    candidateId: `shot-${String(shot.index + 1).padStart(2, "0")}-camera-${String(
      geometryCandidateIndex + 1,
    ).padStart(2, "0")}`,
    shotIndex: shot.index,
    geometryCandidateIndex,
    label: candidateLabel(geometryCandidateIndex),
    isBaseline: geometryCandidateIndex === 0,
    legal,
    cameraOverride: {
      position: shot.cameraPosition,
      target: shot.cameraTarget,
      composition: shot.compositionPlan,
    },
    shot,
  };
}

export function generateRuleCameraCandidates(
  sequence: DialogueSequence,
  decisions: DirectorDecision[],
  baselineShots: ShotPlan[],
): RuleCameraCandidateSet[] {
  const baselineInvalidCount = baselineShots.filter(
    (shot) => !shot.projection.valid,
  ).length;

  return baselineShots.map((baselineShot, shotIndex) => {
    const candidates: RuleCameraCandidate[] = [];
    const seen = new Set<string>();

    for (
      let geometryCandidateIndex = 0;
      geometryCandidateIndex < MAX_GEOMETRY_SOLUTIONS_TO_SCAN &&
      candidates.length < MAX_CAMERA_CANDIDATES_PER_SHOT;
      geometryCandidateIndex += 1
    ) {
      try {
        const shots = resolveShotDecisions(sequence, decisions, {
          cameraCandidateIndexes: new Map([
            [shotIndex, geometryCandidateIndex],
          ]),
        });
        const shot = shots[shotIndex];
        const invalidCount = shots.filter(
          (candidateShot) => !candidateShot.projection.valid,
        ).length;
        if (
          !shot?.projection.valid ||
          invalidCount > baselineInvalidCount
        ) {
          continue;
        }
        const key = cameraKey(shot);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        candidates.push(
          candidateFromShot(shot, geometryCandidateIndex, true),
        );
      } catch {
        // A candidate may be unavailable for this shot geometry or continuity.
      }
    }

    if (candidates.length === 0) {
      candidates.push(candidateFromShot(baselineShot, 0, false));
    }

    return {
      shotIndex,
      dialogueIds: [...baselineShot.dialogueIds],
      candidates,
    };
  });
}
