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
  state: number | null;
  speakerSlot: ParticipantSlot | null;
  speakerModelIndex: number | null;
  relativeTransformsString: string;
  characterBehaviourString: string;
}

export interface DialogueStart {
  id: string;
  outline: string;
  rowNumber: number;
  formationClassPath: string | null;
  modelNames: string[];
}

export interface NpcProfile {
  id: number;
  name: string;
  note: string;
  introduction: string;
  resourceId: number | null;
  title?: string;
  canTurn?: boolean | null;
}

export interface ModelResource {
  id: number;
  configuredPath: string;
  generatedClassPath: string;
  rowNumber: number;
}

export interface MissionTaskRow {
  id: string;
  name: string;
  source: "任务表" | "副本任务表";
  showTargetIds: string;
  rowNumber: number;
}

export interface MissionPositionRow {
  id: string;
  type: number | null;
  description: string;
  npcId: number | null;
  itemId: number | null;
  blueprintModelId: number | null;
  mapId: string;
  positionText: string;
  rotationText: string;
  rowNumber: number;
}

export interface MapConfigRow {
  id: string;
  name: string;
  resourceId: string;
  assetPath: string;
  rowNumber: number;
}

export interface DialogueDatabase {
  dialogueRows: DialogueRow[];
  starts: DialogueStart[];
  npcs: Map<number, NpcProfile>;
  models: Map<number, ModelResource>;
  missionRows: MissionTaskRow[];
  missionPositions: MissionPositionRow[];
  mapConfigs: MapConfigRow[];
  sourceName: string;
}

export interface DialogueParticipant extends NpcProfile {
  instanceId: string;
  slot: ParticipantSlot;
  color: string;
  position: Vec3;
  facingTarget: Vec3;
  modelIndex: number | null;
  positionSource: "generated" | "blueprint";
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
  ignoredDialogueNodeCount: number;
  participants: DialogueParticipant[];
  adjacentContext: {
    previous: AdjacentDialogueContext | null;
    next: AdjacentDialogueContext | null;
  };
  warnings: string[];
  formation: {
    classPath: string;
    modelNames: string[];
  } | null;
}

export interface DialogueContentSearchContext {
  prefix: string;
  sequence: DialogueSequence;
  matchedDialogueIds: string[];
  contextDialogueIds: string[];
}

export interface DialogueContentSearchResult {
  query: string;
  totalMatchCount: number;
  totalContextCount: number;
  truncated: boolean;
  contexts: DialogueContentSearchContext[];
}

export interface UnrealTransform {
  location: { x: number; y: number; z: number };
  rotation: { pitch: number; yaw: number; roll: number };
  scale: { x: number; y: number; z: number };
}

export interface BlueprintFormationSlot {
  modelIndex: number;
  componentName: string;
  componentGuid: string;
  modelClassPath: string;
  transform: UnrealTransform;
}

export interface BlueprintFormationSnapshot {
  dialogueId: string;
  blueprintAssetPath: string;
  blueprintClassPath: string;
  slots: BlueprintFormationSlot[];
  dialogueModels?: string[];
  warnings: string[];
}

export interface MissionTargetPreviewTarget {
  targetId: string;
  type: number | null;
  description: string;
  npcId: number | null;
  npcName: string;
  modelId: number | null;
  modelClassPath: string;
  itemId: number | null;
  blueprintModelId: number | null;
  mapId: string;
  previewKind: "asset" | "marker";
  transform: UnrealTransform;
}

export interface MissionTargetPreviewPlan {
  taskId: string;
  taskName: string;
  taskSource: MissionTaskRow["source"];
  mapId: string;
  mapName: string;
  mapAssetPath: string;
  targets: MissionTargetPreviewTarget[];
  warnings: string[];
}

export interface MissionTargetPreviewLoadResult {
  status: "loaded";
  taskId: string;
  mapId: string;
  mapAssetPath: string;
  autoOpenedMap: boolean;
  spawnedCount: number;
  assetCount: number;
  markerCount: number;
}

