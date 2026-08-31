import type {
  DialogueCharacterActionItem,
  DialogueCharacterActionTrack,
  DialogueParticipant,
  DialoguePositionTimelineRow,
  DialogueRow,
  ParticipantSlot,
  UnrealTransform,
  Vec3,
} from "../types";
import { participantFacingYawDegrees } from "../director/actorActionPlanner";

export interface ParsedDialogueCharacterAction
  extends DialogueCharacterActionItem {
  modelIndex: number;
}

export interface CharacterActionTrackLike {
  dialogueId: string;
  modelIndex: number;
  actions: readonly DialogueCharacterActionItem[];
}

export interface DialogueCharacterStage {
  participants: DialogueParticipant[];
  affectedModelIndexes: ReadonlySet<number>;
  affectedParticipantSlots: ReadonlySet<ParticipantSlot>;
}

export interface ParsedDialogueRelativeTransform {
  modelIndex: number;
  useBlueprintTransform: boolean;
  transform: Pick<UnrealTransform, "location" | "rotation">;
}

export interface DialogueCharacterTransformState {
  transform: UnrealTransform;
  movementActionCount: number;
  rotationActionCount: number;
  lastAdjustedDialogueId: string | null;
}

const SERIALIZED_BEHAVIOUR_TYPES: Record<number, string> = {
  0: "ENone",
  1: "ERotate",
  2: "EWalk",
  3: "EStateMachineWalk",
};

export function turnDegreesFromMontageName(
  montageName: string,
): number | null {
  const direction = montageName.match(
    /(?:turn|trun)(left|right|l|r)/i,
  );
  if (!direction) {
    return null;
  }
  const degreeCandidates = (
    montageName
      .slice((direction.index ?? 0) + direction[0].length)
      .match(/\d+(?:\.\d+)?/g) ?? []
  ).map(Number);
  const degrees =
    degreeCandidates.find((candidate) => candidate >= 10) ??
    degreeCandidates[0];
  if (!Number.isFinite(degrees) || degrees <= 0 || degrees > 360) {
    return null;
  }
  return ["right", "r"].includes(direction[1].toLowerCase())
    ? degrees
    : -degrees;
}

export function behaviourTypeForMontageName(
  montageName: string,
): "ENone" | "ERotate" {
  return turnDegreesFromMontageName(montageName) === null
    ? "ENone"
    : "ERotate";
}

function finiteNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDialogueCharacterBehaviourString(
  value: string,
): ParsedDialogueCharacterAction[] {
  return value.split(";").flatMap((track, modelIndex) =>
    track.split("|").flatMap((serializedAction) => {
      const fields = serializedAction.split(",").map((field) => field.trim());
      if (fields.length < 10 || !/^[0-3]$/.test(fields[2] ?? "")) {
        return [];
      }
      const values = [
        fields[0],
        fields[3],
        fields[4],
        fields[5],
        fields[6],
        fields[7],
        fields[8],
      ].map(finiteNumber);
      if (values.some((field) => field === null)) {
        return [];
      }
      const [
        delaySeconds,
        startX,
        startY,
        startZ,
        endX,
        endY,
        endZ,
      ] = values as number[];
      return [{
        modelIndex,
        montageName: fields[1] || "None",
        delaySeconds,
        behaviourType: SERIALIZED_BEHAVIOUR_TYPES[Number(fields[2])],
        startLocation: { x: startX, y: startY, z: startZ },
        endLocation: { x: endX, y: endY, z: endZ },
      }];
    }),
  );
}

export function parseDialogueRelativeTransformsString(
  value: string,
): ParsedDialogueRelativeTransform[] {
  return value.split(";").flatMap((serializedTransform) => {
    const separatorIndex = serializedTransform.indexOf("|");
    if (separatorIndex < 1) {
      return [];
    }
    const modelIndexText = serializedTransform
      .slice(0, separatorIndex)
      .trim();
    const fields = serializedTransform
      .slice(separatorIndex + 1)
      .split(",")
      .map((field) => field.trim());
    if (!/^\d+$/.test(modelIndexText) || fields.length < 7) {
      return [];
    }
    const values = fields.slice(1, 7).map(finiteNumber);
    if (
      !/^[01]$/.test(fields[0] ?? "") ||
      values.some((field) => field === null)
    ) {
      return [];
    }
    const [pitch, yaw, roll, x, y, z] = values as number[];
    return [{
      modelIndex: Number(modelIndexText),
      useBlueprintTransform: fields[0] === "1",
      transform: {
        location: { x, y, z },
        rotation: { pitch, yaw, roll },
      },
    }];
  });
}

