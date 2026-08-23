import { type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import type {
  BlueprintFormationSlot,
  BlueprintFormationSnapshot,
  MissionTargetPreviewLoadResult,
  MissionTargetPreviewPlan,
} from "../src/types";

const UE_MCP_HOST = process.env.UE_MCP_HOST || "127.0.0.1";
const UE_MCP_PORT = Number.parseInt(process.env.UE_MCP_PORT || "12031", 10);
const CONNECT_TIMEOUT_MS = 1_500;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const PREVIEW_MARKER_CLASS = "/Script/Engine.TargetPoint";
const PREVIEW_ACTOR_PREFIX = "ShotSandboxMissionTargetPreview";

interface UnrealResponse {
  success?: boolean;
  Value?: unknown;
  Output?: { ReturnValue?: unknown };
  errorLogs?: string;
}

export interface UnrealInvoker {
  connect(): Promise<void>;
  invoke(action: string, args: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export interface BlueprintFormationLookup {
  status: "found" | "not_found" | "editor_offline" | "unavailable";
  message: string;
  snapshot?: BlueprintFormationSnapshot;
}

class UnrealMcpConnection implements UnrealInvoker {
  private readonly socket = new net.Socket();
  private buffer = Buffer.alloc(0);
  private expectedLength: number | null = null;
  private waiters: Array<{
    resolve: (value: UnrealResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.destroy();
        reject(new Error("连接 UE 编辑器超时"));
      }, CONNECT_TIMEOUT_MS);
      this.socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.socket.connect(UE_MCP_PORT, UE_MCP_HOST);
    });
    this.socket.on("data", (chunk) =>
      this.consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    this.socket.on("error", (error) => this.rejectAll(error));
    this.socket.on("close", () =>
      this.rejectAll(new Error("UE 编辑器连接已关闭")),
    );
  }

  async invoke(action: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.request({
      proto_type: "tool_call",
      tool_name: "unreal_invoke",
      tool_args: { action, args },
    });
    if (response.success === false) {
      throw new Error(response.errorLogs || `UE 操作失败：${action}`);
    }
    return response.Value ?? response.Output?.ReturnValue;
  }

  close(): void {
    this.socket.end();
  }

  private request(payload: Record<string, unknown>): Promise<UnrealResponse> {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("UE 编辑器响应超时"));
        this.socket.destroy();
      }, REQUEST_TIMEOUT_MS);
      this.waiters.push({ resolve, reject, timer });
      this.socket.write(Buffer.concat([header, body]));
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      if (this.expectedLength === null) {
        if (this.buffer.length < 4) {
          return;
        }
        this.expectedLength = this.buffer.readUInt32BE(0);
        this.buffer = this.buffer.subarray(4);
        if (this.expectedLength > MAX_RESPONSE_BYTES) {
          this.rejectAll(new Error("UE 编辑器响应超过大小限制"));
          this.socket.destroy();
          return;
        }
      }
      if (this.buffer.length < this.expectedLength) {
        return;
      }
      const payload = this.buffer.subarray(0, this.expectedLength);
      this.buffer = this.buffer.subarray(this.expectedLength);
      this.expectedLength = null;
      const waiter = this.waiters.shift();
      if (!waiter) {
        continue;
      }
      clearTimeout(waiter.timer);
      try {
        waiter.resolve(JSON.parse(payload.toString("utf8")) as UnrealResponse);
      } catch {
        waiter.reject(new Error("UE 编辑器返回了无效 JSON"));
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

const VectorSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

const RotatorSchema = z.object({
  pitch: z.number().finite(),
  yaw: z.number().finite(),
  roll: z.number().finite(),
});

const MissionTargetPreviewPlanSchema = z.object({
  taskId: z.string().regex(/^\d+$/),
  taskName: z.string(),
  taskSource: z.enum(["任务表", "副本任务表"]),
  mapId: z.string().regex(/^\d+$/),
  mapName: z.string(),
  mapAssetPath: z.string().startsWith("/Game/"),
  targets: z.array(
    z.object({
      targetId: z.string().regex(/^\d+$/),
      type: z.number().int().nullable(),
      description: z.string(),
      npcId: z.number().int().nullable(),
      npcName: z.string(),
      modelId: z.number().int().nullable(),
      modelClassPath: z.string(),
      itemId: z.number().int().nullable(),
      blueprintModelId: z.number().int().nullable(),
      mapId: z.string().regex(/^\d+$/),
      previewKind: z.enum(["asset", "marker"]),
      transform: z.object({
        location: VectorSchema,
        rotation: RotatorSchema,
        scale: VectorSchema,
      }),
    }),
  ).min(1).max(200),
  warnings: z.array(z.string()),
});

let activeMissionPreviewActors: string[] = [];
let activeMissionPreviewMap = "";

export function resetMissionTargetPreviewState(): void {
  activeMissionPreviewActors = [];
  activeMissionPreviewMap = "";
}

function blueprintAssetPath(classPath: string): string {
  const trimmed = classPath.trim();
  const match = trimmed.match(/^(.*)\.([^.:]+)_C$/);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  if (trimmed.includes(".")) {
    return trimmed;
  }
  const name = trimmed.split("/").at(-1) ?? "";
  return `${trimmed}.${name}`;
}

function blueprintClassPath(assetPath: string): string {
  const match = assetPath.match(/^(.*)\.([^.:]+)$/);
  return match ? `${match[1]}.${match[2]}_C` : `${assetPath}_C`;
}

function hasUnrealObjectReference(value: unknown): boolean {
  if (value === null || value === undefined || value === false) {
    return false;
  }
  if (typeof value !== "string") {
    return true;
  }
  return !["", "none", "null", "nullptr", "0"].includes(
    value.trim().toLowerCase(),
  );
}

function assetPathFromSearch(value: string): string | null {
  return value.match(/\[([^\]]+)\]\s*$/)?.[1] ?? null;
}