export interface MissionTargetMapStatus {
  currentMapAssetPath: string;
  expectedMapAssetPath: string;
  matches: boolean;
}

export interface MissionTargetBlueprintCreateResult {
  status: "created";
  taskId: string;
  blueprintAssetPath: string;
  targetCount: number;
  componentNames: string[];
  dialogueRegistration?: DialogueModelRegistrationResult;
}

export interface MissionTargetBlueprintAppendResult {
  status: "appended";
  taskId: string;
  blueprintAssetPath: string;
  addedTargetIds: string[];
  addedModelIndexes: number[];
  componentNames: string[];
  dialogueRegistration: DialogueModelRegistrationResult;
}

export interface MissionTargetBlueprintCompatibility {
  status: "matched" | "mismatch" | "unavailable";
  blueprintAssetPath: string;
  dialogueId: string | null;
  dialogueAssetPath: string | null;
  formationClassPath: string | null;
  dialogueModels: string[];
  selectedModels: string[];
  message: string;
}

export interface DialogueModelRegistrationSlot {
  modelIndex: number;
  targetId: string | null;
  modelClassPath: string;
  existingModelName: string;
  existingModelClassPath?: string | null;
  registrationMatchesModel?: boolean;
  suggestedModelName: string | null;
  candidateModelNames: string[];
  status: "registered" | "available" | "unmapped";
}

export interface MissionTargetBlueprintSyncMapping {
  modelIndex: number;
  targetId: string;
  modelClassPath: string;
  currentBlueprintTransform: UnrealTransform;
  desiredBlueprintTransform: UnrealTransform;
  currentTargetTransform: MissionTargetTransform;
  blueprintWorldTransform: MissionTargetTransform;
  positionDelta: number;
  rotationDelta: number;
}

export interface MissionTargetBlueprintSyncState {
  sourceName: string;
  rootTransform: MissionTargetTransform;
  hasExplicitRoot: boolean;
  mappings: MissionTargetBlueprintSyncMapping[];
  unmatchedTargetIds: string[];
  unmatchedModelIndexes: number[];
  canUpdateBlueprint: boolean;
  canUpdateTargets: boolean;
  blockedReasons: string[];
}

export interface MissionTargetBlueprintInspection {
  blueprintState: "empty" | "populated";
  blueprintAssetPath: string;
  blueprintClassPath: string;
  parentClassPath: string;
  dialogueId: string | null;
  dialogueAssetPath: string | null;
  formationClassPath: string | null;
  slots: DialogueModelRegistrationSlot[];
  appendSlots?: DialogueModelRegistrationSlot[];
  message: string;
  refreshedPlan?: MissionTargetPreviewPlan;
  sync?: MissionTargetBlueprintSyncState;
}

export interface DialogueModelRegistrationResult {
  status: "registered" | "unchanged";
  blueprintAssetPath: string;
  dialogueId: string;
  dialogueAssetPath: string;
  dialogueModels: string[];
  registeredCount: number;
  characterCount: number;
  emptyCount: number;
  unresolvedIndexes: number[];
  spatialStatus?: "configured" | "unchanged" | "not_configured";
  spatialSource?: "selected_actor" | "level_scan" | "task_targets";
  spatialMapAssetPath?: string;
}

export interface MissionTargetBlueprintUpdateResult {
  status: "updated" | "unchanged";
  taskId: string;
  blueprintAssetPath: string;
  dialogueAssetPath: string;
  updatedModelIndexes: number[];
  blueprintSaved: boolean;
  dialogueSaved: boolean;
}

export interface MissionTargetBlueprintToTargetsResult
  extends MissionTargetUpdateResult {
  taskId: string;
  blueprintAssetPath: string;
  items: MissionTargetUpdateItem[];
}

