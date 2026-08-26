import type {
  ActorTurnAction,
  ActorTurnDegrees,
  DialogueParticipant,
  ParticipantSlot,
  Vec3,
} from "../types";

export const SUPPORTED_ACTOR_TURN_DEGREES = [
  -180,
  -90,
  -45,
  45,
  90,
  180,
] as const satisfies readonly ActorTurnDegrees[];

const TURN_CANDIDATES = [
  0,
  ...SUPPORTED_ACTOR_TURN_DEGREES,
] as const;
const MINIMUM_TURN_DEGREES = 22.5;

function normalizedDegrees(value: number): number {
  const result = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(result, -0) ? 0 : result;
}

function roundedDegrees(value: number): number {
  return Math.round(normalizedDegrees(value) * 10) / 10;
}

export function participantFacingYawDegrees(
  participant: Pick<DialogueParticipant, "position" | "facingTarget">,
): number {
  const deltaX = participant.facingTarget[0] - participant.position[0];
  const deltaZ = participant.facingTarget[2] - participant.position[2];
  if (Math.hypot(deltaX, deltaZ) < 0.0001) {
    return 0;
  }
  return roundedDegrees((Math.atan2(deltaX, -deltaZ) * 180) / Math.PI);
}

function facingTargetForYaw(position: Vec3, yawDegrees: number): Vec3 {
  const radians = (yawDegrees * Math.PI) / 180;
  return [
    position[0] + Math.sin(radians) * 2,
    position[1],
    position[2] - Math.cos(radians) * 2,
  ];
}

function targetYawDegrees(position: Vec3, target: Vec3): number | null {
  const deltaX = target[0] - position[0];
  const deltaZ = target[2] - position[2];
  if (Math.hypot(deltaX, deltaZ) < 0.05) {
    return null;
  }
  return roundedDegrees((Math.atan2(deltaX, -deltaZ) * 180) / Math.PI);
}

function nearestTurnDegrees(delta: number): ActorTurnDegrees | 0 {
  if (Math.abs(delta) < MINIMUM_TURN_DEGREES) {
    return 0;
  }
  return TURN_CANDIDATES.reduce((best, candidate) => {
    const bestError = Math.abs(normalizedDegrees(delta - best));
    const candidateError = Math.abs(normalizedDegrees(delta - candidate));
    if (candidateError !== bestError) {
      return candidateError < bestError ? candidate : best;
    }
    return Math.abs(candidate) < Math.abs(best) ? candidate : best;
  }, 0);
}

function groupCenter(participants: DialogueParticipant[]): Vec3 {
  const total = participants.reduce<[number, number, number]>(
    (result, participant) => [
      result[0] + participant.position[0],
      result[1] + participant.position[1],
      result[2] + participant.position[2],
    ],
    [0, 0, 0],
  );
  return [
    total[0] / participants.length,
    total[1] / participants.length,
    total[2] / participants.length,
  ];
}

function nearestOtherPosition(
  participant: DialogueParticipant,
  participants: DialogueParticipant[],
): Vec3 | null {
  return (
    participants
      .filter((candidate) => candidate.slot !== participant.slot)
      .sort(
        (left, right) =>
          Math.hypot(
            left.position[0] - participant.position[0],
            left.position[2] - participant.position[2],
          ) -
          Math.hypot(
            right.position[0] - participant.position[0],
            right.position[2] - participant.position[2],
          ),
      )[0]?.position ?? null
  );
}

export function planActorTurns(
  participants: DialogueParticipant[],
  focus:
    | { kind: "group" }
    | {
        kind: "conversation";
        subjectSlot: ParticipantSlot;
        lookTargetSlot: ParticipantSlot | null;
      },
): {
  participants: DialogueParticipant[];
  actions: ActorTurnAction[];
  warnings: string[];
} {
  const center = groupCenter(participants);
  const participantsBySlot = new Map(
    participants.map((participant) => [participant.slot, participant]),
  );
  const targets = new Map<
    ParticipantSlot,
    { position: Vec3; target: ParticipantSlot | "group_center" }
  >();

  if (focus.kind === "group") {
    for (const participant of participants) {
      targets.set(participant.slot, {
        position:
          targetYawDegrees(participant.position, center) === null
            ? nearestOtherPosition(participant, participants) ??
              participant.facingTarget
            : center,
        target: "group_center",
      });
    }
  } else if (focus.lookTargetSlot) {
    const subject = participantsBySlot.get(focus.subjectSlot);
    const lookTarget = participantsBySlot.get(focus.lookTargetSlot);
    if (subject && lookTarget) {
      targets.set(subject.slot, {
        position: lookTarget.position,
        target: lookTarget.slot,
      });
      targets.set(lookTarget.slot, {
        position: subject.position,
        target: subject.slot,
      });
    }
  }

  const actions: ActorTurnAction[] = [];
  const warnings: string[] = [];
  const facingTargets = new Map<ParticipantSlot, Vec3>();
  for (const participant of participants) {
    const target = targets.get(participant.slot);
    if (!target) {
      facingTargets.set(participant.slot, participant.facingTarget);
      continue;
    }
    const desiredYaw = targetYawDegrees(participant.position, target.position);
    if (desiredYaw === null) {
      facingTargets.set(participant.slot, participant.facingTarget);
      continue;
    }
    const currentYaw = participantFacingYawDegrees(participant);
    const delta = roundedDegrees(desiredYaw - currentYaw);
    const turn = nearestTurnDegrees(delta);
    if (turn === 0) {
      facingTargets.set(participant.slot, participant.facingTarget);
      continue;
    }
    if (participant.canTurn === false) {
      warnings.push(
        `演员调度：${participant.slot} ${participant.name} 需要转向 ${Math.abs(delta).toFixed(1)}°，但 NPC 配置为不可转身`,
      );
      facingTargets.set(participant.slot, participant.facingTarget);
      continue;
    }
    const toYawDegrees = roundedDegrees(currentYaw + turn);
    const facingTarget = facingTargetForYaw(
      participant.position,
      toYawDegrees,
    );
    facingTargets.set(participant.slot, facingTarget);
    actions.push({
      type: "turn",
      participantSlot: participant.slot,
      participantName: participant.name,
      angleDegrees: turn,
      montageName: `AM_Turn${turn > 0 ? "Right" : "Left"}${Math.abs(turn)}`,
      fromYawDegrees: currentYaw,
      toYawDegrees,
      target: target.target,
      reason:
        target.target === "group_center"
          ? "转向当前群体中心，保持群像关系可读"
          : `转向 ${target.target}，建立可执行的对话视线`,
    });
  }

  return {
    participants: participants.map((participant) => ({
      ...participant,
      facingTarget:
        facingTargets.get(participant.slot) ?? participant.facingTarget,
    })),
    actions,
    warnings,
  };
}
