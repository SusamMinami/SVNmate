import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { streamAudioFile } from "../audioStream";
import { ueServices, type UeServices } from "./services";

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function routeUeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  services: UeServices = ueServices,
): Promise<boolean> {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/ue/")) {
    return false;
  }
  if (
    request.method === "GET" &&
    url.pathname === "/api/ue/sound-effects/preview-file"
  ) {
    try {
      const assetName = url.searchParams.get("assetName") ?? "";
      const preview = await services.prepareSoundEffectPreview(assetName);
      await streamAudioFile(
        request,
        response,
        preview.filePath,
        `${preview.assetName}.wav`,
      );
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: {
          message:
            error instanceof Error ? error.message : "音效试听文件读取失败",
        },
      });
    }
    return true;
  }
  if (request.method !== "POST") {
    sendJson(response, 404, {
      ok: false,
      error: { message: "未知 UE 集成 API" },
    });
    return true;
  }
  try {
    if (url.pathname === "/api/ue/mission-targets/clear") {
      sendJson(response, 200, {
        ok: true,
        data: await services.clearMissionTargetPreview(),
      });
      return true;
    }
    if (url.pathname === "/api/ue/selection/read") {
      sendJson(response, 200, {
        ok: true,
        data: await services.readSelectedLevelActors(),
      });
      return true;
    }
    if (url.pathname === "/api/ue/selection/registration") {
      sendJson(response, 200, {
        ok: true,
        data: await services.scanSelectedNpcRegistration(),
      });
      return true;
    }
    const body = (await readJson(request)) as Record<string, unknown>;
    if (url.pathname === "/api/ue/sound-effects/preview-info") {
      sendJson(response, 200, {
        ok: true,
        data: await services.inspectSoundEffectPreview(
          String(body.assetName ?? ""),
        ),
      });
      return true;
    }
    if (url.pathname === "/api/ue/sound-effects/preview-prepare") {
      const preview = await services.prepareSoundEffectPreview(
        String(body.assetName ?? ""),
      );
      sendJson(response, 200, {
        ok: true,
        data: {
          assetName: preview.assetName,
          available: preview.available,
          reason: preview.reason,
          durationSeconds: preview.durationSeconds,
          mediaCount: preview.mediaCount,
          url: preview.url,
        },
      });
      return true;
    }
    if (url.pathname === "/api/ue/storyboard/inspect") {
      sendJson(response, 200, {
        ok: true,
        data: await services.inspectDialogueStoryboardExport(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/npc-actions/read") {
      sendJson(response, 200, {
        ok: true,
        data: await services.readDialogueCharacterActions(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/storyboard/export") {
      sendJson(response, 200, {
        ok: true,
        data: await services.exportDialogueStoryboard(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/dialogue/content") {
      sendJson(response, 200, {
        ok: true,
        data: await services.updateDialogueContent(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/dialogue/content/batch") {
      sendJson(response, 200, {
        ok: true,
        data: await services.updateDialogueContents(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/config-data/read") {
      sendJson(response, 200, {
        ok: true,
        data: await services.readConfiguredDialogueCsvPayload(),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/resolve") {
      sendJson(response, 200, {
        ok: true,
        data: await services.readConfiguredMissionTargetPlan(
          String(body.taskId ?? ""),
        ),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/map-status") {
      sendJson(response, 200, {
        ok: true,
        data: await services.inspectMissionTargetMap(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/load") {
      sendJson(response, 200, {
        ok: true,
        data: await services.loadMissionTargetPreview(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/create-blueprint") {
      sendJson(response, 200, {
        ok: true,
        data: await services.populateMissionTargetBlueprint(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/append-blueprint") {
      sendJson(response, 200, {
        ok: true,
        data: await services.appendMissionTargetBlueprint(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/inspect-blueprint") {
      sendJson(response, 200, {
        ok: true,
        data: await services.inspectMissionTargetBlueprint(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/update-blueprint") {
      sendJson(response, 200, {
        ok: true,
        data: await services.updateMissionTargetBlueprintPositions(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/update-from-blueprint") {
      sendJson(response, 200, {
        ok: true,
        data: await services.syncBlueprintPositionsToMissionTargets(body),
      });
      return true;
    }
    if (
      url.pathname ===
      "/api/ue/mission-targets/background-props/inspect"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: await services.inspectBackgroundPropImport(body),
      });
      return true;
    }
    if (
      url.pathname ===
      "/api/ue/mission-targets/background-props/apply"
    ) {
      sendJson(response, 200, {
        ok: true,
        data: await services.applyBackgroundPropImport(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/register-dialogue") {
      sendJson(response, 200, {
        ok: true,
        data: await services.registerBlueprintDialogueModels(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/check-blueprint") {
      sendJson(response, 200, {
        ok: true,
        data: await services.inspectMissionTargetBlueprintCompatibility(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/config-table/open") {
      sendJson(response, 200, {
        ok: true,
        data: await services.openConfigTable(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/config-registration/write") {
      sendJson(response, 200, {
        ok: true,
        data: await services.writeNpcRegistrationDraft(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/config-registration/update-targets") {
      sendJson(response, 200, {
        ok: true,
        data: await services.updateMissionTargetTransforms(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/formation/read") {
      const dialogueId = String(body.dialogueId ?? "");
      const startId = String(body.startId ?? "");
      const formationClassPath = String(body.formationClassPath ?? "");
      if (!/^\d{4}$/.test(dialogueId) || !/^\d{4,}$/.test(startId)) {
        throw new Error("对话 ID 或开始节点 ID 无效");
      }
      sendJson(response, 200, {
        ok: true,
        data: await services.readBlueprintFormation({
          dialogueId,
          startId,
          formationClassPath,
        }),
      });
      return true;
    }
    sendJson(response, 404, {
      ok: false,
      error: { message: "未知 UE 集成 API" },
    });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: {
        message:
          error instanceof Error ? error.message : "UE 集成操作失败",
      },
    });
  }
  return true;
}

function installMiddleware(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use(async (request, response, next) => {
    if (!(await routeUeRequest(request, response))) {
      next();
    }
  });
}

export function ueBridgePlugin(): Plugin {
  return {
    name: "ue-blueprint-formation-bridge",
    configureServer(server) {
      installMiddleware(server);
    },
    configurePreviewServer(server) {
      installMiddleware(server);
    },
  };
}
