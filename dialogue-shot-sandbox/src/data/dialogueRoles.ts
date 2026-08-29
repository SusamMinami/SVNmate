import type {
  DialogueParticipant,
  DialogueRow,
  ParticipantSlot,
} from "../types";
import { PARTICIPANT_SLOTS } from "../types";

export function participantSlotLabel(
  participant: Pick<DialogueParticipant, "modelIndex" | "slot">,
): string {
  if (participant.modelIndex !== null) {
    return String(participant.modelIndex);
  }
  const fallbackIndex = PARTICIPANT_SLOTS.indexOf(participant.slot);
  return fallbackIndex >= 0 ? String(fallbackIndex) : "?";
}

export function dialogueParticipantSlots(
  rows: readonly DialogueRow[],
): Set<ParticipantSlot> {
  return new Set(
    rows.flatMap((row) => (row.speakerSlot ? [row.speakerSlot] : [])),
  );
}

export function splitDialogueParticipants(
  participants: readonly DialogueParticipant[],
  rows: readonly DialogueRow[],
): {
  dialogue: DialogueParticipant[];
  background: DialogueParticipant[];
} {
  const dialogueSlots = dialogueParticipantSlots(rows);
  return {
    dialogue: participants.filter((participant) =>
      dialogueSlots.has(participant.slot),
    ),
    background: participants.filter(
      (participant) => !dialogueSlots.has(participant.slot),
    ),
  };
}
