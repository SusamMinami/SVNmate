import { createHash } from "node:crypto";
import { z } from "zod";
import {
  SceneAnchorSchema, SceneReadRequestSchema, SceneReferenceSchema,
  stagePointToWorld, worldBoundsToStage,
  type SceneReadResult, type SceneReadRequest,
} from "../../src/scene/sceneReference";
import { readSceneDialogueAnchor } from "../ueBridge";
import { UnrealMcpConnection, type UnrealInvoker } from "./transport";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const triplet = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const DiscoverySchema = z.object({
  mapPath: z.string().startsWith("/Game/"),
  candidates: z.array(SceneAnchorSchema).max(32),
  truncated: z.boolean(),
});
const CaptureSchema = z.object({
  objects: z.array(z.object({
    id: z.string(), label: z.string(), assetPath: z.string(),
    kind: z.enum(["static_mesh", "mesh_instance"]), center: triplet, extent: triplet,
  })).max(240),
  truncated: z.boolean(),
  skipped: z.number().int().nonnegative(),
});

async function evaluate(connection: UnrealInvoker, script: string): Promise<unknown> {
  const expression = `(lambda ns: (exec(${JSON.stringify(script)}, ns), __import__('json').dumps(ns['_result']))[1])({'unreal': unreal})`;
  const response = await connection.invoke("script.eval_python_expression", { Expression: expression }) as { bSuccess?: boolean; Result?: string };
  if (response?.bSuccess === false) throw new Error(`UE 场景读取失败：${response.Result ?? ""}`);
  const value = String(response?.Result ?? "").trim();
  return JSON.parse(value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value);
}

const HELPERS = `
import json, time, math
def xyz(v):
    return [float(v.x), float(v.y), float(v.z)]
def actor_transform(a):
    p, r, s = a.get_actor_location(), a.get_actor_rotation(), a.get_actor_scale3d()
    return dict(location=dict(x=p.x,y=p.y,z=p.z), rotation=dict(pitch=r.pitch,yaw=r.yaw,roll=r.roll), scale=dict(x=s.x,y=s.y,z=s.z))
def current_map():
    return unreal.EditorLevelLibrary.get_editor_world().get_path_name().split('.')[0]
`;

export async function readSceneReference(
  rawRequest: unknown,
  connectionFactory: () => UnrealInvoker = () => new UnrealMcpConnection(),
  metadataReader = readSceneDialogueAnchor,
): Promise<SceneReadResult> {
  const request = SceneReadRequestSchema.parse(rawRequest);
  const connection = connectionFactory();
  try {
    await connection.connect();
    const found = DiscoverySchema.parse(await evaluate(connection, HELPERS + `
class_path = ${JSON.stringify(request.formationClassPath)}
selected = {a.get_path_name() for a in unreal.EditorLevelLibrary.get_selected_level_actors()}
candidates = []
truncated = False
for a in unreal.EditorLevelLibrary.get_all_level_actors():
    if a.get_class().get_path_name() != class_path:
        continue
    if len(candidates) >= 32:
        truncated = True
        break
    candidates.append(dict(id=a.get_path_name(), label=a.get_actor_label(), source='selected_actor' if a.get_path_name() in selected else 'level_actor', transform=actor_transform(a)))
_result = dict(mapPath=current_map(), candidates=candidates, truncated=truncated)
`));
    const warnings = ["仅采集当前已加载内容；地形、动态角色与非静态网格不参与本次参考。"];
    let metadata: Awaited<ReturnType<typeof metadataReader>> | undefined;
    try {
      metadata = await metadataReader(connection, request.startId, request.formationClassPath);
      if (metadata.mapPath !== found.mapPath) {
        warnings.push(`预览地图与当前地图不一致：${metadata.mapPath}；不会自动切图。`);
        metadata = undefined;
      }
    } catch (error) {
      warnings.push(`未使用对话落点：${error instanceof Error ? error.message : "读取失败"}`);
    }
    if (found.truncated) warnings.push("同类 BP 实例超过 32 个，请在 UE 中缩小场景范围后重试。");
    const candidates = [...found.candidates];
    if (metadata && candidates.length < 32) {
      candidates.push({ id: "dialogue_metadata", label: "对话固定预览落点", source: "dialogue_metadata", transform: metadata.transform });
    }
    const inspection = {
      mapPath: found.mapPath, candidates, warnings,
      fingerprint: digest({ request: { ...request, anchorId: undefined, inspectionFingerprint: undefined }, mapPath: found.mapPath, candidates }),
    };
    if (!request.anchorId) return { inspection };
    if (request.inspectionFingerprint !== inspection.fingerprint) {
      throw new Error("地图、落点或采集参数已变化，请重新读取并确认落点");
    }
    const anchor = candidates.find((candidate) => candidate.id === request.anchorId);
    if (!anchor) throw new Error("选中的场景落点已不存在，请重新读取");
    if (Object.values(anchor.transform.scale).some((value) => Math.abs(value - 1) > 0.001) ||
        Math.abs(anchor.transform.rotation.pitch) > 0.01 || Math.abs(anchor.transform.rotation.roll) > 0.01) {
      throw new Error("当前仅支持直立、单位缩放的场景根；请校准该 BP 实例后再采集");
    }
    const scanCenter = stagePointToWorld([0, 0, 0], anchor.transform, request.stageOrigin);
    const captured = CaptureSchema.parse(await evaluate(connection, captureScript(request, anchor, found.mapPath, scanCenter)));
    const objects = captured.objects.flatMap((object) => {
      if (object.extent.some((value) => value <= 0)) return [];
      return [{ id: object.id, label: object.label, assetPath: object.assetPath, kind: object.kind,
        ...worldBoundsToStage(object.center, object.extent, anchor.transform, request.stageOrigin) }];
    });
    if (captured.truncated) warnings.push("已达到采集数量或时间上限，快照不完整，可缩小半径后重试。");
    if (captured.skipped) warnings.push(`${captured.skipped} 个组件或实例无法读取，已跳过。`);
    const content = {
      version: "scene-reference.v1" as const, dialogueId: request.dialogueId,
      formationClassPath: request.formationClassPath, mapPath: found.mapPath, anchor,
      stageOrigin: request.stageOrigin, radiusMeters: request.radiusMeters,
      objects, warnings, truncated: captured.truncated, shareWithDirector: false,
    };
    return {
      inspection,
      snapshot: SceneReferenceSchema.parse({ ...content, capturedAt: new Date().toISOString(), fingerprint: digest(content) }),
    };
  } finally {
    connection.close();
  }
}

