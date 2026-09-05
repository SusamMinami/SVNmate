import { createHash } from "node:crypto";
import Papa from "papaparse";
import { z } from "zod";
import type {
  DialogNpcTableRegistrationDraft,
  DialogNpcTableRegistrationResult,
  DialogNpcTableRegistrationReview,
} from "../src/types";
import {
  UnrealMcpConnection,
  type UnrealInvoker,
} from "./ue/transport";

const DIALOG_NPC_TABLE_OBJECT_PATH =
  "/Game/Seria/Task/Mod/DialogNPCTable.DialogNPCTable";
const DIALOG_NPC_TABLE_PACKAGE_PATH =
  "/Game/Seria/Task/Mod/DialogNPCTable";
const DIALOG_NPC_TABLE_FIELDS = [
  "CharacterBPPath",
  "AnimClassPath",
  "CameraBPPath",
  "MeshPath",
] as const;

const ClassPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^\/Game\/.+\.[^./]+_C$/);
const ObjectPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^\/Game\/.+\.[^./]+$/);
const RowNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_]+$/);

const DialogNpcTableInspectionRequestSchema = z.object({
  slots: z
    .array(
      z.object({
        modelIndex: z.number().int().positive(),
        targetId: z.string().regex(/^\d+$/).nullable(),
        modelClassPath: ClassPathSchema,
      }),
    )
    .min(1)
    .max(200),
});

const DialogNpcTableRegistrationEntrySchema = z.object({
  rowName: RowNameSchema,
  characterClassPath: ClassPathSchema,
  animClassPath: ClassPathSchema,
  cameraClassPath: ClassPathSchema,
  meshPath: ObjectPathSchema,
});

const DialogNpcTableApplyRequestSchema = z.object({
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(DialogNpcTableRegistrationEntrySchema).min(1).max(200),
});

export interface DialogNpcRegistryRow {
  rowName: string;
  characterClassPath: string;
  animClassPath: string;
  cameraClassPath: string;
  meshPath: string;
}

interface DialogNpcCharacterDefaults {
  characterClassPath: string;
  animClassPath: string;
  meshPath: string;
  error: string;
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

function pythonExpression(script: string): string {
  return (
    "(lambda _ns: (" +
    `exec(${JSON.stringify(script)}, _ns), ` +
    "__import__('json').dumps(_ns['_result'], ensure_ascii=False)" +
    ")[1])({'unreal': unreal})"
  );
}

async function invokePythonJson(
  connection: UnrealInvoker,
  script: string,
  errorMessage: string,
): Promise<unknown> {
  const value = await connection.invoke(
    "script.eval_python_expression",
    { Expression: pythonExpression(script) },
    { timeoutMs: 60_000 },
  );
  return parsePythonJson(value, errorMessage);
}

async function connectUnreal(connection: UnrealInvoker): Promise<void> {
  try {
    await connection.connect();
  } catch {
    connection.close();
    throw new Error(
      "无法连接 UE 编辑器 OmniMcpCore，请确认策划 UE 和插件正在运行",
    );
  }
}

function normalizeObjectPath(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/");
  const referencedPath = trimmed.match(/'([^']+)'/)?.[1] ?? trimmed;
  return referencedPath.toLowerCase();
}

function hasPath(value: string): boolean {
  return !["", "none", "null"].includes(value.trim().toLowerCase());
}

