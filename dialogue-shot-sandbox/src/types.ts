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

export type CompositionMode =
  | "center"
  | "rule_of_thirds"
  | "golden_ratio"
  | "symmetry"
  | "asymmetrical_balance"
  | "triangular"
  | "negative_space"
  | "layered_depth";

export type VisualAnchor =
  | "center"
  | "left_third"
  | "right_third"
  | "left_golden"
  | "right_golden"
  | "balanced";

export type NegativeSpaceMode =
  | "balanced"
  | "look_room"
  | "isolation"
  | "pressure";

export type CompositionTransition =
  | "recenter"
  | "match_eye_trace"
  | "mirror_reverse"
  | "progressive_shift"
  | "contrast";

export type CoverageIntent =
  | "establish_geography"
  | "reestablish_geography"
  | "relationship"
  | "shared_reaction"
  | "individual_perspective"
  | "individual_emphasis"
  | "reaction";

export type CameraMovement =
  | "static"
  | "pan"
  | "tracking"
  | "dolly_in"
  | "dolly_out"
  | "zoom_in"
  | "zoom_out"
  | "dolly_zoom_in"
  | "dolly_zoom_out";

export type MovementIntensity =
  | "none"
  | "subtle"
  | "moderate"
  | "strong";

export type LensIntent =
  | "spatial_context"
  | "natural_perspective"
  | "subject_isolation"
  | "compressed_intimacy"
  | "perspective_distortion";

export type DepthOfField = "deep" | "moderate" | "shallow";

export interface ShotComposition {
  mode: CompositionMode;
  visualAnchor: VisualAnchor;
  negativeSpace: NegativeSpaceMode;
  transition: CompositionTransition;
}

export interface ShotProjectionValidation {
  expectedShotSize: ShotSize;
  measuredShotSize: ShotSize;
  coverage: ShotCoverage;
  visibleParticipantSlots: ParticipantSlot[];
  foregroundParticipantSlots: ParticipantSlot[];
  participantAreaRatios: Partial<Record<ParticipantSlot, number>>;
  subjectFaceAngle: number | null;
  subjectSafeForUltrawide: boolean;
  visualAnchor: readonly [number, number];
  targetAnchor: readonly [number, number];
  anchorDistance: number;
  headroom: number | null;
  lookRoom: number | null;
  backRoom: number | null;
  visualWeightBias: number;
  projectedTriangleArea: number | null;
  depthSpread: number;
  eyeTraceDelta: number | null;
  valid: boolean;
  warnings: string[];
}

export interface ShotAxis {
  id: string;
  kind: "relationship" | "direction" | "group";
  participantSlots: ParticipantSlot[];
  start: Vec3;
  end: Vec3;
  cameraSide: -1 | 0 | 1;
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
  endFocalLength: number;
  lensIntent: LensIntent;
  depthOfField: DepthOfField;
  duration: number;
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  cameraEndPosition: Vec3;
  cameraEndTarget: Vec3;
  cameraMovement: CameraMovement;
  movementIntensity: MovementIntensity;
  cameraRollDegrees: number;
  coverageIntent: CoverageIntent;
  compositionPlan: ShotComposition;
  composition: string;
  rationale: string;
  visualSubjectSlot: ParticipantSlot | null;
  lookTargetSlot: ParticipantSlot | null;
  facingOverrides: Partial<Record<ParticipantSlot, Vec3>>;
  axis: ShotAxis;
  projection: ShotProjectionValidation;
}
