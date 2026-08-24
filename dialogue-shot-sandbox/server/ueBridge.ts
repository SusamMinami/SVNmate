import { type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, unlink } from "node:fs/promises";
import net from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { z } from "zod";
import type {
  BlueprintFormationSlot,
  BlueprintFormationSnapshot,
  DialogueStoryboardExportPreview,
  DialogueStoryboardExportResult,
  DialogueModelRegistrationResult,
  DialogueModelRegistrationSlot,
  MissionTargetBlueprintCreateResult,
  MissionTargetBlueprintCompatibility,
  MissionTargetBlueprintInspection,
  MissionTargetMapStatus,
  MissionTargetPreviewLoadResult,
  MissionTargetPreviewPlan,
  MissionTargetPreviewTarget,
  NpcRegistrationScanResult,
  SelectedLevelActor,
  SelectedLevelActorsResult,
  StoryboardExportNodePreview,
  StoryboardExportRequest,
  UnrealTransform,
} from "../src/types";
import { parseNpcRegistrationDatabase } from "../src/data/csv";
import { buildNpcRegistrationCandidates } from "../src/data/npcRegistration";
import {
  updateMissionTargetTransforms,
  writeNpcRegistrationDraft,
} from "./excelRegistration";

const UE_MCP_HOST = process.env.UE_MCP_HOST || "127.0.0.1";
const DEFAULT_UE_MCP_PORT = 12031;
const environmentUeMcpPort = Number.parseInt(
  process.env.UE_MCP_PORT || String(DEFAULT_UE_MCP_PORT),
  10,
);
let ueMcpPort =
  Number.isInteger(environmentUeMcpPort) &&
  environmentUeMcpPort >= 1 &&
  environmentUeMcpPort <= 65_535
    ? environmentUeMcpPort
    : DEFAULT_UE_MCP_PORT;
const CONNECT_TIMEOUT_MS = 1_500;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const PREVIEW_MARKER_CLASS = "/Script/Engine.TargetPoint";
const PREVIEW_ACTOR_PREFIX = "ShotSandboxMissionTargetPreview";
const BLUEPRINT_SEARCH_PATH = "/Game/Seria/Task/Mod";
const POSITION_MODE_BASE_CLASS =
  "/Game/Seria/Task/Mod/PositionMode/PositionModeBase.PositionModeBase_C";
const PLAYER_CLASS =
  "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C";
const CHILD_ACTOR_COMPONENT_CLASS = "/Script/Engine.ChildActorComponent";
const CAMERA_COMPONENT_CLASS = "/Script/Engine.CameraComponent";
const DIALOGUE_SEARCH_PATH = "/Game/Seria/Task/dialoggraph";
const DIALOG_NPC_TABLE_PATH =
  "/Game/Seria/Task/Mod/DialogNPCTable.DialogNPCTable";
const DEFAULT_CONFIG_CSV_DIRECTORY = "C:\\trunk\\doc\\csvdir";
let configCsvDirectory = DEFAULT_CONFIG_CSV_DIRECTORY;

export function configureConfigCsvDirectory(directoryPath: string): void {
  const normalized = resolve(directoryPath.trim());
  configCsvDirectory =
    basename(normalized).toLowerCase() === "csvdir"
      ? normalized
      : join(normalized, "csvdir");
}

export function getConfigCsvDirectory(): string {
  return configCsvDirectory;
}

function configCsvPaths() {
  return {
    npc: join(configCsvDirectory, "NPC表.csv"),
    model: join(configCsvDirectory, "m模型资源表.csv"),
    missionTarget: join(configCsvDirectory, "m目标物表.csv"),
    map: join(configCsvDirectory, "d地图配置表.csv"),
    scene: join(configCsvDirectory, "d地图资源表.csv"),
  };
}

export function getConfigTablePaths() {
  const xlsDirectory = join(dirname(configCsvDirectory), "xlsdir");
  return {
    missionTarget: join(xlsDirectory, "r任务剧情", "m目标物表.xlsm"),
    npc: join(xlsDirectory, "NPC表.xlsm"),
    model: join(xlsDirectory, "m模型资源表.xlsm"),
  };
}

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

export function getUnrealMcpEndpoint(): { host: string; port: number } {
  return { host: UE_MCP_HOST, port: ueMcpPort };
}

export function configureUnrealMcpPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("UE MCP 端口必须是 1-65535 的整数");
  }
  ueMcpPort = port;
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
      this.socket.connect(ueMcpPort, UE_MCP_HOST);
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

const MissionTargetPreviewLoadRequestSchema = z.object({
  plan: MissionTargetPreviewPlanSchema,
  mapMode: z.enum(["require-current", "auto"]),
});

const MissionTargetMapStatusRequestSchema = z.object({
  mapAssetPath: z.string().startsWith("/Game/"),
});

const MissionTargetBlueprintCreateRequestSchema = z.object({
  blueprintName: z.string().trim().min(1).max(512),
  plan: MissionTargetPreviewPlanSchema,
  selectedTargetIds: z.array(z.string().regex(/^\d+$/)).max(200).optional(),
  registerDialogue: z.boolean().optional(),
});

const MissionTargetBlueprintInspectionRequestSchema = z.object({
  blueprintName: z.string().trim().min(1).max(512),
  plan: MissionTargetPreviewPlanSchema.optional(),
});

const DialogueModelRegistrationRequestSchema = z.object({
  blueprintName: z.string().trim().min(1).max(512),
  selectedModelIndexes: z
    .array(z.number().int().positive())
    .max(200),
});

const StoryboardVec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const StoryboardExportRequestSchema = z.object({
  dialogueId: z.string().regex(/^\d{4}$/),
  startId: z.string().regex(/^\d{4,}$/),
  dialogueIds: z.array(z.string().regex(/^\d+$/)).min(1).max(500),
  participantModelIndexes: z
    .array(z.number().int().nonnegative())
    .min(2)
    .max(12),
  usesBlueprintFormation: z.literal(true),
  shots: z
    .array(
      z.object({
        dialogueId: z.string().regex(/^\d+$/),
        dialogueIds: z.array(z.string().regex(/^\d+$/)).min(1).max(500),
        cameraPosition: StoryboardVec3Schema,
        cameraTarget: StoryboardVec3Schema,
        cameraEndPosition: StoryboardVec3Schema,
        cameraEndTarget: StoryboardVec3Schema,
        focalLength: z.number().finite().min(1).max(500),
        endFocalLength: z.number().finite().min(1).max(500),
        cameraMovement: z.enum([
          "static",
          "pan",
          "tracking",
          "dolly_in",
          "dolly_out",
          "zoom_in",
          "zoom_out",
          "dolly_zoom_in",
          "dolly_zoom_out",
        ]),
        movementIntensity: z.enum([
          "none",
          "subtle",
          "moderate",
          "strong",
        ]),
        cameraRollDegrees: z.number().finite().min(-45).max(45),
        projectionValid: z.boolean(),
      }),
    )
    .min(1)
    .max(500),
});

const StoryboardExportApplyRequestSchema = StoryboardExportRequestSchema.extend({
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
});

