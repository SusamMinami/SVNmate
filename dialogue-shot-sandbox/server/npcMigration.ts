import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  stat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { z } from "zod";
import { buildNpcMigrationPlan } from "../src/data/npcMigration";
import type {
  NpcMigrationCopyResult,
  NpcMigrationCapsuleEstimate,
  NpcMigrationPlan,
  NpcMigrationPlanRequest,
  NpcMigrationSourceScan,
  NpcMigrationTargetInspection,
  NpcMigrationTargetRequest,
  NpcMigrationTargetResult,
} from "../src/types";
import {
  UnrealMcpConnection,
  type UnrealInvoker,
} from "./ue/transport";

const SOURCE_FILE_EXTENSIONS = new Set([
  ".uasset",
  ".uexp",
  ".ubulk",
  ".uptnl",
  ".umap",
]);
const STANDARD_ABP_TEMPLATES = {
  male: {
    assetName: "ABP_N16_Villager_Male_A",
    npcName: "N16_Villager_Male_A",
  },
  female: {
    assetName: "ABP_N18_Villager_Female_A",
    npcName: "N18_Villager_Female_A",
  },
} as const;

const PlanRequestSchema = z.object({
  source: z.object({
    sourceProjectFile: z.string().min(1),
    sourceContentDirectory: z.string().min(1),
    skeletalMeshName: z.string().min(1),
    skeletalMeshAssetPath: z.string().startsWith("/Game/"),
    skeletalMeshPackageName: z.string().startsWith("/Game/"),
    skeletonAssetPath: z.string().startsWith("/Game/"),
    physicsAssetPath: z.string(),
    materialAssetPaths: z.array(z.string()),
    dependencyPackageNames: z.array(z.string().startsWith("/Game/")).min(1),
    sourceFiles: z.array(
      z.object({
        packageName: z.string().startsWith("/Game/"),
        sourcePath: z.string().min(1),
        relativePath: z.string().min(1),
        size: z.number().nonnegative(),
      }),
    ),
    dirtyPackageNames: z.array(z.string()),
    suggestedNpcName: z.string(),
    suggestedTargetPackagePath: z.string().startsWith("/Game/"),
    warnings: z.array(z.string()),
  }),
  targetContentDirectory: z.string().min(1),
  animationSourceDirectory: z.string().min(1),
  targetPackagePath: z.string().optional(),
  npcName: z.string().optional(),
  configureStandardAbp: z.boolean().optional(),
  standardAbpTemplate: z.enum(["male", "female"]).optional(),
});

const TargetRequestSchema = z.object({
  plan: z.custom<NpcMigrationPlan>(
    (value) => Boolean(value && typeof value === "object"),
  ),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  npcBaseClassPath: z.string().min(1),
  animationBlueprintParentClassPath: z.string().min(1),
  turnCurveAssetPath: z.string().optional(),
  autoFitCapsule: z.boolean().optional().default(true),
  bindTurnCurve: z.boolean().optional().default(true),
  createMontages: z.boolean().optional().default(true),
  createFaceComponent: z.boolean().optional(),
});

function scriptResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const record = value as { Result?: unknown } | null;
  return String(record?.Result ?? "");
}

function parsePythonJson(value: unknown, errorMessage: string): unknown {
  const raw = scriptResult(value).trim();
  const unquoted =
    raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw;
  try {
    return JSON.parse(unquoted.replaceAll("\\'", "'"));
  } catch {
    throw new Error(errorMessage);
  }
}

