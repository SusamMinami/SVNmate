import type {
  MissionTargetBlueprintSyncState,
  MissionTargetPreviewTarget,
  MissionTargetTransform,
  UnrealTransform,
} from "../types";

export interface MissionTargetBlueprintSlot {
  modelIndex: number;
  modelClassPath: string;
  transform: UnrealTransform;
}

export interface MissionTargetBlueprintRoot {
  transform: MissionTargetTransform;
  explicit: boolean;
}

interface MatchedPair {
  target: MissionTargetPreviewTarget;
  slot: MissionTargetBlueprintSlot;
}

const ZERO_ROTATION = { pitch: 0, yaw: 0, roll: 0 };
const MATCH_EPSILON = 0.000_001;

function rounded(value: number): number {
  const result = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(result, -0) ? 0 : result;
}

function normalizedClassPath(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/");
  const quoted = trimmed.match(/'([^']+)'/)?.[1] ?? trimmed;
  return quoted.toLowerCase();
}

function normalizedAngle(value: number): number {
  let result = value % 360;
  if (result > 180) {
    result -= 360;
  } else if (result < -180) {
    result += 360;
  }
  return rounded(result);
}

function rotateYaw(
  value: UnrealTransform["location"],
  yawDegrees: number,
): UnrealTransform["location"] {
  const radians = (yawDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: rounded(value.x * cosine - value.y * sine),
    y: rounded(value.x * sine + value.y * cosine),
    z: rounded(value.z),
  };
}

function distance(
  left: UnrealTransform["location"],
  right: UnrealTransform["location"],
): number {
  return Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z,
  );
}

function rotationDistance(
  left: UnrealTransform["rotation"],
  right: UnrealTransform["rotation"],
): number {
  return Math.max(
    Math.abs(normalizedAngle(left.pitch - right.pitch)),
    Math.abs(normalizedAngle(left.yaw - right.yaw)),
    Math.abs(normalizedAngle(left.roll - right.roll)),
  );
}

function median(values: number[]): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function inferredRootLocation(
  pairs: MatchedPair[],
  rotation: UnrealTransform["rotation"],
): UnrealTransform["location"] | null {
  if (pairs.length === 0) {
    return null;
  }
  const candidates = pairs.map(({ target, slot }) => {
    const rotated = rotateYaw(slot.transform.location, rotation.yaw);
    return {
      x: target.transform.location.x - rotated.x,
      y: target.transform.location.y - rotated.y,
      z: target.transform.location.z - rotated.z,
    };
  });
  return {
    x: rounded(median(candidates.map((candidate) => candidate.x))),
    y: rounded(median(candidates.map((candidate) => candidate.y))),
    z: rounded(median(candidates.map((candidate) => candidate.z))),
  };
}

export function worldTransformFromBlueprint(
  transform: UnrealTransform,
  root: MissionTargetTransform,
): MissionTargetTransform {
  const rotatedLocation = rotateYaw(transform.location, root.rotation.yaw);
  return {
    location: {
      x: rounded(root.location.x + rotatedLocation.x),
      y: rounded(root.location.y + rotatedLocation.y),
      z: rounded(root.location.z + rotatedLocation.z),
    },
    rotation: {
      pitch: normalizedAngle(
        root.rotation.pitch + transform.rotation.pitch,
      ),
      yaw: normalizedAngle(root.rotation.yaw + transform.rotation.yaw),
      roll: normalizedAngle(root.rotation.roll + transform.rotation.roll),
    },
  };
}

export function blueprintTransformFromWorld(
  transform: UnrealTransform,
  root: MissionTargetTransform,
  currentScale: UnrealTransform["scale"],
): UnrealTransform {
  const offset = {
    x: transform.location.x - root.location.x,
    y: transform.location.y - root.location.y,
    z: transform.location.z - root.location.z,
  };
  return {
    location: rotateYaw(offset, -root.rotation.yaw),
    rotation: {
      pitch: normalizedAngle(
        transform.rotation.pitch - root.rotation.pitch,
      ),
      yaw: normalizedAngle(transform.rotation.yaw - root.rotation.yaw),
      roll: normalizedAngle(transform.rotation.roll - root.rotation.roll),
    },
    scale: { ...currentScale },
  };
}

export function missionTargetBlueprintRootForCreation(
  target: MissionTargetPreviewTarget,
): MissionTargetTransform {
  return {
    location: {
      x: rounded(target.transform.location.x),
      y: rounded(target.transform.location.y),
      z: rounded(target.transform.location.z - 100),
    },
    rotation: { ...ZERO_ROTATION },
  };
}