const ConfigTableOpenSchema = z.object({
  table: z.enum(["missionTarget", "npc", "model"]),
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

function assetNameFromPath(value: string): string {
  const objectPath = value.split(".").at(-1) ?? "";
  return objectPath.replace(/_C$/i, "");
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

interface BlueprintComponentInfo {
  variableName: string;
  componentClass: string;
  childActorClass: string;
}

export interface MissionTargetBlueprintComponentPlan {
  componentName: string;
  componentClass: string;
  childActorClass: string;
  targetId: string | null;
  transform: UnrealTransform;
}

function rounded(value: number): number {
  const result = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(result, -0) ? 0 : result;
}

export function buildMissionTargetBlueprintComponents(
  targets: MissionTargetPreviewTarget[],
  modelIndexes = targets.map((_, index) => index + 1),
): MissionTargetBlueprintComponentPlan[] {
  if (targets.length === 0) {
    throw new Error("至少选择一个具有模型资源的目标物");
  }
  if (
    modelIndexes.length !== targets.length ||
    new Set(modelIndexes).size !== modelIndexes.length ||
    modelIndexes.some((index) => !Number.isInteger(index) || index <= 0)
  ) {
    throw new Error("目标物 BP 槽位序号无效");
  }
  const anchor = targets[0].transform.location;
  const playerTransform: UnrealTransform = {
    location: { x: 0, y: 0, z: 100 },
    rotation: { pitch: 0, yaw: 0, roll: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
  const components: MissionTargetBlueprintComponentPlan[] = [
    {
      componentName: "0",
      componentClass: CHILD_ACTOR_COMPONENT_CLASS,
      childActorClass: PLAYER_CLASS,
      targetId: null,
      transform: playerTransform,
    },
  ];
  targets.forEach((target, index) => {
    components.push({
      componentName: String(modelIndexes[index]),
      componentClass: CHILD_ACTOR_COMPONENT_CLASS,
      childActorClass: target.modelClassPath,
      targetId: target.targetId,
      transform: {
        location: {
          x: rounded(target.transform.location.x - anchor.x),
          y: rounded(target.transform.location.y - anchor.y),
          z: rounded(target.transform.location.z - anchor.z + 100),
        },
        rotation: { ...target.transform.rotation },
        scale: { ...target.transform.scale },
      },
    });
  });
  components.push({
    componentName: "c1",
    componentClass: CAMERA_COMPONENT_CLASS,
    childActorClass: "",
    targetId: null,
    transform: {
      location: { x: 0, y: 0, z: 99 },
      rotation: { pitch: 0, yaw: -90, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });
  return components;
}

function formatNumber(value: number): string {
  return String(rounded(value));
}

function formatVector(value: UnrealTransform["location"]): string {
  return `(X=${formatNumber(value.x)},Y=${formatNumber(value.y)},Z=${formatNumber(value.z)})`;
}

function formatRotator(value: UnrealTransform["rotation"]): string {
  return `(Pitch=${formatNumber(value.pitch)},Yaw=${formatNumber(value.yaw)},Roll=${formatNumber(value.roll)})`;
}

function normalizeObjectPath(value: string): string {
  return value.trim().replaceAll("\\", "/").toLowerCase();
}

function directBlueprintAssetPath(input: string): string | null {
  const normalized = input
    .trim()
    .replaceAll("\\", "/")
    .replace(/\.uasset$/i, "");
  return normalized.startsWith("/Game/")
    ? blueprintAssetPath(normalized)
    : null;
}

function blueprintNameFromInput(input: string): string {
  const normalized = input
    .trim()
    .replaceAll("\\", "/")
    .replace(/\.uasset$/i, "");
  const name = assetNameFromPath(normalized.split("/").at(-1) ?? normalized);
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error("请输入有效的 BP 文件名或 /Game/ 资产路径");
  }
  return name;
}

async function resolveExistingBlueprint(
  connection: UnrealInvoker,
  input: string,
): Promise<{ assetPath: string; blueprint: string } | null> {
  const directPath = directBlueprintAssetPath(input);
  const blueprintName = blueprintNameFromInput(input);
  let assetPath = directPath;
  if (!assetPath) {
    const result = await connection.invoke("asset.asset_search", {
      Query: blueprintName,
      ClassFilter: "Blueprint",
      PathFilter: BLUEPRINT_SEARCH_PATH,
      Limit: 200,
    });
    const matches = Array.from(
      new Set(
        (Array.isArray(result) ? result : [])
          .map((value) => assetPathFromSearch(String(value)))
          .filter((value): value is string => Boolean(value))
          .filter(
            (value) =>
              assetNameFromPath(value).toLowerCase() ===
              blueprintName.toLowerCase(),
          ),
      ),
    );
    if (matches.length > 1) {
      throw new Error(
        `找到多个名为 ${blueprintName} 的 BP，请输入完整 /Game/ 资产路径`,
      );
    }
    assetPath = matches[0] ?? null;
  }
  if (!assetPath) {
    return null;
  }
  const blueprint = await connection.invoke("bp.get_blueprint_by_path", {
    AssetPath: assetPath,
  });
  return hasUnrealObjectReference(blueprint)
    ? { assetPath, blueprint: String(blueprint) }
    : null;
}

async function readBlueprintComponents(
  connection: UnrealInvoker,
  blueprintClassPathValue: string,
): Promise<BlueprintComponentInfo[]> {
  const nodes = await readProperty(
    connection,
    `${blueprintClassPathValue}:SimpleConstructionScript_0`,
    "AllNodes",
  );
  const result: BlueprintComponentInfo[] = [];
  for (const nodeValue of Array.isArray(nodes) ? nodes : []) {
    const node = String(nodeValue);
    const variableName = String(
      await readProperty(connection, node, "InternalVariableName"),
    );
    const componentClass = String(
      await readProperty(connection, node, "ComponentClass"),
    );
    const componentTemplate = await readProperty(
      connection,
      node,
      "ComponentTemplate",
    );
    let childActorClass = "";
    if (
      componentClass.endsWith("ChildActorComponent") &&
      hasUnrealObjectReference(componentTemplate)
    ) {
      childActorClass = String(
        (await readProperty(
          connection,
          String(componentTemplate),
          "ChildActorClass",
        )) ?? "",
      );
    }
    result.push({ variableName, componentClass, childActorClass });
  }
  return result;
}

async function readValidatedBlueprint(
  connection: UnrealInvoker,
  resolved: { assetPath: string; blueprint: string },
): Promise<{
  blueprintClassPath: string;
  parentClassPath: string;
  components: BlueprintComponentInfo[];
}> {
  const basicInfo = (await connection.invoke(
    "bp.get_blueprint_basic_info",
    { Bp: resolved.blueprint },
  )) as { GeneratedClass?: unknown; ParentClass?: unknown };
  const parentClassPath = String(basicInfo?.ParentClass ?? "");
  if (
    normalizeObjectPath(parentClassPath) !==
    normalizeObjectPath(POSITION_MODE_BASE_CLASS)
  ) {
    throw new Error(
      `BP 父类不是 PositionModeBase：${parentClassPath || "无法读取"}`,
    );
  }
  const blueprintClassPathValue =
    String(basicInfo?.GeneratedClass ?? "") ||
    blueprintClassPath(resolved.assetPath);
  return {
    blueprintClassPath: blueprintClassPathValue,
    parentClassPath,
    components: await readBlueprintComponents(
      connection,
      blueprintClassPathValue,
    ),
  };
}

async function addBlueprintComponent(
  connection: UnrealInvoker,
  blueprint: string,
  component: MissionTargetBlueprintComponentPlan,
): Promise<void> {
  await connection.invoke("bp.add_component", {
    Bp: blueprint,
    ComponentClass: component.componentClass,
    ComponentName: component.componentName,
  });
  if (component.childActorClass) {
    await connection.invoke("bp.set_component_property", {
      Bp: blueprint,
      ComponentName: component.componentName,
      PropertyName: "ChildActorClass",
      Value: component.childActorClass,
    });
  }
  const properties = [
    ["RelativeLocation", formatVector(component.transform.location)],
    ["RelativeRotation", formatRotator(component.transform.rotation)],
    ["RelativeScale3D", formatVector(component.transform.scale)],
  ] as const;
  for (const [propertyName, value] of properties) {
    await connection.invoke("bp.set_component_property", {
      Bp: blueprint,
      ComponentName: component.componentName,
      PropertyName: propertyName,
      Value: value,
    });
  }
}

function compileFailure(value: unknown): string | null {
  const result = value as {
    bSuccess?: boolean;
    Errors?: unknown[];
    Messages?: Array<{ Severity?: unknown; Message?: unknown }>;
  };
  if (result?.bSuccess !== false) {
    return null;
  }
  const errors = [
    ...(Array.isArray(result.Errors) ? result.Errors.map(String) : []),
    ...(Array.isArray(result.Messages)
      ? result.Messages
          .filter(
            (message) =>
              String(message.Severity ?? "").toLowerCase() === "error",
          )
          .map((message) => String(message.Message ?? ""))
      : []),
  ].filter(Boolean);
  return errors.join("；") || "Blueprint 编译失败";
}

function saveFailure(value: unknown): string | null {
  const result = value as {
    bSuccess?: boolean;
    Message?: unknown;
    CapturedLog?: unknown;
  };
  if (result?.bSuccess !== false) {
    return null;
  }
  return String(
    result.Message || result.CapturedLog || "Blueprint 保存失败",
  );
}

function modelToken(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  const leaf = normalized.split("/").at(-1) ?? normalized;
  const objectName = leaf.split(".").at(-1) ?? leaf;
  return objectName
    .replace(/_C$/i, "")
    .replace(/^BP_/i, "")
    .toLowerCase();
}

export function compareDialogueModelOrder(
  dialogueModels: string[],
  selectedClassPaths: string[],
  selectedModelIndexes?: ReadonlySet<number>,
): { matched: boolean; message: string; selectedModels: string[] } {
  const preserveSlots = selectedModelIndexes !== undefined;
  const expected = preserveSlots
    ? dialogueModels.slice(1).map((model) => {
        const normalized = model.trim().toLowerCase();
        return ["", "none", "null"].includes(normalized)
          ? "none"
          : modelToken(model);
      })
    : dialogueModels
        .filter(
          (model) =>
            !["", "none", "player"].includes(model.trim().toLowerCase()),
        )
        .map(modelToken);
  const selectedModels = selectedClassPaths.map((model, index) =>
    !preserveSlots || selectedModelIndexes.has(index + 1)
      ? modelToken(model)
      : "none",
  );
  const matched =
    expected.length === selectedModels.length &&
    expected.every((model, index) => model === selectedModels[index]);
  return {
    matched,
    selectedModels,
    message: matched
      ? "对话模型顺序与所选目标物一致"
      : `对话模型顺序为 ${expected.join("、") || "空"}；所选目标物顺序为 ${selectedModels.join("、") || "空"}`,
  };
}

function dialogueIdFromBlueprintPath(assetPath: string): string | null {
  return assetNameFromPath(assetPath).match(/^BP_(\d{4,})$/i)?.[1] ?? null;
}

function parseDialogueExport(text: string): {
  formationClassPath: string | null;
  dialogueModels: string[];
} {
  const formationClassPath =
    text.match(/^\s*Formation=(\S+)\s*$/m)?.[1] ?? null;
  const dialogueModels = Array.from(
    text.matchAll(/^\s*DialogModels\((\d+)\)="([^"]*)"\s*$/gm),
  )
    .map((match) => ({
      index: Number.parseInt(match[1], 10),
      model: match[2],
    }))
    .sort((left, right) => left.index - right.index)
    .map((item) => item.model);
  return { formationClassPath, dialogueModels };
}

async function findDialogueAssetPath(
  connection: UnrealInvoker,
  dialogueId: string,
): Promise<string[]> {
  const result = await connection.invoke("asset.asset_search", {
    Query: dialogueId,
    PathFilter: DIALOGUE_SEARCH_PATH,
    Limit: 100,
  });
  return Array.from(
    new Set(
      (Array.isArray(result) ? result : [])
        .map((value) => assetPathFromSearch(String(value)))
        .filter((value): value is string => Boolean(value))
        .filter((value) => assetNameFromPath(value) === dialogueId),
    ),
  );
}

async function exportAssetText(
  connection: UnrealInvoker,
  assetPath: string,
): Promise<string> {
  const outputPath = String(
    await connection.invoke("asset.export_asset_to_text_file", {
      AssetPath: assetPath,
    }),
  );
  if (!outputPath) {
    throw new Error(`无法导出对话资产：${assetPath}`);
  }
  try {
    return await readFile(outputPath, "utf8");
  } finally {
    if (/[/\\]Saved[/\\]McpTemp[/\\].+\.txt$/i.test(outputPath)) {
      await unlink(outputPath).catch(() => undefined);
    }
  }
}

interface ReflectedProperty {
  Alias?: unknown;
  CurrentString?: unknown;
  CurrentUint32?: unknown;
  [key: string]: unknown;
}

interface StoryboardDialogueNodeContext {
  dialogueId: string;
  nodeDataPath: string;
  commonProperties: ReflectedProperty[];
  cameraPropertyIndex: number;
  existingCameraPosition: string;
  existingMoveCameras: unknown[];
}

interface StoryboardExportNodeChange {
  preview: StoryboardExportNodePreview;
  nodeDataPath: string;
  originalCommonProperties: ReflectedProperty[];
  desiredCommonProperties: ReflectedProperty[];
  originalMoveCameras: unknown[];
  desiredMoveCameras: unknown[];
  writeCommonProperties: boolean;
  writeMoveCameras: boolean;
}

interface PreparedStoryboardExport {
  preview: DialogueStoryboardExportPreview;
  dialogueAsset: string;
  changes: StoryboardExportNodeChange[];
}

interface FormationExportLayout {
  assetPath: string;
  cameraName: string;
  centerX: number;
  centerY: number;
}

function reflectedArray(value: unknown, propertyName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`UE 节点属性 ${propertyName} 不是数组`);
  }
  return value;
}

function clonedValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stagePositionToUnreal(
  position: StoryboardExportRequest["shots"][number]["cameraPosition"],
  layout: FormationExportLayout,
): { X: number; Y: number; Z: number } {
  return {
    X: rounded(layout.centerX - position[2] * 100),
    Y: rounded(layout.centerY + position[0] * 100),
    Z: rounded(position[1] * 100),
  };
}

function cameraRotation(
  position: { X: number; Y: number; Z: number },
  target: { X: number; Y: number; Z: number },
  roll: number,
): { Pitch: number; Yaw: number; Roll: number } {
  const x = target.X - position.X;
  const y = target.Y - position.Y;
  const z = target.Z - position.Z;
  return {
    Pitch: rounded((Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI),
    Yaw: rounded((Math.atan2(y, x) * 180) / Math.PI),
    Roll: rounded(roll),
  };
}

function focalLengthToFov(focalLength: number): number {
  return rounded(
    (2 * Math.atan(35 / (2 * focalLength)) * 180) / Math.PI,
  );
}

function movementVelocity(
  movement: StoryboardExportRequest["shots"][number]["cameraMovement"],
  intensity: StoryboardExportRequest["shots"][number]["movementIntensity"],
): number {
  if (movement === "static") {
    return 0;
  }
  if (intensity === "strong") {
    return 10;
  }
  if (intensity === "moderate") {
    return 6;
  }
  return 3;
}

export function buildStoryboardCameraMove(
  shot: StoryboardExportRequest["shots"][number],
  layout: Pick<FormationExportLayout, "centerX" | "centerY">,
): Record<string, unknown> {
  const startPoint = stagePositionToUnreal(shot.cameraPosition, {
    ...layout,
    assetPath: "",
    cameraName: "c1",
  });
  const endPoint = stagePositionToUnreal(shot.cameraEndPosition, {
    ...layout,
    assetPath: "",
    cameraName: "c1",
  });
  const startTarget = stagePositionToUnreal(shot.cameraTarget, {
    ...layout,
    assetPath: "",
    cameraName: "c1",
  });
  const endTarget = stagePositionToUnreal(shot.cameraEndTarget, {
    ...layout,
    assetPath: "",
    cameraName: "c1",
  });
  return {
    CameraMoveType: "EPush",
    RotateCameraArg: {
      bRelative: true,
      CenterName: "None",
      CenterPosition: { X: 0, Y: 0, Z: 0 },
      bClockWise: true,
      Angle: 0,
      AngularVelocity: 0,
      StartPoint: { X: 0, Y: 0, Z: 0 },
      StartPitch: 0,
      BlendOutTime: 0,
    },
    PushCameraArg: {
      bRelative: true,
      Velocity: movementVelocity(
        shot.cameraMovement,
        shot.movementIntensity,
      ),
      StartRotation: cameraRotation(
        startPoint,
        startTarget,
        shot.cameraRollDegrees,
      ),
      EndRotation: cameraRotation(
        endPoint,
        endTarget,
        shot.cameraRollDegrees,
      ),
      StartPoint: startPoint,
      EndPoint: endPoint,
      BlendOutTime: 1,
      bWaitOptionShow: false,
    },
    LookAtArg: {
      LookAtActor: 0,
      DialogLookAtType: "EActor",
      CenterOffset: { X: 0, Y: 0, Z: 0 },
      bOverrideRoll: false,
      Roll: 0,
    },
    LookAtPushArg: {
      bRelative: true,
      Velocity: 0,
      StartPoint: { X: 0, Y: 0, Z: 0 },
      EndPoint: { X: 0, Y: 0, Z: 0 },
      BlendOutTime: 0,
      LookAtActor: 0,
      DialogLookAtType: "EActor",
      CenterOffset: { X: 0, Y: 0, Z: 0 },
      bOverrideRoll: false,
      Roll: 0,
    },
    FOV: focalLengthToFov(shot.focalLength),
  };
}

function validateStoryboardCoverage(request: StoryboardExportRequest): void {
  const actualIds = request.shots.flatMap((shot) => shot.dialogueIds);
  if (
    actualIds.length !== request.dialogueIds.length ||
    actualIds.some(
      (dialogueId, index) => dialogueId !== request.dialogueIds[index],
    )
  ) {
    throw new Error("分镜必须按原顺序覆盖当前对话的全部台词节点");
  }
  for (const [index, shot] of request.shots.entries()) {
    if (shot.dialogueId !== shot.dialogueIds[0]) {
      throw new Error(`镜头 ${index + 1} 的起始台词节点不一致`);
    }
  }
  if (
    new Set(request.participantModelIndexes).size !==
    request.participantModelIndexes.length
  ) {
    throw new Error("当前 BP 站位包含重复的模型槽位");
  }
}

function objectReferencePath(value: unknown): string {
  const reference = String(value).trim();
  const firstQuote = reference.indexOf("'");
  const lastQuote = reference.lastIndexOf("'");
  if (firstQuote >= 0 && lastQuote > firstQuote) {
    return reference
      .slice(firstQuote + 1, lastQuote)
      .replace(/^"|"$/g, "");
  }
  return reference;
}

async function readStoryboardDialogueNodes(
  connection: UnrealInvoker,
  dialogueAssetPath: string,
  dialogueIds: string[],
  exportedText: string,
): Promise<StoryboardDialogueNodeContext[]> {
  const graphPath = `${dialogueAssetPath}:Dialog Graph`;
  const nodes = reflectedArray(
    await readProperty(connection, graphPath, "Nodes"),
    "Nodes",
  );
  const nodeIndexBySerializedName = new Map<string, number>();
  for (const match of exportedText.matchAll(
    /^\s+Nodes\((\d+)\)=SeriaEdDialogGraphNode'"([^"]+)"'/gm,
  )) {
    const serializedName = match[2].split(".").at(-1) ?? match[2];
    nodeIndexBySerializedName.set(
      serializedName,
      Number.parseInt(match[1], 10),
    );
  }
  const nodeIndexByDialogueId = new Map<string, number>();
  for (const match of exportedText.matchAll(
    /^\s{6}Begin Object Name="(SeriaEdDialogGraphNode_\d+)"\r?\n([\s\S]*?)^\s{9}DialogGraphNodeData=/gm,
  )) {
    const idPropertyLine = match[2]
      .split(/\r?\n/)
      .find(
        (line) =>
          line.includes("CommonDialogGraphProperties(") &&
          line.includes('Alias="id"'),
      );
    const idMatch = idPropertyLine?.match(
      /CurrentUint32=(\d+)/,
    );
    const nodeIndex = nodeIndexBySerializedName.get(match[1]);
    if (idMatch && nodeIndex !== undefined) {
      nodeIndexByDialogueId.set(idMatch[1], nodeIndex);
    }
  }
  const missingIds = dialogueIds.filter(
    (dialogueId) => !nodeIndexByDialogueId.has(dialogueId),
  );
  if (missingIds.length > 0) {
    throw new Error(
      `对话资产中未找到台词节点：${missingIds.join("、")}`,
    );
  }
  const result: StoryboardDialogueNodeContext[] = [];
  for (const dialogueId of dialogueIds) {
    const nodeIndex = nodeIndexByDialogueId.get(dialogueId)!;
    const nodeValue = nodes[nodeIndex];
    if (!hasUnrealObjectReference(nodeValue)) {
      throw new Error(`台词节点 ${dialogueId} 的图节点引用无效`);
    }
    const nodePath = objectReferencePath(nodeValue);
    const nodeDataValue = await readProperty(
      connection,
      nodePath,
      "DialogGraphNodeData",
    );
    if (!hasUnrealObjectReference(nodeDataValue)) {
      throw new Error(`台词节点 ${dialogueId} 的节点数据引用无效`);
    }
    const nodeDataPath = objectReferencePath(nodeDataValue);
    const commonProperties = reflectedArray(
      await readProperty(
        connection,
        nodeDataPath,
        "CommonDialogGraphProperties",
      ),
      "CommonDialogGraphProperties",
    ) as ReflectedProperty[];
    const idProperty = commonProperties.find(
      (property) => String(property.Alias).toLowerCase() === "id",
    );
    if (String(Number(idProperty?.CurrentUint32)) !== dialogueId) {
      throw new Error(`台词节点 ${dialogueId} 的 UE 回读 ID 不一致`);
    }
    const cameraPropertyIndex = commonProperties.findIndex(
      (property) =>
        String(property.Alias).toLowerCase() === "cameraposition",
    );
    if (cameraPropertyIndex < 0) {
      throw new Error(`台词节点 ${dialogueId} 缺少 CameraPosition 属性`);
    }
    const existingMoveCameras = reflectedArray(
      await readProperty(connection, nodeDataPath, "MoveCameras"),
      "MoveCameras",
    );
    result.push({
      dialogueId,
      nodeDataPath,
      commonProperties,
      cameraPropertyIndex,
      existingCameraPosition: String(
        commonProperties[cameraPropertyIndex].CurrentString ?? "",
      ),
      existingMoveCameras,
    });
  }
  return result;
}

async function readFormationExportLayout(
  connection: UnrealInvoker,
  startId: string,
  formationClassPath: string,
  participantModelIndexes: number[],
): Promise<FormationExportLayout> {
  const assetPath = await resolveAssetPath(
    connection,
    startId,
    formationClassPath,
  );
  if (!assetPath) {
    throw new Error("当前对话没有可用于导出镜头的 Formation BP");
  }
  const loaded = await connection.invoke("bp.get_blueprint_by_path", {
    AssetPath: assetPath,
  });
  if (!hasUnrealObjectReference(loaded)) {
    throw new Error(`无法加载 Formation BP：${assetPath}`);
  }
  const classPath = blueprintClassPath(assetPath);
  const scsPath = `${classPath}:SimpleConstructionScript_0`;
  const nodes = reflectedArray(
    await readProperty(connection, scsPath, "AllNodes"),
    "AllNodes",
  );
  const requestedIndexes = new Set(participantModelIndexes);
  const locations = new Map<number, { x: number; y: number }>();
  let cameraName = "";
  for (const nodeValue of nodes) {
    const nodePath = String(nodeValue);
    const variableName = String(
      await readProperty(connection, nodePath, "InternalVariableName"),
    );
    const componentClass = String(
      await readProperty(connection, nodePath, "ComponentClass"),
    );
    const componentTemplate = await readProperty(
      connection,
      nodePath,
      "ComponentTemplate",
    );
    if (
      variableName.toLowerCase() === "c1" &&
      componentClass.endsWith("CameraComponent")
    ) {
      cameraName = variableName;
    }
    if (
      !/^\d+$/.test(variableName) ||
      !requestedIndexes.has(Number(variableName)) ||
      !componentClass.endsWith("ChildActorComponent") ||
      !hasUnrealObjectReference(componentTemplate)
    ) {
      continue;
    }
    const location = vector(
      await readProperty(
        connection,
        String(componentTemplate),
        "RelativeLocation",
      ),
    );
    locations.set(Number(variableName), {
      x: location.x,
      y: location.y,
    });
  }
  if (!cameraName) {
    throw new Error(`Formation BP ${assetPath} 中没有 c1 摄像机组件`);
  }
  const missingIndexes = participantModelIndexes.filter(
    (modelIndex) => !locations.has(modelIndex),
  );
  if (missingIndexes.length > 0) {
    throw new Error(
      `Formation BP 缺少当前站位槽：${missingIndexes.join("、")}`,
    );
  }
  const selectedLocations = participantModelIndexes.map(
    (modelIndex) => locations.get(modelIndex)!,
  );
  return {
    assetPath,
    cameraName,
    centerX:
      selectedLocations.reduce((total, location) => total + location.x, 0) /
      selectedLocations.length,
    centerY:
      selectedLocations.reduce((total, location) => total + location.y, 0) /
      selectedLocations.length,
  };
}

function storyboardExportBlockedReasons(
  request: StoryboardExportRequest,
): string[] {
  return request.shots.flatMap((shot, index) => {
    const changesFocalLength =
      Math.abs(shot.endFocalLength - shot.focalLength) > 0.001 ||
      shot.cameraMovement.includes("zoom");
    return changesFocalLength
      ? [
          `镜头 ${index + 1} 使用焦距连续变化，当前 UE MoveCameras 映射尚不能无损表达`,
        ]
      : [];
  });
}

function exportAction(
  role: StoryboardExportNodePreview["role"],
  existingCameraPosition: string,
  existingMoveCount: number,
  desiredCameraPosition: string,
  desiredMoveCount: number,
  unchanged: boolean,
): StoryboardExportNodePreview["action"] {
  if (unchanged) {
    return "unchanged";
  }
  if (role === "continuation") {
    return "clear";
  }
  return existingCameraPosition || existingMoveCount > 0
    ? "replace"
    : desiredCameraPosition || desiredMoveCount > 0
      ? "create"
      : "unchanged";
}

async function prepareStoryboardExport(
  connection: UnrealInvoker,
  request: StoryboardExportRequest,
): Promise<PreparedStoryboardExport> {
  validateStoryboardCoverage(request);
  const dialogueAssets = await findDialogueAssetPath(
    connection,
    request.startId,
  );
  if (dialogueAssets.length === 0) {
    throw new Error(`未找到对话资产 ${request.startId}`);
  }
  if (dialogueAssets.length > 1) {
    throw new Error(
      `找到多个名为 ${request.startId} 的对话资产，无法自动确认`,
    );
  }
  const dialogueAssetPath = dialogueAssets[0];
  const dialogueAsset = await connection.invoke("asset.get_asset_by_path", {
    AssetPath: dialogueAssetPath,
  });
  if (!hasUnrealObjectReference(dialogueAsset)) {
    throw new Error(`无法加载对话资产：${dialogueAssetPath}`);
  }
  const exportedText = await exportAssetText(
    connection,
    dialogueAssetPath,
  );
  const exportedDialogue = parseDialogueExport(exportedText);
  const layout = await readFormationExportLayout(
    connection,
    request.startId,
    exportedDialogue.formationClassPath ?? "",
    request.participantModelIndexes,
  );
  const dialogueNodes = await readStoryboardDialogueNodes(
    connection,
    dialogueAssetPath,
    request.dialogueIds,
    exportedText,
  );
  const shotStartByDialogueId = new Map(
    request.shots.map((shot, index) => [
      shot.dialogueId,
      { shot, shotIndex: index },
    ]),
  );
  const changes = dialogueNodes.map((node) => {
    const shotStart = shotStartByDialogueId.get(node.dialogueId);
    const role: StoryboardExportNodePreview["role"] = shotStart
      ? "shot_start"
      : "continuation";
    const desiredCameraPosition = shotStart ? layout.cameraName : "";
    const desiredMoveCameras = shotStart
      ? [buildStoryboardCameraMove(shotStart.shot, layout)]
      : [];
    const desiredCommonProperties = clonedValue(node.commonProperties);
    desiredCommonProperties[node.cameraPropertyIndex].CurrentString =
      desiredCameraPosition;
    const writeCommonProperties =
      node.existingCameraPosition !== desiredCameraPosition;
    const writeMoveCameras =
      JSON.stringify(node.existingMoveCameras) !==
      JSON.stringify(desiredMoveCameras);
    const unchanged = !writeCommonProperties && !writeMoveCameras;
    return {
      preview: {
        dialogueId: node.dialogueId,
        shotIndex: shotStart ? shotStart.shotIndex : null,
        role,
        action: exportAction(
          role,
          node.existingCameraPosition,
          node.existingMoveCameras.length,
          desiredCameraPosition,
          desiredMoveCameras.length,
          unchanged,
        ),
        existingCameraPosition: node.existingCameraPosition,
        desiredCameraPosition,
        existingMovementCount: node.existingMoveCameras.length,
        desiredMovementCount: desiredMoveCameras.length,
      },
      nodeDataPath: node.nodeDataPath,
      originalCommonProperties: node.commonProperties,
      desiredCommonProperties,
      originalMoveCameras: node.existingMoveCameras,
      desiredMoveCameras,
      writeCommonProperties,
      writeMoveCameras,
    };
  });
  const dirtyPackages = new Set(
    (await dirtyContentPackages(connection)).map((path) =>
      path.toLowerCase(),
    ),
  );
  const dialoguePackagePath = dialogueAssetPath.split(".")[0];
  const formationPackagePath = layout.assetPath.split(".")[0];
  const blockedReasons = [
    ...storyboardExportBlockedReasons(request),
    ...(dirtyPackages.has(dialoguePackagePath.toLowerCase())
      ? [
          `对话资产 ${dialoguePackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
        ]
      : []),
    ...(dirtyPackages.has(formationPackagePath.toLowerCase())
      ? [
          `Formation BP ${formationPackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
        ]
      : []),
  ];
  const invalidShotCount = request.shots.filter(
    (shot) => !shot.projectionValid,
  ).length;
  const warnings = invalidShotCount
    ? [`${invalidShotCount} 个镜头的投影验收未通过，确认后仍可导出`]
    : [];
  const reviewToken = createHash("sha256")
    .update(
      JSON.stringify({
        dialogueAssetPath,
        formationAssetPath: layout.assetPath,
        request,
        nodes: changes.map((change) => ({
          dialogueId: change.preview.dialogueId,
          originalCameraPosition:
            change.preview.existingCameraPosition,
          originalMoveCameras: change.originalMoveCameras,
          desiredCameraPosition:
            change.preview.desiredCameraPosition,
          desiredMoveCameras: change.desiredMoveCameras,
        })),
      }),
    )
    .digest("hex");
  const changed = changes.filter(
    (change) =>
      change.writeCommonProperties || change.writeMoveCameras,
  );
  return {
    preview: {
      reviewToken,
      dialogueId: request.dialogueId,
      startId: request.startId,
      dialogueAssetPath,
      formationAssetPath: layout.assetPath,
      cameraName: layout.cameraName,
      shotCount: request.shots.length,
      changedNodeCount: changed.length,
      overwrittenNodeCount: changes.filter(
        (change) => change.preview.action === "replace",
      ).length,
      clearedNodeCount: changes.filter(
        (change) => change.preview.action === "clear",
      ).length,
      invalidShotCount,
      blockedReasons,
      warnings,
      nodes: changes.map((change) => change.preview),
    },
    dialogueAsset: String(dialogueAsset),
    changes,
  };
}

export async function inspectDialogueStoryboardExport(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<DialogueStoryboardExportPreview> {
  const request = StoryboardExportRequestSchema.parse(
    rawRequest,
  ) as StoryboardExportRequest;
  const connection = connectionFactory();
  try {
    await connection.connect();
    return (await prepareStoryboardExport(connection, request)).preview;
  } finally {
    connection.close();
  }
}

export async function exportDialogueStoryboard(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<DialogueStoryboardExportResult> {
  const parsed = StoryboardExportApplyRequestSchema.parse(rawRequest);
  const { reviewToken, ...requestValue } = parsed;
  const request = requestValue as StoryboardExportRequest;
  const connection = connectionFactory();
  try {
    await connection.connect();
    const prepared = await prepareStoryboardExport(connection, request);
    if (prepared.preview.reviewToken !== reviewToken) {
      throw new Error(
        "UE 中的对话镜头配置已发生变化，请重新检查后再导出",
      );
    }
    if (prepared.preview.blockedReasons.length > 0) {
      throw new Error(prepared.preview.blockedReasons.join("；"));
    }
    const changed = prepared.changes.filter(
      (change) =>
        change.writeCommonProperties || change.writeMoveCameras,
    );
    if (changed.length === 0) {
      return {
        status: "unchanged",
        dialogueId: request.dialogueId,
        startId: request.startId,
        dialogueAssetPath: prepared.preview.dialogueAssetPath,
        changedNodeCount: 0,
        saved: false,
      };
    }
    const written: StoryboardExportNodeChange[] = [];
    try {
      for (const change of changed) {
        written.push(change);
        if (change.writeCommonProperties) {
          await connection.invoke("reflect.write_object_property", {
            ThisPtr: change.nodeDataPath,
            PropertyName: "CommonDialogGraphProperties",
            Value: change.desiredCommonProperties,
          });
        }
        if (change.writeMoveCameras) {
          await connection.invoke("reflect.write_object_property", {
            ThisPtr: change.nodeDataPath,
            PropertyName: "MoveCameras",
            Value: change.desiredMoveCameras,
          });
        }
      }
      for (const change of changed) {
        const commonProperties = reflectedArray(
          await readProperty(
            connection,
            change.nodeDataPath,
            "CommonDialogGraphProperties",
          ),
          "CommonDialogGraphProperties",
        ) as ReflectedProperty[];
        const cameraPosition = String(
          commonProperties.find(
            (property) =>
              String(property.Alias).toLowerCase() === "cameraposition",
          )?.CurrentString ?? "",
        );
        const moveCameras = reflectedArray(
          await readProperty(
            connection,
            change.nodeDataPath,
            "MoveCameras",
          ),
          "MoveCameras",
        );
        if (
          cameraPosition !== change.preview.desiredCameraPosition ||
          JSON.stringify(moveCameras) !==
            JSON.stringify(change.desiredMoveCameras)
        ) {
          throw new Error(
            `台词节点 ${change.preview.dialogueId} 写入后的回读结果不一致`,
          );
        }
      }
      const saveResult = await connection.invoke("asset.save_asset", {
        Asset:
          prepared.dialogueAsset || prepared.preview.dialogueAssetPath,
      });
      if (saveResult === false) {
        throw new Error(
          `对话资产保存失败：${prepared.preview.dialogueAssetPath}`,
        );
      }
    } catch (error) {
      for (const change of written.reverse()) {
        if (change.writeCommonProperties) {
          await connection
            .invoke("reflect.write_object_property", {
              ThisPtr: change.nodeDataPath,
              PropertyName: "CommonDialogGraphProperties",
              Value: change.originalCommonProperties,
            })
            .catch(() => undefined);
        }
        if (change.writeMoveCameras) {
          await connection
            .invoke("reflect.write_object_property", {
              ThisPtr: change.nodeDataPath,
              PropertyName: "MoveCameras",
              Value: change.originalMoveCameras,
            })
            .catch(() => undefined);
        }
      }
      throw new Error(
        `${error instanceof Error ? error.message : "分镜导出失败"}；已尝试恢复本轮未保存修改`,
      );
    }
    return {
      status: "exported",
      dialogueId: request.dialogueId,
      startId: request.startId,
      dialogueAssetPath: prepared.preview.dialogueAssetPath,
      changedNodeCount: changed.length,
      saved: true,
    };
  } finally {
    connection.close();
  }
}

interface DialogueModelSourceSlot {
  modelIndex: number;
  targetId: string | null;
  modelClassPath: string;
}

interface DialogNpcRegistryEntry {
  name: string;
  characterClassPath: string;
}

interface DialogueRegistrationContext {
  dialogueId: string;
  dialogueAssetPath: string;
  dialogueAsset: string;
  startNodeData: string;
  formationClassPath: string | null;
  existingModels: string[];
  slots: DialogueModelRegistrationSlot[];
}

function normalizedDialogueModelName(value: unknown): string {
  const name = String(value ?? "").trim();
  return ["", "none", "null"].includes(name.toLowerCase())
    ? "None"
    : name;
}

async function findDialogueStartNodeData(
  connection: UnrealInvoker,
  dialogueAssetPath: string,
): Promise<string> {
  const graphPath = `${dialogueAssetPath}:Dialog Graph`;
  const nodes = await readProperty(connection, graphPath, "Nodes");
  for (const nodeValue of Array.isArray(nodes) ? nodes : []) {
    const nodeName = String(nodeValue);
    if (!nodeName.startsWith("SeriaEdDialogGraphNode_")) {
      continue;
    }
    const nodePath = objectReferencePath(nodeValue);
    const nodeDataValue = await readProperty(
      connection,
      nodePath,
      "DialogGraphNodeData",
    );
    if (!hasUnrealObjectReference(nodeDataValue)) {
      continue;
    }
    const nodeDataPath = objectReferencePath(nodeDataValue);
    const nodeType = await readProperty(
      connection,
      nodeDataPath,
      "SeriaDialogGraphNodeType",
    );
    if (String(nodeType).toLowerCase().endsWith("start")) {
      return nodeDataPath;
    }
  }
  throw new Error(`对话资产中未找到开始节点：${dialogueAssetPath}`);
}

async function readDialogNpcRegistry(
  connection: UnrealInvoker,
): Promise<DialogNpcRegistryEntry[]> {
  const result = await connection.invoke("script.eval_python_expression", {
    Expression:
      `__import__('json').dumps({'names':[str(x) for x in unreal.DataTableFunctionLibrary.get_data_table_row_names(unreal.load_asset('${DIALOG_NPC_TABLE_PATH}'))],` +
      `'paths':[str(x) for x in unreal.DataTableFunctionLibrary.get_data_table_column_as_string(unreal.load_asset('${DIALOG_NPC_TABLE_PATH}'),'CharacterBPPath')]})`,
  });
  const parsed = parsePythonJson(
    result,
    "无法读取 DialogNPCTable",
  ) as { names?: unknown[]; paths?: unknown[] };
  if (
    !Array.isArray(parsed.names) ||
    !Array.isArray(parsed.paths) ||
    parsed.names.length !== parsed.paths.length
  ) {
    throw new Error("DialogNPCTable 的行名与 CharacterBPPath 数量不一致");
  }
  return parsed.names.map((name, index) => ({
    name: String(name),
    characterClassPath: String(parsed.paths?.[index] ?? ""),
  }));
}

export function buildDialogueModelRegistrationSlots(
  sourceSlots: DialogueModelSourceSlot[],
  existingModels: string[],
  registry: DialogNpcRegistryEntry[],
): DialogueModelRegistrationSlot[] {
  return sourceSlots
    .slice()
    .sort((left, right) => left.modelIndex - right.modelIndex)
    .map((source) => {
      const existingModelName = normalizedDialogueModelName(
        existingModels[source.modelIndex],
      );
      if (source.modelIndex === 0) {
        return {
          ...source,
          existingModelName,
          suggestedModelName: "player",
          candidateModelNames: ["player"],
          status:
            existingModelName.toLowerCase() === "player"
              ? "registered"
              : "available",
        };
      }
      const normalizedClassPath = normalizeObjectPath(
        source.modelClassPath,
      );
      const candidateModelNames = normalizedClassPath
        ? registry
            .filter(
              (entry) =>
                normalizeObjectPath(entry.characterClassPath) ===
                normalizedClassPath,
            )
            .map((entry) => entry.name)
        : [];
      const exactName = candidateModelNames.find(
        (name) => modelToken(name) === modelToken(source.modelClassPath),
      );
      const suggestedModelName =
        existingModelName !== "None"
          ? existingModelName
          : exactName ??
            (candidateModelNames.length === 1
              ? candidateModelNames[0]
              : null);
      return {
        ...source,
        existingModelName,
        suggestedModelName,
        candidateModelNames,
        status:
          existingModelName !== "None"
            ? "registered"
            : suggestedModelName
              ? "available"
              : "unmapped",
      };
    });
}

export function buildDialogueModelsForRegistration(
  slots: DialogueModelRegistrationSlot[],
  selectedModelIndexes: ReadonlySet<number>,
): { dialogueModels: string[]; unresolvedIndexes: number[] } {
  const maximumIndex = Math.max(0, ...slots.map((slot) => slot.modelIndex));
  const dialogueModels = Array.from(
    { length: maximumIndex + 1 },
    () => "None",
  );
  const unresolvedIndexes: number[] = [];
  if (slots.some((slot) => slot.modelIndex === 0)) {
    dialogueModels[0] = "player";
  }
  for (const slot of slots) {
    if (slot.modelIndex === 0 || !selectedModelIndexes.has(slot.modelIndex)) {
      continue;
    }
    if (!slot.suggestedModelName) {
      unresolvedIndexes.push(slot.modelIndex);
      continue;
    }
    dialogueModels[slot.modelIndex] = slot.suggestedModelName;
  }
  return { dialogueModels, unresolvedIndexes };
}

async function readDialogueRegistrationContext(
  connection: UnrealInvoker,
  blueprintAssetPathValue: string,
  sourceSlots: DialogueModelSourceSlot[],
): Promise<DialogueRegistrationContext> {
  const dialogueId = dialogueIdFromBlueprintPath(blueprintAssetPathValue);
  if (!dialogueId) {
    throw new Error("BP 文件名中没有可用于查找对话资产的数字 ID");
  }
  const dialogueAssets = await findDialogueAssetPath(
    connection,
    dialogueId,
  );
  if (dialogueAssets.length === 0) {
    throw new Error(`未找到与 BP 对应的对话资产 ${dialogueId}`);
  }
  if (dialogueAssets.length > 1) {
    throw new Error(`找到多个名为 ${dialogueId} 的对话资产，无法自动确认`);
  }
  const dialogueAssetPath = dialogueAssets[0];
  const dialogueAsset = await connection.invoke("asset.get_asset_by_path", {
    AssetPath: dialogueAssetPath,
  });
  if (!hasUnrealObjectReference(dialogueAsset)) {
    throw new Error(`无法加载对话资产：${dialogueAssetPath}`);
  }
  const startNodeData = await findDialogueStartNodeData(
    connection,
    dialogueAssetPath,
  );
  const existingModelsValue = await readProperty(
    connection,
    startNodeData,
    "DialogModels",
  );
  const existingModels = (
    Array.isArray(existingModelsValue) ? existingModelsValue : []
  ).map(normalizedDialogueModelName);
  const formationValue = await readProperty(
    connection,
    startNodeData,
    "Formation",
  );
  const formationName = normalizedDialogueModelName(formationValue);
  const registry = await readDialogNpcRegistry(connection);
  return {
    dialogueId,
    dialogueAssetPath,
    dialogueAsset: String(dialogueAsset),
    startNodeData,
    formationClassPath:
      formationName === "None" ? null : String(formationValue),
    existingModels,
    slots: buildDialogueModelRegistrationSlots(
      sourceSlots,
      existingModels,
      registry,
    ),
  };
}

async function writeDialogueRegistration(
  connection: UnrealInvoker,
  blueprintAssetPathValue: string,
  context: DialogueRegistrationContext,
  selectedModelIndexes: ReadonlySet<number>,
): Promise<DialogueModelRegistrationResult> {
  const { dialogueModels, unresolvedIndexes } =
    buildDialogueModelsForRegistration(
      context.slots,
      selectedModelIndexes,
    );
  const currentModels = context.existingModels.map(
    normalizedDialogueModelName,
  );
  const desiredFormation = blueprintClassPath(blueprintAssetPathValue);
  const modelsUnchanged =
    currentModels.length === dialogueModels.length &&
    currentModels.every(
      (model, index) =>
        model.toLowerCase() === dialogueModels[index].toLowerCase(),
    );
  const formationUnchanged =
    context.formationClassPath !== null &&
    normalizeObjectPath(context.formationClassPath) ===
      normalizeObjectPath(desiredFormation);
  const unchanged = modelsUnchanged && formationUnchanged;
  if (!unchanged) {
    if (!modelsUnchanged) {
      await connection.invoke("reflect.write_object_property", {
        ThisPtr: context.startNodeData,
        PropertyName: "DialogModels",
        Value: dialogueModels,
      });
    }
    if (!formationUnchanged) {
      await connection.invoke("reflect.write_object_property", {
        ThisPtr: context.startNodeData,
        PropertyName: "Formation",
        Value: desiredFormation,
      });
    }
    const writtenValue = await readProperty(
      connection,
      context.startNodeData,
      "DialogModels",
    );
    const writtenModels = (
      Array.isArray(writtenValue) ? writtenValue : []
    ).map(normalizedDialogueModelName);
    if (
      writtenModels.length !== dialogueModels.length ||
      writtenModels.some(
        (model, index) =>
          model.toLowerCase() !== dialogueModels[index].toLowerCase(),
      )
    ) {
      throw new Error("DialogModels 写入后的回读结果不一致");
    }
    const writtenFormation = String(
      await readProperty(connection, context.startNodeData, "Formation"),
    );
    if (
      normalizeObjectPath(writtenFormation) !==
      normalizeObjectPath(desiredFormation)
    ) {
      throw new Error("Formation 写入后的回读结果不一致");
    }
    const saveResult = await connection.invoke("asset.save_asset", {
      Asset: context.dialogueAsset || context.dialogueAssetPath,
    });
    if (saveResult === false) {
      throw new Error(`对话资产保存失败：${context.dialogueAssetPath}`);
    }
  }
  const registeredCount = dialogueModels
    .slice(1)
    .filter((name) => name !== "None").length;
  return {
    status: unchanged ? "unchanged" : "registered",
    blueprintAssetPath: blueprintAssetPathValue,
    dialogueId: context.dialogueId,
    dialogueAssetPath: context.dialogueAssetPath,
    dialogueModels,
    registeredCount,
    emptyCount: Math.max(0, dialogueModels.length - 1 - registeredCount),
    unresolvedIndexes,
  };
}

export async function inspectMissionTargetBlueprint(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<MissionTargetBlueprintInspection> {
  const request = MissionTargetBlueprintInspectionRequestSchema.parse(
    rawRequest,
  ) as {
    blueprintName: string;
    plan?: MissionTargetPreviewPlan;
  };
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const resolved = await resolveExistingBlueprint(
      connection,
      request.blueprintName,
    );
    if (!resolved) {
      throw new Error(`BP 文件不存在：${request.blueprintName}`);
    }
    const blueprint = await readValidatedBlueprint(connection, resolved);
    const reservedComponents = blueprint.components.filter(
      (component) =>
        /^\d+$/.test(component.variableName) ||
        component.variableName.toLowerCase() === "c1",
    );
    const blueprintState =
      reservedComponents.length === 0 ? "empty" : "populated";
    const numericComponents = blueprint.components
      .filter((component) => /^\d+$/.test(component.variableName))
      .sort(
        (left, right) =>
          Number(left.variableName) - Number(right.variableName),
      );
    if (
      blueprintState === "populated" &&
      numericComponents.some((component) => !component.childActorClass)
    ) {
      throw new Error("BP 数字槽位中存在非 ChildActorComponent 或空模型");
    }
    const playerSlot = numericComponents.find(
      (component) => component.variableName === "0",
    );
    if (
      blueprintState === "populated" &&
      (!playerSlot ||
        normalizeObjectPath(playerSlot.childActorClass) !==
          normalizeObjectPath(PLAYER_CLASS))
    ) {
      throw new Error("BP 的 0 号位不是玩家 BP_Eric");
    }
    const sourceSlots: DialogueModelSourceSlot[] =
      blueprintState === "populated"
        ? numericComponents.map((component) => ({
            modelIndex: Number(component.variableName),
            targetId: null,
            modelClassPath: component.childActorClass,
          }))
        : request.plan
          ? [
              {
                modelIndex: 0,
                targetId: null,
                modelClassPath: PLAYER_CLASS,
              },
              ...request.plan.targets.map((target, index) => ({
                modelIndex: index + 1,
                targetId: target.targetId,
                modelClassPath: target.modelClassPath,
              })),
            ]
          : [];
    const dialogue = await readDialogueRegistrationContext(
      connection,
      resolved.assetPath,
      sourceSlots,
    );
    const registeredCount = dialogue.slots.filter(
      (slot) => slot.modelIndex > 0 && slot.status === "registered",
    ).length;
    const formationMatched =
      dialogue.formationClassPath !== null &&
      normalizeObjectPath(dialogue.formationClassPath) ===
        normalizeObjectPath(blueprint.blueprintClassPath);
    return {
      blueprintState,
      blueprintAssetPath: resolved.assetPath,
      blueprintClassPath: blueprint.blueprintClassPath,
      parentClassPath: blueprint.parentClassPath,
      dialogueId: dialogue.dialogueId,
      dialogueAssetPath: dialogue.dialogueAssetPath,
      formationClassPath: dialogue.formationClassPath,
      slots: dialogue.slots,
      message: `${blueprintState === "empty" ? "BP 尚未创建站位组件" : `BP 已有 ${Math.max(0, numericComponents.length - 1)} 个模型槽`}；对话已注册 ${registeredCount} 个模型${formationMatched ? "" : "；Formation 未指向当前 BP"}`,
    };
  } finally {
    connection.close();
  }
}

export async function registerBlueprintDialogueModels(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<DialogueModelRegistrationResult> {
  const request = DialogueModelRegistrationRequestSchema.parse(
    rawRequest,
  );
  const connection = connectionFactory();
  await connectUnreal(connection);
  let mutationStarted = false;
  try {
    const resolved = await resolveExistingBlueprint(
      connection,
      request.blueprintName,
    );
    if (!resolved) {
      throw new Error(`BP 文件不存在：${request.blueprintName}`);
    }
    const blueprint = await readValidatedBlueprint(connection, resolved);
    const numericComponents = blueprint.components
      .filter((component) => /^\d+$/.test(component.variableName))
      .sort(
        (left, right) =>
          Number(left.variableName) - Number(right.variableName),
      );
    const playerSlot = numericComponents.find(
      (component) => component.variableName === "0",
    );
    if (
      !playerSlot ||
      normalizeObjectPath(playerSlot.childActorClass) !==
        normalizeObjectPath(PLAYER_CLASS)
    ) {
      throw new Error("BP 的 0 号位不是玩家 BP_Eric");
    }
    if (
      numericComponents.some((component) => !component.childActorClass)
    ) {
      throw new Error("BP 数字槽位中存在非 ChildActorComponent 或空模型");
    }
    const sourceSlots = numericComponents.map((component) => ({
      modelIndex: Number(component.variableName),
      targetId: null,
      modelClassPath: component.childActorClass,
    }));
    const validIndexes = new Set(
      sourceSlots
        .map((slot) => slot.modelIndex)
        .filter((index) => index > 0),
    );
    if (
      request.selectedModelIndexes.some(
        (index) => !validIndexes.has(index),
      )
    ) {
      throw new Error("所选模型槽位不属于当前 BP");
    }
    const context = await readDialogueRegistrationContext(
      connection,
      resolved.assetPath,
      sourceSlots,
    );
    mutationStarted = true;
    return await writeDialogueRegistration(
      connection,
      resolved.assetPath,
      context,
      new Set(request.selectedModelIndexes),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "注册 DialogModels 失败";
    throw new Error(
      mutationStarted
        ? `${message}；对话资产可能留有未保存修改，请在 UE 中检查`
        : message,
    );
  } finally {
    connection.close();
  }
}

export async function inspectMissionTargetBlueprintCompatibility(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<MissionTargetBlueprintCompatibility> {
  const request = MissionTargetBlueprintCreateRequestSchema.parse(
    rawRequest,
  ) as {
    blueprintName: string;
    plan: MissionTargetPreviewPlan;
    selectedTargetIds?: string[];
  };
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const resolved = await resolveExistingBlueprint(
      connection,
      request.blueprintName,
    );
    if (!resolved) {
      throw new Error(`BP 文件不存在：${request.blueprintName}`);
    }
    const dialogueId = dialogueIdFromBlueprintPath(resolved.assetPath);
    const selectedClassPaths = request.plan.targets.map(
      (target) => target.modelClassPath,
    );
    const selectedTargetIds = new Set(
      request.selectedTargetIds ??
        request.plan.targets.map((target) => target.targetId),
    );
    const selectedModelIndexes = new Set(
      request.plan.targets.flatMap((target, index) =>
        selectedTargetIds.has(target.targetId) ? [index + 1] : [],
      ),
    );
    const emptyResult = {
      blueprintAssetPath: resolved.assetPath,
      dialogueId,
      dialogueAssetPath: null,
      formationClassPath: null,
      dialogueModels: [],
      selectedModels: selectedClassPaths.map(modelToken),
    };
    if (!dialogueId) {
      return {
        status: "unavailable",
        ...emptyResult,
        message: "BP 文件名中没有可用于查找对话资产的数字 ID",
      };
    }
    const dialogueAssets = await findDialogueAssetPath(
      connection,
      dialogueId,
    );
    if (dialogueAssets.length === 0) {
      return {
        status: "unavailable",
        ...emptyResult,
        message: `未找到与 BP 对应的对话资产 ${dialogueId}`,
      };
    }
    if (dialogueAssets.length > 1) {
      return {
        status: "unavailable",
        ...emptyResult,
        message: `找到多个名为 ${dialogueId} 的对话资产，无法自动确认`,
      };
    }
    const dialogueAssetPath = dialogueAssets[0];
    const exported = parseDialogueExport(
      await exportAssetText(connection, dialogueAssetPath),
    );
    const comparison = compareDialogueModelOrder(
      exported.dialogueModels,
      selectedClassPaths,
      selectedModelIndexes,
    );
    const expectedFormation = blueprintClassPath(resolved.assetPath);
    const formationMatched =
      exported.formationClassPath !== null &&
      normalizeObjectPath(exported.formationClassPath) ===
        normalizeObjectPath(expectedFormation);
    const messages = [];
    if (!formationMatched) {
      messages.push(
        exported.formationClassPath
          ? `对话 Formation 指向 ${exported.formationClassPath}`
          : "对话尚未配置 Formation",
      );
    }
    if (!comparison.matched) {
      messages.push(comparison.message);
    }
    return {
      status:
        formationMatched && comparison.matched
          ? "matched"
          : "mismatch",
      blueprintAssetPath: resolved.assetPath,
      dialogueId,
      dialogueAssetPath,
      formationClassPath: exported.formationClassPath,
      dialogueModels: exported.dialogueModels,
      selectedModels: comparison.selectedModels,
      message:
        messages.join("；") ||
        `对话 ${dialogueId} 的 Formation 和模型顺序均匹配`,
    };
  } finally {
    connection.close();
  }
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

export async function populateMissionTargetBlueprint(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<MissionTargetBlueprintCreateResult> {
  const request = MissionTargetBlueprintCreateRequestSchema.parse(
    rawRequest,
  ) as {
    blueprintName: string;
    plan: MissionTargetPreviewPlan;
    selectedTargetIds?: string[];
    registerDialogue?: boolean;
  };
  const selectedTargetIds = new Set(
    request.selectedTargetIds ??
      request.plan.targets.map((target) => target.targetId),
  );
  const unknownTargetIds = Array.from(selectedTargetIds).filter(
    (targetId) =>
      !request.plan.targets.some((target) => target.targetId === targetId),
  );
  if (unknownTargetIds.length > 0) {
    throw new Error(`所选目标物不属于当前任务：${unknownTargetIds.join("、")}`);
  }
  const selectedEntries = request.plan.targets
    .map((target, index) => ({ target, modelIndex: index + 1 }))
    .filter(({ target }) => selectedTargetIds.has(target.targetId));
  const assetEntries = selectedEntries.filter(
    ({ target }) =>
      target.previewKind === "asset" && Boolean(target.modelClassPath),
  );
  if (assetEntries.length !== selectedEntries.length) {
    throw new Error("所选目标物中存在没有模型资源的对象，无法创建 BP 组件");
  }
  const components = buildMissionTargetBlueprintComponents(
    assetEntries.map(({ target }) => target),
    assetEntries.map(({ modelIndex }) => modelIndex),
  );
  const connection = connectionFactory();
  await connectUnreal(connection);
  let mutationStarted = false;
  let blueprintSaved = false;
  try {
    const resolved = await resolveExistingBlueprint(
      connection,
      request.blueprintName,
    );
    if (!resolved) {
      throw new Error(`BP 文件不存在：${request.blueprintName}`);
    }
    const blueprint = await readValidatedBlueprint(connection, resolved);
    const reservedComponents = blueprint.components
      .map((component) => component.variableName)
      .filter(
        (name) => /^\d+$/.test(name) || name.toLowerCase() === "c1",
      );
    if (reservedComponents.length > 0) {
      throw new Error(
        `BP 已包含站位组件 ${reservedComponents.join("、")}，仅允许写入尚未配置站位和摄像机的空 BP`,
      );
    }
    const dialogueContext = request.registerDialogue
      ? await readDialogueRegistrationContext(
          connection,
          resolved.assetPath,
          [
            {
              modelIndex: 0,
              targetId: null,
              modelClassPath: PLAYER_CLASS,
            },
            ...request.plan.targets.map((target, index) => ({
              modelIndex: index + 1,
              targetId: target.targetId,
              modelClassPath: target.modelClassPath,
            })),
          ],
        )
      : null;

    const requiredAssets = Array.from(
      new Set(
        components
          .map((component) => component.childActorClass)
          .filter(Boolean),
      ),
    );
    for (const classPathValue of requiredAssets) {
      const asset = await connection.invoke("asset.get_asset_by_path", {
        AssetPath: blueprintAssetPath(classPathValue),
      });
      if (!hasUnrealObjectReference(asset)) {
        throw new Error(`模型资产不存在：${classPathValue}`);
      }
    }

    mutationStarted = true;
    for (const component of components) {
      await addBlueprintComponent(
        connection,
        resolved.blueprint,
        component,
      );
    }

    const compileResult = await connection.invoke("bp.compile_blueprint", {
      Bp: resolved.blueprint,
    });
    const compileError = compileFailure(compileResult);
    if (compileError) {
      throw new Error(compileError);
    }

    const actualComponents = await readBlueprintComponents(
      connection,
      blueprint.blueprintClassPath,
    );
    for (const expected of components) {
      const actual = actualComponents.find(
        (component) => component.variableName === expected.componentName,
      );
      if (!actual) {
        throw new Error(`回读时未找到 BP 组件 ${expected.componentName}`);
      }
      if (
        normalizeObjectPath(actual.componentClass) !==
        normalizeObjectPath(expected.componentClass)
      ) {
        throw new Error(
          `BP 组件 ${expected.componentName} 类型回读不一致`,
        );
      }
      if (
        expected.childActorClass &&
        normalizeObjectPath(actual.childActorClass) !==
          normalizeObjectPath(expected.childActorClass)
      ) {
        throw new Error(
          `BP 组件 ${expected.componentName} 的角色资产回读不一致`,
        );
      }
    }

    const saveResult = await connection.invoke(
      "bp.save_asset_and_capture_log",
      { AssetPath: resolved.assetPath },
    );
    const saveError = saveFailure(saveResult);
    if (saveError) {
      throw new Error(saveError);
    }
    blueprintSaved = true;
    const dialogueRegistration = dialogueContext
      ? await writeDialogueRegistration(
          connection,
          resolved.assetPath,
          dialogueContext,
          new Set(assetEntries.map(({ modelIndex }) => modelIndex)),
        )
      : undefined;
    return {
      status: "created",
      taskId: request.plan.taskId,
      blueprintAssetPath: resolved.assetPath,
      targetCount: assetEntries.length,
      componentNames: components.map(
        (component) => component.componentName,
      ),
      dialogueRegistration,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "创建 BP 内容失败";
    throw new Error(
      blueprintSaved
        ? `${message}；BP 已保存，但对话模型注册未完成`
        : mutationStarted
        ? `${message}；BP 可能已在 UE 编辑器中留下未保存修改，请检查后撤销`
        : message,
    );
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

function parsePythonJson(value: unknown, errorMessage: string): unknown {
  try {
    const rawResult = scriptResult(value).trim();
    const serialized =
      rawResult.startsWith("'") && rawResult.endsWith("'")
        ? rawResult.slice(1, -1)
        : rawResult;
    return JSON.parse(serialized);
  } catch {
    throw new Error(errorMessage);
  }
}

async function currentMapName(connection: UnrealInvoker): Promise<string> {
  const value = await connection.invoke("editor.get_current_map_name", {});
  const mapName = String(value ?? "").trim();
  if (!mapName) {
    throw new Error("无法读取 UE 当前关卡");
  }
  return mapName;
}

export async function readSelectedLevelActors(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<SelectedLevelActorsResult> {
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const mapAssetPath = await currentMapName(connection);
    const value = await connection.invoke("script.eval_python_expression", {
      Expression:
        "__import__('json').dumps([{'actor_ref': a.get_path_name(), 'label': a.get_actor_label(), 'class_path': a.get_class().get_path_name(), 'location': [a.get_actor_location().x, a.get_actor_location().y, a.get_actor_location().z], 'rotation': [a.get_actor_rotation().pitch, a.get_actor_rotation().yaw, a.get_actor_rotation().roll], 'scale': [a.get_actor_scale3d().x, a.get_actor_scale3d().y, a.get_actor_scale3d().z]} for a in unreal.EditorLevelLibrary.get_selected_level_actors()])",
    });
    const parsed = parsePythonJson(
      value,
      "无法读取 UE 编辑器当前选择",
    );
    if (!Array.isArray(parsed)) {
      throw new Error("UE 编辑器返回了无效的选择数据");
    }
    const actors: SelectedLevelActor[] = parsed.map((item, index) => {
      const actor = item as {
        actor_ref?: unknown;
        label?: unknown;
        class_path?: unknown;
        location?: unknown[];
        rotation?: unknown[];
        scale?: unknown[];
      };
      const location = actor.location ?? [];
      const rotation = actor.rotation ?? [];
      const scale = actor.scale ?? [];
      const values = [...location, ...rotation, ...scale].map(Number);
      if (
        !actor.actor_ref ||
        !actor.class_path ||
        values.length !== 9 ||
        values.some((number) => !Number.isFinite(number))
      ) {
        throw new Error(`UE 选择数据第 ${index + 1} 项无效`);
      }
      return {
        actorRef: String(actor.actor_ref),
        label: String(actor.label || `Actor ${index + 1}`),
        classPath: String(actor.class_path),
        transform: {
          location: {
            x: values[0],
            y: values[1],
            z: values[2],
          },
          rotation: {
            pitch: values[3],
            yaw: values[4],
            roll: values[5],
          },
          scale: {
            x: values[6],
            y: values[7],
            z: values[8],
          },
        },
      };
    });
    return { mapAssetPath, actors };
  } finally {
    connection.close();
  }
}

export async function scanSelectedNpcRegistration(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<NpcRegistrationScanResult> {
  const csvPaths = configCsvPaths();
  const [
    selection,
    npcText,
    modelText,
    missionTargetText,
    mapText,
    sceneText,
  ] = await Promise.all([
    readSelectedLevelActors(connectionFactory),
    readFile(csvPaths.npc, "utf8"),
    readFile(csvPaths.model, "utf8"),
    readFile(csvPaths.missionTarget, "utf8"),
    readFile(csvPaths.map, "utf8"),
    readFile(csvPaths.scene, "utf8"),
  ]);
  const database = parseNpcRegistrationDatabase(
    npcText,
    modelText,
    missionTargetText,
    mapText,
    sceneText,
    configCsvDirectory,
  );
  return {
    selection,
    candidates: buildNpcRegistrationCandidates(database, selection),
  };
}

export async function openConfigTable(
  rawRequest: unknown,
): Promise<{
  table: "missionTarget" | "npc" | "model";
  path: string;
}> {
  const { table } = ConfigTableOpenSchema.parse(rawRequest);
  const path = getConfigTablePaths()[table];
  await access(path);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("explorer.exe", [path], {
      detached: true,
      stdio: "ignore",
    });
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
    child.once("error", reject);
  });
  return { table, path };
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

async function dirtyContentPackages(
  connection: UnrealInvoker,
): Promise<string[]> {
  const value = await connection.invoke("script.eval_python_expression", {
    Expression:
      "__import__('json').dumps([p.get_path_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()])",
  });
  const parsed = parsePythonJson(
    value,
    "无法确认对话资产是否存在未保存修改",
  );
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error("无法确认对话资产是否存在未保存修改");
  }
  return parsed;
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
      `无法连接 UE 编辑器 OmniMcpCore（${UE_MCP_HOST}:${ueMcpPort}），请确认 UE 编辑器和插件正在运行`,
    );
  }
}

export async function inspectUnrealMcpConnection(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<{
  connected: boolean;
  host: string;
  port: number;
  message: string;
}> {
  const connection = connectionFactory();
  const endpoint = getUnrealMcpEndpoint();
  try {
    await connectUnreal(connection);
    const mapName = String(
      await connection.invoke("editor.get_current_map_name", {}),
    ).trim();
    return {
      connected: true,
      ...endpoint,
      message: mapName
        ? `已连接 UE 编辑器，当前关卡 ${mapName}`
        : "已连接 UE 编辑器 OmniMcpCore",
    };
  } catch (error) {
    return {
      connected: false,
      ...endpoint,
      message:
        error instanceof Error ? error.message : "UE 编辑器连接检查失败",
    };
  } finally {
    connection.close();
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

async function findMissionPreviewActors(
  connection: UnrealInvoker,
): Promise<string[]> {
  const value = await connection.invoke("script.eval_python_expression", {
    Expression:
      `__import__('json').dumps([a.get_path_name() for a in unreal.EditorLevelLibrary.get_all_level_actors() ` +
      `if a.get_name().startswith('${PREVIEW_ACTOR_PREFIX}_') or a.get_actor_label().startswith('${PREVIEW_ACTOR_PREFIX}_')])`,
  });
  const parsed = parsePythonJson(
    value,
    "无法扫描 UE 当前关卡中的目标物预览对象",
  );
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error("UE 编辑器返回了无效的目标物预览列表");
  }
  return Array.from(new Set(parsed));
}

export async function clearMissionTargetPreview(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<{ clearedCount: number }> {
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const currentMap = normalizeLevelPath(await currentMapName(connection));
    let actors: string[];
    let discoveredFromLevel = true;
    try {
      actors = await findMissionPreviewActors(connection);
    } catch (error) {
      discoveredFromLevel = false;
      actors =
        currentMap === normalizeLevelPath(activeMissionPreviewMap)
          ? [...activeMissionPreviewActors]
          : [];
      if (actors.length === 0) {
        throw error;
      }
    }
    if (actors.length === 0) {
      activeMissionPreviewActors = [];
      activeMissionPreviewMap = "";
      return { clearedCount: 0 };
    }
    await deletePreviewActors(connection, actors);
    if (discoveredFromLevel) {
      const remaining = await findMissionPreviewActors(connection);
      if (remaining.length > 0) {
        throw new Error(
          `仍有 ${remaining.length} 个目标物预览对象未能删除`,
        );
      }
    }
    activeMissionPreviewActors = [];
    activeMissionPreviewMap = "";
    return { clearedCount: actors.length };
  } finally {
    connection.close();
  }
}

export async function inspectMissionTargetMap(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<MissionTargetMapStatus> {
  const request = MissionTargetMapStatusRequestSchema.parse(rawRequest);
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const currentMapAssetPath = await currentMapName(connection);
    return {
      currentMapAssetPath,
      expectedMapAssetPath: request.mapAssetPath,
      matches:
        normalizeLevelPath(currentMapAssetPath) ===
        normalizeLevelPath(request.mapAssetPath),
    };
  } finally {
    connection.close();
  }
}

export async function loadMissionTargetPreview(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<MissionTargetPreviewLoadResult> {
  const request = MissionTargetPreviewLoadRequestSchema.parse(rawRequest) as {
    plan: MissionTargetPreviewPlan;
    mapMode: "require-current" | "auto";
  };
  const plan = request.plan;
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
      if (request.mapMode === "require-current") {
        throw new Error(
          `UE 尚未切换到 ${plan.mapName}，当前关卡为 ${currentMap}`,
        );
      }
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

    const existingPreviewActors = await findMissionPreviewActors(connection);
    if (existingPreviewActors.length > 0) {
      await deletePreviewActors(connection, existingPreviewActors);
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
    if (url.pathname === "/api/ue/selection/read") {
      sendJson(response, 200, {
        ok: true,
        data: await readSelectedLevelActors(),
      });
      return true;
    }
    if (url.pathname === "/api/ue/selection/registration") {
      sendJson(response, 200, {
        ok: true,
        data: await scanSelectedNpcRegistration(),
      });
      return true;
    }
    const body = (await readJson(request)) as Record<string, unknown>;
    if (url.pathname === "/api/ue/storyboard/inspect") {
      sendJson(response, 200, {
        ok: true,
        data: await inspectDialogueStoryboardExport(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/storyboard/export") {
      sendJson(response, 200, {
        ok: true,
        data: await exportDialogueStoryboard(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/map-status") {
      sendJson(response, 200, {
        ok: true,
        data: await inspectMissionTargetMap(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/load") {
      sendJson(response, 200, {
        ok: true,
        data: await loadMissionTargetPreview(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/create-blueprint") {
      sendJson(response, 200, {
        ok: true,
        data: await populateMissionTargetBlueprint(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/inspect-blueprint") {
      sendJson(response, 200, {
        ok: true,
        data: await inspectMissionTargetBlueprint(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/register-dialogue") {
      sendJson(response, 200, {
        ok: true,
        data: await registerBlueprintDialogueModels(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/mission-targets/check-blueprint") {
      sendJson(response, 200, {
        ok: true,
        data: await inspectMissionTargetBlueprintCompatibility(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/config-table/open") {
      sendJson(response, 200, {
        ok: true,
        data: await openConfigTable(body),
      });
      return true;
    }
    if (url.pathname === "/api/ue/config-registration/write") {
      sendJson(response, 200, {
        ok: true,
        data: await writeNpcRegistrationDraft({
          ...body,
          paths: getConfigTablePaths(),
        }),
      });
      return true;
    }
    if (url.pathname === "/api/ue/config-registration/update-targets") {
      sendJson(response, 200, {
        ok: true,
        data: await updateMissionTargetTransforms({
          ...body,
          targetPath: getConfigTablePaths().missionTarget,
        }),
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
