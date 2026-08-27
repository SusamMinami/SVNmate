import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type {
  BackgroundPropImportPreview,
  BackgroundPropImportResult,
  BackgroundPropPreviewItem,
  BlueprintFormationSlot,
  BlueprintFormationSnapshot,
  DialogueContentBatchUpdateRequest,
  DialogueContentBatchUpdateResult,
  DialogueContentUpdateRequest,
  DialogueContentUpdateResult,
  DialogueStoryboardExportPreview,
  DialogueStoryboardExportResult,
  DialogueModelRegistrationResult,
  DialogueModelRegistrationSlot,
  MissionTargetBlueprintSyncState,
  MissionTargetBlueprintToTargetsResult,
  MissionTargetBlueprintAppendResult,
  MissionTargetBlueprintCreateResult,
  MissionTargetBlueprintCompatibility,
  MissionTargetBlueprintInspection,
  MissionTargetBlueprintUpdateResult,
  MissionTargetMapStatus,
  MissionTargetPreviewLoadResult,
  MissionTargetPreviewPlan,
  MissionTargetPreviewTarget,
  MissionTargetUpdateResult,
  NpcRegistrationScanResult,
  SelectedLevelActor,
  SelectedLevelActorsResult,
  StoryboardExportNodePreview,
  StoryboardExportRequest,
  StoryboardExportSoundEffectPreview,
  UnrealTransform,
} from "../src/types";
import { parseNpcRegistrationDatabase } from "../src/data/csv";
import {
  blueprintTransformFromWorld,
  buildMissionTargetBlueprintSync,
  missionTargetBlueprintRootForCreation,
  type MissionTargetBlueprintRoot,
} from "../src/data/missionTargetBlueprintSync";
import { buildNpcRegistrationCandidates } from "../src/data/npcRegistration";
import {
  getConfigCsvDirectory,
  getConfigCsvPaths,
  getConfigTablePaths,
  readConfiguredMissionTargetPlan,
} from "./configRepository";
import { updateMissionTargetTransforms } from "./excelRegistration";
import {
  getUnrealMcpEndpoint,
  UnrealMcpConnection,
  type UnrealInvoker,
} from "./ue/transport";

const PREVIEW_MARKER_CLASS = "/Script/Engine.TargetPoint";
const PREVIEW_ACTOR_PREFIX = "ShotSandboxMissionTargetPreview";
const PREVIEW_DELETE_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1_200];
const BLUEPRINT_SEARCH_PATH = "/Game/Seria/Task/Mod";
const POSITION_MODE_BASE_CLASS =
  "/Game/Seria/Task/Mod/PositionMode/PositionModeBase.PositionModeBase_C";
const PLAYER_CLASS =
  "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C";
const CHILD_ACTOR_COMPONENT_CLASS = "/Script/Engine.ChildActorComponent";
const CAMERA_COMPONENT_CLASS = "/Script/Engine.CameraComponent";
const SKELETAL_MESH_COMPONENT_CLASS =
  "/Script/Engine.SkeletalMeshComponent";
const STATIC_MESH_COMPONENT_CLASS = "/Script/Engine.StaticMeshComponent";
const DIALOGUE_SEARCH_PATH = "/Game/Seria/Task/dialoggraph";
const SOUND_EFFECT_SEARCH_PATH = "/Game/Seria/WwiseSoundData/Events";
const DIALOG_NPC_TABLE_PATH =
  "/Game/Seria/Task/Mod/DialogNPCTable.DialogNPCTable";

function withMissionTargetOverrides(
  plan: MissionTargetPreviewPlan,
  overrides:
    | Array<{
        targetId: string;
        transform: {
          location: { x: number; y: number; z: number };
          rotation: { pitch: number; yaw: number; roll: number };
        };
      }>
    | undefined,
): MissionTargetPreviewPlan {
  if (!overrides?.length) {
    return plan;
  }
  const ids = overrides.map((override) => override.targetId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("目标物坐标覆盖中存在重复 ID");
  }
  const planIds = new Set(plan.targets.map((target) => target.targetId));
  const unknownIds = ids.filter((id) => !planIds.has(id));
  if (unknownIds.length > 0) {
    throw new Error(
      `目标物坐标覆盖不属于当前任务：${unknownIds.join("、")}`,
    );
  }
  const byId = new Map(
    overrides.map((override) => [
      override.targetId,
      override.transform,
    ]),
  );
  return {
    ...plan,
    targets: plan.targets.map((target) => {
      const transform = byId.get(target.targetId);
      return transform
        ? {
            ...target,
            transform: {
              ...target.transform,
              location: { ...transform.location },
              rotation: { ...transform.rotation },
            },
          }
        : target;
    }),
  };
}

export interface BlueprintFormationLookup {
  status: "found" | "not_found" | "editor_offline" | "unavailable";
  message: string;
  snapshot?: BlueprintFormationSnapshot;
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

const MissionTargetBlueprintAppendRequestSchema = z.object({
  blueprintName: z.string().trim().min(1).max(512),
  plan: MissionTargetPreviewPlanSchema,
  selectedTargetIds: z
    .array(z.string().regex(/^\d+$/))
    .min(1)
    .max(200),
});

const MissionTargetTransformOverrideSchema = z.object({
  targetId: z.string().regex(/^\d+$/),
  transform: z.object({
    location: VectorSchema,
    rotation: RotatorSchema,
  }),
});

const MissionTargetBlueprintInspectionRequestSchema = z.object({
  blueprintName: z.string().trim().min(1).max(512),
  plan: MissionTargetPreviewPlanSchema.optional(),
  taskId: z.string().regex(/^\d+$/).optional(),
  targetOverrides: z
    .array(MissionTargetTransformOverrideSchema)
    .max(200)
    .optional(),
});

const DialogueModelRegistrationRequestSchema = z.object({
  blueprintName: z.string().trim().min(1).max(512),
  selectedModelIndexes: z
    .array(z.number().int().positive())
    .max(200),
  preserveModels: z.boolean().optional(),
  taskId: z.string().regex(/^\d+$/).optional(),
  targetOverrides: z
    .array(MissionTargetTransformOverrideSchema)
    .max(200)
    .optional(),
});

const MissionTargetBlueprintSyncRequestSchema = z.object({
  blueprintName: z.string().trim().min(1).max(512),
  taskId: z.string().regex(/^\d+$/),
  selectedTargetIds: z
    .array(z.string().regex(/^\d+$/))
    .max(200)
    .optional(),
  targetOverrides: z
    .array(MissionTargetTransformOverrideSchema)
    .max(200)
    .optional(),
});

const BackgroundPropInspectRequestSchema = z.object({
  blueprintName: z.string().trim().min(1).max(512),
  actorRefs: z.array(z.string().min(1)).min(1).max(200).optional(),
});

const BackgroundPropApplyRequestSchema =
  BackgroundPropInspectRequestSchema.omit({ actorRefs: true }).extend({
    reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
    selectedActorRefs: z.array(z.string().min(1)).min(1).max(200),
    reviewedActorRefs: z.array(z.string().min(1)).min(1).max(200).optional(),
  });

const StoryboardVec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const StoryboardExportRequestSchema = z.object({
  dialogueId: z.string().regex(/^\d{4}$/),
  startId: z.string().regex(/^\d{4,}$/),
  dialogueIds: z.array(z.string().regex(/^\d+$/)).max(500),
  participantModelIndexes: z
    .array(z.number().int().nonnegative())
    .max(12),
  usesBlueprintFormation: z.boolean(),
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
        actorActions: z
          .array(
            z.object({
              modelIndex: z.number().int().nonnegative(),
              montageName: z.string().regex(/^AM_Turn(?:Left|Right)(?:45|90|180)$/),
              angleDegrees: z.union([
                z.literal(-180),
                z.literal(-90),
                z.literal(-45),
                z.literal(45),
                z.literal(90),
                z.literal(180),
              ]),
            }),
          )
          .max(24)
          .optional()
          .default([]),
      }),
    )
    .max(500),
  soundEffects: z
    .array(
      z.object({
        dialogueId: z.string().regex(/^\d+$/),
        assetName: z.string().regex(/^A_SFX_[A-Za-z0-9_]+$/),
      }),
    )
    .max(100)
    .optional()
    .default([]),
});

const StoryboardExportApplyRequestSchema = StoryboardExportRequestSchema.extend({
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
});

const DialogueContentUpdateRequestSchema = z.object({
  dialogueId: z.string().regex(/^\d{4}$/),
  startId: z.string().regex(/^\d{4,}$/),
  dialogueNodeId: z.string().regex(/^\d+$/),
  previousContent: z.string().max(20_000),
  content: z
    .string()
    .max(20_000)
    .refine((value) => value.trim().length > 0, "对白内容不能为空"),
});

const DialogueContentBatchUpdateRequestSchema = z.object({
  items: z.array(DialogueContentUpdateRequestSchema).min(1).max(200),
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

function unrealReferenceText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    let knownPathField = false;
    for (const key of [
      "AssetPathName",
      "assetPathName",
      "ObjectPath",
      "objectPath",
      "AssetPath",
      "assetPath",
      "Path",
      "path",
      "Value",
      "value",
    ]) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        knownPathField = true;
      }
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
    if (knownPathField) {
      return "";
    }
  }
  return String(value ?? "");
}

function unrealBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return ["true", "1", "yes"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

function unrealStructNumber(
  value: unknown,
  keys: string[],
  tupleIndex: number,
): number {
  if (Array.isArray(value)) {
    return Number(value[tupleIndex] ?? 0);
  }
  if (typeof value === "string") {
    for (const key of keys) {
      const matched = value.match(
        new RegExp(`${key}\\s*=\\s*(-?[\\d.]+)`, "i"),
      );
      if (matched) {
        return Number(matched[1]);
      }
    }
    return 0;
  }
  const record = (value ?? {}) as Record<string, unknown>;
  for (const key of keys) {
    const matchedKey = Object.keys(record).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (matchedKey !== undefined) {
      return Number(record[matchedKey] ?? 0);
    }
  }
  return 0;
}

function assetPathFromSearch(value: string): string | null {
  return value.match(/\[([^\]]+)\]\s*$/)?.[1] ?? null;
}

function assetNameFromPath(value: string): string {
  const objectPath = value.split(".").at(-1) ?? "";
  return objectPath.replace(/_C$/i, "");
}

function vector(value: unknown): { x: number; y: number; z: number } {
  return {
    x: unrealStructNumber(value, ["X"], 0),
    y: unrealStructNumber(value, ["Y"], 1),
    z: unrealStructNumber(value, ["Z"], 2),
  };
}

