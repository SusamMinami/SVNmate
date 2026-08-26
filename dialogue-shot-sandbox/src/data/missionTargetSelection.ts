import type {
  MissionTargetPreviewPlan,
  SelectedLevelActor,
  SelectedLevelActorsResult,
} from "../types";

export interface MissionTargetSelectionMatch {
  actorRef: string;
  targetId: string;
  method: "preview_identity" | "model_distance";
}

export interface MissionTargetSelectionClassification {
  mapMatches: boolean;
  matches: MissionTargetSelectionMatch[];
  matchedTargetIds: string[];
  unmatchedActorRefs: string[];
}

function normalizedAssetPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").toLowerCase();
  const quotedPath = normalized.match(/'([^']+)'/)?.[1] ?? normalized;
  const withoutClass = quotedPath.endsWith("_c")
    ? quotedPath.slice(0, -2)
    : quotedPath;
  return withoutClass.split(".")[0];
}

function previewIdentityMatches(
  actor: SelectedLevelActor,
  taskId: string,
  targetId: string,
): boolean {
  const identity =
    `shotsandboxmissiontargetpreview_${taskId}_${targetId}`.toLowerCase();
  const text = `${actor.actorRef}\n${actor.label}`.toLowerCase();
  let offset = text.indexOf(identity);
  while (offset >= 0) {
    const nextCharacter = text[offset + identity.length] ?? "";
    if (!/\d/.test(nextCharacter)) {
      return true;
    }
    offset = text.indexOf(identity, offset + identity.length);
  }
  return false;
}

function locationDistanceSquared(
  actor: SelectedLevelActor,
  target: MissionTargetPreviewPlan["targets"][number],
): number {
  const x = actor.transform.location.x - target.transform.location.x;
  const y = actor.transform.location.y - target.transform.location.y;
  const z = actor.transform.location.z - target.transform.location.z;
  return x * x + y * y + z * z;
}

export function classifyMissionTargetSelection(
  plan: MissionTargetPreviewPlan,
  selection: SelectedLevelActorsResult,
): MissionTargetSelectionClassification {
  const mapMatches =
    normalizedAssetPath(plan.mapAssetPath) ===
    normalizedAssetPath(selection.mapAssetPath);
  if (!mapMatches) {
    return {
      mapMatches: false,
      matches: [],
      matchedTargetIds: [],
      unmatchedActorRefs: selection.actors.map((actor) => actor.actorRef),
    };
  }

  const matches: MissionTargetSelectionMatch[] = [];
  const claimedActorRefs = new Set<string>();
  const claimedTargetIds = new Set<string>();

  for (const actor of selection.actors) {
    const target = plan.targets.find(
      (candidate) =>
        !claimedTargetIds.has(candidate.targetId) &&
        previewIdentityMatches(actor, plan.taskId, candidate.targetId),
    );
    if (!target) {
      continue;
    }
    matches.push({
      actorRef: actor.actorRef,
      targetId: target.targetId,
      method: "preview_identity",
    });
    claimedActorRefs.add(actor.actorRef);
    claimedTargetIds.add(target.targetId);
  }

  const remainingActors = selection.actors.filter(
    (actor) => !claimedActorRefs.has(actor.actorRef),
  );
  const remainingTargets = plan.targets.filter(
    (target) =>
      !claimedTargetIds.has(target.targetId) &&
      target.previewKind === "asset" &&
      Boolean(target.modelClassPath.trim()),
  );
  const candidatePairs = remainingActors.flatMap((actor, actorIndex) =>
    remainingTargets
      .map((target, targetIndex) => ({
        actor,
        actorIndex,
        target,
        targetIndex,
        distance: locationDistanceSquared(actor, target),
      }))
      .filter(
        ({ actor: candidateActor, target }) =>
          normalizedAssetPath(candidateActor.classPath) ===
          normalizedAssetPath(target.modelClassPath),
      ),
  );
  candidatePairs.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.actorIndex - right.actorIndex ||
      left.targetIndex - right.targetIndex,
  );

  for (const pair of candidatePairs) {
    if (
      claimedActorRefs.has(pair.actor.actorRef) ||
      claimedTargetIds.has(pair.target.targetId)
    ) {
      continue;
    }
    matches.push({
      actorRef: pair.actor.actorRef,
      targetId: pair.target.targetId,
      method: "model_distance",
    });
    claimedActorRefs.add(pair.actor.actorRef);
    claimedTargetIds.add(pair.target.targetId);
  }

  return {
    mapMatches: true,
    matches,
    matchedTargetIds: plan.targets
      .filter((target) => claimedTargetIds.has(target.targetId))
      .map((target) => target.targetId),
    unmatchedActorRefs: selection.actors
      .filter((actor) => !claimedActorRefs.has(actor.actorRef))
      .map((actor) => actor.actorRef),
  };
}
