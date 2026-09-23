import type { DialogueSchoolCameraRole } from "../types";

export type SchoolCameraHeightRole = "ENone" | DialogueSchoolCameraRole;

// Actor-relative height anchors from the player collision capsules. Ring and
// Nino differ by only 2 cm, so they intentionally share their 79 cm midpoint.
export const SCHOOL_CAMERA_HEIGHT_REFERENCE_CM = {
  ENone: 92,
  ERing: 79,
  ENino: 79,
  EJodie: 68,
} as const satisfies Record<SchoolCameraHeightRole, number>;

export function schoolCameraHeightDeltaCm(
  sourceRole: SchoolCameraHeightRole,
  targetRole: DialogueSchoolCameraRole,
): number {
  return (
    SCHOOL_CAMERA_HEIGHT_REFERENCE_CM[targetRole] -
    SCHOOL_CAMERA_HEIGHT_REFERENCE_CM[sourceRole]
  );
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} 结构无效，无法按职业眼高适配`);
  }
  return value as Record<string, unknown>;
}

function shiftedPoint(
  value: unknown,
  deltaZCm: number,
  path: string,
): Record<string, unknown> {
  const point = record(value, path);
  const z = point.Z;
  if (typeof z !== "number" || !Number.isFinite(z)) {
    throw new Error(`${path}.Z 必须是有限数值`);
  }
  const shiftedZ = Math.round((z + deltaZCm) * 10_000) / 10_000;
  return {
    ...point,
    Z: Object.is(shiftedZ, -0) ? 0 : shiftedZ,
  };
}

export function adaptSchoolCameraMovesForHeight(
  moves: readonly unknown[],
  sourceRole: SchoolCameraHeightRole,
  targetRole: DialogueSchoolCameraRole,
): unknown[] {
  const deltaZCm = schoolCameraHeightDeltaCm(sourceRole, targetRole);
  return structuredClone(moves).map((value, index) => {
    const move = record(value, `MoveCameras[${index}]`);
    if (String(move.CameraMoveType ?? "") !== "EPush") {
      return move;
    }
    const push = record(
      move.PushCameraArg,
      `MoveCameras[${index}].PushCameraArg`,
    );
    return {
      ...move,
      PushCameraArg: {
        ...push,
        StartPoint: shiftedPoint(
          push.StartPoint,
          deltaZCm,
          `MoveCameras[${index}].PushCameraArg.StartPoint`,
        ),
        EndPoint: shiftedPoint(
          push.EndPoint,
          deltaZCm,
          `MoveCameras[${index}].PushCameraArg.EndPoint`,
        ),
      },
    };
  });
}