function registryRevision(rows: readonly DialogNpcRegistryRow[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function readDialogNpcRegistry(
  connection: UnrealInvoker,
): Promise<DialogNpcRegistryRow[]> {
  const raw = (await invokePythonJson(
    connection,
    `
table = unreal.load_asset(${JSON.stringify(DIALOG_NPC_TABLE_OBJECT_PATH)})
if not table:
    raise RuntimeError('DialogNPCTable asset not found')
_result = {
    'names': [str(value) for value in unreal.DataTableFunctionLibrary.get_data_table_row_names(table)],
    'character_paths': [str(value) for value in unreal.DataTableFunctionLibrary.get_data_table_column_as_string(table, 'CharacterBPPath')],
    'anim_paths': [str(value) for value in unreal.DataTableFunctionLibrary.get_data_table_column_as_string(table, 'AnimClassPath')],
    'camera_paths': [str(value) for value in unreal.DataTableFunctionLibrary.get_data_table_column_as_string(table, 'CameraBPPath')],
    'mesh_paths': [str(value) for value in unreal.DataTableFunctionLibrary.get_data_table_column_as_string(table, 'MeshPath')],
}
`,
    "无法读取 DialogNPCTable 完整数据",
  )) as Record<string, unknown>;
  const names = Array.isArray(raw.names) ? raw.names.map(String) : [];
  const columns = [
    raw.character_paths,
    raw.anim_paths,
    raw.camera_paths,
    raw.mesh_paths,
  ].map((values) => (Array.isArray(values) ? values.map(String) : []));
  if (
    names.length === 0 ||
    columns.some((values) => values.length !== names.length)
  ) {
    throw new Error("DialogNPCTable 行名与字段数量不一致");
  }
  return names.map((rowName, index) => ({
    rowName,
    characterClassPath: columns[0][index] ?? "",
    animClassPath: columns[1][index] ?? "",
    cameraClassPath: columns[2][index] ?? "",
    meshPath: columns[3][index] ?? "",
  }));
}

async function inspectCharacterDefaults(
  connection: UnrealInvoker,
  classPaths: readonly string[],
): Promise<DialogNpcCharacterDefaults[]> {
  const raw = (await invokePythonJson(
    connection,
    `
import json
class_paths = json.loads(${JSON.stringify(JSON.stringify(classPaths))})
items = []
for class_path in class_paths:
    item = {
        'character_class_path': class_path,
        'anim_class_path': '',
        'mesh_path': '',
        'error': '',
    }
    try:
        character_class = unreal.load_class(None, class_path)
        if not character_class:
            raise RuntimeError('无法加载 Generated Class')
        default_object = unreal.get_default_object(character_class)
        try:
            mesh_component = default_object.get_editor_property('mesh')
        except Exception:
            mesh_components = list(default_object.get_components_by_class(unreal.SkeletalMeshComponent))
            if len(mesh_components) != 1:
                raise RuntimeError('无法唯一确定 Skeletal Mesh 组件')
            mesh_component = mesh_components[0]
        mesh = mesh_component.get_editor_property('skeletal_mesh')
        anim_class = mesh_component.get_editor_property('anim_class')
        if not mesh:
            raise RuntimeError('Skeletal Mesh 为空')
        if not anim_class:
            raise RuntimeError('Anim Class 为空')
        item['mesh_path'] = mesh.get_path_name()
        item['anim_class_path'] = anim_class.get_path_name()
    except Exception as error:
        item['error'] = str(error)
    items.append(item)
_result = items
`,
    "无法读取 NPC Blueprint 的 Mesh 与 Anim Class",
  )) as Array<Record<string, unknown>>;
  if (!Array.isArray(raw) || raw.length !== classPaths.length) {
    throw new Error("NPC Blueprint 配置读取数量不一致");
  }
  return raw.map((item) => ({
    characterClassPath: String(item.character_class_path ?? ""),
    animClassPath: String(item.anim_class_path ?? ""),
    meshPath: String(item.mesh_path ?? ""),
    error: String(item.error ?? ""),
  }));
}

function cameraSuggestion(
  registry: readonly DialogNpcRegistryRow[],
  defaults: DialogNpcCharacterDefaults,
): {
  cameraClassPath: string;
  source: DialogNpcTableRegistrationDraft["cameraSuggestionSource"];
} {
  const uniqueCameras = (
    predicate: (row: DialogNpcRegistryRow) => boolean,
  ): string[] =>
    Array.from(
      new Map(
        registry
          .filter(
            (row) => predicate(row) && hasPath(row.cameraClassPath),
          )
          .map((row) => [
            normalizeObjectPath(row.cameraClassPath),
            row.cameraClassPath,
          ]),
      ).values(),
    );
  const sameMeshAndAnim = uniqueCameras(
    (row) =>
      normalizeObjectPath(row.meshPath) ===
        normalizeObjectPath(defaults.meshPath) &&
      normalizeObjectPath(row.animClassPath) ===
        normalizeObjectPath(defaults.animClassPath),
  );
  if (sameMeshAndAnim.length === 1) {
    return {
      cameraClassPath: sameMeshAndAnim[0],
      source: "matching_mesh_and_anim",
    };
  }
  const sameMesh = uniqueCameras(
    (row) =>
      normalizeObjectPath(row.meshPath) ===
      normalizeObjectPath(defaults.meshPath),
  );
  if (sameMesh.length === 1) {
    return {
      cameraClassPath: sameMesh[0],
      source: "matching_mesh",
    };
  }
  const sameAnim = uniqueCameras(
    (row) =>
      normalizeObjectPath(row.animClassPath) ===
      normalizeObjectPath(defaults.animClassPath),
  );
  if (sameAnim.length === 1) {
    return {
      cameraClassPath: sameAnim[0],
      source: "matching_anim",
    };
  }
  return { cameraClassPath: "", source: null };
}

export function dialogNpcRowNameFromClassPath(classPath: string): string {
  const objectName = classPath.split(".").at(-1)?.replace(/_C$/i, "") ?? "";
  return objectName.replace(/^BP_/i, "").replace(/_Npc$/i, "");
}

export function buildDialogNpcRegistrationDrafts(
  registry: readonly DialogNpcRegistryRow[],
  defaults: readonly DialogNpcCharacterDefaults[],
  slots: ReadonlyArray<{
    modelIndex: number;
    targetId: string | null;
    modelClassPath: string;
  }>,
): DialogNpcTableRegistrationDraft[] {
  const existingClassPaths = new Set(
    registry
      .filter((row) => hasPath(row.characterClassPath))
      .map((row) => normalizeObjectPath(row.characterClassPath)),
  );
  const rowNames = new Set(
    registry.map((row) => row.rowName.trim().toLowerCase()),
  );
  const defaultsByClass = new Map(
    defaults.map((item) => [
      normalizeObjectPath(item.characterClassPath),
      item,
    ]),
  );
  const grouped = new Map<
    string,
    {
      modelClassPath: string;
      modelIndexes: number[];
      targetIds: string[];
    }
  >();
  for (const slot of slots) {
    const key = normalizeObjectPath(slot.modelClassPath);
    if (!key || existingClassPaths.has(key)) {
      continue;
    }
    const current = grouped.get(key) ?? {
      modelClassPath: slot.modelClassPath,
      modelIndexes: [],
      targetIds: [],
    };
    current.modelIndexes.push(slot.modelIndex);
    if (slot.targetId) {
      current.targetIds.push(slot.targetId);
    }
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).map((group) => {
    const item = defaultsByClass.get(
      normalizeObjectPath(group.modelClassPath),
    );
    const rowName = dialogNpcRowNameFromClassPath(group.modelClassPath);
    const blockedReasons: string[] = [];
    if (!item) {
      blockedReasons.push("未返回 Blueprint 默认配置");
    } else if (item.error) {
      blockedReasons.push(item.error);
    }
    if (!rowName || !/^[A-Za-z0-9_]+$/.test(rowName)) {
      blockedReasons.push("无法从 BP 名生成有效行名");
    } else if (rowNames.has(rowName.toLowerCase())) {
      blockedReasons.push(`行名 ${rowName} 已被其他模型使用`);
    }
    const suggestion = item
      ? cameraSuggestion(registry, item)
      : { cameraClassPath: "", source: null };
    return {
      modelClassPath: group.modelClassPath,
      modelIndexes: Array.from(new Set(group.modelIndexes)).sort(
        (left, right) => left - right,
      ),
      targetIds: Array.from(new Set(group.targetIds)),
      rowName,
      characterClassPath: group.modelClassPath,
      animClassPath: item?.animClassPath ?? "",
      cameraClassPath: suggestion.cameraClassPath,
      meshPath: item?.meshPath ?? "",
      cameraSuggestionSource: suggestion.source,
      blockedReasons,
    };
  });
}

function buildDialogNpcTableCsv(
  rows: readonly DialogNpcRegistryRow[],
): string {
  return Papa.unparse(
    {
      fields: ["Name", ...DIALOG_NPC_TABLE_FIELDS],
      data: rows.map((row) => [
        row.rowName,
        row.characterClassPath,
        row.animClassPath,
        row.cameraClassPath,
        row.meshPath,
      ]),
    },
    { newline: "\n" },
  );
}

function rowsEqual(
  left: readonly DialogNpcRegistryRow[],
  right: readonly DialogNpcRegistryRow[],
): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        row.rowName === other.rowName &&
        row.characterClassPath === other.characterClassPath &&
        row.animClassPath === other.animClassPath &&
        row.cameraClassPath === other.cameraClassPath &&
        row.meshPath === other.meshPath
      );
    })
  );
}