export interface StoryboardExportShot {
  dialogueId: string;
  dialogueIds: string[];
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  cameraEndPosition: Vec3;
  cameraEndTarget: Vec3;
  focalLength: number;
  endFocalLength: number;
  cameraMovement: CameraMovement;
  movementIntensity: MovementIntensity;
  cameraRollDegrees: number;
  projectionValid: boolean;
  actorActions?: Array<{
    modelIndex: number;
    montageName: string;
    angleDegrees: ActorTurnDegrees;
  }>;
}

export interface StoryboardExportRequest {
  dialogueId: string;
  startId: string;
  dialogueIds: string[];
  participantModelIndexes: number[];
  usesBlueprintFormation: boolean;
  shots: StoryboardExportShot[];
  soundEffects?: Array<{
    dialogueId: string;
    assetName: string;
  }>;
  music?: Array<{
    dialogueId: string;
    stateId: number;
    stateName: string;
    musicName: string;
  }>;
}

export interface StoryboardExportNodePreview {
  dialogueId: string;
  shotIndex: number;
  role: "shot_start" | "continuation";
  action: "create" | "replace" | "clear" | "unchanged";
  existingCameraPosition: string;
  desiredCameraPosition: string;
  existingMovementCount: number;
  desiredMovementCount: number;
}

export interface StoryboardExportShotPreview {
  shotIndex: number;
  dialogueIds: string[];
  projectionValid: boolean;
  actorActionCount?: number;
  blockedReasons: string[];
}

export interface StoryboardExportSoundEffectPreview {
  soundEffectIndex: number;
  dialogueId: string;
  assetName: string;
  resolvedAssetPath: string;
  existingAssetPath: string;
  action: "add" | "replace" | "unchanged";
}

export interface SoundEffectPreviewInfo {
  assetName: string;
  available: boolean;
  reason: string;
  durationSeconds: number | null;
  mediaCount: number;
}

export interface SoundEffectPreviewPrepared extends SoundEffectPreviewInfo {
  available: true;
  url: string;
}

export interface StoryboardExportMusicPreview {
  musicIndex: number;
  dialogueId: string;
  stateId: number;
  stateName: string;
  musicName: string;
  existingStateId: number;
  action: "add" | "replace" | "unchanged";
}

export interface DialogueStoryboardExportPreview {
  reviewToken: string;
  dialogueId: string;
  startId: string;
  dialogueAssetPath: string;
  formationAssetPath: string;
  cameraName: string;
  shotCount: number;
  changedNodeCount: number;
  overwrittenNodeCount: number;
  clearedNodeCount: number;
  soundEffectCount?: number;
  changedSoundEffectCount?: number;
  replacedSoundEffectCount?: number;
  invalidShotCount: number;
  globalBlockedReasons: string[];
  blockedReasons: string[];
  warnings: string[];
  shots: StoryboardExportShotPreview[];
  nodes: StoryboardExportNodePreview[];
  soundEffects?: StoryboardExportSoundEffectPreview[];
  music?: StoryboardExportMusicPreview[];
  musicCount?: number;
  changedMusicCount?: number;
  replacedMusicCount?: number;
}

export interface DialogueStoryboardExportResult {
  status: "exported" | "unchanged";
  dialogueId: string;
  startId: string;
  dialogueAssetPath: string;
  changedNodeCount: number;
  changedSoundEffectCount?: number;
  changedMusicCount?: number;
  saved: boolean;
}

export interface DialogueContentUpdateRequest {
  dialogueId: string;
  startId: string;
  dialogueNodeId: string;
  previousContent: string;
  content: string;
}

export interface DialogueContentUpdateResult {
  status: "updated" | "unchanged";
  dialogueId: string;
  startId: string;
  dialogueNodeId: string;
  dialogueAssetPath: string;
  content: string;
  saved: boolean;
}

export interface DialogueContentBatchUpdateRequest {
  items: DialogueContentUpdateRequest[];
}

export interface DialogueContentBatchUpdateResult {
  updatedCount: number;
  unchangedCount: number;
  savedAssetCount: number;
  items: DialogueContentUpdateResult[];
}

