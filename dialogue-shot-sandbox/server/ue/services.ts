import {
  updateMissionTargetTransforms as updateMissionTargetTransformsInExcel,
  writeNpcRegistrationDraft as writeNpcRegistrationDraftToExcel,
} from "../excelRegistration";
import {
  getConfigTablePaths,
  readConfiguredDialogueCsvPayload,
  readConfiguredMissionTargetPlan,
} from "../configRepository";
import {
  inspectSoundEffectPreview,
  prepareSoundEffectPreview,
} from "../soundEffectPreview";
import {
  applyDialogNpcTableRegistration,
  inspectDialogNpcTableRegistration,
} from "../dialogNpcTable";
import {
  applyNpcAssetMigration,
  configureNpcMigrationTarget,
  inspectNpcMigrationPlan,
  inspectNpcMigrationTarget,
  scanNpcMigrationSource,
} from "../npcMigration";
import {
  applyNpcSupplement,
  inspectNpcSupplementPlan,
  scanNpcSupplementTarget,
} from "../npcSupplement";
import { readSceneReference } from "./sceneReference";
import {
  applyDialogueCameraQuickAction,
  applyDialoguePreviewSchool,
  appendMissionTargetBlueprint,
  applyBackgroundPropImport,
  clearMissionTargetPreview,
  exportDialogueStoryboard,
  inspectBackgroundPropImport,
  inspectDialogueStoryboardExport,
  inspectDialogueCameraQuickAction,
  inspectDialoguePreviewSchool,
  inspectMissionTargetBlueprint,
  inspectMissionTargetBlueprintCompatibility,
  inspectMissionTargetMap,
  loadMissionTargetPreview,
  openConfigTable,
  populateMissionTargetBlueprint,
  readBlueprintFormation,
  readDialogueCharacterActions,
  readDialogueCameraPresets,
  readExistingDialogueStoryboard,
  readSelectedLevelActors,
  registerBlueprintDialogueModels,
  scanSelectedNpcRegistration,
  syncBlueprintPositionsToMissionTargets,
  updateDialogueContent,
  updateDialogueContents,
  updateMissionTargetBlueprintPositions,
} from "../ueBridge";
import { readSelectedDialogueNodePersistent } from "./dialogueSelection";
import {
  listAnimationSequences, scanAnimationSequence,
  reviewAnimationSequence, applyAnimationSequence,
} from "../animationVoice";
import { listAnimationSpeechMedia, prepareAnimationSpeechAudio, getAnimationSpeechAudio } from "../animationSpeechMedia";
import { animationSpeechStatus, startAnimationSpeech, getAnimationSpeechJob, cancelAnimationSpeech } from "../animationSpeechRuntime";

export const ueServices = {
  listAnimationSpeechMedia,
  prepareAnimationSpeechAudio,
  getAnimationSpeechAudio,
  animationSpeechStatus,
  startAnimationSpeech,
  getAnimationSpeechJob,
  cancelAnimationSpeech,
  listAnimationSequences,
  scanAnimationSequence,
  reviewAnimationSequence,
  applyAnimationSequence,
  readSceneReference,
  readSelectedDialogueNode: readSelectedDialogueNodePersistent,
  readExistingDialogueStoryboard,
  applyDialogueCameraQuickAction,
  applyDialoguePreviewSchool,
  appendMissionTargetBlueprint,
  applyDialogNpcTableRegistration,
  applyNpcAssetMigration,
  applyNpcSupplement,
  applyBackgroundPropImport,
  clearMissionTargetPreview,
  configureNpcMigrationTarget,
  exportDialogueStoryboard,
  inspectBackgroundPropImport,
  inspectDialogNpcTableRegistration,
  inspectDialogueCameraQuickAction,
  inspectDialoguePreviewSchool,
  inspectDialogueStoryboardExport,
  inspectMissionTargetBlueprint,
  inspectMissionTargetBlueprintCompatibility,
  inspectMissionTargetMap,
  inspectNpcMigrationPlan,
  inspectNpcMigrationTarget,
  inspectNpcSupplementPlan,
  inspectSoundEffectPreview,
  loadMissionTargetPreview,
  openConfigTable,
  populateMissionTargetBlueprint,
  prepareSoundEffectPreview,
  readBlueprintFormation,
  readConfiguredDialogueCsvPayload,
  readDialogueCharacterActions,
  readDialogueCameraPresets,
  readConfiguredMissionTargetPlan,
  readSelectedLevelActors,
  registerBlueprintDialogueModels,
  scanNpcMigrationSource,
  scanNpcSupplementTarget,
  scanSelectedNpcRegistration,
  syncBlueprintPositionsToMissionTargets,
  updateDialogueContent,
  updateDialogueContents,
  updateMissionTargetBlueprintPositions,
  writeNpcRegistrationDraft(rawRequest: Record<string, unknown>) {
    return writeNpcRegistrationDraftToExcel({
      ...rawRequest,
      paths: getConfigTablePaths(),
    });
  },
  updateMissionTargetTransforms(rawRequest: Record<string, unknown>) {
    return updateMissionTargetTransformsInExcel({
      ...rawRequest,
      targetPath: getConfigTablePaths().missionTarget,
    });
  },
};

export type UeServices = typeof ueServices;
