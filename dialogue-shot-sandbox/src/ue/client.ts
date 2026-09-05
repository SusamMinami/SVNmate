import type {
  BackgroundPropImportPreview,
  BackgroundPropImportResult,
  BlueprintFormationSnapshot,
  DialogueCharacterActionSnapshot,
  DialogueContentBatchUpdateRequest,
  DialogueContentBatchUpdateResult,
  DialogueContentUpdateRequest,
  DialogueContentUpdateResult,
  DialogueStoryboardExportPreview,
  DialogueStoryboardExportResult,
  DialogueModelRegistrationResult,
  DialogueModelRegistrationSlot,
  DialogNpcTableRegistrationDraft,
  DialogNpcTableRegistrationResult,
  DialogNpcTableRegistrationReview,
  DialoguePositionTimelineRow,
  MissionTargetBlueprintToTargetsResult,
  MissionTargetBlueprintAppendResult,
  MissionTargetBlueprintCreateResult,
  MissionTargetBlueprintCompatibility,
  MissionTargetBlueprintInspection,
  MissionTargetBlueprintUpdateResult,
  MissionTargetMapStatus,
  MissionTargetUpdateItem,
  MissionTargetUpdateResult,
  MissionTargetPreviewLoadResult,
  MissionTargetPreviewPlan,
  NpcMigrationCopyResult,
  NpcMigrationPlan,
  NpcMigrationPlanRequest,
  NpcMigrationSourceScan,
  NpcMigrationTargetInspection,
  NpcMigrationTargetRequest,
  NpcMigrationTargetResult,
  NpcSupplementApplyResult,
  NpcSupplementPlan,
  NpcSupplementPlanRequest,
  NpcSupplementTarget,
  NpcRegistrationScanResult,
  NpcRegistrationWriteItem,
  NpcRegistrationWriteResult,
  NpcRegistrationWriteScope,
  SelectedLevelActorsResult,
  SoundEffectPreviewInfo,
  SoundEffectPreviewPrepared,
  StoryboardExportRequest,
} from "../types";

export interface BlueprintFormationLookup {
  status: "found" | "not_found" | "editor_offline" | "unavailable";
  message: string;
  snapshot?: BlueprintFormationSnapshot;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { message?: string };
}

async function fetchUe(
  path: string,
  init: RequestInit,
  timeoutMs?: number,
  attempts = 2,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = timeoutMs ? new AbortController() : null;
    const timeout = controller
      ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      return await fetch(path, {
        ...init,
        signal: controller?.signal ?? init.signal,
      });
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => globalThis.setTimeout(resolve, 600));
      }
    } finally {
      if (timeout !== null) {
        globalThis.clearTimeout(timeout);
      }
    }
  }
  throw lastError;
}

function bridgeUnavailableMessage(): string {
  if (window.location.protocol === "file:") {
    return "不能直接打开 HTML 文件使用 UE 功能，请通过镜头沙盘开发服务或桌面版启动";
  }
  return `无法连接 ${window.location.origin} 的 UE 桥接服务，请刷新页面并确认镜头沙盘服务仍在运行`;
}

export async function getBlueprintFormation(input: {
  dialogueId: string;
  startId: string;
  formationClassPath?: string;
}): Promise<BlueprintFormationLookup> {
  let response: Response;
  try {
    response = await fetchUe(
      "/api/ue/formation/read",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  } catch (error) {
    return {
      status: "unavailable",
      message: bridgeUnavailableMessage(),
    };
  }
  const body = (await response.json().catch(() => null)) as
    | ApiEnvelope<BlueprintFormationLookup>
    | null;
  if (!response.ok || !body?.ok || !body.data) {
    return {
      status: "unavailable",
      message:
        body?.error?.message ||
        `Blueprint 查询失败（HTTP ${response.status}）`,
    };
  }
  return body.data;
}

async function postUe<T>(
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchUe(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, undefined, retry ? 2 : 1);
  } catch {
    throw new Error(bridgeUnavailableMessage());
  }
  const result = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | null;
  if (!response.ok || !result?.ok || !result.data) {
    throw new Error(
      result?.error?.message || `UE 集成操作失败（HTTP ${response.status}）`,
    );
  }
  return result.data;
}

export function loadMissionTargetPreview(
  plan: MissionTargetPreviewPlan,
  mapMode: "require-current" | "auto" | "current",
): Promise<MissionTargetPreviewLoadResult> {
  return postUe("/api/ue/mission-targets/load", { plan, mapMode }, false);
}

export function refreshMissionTargetPlan(
  taskId: string,
): Promise<MissionTargetPreviewPlan> {
  return postUe("/api/ue/mission-targets/resolve", { taskId }, false);
}

export function inspectMissionTargetMap(
  mapAssetPath: string,
): Promise<MissionTargetMapStatus> {
  return postUe("/api/ue/mission-targets/map-status", { mapAssetPath });
}