async function connectUnreal(connection: UnrealInvoker): Promise<void> {
  try {
    await connection.connect();
  } catch {
    connection.close();
    throw new Error(
      "无法连接 UE 编辑器 OmniMcpCore，请确认当前步骤对应的 UE 工程和插件正在运行",
    );
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
  const value = await connection.invoke("script.eval_python_expression", {
    Expression: pythonExpression(script),
  }, { timeoutMs: 180_000 });
  return parsePythonJson(value, errorMessage);
}

function assetPathsFromSearch(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => {
    const text = String(item ?? "");
    const bracketPath = text.match(/\[(\/Game\/[^\]]+)\]/)?.[1];
    const directPath = text.match(/(\/Game\/[^\s'"]+)/)?.[1];
    const path = bracketPath ?? directPath;
    return path ? [path.replace(/_C$/i, "")] : [];
  });
}

async function resolveClassReference(
  connection: UnrealInvoker,
  value: string,
): Promise<string> {
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  const results = assetPathsFromSearch(
    await connection.invoke("asset.asset_search", { Query: trimmed }),
  ).filter((path) => {
    const name = path.split(/[/.]/).at(-1)?.replace(/_C$/i, "");
    return name?.toLowerCase() === trimmed.toLowerCase();
  });
  return results.length === 1 ? `${results[0]}_C` : trimmed;
}

async function resolveAssetReference(
  connection: UnrealInvoker,
  value: string,
  classFilter?: string,
): Promise<string> {
  const trimmed = value.trim().replace(/_C$/i, "");
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  const result = await connection.invoke("asset.asset_search", {
    Query: trimmed,
    ...(classFilter ? { ClassFilter: classFilter } : {}),
    Limit: 100,
  });
  const matches = Array.from(new Set(assetPathsFromSearch(result))).filter(
    (path) => {
      const name = path.split(/[/.]/).at(-1)?.replace(/_C$/i, "");
      return name?.toLowerCase() === trimmed.toLowerCase();
    },
  );
  if (matches.length > 1) {
    throw new Error(
      `找到多个名为 ${trimmed} 的资产，请改用完整 /Game/ 路径`,
    );
  }
  return matches[0] ?? "";
}

function normalizedDiskPath(value: string): string {
  return resolve(value.trim()).replace(/[\\/]+$/, "").toLowerCase();
}

function packageDirectory(packageName: string): string {
  return packageName.slice(0, packageName.lastIndexOf("/"));
}

const TARGET_AUTOMATION_PYTHON_HELPERS = `
def resolve_class(path):
    if not path:
        return None
    native = getattr(unreal, path, None)
    if native:
        return native
    loaded = unreal.load_class(None, path)
    if loaded:
        return loaded
    asset = unreal.load_asset(path)
    return asset.generated_class() if asset and hasattr(asset, 'generated_class') else None

def actor_components(actor):
    components = []
    try:
        components.extend(list(actor.get_components_by_class(unreal.ActorComponent)))
    except Exception:
        try:
            components.extend(list(actor.get_all_components()))
        except Exception:
            pass
    for name in dir(actor):
        if name.startswith('_'):
            continue
        try:
            value = actor.get_editor_property(name)
            if value and isinstance(value, unreal.ActorComponent):
                components.append(value)
        except Exception:
            pass
    unique = []
    seen = set()
    for component in components:
        key = component.get_path_name()
        if key not in seen:
            seen.add(key)
            unique.append(component)
    return unique

def editor_property_candidates(obj, parent_name=''):
    result = []
    for name in dir(obj):
        if name.startswith('_'):
            continue
        lowered = name.lower()
        try:
            value = obj.get_editor_property(name)
        except Exception:
            continue
        class_name = ''
        if value:
            try:
                class_name = value.get_class().get_name().lower()
            except Exception:
                pass
        parent_lowered = parent_name.lower()
        looks_like_curve = 'curve' in lowered or 'curve' in class_name
        looks_like_turn = (
            'turn' in lowered or 'head' in lowered or
            'turn' in parent_lowered or 'head' in parent_lowered
        )
        if looks_like_curve and looks_like_turn:
            path = parent_name + '.' + name if parent_name else name
            score = 100 if lowered in ['turn_curve', 'head_turn_curve', 'rotate_head_curve'] else 50
            if parent_name:
                score += 20
            if 'turn' in lowered:
                score += 10
            result.append((score, path))
        if not parent_name and value and ('turn' in lowered or 'head' in lowered):
            for nested_name in dir(value):
                if nested_name.startswith('_'):
                    continue
                nested_lowered = nested_name.lower()
                if 'curve' not in nested_lowered:
                    continue
                try:
                    value.get_editor_property(nested_name)
                    result.append((80, name + '.' + nested_name))
                except Exception:
                    pass
    return sorted(set(result), key=lambda item: (-item[0], item[1]))

def find_turn_curve_binding(actor):
    behaviour_components = [
        component for component in actor_components(actor)
        if 'npcbehaviour' in component.get_name().lower()
        or 'npcbehaviour' in component.get_class().get_name().lower()
    ]
    if len(behaviour_components) != 1:
        return None, '', []
    component = behaviour_components[0]
    candidates = editor_property_candidates(component)
    paths = [path for score, path in candidates]
    if not candidates:
        return component, '', paths
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        return component, '', paths
    return component, candidates[0][1], paths

def assign_property_path(obj, property_path, value):
    names = property_path.split('.')
    if len(names) == 1:
        obj.set_editor_property(names[0], value)
        return
    container = obj.get_editor_property(names[0])
    container.set_editor_property(names[1], value)
    obj.set_editor_property(names[0], container)

def read_property_path(obj, property_path):
    names = property_path.split('.')
    value = obj.get_editor_property(names[0])
    return value if len(names) == 1 else value.get_editor_property(names[1])

def capsule_estimate(mesh):
    bounds = mesh.get_imported_bounds()
    try:
        origin = bounds.get_editor_property('origin')
        extent = bounds.get_editor_property('box_extent')
    except Exception:
        origin = bounds.origin
        extent = bounds.box_extent
    radius = round(max(abs(origin.x) + extent.x, abs(origin.y) + extent.y) + 2.0, 1)
    half_height = round(max(extent.z + 2.0, radius), 1)
    return {
        'radius': radius,
        'half_height': half_height,
        'mesh_offset_z': round(-origin.z, 1),
        'bounds_origin': [origin.x, origin.y, origin.z],
        'bounds_extent': [extent.x, extent.y, extent.z],
    }
`;

function planPayload(plan: NpcMigrationPlan | Omit<NpcMigrationPlan, "reviewToken">) {
  const { reviewToken: _reviewToken, ...payload } = plan as NpcMigrationPlan;
  return payload;
}

function reviewTokenFor(
  plan: NpcMigrationPlan | Omit<NpcMigrationPlan, "reviewToken">,
): string {
  return createHash("sha256")
    .update(JSON.stringify(planPayload(plan)))
    .digest("hex");
}

function parseCapsuleEstimate(
  value: unknown,
): NpcMigrationCapsuleEstimate | null {
  const raw = value as
    | {
        radius?: unknown;
        half_height?: unknown;
        mesh_offset_z?: unknown;
        bounds_origin?: unknown[];
        bounds_extent?: unknown[];
      }
    | null
    | undefined;
  const boundsOrigin = raw?.bounds_origin ?? [];
  const boundsExtent = raw?.bounds_extent ?? [];
  const numbers = [
    raw?.radius,
    raw?.half_height,
    raw?.mesh_offset_z,
    ...boundsOrigin,
    ...boundsExtent,
  ].map(Number);
  return numbers.length === 9 && numbers.every(Number.isFinite)
    ? {
        radius: numbers[0],
        halfHeight: numbers[1],
        meshOffsetZ: numbers[2],
        boundsOrigin: {
          x: numbers[3],
          y: numbers[4],
          z: numbers[5],
        },
        boundsExtent: {
          x: numbers[6],
          y: numbers[7],
          z: numbers[8],
        },
      }
    : null;
}

function assertReviewToken(plan: NpcMigrationPlan, reviewToken: string): void {
  if (reviewTokenFor(plan) !== reviewToken || plan.reviewToken !== reviewToken) {
    throw new Error("迁移计划已变化，请重新检查后再执行");
  }
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (value) => value.isDirectory(),
    () => false,
  );
}

async function listFbxFiles(directory: string): Promise<string[]> {
  if (!(await isDirectory(directory))) {
    return [];
  }
  const files: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".fbx") {
        files.push(resolve(path));
      }
    }
  };
  await visit(directory);
  return files.sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
}

function assertSourceFilesInsideContent(source: NpcMigrationSourceScan): void {
  const sourceRoot = resolve(source.sourceContentDirectory);
  for (const file of source.sourceFiles) {
    const child = resolve(file.sourcePath);
    const childRelative = relative(sourceRoot, child);
    if (
      childRelative.startsWith(`..${sep}`) ||
      childRelative === ".." ||
      childRelative.startsWith("/") ||
      childRelative.startsWith("\\") ||
      !SOURCE_FILE_EXTENSIONS.has(extname(child).toLowerCase())
    ) {
      throw new Error(`源资产文件超出 Content 或类型不受支持：${file.sourcePath}`);
    }
  }
}

