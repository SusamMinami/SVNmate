import {
  updateMissionTargetTransforms as updateMissionTargetTransformsInExcel,
  writeNpcRegistrationDraft as writeNpcRegistrationDraftToExcel,
} from "../excelRegistration";
import { getConfigTablePaths } from "../configRepository";
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
  loadMissionTargetPreview,
  openConfigTable,
  populateMissionTargetBlueprint,
  readBlueprintFormation,
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
