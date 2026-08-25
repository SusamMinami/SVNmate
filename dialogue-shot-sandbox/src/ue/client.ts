import type {
  BackgroundPropImportPreview,
  BackgroundPropImportResult,
  BlueprintFormationSnapshot,
  DialogueContentUpdateRequest,
  DialogueContentUpdateResult,
  DialogueStoryboardExportPreview,
  DialogueStoryboardExportResult,
  DialogueModelRegistrationResult,
  MissionTargetBlueprintToTargetsResult,
  MissionTargetBlueprintCreateResult,
  MissionTargetBlueprintCompatibility,
  MissionTargetBlueprintInspection,
  MissionTargetBlueprintUpdateResult,
  MissionTargetMapStatus,
  MissionTargetUpdateItem,
  MissionTargetUpdateResult,
  MissionTargetPreviewLoadResult,
  MissionTargetPreviewPlan,
  NpcRegistrationScanResult,
  NpcRegistrationWriteItem,
  NpcRegistrationWriteResult,
  NpcRegistrationWriteScope,
  SelectedLevelActorsResult,
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

const FORMATION_LOOKUP_TIMEOUT_MS = 10_000;

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
      ? window.setTimeout(() => controller.abort(), timeoutMs)
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
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
    } finally {
      if (timeout !== null) {
        window.clearTimeout(timeout);
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
      FORMATION_LOOKUP_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      status: "unavailable",
      message:
        error instanceof DOMException && error.name === "AbortError"
          ? "Blueprint 查询超时"
          : bridgeUnavailableMessage(),
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
  mapMode: "require-current" | "auto",
): Promise<MissionTargetPreviewLoadResult> {
  return postUe("/api/ue/mission-targets/load", { plan, mapMode }, false);
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
): Promise<MissionTargetBlueprintCreateResult> {
  return postUe(
    "/api/ue/mission-targets/create-blueprint",
    {
      blueprintName,
      plan,
      selectedTargetIds,
      registerDialogue,
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
): Promise<MissionTargetBlueprintInspection> {
  return postUe("/api/ue/mission-targets/inspect-blueprint", {
    blueprintName,
    plan,
    taskId,
    targetOverrides,
  });
}

export function updateMissionTargetBlueprintPositions(
  blueprintName: string,
  taskId: string,
  selectedTargetIds?: string[],
  targetOverrides?: Array<
    Pick<MissionTargetUpdateItem, "targetId" | "transform">
  >,
): Promise<MissionTargetBlueprintUpdateResult> {
  return postUe(
    "/api/ue/mission-targets/update-blueprint",
    { blueprintName, taskId, selectedTargetIds, targetOverrides },
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
): Promise<MissionTargetBlueprintToTargetsResult> {
  return postUe(
    "/api/ue/mission-targets/update-from-blueprint",
    { blueprintName, taskId, selectedTargetIds, targetOverrides },
    false,
  );
}

export function inspectBackgroundPropImport(
  blueprintName: string,
): Promise<BackgroundPropImportPreview> {
  return postUe("/api/ue/mission-targets/background-props/inspect", {
    blueprintName,
  });
}

export function applyBackgroundPropImport(
  blueprintName: string,
  reviewToken: string,
  selectedActorRefs: string[],
): Promise<BackgroundPropImportResult> {
  return postUe(
    "/api/ue/mission-targets/background-props/apply",
    { blueprintName, reviewToken, selectedActorRefs },
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
): Promise<DialogueModelRegistrationResult> {
  return postUe(
    "/api/ue/mission-targets/register-dialogue",
    {
      blueprintName,
      selectedModelIndexes,
      taskId,
      targetOverrides,
    },
    false,
  );
}

export function inspectDialogueStoryboardExport(
  request: StoryboardExportRequest,
): Promise<DialogueStoryboardExportPreview> {
  return postUe("/api/ue/storyboard/inspect", request);
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

export function checkMissionTargetBlueprint(
  blueprintName: string,
  plan: MissionTargetPreviewPlan,
  selectedTargetIds?: string[],
): Promise<MissionTargetBlueprintCompatibility> {
  return postUe("/api/ue/mission-targets/check-blueprint", {
    blueprintName,
    plan,
    selectedTargetIds,
  });
}

export function readSelectedLevelActors(): Promise<SelectedLevelActorsResult> {
  return postUe("/api/ue/selection/read");
}

export function scanSelectedNpcRegistration(): Promise<NpcRegistrationScanResult> {
  return postUe("/api/ue/selection/registration");
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