function captureScript(
  request: SceneReadRequest, anchor: z.infer<typeof SceneAnchorSchema>, mapPath: string, center: readonly number[],
): string {
  const payload = JSON.stringify({ anchor, mapPath, center, radius: request.radiusMeters * 100, classPath: request.formationClassPath });
  return HELPERS + `
config = json.loads(${JSON.stringify(payload)})
if current_map() != config['mapPath']:
    raise RuntimeError('Map changed before capture')
if config['anchor']['source'] != 'dialogue_metadata':
    root_actor = unreal.load_object(None, config['anchor']['id'])
    if not root_actor or actor_transform(root_actor) != config['anchor']['transform']:
        raise RuntimeError('Anchor changed before capture')
deadline = time.monotonic() + 4.0
objects, skipped, visited = [], 0, 0
truncated = False
def near(origin, extent):
    return sum(max(0, abs(origin[i]-config['center'][i])-extent[i])**2 for i in range(3)) <= config['radius']**2
def belongs_to_formation(actor):
    seen = set()
    while actor and actor.get_path_name() not in seen:
        seen.add(actor.get_path_name())
        if actor.get_class().get_path_name() == config['classPath']:
            return True
        actor = actor.get_parent_actor()
    return False
actors = unreal.EditorLevelLibrary.get_all_level_actors()
for actor in actors:
    if time.monotonic() > deadline or len(objects) >= 240 or visited >= 20000:
        truncated = True
        break
    try:
        if actor.is_hidden_ed() or belongs_to_formation(actor):
            continue
        for comp in actor.get_components_by_class(unreal.StaticMeshComponent):
            if time.monotonic() > deadline or len(objects) >= 240 or visited >= 20000:
                truncated = True
                break
            visited += 1
            try:
                if not comp.is_visible() or comp.get_editor_property('hidden_in_game'):
                    continue
                mesh = comp.get_editor_property('static_mesh')
                if not mesh:
                    continue
                origin, extent, sphere = unreal.SystemLibrary.get_component_bounds(comp)
                if not near(xyz(origin), xyz(extent)):
                    continue
                if isinstance(comp, unreal.InstancedStaticMeshComponent):
                    bounds = mesh.get_bounding_box()
                    for index in range(comp.get_instance_count()):
                        if time.monotonic() > deadline or len(objects) >= 240 or visited >= 20000:
                            truncated = True
                            break
                        visited += 1
                        transform = comp.get_instance_transform(index, world_space=True)
                        points = []
                        for x in [bounds.min.x, bounds.max.x]:
                            for y in [bounds.min.y, bounds.max.y]:
                                for z in [bounds.min.z, bounds.max.z]:
                                    points.append(xyz(unreal.MathLibrary.transform_location(transform, unreal.Vector(x,y,z))))
                        low = [min(p[i] for p in points) for i in range(3)]
                        high = [max(p[i] for p in points) for i in range(3)]
                        c = [(low[i]+high[i])/2 for i in range(3)]
                        e = [(high[i]-low[i])/2 for i in range(3)]
                        if near(c,e):
                            objects.append(dict(id=comp.get_path_name()+':'+str(index), label=actor.get_actor_label()+' ['+str(index)+']', assetPath=mesh.get_path_name(), kind='mesh_instance', center=c, extent=e))
                else:
                    objects.append(dict(id=comp.get_path_name(), label=actor.get_actor_label(), assetPath=mesh.get_path_name(), kind='static_mesh', center=xyz(origin), extent=xyz(extent)))
            except Exception:
                skipped += 1
    except Exception:
        skipped += 1
_result = dict(objects=objects, truncated=truncated, skipped=skipped)
`;
}
