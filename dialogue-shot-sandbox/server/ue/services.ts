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
  applyNpcAssetMigration,
  configureNpcMigrationTarget,
  inspectNpcMigrationPlan,
  inspectNpcMigrationTarget,
  scanNpcMigrationSource,
} from "../npcMigration";
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
  applyNpcAssetMigration,
  applyBackgroundPropImport,
  clearMissionTargetPreview,
  configureNpcMigrationTarget,
  exportDialogueStoryboard,
  inspectBackgroundPropImport,
  inspectDialogueStoryboardExport,
  inspectMissionTargetBlueprint,
  inspectMissionTargetBlueprintCompatibility,
  inspectMissionTargetMap,
  inspectNpcMigrationPlan,
  inspectNpcMigrationTarget,
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
