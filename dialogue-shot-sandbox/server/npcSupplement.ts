import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { buildNpcSupplementPlan } from "../src/data/npcSupplement";
import type {
  NpcSupplementApplyResult,
  NpcSupplementPlan,
  NpcSupplementPlanRequest,
  NpcSupplementTarget,
} from "../src/types";
import {
  UnrealMcpConnection,
  type UnrealInvoker,
} from "./ue/transport";

const SupplementTargetSchema = z.object({
  targetProjectFile: z.string().min(1),
  targetContentDirectory: z.string().min(1),
  selectedAssetPath: z.string().startsWith("/Game/"),
  selectedAssetName: z.string().min(1),
  selectedAssetType: z.enum(["Blueprint", "SkeletalMesh"]),
  npcName: z.string().regex(/^[A-Za-z0-9_]+$/),
  skeletalMeshAssetPath: z.string().startsWith("/Game/"),
  skeletonAssetPath: z.string().startsWith("/Game/"),
  faceSkeletalMeshAssetPath: z.string(),
  faceSkeletonAssetPath: z.string(),
  targetPackagePath: z.string().startsWith("/Game/"),
  animationPackagePath: z.string().startsWith("/Game/"),
  existingAssetPaths: z.array(z.string()),
  dirtyPackageNames: z.array(z.string()),
  warnings: z.array(z.string()),
});

const SupplementPlanRequestSchema = z.object({
  kind: z.enum(["actions", "face"]),
  target: SupplementTargetSchema,
  sourceDirectory: z.string().min(1),
  includedSourceFiles: z.array(z.string()).optional(),
  faceOptions: z.array(
    z.object({
      sourceFile: z.string().min(1),
      copyFaceCurves: z.boolean(),
      makeMontage: z.boolean(),
    }),
  ).optional(),
});

const SupplementApplyRequestSchema = z.object({
  plan: z.custom<NpcSupplementPlan>(
    (value) => Boolean(value && typeof value === "object"),
  ),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
});

function faceSupplementScriptPath(): string {
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  return resourcesPath
    ? join(resourcesPath, "ue-scripts", "npc_face_supplement.py")
    : join(
        process.cwd(),
        "server",
        "ue",
        "scripts",
        "npc_face_supplement.py",
      );
}

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
    { timeoutMs: 180_000 },
  );
  return parsePythonJson(value, errorMessage);
}

async function connectUnreal(connection: UnrealInvoker): Promise<void> {
  try {
    await connection.connect();
  } catch {
    connection.close();
    throw new Error(
      "无法连接策划 UE 的 OmniMcpCore，请确认目标工程和插件正在运行",
    );
  }
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
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".fbx") {
        files.push(path);
      }
    }
  };
  await visit(directory);
  return files.sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
}

function planPayload(
  plan: NpcSupplementPlan | Omit<NpcSupplementPlan, "reviewToken">,
) {
  const { reviewToken: _reviewToken, ...payload } =
    plan as NpcSupplementPlan;
  return payload;
}

function reviewTokenFor(
  plan: NpcSupplementPlan | Omit<NpcSupplementPlan, "reviewToken">,
): string {
  return createHash("sha256")
    .update(JSON.stringify(planPayload(plan)))
    .digest("hex");
}

function assertReviewToken(
  plan: NpcSupplementPlan,
  reviewToken: string,
): void {
  if (reviewTokenFor(plan) !== reviewToken || plan.reviewToken !== reviewToken) {
    throw new Error("增补清单已变化，请重新检查后再执行");
  }
}

function packagePath(value: string): string {
  return value.split(".", 1)[0];
}

function normalizedDiskPath(value: string): string {
  return resolve(value.trim()).replace(/[\\/]+$/, "").toLowerCase();
}

