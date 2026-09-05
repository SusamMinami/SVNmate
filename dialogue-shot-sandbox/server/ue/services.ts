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
import {
  appendMissionTargetBlueprint,
  applyBackgroundPropImport,
  clearMissionTargetPreview,
  exportDialogueStoryboard,
  inspectBackgroundPropImport,
  inspectDialogueStoryboardExport,
  inspectMissionTargetBlueprint,
  inspectMissionTargetBlueprintCompatibility,
  inspectMissionTargetMap,
  loadMissionTargetPreview,
  openConfigTable,
  populateMissionTargetBlueprint,
  readBlueprintFormation,
  readDialogueCharacterActions,
  readSelectedLevelActors,
  registerBlueprintDialogueModels,
  scanSelectedNpcRegistration,
  syncBlueprintPositionsToMissionTargets,
  updateDialogueContent,
  updateDialogueContents,
  updateMissionTargetBlueprintPositions,
} from "../ueBridge";

export const ueServices = {
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