export function buildMissionTargetBlueprintSync(
  targets: MissionTargetPreviewTarget[],
  slots: MissionTargetBlueprintSlot[],
  root: MissionTargetBlueprintRoot,
  sourceName: string,
): MissionTargetBlueprintSyncState {
  const modelTargets = targets
    .map((target, index) => ({ target, expectedIndex: index + 1 }))
    .filter(({ target }) => Boolean(target.modelClassPath));
  const modelSlots = slots
    .filter(
      (slot) => slot.modelIndex > 0 && Boolean(slot.modelClassPath),
    )
    .sort((left, right) => left.modelIndex - right.modelIndex);
  const assignedTargets = new Set<string>();
  const assignedSlots = new Set<number>();
  const pairs: MatchedPair[] = [];

  const assign = (
    target: MissionTargetPreviewTarget,
    slot: MissionTargetBlueprintSlot,
  ) => {
    if (
      assignedTargets.has(target.targetId) ||
      assignedSlots.has(slot.modelIndex)
    ) {
      return;
    }
    assignedTargets.add(target.targetId);
    assignedSlots.add(slot.modelIndex);
    pairs.push({ target, slot });
  };

  if (!root.explicit) {
    for (const { target, expectedIndex } of modelTargets) {
      const slot = modelSlots.find(
        (candidate) =>
          candidate.modelIndex === expectedIndex &&
          normalizedClassPath(candidate.modelClassPath) ===
            normalizedClassPath(target.modelClassPath),
      );
      if (slot) {
        assign(target, slot);
      }
    }
  }

  const classPaths = new Set([
    ...modelTargets.map(({ target }) =>
      normalizedClassPath(target.modelClassPath),
    ),
    ...modelSlots.map((slot) =>
      normalizedClassPath(slot.modelClassPath),
    ),
  ]);
  for (const classPath of classPaths) {
    const remainingTargets = modelTargets
      .map(({ target }) => target)
      .filter(
        (target) =>
          !assignedTargets.has(target.targetId) &&
          normalizedClassPath(target.modelClassPath) === classPath,
      );
    const remainingSlots = modelSlots.filter(
      (slot) =>
        !assignedSlots.has(slot.modelIndex) &&
        normalizedClassPath(slot.modelClassPath) === classPath,
    );
    if (remainingTargets.length === 1 && remainingSlots.length === 1) {
      assign(remainingTargets[0], remainingSlots[0]);
    }
  }

  const rootRotation = { ...root.transform.rotation };
  const provisionalLocation = root.explicit
    ? { ...root.transform.location }
    : inferredRootLocation(pairs, rootRotation);
  if (provisionalLocation) {
    const provisionalRoot = {
      location: provisionalLocation,
      rotation: rootRotation,
    };
    for (const classPath of classPaths) {
      const remainingTargets = modelTargets
        .map(({ target }) => target)
        .filter(
          (target) =>
            !assignedTargets.has(target.targetId) &&
            normalizedClassPath(target.modelClassPath) === classPath,
        );
      const remainingSlots = modelSlots.filter(
        (slot) =>
          !assignedSlots.has(slot.modelIndex) &&
          normalizedClassPath(slot.modelClassPath) === classPath,
      );
      const candidates = remainingTargets
        .flatMap((target) =>
          remainingSlots.map((slot) => ({
            target,
            slot,
            distance: distance(
              target.transform.location,
              worldTransformFromBlueprint(
                slot.transform,
                provisionalRoot,
              ).location,
            ),
          })),
        )
        .sort((left, right) => left.distance - right.distance);
      for (const candidate of candidates) {
        assign(candidate.target, candidate.slot);
      }
    }
  }

  const inferredLocation = root.explicit
    ? { ...root.transform.location }
    : inferredRootLocation(pairs, rootRotation);
  const rootTransform = {
    location: inferredLocation ?? { ...root.transform.location },
    rotation: rootRotation,
  };
  const unsupportedRootRotation =
    Math.abs(rootTransform.rotation.pitch) > MATCH_EPSILON ||
    Math.abs(rootTransform.rotation.roll) > MATCH_EPSILON;
  const mappings = pairs
    .sort((left, right) => left.slot.modelIndex - right.slot.modelIndex)
    .map(({ target, slot }) => {
      const blueprintWorldTransform = worldTransformFromBlueprint(
        slot.transform,
        rootTransform,
      );
      const desiredBlueprintTransform = blueprintTransformFromWorld(
        target.transform,
        rootTransform,
        slot.transform.scale,
      );
      return {
        modelIndex: slot.modelIndex,
        targetId: target.targetId,
        modelClassPath: slot.modelClassPath,
        currentBlueprintTransform: {
          location: { ...slot.transform.location },
          rotation: { ...slot.transform.rotation },
          scale: { ...slot.transform.scale },
        },
        desiredBlueprintTransform,
        currentTargetTransform: {
          location: { ...target.transform.location },
          rotation: { ...target.transform.rotation },
        },
        blueprintWorldTransform,
        positionDelta: rounded(
          distance(
            target.transform.location,
            blueprintWorldTransform.location,
          ),
        ),
        rotationDelta: rounded(
          rotationDistance(
            target.transform.rotation,
            blueprintWorldTransform.rotation,
          ),
        ),
      };
    });
  const blockedReasons = unsupportedRootRotation
    ? ["当前 BP 根旋转包含 Pitch 或 Roll，暂不支持自动坐标换算"]
    : [];
  if (mappings.length === 0) {
    blockedReasons.push("任务目标物与 BP 数字槽位之间没有可确认的模型映射");
  }
  return {
    sourceName,
    rootTransform,
    hasExplicitRoot: root.explicit,
    mappings,
    unmatchedTargetIds: modelTargets
      .map(({ target }) => target.targetId)
      .filter((targetId) => !assignedTargets.has(targetId)),
    unmatchedModelIndexes: modelSlots
      .map((slot) => slot.modelIndex)
      .filter((modelIndex) => !assignedSlots.has(modelIndex)),
    canUpdateBlueprint:
      mappings.length > 0 && !unsupportedRootRotation,
    canUpdateTargets:
      root.explicit &&
      mappings.length > 0 &&
      !unsupportedRootRotation,
    blockedReasons,
  };
}