function normalizedBehaviourType(
  action: DialogueCharacterActionItem,
): string {
  const type = action.behaviourType?.trim().toLowerCase();
  if (type) {
    return type;
  }
  return turnDegreesFromMontageName(action.montageName) === null
    ? "enone"
    : "erotate";
}

function isWalkBehaviour(type: string): boolean {
  return [
    "ewalk",
    "estatemachinewalk",
    "machinewalk",
    "emachinewalk",
  ].includes(type);
}

function normalizedAngle(value: number): number {
  const result = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(result, -0) ? 0 : result;
}

export function resolveDialogueFinalTransforms(
  initialSlots: readonly {
    modelIndex: number;
    transform: UnrealTransform;
  }[],
  rows: readonly DialoguePositionTimelineRow[],
): Map<number, DialogueCharacterTransformState> {
  const initialByModelIndex = new Map(
    initialSlots.map((slot) => [
      slot.modelIndex,
      {
        location: { ...slot.transform.location },
        rotation: { ...slot.transform.rotation },
        scale: { ...slot.transform.scale },
      },
    ]),
  );
  const stateByModelIndex = new Map<
    number,
    DialogueCharacterTransformState
  >(
    Array.from(initialByModelIndex, ([modelIndex, transform]) => [
      modelIndex,
      {
        transform: {
          location: { ...transform.location },
          rotation: { ...transform.rotation },
          scale: { ...transform.scale },
        },
        movementActionCount: 0,
        rotationActionCount: 0,
        lastAdjustedDialogueId: null,
      },
    ]),
  );

  for (const row of rows) {
    for (const relative of parseDialogueRelativeTransformsString(
      row.relativeTransformsString,
    )) {
      const state = stateByModelIndex.get(relative.modelIndex);
      const initial = initialByModelIndex.get(relative.modelIndex);
      if (!state || !initial) {
        continue;
      }
      const transform = relative.useBlueprintTransform
        ? initial
        : {
            location: relative.transform.location,
            rotation: relative.transform.rotation,
            scale: initial.scale,
          };
      state.transform = {
        location: { ...transform.location },
        rotation: { ...transform.rotation },
        scale: { ...transform.scale },
      };
      if (!relative.useBlueprintTransform) {
        state.lastAdjustedDialogueId = row.id;
      }
    }

    for (const action of parseDialogueCharacterBehaviourString(
      row.characterBehaviourString,
    )) {
      const state = stateByModelIndex.get(action.modelIndex);
      if (!state) {
        continue;
      }
      const type = normalizedBehaviourType(action);
      if (type === "erotate") {
        const turnDegrees = turnDegreesFromMontageName(action.montageName);
        if (turnDegrees === null) {
          continue;
        }
        state.transform.rotation.yaw = normalizedAngle(
          state.transform.rotation.yaw + turnDegrees,
        );
        state.rotationActionCount += 1;
        state.lastAdjustedDialogueId = row.id;
        continue;
      }
      if (
        !isWalkBehaviour(type) ||
        !action.startLocation ||
        !action.endLocation
      ) {
        continue;
      }
      const deltaX = action.endLocation.x - action.startLocation.x;
      const deltaY = action.endLocation.y - action.startLocation.y;
      state.transform.location = { ...action.endLocation };
      if (Math.hypot(deltaX, deltaY) >= 0.0001) {
        state.transform.rotation.yaw = normalizedAngle(
          (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
        );
      }
      state.movementActionCount += 1;
      state.lastAdjustedDialogueId = row.id;
    }
  }

  return stateByModelIndex;
}

function roundedFingerprintNumber(value: number | undefined): string {
  return Number.isFinite(value) ? Number(value).toFixed(3) : "";
}

function actionFingerprint(action: DialogueCharacterActionItem): string {
  const type = normalizedBehaviourType(action);
  const includeLocations = isWalkBehaviour(type);
  return [
    action.montageName.trim().toLowerCase(),
    roundedFingerprintNumber(action.delaySeconds),
    type,
    ...(includeLocations
      ? [
          roundedFingerprintNumber(action.startLocation?.x),
          roundedFingerprintNumber(action.startLocation?.y),
          roundedFingerprintNumber(action.startLocation?.z),
          roundedFingerprintNumber(action.endLocation?.x),
          roundedFingerprintNumber(action.endLocation?.y),
          roundedFingerprintNumber(action.endLocation?.z),
        ]
      : []),
  ].join("|");
}

function unmatchedTrackActions(
  localActions: readonly DialogueCharacterActionItem[],
  fallbackActions: readonly DialogueCharacterActionItem[],
): DialogueCharacterActionItem[] {
  const remainingLocalActions = new Map<string, number>();
  for (const action of localActions) {
    const fingerprint = actionFingerprint(action);
    remainingLocalActions.set(
      fingerprint,
      (remainingLocalActions.get(fingerprint) ?? 0) + 1,
    );
  }
  return fallbackActions.filter((action) => {
    const fingerprint = actionFingerprint(action);
    const remaining = remainingLocalActions.get(fingerprint) ?? 0;
    if (remaining === 0) {
      return true;
    }
    remainingLocalActions.set(fingerprint, remaining - 1);
    return false;
  });
}

export function dialogueCharacterActionTracks(
  rows: readonly Pick<
    DialogueRow,
    "id" | "characterBehaviourString"
  >[],
): DialogueCharacterActionTrack[] {
  const tracks = new Map<string, DialogueCharacterActionTrack>();
  for (const row of rows) {
    for (const action of parseDialogueCharacterBehaviourString(
      row.characterBehaviourString,
    )) {
      if (
        action.behaviourType?.toLowerCase() === "enone" &&
        action.montageName.toLowerCase() === "am_talk"
      ) {
        continue;
      }
      const key = `${row.id}:${action.modelIndex}`;
      const track = tracks.get(key) ?? {
        dialogueId: row.id,
        modelIndex: action.modelIndex,
        actions: [],
        preservedComplexActionCount: 0,
      };
      track.actions.push(action);
      tracks.set(key, track);
    }
  }
  return Array.from(tracks.values());
}

export function mergeDialogueCharacterActionTracks(
  primaryTracks: readonly DialogueCharacterActionTrack[],
  fallbackTracks: readonly DialogueCharacterActionTrack[],
): DialogueCharacterActionTrack[] {
  const result = primaryTracks.map((track) => ({
    ...track,
    actions: [...track.actions],
  }));
  for (const fallback of fallbackTracks) {
    const primary = result.find(
      (track) =>
        track.dialogueId === fallback.dialogueId &&
        track.modelIndex === fallback.modelIndex,
    );
    if (!primary) {
      result.push({
        ...fallback,
        actions: [...fallback.actions],
      });
      continue;
    }
    primary.actions.push(
      ...unmatchedTrackActions(primary.actions, fallback.actions),
    );
    primary.preservedComplexActionCount = Math.max(
      primary.preservedComplexActionCount,
      fallback.preservedComplexActionCount,
    );
  }
  return result;
}

function facingTargetForYaw(position: Vec3, yawDegrees: number): Vec3 {
  const radians = (yawDegrees * Math.PI) / 180;
  return [
    position[0] + Math.sin(radians) * 2,
    position[1],
    position[2] - Math.cos(radians) * 2,
  ];
}

export function dialogueParticipantsByModelIndex(
  participants: readonly DialogueParticipant[],
  rows: readonly DialogueRow[],
): Map<number, DialogueParticipant> {
  const byModelIndex = new Map(
    participants.flatMap((participant) =>
      participant.modelIndex === null
        ? []
        : [[participant.modelIndex, participant] as const],
    ),
  );
  const participantByNpcId = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  const player = participantByNpcId.get(1);
  if (player && !byModelIndex.has(0)) {
    byModelIndex.set(0, player);
  }
  const npcIdsByModelIndex = new Map<number, Set<number>>();
  for (const row of rows) {
    if (row.speakerModelIndex === null || row.npcId === null) {
      continue;
    }
    const npcIds =
      npcIdsByModelIndex.get(row.speakerModelIndex) ?? new Set<number>();
    npcIds.add(row.npcId);
    npcIdsByModelIndex.set(row.speakerModelIndex, npcIds);
  }
  for (const [modelIndex, npcIds] of npcIdsByModelIndex) {
    if (npcIds.size !== 1) {
      continue;
    }
    const participant = participantByNpcId.get(Array.from(npcIds)[0]);
    if (participant) {
      byModelIndex.set(modelIndex, participant);
    }
  }
  return byModelIndex;
}

export function resolveDialogueCharacterStage(
  participants: readonly DialogueParticipant[],
  rows: readonly DialogueRow[],
  dialogueEndIndex: number,
  existingTracks: readonly CharacterActionTrackLike[] = [],
  pendingTracks: readonly CharacterActionTrackLike[] = [],
): DialogueCharacterStage {
  const participantByModelIndex = dialogueParticipantsByModelIndex(
    participants,
    rows,
  );
  const stateByParticipantSlot = new Map(
    participants.map((participant) => [
      participant.slot,
      {
        position: [...participant.position] as [number, number, number],
        yawDegrees: participantFacingYawDegrees(participant),
      },
    ]),
  );
  const existingByTrack = new Map(
    existingTracks.map((track) => [
      `${track.dialogueId}:${track.modelIndex}`,
      track.actions,
    ]),
  );
  const pendingByTrack = new Map(
    pendingTracks.map((track) => [
      `${track.dialogueId}:${track.modelIndex}`,
      track.actions,
    ]),
  );
  const affectedModelIndexes = new Set<number>();
  const affectedParticipantSlots = new Set<ParticipantSlot>();

  for (const row of rows.slice(0, Math.max(0, dialogueEndIndex + 1))) {
    const localByModelIndex = new Map<number, DialogueCharacterActionItem[]>();
    for (const action of parseDialogueCharacterBehaviourString(
      row.characterBehaviourString,
    )) {
      const actions = localByModelIndex.get(action.modelIndex) ?? [];
      actions.push(action);
      localByModelIndex.set(action.modelIndex, actions);
    }
    const modelIndexes = new Set([
      ...localByModelIndex.keys(),
      ...Array.from(existingByTrack.keys())
        .filter((key) => key.startsWith(`${row.id}:`))
        .map((key) => Number(key.slice(row.id.length + 1))),
      ...Array.from(pendingByTrack.keys())
        .filter((key) => key.startsWith(`${row.id}:`))
        .map((key) => Number(key.slice(row.id.length + 1))),
    ]);

    for (const modelIndex of modelIndexes) {
      const participant = participantByModelIndex.get(modelIndex);
      const state = participant
        ? stateByParticipantSlot.get(participant.slot)
        : undefined;
      if (!participant || !state) {
        continue;
      }
      const key = `${row.id}:${modelIndex}`;
      const localActions = localByModelIndex.get(modelIndex) ?? [];
      const actions = [
        ...localActions,
        ...unmatchedTrackActions(
          localActions,
          existingByTrack.get(key) ?? [],
        ),
        ...(pendingByTrack.get(key) ?? []),
      ];
      for (const action of actions) {
        const type = normalizedBehaviourType(action);
        if (type === "erotate") {
          const turnDegrees = turnDegreesFromMontageName(
            action.montageName,
          );
          if (turnDegrees !== null) {
            state.yawDegrees += turnDegrees;
            affectedModelIndexes.add(modelIndex);
            affectedParticipantSlots.add(participant.slot);
          }
          continue;
        }
        if (
          !isWalkBehaviour(type) ||
          !action.startLocation ||
          !action.endLocation
        ) {
          continue;
        }
        const deltaX = action.endLocation.x - action.startLocation.x;
        const deltaY = action.endLocation.y - action.startLocation.y;
        if (Math.hypot(deltaX, deltaY) < 0.0001) {
          continue;
        }
        state.position = [
          state.position[0] + deltaY / 100,
          state.position[1],
          state.position[2] - deltaX / 100,
        ];
        state.yawDegrees = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
        affectedModelIndexes.add(modelIndex);
        affectedParticipantSlots.add(participant.slot);
      }
    }
  }

  return {
    affectedModelIndexes,
    affectedParticipantSlots,
    participants: participants.map((participant) => {
      if (!affectedParticipantSlots.has(participant.slot)) {
        return participant;
      }
      const state = stateByParticipantSlot.get(participant.slot)!;
      return {
        ...participant,
        position: state.position,
        facingTarget: facingTargetForYaw(
          state.position,
          state.yawDegrees,
        ),
      };
    }),
  };
}
