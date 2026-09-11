import { createHash } from "node:crypto";
import { z } from "zod";
import type { DialogueCameraPresetSnapshot } from "../../src/types";
import type { UnrealInvoker } from "./transport";

const vector = z.object({ X: z.number().finite(), Y: z.number().finite(), Z: z.number().finite() });
const rotation = z.object({ Pitch: z.number().finite(), Yaw: z.number().finite(), Roll: z.number().finite() });
const pose = z.object({ position: vector, rotation });
const snapshotSchema = z.object({
  formationActorPath: z.string().min(1),
  formationClassPath: z.string().startsWith("/Game/"),
  roles: z.array(z.object({
    modelIndex: z.number().int().nonnegative(),
    label: z.string(),
    actorPath: z.string().min(1),
    cameraClassPath: z.string().min(1),
    cameras: z.array(z.object({
      name: z.string().regex(/^\d+$/),
      label: z.string(),
      componentPath: z.string().min(1),
      local: pose,
      world: pose,
    })).max(64),
  })).max(128),
});

export async function captureDialogueCameraPresets(
  connection: UnrealInvoker,
  formationClassPath: string,
  dialogueNodeId: string,
): Promise<DialogueCameraPresetSnapshot> {
  if (!formationClassPath.startsWith("/Game/")) {
    throw new Error("当前对话未配置 Formation BP，无法读取预设机位");
  }
  // Read already instantiated preview cameras: their world transforms include attachment and body offsets.
  const script = `
import math
class_path = ${JSON.stringify(formationClassPath)}
editor_world = unreal.EditorLevelLibrary.get_editor_world()
formats = [a for a in unreal.ObjectIterator(unreal.SeriaDialogFormat)
    if a.get_class().get_path_name() == class_path
    and a.get_world() and a.get_world() != editor_world
    and ':PersistentLevel.' in a.get_path_name()]
if len(formats) != 1:
    raise RuntimeError('Open the dialogue preview first; exactly one matching Formation preview is required.')
formation = formats[0]
scale = formation.get_actor_scale3d()
if any(abs(v - 1.0) > 0.0001 for v in (scale.x, scale.y, scale.z)):
    raise RuntimeError('Scaled Formation preview is not supported.')
def vec(v):
    return dict(X=round(float(v.x), 4), Y=round(float(v.y), 4), Z=round(float(v.z), 4))
def rot(r):
    return dict(Pitch=round(float(r.pitch), 4), Yaw=round(float(r.yaw), 4), Roll=round(float(r.roll), 4))
def pose(t):
    return dict(position=vec(t.translation), rotation=rot(t.rotation.rotator()))
roles = []
for slot in formation.get_components_by_class(unreal.ChildActorComponent):
    name = slot.get_name()
    if not name.isdigit():
        continue
    actor = slot.get_editor_property('child_actor')
    if not actor or not isinstance(actor, unreal.SeriaDialogCharacter):
        continue
    cameras = []
    for camera in actor.get_components_by_class(unreal.CameraComponent):
        camera_name = camera.get_name()
        if not camera_name.isdigit():
            continue
        world = camera.get_world_transform()
        local = unreal.MathLibrary.make_relative_transform(world, formation.get_actor_transform())
        relative = unreal.MathLibrary.make_relative_transform(world, actor.get_actor_transform())
        p = relative.translation
        angle = math.degrees(math.atan2(p.y, p.x))
        label = camera_name + ' | ' + ('%+.0f' % angle) + ' deg'
        cameras.append(dict(name=camera_name, label=label, componentPath=camera.get_path_name(),
            local=pose(local), world=pose(world)))
    if cameras:
        if len(cameras) > 64:
            raise RuntimeError('Too many cameras on one role.')
        cameras.sort(key=lambda c: int(c['name']))
        body = actor.get_dialog_actor()
        label = body.get_class().get_name() if body else actor.get_class().get_name()
        if label.endswith('_C'):
            label = label[:-2]
        roles.append(dict(modelIndex=int(name), label=label, actorPath=actor.get_path_name(),
            cameraClassPath=actor.get_class().get_path_name(), cameras=cameras))
if not roles:
    raise RuntimeError('No initialized role cameras found. Open the dialogue preview and initialize its actors.')
roles.sort(key=lambda r: r['modelIndex'])
_result = dict(formationActorPath=formation.get_path_name(), formationClassPath=class_path, roles=roles)
`;
  const expression = `(lambda ns: (exec(${JSON.stringify(script)}, ns), __import__('json').dumps(ns['_result']))[1])({'unreal': unreal})`;
  const raw = await connection.invoke("script.eval_python_expression", { Expression: expression }) as {
    bSuccess?: boolean; Result?: string; Message?: string;
  };
  if (raw?.bSuccess === false) {
    throw new Error(`无法读取预设机位，请打开当前对话预览并初始化角色后重试：${raw.Message || raw.Result || ""}`);
  }
  const serialized = String(raw?.Result ?? "").trim();
  const snapshot = snapshotSchema.parse(JSON.parse(
    serialized.startsWith("'") && serialized.endsWith("'") ? serialized.slice(1, -1) : serialized,
  ));
  if (new Set(snapshot.roles.map((role) => role.modelIndex)).size !== snapshot.roles.length ||
      snapshot.roles.some((role) => new Set(role.cameras.map((camera) => camera.name)).size !== role.cameras.length)) {
    throw new Error("预览角色或相机编号重复，无法确定预设");
  }
  return {
    ...snapshot,
    dialogueNodeId,
    fingerprint: createHash("sha256").update(JSON.stringify({ dialogueNodeId, snapshot })).digest("hex"),
  };
}

export function cameraMoveFromPreset(
  existingMoves: unknown[],
  defaults: Record<string, unknown>,
  preset: DialogueCameraPresetSnapshot["roles"][number]["cameras"][number],
): Record<string, unknown>[] {
  if (existingMoves.length > 1) throw new Error("当前节点包含多段运镜，不能用单个预设覆盖");
  const move = structuredClone(existingMoves[0] ?? defaults) as Record<string, unknown>;
  if (move.CameraMoveType !== "EPush") throw new Error("当前运镜不是 EPush，请保留原配置或先在 UE 中转换");
  const push = move.PushCameraArg;
  if (!push || typeof push !== "object" || Array.isArray(push)) throw new Error("当前 EPush 参数不完整");
  const args = push as Record<string, unknown>;
  if (typeof args.bRelative !== "boolean") throw new Error("当前 EPush 缺少坐标空间标记");
  const transform = args.bRelative ? preset.local : preset.world;
  move.PushCameraArg = {
    ...args,
    StartPoint: { ...transform.position },
    EndPoint: { ...transform.position },
    StartRotation: { ...transform.rotation },
    EndRotation: { ...transform.rotation },
  };
  return [move];
}
