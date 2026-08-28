import {
  updateMissionTargetTransforms as updateMissionTargetTransformsInExcel,
  writeNpcRegistrationDraft as writeNpcRegistrationDraftToExcel,
} from "../excelRegistration";
import { getConfigTablePaths } from "../configRepository";
import {
  inspectSoundEffectPreview,
  prepareSoundEffectPreview,
} from "../soundEffectPreview";
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
  applyBackgroundPropImport,
  clearMissionTargetPreview,
  exportDialogueStoryboard,
  inspectBackgroundPropImport,
  inspectDialogueStoryboardExport,
  inspectMissionTargetBlueprint,
  inspectMissionTargetBlueprintCompatibility,
  inspectMissionTargetMap,
  inspectSoundEffectPreview,
  loadMissionTargetPreview,
  openConfigTable,
  populateMissionTargetBlueprint,
  prepareSoundEffectPreview,
  readBlueprintFormation,
  readDialogueCharacterActions,
  readSelectedLevelActors,
  registerBlueprintDialogueModels,
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