export async function scanNpcMigrationSource(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<NpcMigrationSourceScan> {
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const script = `
import os
import glob
assets = list(unreal.EditorUtilityLibrary.get_selected_assets())
if len(assets) != 1:
    _result = {'error': '请在美术 UE 内容浏览器中只选择一个 Skeletal Mesh'}
else:
    mesh = assets[0]
    class_name = mesh.get_class().get_name()
    if class_name != 'SkeletalMesh':
        _result = {'error': '当前选择不是 Skeletal Mesh'}
    else:
        package_name = mesh.get_outermost().get_path_name()
        registry = unreal.AssetRegistryHelpers.get_asset_registry()
        dependency_options = unreal.AssetRegistryDependencyOptions(
            include_soft_package_references=False,
            include_hard_package_references=True,
            include_searchable_names=False,
            include_soft_management_references=False,
            include_hard_management_references=False
        )
        queue = [package_name]
        packages = []
        while queue:
            current = str(queue.pop(0))
            if current in packages or not current.startswith('/Game/'):
                continue
            packages.append(current)
            for dependency in registry.get_dependencies(current, dependency_options):
                dependency_name = str(dependency)
                if dependency_name not in packages:
                    queue.append(dependency_name)
        content_dir = os.path.abspath(unreal.Paths.project_content_dir())
        files = []
        for dependency in packages:
            stem = os.path.join(content_dir, dependency[len('/Game/'):].replace('/', os.sep))
            for source_path in glob.glob(stem + '.*'):
                extension = os.path.splitext(source_path)[1].lower()
                if extension in ['.uasset', '.uexp', '.ubulk', '.uptnl', '.umap']:
                    files.append({
                        'package_name': dependency,
                        'source_path': os.path.abspath(source_path),
                        'relative_path': os.path.relpath(source_path, content_dir),
                        'size': os.path.getsize(source_path),
                    })
        dirty = [str(package.get_path_name()) for package in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()]
        skeleton = mesh.get_editor_property('skeleton')
        physics_asset = mesh.get_editor_property('physics_asset')
        materials = []
        for material in mesh.get_editor_property('materials'):
            interface = material.get_editor_property('material_interface')
            if interface:
                materials.append(interface.get_path_name())
        _result = {
            'source_project_file': os.path.abspath(unreal.Paths.get_project_file_path()),
            'source_content_directory': content_dir,
            'skeletal_mesh_name': mesh.get_name(),
            'skeletal_mesh_asset_path': mesh.get_path_name(),
            'skeletal_mesh_package_name': package_name,
            'skeleton_asset_path': skeleton.get_path_name() if skeleton else '',
            'physics_asset_path': physics_asset.get_path_name() if physics_asset else '',
            'material_asset_paths': materials,
            'dependency_package_names': packages,
            'source_files': files,
            'dirty_package_names': [name for name in packages if name in dirty],
        }
`;
    const raw = (await invokePythonJson(
      connection,
      script,
      "无法解析美术 UE 的资产扫描结果",
    )) as Record<string, unknown>;
    if (raw.error) {
      throw new Error(String(raw.error));
    }
    const skeletalMeshName = String(raw.skeletal_mesh_name ?? "");
    const skeletalMeshPackageName = String(
      raw.skeletal_mesh_package_name ?? "",
    );
    const skeletonAssetPath = String(raw.skeleton_asset_path ?? "");
    if (!skeletalMeshName.startsWith("SK_")) {
      throw new Error("Skeletal Mesh 名称必须以 SK_ 开头");
    }
    if (!skeletonAssetPath.startsWith("/Game/")) {
      throw new Error("所选 Skeletal Mesh 没有可用的 Skeleton");
    }
    const sourceFiles = (
      Array.isArray(raw.source_files) ? raw.source_files : []
    ).map((file) => {
      const item = file as Record<string, unknown>;
      return {
        packageName: String(item.package_name ?? ""),
        sourcePath: String(item.source_path ?? ""),
        relativePath: String(item.relative_path ?? ""),
        size: Number(item.size ?? 0),
      };
    });
    const scan: NpcMigrationSourceScan = {
      sourceProjectFile: String(raw.source_project_file ?? ""),
      sourceContentDirectory: String(raw.source_content_directory ?? ""),
      skeletalMeshName,
      skeletalMeshAssetPath: String(raw.skeletal_mesh_asset_path ?? ""),
      skeletalMeshPackageName,
      skeletonAssetPath,
      physicsAssetPath: String(raw.physics_asset_path ?? ""),
      materialAssetPaths: (
        Array.isArray(raw.material_asset_paths)
          ? raw.material_asset_paths
          : []
      ).map(String),
      dependencyPackageNames: (
        Array.isArray(raw.dependency_package_names)
          ? raw.dependency_package_names
          : []
      ).map(String),
      sourceFiles,
      dirtyPackageNames: (
        Array.isArray(raw.dirty_package_names)
          ? raw.dirty_package_names
          : []
      ).map(String),
      suggestedNpcName: skeletalMeshName.replace(/^SK_/i, ""),
      suggestedTargetPackagePath: packageDirectory(
        skeletalMeshPackageName,
      ),
      warnings: [],
    };
    assertSourceFilesInsideContent(scan);
    if (!scan.physicsAssetPath) {
      scan.warnings.push("所选 Skeletal Mesh 没有关联 Physics Asset");
    }
    return scan;
  } finally {
    connection.close();
  }
}

export async function inspectNpcMigrationPlan(
  rawRequest: unknown,
): Promise<NpcMigrationPlan> {
  const request = PlanRequestSchema.parse(rawRequest) as NpcMigrationPlanRequest;
  assertSourceFilesInsideContent(request.source);
  const targetContentDirectory = resolve(request.targetContentDirectory);
  const animationSourceDirectory = resolve(request.animationSourceDirectory);
  const targetDirectoryReady =
    basename(targetContentDirectory).toLowerCase() === "content" &&
    (await isDirectory(targetContentDirectory));
  const animationDirectoryReady = await isDirectory(
    animationSourceDirectory,
  );
  const animationFiles = animationDirectoryReady
    ? await listFbxFiles(animationSourceDirectory)
    : [];
  const fileOperations = await Promise.all(
    request.source.sourceFiles.map(async (file) => {
      const destinationPath = resolve(
        targetContentDirectory,
        file.relativePath,
      );
      const targetRelative = relative(targetContentDirectory, destinationPath);
      if (
        targetRelative.startsWith(`..${sep}`) ||
        targetRelative === ".."
      ) {
        throw new Error(`迁移目标超出 Content：${file.relativePath}`);
      }
      return {
        packageName: file.packageName,
        sourcePath: resolve(file.sourcePath),
        destinationPath,
        relativePath: file.relativePath,
        size: file.size,
        state: (await pathExists(destinationPath))
          ? "conflict" as const
          : "ready" as const,
      };
    }),
  );
  const planWithoutToken = buildNpcMigrationPlan(request, {
    animationFiles,
    fileOperations,
    targetDirectoryReady,
    animationDirectoryReady,
  });
  if (
    planWithoutToken.targetPackagePath.toLowerCase() !==
    request.source.suggestedTargetPackagePath.toLowerCase()
  ) {
    planWithoutToken.blockedReasons.push(
      "跨工程迁移必须保留原始 /Game 包路径，不能在复制阶段改目录",
    );
    planWithoutToken.canMigrate = false;
    planWithoutToken.canConfigure = false;
    const migrationStep = planWithoutToken.steps.find(
      (step) => step.id === "migration",
    );
    if (migrationStep) {
      migrationStep.state = "blocked";
    }
  }
  const plan = {
    ...planWithoutToken,
    reviewToken: "",
  };
  plan.reviewToken = reviewTokenFor(plan);
  return plan;
}

export async function applyNpcAssetMigration(
  rawRequest: unknown,
): Promise<NpcMigrationCopyResult> {
  const request = z.object({
    plan: z.custom<NpcMigrationPlan>(
      (value) => Boolean(value && typeof value === "object"),
    ),
    reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  }).parse(rawRequest);
  const { plan, reviewToken } = request;
  assertReviewToken(plan, reviewToken);
  if (!plan.canMigrate) {
    throw new Error("迁移计划存在阻断项，不能执行");
  }
  assertSourceFilesInsideContent(plan.source);
  for (const operation of plan.fileOperations) {
    if (!(await pathExists(operation.sourcePath))) {
      throw new Error(`源资产文件已不存在：${operation.sourcePath}`);
    }
    if (await pathExists(operation.destinationPath)) {
      throw new Error(`目标文件已存在，已停止迁移：${operation.destinationPath}`);
    }
  }
  const copiedFiles: string[] = [];
  let copiedBytes = 0;
  for (const operation of plan.fileOperations) {
    await mkdir(dirname(operation.destinationPath), { recursive: true });
    await copyFile(
      operation.sourcePath,
      operation.destinationPath,
      fsConstants.COPYFILE_EXCL,
    );
    copiedFiles.push(operation.destinationPath);
    copiedBytes += operation.size;
  }
  return {
    copiedFiles,
    copiedBytes,
    targetContentDirectory: plan.targetContentDirectory,
  };
}