export function createMissionTargetBlueprint(
  blueprintName: string,
  plan: MissionTargetPreviewPlan,
  selectedTargetIds?: string[],
  registerDialogue = false,
  dialogueId?: string,
): Promise<MissionTargetBlueprintCreateResult> {
  return postUe(
    "/api/ue/mission-targets/create-blueprint",
    {
      blueprintName,
      plan,
      selectedTargetIds,
      registerDialogue,
      dialogueId,
    },
    false,
  );
}

export function appendMissionTargetBlueprint(
  blueprintName: string,
  plan: MissionTargetPreviewPlan,
  selectedTargetIds: string[],
  dialogueId?: string,
): Promise<MissionTargetBlueprintAppendResult> {
  return postUe(
    "/api/ue/mission-targets/append-blueprint",
    {
      blueprintName,
      plan,
      selectedTargetIds,
      dialogueId,
    },
    false,
  );
}

export function inspectMissionTargetBlueprint(
  blueprintName: string,
  plan?: MissionTargetPreviewPlan,
  taskId?: string,
  targetOverrides?: Array<
    Pick<MissionTargetUpdateItem, "targetId" | "transform">
  >,
  dialogueId?: string,
  dialogueTimeline?: DialoguePositionTimelineRow[],
): Promise<MissionTargetBlueprintInspection> {
  return postUe("/api/ue/mission-targets/inspect-blueprint", {
    blueprintName,
    plan,
    taskId,
    targetOverrides,
    dialogueId,
    dialogueTimeline,
  });
}

export function updateMissionTargetBlueprintPositions(
  blueprintName: string,
  taskId: string,
  selectedTargetIds?: string[],
  targetOverrides?: Array<
    Pick<MissionTargetUpdateItem, "targetId" | "transform">
  >,
  dialogueId?: string,
): Promise<MissionTargetBlueprintUpdateResult> {
  return postUe(
    "/api/ue/mission-targets/update-blueprint",
    { blueprintName, taskId, selectedTargetIds, targetOverrides, dialogueId },
    false,
  );
}

export function updateMissionTargetsFromBlueprint(
  blueprintName: string,
  taskId: string,
  selectedTargetIds?: string[],
  targetOverrides?: Array<
    Pick<MissionTargetUpdateItem, "targetId" | "transform">
  >,
  dialogueId?: string,
): Promise<MissionTargetBlueprintToTargetsResult> {
  return postUe(
    "/api/ue/mission-targets/update-from-blueprint",
    { blueprintName, taskId, selectedTargetIds, targetOverrides, dialogueId },
    false,
  );
}

export function inspectBackgroundPropImport(
  blueprintName: string,
  actorRefs?: string[],
  dialogueId?: string,
  taskId?: string,
): Promise<BackgroundPropImportPreview> {
  return postUe("/api/ue/mission-targets/background-props/inspect", {
    blueprintName,
    actorRefs,
    dialogueId,
    taskId,
  });
}

export function applyBackgroundPropImport(
  blueprintName: string,
  reviewToken: string,
  selectedActorRefs: string[],
  reviewedActorRefs?: string[],
  dialogueId?: string,
  taskId?: string,
): Promise<BackgroundPropImportResult> {
  return postUe(
    "/api/ue/mission-targets/background-props/apply",
    {
      blueprintName,
      reviewToken,
      selectedActorRefs,
      reviewedActorRefs,
      dialogueId,
      taskId,
    },
    false,
  );
}

export function registerBlueprintDialogueModels(
  blueprintName: string,
  selectedModelIndexes: number[],
  taskId?: string,
  targetOverrides?: Array<
    Pick<MissionTargetUpdateItem, "targetId" | "transform">
  >,
  preserveModels = false,
  dialogueId?: string,
): Promise<DialogueModelRegistrationResult> {
  return postUe(
    "/api/ue/mission-targets/register-dialogue",
    {
      blueprintName,
      selectedModelIndexes,
      taskId,
      targetOverrides,
      ...(preserveModels ? { preserveModels: true } : {}),
      dialogueId,
    },
    false,
  );
}

export function inspectDialogNpcTableRegistration(
  slots: Array<
    Pick<
      DialogueModelRegistrationSlot,
      "modelIndex" | "targetId" | "modelClassPath"
    >
  >,
): Promise<DialogNpcTableRegistrationReview> {
  return postUe(
    "/api/ue/mission-targets/dialog-npc-table/inspect",
    { slots },
    false,
  );
}

export function applyDialogNpcTableRegistration(
  reviewToken: string,
  rows: Array<
    Pick<
      DialogNpcTableRegistrationDraft,
      | "rowName"
      | "characterClassPath"
      | "animClassPath"
      | "cameraClassPath"
      | "meshPath"
    >
  >,
): Promise<DialogNpcTableRegistrationResult> {
  return postUe(
    "/api/ue/mission-targets/dialog-npc-table/apply",
    { reviewToken, rows },
    false,
  );
}