export interface SelectedLevelActor {
  actorRef: string;
  label: string;
  classPath: string;
  assetKind?:
    | "blueprint_actor"
    | "skeletal_mesh"
    | "static_mesh"
    | "unsupported";
  assetPath?: string;
  transform: UnrealTransform;
}

export interface SelectedLevelActorsResult {
  mapAssetPath: string;
  actors: SelectedLevelActor[];
}

export interface BackgroundPropPreviewItem {
  actorRef: string;
  actorLabel: string;
  assetKind:
    | "blueprint_actor"
    | "skeletal_mesh"
    | "static_mesh"
    | "unsupported";
  assetPath: string;
  componentName: string;
  componentClass: string;
  assetPropertyName: string;
  worldTransform: UnrealTransform;
  relativeTransform: UnrealTransform;
  action: "create" | "update" | "unchanged" | "blocked";
  message: string;
}

export interface BackgroundPropImportPreview {
  reviewToken: string;
  blueprintAssetPath: string;
  mapAssetPath: string;
  rootTransform: MissionTargetTransform;
  items: BackgroundPropPreviewItem[];
  blockedReasons: string[];
}

export interface BackgroundPropImportResult {
  status: "updated" | "unchanged";
  blueprintAssetPath: string;
  createdComponentNames: string[];
  updatedComponentNames: string[];
  saved: boolean;
}

export interface NpcRegistrationCandidate {
  actor: SelectedLevelActor;
  modelOptions: ModelResource[];
  npcOptions: NpcProfile[];
  positionMatches: MissionPositionRow[];
  targetMatches: MissionPositionRow[];
  mapOptions: MapConfigRow[];
  mapId: string | null;
  mapName: string;
}

export interface NpcRegistrationScanResult {
  selection: SelectedLevelActorsResult;
  candidates: NpcRegistrationCandidate[];
}

export interface NpcRegistrationWriteItem {
  actorRef: string;
  label: string;
  classPath: string;
  transform: UnrealTransform;
  mapId: string;
  existingModelId: number | null;
  existingNpcId: number | null;
  existingTargetId: string | null;
  canTurn: boolean;
  newNpc: {
    name: string;
    title: string;
    canTurn: boolean;
  } | null;
}

export type NpcRegistrationWriteScope =
  | "all"
  | "npc_only"
  | "target_only";

export interface NpcRegistrationWriteResult {
  createdModels: Array<{ actorRef: string; id: number }>;
  createdNpcs: Array<{ actorRef: string; id: number }>;
  createdTargets: Array<{ actorRef: string; id: number }>;
  reusedTargets: Array<{ actorRef: string; id: string }>;
  openedWorkbooks: string[];
}

export type MissionTargetTransform = Pick<
  UnrealTransform,
  "location" | "rotation"
>;

export interface MissionTargetEditRequest {
  taskId: string;
  mapId: string;
  mapAssetPath: string;
  targets: MissionTargetPreviewTarget[];
}

export interface MissionTargetUpdateItem {
  targetId: string;
  mapId: string;
  originalTransform: MissionTargetTransform;
  transform: MissionTargetTransform;
}

export interface MissionTargetUpdateResult {
  updatedTargets: Array<{ targetId: string; rowNumber: number }>;
  unchangedTargetIds: string[];
  openedWorkbooks: string[];
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

export type ActorTurnDegrees = -180 | -90 | -45 | 45 | 90 | 180;

export interface ActorTurnAction {
  type: "turn";
  participantSlot: ParticipantSlot;
  participantName: string;
  angleDegrees: ActorTurnDegrees;
  montageName: string;
  fromYawDegrees: number;
  toYawDegrees: number;
  target: ParticipantSlot | "group_center";
  reason: string;
}

export type ActorAction = ActorTurnAction;

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
  actorActions: ActorAction[];
  facingOverrides: Partial<Record<ParticipantSlot, Vec3>>;
  axis: ShotAxis;
  projection: ShotProjectionValidation;
}