function vector(value: unknown): { x: number; y: number; z: number } {
  const item = value as Partial<Record<"X" | "Y" | "Z", unknown>>;
  return {
    x: Number(item?.X ?? 0),
    y: Number(item?.Y ?? 0),
    z: Number(item?.Z ?? 0),
  };
}

function rotator(
  value: unknown,
): { pitch: number; yaw: number; roll: number } {
  const item = value as Partial<
    Record<"Pitch" | "Yaw" | "Roll", unknown>
  >;
  return {
    pitch: Number(item?.Pitch ?? 0),
    yaw: Number(item?.Yaw ?? 0),
    roll: Number(item?.Roll ?? 0),
  };
}

async function resolveAssetPath(
  connection: UnrealInvoker,
  startId: string,
  formationClassPath: string,
): Promise<string | null> {
  if (formationClassPath.trim()) {
    return blueprintAssetPath(formationClassPath);
  }
  const result = await connection.invoke("asset.asset_search", {
    Query: `BP_${startId}`,
    ClassFilter: "Blueprint",
    PathFilter: "/Game/Seria/Task/Mod",
    Limit: 20,
  });
  const exact = (Array.isArray(result) ? result : [])
    .map((value) => assetPathFromSearch(String(value)))
    .find((value) => value?.endsWith(`/BP_${startId}.BP_${startId}`));
  return exact ?? null;
}

async function readProperty(
  connection: UnrealInvoker,
  object: string,
  propertyName: string,
): Promise<unknown> {
  return connection.invoke("reflect.read_object_property", {
    ThisPtr: object,
    PropertyName: propertyName,
  });
}