export function inspectDialogueStoryboardExport(
  request: StoryboardExportRequest,
): Promise<DialogueStoryboardExportPreview> {
  return postUe("/api/ue/storyboard/inspect", request);
}

export function readDialogueCharacterActions(request: {
  startId: string;
  dialogueIds: string[];
  models: Array<{
    modelIndex: number;
    blueprintClassPath: string;
  }>;
}): Promise<DialogueCharacterActionSnapshot> {
  return postUe("/api/ue/npc-actions/read", request);
}

export function inspectSoundEffectPreview(
  assetName: string,
): Promise<SoundEffectPreviewInfo> {
  return postUe("/api/ue/sound-effects/preview-info", { assetName });
}

export function prepareSoundEffectPreview(
  assetName: string,
): Promise<SoundEffectPreviewPrepared> {
  return postUe(
    "/api/ue/sound-effects/preview-prepare",
    { assetName },
    false,
  );
}

export function exportDialogueStoryboard(
  request: StoryboardExportRequest,
  reviewToken: string,
): Promise<DialogueStoryboardExportResult> {
  return postUe(
    "/api/ue/storyboard/export",
    { ...request, reviewToken },
    false,
  );
}

export function updateDialogueContent(
  request: DialogueContentUpdateRequest,
): Promise<DialogueContentUpdateResult> {
  return postUe("/api/ue/dialogue/content", request, false);
}

export function updateDialogueContents(
  request: DialogueContentBatchUpdateRequest,
): Promise<DialogueContentBatchUpdateResult> {
  return postUe("/api/ue/dialogue/content/batch", request, false);
}

export function checkMissionTargetBlueprint(
  blueprintName: string,
  plan: MissionTargetPreviewPlan,
  selectedTargetIds?: string[],
  dialogueId?: string,
): Promise<MissionTargetBlueprintCompatibility> {
  return postUe("/api/ue/mission-targets/check-blueprint", {
    blueprintName,
    plan,
    selectedTargetIds,
    dialogueId,
  });
}

export function readSelectedLevelActors(): Promise<SelectedLevelActorsResult> {
  return postUe("/api/ue/selection/read");
}

export function scanSelectedNpcRegistration(): Promise<NpcRegistrationScanResult> {
  return postUe("/api/ue/selection/registration");
}

export function scanNpcMigrationSource(): Promise<NpcMigrationSourceScan> {
  return postUe("/api/ue/npc-migration/source-scan", undefined, false);
}

export function inspectNpcMigrationPlan(
  request: NpcMigrationPlanRequest,
): Promise<NpcMigrationPlan> {
  return postUe("/api/ue/npc-migration/plan", request, false);
}

export function applyNpcAssetMigration(
  plan: NpcMigrationPlan,
): Promise<NpcMigrationCopyResult> {
  return postUe(
    "/api/ue/npc-migration/migrate",
    { plan, reviewToken: plan.reviewToken },
    false,
  );
}

export function inspectNpcMigrationTarget(
  request: NpcMigrationTargetRequest,
): Promise<NpcMigrationTargetInspection> {
  return postUe("/api/ue/npc-migration/target-inspect", request, false);
}

export function configureNpcMigrationTarget(
  request: NpcMigrationTargetRequest,
): Promise<NpcMigrationTargetResult> {
  return postUe(
    "/api/ue/npc-migration/target-configure",
    request,
    false,
  );
}

export function scanNpcSupplementTarget(): Promise<NpcSupplementTarget> {
  return postUe(
    "/api/ue/npc-migration/supplement-target",
    undefined,
    false,
  );
}

export function inspectNpcSupplementPlan(
  request: NpcSupplementPlanRequest,
): Promise<NpcSupplementPlan> {
  return postUe(
    "/api/ue/npc-migration/supplement-plan",
    request,
    false,
  );
}

export function applyNpcSupplement(
  plan: NpcSupplementPlan,
): Promise<NpcSupplementApplyResult> {
  return postUe(
    "/api/ue/npc-migration/supplement-apply",
    { plan, reviewToken: plan.reviewToken },
    false,
  );
}

export function openConfigTable(
  table: "missionTarget" | "npc" | "model",
): Promise<{ table: string; path: string }> {
  return postUe("/api/ue/config-table/open", { table });
}

export function writeNpcRegistrationDraft(
  items: NpcRegistrationWriteItem[],
  scope: NpcRegistrationWriteScope = "all",
): Promise<NpcRegistrationWriteResult> {
  return postUe(
    "/api/ue/config-registration/write",
    { items, scope },
    false,
  );
}

export function updateMissionTargetTransforms(
  items: MissionTargetUpdateItem[],
): Promise<MissionTargetUpdateResult> {
  return postUe(
    "/api/ue/config-registration/update-targets",
    { items },
    false,
  );
}

export function clearMissionTargetPreview(): Promise<{
  clearedCount: number;
}> {
  return postUe("/api/ue/mission-targets/clear");
}