function rotator(
  value: unknown,
): { pitch: number; yaw: number; roll: number } {
  return {
    pitch: unrealStructNumber(value, ["Pitch", "P"], 0),
    yaw: unrealStructNumber(value, ["Yaw", "Y"], 1),
    roll: unrealStructNumber(value, ["Roll", "R"], 2),
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
  sourceAssetPath: string;
  componentTemplate: string;
  transform: UnrealTransform;
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
): MissionTargetBlueprintComponentPlan[] {
  if (targets.length === 0) {
    throw new Error("至少选择一个具有模型资源的目标物");
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
      componentName: String(index + 1),
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

function normalizeObjectPath(value: unknown): string {
  const trimmed = unrealReferenceText(value).trim().replaceAll("\\", "/");
  const referencedPath = trimmed.match(/'([^']+)'/)?.[1] ?? trimmed;
  return referencedPath.toLowerCase();
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
  const rawName = assetNameFromPath(
    normalized.split("/").at(-1) ?? normalized,
  );
  const name = /^\d{4}$/.test(rawName)
    ? `BP_${rawName}00`
    : rawName;
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
    let sourceAssetPath = "";
    let transform: UnrealTransform = {
      location: { x: 0, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
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
      sourceAssetPath = childActorClass;
    } else if (
      componentClass.endsWith("SkeletalMeshComponent") &&
      hasUnrealObjectReference(componentTemplate)
    ) {
      sourceAssetPath = String(
        (await readProperty(
          connection,
          String(componentTemplate),
          "SkeletalMesh",
        )) ?? "",
      );
    } else if (
      componentClass.endsWith("StaticMeshComponent") &&
      hasUnrealObjectReference(componentTemplate)
    ) {
      sourceAssetPath = String(
        (await readProperty(
          connection,
          String(componentTemplate),
          "StaticMesh",
        )) ?? "",
      );
    }
    if (hasUnrealObjectReference(componentTemplate)) {
      const [location, rotation, scale] = await Promise.all([
        readProperty(
          connection,
          String(componentTemplate),
          "RelativeLocation",
        ),
        readProperty(
          connection,
          String(componentTemplate),
          "RelativeRotation",
        ),
        readProperty(
          connection,
          String(componentTemplate),
          "RelativeScale3D",
        ),
      ]);
      const parsedScale = vector(scale);
      transform = {
        location: vector(location),
        rotation: rotator(rotation),
        scale: {
          x: Number.isFinite(parsedScale.x) && parsedScale.x !== 0
            ? parsedScale.x
            : 1,
          y: Number.isFinite(parsedScale.y) && parsedScale.y !== 0
            ? parsedScale.y
            : 1,
          z: Number.isFinite(parsedScale.z) && parsedScale.z !== 0
            ? parsedScale.z
            : 1,
        },
      };
    }
    result.push({
      variableName,
      componentClass,
      childActorClass,
      sourceAssetPath,
      componentTemplate: String(componentTemplate ?? ""),
      transform,
    });
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
): { matched: boolean; message: string; selectedModels: string[] } {
  const expected = dialogueModels
    .filter(
      (model) =>
        !["", "none", "player"].includes(model.trim().toLowerCase()),
    )
    .map(modelToken);
  const selectedModels = selectedClassPaths.map(modelToken);
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
  CurrentFloat?: unknown;
  CurrentPath?: unknown;
  [key: string]: unknown;
}

interface DialogueNodeContext {
  dialogueId: string;
  nodeDataPath: string;
  commonProperties: ReflectedProperty[];
}

interface StoryboardDialogueNodeContext extends DialogueNodeContext {
  cameraPropertyIndex: number;
  existingCameraPosition: string;
  existingMoveCameras: unknown[];
}

interface StoryboardExportNodeChange {
  preview: StoryboardExportNodePreview | null;
  soundEffectPreview: StoryboardExportSoundEffectPreview | null;
  nodeDataPath: string;
  originalCommonProperties: ReflectedProperty[];
  desiredCommonProperties: ReflectedProperty[];
  originalMoveCameras: unknown[];
  desiredMoveCameras: unknown[];
  writeCameraProperties: boolean;
  writeSoundEffect: boolean;
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

function formatUnrealMismatchValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

function unrealValueMismatch(
  actual: unknown,
  expected: unknown,
  path: string,
): string | null {
  if (typeof actual === "number" && typeof expected === "number") {
    const tolerance = 0.0001 + Math.abs(expected) * 0.000001;
    return Number.isFinite(actual) &&
      Number.isFinite(expected) &&
      Math.abs(actual - expected) <= tolerance
      ? null
      : `${path} 期望 ${expected}，回读 ${actual}`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return `${path} 期望数组，回读 ${formatUnrealMismatchValue(actual)}`;
    }
    if (actual.length !== expected.length) {
      return `${path} 期望 ${expected.length} 项，回读 ${actual.length} 项`;
    }
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = unrealValueMismatch(
        actual[index],
        expected[index],
        `${path}[${index}]`,
      );
      if (mismatch) {
        return mismatch;
      }
    }
    return null;
  }
  if (expected !== null && typeof expected === "object") {
    if (
      actual === null ||
      typeof actual !== "object" ||
      Array.isArray(actual)
    ) {
      return `${path} 期望对象，回读 ${formatUnrealMismatchValue(actual)}`;
    }
    const actualRecord = actual as Record<string, unknown>;
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (!(key in actualRecord)) {
        return `${path}.${key} 未在回读结果中出现`;
      }
      const mismatch = unrealValueMismatch(
        actualRecord[key],
        expectedValue,
        `${path}.${key}`,
      );
      if (mismatch) {
        return mismatch;
      }
    }
    return null;
  }
  return Object.is(actual, expected)
    ? null
    : `${path} 期望 ${formatUnrealMismatchValue(expected)}，回读 ${formatUnrealMismatchValue(actual)}`;
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
  const soundEffects = request.soundEffects ?? [];
  if (request.shots.length === 0 && soundEffects.length === 0) {
    throw new Error("至少选择一个镜头或音效");
  }
  if (
    request.shots.length > 0 &&
    (!request.usesBlueprintFormation ||
      request.participantModelIndexes.length < 2)
  ) {
    throw new Error("镜头导出必须绑定完整的 UE Blueprint 站位");
  }
  const actualIds = request.shots.flatMap((shot) => shot.dialogueIds);
  if (
    actualIds.length !== request.dialogueIds.length ||
    actualIds.some(
      (dialogueId, index) => dialogueId !== request.dialogueIds[index],
    )
  ) {
    throw new Error("分镜必须按原顺序覆盖本次导出的全部台词节点");
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
  const soundEffectDialogueIds = soundEffects.map(
    (soundEffect) => soundEffect.dialogueId,
  );
  if (
    new Set(soundEffectDialogueIds).size !==
    soundEffectDialogueIds.length
  ) {
    throw new Error("同一台词节点只能导出一个音效");
  }
  const invalidSoundEffectNode = soundEffectDialogueIds.find(
    (dialogueId) => !dialogueId.startsWith(request.dialogueId),
  );
  if (invalidSoundEffectNode) {
    throw new Error(
      `音效节点 ${invalidSoundEffectNode} 不属于对话 ${request.dialogueId}`,
    );
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

async function readDialogueNodes(
  connection: UnrealInvoker,
  dialogueAssetPath: string,
  dialogueIds: string[],
  exportedText: string,
): Promise<DialogueNodeContext[]> {
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
  const result: DialogueNodeContext[] = [];
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
    result.push({
      dialogueId,
      nodeDataPath,
      commonProperties,
    });
  }
  return result;
}

async function readStoryboardDialogueNodes(
  connection: UnrealInvoker,
  dialogueAssetPath: string,
  dialogueIds: string[],
  exportedText: string,
): Promise<StoryboardDialogueNodeContext[]> {
  const dialogueNodes = await readDialogueNodes(
    connection,
    dialogueAssetPath,
    dialogueIds,
    exportedText,
  );
  const result: StoryboardDialogueNodeContext[] = [];
  for (const node of dialogueNodes) {
    const commonProperties = node.commonProperties;
    const cameraPropertyIndex = commonProperties.findIndex(
      (property) =>
        String(property.Alias).toLowerCase() === "cameraposition",
    );
    if (cameraPropertyIndex < 0) {
      throw new Error(`台词节点 ${node.dialogueId} 缺少 CameraPosition 属性`);
    }
    const existingMoveCameras = reflectedArray(
      await readProperty(connection, node.nodeDataPath, "MoveCameras"),
      "MoveCameras",
    );
    result.push({
      ...node,
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

function storyboardShotBlockedReasons(
  shot: StoryboardExportRequest["shots"][number],
  index: number,
): string[] {
  const changesFocalLength =
    Math.abs(shot.endFocalLength - shot.focalLength) > 0.001 ||
    shot.cameraMovement.includes("zoom");
  return changesFocalLength
    ? [
        `镜头 ${index + 1} 使用焦距连续变化，当前 UE MoveCameras 映射尚不能无损表达`,
      ]
    : [];
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

async function findSoundEffectAssetPath(
  connection: UnrealInvoker,
  assetName: string,
): Promise<string> {
  const result = await connection.invoke("asset.asset_search", {
    Query: assetName,
    PathFilter: SOUND_EFFECT_SEARCH_PATH,
    Limit: 100,
  });
  const matches = Array.from(
    new Set(
      (Array.isArray(result) ? result : [])
        .map((value) => assetPathFromSearch(String(value)))
        .filter((value): value is string => Boolean(value))
        .filter((value) => assetNameFromPath(value) === assetName),
    ),
  );
  if (matches.length === 0) {
    throw new Error(`UE 中未找到音效资产 ${assetName}`);
  }
  if (matches.length > 1) {
    throw new Error(`UE 中存在多个同名音效资产 ${assetName}，无法自动确认`);
  }
  return matches[0];
}

async function prepareStoryboardExport(
  connection: UnrealInvoker,
  request: StoryboardExportRequest,
): Promise<PreparedStoryboardExport> {
  validateStoryboardCoverage(request);
  const requestedSoundEffects = request.soundEffects ?? [];
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
  const layout =
    request.shots.length > 0
      ? await readFormationExportLayout(
          connection,
          request.startId,
          exportedDialogue.formationClassPath ?? "",
          request.participantModelIndexes,
        )
      : null;
  const requestedDialogueIds = Array.from(
    new Set([
      ...request.dialogueIds,
      ...requestedSoundEffects.map((soundEffect) => soundEffect.dialogueId),
    ]),
  );
  const dialogueNodes = await readStoryboardDialogueNodes(
    connection,
    dialogueAssetPath,
    requestedDialogueIds,
    exportedText,
  );
  const shotByDialogueId = new Map(
    request.shots.flatMap((shot, shotIndex) =>
      shot.dialogueIds.map((dialogueId) => [
        dialogueId,
        { shot, shotIndex },
      ] as const),
    ),
  );
  const resolvedSoundEffects: StoryboardExportSoundEffectPreview[] = [];
  for (const [soundEffectIndex, soundEffect] of requestedSoundEffects.entries()) {
    resolvedSoundEffects.push({
      soundEffectIndex,
      dialogueId: soundEffect.dialogueId,
      assetName: soundEffect.assetName,
      resolvedAssetPath: await findSoundEffectAssetPath(
        connection,
        soundEffect.assetName,
      ),
      existingAssetPath: "",
      action: "unchanged",
    });
  }
  const soundEffectByDialogueId = new Map(
    resolvedSoundEffects.map((soundEffect) => [
      soundEffect.dialogueId,
      soundEffect,
    ]),
  );
  const changes = dialogueNodes.map((node) => {
    const shotEntry = shotByDialogueId.get(node.dialogueId);
    const soundEffect = soundEffectByDialogueId.get(node.dialogueId);
    const desiredCommonProperties = clonedValue(node.commonProperties);
    let preview: StoryboardExportNodePreview | null = null;
    let desiredMoveCameras = node.existingMoveCameras;
    let writeCameraProperties = false;
    let writeMoveCameras = false;
    if (shotEntry && layout) {
      const isShotStart = shotEntry.shot.dialogueId === node.dialogueId;
      const role: StoryboardExportNodePreview["role"] = isShotStart
        ? "shot_start"
        : "continuation";
      const desiredCameraPosition = isShotStart ? layout.cameraName : "";
      desiredMoveCameras = isShotStart
        ? [buildStoryboardCameraMove(shotEntry.shot, layout)]
        : [];
      desiredCommonProperties[node.cameraPropertyIndex].CurrentString =
        desiredCameraPosition;
      writeCameraProperties =
        node.existingCameraPosition !== desiredCameraPosition;
      writeMoveCameras =
        unrealValueMismatch(
          node.existingMoveCameras,
          desiredMoveCameras,
          "MoveCameras",
        ) !== null;
      preview = {
        dialogueId: node.dialogueId,
        shotIndex: shotEntry.shotIndex,
        role,
        action: exportAction(
          role,
          node.existingCameraPosition,
          node.existingMoveCameras.length,
          desiredCameraPosition,
          desiredMoveCameras.length,
          !writeCameraProperties && !writeMoveCameras,
        ),
        existingCameraPosition: node.existingCameraPosition,
        desiredCameraPosition,
        existingMovementCount: node.existingMoveCameras.length,
        desiredMovementCount: desiredMoveCameras.length,
      };
    }
    let soundEffectPreview: StoryboardExportSoundEffectPreview | null = null;
    let writeSoundEffect = false;
    if (soundEffect) {
      const propertyIndex = node.commonProperties.findIndex(
        (property) =>
          String(property.Alias).toLowerCase() === "soundeffect",
      );
      if (propertyIndex < 0) {
        throw new Error(
          `台词节点 ${node.dialogueId} 缺少 SoundEffect 属性`,
        );
      }
      const rawExistingPath = unrealReferenceText(
        node.commonProperties[propertyIndex].CurrentPath,
      );
      const existingAssetPath = ["none", "null"].includes(
        rawExistingPath.toLowerCase(),
      )
        ? ""
        : rawExistingPath;
      writeSoundEffect =
        existingAssetPath.toLowerCase() !==
        soundEffect.resolvedAssetPath.toLowerCase();
      desiredCommonProperties[propertyIndex].CurrentPath =
        soundEffect.resolvedAssetPath;
      soundEffectPreview = {
        ...soundEffect,
        existingAssetPath,
        action: writeSoundEffect
          ? existingAssetPath
            ? "replace"
            : "add"
          : "unchanged",
      };
    }
    return {
      preview,
      soundEffectPreview,
      nodeDataPath: node.nodeDataPath,
      originalCommonProperties: node.commonProperties,
      desiredCommonProperties,
      originalMoveCameras: node.existingMoveCameras,
      desiredMoveCameras,
      writeCameraProperties,
      writeSoundEffect,
      writeCommonProperties: writeCameraProperties || writeSoundEffect,
      writeMoveCameras,
    };
  });
  const dirtyPackages = new Set(
    (await dirtyContentPackages(connection)).map((path) =>
      path.toLowerCase(),
    ),
  );
  const dialoguePackagePath = dialogueAssetPath.split(".")[0];
  const formationPackagePath = layout?.assetPath.split(".")[0] ?? "";
  const shotPreviews = request.shots.map((shot, shotIndex) => ({
    shotIndex,
    dialogueIds: [...shot.dialogueIds],
    projectionValid: shot.projectionValid,
    actorActionCount: shot.actorActions?.length ?? 0,
    blockedReasons: storyboardShotBlockedReasons(shot, shotIndex),
  }));
  const globalBlockedReasons = [
    ...(dirtyPackages.has(dialoguePackagePath.toLowerCase())
      ? [
          `对话资产 ${dialoguePackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
        ]
      : []),
    ...(formationPackagePath &&
    dirtyPackages.has(formationPackagePath.toLowerCase())
      ? [
          `Formation BP ${formationPackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
        ]
      : []),
  ];
  const blockedReasons = [
    ...globalBlockedReasons,
    ...shotPreviews.flatMap((shot) => shot.blockedReasons),
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
        formationAssetPath: layout?.assetPath ?? "",
        request,
        nodes: changes.map((change) => ({
          dialogueId:
            change.preview?.dialogueId ??
            change.soundEffectPreview?.dialogueId,
          originalCommonProperties: change.originalCommonProperties,
          originalMoveCameras: change.originalMoveCameras,
          desiredCommonProperties: change.desiredCommonProperties,
          desiredMoveCameras: change.desiredMoveCameras,
        })),
      }),
    )
    .digest("hex");
  const changedCameraNodes = changes.filter(
    (change) =>
      change.preview &&
      (change.writeCameraProperties || change.writeMoveCameras),
  );
  const soundEffectPreviews = changes.flatMap((change) =>
    change.soundEffectPreview ? [change.soundEffectPreview] : [],
  );
  return {
    preview: {
      reviewToken,
      dialogueId: request.dialogueId,
      startId: request.startId,
      dialogueAssetPath,
      formationAssetPath: layout?.assetPath ?? "",
      cameraName: layout?.cameraName ?? "",
      shotCount: request.shots.length,
      changedNodeCount: changedCameraNodes.length,
      overwrittenNodeCount: changes.filter(
        (change) => change.preview?.action === "replace",
      ).length,
      clearedNodeCount: changes.filter(
        (change) => change.preview?.action === "clear",
      ).length,
      soundEffectCount: soundEffectPreviews.length,
      changedSoundEffectCount: soundEffectPreviews.filter(
        (soundEffect) => soundEffect.action !== "unchanged",
      ).length,
      replacedSoundEffectCount: soundEffectPreviews.filter(
        (soundEffect) => soundEffect.action === "replace",
      ).length,
      invalidShotCount,
      globalBlockedReasons,
      blockedReasons,
      warnings,
      shots: shotPreviews,
      nodes: changes.flatMap((change) =>
        change.preview ? [change.preview] : [],
      ),
      soundEffects: soundEffectPreviews.sort(
        (left, right) =>
          left.soundEffectIndex - right.soundEffectIndex,
      ),
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
        "UE 中的对话镜头或音效配置已发生变化，请重新检查后再导出",
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
        changedSoundEffectCount: 0,
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
        const mismatches: string[] = [];
        if (change.writeCommonProperties) {
          const commonPropertiesMismatch = unrealValueMismatch(
            commonProperties,
            change.desiredCommonProperties,
            "CommonDialogGraphProperties",
          );
          if (commonPropertiesMismatch) {
            mismatches.push(commonPropertiesMismatch);
          }
        }
        if (change.writeMoveCameras) {
          const moveCameras = reflectedArray(
            await readProperty(
              connection,
              change.nodeDataPath,
              "MoveCameras",
            ),
            "MoveCameras",
          );
          const moveCamerasMismatch = unrealValueMismatch(
            moveCameras,
            change.desiredMoveCameras,
            "MoveCameras",
          );
          if (moveCamerasMismatch) {
            mismatches.push(moveCamerasMismatch);
          }
        }
        if (mismatches.length > 0) {
          throw new Error(
            `台词节点 ${change.preview?.dialogueId ?? change.soundEffectPreview?.dialogueId} 写入后的回读结果不一致：${mismatches.join("；")}`,
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
      const recoveryFailures: string[] = [];
      for (const change of [...written].reverse()) {
        if (change.writeCommonProperties) {
          try {
            await connection.invoke("reflect.write_object_property", {
              ThisPtr: change.nodeDataPath,
              PropertyName: "CommonDialogGraphProperties",
              Value: change.originalCommonProperties,
            });
          } catch (recoveryError) {
            recoveryFailures.push(
              `${change.nodeDataPath}.CommonDialogGraphProperties 恢复写入失败：${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
            );
          }
        }
        if (change.writeMoveCameras) {
          try {
            await connection.invoke("reflect.write_object_property", {
              ThisPtr: change.nodeDataPath,
              PropertyName: "MoveCameras",
              Value: change.originalMoveCameras,
            });
          } catch (recoveryError) {
            recoveryFailures.push(
              `${change.nodeDataPath}.MoveCameras 恢复写入失败：${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
            );
          }
        }
      }
      for (const change of written) {
        if (change.writeCommonProperties) {
          try {
            const restored = reflectedArray(
              await readProperty(
                connection,
                change.nodeDataPath,
                "CommonDialogGraphProperties",
              ),
              "CommonDialogGraphProperties",
            );
            const mismatch = unrealValueMismatch(
              restored,
              change.originalCommonProperties,
              "CommonDialogGraphProperties",
            );
            if (mismatch) {
              recoveryFailures.push(
                `${change.nodeDataPath} 恢复回读不一致：${mismatch}`,
              );
            }
          } catch (recoveryError) {
            recoveryFailures.push(
              `${change.nodeDataPath}.CommonDialogGraphProperties 恢复回读失败：${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
            );
          }
        }
        if (change.writeMoveCameras) {
          try {
            const restored = reflectedArray(
              await readProperty(
                connection,
                change.nodeDataPath,
                "MoveCameras",
              ),
              "MoveCameras",
            );
            const mismatch = unrealValueMismatch(
              restored,
              change.originalMoveCameras,
              "MoveCameras",
            );
            if (mismatch) {
              recoveryFailures.push(
                `${change.nodeDataPath} 恢复回读不一致：${mismatch}`,
              );
            }
          } catch (recoveryError) {
            recoveryFailures.push(
              `${change.nodeDataPath}.MoveCameras 恢复回读失败：${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
            );
          }
        }
      }
      const recoveryMessage =
        recoveryFailures.length > 0
          ? `；恢复失败，请立即在 UE 中检查：${recoveryFailures.join("；")}`
          : "；已恢复本轮未保存修改";
      throw new Error(
        `${error instanceof Error ? error.message : "对话数据导出失败"}${recoveryMessage}`,
      );
    }
    return {
      status: "exported",
      dialogueId: request.dialogueId,
      startId: request.startId,
      dialogueAssetPath: prepared.preview.dialogueAssetPath,
      changedNodeCount: prepared.preview.changedNodeCount,
      changedSoundEffectCount:
        prepared.preview.changedSoundEffectCount,
      saved: true,
    };
  } finally {
    connection.close();
  }
}

export async function updateDialogueContent(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<DialogueContentUpdateResult> {
  const request = DialogueContentUpdateRequestSchema.parse(
    rawRequest,
  ) as DialogueContentUpdateRequest;
  if (
    !request.startId.startsWith(request.dialogueId) ||
    !request.dialogueNodeId.startsWith(request.dialogueId)
  ) {
    throw new Error("对话节点不属于当前四位数对话 ID");
  }
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
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
    const dialogueAsset = await connection.invoke(
      "asset.get_asset_by_path",
      { AssetPath: dialogueAssetPath },
    );
    if (!hasUnrealObjectReference(dialogueAsset)) {
      throw new Error(`无法加载对话资产：${dialogueAssetPath}`);
    }
    const exportedText = await exportAssetText(
      connection,
      dialogueAssetPath,
    );
    const [node] = await readDialogueNodes(
      connection,
      dialogueAssetPath,
      [request.dialogueNodeId],
      exportedText,
    );
    const contentPropertyIndex = node.commonProperties.findIndex(
      (property) => String(property.Alias).toLowerCase() === "content",
    );
    if (contentPropertyIndex < 0) {
      throw new Error(`台词节点 ${request.dialogueNodeId} 缺少 Content 属性`);
    }
    const existingContent = String(
      node.commonProperties[contentPropertyIndex].CurrentString ?? "",
    );
    if (existingContent !== request.previousContent) {
      throw new Error(
        `台词节点 ${request.dialogueNodeId} 的 UE 内容已发生变化，请重新加载后再编辑`,
      );
    }
    const dialoguePackagePath = dialogueAssetPath.split(".")[0];
    const dirtyPackages = new Set(
      (await dirtyContentPackages(connection)).map((path) =>
        path.toLowerCase(),
      ),
    );
    if (dirtyPackages.has(dialoguePackagePath.toLowerCase())) {
      throw new Error(
        `对话资产 ${dialoguePackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
      );
    }
    if (existingContent === request.content) {
      return {
        status: "unchanged",
        dialogueId: request.dialogueId,
        startId: request.startId,
        dialogueNodeId: request.dialogueNodeId,
        dialogueAssetPath,
        content: existingContent,
        saved: false,
      };
    }

    const desiredProperties = clonedValue(node.commonProperties);
    desiredProperties[contentPropertyIndex].CurrentString =
      request.content;
    let writeStarted = false;
    try {
      writeStarted = true;
      await connection.invoke("reflect.write_object_property", {
        ThisPtr: node.nodeDataPath,
        PropertyName: "CommonDialogGraphProperties",
        Value: desiredProperties,
      });
      const writtenProperties = reflectedArray(
        await readProperty(
          connection,
          node.nodeDataPath,
          "CommonDialogGraphProperties",
        ),
        "CommonDialogGraphProperties",
      ) as ReflectedProperty[];
      const writtenContent = String(
        writtenProperties.find(
          (property) =>
            String(property.Alias).toLowerCase() === "content",
        )?.CurrentString ?? "",
      );
      if (writtenContent !== request.content) {
        throw new Error(
          `台词节点 ${request.dialogueNodeId} 写入后的回读结果不一致`,
        );
      }
      const saveResult = await connection.invoke("asset.save_asset", {
        Asset: String(dialogueAsset) || dialogueAssetPath,
      });
      if (saveResult === false) {
        throw new Error(`对话资产保存失败：${dialogueAssetPath}`);
      }
    } catch (error) {
      if (writeStarted) {
        await connection
          .invoke("reflect.write_object_property", {
            ThisPtr: node.nodeDataPath,
            PropertyName: "CommonDialogGraphProperties",
            Value: node.commonProperties,
          })
          .catch(() => undefined);
      }
      throw new Error(
        `${error instanceof Error ? error.message : "对白保存失败"}；已尝试恢复本轮未保存修改`,
      );
    }
    return {
      status: "updated",
      dialogueId: request.dialogueId,
      startId: request.startId,
      dialogueNodeId: request.dialogueNodeId,
      dialogueAssetPath,
      content: request.content,
      saved: true,
    };
  } finally {
    connection.close();
  }
}

interface PreparedDialogueContentChange {
  request: DialogueContentUpdateRequest;
  dialogueAssetPath: string;
  dialogueAsset: string;
  nodeDataPath: string;
  originalProperties: ReflectedProperty[];
  desiredProperties: ReflectedProperty[];
  changed: boolean;
}

export async function updateDialogueContents(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<DialogueContentBatchUpdateResult> {
  const request = DialogueContentBatchUpdateRequestSchema.parse(
    rawRequest,
  ) as DialogueContentBatchUpdateRequest;
  const itemKeys = request.items.map(
    (item) => `${item.startId}:${item.dialogueNodeId}`,
  );
  if (new Set(itemKeys).size !== itemKeys.length) {
    throw new Error("批量对白修改中存在重复节点");
  }
  for (const item of request.items) {
    if (
      !item.startId.startsWith(item.dialogueId) ||
      !item.dialogueNodeId.startsWith(item.dialogueId)
    ) {
      throw new Error(`台词节点 ${item.dialogueNodeId} 不属于对话 ${item.dialogueId}`);
    }
  }

  const connection = connectionFactory();
  await connectUnreal(connection);
  const prepared: PreparedDialogueContentChange[] = [];
  const written: PreparedDialogueContentChange[] = [];
  const savedAssets = new Set<string>();
  try {
    const itemsByStartId = new Map<string, DialogueContentUpdateRequest[]>();
    for (const item of request.items) {
      const group = itemsByStartId.get(item.startId) ?? [];
      group.push(item);
      itemsByStartId.set(item.startId, group);
    }

    for (const [startId, items] of itemsByStartId) {
      const dialogueAssets = await findDialogueAssetPath(connection, startId);
      if (dialogueAssets.length === 0) {
        throw new Error(`未找到对话资产 ${startId}`);
      }
      if (dialogueAssets.length > 1) {
        throw new Error(`找到多个名为 ${startId} 的对话资产，无法自动确认`);
      }
      const dialogueAssetPath = dialogueAssets[0];
      const dialogueAsset = await connection.invoke(
        "asset.get_asset_by_path",
        { AssetPath: dialogueAssetPath },
      );
      if (!hasUnrealObjectReference(dialogueAsset)) {
        throw new Error(`无法加载对话资产：${dialogueAssetPath}`);
      }
      const exportedText = await exportAssetText(
        connection,
        dialogueAssetPath,
      );
      const nodes = await readDialogueNodes(
        connection,
        dialogueAssetPath,
        items.map((item) => item.dialogueNodeId),
        exportedText,
      );
      for (const [index, item] of items.entries()) {
        const node = nodes[index];
        const contentPropertyIndex = node.commonProperties.findIndex(
          (property) =>
            String(property.Alias).toLowerCase() === "content",
        );
        if (contentPropertyIndex < 0) {
          throw new Error(
            `台词节点 ${item.dialogueNodeId} 缺少 Content 属性`,
          );
        }
        const existingContent = String(
          node.commonProperties[contentPropertyIndex].CurrentString ?? "",
        );
        if (existingContent !== item.previousContent) {
          throw new Error(
            `台词节点 ${item.dialogueNodeId} 的 UE 内容已发生变化，请重新加载后再编辑`,
          );
        }
        const desiredProperties = clonedValue(node.commonProperties);
        desiredProperties[contentPropertyIndex].CurrentString = item.content;
        prepared.push({
          request: item,
          dialogueAssetPath,
          dialogueAsset: String(dialogueAsset),
          nodeDataPath: node.nodeDataPath,
          originalProperties: node.commonProperties,
          desiredProperties,
          changed: existingContent !== item.content,
        });
      }
    }

    const changed = prepared.filter((item) => item.changed);
    const changedAssetPaths = Array.from(
      new Set(changed.map((item) => item.dialogueAssetPath)),
    );
    const dirtyPackages = new Set(
      (await dirtyContentPackages(connection)).map((path) =>
        path.toLowerCase(),
      ),
    );
    const dirtyAsset = changedAssetPaths.find((assetPath) =>
      dirtyPackages.has(assetPath.split(".")[0].toLowerCase()),
    );
    if (dirtyAsset) {
      throw new Error(
        `对话资产 ${dirtyAsset.split(".")[0]} 存在未保存修改，请先在 UE 中保存或撤销`,
      );
    }

    for (const change of changed) {
      written.push(change);
      await connection.invoke("reflect.write_object_property", {
        ThisPtr: change.nodeDataPath,
        PropertyName: "CommonDialogGraphProperties",
        Value: change.desiredProperties,
      });
    }
    for (const change of changed) {
      const writtenProperties = reflectedArray(
        await readProperty(
          connection,
          change.nodeDataPath,
          "CommonDialogGraphProperties",
        ),
        "CommonDialogGraphProperties",
      ) as ReflectedProperty[];
      const writtenContent = String(
        writtenProperties.find(
          (property) =>
            String(property.Alias).toLowerCase() === "content",
        )?.CurrentString ?? "",
      );
      if (writtenContent !== change.request.content) {
        throw new Error(
          `台词节点 ${change.request.dialogueNodeId} 写入后的回读结果不一致`,
        );
      }
    }
    for (const assetPath of changedAssetPaths) {
      const change = changed.find(
        (item) => item.dialogueAssetPath === assetPath,
      )!;
      const saveResult = await connection.invoke("asset.save_asset", {
        Asset: change.dialogueAsset || assetPath,
      });
      if (saveResult === false) {
        throw new Error(`对话资产保存失败：${assetPath}`);
      }
      savedAssets.add(assetPath);
    }

    return {
      updatedCount: changed.length,
      unchangedCount: prepared.length - changed.length,
      savedAssetCount: savedAssets.size,
      items: prepared.map((item) => ({
        status: item.changed ? "updated" : "unchanged",
        dialogueId: item.request.dialogueId,
        startId: item.request.startId,
        dialogueNodeId: item.request.dialogueNodeId,
        dialogueAssetPath: item.dialogueAssetPath,
        content: item.request.content,
        saved: item.changed,
      })),
    };
  } catch (error) {
    let recoveryFailed = false;
    if (written.length > 0) {
      for (const change of written.slice().reverse()) {
        try {
          await connection.invoke("reflect.write_object_property", {
            ThisPtr: change.nodeDataPath,
            PropertyName: "CommonDialogGraphProperties",
            Value: change.originalProperties,
          });
        } catch {
          recoveryFailed = true;
        }
      }
      for (const assetPath of new Set(
        written.map((item) => item.dialogueAssetPath),
      )) {
        const change = written.find(
          (item) => item.dialogueAssetPath === assetPath,
        )!;
        try {
          const saveResult = await connection.invoke("asset.save_asset", {
            Asset: change.dialogueAsset || assetPath,
          });
          if (saveResult === false) {
            recoveryFailed = true;
          }
        } catch {
          recoveryFailed = true;
        }
      }
    }
    throw new Error(
      `${error instanceof Error ? error.message : "批量对白保存失败"}${
        written.length === 0
          ? ""
          : recoveryFailed
            ? "；恢复失败，请立即在 UE 中检查涉及的对话资产"
            : "；已恢复本批次修改"
      }`,
    );
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
  registry: DialogNpcRegistryEntry[];
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
        const registrationMatchesModel =
          existingModelName.toLowerCase() === "player";
        return {
          ...source,
          existingModelName,
          existingModelClassPath: registrationMatchesModel
            ? PLAYER_CLASS
            : null,
          registrationMatchesModel,
          suggestedModelName: "player",
          candidateModelNames: ["player"],
          status:
            registrationMatchesModel
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
      const existingRegistryEntry = registry.find(
        (entry) =>
          entry.name.toLowerCase() === existingModelName.toLowerCase(),
      );
      const registrationMatchesModel =
        existingModelName !== "None" &&
        Boolean(existingRegistryEntry) &&
        normalizeObjectPath(
          existingRegistryEntry?.characterClassPath ?? "",
        ) === normalizedClassPath;
      const suggestedModelName =
        registrationMatchesModel
          ? existingModelName
          : exactName ??
            (candidateModelNames.length === 1
              ? candidateModelNames[0]
              : null);
      return {
        ...source,
        existingModelName,
        existingModelClassPath:
          existingRegistryEntry?.characterClassPath ?? null,
        registrationMatchesModel,
        suggestedModelName,
        candidateModelNames,
        status:
          registrationMatchesModel
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
      formationName === "None" ? null : unrealReferenceText(formationValue),
    existingModels,
    slots: buildDialogueModelRegistrationSlots(
      sourceSlots,
      existingModels,
      registry,
    ),
    registry,
  };
}

interface DialogueSpatialContext {
  commonProperties: ReflectedProperty[];
  specialProperties: ReflectedProperty[];
  previewLevel: string;
  virtualEnabled: boolean;
  specialVirtualEnabled: boolean;
  forwardExplicit: boolean;
  root: MissionTargetBlueprintRoot;
}

function reflectedPropertyIndex(
  properties: ReflectedProperty[],
  alias: string,
): number {
  return properties.findIndex(
    (property) =>
      String(property.Alias ?? "").toLowerCase() === alias.toLowerCase(),
  );
}

function reflectedPropertyValue(
  property: ReflectedProperty | null | undefined,
  name: string,
): unknown {
  if (!property) {
    return undefined;
  }
  const normalizedName = name.replaceAll("_", "").toLowerCase();
  const key = Object.keys(property).find(
    (candidate) =>
      candidate.replaceAll("_", "").toLowerCase() === normalizedName,
  );
  return key === undefined ? undefined : property[key];
}

function setReflectedPropertyValue(
  property: ReflectedProperty,
  name: string,
  value: unknown,
): void {
  const normalizedName = name.replaceAll("_", "").toLowerCase();
  const key = Object.keys(property).find(
    (candidate) =>
      candidate.replaceAll("_", "").toLowerCase() === normalizedName,
  );
  property[key ?? name] = value;
}

async function readDialogueSpatialContext(
  connection: UnrealInvoker,
  startNodeData: string,
): Promise<DialogueSpatialContext> {
  const [commonValue, specialValue, previewValue] = await Promise.all([
    readProperty(connection, startNodeData, "CommonDialogGraphProperties"),
    readProperty(connection, startNodeData, "SpecialDialogGraphProperties"),
    readProperty(connection, startNodeData, "PreviewLevel"),
  ]);
  const commonProperties = reflectedArray(
    commonValue,
    "CommonDialogGraphProperties",
  ) as ReflectedProperty[];
  const specialProperties = Array.isArray(specialValue)
    ? (specialValue as ReflectedProperty[])
    : [];
  const positionIndex = reflectedPropertyIndex(
    commonProperties,
    "PlayerInitPosition",
  );
  const rotationIndex = reflectedPropertyIndex(
    commonProperties,
    "PlayerForward",
  );
  if (positionIndex < 0) {
    throw new Error("对话开始节点缺少 PlayerInitPosition 属性");
  }
  const positionProperty = commonProperties[positionIndex];
  const virtualIndex = reflectedPropertyIndex(commonProperties, "Virtual");
  const specialVirtualIndex = reflectedPropertyIndex(
    specialProperties,
    "Virtual",
  );
  const rotationProperty =
    rotationIndex >= 0 ? commonProperties[rotationIndex] : null;
  return {
    commonProperties,
    specialProperties,
    previewLevel: unrealReferenceText(previewValue),
    virtualEnabled:
      virtualIndex >= 0 &&
      unrealBoolean(
        reflectedPropertyValue(
          commonProperties[virtualIndex],
          "CurrentBool",
        ),
      ),
    specialVirtualEnabled:
      specialVirtualIndex < 0 ||
      unrealBoolean(
        reflectedPropertyValue(
          specialProperties[specialVirtualIndex],
          "CurrentBool",
        ),
      ),
    forwardExplicit:
      rotationProperty !== null &&
      reflectedPropertyValue(rotationProperty, "CurrentRotator") !==
        undefined,
    root: {
      explicit:
        reflectedPropertyValue(positionProperty, "CurrentVector") !==
        undefined,
      transform: {
        location: vector(
          reflectedPropertyValue(positionProperty, "CurrentVector"),
        ),
        rotation:
          rotationIndex >= 0
            ? rotator(
                reflectedPropertyValue(
                  commonProperties[rotationIndex],
                  "CurrentRotator",
                ),
              )
            : { pitch: 0, yaw: 0, roll: 0 },
      },
    },
  };
}

function dialogueSpatialMetadataComplete(
  context: DialogueSpatialContext,
): boolean {
  return (
    context.virtualEnabled &&
    context.specialVirtualEnabled &&
    context.root.explicit &&
    context.forwardExplicit &&
    hasUnrealObjectReference(context.previewLevel)
  );
}

function mapObjectPath(value: string): string {
  const packagePath = value.trim().replaceAll("\\", "/").split(".")[0];
  const assetName = packagePath.split("/").at(-1) ?? "";
  return `${packagePath}.${assetName}`;
}

function desiredDialogueVirtualProperties(
  context: DialogueSpatialContext,
): {
  commonProperties: ReflectedProperty[];
  specialProperties: ReflectedProperty[];
} {
  const commonProperties = clonedValue(context.commonProperties);
  const specialProperties = clonedValue(context.specialProperties);
  const virtualIndex = reflectedPropertyIndex(commonProperties, "Virtual");
  if (virtualIndex < 0) {
    throw new Error("对话开始节点缺少虚拟场景属性");
  }
  setReflectedPropertyValue(
    commonProperties[virtualIndex],
    "CurrentBool",
    true,
  );
  const specialVirtualIndex = reflectedPropertyIndex(
    specialProperties,
    "Virtual",
  );
  if (specialVirtualIndex >= 0) {
    setReflectedPropertyValue(
      specialProperties[specialVirtualIndex],
      "CurrentBool",
      true,
    );
  }
  return { commonProperties, specialProperties };
}

function desiredDialogueSpatialProperties(
  context: DialogueSpatialContext,
  root: MissionTargetBlueprintRoot["transform"],
  fillMissingOnly = false,
): {
  commonProperties: ReflectedProperty[];
  specialProperties: ReflectedProperty[];
} {
  const { commonProperties, specialProperties } =
    desiredDialogueVirtualProperties(context);
  const positionIndex = reflectedPropertyIndex(
    commonProperties,
    "PlayerInitPosition",
  );
  const rotationIndex = reflectedPropertyIndex(
    commonProperties,
    "PlayerForward",
  );
  if (positionIndex < 0 || rotationIndex < 0) {
    throw new Error("对话开始节点缺少虚拟场景或主角初始坐标属性");
  }
  if (!fillMissingOnly || !context.root.explicit) {
    setReflectedPropertyValue(
      commonProperties[positionIndex],
      "CurrentVector",
      {
        X: root.location.x,
        Y: root.location.y,
        Z: root.location.z,
      },
    );
  }
  if (!fillMissingOnly || !context.forwardExplicit) {
    setReflectedPropertyValue(
      commonProperties[rotationIndex],
      "CurrentRotator",
      {
        Pitch: root.rotation.pitch,
        Yaw: root.rotation.yaw,
        Roll: root.rotation.roll,
      },
    );
  }
  return { commonProperties, specialProperties };
}

async function writeDialogueRegistration(
  connection: UnrealInvoker,
  blueprintAssetPathValue: string,
  context: DialogueRegistrationContext,
  selectedModelIndexes: ReadonlySet<number>,
  spatial?: {
    mapAssetPath: string;
    rootTransform: MissionTargetBlueprintRoot["transform"];
    preserveModels?: boolean;
    fillMissingOnly?: boolean;
    source?: "selected_actor" | "level_scan" | "task_targets";
  },
  preserveModels = false,
): Promise<DialogueModelRegistrationResult> {
  const builtModels =
    buildDialogueModelsForRegistration(
      context.slots,
      selectedModelIndexes,
    );
  const currentModels = context.existingModels.map(
    normalizedDialogueModelName,
  );
  const dialogueModels = preserveModels || spatial?.preserveModels
    ? currentModels
    : builtModels.dialogueModels;
  const unresolvedIndexes = preserveModels || spatial?.preserveModels
    ? []
    : builtModels.unresolvedIndexes;
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
  const spatialContext = spatial
    ? await readDialogueSpatialContext(connection, context.startNodeData)
    : null;
  const desiredSpatial = spatialContext && spatial
    ? desiredDialogueSpatialProperties(
        spatialContext,
        spatial.rootTransform,
        spatial.fillMissingOnly,
      )
    : null;
  const desiredPreviewLevel = spatial && spatialContext
    ? spatial.fillMissingOnly &&
      hasUnrealObjectReference(spatialContext.previewLevel)
      ? spatialContext.previewLevel
      : mapObjectPath(spatial.mapAssetPath)
    : "";
  const spatialUnchanged =
    !spatialContext ||
    !desiredSpatial ||
    (sameLevelPath(spatialContext.previewLevel, desiredPreviewLevel) &&
      JSON.stringify(spatialContext.commonProperties) ===
        JSON.stringify(desiredSpatial.commonProperties) &&
      JSON.stringify(spatialContext.specialProperties) ===
        JSON.stringify(desiredSpatial.specialProperties));
  const unchanged =
    modelsUnchanged && formationUnchanged && spatialUnchanged;
  if (!unchanged) {
    if (spatial) {
      const packagePath = context.dialogueAssetPath.split(".")[0];
      const dirtyPackages = new Set(
        (await dirtyContentPackages(connection)).map((path) =>
          path.toLowerCase(),
        ),
      );
      if (dirtyPackages.has(packagePath.toLowerCase())) {
        throw new Error(
          `对话资产 ${packagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
        );
      }
    }
    let writeStarted = false;
    try {
      writeStarted = true;
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
      if (spatialContext && desiredSpatial) {
        const needsVirtualActivation =
          !spatialContext.virtualEnabled ||
          !spatialContext.specialVirtualEnabled;
        if (needsVirtualActivation) {
          const virtualProperties =
            desiredDialogueVirtualProperties(spatialContext);
          if (!spatialContext.virtualEnabled) {
            await connection.invoke("reflect.write_object_property", {
              ThisPtr: context.startNodeData,
              PropertyName: "CommonDialogGraphProperties",
              Value: virtualProperties.commonProperties,
            });
          }
          if (
            !spatialContext.specialVirtualEnabled &&
            virtualProperties.specialProperties.length > 0
          ) {
            await connection.invoke("reflect.write_object_property", {
              ThisPtr: context.startNodeData,
              PropertyName: "SpecialDialogGraphProperties",
              Value: virtualProperties.specialProperties,
            });
          }
          const enabledSpatial = await readDialogueSpatialContext(
            connection,
            context.startNodeData,
          );
          if (
            !enabledSpatial.virtualEnabled ||
            !enabledSpatial.specialVirtualEnabled
          ) {
            throw new Error("虚拟场景启用后的回读结果不一致");
          }
        }
        await connection.invoke("reflect.write_object_property", {
          ThisPtr: context.startNodeData,
          PropertyName: "CommonDialogGraphProperties",
          Value: desiredSpatial.commonProperties,
        });
        if (
          !needsVirtualActivation &&
          desiredSpatial.specialProperties.length > 0
        ) {
          await connection.invoke("reflect.write_object_property", {
            ThisPtr: context.startNodeData,
            PropertyName: "SpecialDialogGraphProperties",
            Value: desiredSpatial.specialProperties,
          });
        }
        await connection.invoke("reflect.write_object_property", {
          ThisPtr: context.startNodeData,
          PropertyName: "PreviewLevel",
          Value: desiredPreviewLevel,
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
      const writtenFormation = unrealReferenceText(
        await readProperty(connection, context.startNodeData, "Formation"),
      );
      if (
        normalizeObjectPath(writtenFormation) !==
        normalizeObjectPath(desiredFormation)
      ) {
        throw new Error("Formation 写入后的回读结果不一致");
      }
      if (spatialContext && spatial) {
        const writtenSpatial = await readDialogueSpatialContext(
          connection,
          context.startNodeData,
        );
        const expectedRootLocation =
          spatial.fillMissingOnly && spatialContext.root.explicit
            ? spatialContext.root.transform.location
            : spatial.rootTransform.location;
        const expectedRootRotation =
          spatial.fillMissingOnly && spatialContext.forwardExplicit
            ? spatialContext.root.transform.rotation
            : spatial.rootTransform.rotation;
        const virtualProperty =
          writtenSpatial.commonProperties[
            reflectedPropertyIndex(
              writtenSpatial.commonProperties,
              "Virtual",
            )
          ];
        const specialVirtualProperty =
          writtenSpatial.specialProperties[
            reflectedPropertyIndex(
              writtenSpatial.specialProperties,
              "Virtual",
            )
          ];
        const mismatches: string[] = [];
        if (
          !unrealBoolean(
            reflectedPropertyValue(virtualProperty, "CurrentBool"),
          )
        ) {
          mismatches.push("Common Virtual 未生效");
        }
        if (
          specialVirtualProperty &&
          !unrealBoolean(
            reflectedPropertyValue(
              specialVirtualProperty,
              "CurrentBool",
            ),
          )
        ) {
          mismatches.push("Special Virtual 未生效");
        }
        if (!writtenSpatial.root.explicit) {
          mismatches.push("PlayerInitPosition 仍为空");
        } else if (
          Math.hypot(
            writtenSpatial.root.transform.location.x -
              expectedRootLocation.x,
            writtenSpatial.root.transform.location.y -
              expectedRootLocation.y,
            writtenSpatial.root.transform.location.z -
              expectedRootLocation.z,
          ) > 0.01
        ) {
          mismatches.push(
            `PlayerInitPosition 期望 ${formatVector(expectedRootLocation)}，实际 ${formatVector(writtenSpatial.root.transform.location)}`,
          );
        }
        if (!writtenSpatial.forwardExplicit) {
          mismatches.push("PlayerForward 仍为空");
        } else if (
          Math.max(
            Math.abs(
              writtenSpatial.root.transform.rotation.pitch -
                expectedRootRotation.pitch,
            ),
            Math.abs(
              writtenSpatial.root.transform.rotation.yaw -
                expectedRootRotation.yaw,
            ),
            Math.abs(
              writtenSpatial.root.transform.rotation.roll -
                expectedRootRotation.roll,
            ),
          ) > 0.001
        ) {
          mismatches.push(
            `PlayerForward 期望 ${formatRotator(expectedRootRotation)}，实际 ${formatRotator(writtenSpatial.root.transform.rotation)}`,
          );
        }
        if (
          !sameLevelPath(
            writtenSpatial.previewLevel,
            desiredPreviewLevel,
          )
        ) {
          mismatches.push(
            `PreviewLevel 期望 ${desiredPreviewLevel}，实际 ${writtenSpatial.previewLevel || "空"}`,
          );
        }
        if (mismatches.length > 0) {
          throw new Error(
            `对话空间配置写入后的回读结果不一致：${mismatches.join("；")}`,
          );
        }
      }
      const saveResult = await connection.invoke("asset.save_asset", {
        Asset: context.dialogueAsset || context.dialogueAssetPath,
      });
      if (saveResult === false) {
        throw new Error(
          `对话资产保存失败：${context.dialogueAssetPath}`,
        );
      }
    } catch (error) {
      if (writeStarted) {
        await Promise.all([
          connection
            .invoke("reflect.write_object_property", {
              ThisPtr: context.startNodeData,
              PropertyName: "DialogModels",
              Value: currentModels,
            })
            .catch(() => undefined),
          connection
            .invoke("reflect.write_object_property", {
              ThisPtr: context.startNodeData,
              PropertyName: "Formation",
              Value: context.formationClassPath ?? "None",
            })
            .catch(() => undefined),
          ...(spatialContext
            ? [
                connection
                  .invoke("reflect.write_object_property", {
                    ThisPtr: context.startNodeData,
                    PropertyName: "CommonDialogGraphProperties",
                    Value: spatialContext.commonProperties,
                  })
                  .catch(() => undefined),
                connection
                  .invoke("reflect.write_object_property", {
                    ThisPtr: context.startNodeData,
                    PropertyName: "SpecialDialogGraphProperties",
                    Value: spatialContext.specialProperties,
                  })
                  .catch(() => undefined),
                connection
                  .invoke("reflect.write_object_property", {
                    ThisPtr: context.startNodeData,
                    PropertyName: "PreviewLevel",
                    Value: spatialContext.previewLevel,
                  })
                  .catch(() => undefined),
              ]
            : []),
        ]);
      }
      throw new Error(
        `${error instanceof Error ? error.message : "对话注册失败"}；已尝试恢复本轮未保存修改`,
      );
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
    characterCount: dialogueModels.filter((name) => name !== "None").length,
    emptyCount: Math.max(0, dialogueModels.length - 1 - registeredCount),
    unresolvedIndexes,
    spatialStatus: spatial
      ? spatialUnchanged
        ? "unchanged"
        : "configured"
      : undefined,
    spatialSource: spatial?.source,
    spatialMapAssetPath: spatial ? desiredPreviewLevel : undefined,
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
    taskId?: string;
    targetOverrides?: Array<{
      targetId: string;
      transform: {
        location: { x: number; y: number; z: number };
        rotation: { pitch: number; yaw: number; roll: number };
      };
    }>;
  };
  const refreshedPlan = request.taskId
    ? withMissionTargetOverrides(
        await readConfiguredMissionTargetPlan(request.taskId),
        request.targetOverrides,
      )
    : request.plan;
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
        : refreshedPlan
          ? [
              {
                modelIndex: 0,
                targetId: null,
                modelClassPath: PLAYER_CLASS,
              },
              ...refreshedPlan.targets.map((target, index) => ({
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
    const registeredCharacterCount = dialogue.slots.filter(
      (slot) => slot.status === "registered",
    ).length;
    const formationMatched =
      dialogue.formationClassPath !== null &&
      normalizeObjectPath(dialogue.formationClassPath) ===
        normalizeObjectPath(blueprint.blueprintClassPath);
    let sync: MissionTargetBlueprintSyncState | undefined;
    let appendSlots: DialogueModelRegistrationSlot[] | undefined;
    if (blueprintState === "populated" && refreshedPlan) {
      const spatial = await readDialogueSpatialContext(
        connection,
        dialogue.startNodeData,
      );
      sync = buildMissionTargetBlueprintSync(
        refreshedPlan.targets,
        numericComponents.map((component) => ({
          modelIndex: Number(component.variableName),
          modelClassPath: component.childActorClass,
          transform: component.transform,
        })),
        spatial.root,
        getConfigCsvDirectory(),
      );
      const registrationByIndex = new Map(
        dialogue.slots.map((slot) => [slot.modelIndex, slot]),
      );
      const invalidRegistrationIndexes = sync.mappings
        .map((mapping) => registrationByIndex.get(mapping.modelIndex))
        .filter(
          (slot) =>
            !slot ||
            slot.existingModelName === "None" ||
            slot.registrationMatchesModel === false,
        )
        .map((slot) => slot?.modelIndex)
        .filter((index): index is number => index !== undefined);
      if (!formationMatched) {
        sync.blockedReasons.push("对话 Formation 未指向当前 BP");
      }
      if (invalidRegistrationIndexes.length > 0) {
        sync.blockedReasons.push(
          `DialogModels 槽位 ${invalidRegistrationIndexes.join("、")} 未正确映射当前 BP 模型`,
        );
      }
      if (!formationMatched || invalidRegistrationIndexes.length > 0) {
        sync.canUpdateBlueprint = false;
        sync.canUpdateTargets = false;
      }
      for (const slot of dialogue.slots) {
        slot.targetId =
          sync.mappings.find(
            (mapping) => mapping.modelIndex === slot.modelIndex,
          )?.targetId ?? null;
      }
      const mappedTargetIds = new Set(
        sync.mappings.map((mapping) => mapping.targetId),
      );
      const nextModelIndex =
        Math.max(
          0,
          ...numericComponents.map((component) =>
            Number(component.variableName),
          ),
        ) + 1;
      appendSlots = buildDialogueModelRegistrationSlots(
        refreshedPlan.targets
          .filter(
            (target) =>
              !mappedTargetIds.has(target.targetId) &&
              target.previewKind === "asset" &&
              Boolean(target.modelClassPath),
          )
          .map((target, index) => ({
            modelIndex: nextModelIndex + index,
            targetId: target.targetId,
            modelClassPath: target.modelClassPath,
          })),
        dialogue.existingModels,
        dialogue.registry,
      );
    }
    return {
      blueprintState,
      blueprintAssetPath: resolved.assetPath,
      blueprintClassPath: blueprint.blueprintClassPath,
      parentClassPath: blueprint.parentClassPath,
      dialogueId: dialogue.dialogueId,
      dialogueAssetPath: dialogue.dialogueAssetPath,
      formationClassPath: dialogue.formationClassPath,
      slots: dialogue.slots,
      appendSlots,
      message: `${
        blueprintState === "empty"
          ? "BP 尚未创建站位组件"
          : `BP 已识别 ${numericComponents.length} 个角色位（含 0 号玩家）`
      }；对话已注册 ${registeredCharacterCount} 个角色${
        formationMatched ? "" : "；Formation 未指向当前 BP"
      }${
        sync
          ? `；匹配 ${sync.mappings.length} 个任务目标物`
          : ""
      }`,
      refreshedPlan,
      sync,
    };
  } finally {
    connection.close();
  }
}

interface PreparedMissionTargetBlueprintSync {
  plan: MissionTargetPreviewPlan;
  resolved: { assetPath: string; blueprint: string };
  blueprint: Awaited<ReturnType<typeof readValidatedBlueprint>>;
  numericComponents: BlueprintComponentInfo[];
  dialogue: DialogueRegistrationContext;
  spatial: DialogueSpatialContext;
  sync: MissionTargetBlueprintSyncState;
}

async function prepareMissionTargetBlueprintSync(
  connection: UnrealInvoker,
  request: {
    blueprintName: string;
    taskId: string;
    targetOverrides?: Array<{
      targetId: string;
      transform: {
        location: { x: number; y: number; z: number };
        rotation: { pitch: number; yaw: number; roll: number };
      };
    }>;
  },
): Promise<PreparedMissionTargetBlueprintSync> {
  const plan = withMissionTargetOverrides(
    await readConfiguredMissionTargetPlan(request.taskId),
    request.targetOverrides,
  );
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
  const dialogue = await readDialogueRegistrationContext(
    connection,
    resolved.assetPath,
    numericComponents.map((component) => ({
      modelIndex: Number(component.variableName),
      targetId: null,
      modelClassPath: component.childActorClass,
    })),
  );
  const spatial = await readDialogueSpatialContext(
    connection,
    dialogue.startNodeData,
  );
  const sync = buildMissionTargetBlueprintSync(
    plan.targets,
    numericComponents.map((component) => ({
      modelIndex: Number(component.variableName),
      modelClassPath: component.childActorClass,
      transform: component.transform,
    })),
    spatial.root,
    getConfigCsvDirectory(),
  );
  const formationMatched =
    dialogue.formationClassPath !== null &&
    normalizeObjectPath(dialogue.formationClassPath) ===
      normalizeObjectPath(blueprint.blueprintClassPath);
  const registrationByIndex = new Map(
    dialogue.slots.map((slot) => [slot.modelIndex, slot]),
  );
  const invalidRegistrationIndexes = sync.mappings
    .filter((mapping) => {
      const slot = registrationByIndex.get(mapping.modelIndex);
      return (
        !slot ||
        slot.existingModelName === "None" ||
        slot.registrationMatchesModel === false
      );
    })
    .map((mapping) => mapping.modelIndex);
  if (!formationMatched) {
    sync.blockedReasons.push("对话 Formation 未指向当前 BP");
  }
  if (invalidRegistrationIndexes.length > 0) {
    sync.blockedReasons.push(
      `DialogModels 槽位 ${invalidRegistrationIndexes.join("、")} 未正确映射当前 BP 模型`,
    );
  }
  if (!formationMatched || invalidRegistrationIndexes.length > 0) {
    sync.canUpdateBlueprint = false;
    sync.canUpdateTargets = false;
  }
  return {
    plan,
    resolved,
    blueprint,
    numericComponents,
    dialogue,
    spatial,
    sync,
  };
}

function blueprintTransformsDiffer(
  left: UnrealTransform,
  right: UnrealTransform,
): boolean {
  return (
    Math.hypot(
      left.location.x - right.location.x,
      left.location.y - right.location.y,
      left.location.z - right.location.z,
    ) > 0.001 ||
    Math.max(
      Math.abs(left.rotation.pitch - right.rotation.pitch),
      Math.abs(left.rotation.yaw - right.rotation.yaw),
      Math.abs(left.rotation.roll - right.rotation.roll),
    ) > 0.001 ||
    Math.max(
      Math.abs(left.scale.x - right.scale.x),
      Math.abs(left.scale.y - right.scale.y),
      Math.abs(left.scale.z - right.scale.z),
    ) > 0.000_001
  );
}

async function setBlueprintComponentTransform(
  connection: UnrealInvoker,
  blueprint: string,
  componentName: string,
  transform: UnrealTransform,
  includeScale = false,
): Promise<void> {
  const properties: Array<readonly [string, string]> = [
    ["RelativeLocation", formatVector(transform.location)],
    ["RelativeRotation", formatRotator(transform.rotation)],
  ];
  if (includeScale) {
    properties.push([
      "RelativeScale3D",
      formatVector(transform.scale),
    ]);
  }
  for (const [propertyName, value] of properties) {
    await connection.invoke("bp.set_component_property", {
      Bp: blueprint,
      ComponentName: componentName,
      PropertyName: propertyName,
      Value: value,
    });
  }
}

async function compileAndSaveBlueprint(
  connection: UnrealInvoker,
  resolved: { assetPath: string; blueprint: string },
): Promise<void> {
  const compileResult = await connection.invoke("bp.compile_blueprint", {
    Bp: resolved.blueprint,
  });
  const compileError = compileFailure(compileResult);
  if (compileError) {
    throw new Error(compileError);
  }
  const saveResult = await connection.invoke(
    "bp.save_asset_and_capture_log",
    { AssetPath: resolved.assetPath },
  );
  const saveError = saveFailure(saveResult);
  if (saveError) {
    throw new Error(saveError);
  }
}

export async function updateMissionTargetBlueprintPositions(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<MissionTargetBlueprintUpdateResult> {
  const request = MissionTargetBlueprintSyncRequestSchema.parse(rawRequest);
  const connection = connectionFactory();
  await connectUnreal(connection);
  let prepared: PreparedMissionTargetBlueprintSync | null = null;
  let blueprintSaved = false;
  const changedComponents: Array<{
    component: BlueprintComponentInfo;
    desired: UnrealTransform;
  }> = [];
  try {
    prepared = await prepareMissionTargetBlueprintSync(
      connection,
      request,
    );
    if (!prepared.sync.canUpdateBlueprint) {
      throw new Error(
        prepared.sync.blockedReasons.join("；") ||
          "当前 BP 不允许自动修改位置",
      );
    }
    const selectedTargetIds = new Set(
      request.selectedTargetIds ??
        prepared.sync.mappings.map((mapping) => mapping.targetId),
    );
    const preparedPlan = prepared.plan;
    const unknownTargetIds = Array.from(selectedTargetIds).filter(
      (targetId) =>
        !preparedPlan.targets.some(
          (target) => target.targetId === targetId,
        ),
    );
    if (unknownTargetIds.length > 0) {
      throw new Error(
        `所选目标物不属于当前任务：${unknownTargetIds.join("、")}`,
      );
    }
    const selectedMappings = prepared.sync.mappings.filter((mapping) =>
      selectedTargetIds.has(mapping.targetId),
    );
    if (selectedMappings.length === 0) {
      throw new Error("当前选择中没有可更新的 BP 模型");
    }
    const dirtyPackages = new Set(
      (await dirtyContentPackages(connection)).map((path) =>
        path.toLowerCase(),
      ),
    );
    const blueprintPackagePath = prepared.resolved.assetPath.split(".")[0];
    const dialoguePackagePath =
      prepared.dialogue.dialogueAssetPath.split(".")[0];
    if (dirtyPackages.has(blueprintPackagePath.toLowerCase())) {
      throw new Error(
        `Formation BP ${blueprintPackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
      );
    }
    if (dirtyPackages.has(dialoguePackagePath.toLowerCase())) {
      throw new Error(
        `对话资产 ${dialoguePackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
      );
    }
    const componentsByIndex = new Map(
      prepared.numericComponents.map((component) => [
        Number(component.variableName),
        component,
      ]),
    );
    for (const mapping of selectedMappings) {
      const component = componentsByIndex.get(mapping.modelIndex);
      if (
        component &&
        blueprintTransformsDiffer(
          component.transform,
          mapping.desiredBlueprintTransform,
        )
      ) {
        changedComponents.push({
          component,
          desired: mapping.desiredBlueprintTransform,
        });
      }
    }
    for (const change of changedComponents) {
      await setBlueprintComponentTransform(
        connection,
        prepared.resolved.blueprint,
        change.component.variableName,
        change.desired,
      );
    }
    if (changedComponents.length > 0) {
      const compileResult = await connection.invoke(
        "bp.compile_blueprint",
        { Bp: prepared.resolved.blueprint },
      );
      const compileError = compileFailure(compileResult);
      if (compileError) {
        throw new Error(compileError);
      }
      const actualComponents = await readBlueprintComponents(
        connection,
        prepared.blueprint.blueprintClassPath,
      );
      for (const change of changedComponents) {
        const actual = actualComponents.find(
          (component) =>
            component.variableName === change.component.variableName,
        );
        if (
          !actual ||
          blueprintTransformsDiffer(actual.transform, change.desired)
        ) {
          throw new Error(
            `BP 组件 ${change.component.variableName} 的位置回读不一致`,
          );
        }
      }
      const saveResult = await connection.invoke(
        "bp.save_asset_and_capture_log",
        { AssetPath: prepared.resolved.assetPath },
      );
      const saveError = saveFailure(saveResult);
      if (saveError) {
        throw new Error(saveError);
      }
      blueprintSaved = true;
    }
    const selectedIndexes = new Set(
      prepared.dialogue.slots
        .filter(
          (slot) =>
            slot.modelIndex > 0 &&
            slot.existingModelName !== "None",
        )
        .map((slot) => slot.modelIndex),
    );
    const dialogueResult = await writeDialogueRegistration(
      connection,
      prepared.resolved.assetPath,
      prepared.dialogue,
      selectedIndexes,
      {
        mapAssetPath: prepared.plan.mapAssetPath,
        rootTransform: prepared.sync.rootTransform,
        preserveModels: true,
      },
    );
    return {
      status:
        changedComponents.length > 0 ||
        dialogueResult.status !== "unchanged"
          ? "updated"
          : "unchanged",
      taskId: prepared.plan.taskId,
      blueprintAssetPath: prepared.resolved.assetPath,
      dialogueAssetPath: prepared.dialogue.dialogueAssetPath,
      updatedModelIndexes: changedComponents.map(({ component }) =>
        Number(component.variableName),
      ),
      blueprintSaved,
      dialogueSaved: dialogueResult.status !== "unchanged",
    };
  } catch (error) {
    if (prepared && changedComponents.length > 0) {
      try {
        for (const change of changedComponents) {
          await setBlueprintComponentTransform(
            connection,
            prepared.resolved.blueprint,
            change.component.variableName,
            change.component.transform,
          );
        }
        if (blueprintSaved) {
          await compileAndSaveBlueprint(connection, prepared.resolved);
        } else {
          await connection.invoke("bp.compile_blueprint", {
            Bp: prepared.resolved.blueprint,
          });
        }
      } catch {
        throw new Error(
          `${error instanceof Error ? error.message : "修改 BP 位置失败"}；BP 恢复失败，请立即在 UE 中检查`,
        );
      }
    }
    throw error;
  } finally {
    connection.close();
  }
}

export async function syncBlueprintPositionsToMissionTargets(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
  targetUpdater: (
    request: unknown,
  ) => Promise<MissionTargetUpdateResult> = updateMissionTargetTransforms,
): Promise<MissionTargetBlueprintToTargetsResult> {
  const request = MissionTargetBlueprintSyncRequestSchema.parse(rawRequest);
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const prepared = await prepareMissionTargetBlueprintSync(
      connection,
      request,
    );
    if (!prepared.sync.canUpdateTargets) {
      throw new Error(
        prepared.sync.hasExplicitRoot
          ? prepared.sync.blockedReasons.join("；") ||
              "当前 BP 无法反推目标物位置"
          : "对话尚未保存主角初始坐标，请先执行“修改 BP 位置”建立 BP 世界坐标",
      );
    }
    const selectedTargetIds = new Set(
      request.selectedTargetIds ??
        prepared.sync.mappings.map((mapping) => mapping.targetId),
    );
    const unknownTargetIds = Array.from(selectedTargetIds).filter(
      (targetId) =>
        !prepared.plan.targets.some(
          (target) => target.targetId === targetId,
        ),
    );
    if (unknownTargetIds.length > 0) {
      throw new Error(
        `所选目标物不属于当前任务：${unknownTargetIds.join("、")}`,
      );
    }
    const selectedMappings = prepared.sync.mappings.filter((mapping) =>
      selectedTargetIds.has(mapping.targetId),
    );
    if (selectedMappings.length === 0) {
      throw new Error("当前选择中没有可反推的目标物");
    }
    const items = selectedMappings
      .filter(
        (mapping) =>
          mapping.positionDelta > 0.001 ||
          mapping.rotationDelta > 0.001,
      )
      .map((mapping) => ({
        targetId: mapping.targetId,
        mapId: prepared.plan.mapId,
        originalTransform: mapping.currentTargetTransform,
        transform: mapping.blueprintWorldTransform,
      }));
    if (items.length === 0) {
      return {
        taskId: prepared.plan.taskId,
        blueprintAssetPath: prepared.resolved.assetPath,
        items,
        updatedTargets: [],
        unchangedTargetIds: selectedMappings.map(
          (mapping) => mapping.targetId,
        ),
        openedWorkbooks: [],
      };
    }
    const result = await targetUpdater({
      items,
      targetPath: getConfigTablePaths().missionTarget,
    });
    return {
      taskId: prepared.plan.taskId,
      blueprintAssetPath: prepared.resolved.assetPath,
      items,
      ...result,
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
      !request.preserveModels &&
      (!playerSlot ||
        normalizeObjectPath(playerSlot.childActorClass) !==
          normalizeObjectPath(PLAYER_CLASS))
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
    const dialogueSpatial = await readDialogueSpatialContext(
      connection,
      context.startNodeData,
    );
    const spatialAlreadyComplete =
      dialogueSpatialMetadataComplete(dialogueSpatial);
    let spatial:
      | {
          mapAssetPath: string;
          rootTransform: MissionTargetBlueprintRoot["transform"];
          fillMissingOnly: boolean;
          source?: "selected_actor" | "level_scan" | "task_targets";
        }
      | undefined;
    if (!spatialAlreadyComplete) {
      const needsActorPlacement =
        !dialogueSpatial.root.explicit ||
        !dialogueSpatial.forwardExplicit;
      const placement = needsActorPlacement
        ? await findBlueprintActorPlacement(
            connection,
            blueprint.blueprintClassPath,
          )
        : null;
      if (placement) {
        if (
          hasUnrealObjectReference(dialogueSpatial.previewLevel) &&
          !sameLevelPath(
            dialogueSpatial.previewLevel,
            placement.mapAssetPath,
          )
        ) {
          throw new Error(
            `对话 Preview Level 为 ${dialogueSpatial.previewLevel}，但 BP Actor 位于 ${placement.mapAssetPath}，已停止写入`,
          );
        }
        spatial = {
          mapAssetPath: placement.mapAssetPath,
          rootTransform: {
            location: placement.actor.transform.location,
            rotation: placement.actor.transform.rotation,
          },
          fillMissingOnly: true,
          source: placement.source,
        };
      } else if (
        dialogueSpatial.root.explicit &&
        dialogueSpatial.forwardExplicit
      ) {
        spatial = {
          mapAssetPath: hasUnrealObjectReference(
            dialogueSpatial.previewLevel,
          )
            ? dialogueSpatial.previewLevel
            : await currentMapName(connection),
          rootTransform: dialogueSpatial.root.transform,
          fillMissingOnly: true,
        };
      } else if (request.taskId) {
        const plan = withMissionTargetOverrides(
          await readConfiguredMissionTargetPlan(request.taskId),
          request.targetOverrides,
        );
        const sync = buildMissionTargetBlueprintSync(
          plan.targets,
          numericComponents.map((component) => ({
            modelIndex: Number(component.variableName),
            modelClassPath: component.childActorClass,
            transform: component.transform,
          })),
          dialogueSpatial.root,
          getConfigCsvDirectory(),
        );
        if (sync.canUpdateBlueprint) {
          spatial = {
            mapAssetPath: plan.mapAssetPath,
            rootTransform: sync.rootTransform,
            fillMissingOnly: true,
            source: "task_targets",
          };
        }
      }
    }
    mutationStarted = true;
    const result = await writeDialogueRegistration(
      connection,
      resolved.assetPath,
      context,
      new Set(request.selectedModelIndexes),
      spatial,
      request.preserveModels === true,
    );
    return spatialAlreadyComplete
      ? {
          ...result,
          spatialStatus: "unchanged",
          spatialMapAssetPath: dialogueSpatial.previewLevel,
        }
      : spatial
        ? result
        : {
            ...result,
            spatialStatus: "not_configured",
          };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : request.preserveModels
          ? "补齐对话空间配置失败"
          : "注册 DialogModels 失败";
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
    const selectedTargetIds = new Set(
      request.selectedTargetIds ??
        request.plan.targets.map((target) => target.targetId),
    );
    const unknownTargetIds = Array.from(selectedTargetIds).filter(
      (targetId) =>
        !request.plan.targets.some((target) => target.targetId === targetId),
    );
    if (unknownTargetIds.length > 0) {
      throw new Error(
        `所选目标物不属于当前任务：${unknownTargetIds.join("、")}`,
      );
    }
    const selectedTargets = request.plan.targets.filter((target) =>
      selectedTargetIds.has(target.targetId),
    );
    if (
      selectedTargets.some(
        (target) =>
          target.previewKind !== "asset" || !target.modelClassPath.trim(),
      )
    ) {
      throw new Error("所选目标物中存在没有模型资源的对象，无法创建 BP 组件");
    }
    const selectedClassPaths = selectedTargets.map(
      (target) => target.modelClassPath,
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
    let dialogueModels: string[] = [];
    try {
      const dialogueAssets = await findDialogueAssetPath(
        connection,
        input.startId,
      );
      if (dialogueAssets.length === 1) {
        const dialogueAssetPath = dialogueAssets[0];
        const dialogueAsset = await connection.invoke(
          "asset.get_asset_by_path",
          { AssetPath: dialogueAssetPath },
        );
        if (hasUnrealObjectReference(dialogueAsset)) {
          const startNodeData = await findDialogueStartNodeData(
            connection,
            dialogueAssetPath,
          );
          const modelsValue = await readProperty(
            connection,
            startNodeData,
            "DialogModels",
          );
          dialogueModels = (
            Array.isArray(modelsValue) ? modelsValue : []
          ).map(normalizedDialogueModelName);
        }
      } else if (dialogueAssets.length > 1) {
        warnings.push(
          `找到多个名为 ${input.startId} 的对话资产，未读取 DialogModels`,
        );
      }
    } catch (error) {
      warnings.push(
        `未能读取对话 DialogModels：${
          error instanceof Error ? error.message : "未知错误"
        }`,
      );
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
        dialogueModels,
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
  const selectedTargets = request.plan.targets.filter((target) =>
    selectedTargetIds.has(target.targetId),
  );
  if (
    selectedTargets.some(
      (target) =>
        target.previewKind !== "asset" || !target.modelClassPath.trim(),
    )
  ) {
    throw new Error("所选目标物中存在没有模型资源的对象，无法创建 BP 组件");
  }
  const selectedEntries = selectedTargets.map((target, index) => ({
    target,
    modelIndex: index + 1,
  }));
  const components = buildMissionTargetBlueprintComponents(selectedTargets);
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
            ...selectedEntries.map(({ target, modelIndex }) => ({
              modelIndex,
              targetId: target.targetId,
              modelClassPath: target.modelClassPath,
            })),
          ],
        )
      : null;
    if (dialogueContext) {
      await readDialogueSpatialContext(
        connection,
        dialogueContext.startNodeData,
      );
      const dirtyPackages = new Set(
        (await dirtyContentPackages(connection)).map((path) =>
          path.toLowerCase(),
        ),
      );
      const blueprintPackagePath = resolved.assetPath.split(".")[0];
      const dialoguePackagePath =
        dialogueContext.dialogueAssetPath.split(".")[0];
      if (dirtyPackages.has(blueprintPackagePath.toLowerCase())) {
        throw new Error(
          `Formation BP ${blueprintPackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
        );
      }
      if (dirtyPackages.has(dialoguePackagePath.toLowerCase())) {
        throw new Error(
          `对话资产 ${dialoguePackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
        );
      }
    }

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
          new Set(selectedEntries.map(({ modelIndex }) => modelIndex)),
          {
            mapAssetPath: request.plan.mapAssetPath,
            rootTransform: missionTargetBlueprintRootForCreation(
              selectedEntries[0].target,
            ),
          },
        )
      : undefined;
    return {
      status: "created",
      taskId: request.plan.taskId,
      blueprintAssetPath: resolved.assetPath,
      targetCount: selectedEntries.length,
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

export async function appendMissionTargetBlueprint(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<MissionTargetBlueprintAppendResult> {
  const request = MissionTargetBlueprintAppendRequestSchema.parse(
    rawRequest,
  ) as {
    blueprintName: string;
    plan: MissionTargetPreviewPlan;
    selectedTargetIds: string[];
  };
  const selectedTargetIds = new Set(request.selectedTargetIds);
  if (selectedTargetIds.size !== request.selectedTargetIds.length) {
    throw new Error("追加目标物中存在重复 ID");
  }
  const unknownTargetIds = Array.from(selectedTargetIds).filter(
    (targetId) =>
      !request.plan.targets.some((target) => target.targetId === targetId),
  );
  if (unknownTargetIds.length > 0) {
    throw new Error(
      `所选目标物不属于当前任务：${unknownTargetIds.join("、")}`,
    );
  }
  const selectedTargets = request.plan.targets.filter((target) =>
    selectedTargetIds.has(target.targetId),
  );
  if (
    selectedTargets.some(
      (target) =>
        target.previewKind !== "asset" || !target.modelClassPath.trim(),
    )
  ) {
    throw new Error("所选目标物中存在没有模型资源的对象，无法追加到 BP");
  }

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
    const existingSourceSlots: DialogueModelSourceSlot[] =
      numericComponents.map((component) => ({
        modelIndex: Number(component.variableName),
        targetId: null,
        modelClassPath: component.childActorClass,
      }));
    const dialogueContext = await readDialogueRegistrationContext(
      connection,
      resolved.assetPath,
      existingSourceSlots,
    );
    const dialogueSpatial = await readDialogueSpatialContext(
      connection,
      dialogueContext.startNodeData,
    );
    if (
      hasUnrealObjectReference(dialogueSpatial.previewLevel) &&
      !sameLevelPath(
        dialogueSpatial.previewLevel,
        request.plan.mapAssetPath,
      )
    ) {
      throw new Error(
        `对话 Preview Level 为 ${dialogueSpatial.previewLevel}，但任务目标地图为 ${request.plan.mapAssetPath}，已停止追加`,
      );
    }

    let rootTransform = dialogueSpatial.root.transform;
    let spatialSource:
      | "selected_actor"
      | "level_scan"
      | "task_targets"
      | undefined;
    if (
      !dialogueSpatial.root.explicit ||
      !dialogueSpatial.forwardExplicit
    ) {
      const placement = await findBlueprintActorPlacement(
        connection,
        blueprint.blueprintClassPath,
      );
      if (placement) {
        if (!sameLevelPath(placement.mapAssetPath, request.plan.mapAssetPath)) {
          throw new Error(
            `BP Actor 位于 ${placement.mapAssetPath}，但任务目标地图为 ${request.plan.mapAssetPath}，已停止追加`,
          );
        }
        rootTransform = {
          location: dialogueSpatial.root.explicit
            ? dialogueSpatial.root.transform.location
            : placement.actor.transform.location,
          rotation: dialogueSpatial.forwardExplicit
            ? dialogueSpatial.root.transform.rotation
            : placement.actor.transform.rotation,
        };
        spatialSource = placement.source;
      } else {
        const inferredSync = buildMissionTargetBlueprintSync(
          request.plan.targets,
          numericComponents.map((component) => ({
            modelIndex: Number(component.variableName),
            modelClassPath: component.childActorClass,
            transform: component.transform,
          })),
          dialogueSpatial.root,
          getConfigCsvDirectory(),
        );
        if (!inferredSync.canUpdateBlueprint) {
          throw new Error(
            "无法确定 BP 世界坐标：请把该 BP 放入任务地图，或确保已有模型可与任务目标物匹配",
          );
        }
        rootTransform = inferredSync.rootTransform;
        spatialSource = "task_targets";
      }
    }
    if (
      Math.abs(rootTransform.rotation.pitch) > 0.000_001 ||
      Math.abs(rootTransform.rotation.roll) > 0.000_001
    ) {
      throw new Error(
        "BP 根旋转包含 Pitch 或 Roll，暂不支持追加目标物坐标换算",
      );
    }

    const existingSync = buildMissionTargetBlueprintSync(
      request.plan.targets,
      numericComponents.map((component) => ({
        modelIndex: Number(component.variableName),
        modelClassPath: component.childActorClass,
        transform: component.transform,
      })),
      { explicit: true, transform: rootTransform },
      getConfigCsvDirectory(),
    );
    const mappedTargetIds = new Set(
      existingSync.mappings.map((mapping) => mapping.targetId),
    );
    const duplicateTargetIds = selectedTargets
      .map((target) => target.targetId)
      .filter((targetId) => mappedTargetIds.has(targetId));
    if (duplicateTargetIds.length > 0) {
      throw new Error(
        `所选目标物已存在于 BP：${duplicateTargetIds.join("、")}`,
      );
    }

    const nextModelIndex =
      Math.max(
        0,
        ...numericComponents.map((component) =>
          Number(component.variableName),
        ),
      ) + 1;
    const selectedEntries = selectedTargets.map((target, index) => ({
      target,
      modelIndex: nextModelIndex + index,
    }));
    const components: MissionTargetBlueprintComponentPlan[] =
      selectedEntries.map(({ target, modelIndex }) => ({
        componentName: String(modelIndex),
        componentClass: CHILD_ACTOR_COMPONENT_CLASS,
        childActorClass: target.modelClassPath,
        targetId: target.targetId,
        transform: blueprintTransformFromWorld(
          target.transform,
          rootTransform,
          target.transform.scale,
        ),
      }));
    const sourceSlots = [
      ...existingSourceSlots,
      ...selectedEntries.map(({ target, modelIndex }) => ({
        modelIndex,
        targetId: target.targetId,
        modelClassPath: target.modelClassPath,
      })),
    ];
    const registrationContext: DialogueRegistrationContext = {
      ...dialogueContext,
      slots: buildDialogueModelRegistrationSlots(
        sourceSlots,
        dialogueContext.existingModels,
        dialogueContext.registry,
      ),
    };

    const dirtyPackages = new Set(
      (await dirtyContentPackages(connection)).map((path) =>
        path.toLowerCase(),
      ),
    );
    const blueprintPackagePath = resolved.assetPath.split(".")[0];
    const dialoguePackagePath =
      dialogueContext.dialogueAssetPath.split(".")[0];
    if (dirtyPackages.has(blueprintPackagePath.toLowerCase())) {
      throw new Error(
        `Formation BP ${blueprintPackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
      );
    }
    if (dirtyPackages.has(dialoguePackagePath.toLowerCase())) {
      throw new Error(
        `对话资产 ${dialoguePackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
      );
    }
    for (const target of selectedTargets) {
      const asset = await connection.invoke("asset.get_asset_by_path", {
        AssetPath: blueprintAssetPath(target.modelClassPath),
      });
      if (!hasUnrealObjectReference(asset)) {
        throw new Error(`模型资产不存在：${target.modelClassPath}`);
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
      if (
        !actual ||
        normalizeObjectPath(actual.componentClass) !==
          normalizeObjectPath(expected.componentClass) ||
        normalizeObjectPath(actual.childActorClass) !==
          normalizeObjectPath(expected.childActorClass) ||
        blueprintTransformsDiffer(actual.transform, expected.transform)
      ) {
        throw new Error(
          `BP 追加组件 ${expected.componentName} 的回读结果不一致`,
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

    const dialogueRegistration = await writeDialogueRegistration(
      connection,
      resolved.assetPath,
      registrationContext,
      new Set(
        sourceSlots
          .map((slot) => slot.modelIndex)
          .filter((modelIndex) => modelIndex > 0),
      ),
      {
        mapAssetPath: request.plan.mapAssetPath,
        rootTransform,
        fillMissingOnly: true,
        source: spatialSource,
      },
    );
    return {
      status: "appended",
      taskId: request.plan.taskId,
      blueprintAssetPath: resolved.assetPath,
      addedTargetIds: selectedTargets.map((target) => target.targetId),
      addedModelIndexes: selectedEntries.map(({ modelIndex }) => modelIndex),
      componentNames: components.map((component) => component.componentName),
      dialogueRegistration,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "追加 BP 目标物失败";
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

function levelAssetToken(value: string): string {
  return (
    normalizeLevelPath(value)
      .split("/")
      .at(-1) ?? ""
  ).replace(/^(?:world_|uedpie_\d+_)+/i, "");
}

function sameLevelPath(left: string, right: string): boolean {
  const normalizedLeft = normalizeLevelPath(left);
  const normalizedRight = normalizeLevelPath(right);
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  if (normalizedLeft.includes("/") && normalizedRight.includes("/")) {
    return false;
  }
  const leftToken = levelAssetToken(normalizedLeft);
  const rightToken = levelAssetToken(normalizedRight);
  return Boolean(leftToken && leftToken === rightToken);
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

function parseLevelActors(
  value: unknown,
  errorMessage: string,
): SelectedLevelActor[] {
  const parsed = parsePythonJson(value, errorMessage);
  if (!Array.isArray(parsed)) {
    throw new Error(errorMessage);
  }
  return parsed.map((item, index) => {
    const actor = item as {
      actor_ref?: unknown;
      label?: unknown;
      class_path?: unknown;
      skeletal_mesh_path?: unknown;
      static_mesh_path?: unknown;
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
      throw new Error(`${errorMessage}：第 ${index + 1} 项无效`);
    }
    const classPath = String(actor.class_path);
    const skeletalMeshPath = String(actor.skeletal_mesh_path ?? "");
    const staticMeshPath = String(actor.static_mesh_path ?? "");
    const blueprintActor =
      classPath.startsWith("/Game/") && classPath.endsWith("_C");
    const assetKind = blueprintActor
      ? "blueprint_actor" as const
      : skeletalMeshPath
        ? "skeletal_mesh" as const
        : staticMeshPath
          ? "static_mesh" as const
          : "unsupported" as const;
    return {
      actorRef: String(actor.actor_ref),
      label: String(actor.label || `Actor ${index + 1}`),
      classPath,
      assetKind,
      assetPath: blueprintActor
        ? blueprintAssetPath(classPath)
        : skeletalMeshPath || staticMeshPath,
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
}

const LEVEL_ACTOR_JSON_FIELDS =
  "{'actor_ref': a.get_path_name(), 'label': a.get_actor_label(), 'class_path': a.get_class().get_path_name(), " +
  "'skeletal_mesh_path': (a.get_component_by_class(unreal.SkeletalMeshComponent).get_editor_property('skeletal_mesh').get_path_name() if a.get_component_by_class(unreal.SkeletalMeshComponent) and a.get_component_by_class(unreal.SkeletalMeshComponent).get_editor_property('skeletal_mesh') else ''), " +
  "'static_mesh_path': (a.get_component_by_class(unreal.StaticMeshComponent).get_editor_property('static_mesh').get_path_name() if a.get_component_by_class(unreal.StaticMeshComponent) and a.get_component_by_class(unreal.StaticMeshComponent).get_editor_property('static_mesh') else ''), " +
  "'location': [a.get_actor_location().x, a.get_actor_location().y, a.get_actor_location().z], " +
  "'rotation': [a.get_actor_rotation().pitch, a.get_actor_rotation().yaw, a.get_actor_rotation().roll], " +
  "'scale': [a.get_actor_scale3d().x, a.get_actor_scale3d().y, a.get_actor_scale3d().z]}";

async function queryLevelActors(
  connection: UnrealInvoker,
  collectionExpression: string,
  errorMessage: string,
): Promise<SelectedLevelActor[]> {
  const value = await connection.invoke("script.eval_python_expression", {
    Expression:
      `__import__('json').dumps([${LEVEL_ACTOR_JSON_FIELDS} ` +
      `for a in ${collectionExpression}])`,
  });
  return parseLevelActors(value, errorMessage);
}

async function findBlueprintActorPlacement(
  connection: UnrealInvoker,
  blueprintClassPathValue: string,
): Promise<{
  actor: SelectedLevelActor;
  mapAssetPath: string;
  source: "selected_actor" | "level_scan";
} | null> {
  const selectedActors = (
    await queryLevelActors(
      connection,
      "unreal.EditorLevelLibrary.get_selected_level_actors()",
      "无法读取 UE 编辑器当前选择",
    )
  ).filter(
    (actor) =>
      normalizeObjectPath(actor.classPath) ===
      normalizeObjectPath(blueprintClassPathValue),
  );
  if (selectedActors.length > 1) {
    throw new Error(
      `当前选择中包含多个 ${assetNameFromPath(blueprintClassPathValue)} 实例，请只保留一个后重试`,
    );
  }
  if (selectedActors.length === 1) {
    return {
      actor: selectedActors[0],
      mapAssetPath: await currentMapName(connection),
      source: "selected_actor",
    };
  }
  const classPathLiteral = JSON.stringify(blueprintClassPathValue);
  const actors = await queryLevelActors(
    connection,
    `unreal.EditorLevelLibrary.get_all_level_actors() if a.get_class().get_path_name() == ${classPathLiteral}`,
    "无法扫描 UE 当前关卡中的 BP Actor",
  );
  if (actors.length > 1) {
    throw new Error(
      `当前关卡中找到 ${actors.length} 个 ${assetNameFromPath(blueprintClassPathValue)} 实例，请在 UE 中选择要注册的一个`,
    );
  }
  return actors.length === 1
    ? {
        actor: actors[0],
        mapAssetPath: await currentMapName(connection),
        source: "level_scan",
      }
    : null;
}

export async function readSelectedLevelActors(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<SelectedLevelActorsResult> {
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const mapAssetPath = await currentMapName(connection);
    const actors = await queryLevelActors(
      connection,
      "unreal.EditorLevelLibrary.get_selected_level_actors()",
      "无法读取 UE 编辑器当前选择",
    );
    return { mapAssetPath, actors };
  } finally {
    connection.close();
  }
}

interface PreparedBackgroundPropItem {
  preview: BackgroundPropPreviewItem;
  actor: SelectedLevelActor;
  assetValue: string;
  existingComponent: BlueprintComponentInfo | null;
}

interface PreparedBackgroundPropImport {
  preview: BackgroundPropImportPreview;
  resolved: { assetPath: string; blueprint: string };
  blueprint: Awaited<ReturnType<typeof readValidatedBlueprint>>;
  items: PreparedBackgroundPropItem[];
}

function backgroundPropAssetName(actor: SelectedLevelActor): string {
  const source =
    actor.assetKind === "blueprint_actor"
      ? actor.classPath
      : actor.assetPath ?? "";
  return assetNameFromPath(source).replace(/_C$/i, "");
}

function backgroundPropComponentSpec(actor: SelectedLevelActor): {
  componentClass: string;
  assetPropertyName: string;
  assetValue: string;
} | null {
  if (actor.assetKind === "blueprint_actor") {
    return {
      componentClass: CHILD_ACTOR_COMPONENT_CLASS,
      assetPropertyName: "ChildActorClass",
      assetValue: actor.classPath,
    };
  }
  if (actor.assetKind === "skeletal_mesh" && actor.assetPath) {
    return {
      componentClass: SKELETAL_MESH_COMPONENT_CLASS,
      assetPropertyName: "SkeletalMesh",
      assetValue: actor.assetPath,
    };
  }
  if (actor.assetKind === "static_mesh" && actor.assetPath) {
    return {
      componentClass: STATIC_MESH_COMPONENT_CLASS,
      assetPropertyName: "StaticMesh",
      assetValue: actor.assetPath,
    };
  }
  return null;
}

function backgroundPropReviewToken(
  preview: Omit<BackgroundPropImportPreview, "reviewToken">,
): string {
  return createHash("sha256")
    .update(JSON.stringify(preview))
    .digest("hex");
}

async function prepareBackgroundPropImport(
  connection: UnrealInvoker,
  blueprintName: string,
  actorRefs?: string[],
): Promise<PreparedBackgroundPropImport> {
  const resolved = await resolveExistingBlueprint(
    connection,
    blueprintName,
  );
  if (!resolved) {
    throw new Error(`BP 文件不存在：${blueprintName}`);
  }
  const blueprint = await readValidatedBlueprint(connection, resolved);
  const dialogueId = dialogueIdFromBlueprintPath(resolved.assetPath);
  if (!dialogueId) {
    throw new Error("BP 文件名中没有可用于查找对话资产的数字 ID");
  }
  const dialogueAssets = await findDialogueAssetPath(
    connection,
    dialogueId,
  );
  if (dialogueAssets.length !== 1) {
    throw new Error(
      dialogueAssets.length === 0
        ? `未找到与 BP 对应的对话资产 ${dialogueId}`
        : `找到多个名为 ${dialogueId} 的对话资产，无法自动确认`,
    );
  }
  const startNodeData = await findDialogueStartNodeData(
    connection,
    dialogueAssets[0],
  );
  const formationValue = String(
    await readProperty(connection, startNodeData, "Formation"),
  );
  const spatial = await readDialogueSpatialContext(
    connection,
    startNodeData,
  );
  const mapAssetPath = await currentMapName(connection);
  const selectedActors = await queryLevelActors(
    connection,
    "unreal.EditorLevelLibrary.get_selected_level_actors()",
    "无法读取 UE 编辑器当前选择",
  );
  let actors = selectedActors;
  if (actorRefs) {
    const requestedActorRefs = new Set(actorRefs);
    if (requestedActorRefs.size !== actorRefs.length) {
      throw new Error("背景资产审核范围中存在重复 Actor");
    }
    const selectedActorsByRef = new Map(
      selectedActors.map((actor) => [actor.actorRef, actor]),
    );
    const missingActorRefs = actorRefs.filter(
      (actorRef) => !selectedActorsByRef.has(actorRef),
    );
    if (missingActorRefs.length > 0) {
      throw new Error("UE 当前选择已变化，请重新读取");
    }
    actors = actorRefs.map(
      (actorRef) => selectedActorsByRef.get(actorRef)!,
    );
  }
  const blockedReasons: string[] = [];
  if (
    normalizeObjectPath(formationValue) !==
    normalizeObjectPath(blueprint.blueprintClassPath)
  ) {
    blockedReasons.push("对话 Formation 尚未指向当前 BP");
  }
  if (!spatial.root.explicit) {
    blockedReasons.push("对话尚未配置主角初始坐标");
  }
  if (!spatial.forwardExplicit) {
    blockedReasons.push("对话尚未配置主角朝向");
  }
  if (!spatial.virtualEnabled || !spatial.specialVirtualEnabled) {
    blockedReasons.push("对话尚未启用虚拟场景");
  }
  if (!hasUnrealObjectReference(spatial.previewLevel)) {
    blockedReasons.push("对话尚未配置 Preview Level");
  } else if (
    !sameLevelPath(spatial.previewLevel, mapAssetPath)
  ) {
    blockedReasons.push(
      `当前地图 ${mapAssetPath} 与 Preview Level ${spatial.previewLevel} 不一致`,
    );
  }
  if (
    Math.abs(spatial.root.transform.rotation.pitch) > 0.000_001 ||
    Math.abs(spatial.root.transform.rotation.roll) > 0.000_001
  ) {
    blockedReasons.push(
      "BP 根旋转包含 Pitch 或 Roll，暂不支持背景资产坐标换算",
    );
  }
  if (actors.length === 0) {
    blockedReasons.push("UE 当前没有选中的 Actor");
  }

  const preparedItems: PreparedBackgroundPropItem[] = actors.map(
    (actor) => {
      const spec = backgroundPropComponentSpec(actor);
      const componentName = backgroundPropAssetName(actor);
      const relativeTransform = blueprintTransformFromWorld(
        actor.transform,
        spatial.root.transform,
        actor.transform.scale,
      );
      const existingComponent =
        blueprint.components.find(
          (component) =>
            component.variableName.toLowerCase() ===
            componentName.toLowerCase(),
        ) ?? null;
      let action: BackgroundPropPreviewItem["action"] = "create";
      let message = "新增背景组件";
      if (
        normalizeObjectPath(actor.classPath) ===
        normalizeObjectPath(blueprint.blueprintClassPath)
      ) {
        action = "blocked";
        message = "目标 BP Actor 本身不会作为背景资产导入";
      } else if (!spec || !componentName) {
        action = "blocked";
        message = "仅支持 Blueprint Actor、Skeletal Mesh 和 Static Mesh";
      } else if (!/^[A-Za-z0-9_]+$/.test(componentName)) {
        action = "blocked";
        message = `资产名 ${componentName} 不能直接作为 BP 组件名`;
      } else if (existingComponent) {
        if (
          normalizeObjectPath(existingComponent.componentClass) !==
            normalizeObjectPath(spec.componentClass) ||
          normalizeObjectPath(existingComponent.sourceAssetPath) !==
            normalizeObjectPath(spec.assetValue)
        ) {
          action = "blocked";
          message = `BP 已有同名但资产不同的组件 ${componentName}`;
        } else if (
          blueprintTransformsDiffer(
            existingComponent.transform,
            relativeTransform,
          )
        ) {
          action = "update";
          message = "更新已有背景组件 Transform";
        } else {
          action = "unchanged";
          message = "BP 中已存在且 Transform 一致";
        }
      }
      return {
        actor,
        assetValue: spec?.assetValue ?? "",
        existingComponent,
        preview: {
          actorRef: actor.actorRef,
          actorLabel: actor.label,
          assetKind: actor.assetKind ?? "unsupported",
          assetPath: actor.assetPath ?? "",
          componentName,
          componentClass: spec?.componentClass ?? "",
          assetPropertyName: spec?.assetPropertyName ?? "",
          worldTransform: actor.transform,
          relativeTransform,
          action,
          message,
        },
      };
    },
  );
  const names = new Map<string, PreparedBackgroundPropItem[]>();
  for (const item of preparedItems) {
    if (!item.preview.componentName) {
      continue;
    }
    const key = item.preview.componentName.toLowerCase();
    names.set(key, [...(names.get(key) ?? []), item]);
  }
  for (const duplicateItems of names.values()) {
    if (duplicateItems.length < 2) {
      continue;
    }
    for (const item of duplicateItems) {
      item.preview.action = "blocked";
      item.preview.message =
        `选择中有多个同名资产 ${item.preview.componentName}，请分批导入`;
    }
  }
  const previewWithoutToken = {
    blueprintAssetPath: resolved.assetPath,
    mapAssetPath,
    rootTransform: spatial.root.transform,
    items: preparedItems.map((item) => item.preview),
    blockedReasons,
  };
  return {
    preview: {
      reviewToken: backgroundPropReviewToken(previewWithoutToken),
      ...previewWithoutToken,
    },
    resolved,
    blueprint,
    items: preparedItems,
  };
}

export async function inspectBackgroundPropImport(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<BackgroundPropImportPreview> {
  const request = BackgroundPropInspectRequestSchema.parse(rawRequest);
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    return (
      await prepareBackgroundPropImport(
        connection,
        request.blueprintName,
        request.actorRefs,
      )
    ).preview;
  } finally {
    connection.close();
  }
}

export async function applyBackgroundPropImport(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<BackgroundPropImportResult> {
  const request = BackgroundPropApplyRequestSchema.parse(rawRequest);
  if (new Set(request.selectedActorRefs).size !== request.selectedActorRefs.length) {
    throw new Error("背景资产选择中存在重复 Actor");
  }
  if (
    request.reviewedActorRefs &&
    new Set(request.reviewedActorRefs).size !== request.reviewedActorRefs.length
  ) {
    throw new Error("背景资产审核范围中存在重复 Actor");
  }
  const connection = connectionFactory();
  await connectUnreal(connection);
  let prepared: PreparedBackgroundPropImport | null = null;
  const changedItems: PreparedBackgroundPropItem[] = [];
  let mutationStarted = false;
  try {
    prepared = await prepareBackgroundPropImport(
      connection,
      request.blueprintName,
      request.reviewedActorRefs,
    );
    if (prepared.preview.reviewToken !== request.reviewToken) {
      throw new Error("UE 选择、Actor Transform 或 BP 内容已变化，请重新检查");
    }
    if (prepared.preview.blockedReasons.length > 0) {
      throw new Error(prepared.preview.blockedReasons.join("；"));
    }
    const selectedActorRefs = new Set(request.selectedActorRefs);
    const selectedItems = prepared.items.filter((item) =>
      selectedActorRefs.has(item.preview.actorRef),
    );
    if (selectedItems.length !== selectedActorRefs.size) {
      throw new Error("所选背景 Actor 已不在 UE 当前选择中");
    }
    const blockedItem = selectedItems.find(
      (item) => item.preview.action === "blocked",
    );
    if (blockedItem) {
      throw new Error(
        `${blockedItem.preview.actorLabel}：${blockedItem.preview.message}`,
      );
    }
    const dirtyPackages = new Set(
      (await dirtyContentPackages(connection)).map((path) =>
        path.toLowerCase(),
      ),
    );
    const blueprintPackagePath =
      prepared.resolved.assetPath.split(".")[0];
    if (dirtyPackages.has(blueprintPackagePath.toLowerCase())) {
      throw new Error(
        `Formation BP ${blueprintPackagePath} 存在未保存修改，请先在 UE 中保存或撤销`,
      );
    }
    changedItems.push(
      ...selectedItems.filter(
        (item) =>
          item.preview.action === "create" ||
          item.preview.action === "update",
      ),
    );
    if (changedItems.length === 0) {
      return {
        status: "unchanged",
        blueprintAssetPath: prepared.resolved.assetPath,
        createdComponentNames: [],
        updatedComponentNames: [],
        saved: false,
      };
    }
    mutationStarted = true;
    for (const item of changedItems) {
      if (item.preview.action === "create") {
        await connection.invoke("bp.add_component", {
          Bp: prepared.resolved.blueprint,
          ComponentClass: item.preview.componentClass,
          ComponentName: item.preview.componentName,
        });
      }
      await connection.invoke("bp.set_component_property", {
        Bp: prepared.resolved.blueprint,
        ComponentName: item.preview.componentName,
        PropertyName: item.preview.assetPropertyName,
        Value: item.assetValue,
      });
      await setBlueprintComponentTransform(
        connection,
        prepared.resolved.blueprint,
        item.preview.componentName,
        item.preview.relativeTransform,
        true,
      );
    }
    const compileResult = await connection.invoke("bp.compile_blueprint", {
      Bp: prepared.resolved.blueprint,
    });
    const compileError = compileFailure(compileResult);
    if (compileError) {
      throw new Error(compileError);
    }
    const actualComponents = await readBlueprintComponents(
      connection,
      prepared.blueprint.blueprintClassPath,
    );
    for (const item of changedItems) {
      const actual = actualComponents.find(
        (component) =>
          component.variableName.toLowerCase() ===
          item.preview.componentName.toLowerCase(),
      );
      if (
        !actual ||
        normalizeObjectPath(actual.componentClass) !==
          normalizeObjectPath(item.preview.componentClass) ||
        normalizeObjectPath(actual.sourceAssetPath) !==
          normalizeObjectPath(item.assetValue) ||
        blueprintTransformsDiffer(
          actual.transform,
          item.preview.relativeTransform,
        )
      ) {
        throw new Error(
          `背景组件 ${item.preview.componentName} 写入后的回读结果不一致`,
        );
      }
    }
    await compileAndSaveBlueprint(connection, prepared.resolved);
    return {
      status: "updated",
      blueprintAssetPath: prepared.resolved.assetPath,
      createdComponentNames: changedItems
        .filter((item) => item.preview.action === "create")
        .map((item) => item.preview.componentName),
      updatedComponentNames: changedItems
        .filter((item) => item.preview.action === "update")
        .map((item) => item.preview.componentName),
      saved: true,
    };
  } catch (error) {
    if (prepared && mutationStarted) {
      for (const item of changedItems.filter(
        (candidate) => candidate.existingComponent,
      )) {
        const original = item.existingComponent!;
        await connection
          .invoke("bp.set_component_property", {
            Bp: prepared.resolved.blueprint,
            ComponentName: original.variableName,
            PropertyName: item.preview.assetPropertyName,
            Value: original.sourceAssetPath,
          })
          .catch(() => undefined);
        await setBlueprintComponentTransform(
          connection,
          prepared.resolved.blueprint,
          original.variableName,
          original.transform,
          true,
        ).catch(() => undefined);
      }
    }
    throw new Error(
      `${error instanceof Error ? error.message : "背景资产写入失败"}${
        mutationStarted
          ? "；新增组件可能留在 UE 的未保存 BP 中，请检查后撤销"
          : ""
      }`,
    );
  } finally {
    connection.close();
  }
}

export async function scanSelectedNpcRegistration(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<NpcRegistrationScanResult> {
  const csvPaths = getConfigCsvPaths();
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
    getConfigCsvDirectory(),
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
    const endpoint = getUnrealMcpEndpoint();
    throw new Error(
      `无法连接 UE 编辑器 OmniMcpCore（${endpoint.host}:${endpoint.port}），请确认 UE 编辑器和插件正在运行`,
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

async function deleteMissionPreviewActorsAndWait(
  connection: UnrealInvoker,
  actors: string[],
): Promise<void> {
  await deletePreviewActors(connection, actors);
  let remaining = actors;
  for (const delayMs of PREVIEW_DELETE_RETRY_DELAYS_MS) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
    remaining = await findMissionPreviewActors(connection);
    if (remaining.length === 0) {
      return;
    }
  }
  throw new Error(
    `仍有 ${remaining.length} 个目标物预览对象未能删除；UE 可能仍在处理销毁，或对象已被关卡锁定`,
  );
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
        sameLevelPath(currentMap, activeMissionPreviewMap)
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
    if (discoveredFromLevel) {
      await deleteMissionPreviewActorsAndWait(connection, actors);
    } else {
      await deletePreviewActors(connection, actors);
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
      matches: sameLevelPath(
        currentMapAssetPath,
        request.mapAssetPath,
      ),
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
    if (!sameLevelPath(currentMap, expectedMap)) {
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
      if (!sameLevelPath(currentMap, expectedMap)) {
        throw new Error(
          `自动打开地图失败：期望 ${plan.mapAssetPath}，当前 ${currentMap}`,
        );
      }
      autoOpenedMap = true;
    }

    const existingPreviewActors = await findMissionPreviewActors(connection);
    if (existingPreviewActors.length > 0) {
      await deleteMissionPreviewActorsAndWait(
        connection,
        existingPreviewActors,
      );
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