function assertSourceFiles(
  plan: NpcSupplementPlan,
): Promise<void[]> {
  const sourceRoot = resolve(plan.sourceDirectory);
  return Promise.all(
    plan.items.filter((item) => item.included).map(async (item) => {
      const sourceFile = resolve(item.sourceFile);
      const sourceRelative = relative(sourceRoot, sourceFile);
      if (
        sourceRelative.startsWith(`..${sep}`) ||
        sourceRelative === ".." ||
        extname(sourceFile).toLowerCase() !== ".fbx"
      ) {
        throw new Error(`动作文件超出已审核目录：${item.sourceFile}`);
      }
      await access(sourceFile);
    }),
  );
}

export async function scanNpcSupplementTarget(
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<NpcSupplementTarget> {
  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    const script = `
import os

def actor_components(actor):
    try:
        return list(actor.get_components_by_class(unreal.ActorComponent))
    except Exception:
        try:
            return list(actor.get_all_components())
        except Exception:
            return []

selected_assets = list(unreal.EditorUtilityLibrary.get_selected_assets())
if len(selected_assets) != 1:
    _result = {'error': '请在策划 UE 内容浏览器中只选择一个 NPC BP 或 Body Skeletal Mesh'}
else:
    selected = selected_assets[0]
    selected_type = selected.get_class().get_name()
    body_mesh = None
    component_face_meshes = []
    if selected_type == 'SkeletalMesh':
        if 'face' not in selected.get_name().lower():
            body_mesh = selected
    elif selected_type == 'Blueprint':
        cdo = unreal.get_default_object(selected.generated_class())
        for component in actor_components(cdo):
            if not isinstance(component, unreal.SkeletalMeshComponent):
                continue
            try:
                candidate = component.get_editor_property('skeletal_mesh')
            except Exception:
                candidate = None
            if not candidate:
                continue
            looks_like_face = (
                'face' in component.get_name().lower()
                or 'face' in candidate.get_name().lower()
            )
            if looks_like_face:
                component_face_meshes.append(candidate)
            elif body_mesh is None:
                body_mesh = candidate
    if selected_type not in ['SkeletalMesh', 'Blueprint']:
        _result = {'error': '当前选择必须是 NPC BP 或 Body Skeletal Mesh'}
    elif not body_mesh:
        _result = {'error': '无法从当前选择中确定 Body Skeletal Mesh'}
    else:
        body_name = body_mesh.get_name()
        npc_name = body_name[3:] if body_name.lower().startswith('sk_') else body_name
        body_package = body_mesh.get_outermost().get_path_name()
        target_root = body_package.rsplit('/', 1)[0]
        animation_root = target_root + '/Animation'
        asset_paths = [
            str(path)
            for path in unreal.EditorAssetLibrary.list_assets(
                target_root,
                recursive=True,
                include_folder=False
            )
        ]
        registry = unreal.AssetRegistryHelpers.get_asset_registry()
        face_candidates = []
        for asset_data in registry.get_assets_by_path(
            unreal.Name(target_root),
            recursive=True
        ):
            try:
                asset_class = str(asset_data.get_editor_property('asset_class'))
            except Exception:
                asset_class = ''
            if asset_class != 'SkeletalMesh':
                continue
            candidate = asset_data.get_asset()
            candidate_name = candidate.get_name().lower()
            if 'face' in candidate_name and npc_name.lower() in candidate_name:
                face_candidates.append(candidate)
        all_face_candidates = component_face_meshes + face_candidates
        unique_face_candidates = []
        seen_face_paths = set()
        for candidate in all_face_candidates:
            path = candidate.get_path_name()
            if path not in seen_face_paths:
                seen_face_paths.add(path)
                unique_face_candidates.append(candidate)
        exact_face_name = ('SK_' + npc_name + '_Face').lower()
        exact_face_candidates = [
            candidate for candidate in unique_face_candidates
            if candidate.get_name().lower() == exact_face_name
        ]
        face_mesh = (
            exact_face_candidates[0] if len(exact_face_candidates) == 1
            else unique_face_candidates[0] if len(unique_face_candidates) == 1
            else None
        )
        body_skeleton = body_mesh.get_editor_property('skeleton')
        face_skeleton = face_mesh.get_editor_property('skeleton') if face_mesh else None
        dirty = [
            str(package.get_path_name())
            for package in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()
        ]
        _result = {
            'target_project_file': os.path.abspath(unreal.Paths.get_project_file_path()),
            'target_content_directory': os.path.abspath(unreal.Paths.project_content_dir()),
            'selected_asset_path': selected.get_path_name(),
            'selected_asset_name': selected.get_name(),
            'selected_asset_type': selected_type,
            'npc_name': npc_name,
            'skeletal_mesh_asset_path': body_mesh.get_path_name(),
            'skeleton_asset_path': body_skeleton.get_path_name() if body_skeleton else '',
            'face_skeletal_mesh_asset_path': face_mesh.get_path_name() if face_mesh else '',
            'face_skeleton_asset_path': face_skeleton.get_path_name() if face_skeleton else '',
            'target_package_path': target_root,
            'animation_package_path': animation_root,
            'existing_asset_paths': asset_paths,
            'dirty_package_names': dirty,
            'face_candidate_count': len(unique_face_candidates),
        }
`;
    const raw = (await invokePythonJson(
      connection,
      script,
      "无法解析策划 UE 的 NPC 增补目标",
    )) as Record<string, unknown>;
    if (raw.error) {
      throw new Error(String(raw.error));
    }
    const warnings: string[] = [];
    const faceCandidateCount = Number(raw.face_candidate_count ?? 0);
    if (faceCandidateCount > 1 && !raw.face_skeletal_mesh_asset_path) {
      warnings.push("找到多个 Face Skeletal Mesh，无法自动确定使用哪一个");
    } else if (!raw.face_skeletal_mesh_asset_path) {
      warnings.push("未找到与当前 NPC 对应的 Face Skeletal Mesh");
    }
    const target: NpcSupplementTarget = {
      targetProjectFile: String(raw.target_project_file ?? ""),
      targetContentDirectory: String(raw.target_content_directory ?? ""),
      selectedAssetPath: String(raw.selected_asset_path ?? ""),
      selectedAssetName: String(raw.selected_asset_name ?? ""),
      selectedAssetType:
        raw.selected_asset_type === "Blueprint"
          ? "Blueprint"
          : "SkeletalMesh",
      npcName: String(raw.npc_name ?? ""),
      skeletalMeshAssetPath: String(raw.skeletal_mesh_asset_path ?? ""),
      skeletonAssetPath: String(raw.skeleton_asset_path ?? ""),
      faceSkeletalMeshAssetPath: String(
        raw.face_skeletal_mesh_asset_path ?? "",
      ),
      faceSkeletonAssetPath: String(raw.face_skeleton_asset_path ?? ""),
      targetPackagePath: String(raw.target_package_path ?? ""),
      animationPackagePath: String(raw.animation_package_path ?? ""),
      existingAssetPaths: (
        Array.isArray(raw.existing_asset_paths)
          ? raw.existing_asset_paths
          : []
      ).map(String),
      dirtyPackageNames: (
        Array.isArray(raw.dirty_package_names)
          ? raw.dirty_package_names
          : []
      ).map(String),
      warnings,
    };
    if (!target.skeletonAssetPath) {
      throw new Error("当前 NPC 的 Body Skeletal Mesh 没有关联 Skeleton");
    }
    return target;
  } finally {
    connection.close();
  }
}

