import type {
  DialogueParticipant,
  ParticipantSlot,
  Vec3,
} from "../types";
import {
  directorDialogueParticipants,
  type DirectorBlocking,
  type DirectorInput,
} from "./contracts";

const POSITION_COORDINATES = {
  front_center: [0, 0, 0.85],
  front_left: [-1.15, 0, 0.62],
  front_right: [1.15, 0, 0.62],
  mid_center: [-0.4, 0, -0.15],
  mid_left: [-2.05, 0, -0.18],
  mid_right: [2.05, 0, -0.18],
  back_center: [0.52, 0, -1.15],
  back_left: [-1.55, 0, -1.12],
  back_right: [1.55, 0, -1.12],
  far_left: [-3.1, 0, -0.78],
  far_right: [3.1, 0, -0.78],
  rear_center: [-0.78, 0, -2.05],
} as const satisfies Record<DirectorBlocking["placements"][number]["position"], Vec3>;

const MINIMUM_HORIZONTAL_SEPARATION = 0.9;

const POSITION_SETS = {
  2: ["front_left", "front_right"],
  3: ["front_center", "back_left", "back_right"],
  4: ["front_left", "front_right", "back_left", "back_right"],
  5: [
    "front_center",
    "front_left",
    "front_right",
    "back_left",
    "back_right",
  ],
  6: [
    "front_left",
    "front_right",
    "mid_left",
    "mid_right",
    "back_left",
    "back_right",
  ],
  7: [
    "front_center",
    "front_left",
    "front_right",
    "mid_left",
    "mid_right",
    "back_left",
    "back_right",
  ],
  8: [
    "front_left",
    "front_right",
    "mid_center",
    "mid_left",
    "mid_right",
    "back_center",
    "back_left",
    "back_right",
  ],
  9: [
    "front_center",
    "front_left",
    "front_right",
    "mid_left",
    "mid_right",
    "back_center",
    "back_left",
    "back_right",
    "rear_center",
  ],
  10: [
    "front_center",
    "front_left",
    "front_right",
    "mid_left",
    "mid_right",
    "back_left",
    "back_right",
    "far_left",
    "far_right",
    "rear_center",
  ],
  11: [
    "front_center",
    "front_left",
    "front_right",
    "mid_center",
    "mid_left",
    "mid_right",
    "back_left",
    "back_right",
    "far_left",
    "far_right",
    "rear_center",
  ],
  12: [
    "front_center",
    "front_left",
    "front_right",
    "mid_center",
    "mid_left",
    "mid_right",
    "back_center",
    "back_left",
    "back_right",
    "far_left",
    "far_right",
    "rear_center",
  ],
} as const satisfies Record<
  number,
  ReadonlyArray<DirectorBlocking["placements"][number]["position"]>
>;

export function createDefaultBlocking(
  input: DirectorInput,
): DirectorBlocking {
  const dialogueParticipants = directorDialogueParticipants(input);
  const dialogueParticipantSlots = new Set(
    dialogueParticipants.map((participant) => participant.slot),
  );
  const leadDialogueSlot = dialogueParticipants[0]?.slot;
  const backgroundCount =
    input.participants.length - dialogueParticipants.length;
  const positions =
    POSITION_SETS[
      input.participants.length as keyof typeof POSITION_SETS
    ] ?? POSITION_SETS[12];
  return {
    formation: input.participants.length === 3 ? "triangle" : "arc",
    intent:
      dialogueParticipants.length === 1
        ? `围绕单一对白主体建立清晰构图，${backgroundCount} 位背景 NPC 仅提供环境层次。`
        : dialogueParticipants.length === 2
          ? "两位角色保持清晰对景关系与稳定视线轴。"
          : "对白角色沿浅弧展开，保证群像层次、相互视线和主要行动区域清晰；背景 NPC 只作为构图元素。",
    placements: input.participants.map((participant, index) => ({
      subject: participant.slot,
      position: positions[index],
      facing: "group_center",
      entry_dialogue_id:
        participant.entry_dialogue_id ??
        defaultEntryDialogueId(input, participant.first_dialogue_id),
      exit_dialogue_id: participant.exit_dialogue_id ?? null,
      intent:
        !dialogueParticipantSlots.has(participant.slot)
          ? "背景 NPC 保持环境站位，只参与遮挡与画面层次判断。"
          : participant.slot === leadDialogueSlot
            ? "主导角色占据易读位置，便于建立场面。"
            : "与其他角色保持可读间距和群体视线关系。",
    })),
  };
}

export function defaultEntryDialogueId(
  input: DirectorInput,
  firstDialogueId: string,
): string {
  const firstIndex = input.dialogue.findIndex(
    (line) => line.dialogue_id === firstDialogueId,
  );
  return firstIndex <= 1
    ? input.dialogue[0].dialogue_id
    : firstDialogueId;
}

