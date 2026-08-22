export type Vec3 = readonly [number, number, number];

export const PARTICIPANT_SLOTS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
] as const;

export const MAX_DIALOGUE_PARTICIPANTS = PARTICIPANT_SLOTS.length;

export type ParticipantSlot = (typeof PARTICIPANT_SLOTS)[number];

export interface DialogueRow {
  id: string;
  npcId: number | null;
  content: string;
  nextId: string | null;
  isEnd: boolean;
  rowNumber: number;
}

export interface DialogueStart {
  id: string;
  outline: string;
  rowNumber: number;
}

export interface NpcProfile {
  id: number;
  name: string;
  note: string;
  introduction: string;
}

export interface DialogueDatabase {
  dialogueRows: DialogueRow[];
  starts: DialogueStart[];
  npcs: Map<number, NpcProfile>;
  sourceName: string;
}

export interface DialogueParticipant extends NpcProfile {
  slot: ParticipantSlot;
  color: string;
  position: Vec3;
  facingTarget: Vec3;
  firstDialogueId: string;
  firstDialogueIndex: number;
  lastDialogueId: string;
  lastDialogueIndex: number;
  entryDialogueId: string;
  entryIndex: number;
  exitDialogueId: string | null;
  exitIndex: number | null;
}

export interface AdjacentDialogueContext {
  prefix: string;
  startId: string;
  outline: string;
  dialogue: Array<{
    dialogueId: string;
    npcId: number;
    speakerName: string;
    content: string;
  }>;
}

export interface DialogueSequence {
  prefix: string;
  startId: string;
  outline: string;
  rows: DialogueRow[];
  participants: DialogueParticipant[];
  adjacentContext: {
    previous: AdjacentDialogueContext | null;
    next: AdjacentDialogueContext | null;
  };
  warnings: string[];
}

export type ShotKind =
  | "master"
  | "profile-two-shot"
  | "group-medium"
  | "reverse-shot"
  | "close-up"
  | "reaction"
  | "low-angle"
  | "high-angle";

export type ShotSize =
  | "full"
  | "medium-full"
  | "medium"
  | "medium-close-up"
  | "close-up"
  | "extreme-close-up";

export type ShotCoverage =
  | "single"
  | "over-the-shoulder"
  | "two-shot"
  | "group"
  | "group-medium";

export interface ShotProjectionValidation {
  expectedShotSize: ShotSize;
  measuredShotSize: ShotSize;
  coverage: ShotCoverage;
  visibleParticipantSlots: ParticipantSlot[];
  foregroundParticipantSlots: ParticipantSlot[];
  participantAreaRatios: Partial<Record<ParticipantSlot, number>>;
  subjectFaceAngle: number | null;
  subjectSafeForUltrawide: boolean;
  valid: boolean;
  warnings: string[];
}

export interface ShotPlan {
  id: string;
  index: number;
  dialogueId: string;
  dialogueIds: string[];
  dialogueEndIndex: number;
  speakerId: number;
  speakerSlot: ParticipantSlot;
  speakerName: string;
  content: string;
  kind: ShotKind;
  label: string;
  focalLength: number;
  duration: number;
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  composition: string;
  rationale: string;
  visualSubjectSlot: ParticipantSlot | null;
  projection: ShotProjectionValidation;
}