export async function inspectNpcSupplementPlan(
  rawRequest: unknown,
): Promise<NpcSupplementPlan> {
  const request = SupplementPlanRequestSchema.parse(
    rawRequest,
  ) as NpcSupplementPlanRequest;
  const sourceDirectory = resolve(request.sourceDirectory);
  const animationFiles = await listFbxFiles(sourceDirectory);
  const planWithoutToken = buildNpcSupplementPlan(
    {
      ...request,
      sourceDirectory,
    },
    animationFiles,
  );
  const plan = { ...planWithoutToken, reviewToken: "" };
  plan.reviewToken = reviewTokenFor(plan);
  return plan;
}

async function applyNpcFaceSupplement(
  plan: NpcSupplementPlan,
  selectedItems: NpcSupplementPlan["items"],
  connection: UnrealInvoker,
): Promise<NpcSupplementApplyResult> {
  const source = await readFile(faceSupplementScriptPath(), "utf8");
  const payload = {
    target_project_file: plan.target.targetProjectFile,
    animation_package_path: plan.target.animationPackagePath,
    face_skeletal_mesh_asset_path:
      plan.target.faceSkeletalMeshAssetPath,
    face_skeleton_asset_path: plan.target.faceSkeletonAssetPath,
    remove_prefix: plan.npcPrefix,
    items: selectedItems.map((item) => ({
      source_file: item.sourceFile,
      source_asset_name: item.sourceAssetName,
      target_asset_path: packagePath(item.targetAssetPath),
      body_asset_path: packagePath(item.bodyAssetPath),
      state: item.state,
      copy_face_curves: item.copyFaceCurves,
      make_montage: item.makeMontage,
      montage_asset_path: packagePath(item.montageAssetPath),
      montage_state: item.montageState,
    })),
  };
  const script = [
    "import json",
    `FACE_SUPPLEMENT_REQUEST = json.loads(${JSON.stringify(JSON.stringify(payload))})`,
    source,
  ].join("\n");
  const raw = (await invokePythonJson(
    connection,
    script,
    "无法解析面部补充执行结果",
  )) as Record<string, unknown>;
  const array = (key: string): string[] =>
    (Array.isArray(raw[key]) ? raw[key] : []).map(String);
  const importedAssetPaths = array("imported_asset_paths");
  const lockedRootAssetPaths = array("locked_root_asset_paths");
  const curveCopiedBodyAssetPaths = array(
    "curve_copied_body_asset_paths",
  );
  const processedBodyAssetPaths = array("processed_body_asset_paths");
  const createdMontageAssetPaths = array(
    "created_montage_asset_paths",
  );
  const reusedMontageAssetPaths = array(
    "reused_montage_asset_paths",
  );
  const expectedCurveCount = selectedItems.filter(
    (item) => item.copyFaceCurves,
  ).length;
  const expectedCreatedMontageCount = selectedItems.filter(
    (item) => item.makeMontage && item.montageState === "create",
  ).length;
  const expectedReusedMontageCount = selectedItems.filter(
    (item) => item.makeMontage && item.montageState === "reuse",
  ).length;
  if (
    importedAssetPaths.length !== selectedItems.length ||
    lockedRootAssetPaths.length !== selectedItems.length
  ) {
    throw new Error("Face 动作导入或根骨骼锁定数量与审核清单不一致");
  }
  if (processedBodyAssetPaths.length !== selectedItems.length) {
    throw new Error("Body / Face 动作配对回读数量与审核清单不一致");
  }
  if (curveCopiedBodyAssetPaths.length !== expectedCurveCount) {
    throw new Error("表情曲线复制数量与审核清单不一致");
  }
  if (
    createdMontageAssetPaths.length !== expectedCreatedMontageCount ||
    reusedMontageAssetPaths.length !== expectedReusedMontageCount
  ) {
    throw new Error("Face Montage 处理数量与审核清单不一致");
  }
  return {
    status: "configured",
    kind: "face",
    importedAssetPaths,
    createdMontageAssetPaths,
    reusedMontageAssetPaths,
    lockedRootAssetPaths,
    curveCopiedBodyAssetPaths,
    processedBodyAssetPaths,
    manualChecks: [
      "抽查 Body 动作中的 Morph Target 曲线与 Face 动作是否一致",
      "抽查新建或复用 Montage 的动作内容与播放结果",
      "打开 NPC BP 验证面部动作，并保存相关 BP",
    ],
  };
}