export function resolveBlocking(
  participants: DialogueParticipant[],
  blocking: DirectorBlocking,
  dialogueIds: string[],
  options: { preserveInputPositions?: boolean } = {},
): DialogueParticipant[] {
  const expectedSlots = participants.map((participant) => participant.slot);
  const actualSlots = blocking.placements.map(
    (placement) => placement.subject,
  );
  if (
    actualSlots.length !== expectedSlots.length ||
    actualSlots.some((slot, index) => slot !== expectedSlots[index])
  ) {
    throw new Error("站位方案必须按原顺序覆盖所有角色");
  }
  const positions = blocking.placements.map(
    (placement) => placement.position,
  );
  if (new Set(positions).size !== positions.length) {
    throw new Error("站位方案不能让多个角色占用同一位置");
  }
  const participantBySlot = new Map(
    participants.map((participant) => [participant.slot, participant]),
  );
  const placementBySlot = new Map(
    blocking.placements.map((placement) => [
      placement.subject,
      placement,
    ]),
  );
  const dialogueIndexById = new Map(
    dialogueIds.map((dialogueId, index) => [dialogueId, index]),
  );
  const positionBySlot = new Map<ParticipantSlot, Vec3>();

  for (const participant of participants) {
    const placement = placementBySlot.get(participant.slot);
    if (!placement) {
      throw new Error(`站位方案遗漏角色 ${participant.slot}`);
    }
    positionBySlot.set(
      participant.slot,
      options.preserveInputPositions
        ? participant.position
        : POSITION_COORDINATES[placement.position],
    );
  }

  if (!options.preserveInputPositions) {
    const orderedPositions = participants
      .map((participant) => ({
        slot: participant.slot,
        position: positionBySlot.get(participant.slot) ?? [0, 0, 0],
      }))
      .sort((left, right) => left.position[0] - right.position[0]);
    const originalCenterX =
      orderedPositions.reduce(
        (total, item) => total + item.position[0],
        0,
      ) / orderedPositions.length;
    const separated = orderedPositions.map((item, index) => {
      const previous = index === 0 ? null : orderedPositions[index - 1];
      const previousSeparated = index === 0 ? null : positionBySlot.get(
        orderedPositions[index - 1].slot,
      );
      const minimumX =
        previous && previousSeparated
          ? previousSeparated[0] + MINIMUM_HORIZONTAL_SEPARATION
          : item.position[0];
      const position: Vec3 = [
        Math.max(item.position[0], minimumX),
        item.position[1],
        item.position[2],
      ];
      positionBySlot.set(item.slot, position);
      return { ...item, position };
    });
    const separatedCenterX =
      separated.reduce((total, item) => total + item.position[0], 0) /
      separated.length;
    const centerOffset = originalCenterX - separatedCenterX;
    for (const item of separated) {
      const position = positionBySlot.get(item.slot);
      if (position) {
        positionBySlot.set(item.slot, [
          Number((position[0] + centerOffset).toFixed(2)),
          position[1],
          position[2],
        ]);
      }
    }
  }

  const center = participants.reduce<[number, number, number]>(
    (result, participant) => {
      const position = positionBySlot.get(participant.slot) ?? [0, 0, 0];
      return [
        result[0] + position[0],
        result[1] + position[1],
        result[2] + position[2],
      ];
    },
    [0, 0, 0],
  );
  const groupCenter: Vec3 = [
    center[0] / participants.length,
    center[1] / participants.length,
    center[2] / participants.length,
  ];

  return participants.map((participant) => {
    const placement = placementBySlot.get(participant.slot);
    const position = positionBySlot.get(participant.slot);
    if (!placement || !position) {
      throw new Error(`站位方案无法解析角色 ${participant.slot}`);
    }
    if (placement.facing === placement.subject) {
      throw new Error(`角色 ${participant.slot} 不能面向自己`);
    }
    const facingTarget = options.preserveInputPositions
      ? participant.facingTarget
      : placement.facing === "group_center"
        ? groupCenter
        : positionBySlot.get(placement.facing);
    if (
      placement.facing !== "group_center" &&
      !participantBySlot.has(placement.facing)
    ) {
      throw new Error(
        `角色 ${participant.slot} 面向了不存在的角色 ${placement.facing}`,
      );
    }
    if (!facingTarget) {
      throw new Error(`角色 ${participant.slot} 的朝向无法解析`);
    }
    const entryDialogueId = options.preserveInputPositions
      ? participant.entryDialogueId
      : placement.entry_dialogue_id;
    const exitDialogueId = options.preserveInputPositions
      ? participant.exitDialogueId
      : placement.exit_dialogue_id;
    const entryIndex = dialogueIndexById.get(entryDialogueId);
    if (entryIndex === undefined) {
      throw new Error(
        `角色 ${participant.slot} 的登场节点不存在：${entryDialogueId}`,
      );
    }
    if (entryIndex > participant.firstDialogueIndex) {
      throw new Error(
        `角色 ${participant.slot} 的登场不能晚于首次发言 ${participant.firstDialogueId}`,
      );
    }
    const exitIndex =
      exitDialogueId === null
        ? null
        : dialogueIndexById.get(exitDialogueId);
    if (exitIndex === undefined) {
      throw new Error(
        `角色 ${participant.slot} 的离场节点不存在：${exitDialogueId}`,
      );
    }
    if (exitIndex !== null && exitIndex < entryIndex) {
      throw new Error(
        `角色 ${participant.slot} 的离场不能早于登场 ${entryDialogueId}`,
      );
    }
    if (exitIndex !== null && exitIndex < participant.lastDialogueIndex) {
      throw new Error(
        `角色 ${participant.slot} 的离场不能早于最后发言 ${participant.lastDialogueId}`,
      );
    }
    return {
      ...participant,
      position,
      facingTarget,
      positionSource: options.preserveInputPositions
        ? participant.positionSource
        : "generated",
      firstDialogueId: participant.firstDialogueId,
      firstDialogueIndex: participant.firstDialogueIndex,
      lastDialogueId: participant.lastDialogueId,
      lastDialogueIndex: participant.lastDialogueIndex,
      entryDialogueId,
      entryIndex,
      exitDialogueId,
      exitIndex,
    };
  });
}