export async function readBlueprintFormation(
  input: {
    dialogueId: string;
    startId: string;
    formationClassPath?: string;
  },
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<BlueprintFormationLookup> {
  const connection = connectionFactory();
  try {
    await connection.connect();
  } catch {
    return {
      status: "editor_offline",
      message: "未连接 UE4 编辑器，已使用自动站位",
    };
  }
  try {
    const assetPath = await resolveAssetPath(
      connection,
      input.startId,
      input.formationClassPath ?? "",
    );
    if (!assetPath) {
      return {
        status: "not_found",
        message: `未找到 BP_${input.startId}`,
      };
    }
    const loaded = await connection.invoke("bp.get_blueprint_by_path", {
      AssetPath: assetPath,
    });
    if (!hasUnrealObjectReference(loaded)) {
      return {
        status: "not_found",
        message: `UE 中未找到 ${assetPath}`,
      };
    }
    const classPath = blueprintClassPath(assetPath);
    const nodes = await readProperty(
      connection,
      `${classPath}:SimpleConstructionScript_0`,
      "AllNodes",
    );
    const warnings: string[] = [];
    const slots: BlueprintFormationSlot[] = [];
    for (const nodeValue of Array.isArray(nodes) ? nodes : []) {
      const node = String(nodeValue);
      const variableName = await readProperty(
        connection,
        node,
        "InternalVariableName",
      );
      const componentClass = await readProperty(
        connection,
        node,
        "ComponentClass",
      );
      const componentTemplate = await readProperty(
        connection,
        node,
        "ComponentTemplate",
      );
      const componentGuid = await readProperty(
        connection,
        node,
        "VariableGuid",
      );
      if (
        !/^\d+$/.test(String(variableName)) ||
        !String(componentClass).endsWith("ChildActorComponent") ||
        !hasUnrealObjectReference(componentTemplate)
      ) {
        continue;
      }
      const location = await readProperty(
        connection,
        String(componentTemplate),
        "RelativeLocation",
      );
      const rotation = await readProperty(
        connection,
        String(componentTemplate),
        "RelativeRotation",
      );
      const scale = await readProperty(
        connection,
        String(componentTemplate),
        "RelativeScale3D",
      );
      const modelClassPath = await readProperty(
        connection,
        String(componentTemplate),
        "ChildActorClass",
      );
      slots.push({
        modelIndex: Number(variableName),
        componentName: String(componentTemplate),
        componentGuid: String(componentGuid),
        modelClassPath: String(modelClassPath ?? ""),
        transform: {
          location: vector(location),
          rotation: rotator(rotation),
          scale: vector(scale),
        },
      });
    }
    if (slots.length === 0) {
      warnings.push("Blueprint 中没有数字命名的 ChildActorComponent 站位槽");
    }
    return {
      status: slots.length > 0 ? "found" : "unavailable",
      message:
        slots.length > 0
          ? `已读取 ${slots.length} 个 BP 站位槽`
          : warnings[0],
      snapshot: {
        dialogueId: input.dialogueId,
        blueprintAssetPath: assetPath,
        blueprintClassPath: classPath,
        slots: slots.sort((left, right) => left.modelIndex - right.modelIndex),
        warnings,
      },
    };
  } catch (error) {
    return {
      status: "unavailable",
      message:
        error instanceof Error ? error.message : "无法读取 Blueprint 站位",
    };
  } finally {
    connection.close();
  }
}

function normalizeLevelPath(value: string): string {
  return value
    .trim()
    .replaceAll("\\", "/")
    .replace(/\.umap$/i, "")
    .split(".")[0]
    .toLowerCase();
}

function scriptResult(value: unknown): string {
  const result = value as {
    bSuccess?: boolean;
    Result?: unknown;
    Message?: unknown;
  };
  if (result?.bSuccess === false) {
    throw new Error(String(result.Message || "UE Python 查询失败"));
  }
  return String(result?.Result ?? "");
}

async function currentMapName(connection: UnrealInvoker): Promise<string> {
  const value = await connection.invoke("editor.get_current_map_name", {});
  const mapName = String(value ?? "").trim();
  if (!mapName) {
    throw new Error("无法读取 UE 当前关卡");
  }
  return mapName;
}

async function dirtyMapPackages(
  connection: UnrealInvoker,
): Promise<string[]> {
  const value = await connection.invoke("script.eval_python_expression", {
    Expression:
      "__import__('json').dumps([p.get_path_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()])",
  });
  try {
    const rawResult = scriptResult(value).trim();
    const serialized =
      rawResult.startsWith("'") && rawResult.endsWith("'")
        ? rawResult.slice(1, -1)
        : rawResult;
    const parsed = JSON.parse(serialized) as unknown;
    if (
      !Array.isArray(parsed) ||
      !parsed.every((item) => typeof item === "string")
    ) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error("无法确认当前关卡是否存在未保存修改，已停止自动切图");
  }
}

function actorName(taskId: string, targetId: string): string {
  return `${PREVIEW_ACTOR_PREFIX}_${taskId}_${targetId}`;
}

function assertSinglePreviewMap(plan: MissionTargetPreviewPlan): void {
  const conflicting = plan.targets.filter(
    (target) => target.mapId !== plan.mapId,
  );
  if (conflicting.length > 0) {
    throw new Error(
      `任务节点 ${plan.taskId} 的目标物 MapID 不一致，已停止加载`,
    );
  }
}

async function connectUnreal(connection: UnrealInvoker): Promise<void> {
  try {
    await connection.connect();
  } catch {
    connection.close();
    throw new Error(
      `无法连接 UE 编辑器 OmniMcpCore（${UE_MCP_HOST}:${UE_MCP_PORT}），请确认 UE 编辑器和插件正在运行`,
    );
  }
}

async function deletePreviewActors(
  connection: UnrealInvoker,
  actors: string[],
): Promise<void> {
  if (actors.length === 0) {
    return;
  }
  await connection.invoke("world.delete_actors", { Actors: actors });
}

export async function clearMissionTargetPreview(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<{ clearedCount: number }> {
  if (activeMissionPreviewActors.length === 0) {
    return { clearedCount: 0 };
  }
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const currentMap = normalizeLevelPath(await currentMapName(connection));
    if (currentMap !== normalizeLevelPath(activeMissionPreviewMap)) {
      const staleCount = activeMissionPreviewActors.length;
      activeMissionPreviewActors = [];
      activeMissionPreviewMap = "";
      return { clearedCount: staleCount };
    }
    const actors = [...activeMissionPreviewActors];
    await deletePreviewActors(connection, actors);
    activeMissionPreviewActors = [];
    activeMissionPreviewMap = "";
    return { clearedCount: actors.length };
  } finally {
    connection.close();
  }
}

export async function loadMissionTargetPreview(
  rawPlan: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<MissionTargetPreviewLoadResult> {
  const plan = MissionTargetPreviewPlanSchema.parse(
    rawPlan,
  ) as MissionTargetPreviewPlan;
  assertSinglePreviewMap(plan);

  const connection = connectionFactory();
  await connectUnreal(connection);
  let spawnedActors: string[] = [];
  try {
    const assetTargets = plan.targets.filter(
      (target) =>
        target.previewKind === "asset" && target.modelClassPath,
    );
    for (const target of assetTargets) {
      const asset = await connection.invoke("asset.get_asset_by_path", {
        AssetPath: blueprintAssetPath(target.modelClassPath),
      });
      if (!hasUnrealObjectReference(asset)) {
        throw new Error(
          `目标物 ${target.targetId} 的模型资产不存在：${target.modelClassPath}`,
        );
      }
    }

    const expectedMap = normalizeLevelPath(plan.mapAssetPath);
    let currentMap = normalizeLevelPath(await currentMapName(connection));
    let autoOpenedMap = false;
    if (currentMap !== expectedMap) {
      const dirtyPackages = await dirtyMapPackages(connection);
      if (dirtyPackages.length > 0) {
        throw new Error(
          `当前关卡存在未保存修改（${dirtyPackages.join("，")}），请处理后再自动打开 ${plan.mapName}`,
        );
      }
      activeMissionPreviewActors = [];
      activeMissionPreviewMap = "";
      await connection.invoke("world.open_level", {
        LevelName: plan.mapAssetPath,
      });
      currentMap = normalizeLevelPath(await currentMapName(connection));
      if (currentMap !== expectedMap) {
        throw new Error(
          `自动打开地图失败：期望 ${plan.mapAssetPath}，当前 ${currentMap}`,
        );
      }
      autoOpenedMap = true;
    }

    if (
      activeMissionPreviewActors.length > 0 &&
      normalizeLevelPath(activeMissionPreviewMap) === currentMap
    ) {
      await deletePreviewActors(connection, activeMissionPreviewActors);
      activeMissionPreviewActors = [];
      activeMissionPreviewMap = "";
    }

    for (const target of plan.targets) {
      const actor = await connection.invoke("world.spawn_actor", {
        ClassPath:
          target.previewKind === "asset" && target.modelClassPath
            ? target.modelClassPath
            : PREVIEW_MARKER_CLASS,
        ActorName: actorName(plan.taskId, target.targetId),
        Location: {
          X: target.transform.location.x,
          Y: target.transform.location.y,
          Z: target.transform.location.z,
        },
        Rotation: {
          Pitch: target.transform.rotation.pitch,
          Yaw: target.transform.rotation.yaw,
          Roll: target.transform.rotation.roll,
        },
        Scale: {
          X: target.transform.scale.x,
          Y: target.transform.scale.y,
          Z: target.transform.scale.z,
        },
      });
      if (!hasUnrealObjectReference(actor)) {
        throw new Error(`目标物 ${target.targetId} 生成预览对象失败`);
      }
      const actorReference = String(actor);
      spawnedActors.push(actorReference);
      await connection.invoke("reflect.write_object_property", {
        ThisPtr: actorReference,
        PropertyName: "bIsEditorOnlyActor",
        Value: true,
      });
    }

    activeMissionPreviewActors = spawnedActors;
    activeMissionPreviewMap = plan.mapAssetPath;
    return {
      status: "loaded",
      taskId: plan.taskId,
      mapId: plan.mapId,
      mapAssetPath: plan.mapAssetPath,
      autoOpenedMap,
      spawnedCount: spawnedActors.length,
      assetCount: plan.targets.filter(
        (target) => target.previewKind === "asset",
      ).length,
      markerCount: plan.targets.filter(
        (target) => target.previewKind === "marker",
      ).length,
    };
  } catch (error) {
    if (spawnedActors.length > 0) {
      try {
        await deletePreviewActors(connection, spawnedActors);
      } catch (cleanupError) {
        throw new Error(
          `${error instanceof Error ? error.message : "目标物预览加载失败"}；清理已生成对象失败：${
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError)
          }`,
        );
      }
    }
    throw error;
  } finally {
    connection.close();
  }
}

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
): Promise<boolean> {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/ue/")) {
    return false;
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
        data: await clearMissionTargetPreview(),
      });
      return true;
    }
    const body = (await readJson(request)) as Record<string, unknown>;
    if (url.pathname === "/api/ue/mission-targets/load") {
      sendJson(response, 200, {
        ok: true,
        data: await loadMissionTargetPreview(body),
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
        data: await readBlueprintFormation({
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