async function fillDialogNpcTable(
  connection: UnrealInvoker,
  csvText: string,
): Promise<void> {
  const result = (await invokePythonJson(
    connection,
    `
table = unreal.load_asset(${JSON.stringify(DIALOG_NPC_TABLE_OBJECT_PATH)})
if not table:
    raise RuntimeError('DialogNPCTable asset not found')
ok = unreal.DataTableFunctionLibrary.fill_data_table_from_csv_string(
    table,
    ${JSON.stringify(csvText)}
)
_result = {'ok': bool(ok)}
`,
    "DialogNPCTable 整表写入失败",
  )) as { ok?: unknown };
  if (result.ok !== true) {
    throw new Error("DialogNPCTable 整表写入失败");
  }
}

async function reloadDialogNpcTable(connection: UnrealInvoker): Promise<void> {
  const result = (await invokePythonJson(
    connection,
    `
table = unreal.load_asset(${JSON.stringify(DIALOG_NPC_TABLE_OBJECT_PATH)})
reloaded, message = unreal.EditorLoadingAndSavingUtils.reload_packages(
    [table.get_outermost()],
    unreal.ReloadPackagesInteractionMode.ASSUME_POSITIVE
)
_result = {'reloaded': bool(reloaded), 'message': str(message)}
`,
    "DialogNPCTable 恢复失败",
  )) as { reloaded?: unknown; message?: unknown };
  if (result.reloaded !== true) {
    throw new Error(String(result.message || "DialogNPCTable 恢复失败"));
  }
}