async function inspectTargetWithConnection(
  request: NpcMigrationTargetRequest,
  connection: UnrealInvoker,
): Promise<NpcMigrationTargetInspection> {
  const npcBaseClassPath = await resolveClassReference(
    connection,
    request.npcBaseClassPath,
  );
  const animationBlueprintParentClassPath = await resolveClassReference(
    connection,
    request.animationBlueprintParentClassPath,
  );
  const template = STANDARD_ABP_TEMPLATES[
    request.plan.standardAbpTemplate
  ];
  const templateAnimationBlueprintAssetPath =
    request.plan.configureStandardAbp
      ? await resolveAssetReference(
          connection,
          template.assetName,
          "AnimBlueprint",
        )
      : "";
  const bodyAnimationAssetPaths = request.plan.bodyAnimationFiles.map(
    (file) =>
      `${request.plan.animationPackagePath}/${basename(file, extname(file))}`,
  );
  const faceAnimationAssetPaths = request.plan.faceAnimationFiles.map(
    (file) =>
      `${request.plan.animationPackagePath}/Face/${basename(file, extname(file))}`,
  );
  const montageAssetPaths = request.plan.montages.map(
    (montage) =>
      `${request.plan.animationPackagePath}/${montage.montageName}`,
  );
  const expectedAssetPaths = [
    `${request.plan.targetPackagePath}/${request.plan.blueprintName}`,
    `${request.plan.animationPackagePath}/${request.plan.animationBlueprintName}`,
    ...bodyAnimationAssetPaths,
    ...faceAnimationAssetPaths,
    ...(request.createMontages === false ? [] : montageAssetPaths),
    ...(request.plan.configureStandardAbp
      ? [
          `${request.plan.animationPackagePath}/${request.plan.lookBlendSpaceName}`,
        ]
      : []),
  ];
  const script = `
import os
${TARGET_AUTOMATION_PYTHON_HELPERS}
mesh = unreal.load_asset(${JSON.stringify(request.plan.source.skeletalMeshAssetPath)})
skeleton = unreal.load_asset(${JSON.stringify(request.plan.source.skeletonAssetPath)})
npc_parent = resolve_class(${JSON.stringify(npcBaseClassPath)})
anim_parent = resolve_class(${JSON.stringify(animationBlueprintParentClassPath)})
template_abp = unreal.load_asset(${JSON.stringify(templateAnimationBlueprintAssetPath)}) if ${request.plan.configureStandardAbp ? "True" : "False"} else None
template_assets = {
    'look_blend_space': '',
    'idle_stand': '',
    'impact': '',
    'interact': '',
}
if template_abp:
    template_directory = ${JSON.stringify(templateAnimationBlueprintAssetPath)}.rsplit('/', 1)[0]
    template_paths = unreal.EditorAssetLibrary.list_assets(template_directory, recursive=True, include_folder=False)
    expected_template_names = {
        'look_blend_space': ${JSON.stringify(`BS_${template.npcName}_Look`)},
        'idle_stand': ${JSON.stringify(`A_${template.npcName}_Idlestand`)},
        'impact': ${JSON.stringify(`A_${template.npcName}_Impact`)},
        'interact': ${JSON.stringify(`A_${template.npcName}_Interact`)},
    }
    for role, expected_name in expected_template_names.items():
        matches = [
            path for path in template_paths
            if path.rsplit('/', 1)[-1].split('.', 1)[0].lower() == expected_name.lower()
        ]
        if len(matches) == 1:
            template_assets[role] = matches[0]
npc_cdo = unreal.get_default_object(npc_parent) if npc_parent else None
turn_component, turn_property, turn_candidates = find_turn_curve_binding(npc_cdo) if npc_cdo else (None, '', [])
turn_curve = unreal.load_asset(${JSON.stringify(request.turnCurveAssetPath ?? "")}) if ${request.bindTurnCurve === false ? "False" : "True"} else None
estimate = capsule_estimate(mesh) if mesh else None
montage_automation_available = False
try:
    factory_supported = False
    if hasattr(unreal, 'AnimMontageFactory'):
        test_factory = unreal.AnimMontageFactory()
        try:
            test_factory.set_editor_property('target_skeleton', skeleton)
            test_factory.set_editor_property('source_animation', None)
            factory_supported = True
        except Exception:
            pass
    struct_supported = all([
        hasattr(unreal, 'AnimSegment'),
        hasattr(unreal, 'AnimTrack'),
        hasattr(unreal, 'SlotAnimationTrack'),
    ])
    if struct_supported:
        test_segment = unreal.AnimSegment()
        test_track = unreal.AnimTrack()
        test_track.set_editor_property('anim_segments', [test_segment])
        test_slot = unreal.SlotAnimationTrack()
        test_slot.set_editor_property('slot_name', unreal.Name('TurnSlot'))
        test_slot.set_editor_property('anim_track', test_track)
    montage_automation_available = (
        hasattr(unreal, 'AnimMontageFactory')
        and (factory_supported or struct_supported)
    )
except Exception:
    montage_automation_available = False
look_blend_space_automation_available = False
standard_abp_automation_available = False
if ${request.plan.configureStandardAbp ? "True" : "False"}:
    try:
        blend_factory = unreal.BlendSpaceFactory1D()
        blend_factory.set_editor_property('target_skeleton', skeleton)
        look_blend_space_automation_available = all([
            hasattr(unreal, 'BlendSpace1D'),
            hasattr(unreal, 'BlendParameter'),
            hasattr(unreal, 'BlendSample'),
        ])
    except Exception:
        look_blend_space_automation_available = False
    standard_abp_automation_available = bool(
        template_abp
        and hasattr(unreal, 'ObjectIterator')
        and hasattr(unreal, 'AnimGraphNode_SequencePlayer')
        and (
            hasattr(unreal, 'AnimGraphNode_BlendSpacePlayer')
            or hasattr(unreal, 'AnimGraphNode_RotationOffsetBlendSpace')
        )
    )
existing = [path for path in ${JSON.stringify(expectedAssetPaths)} if unreal.EditorAssetLibrary.does_asset_exist(path)]
_result = {
    'target_project_file': os.path.abspath(unreal.Paths.get_project_file_path()),
    'target_content_directory': os.path.abspath(unreal.Paths.project_content_dir()),
    'skeletal_mesh_found': bool(mesh),
    'skeleton_found': bool(skeleton),
    'npc_base_class_found': bool(npc_parent),
    'animation_blueprint_parent_class_found': bool(anim_parent),
    'capsule_estimate': estimate,
    'turn_curve_found': bool(turn_curve),
    'turn_curve_property_path': turn_property,
    'turn_curve_property_candidates': turn_candidates,
    'montage_automation_available': montage_automation_available,
    'template_animation_blueprint_asset_path': template_abp.get_path_name() if template_abp else '',
    'template_animation_assets': template_assets,
    'standard_abp_automation_available': standard_abp_automation_available,
    'look_blend_space_automation_available': look_blend_space_automation_available,
    'existing_asset_paths': existing,
}
`;
  const raw = (await invokePythonJson(
    connection,
    script,
    "无法解析策划 UE 的迁移校验结果",
  )) as Record<string, unknown>;
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  const targetContentDirectory = String(raw.target_content_directory ?? "");
  if (
    normalizedDiskPath(targetContentDirectory) !==
    normalizedDiskPath(request.plan.targetContentDirectory)
  ) {
    blockedReasons.push("当前连接的 UE 不是迁移计划中的目标工程");
  }
  if (!raw.skeletal_mesh_found) {
    blockedReasons.push("目标 UE 中未找到迁移后的 Skeletal Mesh");
  }
  if (!raw.skeleton_found) {
    blockedReasons.push("目标 UE 中未找到对应 Skeleton");
  }
  if (!raw.npc_base_class_found) {
    blockedReasons.push("NPCBase 父类路径无效");
  }
  if (
    !request.plan.configureStandardAbp &&
    !raw.animation_blueprint_parent_class_found
  ) {
    blockedReasons.push("SeriaNPCAnimInstance 父类路径无效");
  }
  const capsuleEstimate = parseCapsuleEstimate(raw.capsule_estimate);
  if (request.autoFitCapsule !== false && !capsuleEstimate) {
    blockedReasons.push("无法从 Skeletal Mesh 包围盒计算胶囊体");
  }
  const turnCurveFound = Boolean(raw.turn_curve_found);
  const turnCurvePropertyPath = String(
    raw.turn_curve_property_path ?? "",
  );
  const turnCurvePropertyCandidates = (
    Array.isArray(raw.turn_curve_property_candidates)
      ? raw.turn_curve_property_candidates
      : []
  ).map(String);
  if (request.bindTurnCurve !== false) {
    if (!request.turnCurveAssetPath || !turnCurveFound) {
      blockedReasons.push("转头曲线资产不存在");
    }
    if (!turnCurvePropertyPath) {
      blockedReasons.push(
        turnCurvePropertyCandidates.length > 1
          ? `NpcBehaviourComponent 中存在多个可能的转头曲线属性：${turnCurvePropertyCandidates.join("、")}`
          : "未在 NpcBehaviourComponent 中找到可写的转头曲线属性",
      );
    }
  }
  const montageAutomationAvailable = Boolean(
    raw.montage_automation_available,
  );
  if (
    request.createMontages !== false &&
    request.plan.montages.length > 0 &&
    !montageAutomationAvailable
  ) {
    blockedReasons.push("当前 UE Python 环境不支持自动创建 Montage");
  }
  const templateAnimationAssetsRaw =
    (raw.template_animation_assets as Record<string, unknown> | undefined) ??
    {};
  const templateAnimationAssets = {
    lookBlendSpace: String(
      templateAnimationAssetsRaw.look_blend_space ?? "",
    ),
    idleStand: String(templateAnimationAssetsRaw.idle_stand ?? ""),
    impact: String(templateAnimationAssetsRaw.impact ?? ""),
    interact: String(templateAnimationAssetsRaw.interact ?? ""),
  };
  const standardAbpAutomationAvailable = Boolean(
    raw.standard_abp_automation_available,
  );
  const lookBlendSpaceAutomationAvailable = Boolean(
    raw.look_blend_space_automation_available,
  );
  if (request.plan.configureStandardAbp) {
    if (!templateAnimationBlueprintAssetPath) {
      blockedReasons.push(
        `未找到标准模板 ${template.assetName}`,
      );
    }
    const missingTemplateAssets = Object.entries(
      templateAnimationAssets,
    )
      .filter(([, path]) => !path)
      .map(([role]) => role);
    if (missingTemplateAssets.length > 0) {
      blockedReasons.push(
        `标准模板缺少引用资产：${missingTemplateAssets.join("、")}`,
      );
    }
    if (!standardAbpAutomationAvailable) {
      blockedReasons.push("当前 UE Python 环境不支持 ABP 资产覆盖");
    }
    if (!lookBlendSpaceAutomationAvailable) {
      blockedReasons.push("当前 UE Python 环境不支持自动创建 Look 混合空间");
    }
  }
  const existingAssetPaths = (
    Array.isArray(raw.existing_asset_paths) ? raw.existing_asset_paths : []
  ).map(String);
  if (existingAssetPaths.length > 0) {
    blockedReasons.push(
      `目标 BP/ABP 已存在，当前版本不会覆盖：${existingAssetPaths.join("、")}`,
    );
  }
  if (request.plan.faceAnimationFiles.length > 0) {
    warnings.push(
      "Face 动作导入后会锁定根骨骼；表情曲线与通知由 BP_FaceConfigHelper 完成",
    );
  }
  if (request.autoFitCapsule !== false && capsuleEstimate) {
    warnings.push(
      `胶囊体估算为半径 ${capsuleEstimate.radius}、半高 ${capsuleEstimate.halfHeight}，Mesh Z 偏移 ${capsuleEstimate.meshOffsetZ}`,
    );
  }
  if (request.bindTurnCurve !== false && turnCurvePropertyPath) {
    warnings.push(`转头曲线将写入 ${turnCurvePropertyPath}`);
  }
  if (request.createMontages !== false && request.plan.montages.length > 0) {
    warnings.push(
      `将创建 ${request.plan.montages.length} 个 Montage，并写入 IdleSlot / TurnSlot`,
    );
  }
  if (request.plan.configureStandardAbp) {
    warnings.push(
      `将继承模板 ${template.assetName}，替换 Look、IdleStand、Impact、Interact`,
    );
  }
  if (request.createFaceComponent) {
    warnings.push(
      "Face 组件需要确认 Face Skeletal Mesh 与父骨骼插槽，当前不自动创建",
    );
  }
  return {
    targetProjectFile: String(raw.target_project_file ?? ""),
    targetContentDirectory,
    skeletalMeshFound: Boolean(raw.skeletal_mesh_found),
    skeletonFound: Boolean(raw.skeleton_found),
    npcBaseClassFound: Boolean(raw.npc_base_class_found),
    animationBlueprintParentClassFound: Boolean(
      raw.animation_blueprint_parent_class_found,
    ),
    capsuleEstimate,
    turnCurveFound,
    turnCurvePropertyPath,
    turnCurvePropertyCandidates,
    montageAutomationAvailable,
    templateAnimationBlueprintAssetPath: String(
      raw.template_animation_blueprint_asset_path ?? "",
    ),
    templateAnimationAssets,
    standardAbpAutomationAvailable,
    lookBlendSpaceAutomationAvailable,
    existingAssetPaths,
    blockedReasons,
    warnings,
  };
}