export async function applyNpcSupplement(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
): Promise<NpcSupplementApplyResult> {
  const request = SupplementApplyRequestSchema.parse(rawRequest);
  const plan = request.plan;
  assertReviewToken(plan, request.reviewToken);
  if (!plan.canApply) {
    throw new Error("增补清单存在阻断项，不能执行");
  }
  await assertSourceFiles(plan);
  const selectedItems = plan.items.filter((item) => item.included);
  if (selectedItems.length === 0) {
    throw new Error("没有已审核的待处理动作");
  }

  const connection = connectionFactory();
  await connectUnreal(connection);
  try {
    if (plan.kind === "face") {
      return await applyNpcFaceSupplement(
        plan,
        selectedItems,
        connection,
      );
    }
    const script = `
import os

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
asset_library = unreal.EditorAssetLibrary
expected_project = os.path.normcase(os.path.abspath(${JSON.stringify(plan.target.targetProjectFile)}))
current_project = os.path.normcase(os.path.abspath(unreal.Paths.get_project_file_path()))
if current_project != expected_project:
    raise RuntimeError('当前连接的 UE 不是审核清单中的目标工程')

body_skeleton = unreal.load_asset(${JSON.stringify(plan.target.skeletonAssetPath)})
if not body_skeleton:
    raise RuntimeError('目标 Skeleton 不存在')

items = ${JSON.stringify(
      selectedItems.map((item) => ({
        source_file: item.sourceFile,
        source_asset_name: item.sourceAssetName,
        target_asset_path: packagePath(item.targetAssetPath),
        state: item.state,
        montage_name: item.montageName,
        montage_asset_path: packagePath(item.montageAssetPath),
        montage_state: item.montageState,
      })),
    )}
dirty_packages = set(
    str(package.get_path_name())
    for package in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()
)
for item in items:
    exists = asset_library.does_asset_exist(item['target_asset_path'])
    if item['state'] == 'new' and exists:
        raise RuntimeError('目标动作在审核后出现，请重新检查：' + item['target_asset_path'])
    if item['state'] == 'update' and not exists:
        raise RuntimeError('待更新动作在审核后消失，请重新检查：' + item['target_asset_path'])
    if item['target_asset_path'] in dirty_packages:
        raise RuntimeError('目标动作尚未保存：' + item['target_asset_path'])
    if item['montage_state'] == 'create' and asset_library.does_asset_exist(item['montage_asset_path']):
        raise RuntimeError('目标 Montage 在审核后出现，请重新检查：' + item['montage_asset_path'])
if any(item['montage_state'] == 'create' for item in items):
    if not all([
        hasattr(unreal, 'AnimMontageFactory'),
        hasattr(unreal, 'AnimSegment'),
        hasattr(unreal, 'AnimTrack'),
        hasattr(unreal, 'SlotAnimationTrack'),
    ]):
        raise RuntimeError('当前 UE Python 环境不支持自动创建 Montage')

destination = ${JSON.stringify(plan.target.animationPackagePath)}
asset_library.make_directory(destination)
imported = []
locked = []
for item in items:
    task = unreal.AssetImportTask()
    task.set_editor_property('filename', item['source_file'])
    task.set_editor_property('destination_path', destination)
    task.set_editor_property('destination_name', item['source_asset_name'])
    task.set_editor_property('automated', True)
    task.set_editor_property('replace_existing', item['state'] == 'update')
    task.set_editor_property('save', False)
    options = unreal.FbxImportUI()
    options.set_editor_property('automated_import_should_detect_type', False)
    options.set_editor_property('mesh_type_to_import', unreal.FBXImportType.FBXIT_ANIMATION)
    options.set_editor_property('original_import_type', unreal.FBXImportType.FBXIT_ANIMATION)
    options.set_editor_property('import_mesh', False)
    options.set_editor_property('import_animations', True)
    options.set_editor_property('skeleton', body_skeleton)
    task.set_editor_property('options', options)
    asset_tools.import_asset_tasks([task])
    animation = unreal.load_asset(item['target_asset_path'])
    if not animation or animation.get_class().get_name() != 'AnimSequence':
        raise RuntimeError('动作导入失败：' + item['source_asset_name'])
    actual_skeleton = animation.get_editor_property('skeleton')
    if not actual_skeleton or actual_skeleton.get_path_name() != body_skeleton.get_path_name():
        raise RuntimeError('动作 Skeleton 回读不一致：' + item['source_asset_name'])
    if not asset_library.save_loaded_asset(animation):
        raise RuntimeError('动作保存失败：' + item['source_asset_name'])
    imported.append(animation.get_path_name())

created_montages = []
def create_montage(item):
    sequence = unreal.load_asset(item['target_asset_path'])
    factory = unreal.AnimMontageFactory()
    try:
        factory.set_editor_property('target_skeleton', body_skeleton)
        factory.set_editor_property('source_animation', sequence)
    except Exception:
        pass
    montage = asset_tools.create_asset(
        item['montage_name'],
        ${JSON.stringify(plan.target.animationPackagePath)},
        unreal.AnimMontage,
        factory
    )
    if not montage:
        raise RuntimeError('创建 Montage 失败：' + item['montage_name'])
    tracks = []
    try:
        tracks = list(montage.get_editor_property('slot_anim_tracks'))
    except Exception:
        pass
    slot_name = 'IdleSlot' if item['montage_name'].lower().startswith('am_idle') else 'TurnSlot'
    if tracks:
        tracks[0].set_editor_property('slot_name', unreal.Name(slot_name))
        montage.set_editor_property('slot_anim_tracks', tracks)
    else:
        segment = unreal.AnimSegment()
        segment.set_editor_property('anim_reference', sequence)
        segment.set_editor_property('anim_start_time', 0.0)
        segment.set_editor_property('anim_end_time', sequence.get_play_length())
        segment.set_editor_property('anim_play_rate', 1.0)
        segment.set_editor_property('looping_count', 1)
        anim_track = unreal.AnimTrack()
        anim_track.set_editor_property('anim_segments', [segment])
        slot_track = unreal.SlotAnimationTrack()
        slot_track.set_editor_property('slot_name', unreal.Name(slot_name))
        slot_track.set_editor_property('anim_track', anim_track)
        montage.set_editor_property('slot_anim_tracks', [slot_track])
    if not asset_library.save_loaded_asset(montage):
        raise RuntimeError('Montage 保存失败：' + item['montage_name'])
    created_montages.append(montage.get_path_name())

for item in items:
    if item['montage_state'] == 'create':
        create_montage(item)

_result = {
    'imported_asset_paths': imported,
    'created_montage_asset_paths': created_montages,
    'locked_root_asset_paths': locked,
}
`;
    const raw = (await invokePythonJson(
      connection,
      script,
      "无法解析 NPC 增补执行结果",
    )) as Record<string, unknown>;
    const importedAssetPaths = (
      Array.isArray(raw.imported_asset_paths)
        ? raw.imported_asset_paths
        : []
    ).map(String);
    if (importedAssetPaths.length !== selectedItems.length) {
      throw new Error(
        `动作导入数量不一致：计划 ${selectedItems.length}，实际 ${importedAssetPaths.length}`,
      );
    }
    const createdMontageAssetPaths = (
      Array.isArray(raw.created_montage_asset_paths)
        ? raw.created_montage_asset_paths
        : []
    ).map(String);
    const expectedMontageCount = selectedItems.filter(
      (item) => item.montageState === "create",
    ).length;
    if (
      createdMontageAssetPaths.length !== expectedMontageCount
    ) {
      throw new Error("Montage 创建数量与审核清单不一致");
    }
    return {
      status: "configured",
      kind: "actions",
      importedAssetPaths,
      createdMontageAssetPaths,
      reusedMontageAssetPaths: [],
      lockedRootAssetPaths: [],
      curveCopiedBodyAssetPaths: [],
      processedBodyAssetPaths: [],
      manualChecks: [
        "抽查新增或更新动作的 Skeleton、帧率和 Root Motion",
        "检查新建 Idle / Turn Montage 的源动作与插槽",
        "保存并编译引用这些动作的 NPC BP / ABP",
      ],
    };
  } finally {
    connection.close();
  }
}