async function dialogNpcTableIsDirty(
  connection: UnrealInvoker,
): Promise<boolean> {
  const result = (await invokePythonJson(
    connection,
    `
dirty = [
    str(package.get_path_name()).lower()
    for package in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()
]
_result = {'dirty': ${JSON.stringify(DIALOG_NPC_TABLE_PACKAGE_PATH.toLowerCase())} in dirty}
`,
    "无法检查 DialogNPCTable 保存状态",
  )) as { dirty?: unknown };
  return result.dirty === true;
}

async function invalidCameraPaths(
  connection: UnrealInvoker,
  paths: readonly string[],
): Promise<string[]> {
  const result = (await invokePythonJson(
    connection,
    `
import json
paths = json.loads(${JSON.stringify(JSON.stringify(paths))})
_result = [
    path for path in paths
    if not unreal.load_class(None, path)
]
`,
    "无法校验 Camera BP 路径",
  )) as unknown[];
  return Array.isArray(result) ? result.map(String) : [...paths];
}

export async function inspectDialogNpcTableRegistration(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<DialogNpcTableRegistrationReview> {
  const request = DialogNpcTableInspectionRequestSchema.parse(rawRequest);
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const registry = await readDialogNpcRegistry(connection);
    const classPaths = Array.from(
      new Map(
        request.slots.map((slot) => [
          normalizeObjectPath(slot.modelClassPath),
          slot.modelClassPath,
        ]),
      ).values(),
    );
    const defaults = await inspectCharacterDefaults(connection, classPaths);
    const cameraCounts = new Map<string, { path: string; count: number }>();
    for (const row of registry) {
      if (!hasPath(row.cameraClassPath)) {
        continue;
      }
      const key = normalizeObjectPath(row.cameraClassPath);
      const current = cameraCounts.get(key);
      cameraCounts.set(key, {
        path: current?.path ?? row.cameraClassPath,
        count: (current?.count ?? 0) + 1,
      });
    }
    return {
      reviewToken: registryRevision(registry),
      tableAssetPath: DIALOG_NPC_TABLE_PACKAGE_PATH,
      rows: buildDialogNpcRegistrationDrafts(
        registry,
        defaults,
        request.slots,
      ),
      cameraClassPaths: Array.from(cameraCounts.values())
        .sort(
          (left, right) =>
            right.count - left.count ||
            left.path.localeCompare(right.path),
        )
        .map((item) => item.path),
    };
  } finally {
    connection.close();
  }
}