export async function inspectNpcMigrationTarget(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<NpcMigrationTargetInspection> {
  const request = TargetRequestSchema.parse(rawRequest) as NpcMigrationTargetRequest;
  assertReviewToken(request.plan, request.reviewToken);
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    return await inspectTargetWithConnection(request, connection);
  } finally {
    connection.close();
  }
}

export async function configureNpcMigrationTarget(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<NpcMigrationTargetResult> {
  const request = TargetRequestSchema.parse(rawRequest) as NpcMigrationTargetRequest;
  assertReviewToken(request.plan, request.reviewToken);
  if (!request.plan.canConfigure) {
    throw new Error("目标配置计划存在阻断项，不能执行");
  }
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const inspection = await inspectTargetWithConnection(request, connection);
    if (inspection.blockedReasons.length > 0) {
      throw new Error(inspection.blockedReasons.join("；"));
    }
    const npcBaseClassPath = await resolveClassReference(
      connection,
      request.npcBaseClassPath,
    );
    const animationBlueprintParentClassPath = await resolveClassReference(
      connection,
      request.animationBlueprintParentClassPath,
    );
    const script = `
${TARGET_AUTOMATION_PYTHON_HELPERS}
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
asset_library = unreal.EditorAssetLibrary
skeleton = unreal.load_asset(${JSON.stringify(request.plan.source.skeletonAssetPath)})
mesh = unreal.load_asset(${JSON.stringify(request.plan.source.skeletalMeshAssetPath)})
animation_root = ${JSON.stringify(request.plan.animationPackagePath)}
face_root = animation_root + '/Face'
template_abp = unreal.load_asset(${JSON.stringify(inspection.templateAnimationBlueprintAssetPath)}) if ${request.plan.configureStandardAbp ? "True" : "False"} else None
target_role_names = ${JSON.stringify({
      look_down: request.plan.animationRoleAssets.lookDown,
      look_forward: request.plan.animationRoleAssets.lookForward,
      look_up: request.plan.animationRoleAssets.lookUp,
      idle_stand: request.plan.animationRoleAssets.idleStand,
      impact: request.plan.animationRoleAssets.impact,
      interact: request.plan.animationRoleAssets.interact,
    })}
asset_library.make_directory(animation_root)
if ${request.plan.faceAnimationFiles.length > 0 ? "True" : "False"}:
    asset_library.make_directory(face_root)
imported = []
def import_animations(files, destination, lock_root):
    tasks = []
    for filename in files:
        task = unreal.AssetImportTask()
        task.set_editor_property('filename', filename)
        task.set_editor_property('destination_path', destination)
        task.set_editor_property('automated', True)
        task.set_editor_property('replace_existing', False)
        task.set_editor_property('save', True)
        options = unreal.FbxImportUI()
        options.set_editor_property('automated_import_should_detect_type', False)
        options.set_editor_property('mesh_type_to_import', unreal.FBXImportType.FBXIT_ANIMATION)
        options.set_editor_property('original_import_type', unreal.FBXImportType.FBXIT_ANIMATION)
        options.set_editor_property('import_mesh', False)
        options.set_editor_property('import_animations', True)
        options.set_editor_property('skeleton', skeleton)
        task.set_editor_property('options', options)
        tasks.append(task)
    if tasks:
        asset_tools.import_asset_tasks(tasks)
    for task in tasks:
        for path in task.get_editor_property('imported_object_paths'):
            imported.append(str(path))
            asset = unreal.load_asset(str(path))
            if lock_root and asset and hasattr(asset, 'set_editor_property'):
                try:
                    asset.set_editor_property('force_root_lock', True)
                    asset_library.save_loaded_asset(asset)
                except Exception:
                    pass
import_animations(${JSON.stringify(request.plan.bodyAnimationFiles)}, animation_root, False)
import_animations(${JSON.stringify(request.plan.faceAnimationFiles)}, face_root, True)
target_role_assets = {
    role: unreal.load_asset(animation_root + '/' + asset_name)
    for role, asset_name in target_role_names.items()
    if asset_name
}
look_blend_space = None
applied_override_paths = []
if ${request.plan.configureStandardAbp ? "True" : "False"}:
    missing_target_roles = [
        role for role in ['look_down', 'look_forward', 'look_up', 'idle_stand', 'impact', 'interact']
        if not target_role_assets.get(role)
    ]
    if missing_target_roles:
        raise RuntimeError('标准 ABP 目标动作导入失败：' + '、'.join(missing_target_roles))
    for look_role in ['look_down', 'look_forward', 'look_up']:
        look_sequence = target_role_assets[look_role]
        look_sequence.set_editor_property(
            'additive_anim_type',
            unreal.AdditiveAnimationType.AAT_ROTATION_OFFSET_MESH_SPACE
        )
        look_sequence.set_editor_property(
            'ref_pose_type',
            unreal.AdditiveBasePoseType.ABPT_ANIM_FRAME
        )
        look_sequence.set_editor_property('ref_pose_seq', target_role_assets['look_forward'])
        look_sequence.set_editor_property('ref_frame_index', 15)
        asset_library.save_loaded_asset(look_sequence)
    template_look = unreal.load_asset(${JSON.stringify(inspection.templateAnimationAssets.lookBlendSpace)})
    if not template_look:
        raise RuntimeError('标准模板 Look 混合空间不存在')
    blend_factory = unreal.BlendSpaceFactory1D()
    blend_factory.set_editor_property('target_skeleton', skeleton)
    look_blend_space = asset_tools.create_asset(
        ${JSON.stringify(request.plan.lookBlendSpaceName)},
        animation_root,
        unreal.BlendSpace1D,
        blend_factory
    )
    if not look_blend_space:
        raise RuntimeError('创建 Look 混合空间失败')
    template_parameters = template_look.get_editor_property('blend_parameters')
    copied_parameters = []
    for template_parameter in template_parameters:
        parameter = unreal.BlendParameter()
        for property_name in ['display_name', 'min', 'max', 'grid_num']:
            parameter.set_editor_property(
                property_name,
                template_parameter.get_editor_property(property_name)
            )
        copied_parameters.append(parameter)
    look_blend_space.set_editor_property('blend_parameters', copied_parameters)
    template_samples = template_look.get_editor_property('sample_data')
    target_samples = []
    for template_sample in template_samples:
        template_animation = template_sample.get_editor_property('animation')
        template_name = template_animation.get_name().lower() if template_animation else ''
        target_animation = (
            target_role_assets['look_down'] if template_name.endswith('lookd')
            else target_role_assets['look_forward'] if template_name.endswith('lookf')
            else target_role_assets['look_up'] if template_name.endswith('looku')
            else None
        )
        if not target_animation:
            continue
        sample = unreal.BlendSample()
        sample.set_editor_property('animation', target_animation)
        sample.set_editor_property(
            'sample_value',
            template_sample.get_editor_property('sample_value')
        )
        sample.set_editor_property(
            'rate_scale',
            template_sample.get_editor_property('rate_scale')
        )
        try:
            sample.set_editor_property(
                'snap_to_grid',
                template_sample.get_editor_property('snap_to_grid')
            )
        except Exception:
            pass
        target_samples.append(sample)
    if len(target_samples) != 3:
        raise RuntimeError('标准模板 Look 混合空间未唯一包含 LookD、LookF、LookU')
    look_blend_space.set_editor_property('sample_data', target_samples)
    look_blend_space.set_editor_property('preview_base_pose', target_role_assets['idle_stand'])
    asset_library.save_loaded_asset(look_blend_space)
    actual_samples = look_blend_space.get_editor_property('sample_data')
    if len(actual_samples) != 3:
        raise RuntimeError('Look 混合空间样本回读不一致')
npc_parent = resolve_class(${JSON.stringify(npcBaseClassPath)})
bp_factory = unreal.BlueprintFactory()
bp_factory.set_editor_property('parent_class', npc_parent)
bp = asset_tools.create_asset(
    ${JSON.stringify(request.plan.blueprintName)},
    ${JSON.stringify(request.plan.targetPackagePath)},
    unreal.Blueprint,
    bp_factory
)
if not bp:
    raise RuntimeError('创建 NPC BP 失败')
if template_abp:
    abp = asset_library.duplicate_asset(
        ${JSON.stringify(inspection.templateAnimationBlueprintAssetPath)},
        animation_root + '/' + ${JSON.stringify(request.plan.animationBlueprintName)}
    )
else:
    anim_factory = unreal.AnimBlueprintFactory()
    anim_factory.set_editor_property('target_skeleton', skeleton)
    anim_factory.set_editor_property(
        'parent_class',
        resolve_class(${JSON.stringify(animationBlueprintParentClassPath)})
    )
    abp = asset_tools.create_asset(
        ${JSON.stringify(request.plan.animationBlueprintName)},
        animation_root,
        unreal.AnimBlueprint,
        anim_factory
    )
if not abp:
    raise RuntimeError('创建动画蓝图失败')
if ${request.plan.configureStandardAbp ? "True" : "False"}:
    template_override_assets = {
        'look_blend_space': unreal.load_asset(${JSON.stringify(inspection.templateAnimationAssets.lookBlendSpace)}),
        'idle_stand': unreal.load_asset(${JSON.stringify(inspection.templateAnimationAssets.idleStand)}),
        'impact': unreal.load_asset(${JSON.stringify(inspection.templateAnimationAssets.impact)}),
        'interact': unreal.load_asset(${JSON.stringify(inspection.templateAnimationAssets.interact)}),
    }
    target_override_assets = {
        'look_blend_space': look_blend_space,
        'idle_stand': target_role_assets['idle_stand'],
        'impact': target_role_assets['impact'],
        'interact': target_role_assets['interact'],
    }
    abp.set_editor_property('target_skeleton', skeleton)
    duplicate_package = abp.get_outermost().get_path_name()
    replaced_roles = set()
    node_specs = [
        ('AnimGraphNode_SequencePlayer', 'sequence'),
        ('AnimGraphNode_BlendSpacePlayer', 'blend_space'),
        ('AnimGraphNode_RotationOffsetBlendSpace', 'blend_space'),
    ]
    for class_name, property_name in node_specs:
        node_class = getattr(unreal, class_name, None)
        if not node_class:
            continue
        for graph_node in unreal.ObjectIterator(node_class):
            if not graph_node.get_path_name().startswith(duplicate_package + '.'):
                continue
            node_data = graph_node.get_editor_property('node')
            try:
                current_asset = node_data.get_editor_property(property_name)
            except Exception:
                continue
            if not current_asset:
                continue
            current_path = current_asset.get_path_name()
            for role, source_asset in template_override_assets.items():
                if current_path != source_asset.get_path_name():
                    continue
                node_data.set_editor_property(property_name, target_override_assets[role])
                graph_node.set_editor_property('node', node_data)
                replaced_roles.add(role)
    missing_override_roles = [
        role for role in ['look_blend_space', 'idle_stand', 'impact', 'interact']
        if role not in replaced_roles
    ]
    if missing_override_roles:
        raise RuntimeError(
            '标准 ABP 未找到待替换节点：' + '、'.join(missing_override_roles)
        )
    applied_override_paths = [
        target_override_assets[role].get_path_name()
        for role in ['look_blend_space', 'idle_stand', 'impact', 'interact']
    ]
    actual_skeleton = abp.get_editor_property('target_skeleton')
    if not actual_skeleton or actual_skeleton.get_path_name() != skeleton.get_path_name():
        raise RuntimeError('ABP 目标 Skeleton 回读不一致')
cdo = unreal.get_default_object(bp.generated_class())
mesh_component = cdo.get_editor_property('mesh')
mesh_component.set_editor_property('skeletal_mesh', mesh)
mesh_component.set_editor_property('anim_class', abp.generated_class())
written_capsule = None
if ${request.autoFitCapsule === false ? "False" : "True"}:
    estimate = capsule_estimate(mesh)
    capsules = [
        component for component in actor_components(cdo)
        if isinstance(component, unreal.CapsuleComponent)
    ]
    if len(capsules) != 1:
        raise RuntimeError('无法唯一确定 NPC BP 的胶囊体组件')
    capsule = capsules[0]
    capsule.set_editor_property('capsule_radius', estimate['radius'])
    capsule.set_editor_property('capsule_half_height', estimate['half_height'])
    current_location = mesh_component.get_editor_property('relative_location')
    mesh_component.set_editor_property(
        'relative_location',
        unreal.Vector(current_location.x, current_location.y, estimate['mesh_offset_z'])
    )
    written_capsule = {
        'radius': float(capsule.get_editor_property('capsule_radius')),
        'half_height': float(capsule.get_editor_property('capsule_half_height')),
        'mesh_offset_z': float(mesh_component.get_editor_property('relative_location').z),
        'bounds_origin': estimate['bounds_origin'],
        'bounds_extent': estimate['bounds_extent'],
    }
written_turn_curve_property = ''
if ${request.bindTurnCurve === false ? "False" : "True"}:
    turn_curve = unreal.load_asset(${JSON.stringify(request.turnCurveAssetPath ?? "")})
    behaviour_component, turn_property, turn_candidates = find_turn_curve_binding(cdo)
    if not turn_curve:
        raise RuntimeError('转头曲线资产不存在')
    if not behaviour_component or not turn_property:
        raise RuntimeError('无法唯一确定 NpcBehaviourComponent 的转头曲线属性')
    assign_property_path(behaviour_component, turn_property, turn_curve)
    actual_turn_curve = read_property_path(behaviour_component, turn_property)
    if not actual_turn_curve or actual_turn_curve.get_path_name() != turn_curve.get_path_name():
        raise RuntimeError('转头曲线写入后的回读结果不一致')
    written_turn_curve_property = turn_property
created_montages = []
def create_montage(spec):
    sequence = unreal.load_asset(animation_root + '/' + spec['source_asset_name'])
    if not sequence or not isinstance(sequence, unreal.AnimSequence):
        raise RuntimeError('Montage 源动作不存在：' + spec['source_asset_name'])
    factory = unreal.AnimMontageFactory()
    factory_configured = False
    try:
        factory.set_editor_property('target_skeleton', skeleton)
        factory.set_editor_property('source_animation', sequence)
        factory_configured = True
    except Exception:
        pass
    montage = asset_tools.create_asset(
        spec['montage_name'],
        animation_root,
        unreal.AnimMontage,
        factory
    )
    if not montage:
        raise RuntimeError('创建 Montage 失败：' + spec['montage_name'])
    actual_tracks = []
    try:
        actual_tracks = list(montage.get_editor_property('slot_anim_tracks'))
    except Exception:
        pass
    if not actual_tracks:
        if not all([
            hasattr(unreal, 'AnimSegment'),
            hasattr(unreal, 'AnimTrack'),
            hasattr(unreal, 'SlotAnimationTrack'),
        ]):
            raise RuntimeError('当前 UE 无法构造 Montage 动作轨道')
        segment = unreal.AnimSegment()
        segment.set_editor_property('anim_reference', sequence)
        segment.set_editor_property('anim_start_time', 0.0)
        segment.set_editor_property('anim_end_time', sequence.get_play_length())
        segment.set_editor_property('anim_play_rate', 1.0)
        segment.set_editor_property('looping_count', 1)
        anim_track = unreal.AnimTrack()
        anim_track.set_editor_property('anim_segments', [segment])
        slot_track = unreal.SlotAnimationTrack()
        slot_track.set_editor_property('slot_name', unreal.Name(spec['slot_name']))
        slot_track.set_editor_property('anim_track', anim_track)
        montage.set_editor_property('slot_anim_tracks', [slot_track])
    else:
        actual_tracks[0].set_editor_property('slot_name', unreal.Name(spec['slot_name']))
        montage.set_editor_property('slot_anim_tracks', actual_tracks)
    try:
        montage.set_editor_property('skeleton', skeleton)
    except Exception:
        pass
    asset_library.save_loaded_asset(montage)
    actual_tracks = list(montage.get_editor_property('slot_anim_tracks'))
    if len(actual_tracks) != 1 or str(actual_tracks[0].get_editor_property('slot_name')) != spec['slot_name']:
        raise RuntimeError('Montage 插槽回读不一致：' + spec['montage_name'])
    actual_segments = actual_tracks[0].get_editor_property('anim_track').get_editor_property('anim_segments')
    if len(actual_segments) != 1:
        raise RuntimeError('Montage 动作轨道回读不一致：' + spec['montage_name'])
    actual_sequence = actual_segments[0].get_editor_property('anim_reference')
    if not actual_sequence or actual_sequence.get_path_name() != sequence.get_path_name():
        raise RuntimeError('Montage 源动作回读不一致：' + spec['montage_name'])
    created_montages.append({
        'asset_path': montage.get_path_name(),
        'slot_name': spec['slot_name'],
        'source_asset_name': spec['source_asset_name'],
    })
if ${request.createMontages === false ? "False" : "True"}:
    for montage_spec in ${JSON.stringify(
      request.plan.montages.map((montage) => ({
        montage_name: montage.montageName,
        source_asset_name: montage.sourceAssetName,
        slot_name: montage.slotName,
      })),
    )}:
        create_montage(montage_spec)
asset_library.save_loaded_asset(bp)
asset_library.save_loaded_asset(abp)
_result = {
    'imported': imported,
    'blueprint_asset_path': bp.get_path_name(),
    'animation_blueprint_asset_path': abp.get_path_name(),
    'capsule_estimate': written_capsule,
    'turn_curve_property_path': written_turn_curve_property,
    'created_montages': created_montages,
    'template_animation_blueprint_asset_path': template_abp.get_path_name() if template_abp else '',
    'look_blend_space_asset_path': look_blend_space.get_path_name() if look_blend_space else '',
    'animation_blueprint_override_asset_paths': applied_override_paths,
}
`;
    const raw = (await invokePythonJson(
      connection,
      script,
      "无法解析策划 UE 的配置结果",
    )) as Record<string, unknown>;
    const importedAnimationAssetPaths = (
      Array.isArray(raw.imported) ? raw.imported : []
    ).map(String);
    const expectedImportedAnimationCount =
      request.plan.bodyAnimationFiles.length +
      request.plan.faceAnimationFiles.length;
    if (
      importedAnimationAssetPaths.length !==
      expectedImportedAnimationCount
    ) {
      throw new Error(
        `动作导入数量不一致：计划 ${expectedImportedAnimationCount}，实际 ${importedAnimationAssetPaths.length}`,
      );
    }
    const blueprintAssetPath = String(raw.blueprint_asset_path ?? "");
    const animationBlueprintAssetPath = String(
      raw.animation_blueprint_asset_path ?? "",
    );
    for (const assetPath of [blueprintAssetPath, animationBlueprintAssetPath]) {
      const blueprint = await connection.invoke(
        "bp.get_blueprint_by_path",
        { AssetPath: assetPath },
      );
      if (!blueprint) {
        throw new Error(`无法回读已创建的蓝图：${assetPath}`);
      }
      const compileResult = await connection.invoke("bp.compile_blueprint", {
        Bp: blueprint,
      });
      if (compileResult === false) {
        throw new Error(`蓝图编译失败：${assetPath}`);
      }
      const saveResult = await connection.invoke("asset.save_asset", {
        AssetPath: assetPath,
      });
      if (saveResult === false) {
        throw new Error(`蓝图保存失败：${assetPath}`);
      }
    }
    const createdMontageAssetPaths = (
      Array.isArray(raw.created_montages) ? raw.created_montages : []
    ).map((item) =>
      String((item as Record<string, unknown>).asset_path ?? ""),
    );
    if (
      request.createMontages !== false &&
      createdMontageAssetPaths.length !== request.plan.montages.length
    ) {
      throw new Error("Montage 创建数量与审核计划不一致");
    }
    const writtenCapsuleEstimate = parseCapsuleEstimate(
      raw.capsule_estimate,
    );
    if (request.autoFitCapsule !== false) {
      if (!writtenCapsuleEstimate || !inspection.capsuleEstimate) {
        throw new Error("胶囊体写入后无法回读");
      }
      if (
        Math.abs(
          writtenCapsuleEstimate.radius -
            inspection.capsuleEstimate.radius,
        ) > 0.01 ||
        Math.abs(
          writtenCapsuleEstimate.halfHeight -
            inspection.capsuleEstimate.halfHeight,
        ) > 0.01 ||
        Math.abs(
          writtenCapsuleEstimate.meshOffsetZ -
            inspection.capsuleEstimate.meshOffsetZ,
        ) > 0.01
      ) {
        throw new Error("胶囊体写入后的回读结果与预检不一致");
      }
    }
    const writtenTurnCurvePropertyPath = String(
      raw.turn_curve_property_path ?? "",
    );
    if (
      request.bindTurnCurve !== false &&
      writtenTurnCurvePropertyPath !==
        inspection.turnCurvePropertyPath
    ) {
      throw new Error("转头曲线写入后的属性路径与预检不一致");
    }
    const templateAnimationBlueprintAssetPath = String(
      raw.template_animation_blueprint_asset_path ?? "",
    );
    const lookBlendSpaceAssetPath = String(
      raw.look_blend_space_asset_path ?? "",
    );
    const animationBlueprintOverrideAssetPaths = (
      Array.isArray(raw.animation_blueprint_override_asset_paths)
        ? raw.animation_blueprint_override_asset_paths
        : []
    ).map(String);
    if (request.plan.configureStandardAbp) {
      if (
        templateAnimationBlueprintAssetPath !==
          inspection.templateAnimationBlueprintAssetPath ||
        !lookBlendSpaceAssetPath ||
        animationBlueprintOverrideAssetPaths.length !== 4
      ) {
        throw new Error("标准 ABP 模板配置回读不完整");
      }
    }
    const manualChecks = [
      "打开 NPC BP，确认胶囊体与 Mesh 贴合，并检查角色正面方向",
      "抽查转头曲线引用与转头表现",
      "抽查 Idle/Turn Montage 的源动作、名称和 IdleSlot/TurnSlot",
      request.plan.configureStandardAbp
        ? "检查 Look 混合空间三个采样点，并运行 ABP 状态机预览"
        : "配置 Look 混合空间与 ABP 状态机图表",
      "打开 Skeletal Mesh，确认后期处理动画蓝图",
      "最终重新编译 NPC BP，并检查蒙太奇列表",
    ];
    if (request.plan.faceAnimationFiles.length > 0) {
      manualChecks.splice(
        2,
        0,
        "使用 BP_FaceConfigHelper 执行 MakeTable / Out，复核 Face 曲线、通知和蒙太奇插槽",
      );
    }
    return {
      status: "configured",
      skeletalMeshAssetPath: request.plan.source.skeletalMeshAssetPath,
      importedAnimationAssetPaths,
      blueprintAssetPath,
      animationBlueprintAssetPath,
      faceAnimationCount: request.plan.faceAnimationFiles.length,
      capsuleEstimate: writtenCapsuleEstimate,
      turnCurvePropertyPath:
        request.bindTurnCurve === false
          ? ""
          : writtenTurnCurvePropertyPath,
      createdMontageAssetPaths,
      templateAnimationBlueprintAssetPath,
      lookBlendSpaceAssetPath,
      animationBlueprintOverrideAssetPaths,
      savedAssetPaths: [
        blueprintAssetPath,
        animationBlueprintAssetPath,
        ...(lookBlendSpaceAssetPath ? [lookBlendSpaceAssetPath] : []),
        ...createdMontageAssetPaths,
      ],
      manualChecks,
    };
  } finally {
    connection.close();
  }
}