export async function applyDialogNpcTableRegistration(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<DialogNpcTableRegistrationResult> {
  const request = DialogNpcTableApplyRequestSchema.parse(rawRequest);
  const connection = connectionFactory();
  await connectUnreal(connection);
  let mutationStarted = false;
  try {
    const originalRows = await readDialogNpcRegistry(connection);
    if (registryRevision(originalRows) !== request.reviewToken) {
      throw new Error("DialogNPCTable 已发生变化，请重新检查");
    }
    if (await dialogNpcTableIsDirty(connection)) {
      throw new Error(
        "DialogNPCTable 存在未保存修改，请先在 UE 中保存或撤销",
      );
    }
    const requestedNames = request.rows.map((row) =>
      row.rowName.toLowerCase(),
    );
    if (new Set(requestedNames).size !== requestedNames.length) {
      throw new Error("待登记行中存在重复行名");
    }
    const requestedClasses = request.rows.map((row) =>
      normalizeObjectPath(row.characterClassPath),
    );
    if (new Set(requestedClasses).size !== requestedClasses.length) {
      throw new Error("同一个 Character BP 不能重复登记");
    }
    const existingNames = new Set(
      originalRows.map((row) => row.rowName.toLowerCase()),
    );
    const existingClasses = new Set(
      originalRows
        .filter((row) => hasPath(row.characterClassPath))
        .map((row) => normalizeObjectPath(row.characterClassPath)),
    );
    const conflictingName = request.rows.find((row) =>
      existingNames.has(row.rowName.toLowerCase()),
    );
    if (conflictingName) {
      throw new Error(`DialogNPCTable 行名已存在：${conflictingName.rowName}`);
    }
    const conflictingClass = request.rows.find((row) =>
      existingClasses.has(normalizeObjectPath(row.characterClassPath)),
    );
    if (conflictingClass) {
      throw new Error(
        `Character BP 已在 DialogNPCTable 登记：${conflictingClass.characterClassPath}`,
      );
    }
    const defaults = await inspectCharacterDefaults(
      connection,
      request.rows.map((row) => row.characterClassPath),
    );
    for (const [index, row] of request.rows.entries()) {
      const actual = defaults[index];
      if (!actual || actual.error) {
        throw new Error(
          `${row.rowName}：${actual?.error || "无法读取 Blueprint 默认配置"}`,
        );
      }
      if (
        normalizeObjectPath(actual.animClassPath) !==
          normalizeObjectPath(row.animClassPath) ||
        normalizeObjectPath(actual.meshPath) !==
          normalizeObjectPath(row.meshPath)
      ) {
        throw new Error(`${row.rowName} 的 BP Mesh 或 Anim Class 已发生变化`);
      }
    }
    const invalidCameras = await invalidCameraPaths(
      connection,
      request.rows.map((row) => row.cameraClassPath),
    );
    if (invalidCameras.length > 0) {
      throw new Error(`Camera BP 路径无效：${invalidCameras.join("、")}`);
    }
    const appendedRows: DialogNpcRegistryRow[] = request.rows.map((row) => ({
      rowName: row.rowName,
      characterClassPath: row.characterClassPath,
      animClassPath: row.animClassPath,
      cameraClassPath: row.cameraClassPath,
      meshPath: row.meshPath,
    }));
    const expectedRows = [...originalRows, ...appendedRows];
    mutationStarted = true;
    await fillDialogNpcTable(
      connection,
      buildDialogNpcTableCsv(expectedRows),
    );
    const writtenRows = await readDialogNpcRegistry(connection);
    if (!rowsEqual(writtenRows, expectedRows)) {
      throw new Error("DialogNPCTable 写入后的全表回读不一致");
    }
    const saved = await connection.invoke("asset.save_asset", {
      AssetPath: DIALOG_NPC_TABLE_PACKAGE_PATH,
    });
    if (saved === false) {
      throw new Error("DialogNPCTable 保存失败");
    }
    return {
      status: "registered",
      tableAssetPath: DIALOG_NPC_TABLE_PACKAGE_PATH,
      registeredRowNames: appendedRows.map((row) => row.rowName),
      saved: true,
    };
  } catch (error) {
    if (mutationStarted) {
      try {
        await reloadDialogNpcTable(connection);
      } catch (recoveryError) {
        throw new Error(
          `${
            error instanceof Error
              ? error.message
              : "DialogNPCTable 登记失败"
          }；恢复失败：${
            recoveryError instanceof Error
              ? recoveryError.message
              : "请立即在 UE 中检查 DialogNPCTable"
          }`,
        );
      }
    }
    throw error;
  } finally {
    connection.close();
  }
}
