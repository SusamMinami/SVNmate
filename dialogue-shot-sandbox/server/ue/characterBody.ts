import { z } from "zod";
import type { BlueprintFormationSlot } from "../../src/types";
import type { UnrealInvoker } from "./transport";
import { CharacterBodyProfileSchema } from "../../src/director/characterGeometry";

const BoundsSchema = z.object({
  modelIndex: z.number().int().nonnegative(),
  meshPath: z.string(),
  min: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  max: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  error: z.string(),
});

// Read defaults only. Spawning preview actors can execute Construction Scripts.
export async function readCharacterBodies(
  connection: UnrealInvoker,
  slots: BlueprintFormationSlot[],
): Promise<string[]> {
  if (slots.length === 0) return [];
  const payload = slots.map((slot) => ({
    modelIndex: slot.modelIndex,
    classPath: slot.modelClassPath,
    componentPath: slot.componentName,
  }));
  const script = `
import json
items = json.loads(${JSON.stringify(JSON.stringify(payload))})
_result = []
for item in items:
    row = dict(modelIndex=item['modelIndex'], meshPath='', min=[0,0,0], max=[0,0,0], error='')
    try:
        cls = unreal.load_class(None, item['classPath'])
        if not cls:
            raise RuntimeError('Generated Class unavailable')
        actor = unreal.get_default_object(cls)
        component = unreal.load_object(None, item['componentPath'])
        if component:
            try:
                template = component.get_editor_property('child_actor_template')
                if template:
                    actor = template
            except Exception:
                pass
        try:
            mesh_component = actor.get_editor_property('mesh')
        except Exception:
            meshes = list(actor.get_components_by_class(unreal.SkeletalMeshComponent))
            if len(meshes) != 1:
                raise RuntimeError('Body mesh is ambiguous or unavailable')
            mesh_component = meshes[0]
        mesh = mesh_component.get_editor_property('skeletal_mesh')
        if not mesh:
            raise RuntimeError('Body mesh unavailable')
        bounds = mesh.get_imported_bounds()
        origin = bounds.origin
        extent = bounds.box_extent
        transforms = []
        current = mesh_component
        seen = set()
        while current:
            path = current.get_path_name()
            if path in seen:
                raise RuntimeError('Component attachment cycle')
            seen.add(path)
            transforms.append(unreal.Transform(
                location=current.get_editor_property('relative_location'),
                rotation=current.get_editor_property('relative_rotation'),
                scale=current.get_editor_property('relative_scale3d')))
            current = current.get_attach_parent()
        points = []
        for x in [-1,1]:
            for y in [-1,1]:
                for z in [-1,1]:
                    point = unreal.Vector(origin.x+x*extent.x, origin.y+y*extent.y, origin.z+z*extent.z)
                    for transform in transforms:
                        point = unreal.MathLibrary.transform_location(transform, point)
                    points.append([point.x, point.y, point.z])
        row['meshPath'] = mesh.get_path_name()
        row['min'] = [min(p[i] for p in points) for i in range(3)]
        row['max'] = [max(p[i] for p in points) for i in range(3)]
    except Exception as error:
        row['error'] = str(error)
    _result.append(row)
`;
  const expression = `(lambda ns: (exec(${JSON.stringify(script)}, ns), __import__('json').dumps(ns['_result']))[1])({'unreal': unreal})`;
  const raw = await connection.invoke("script.eval_python_expression", {
    Expression: expression,
  });
  const result = raw as { bSuccess?: boolean; Result?: string };
  if (result?.bSuccess === false) throw new Error("UE 体型读取失败");
  const text = String(result?.Result ?? "").trim();
  const rows = z.array(BoundsSchema).parse(JSON.parse(
    text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1) : text,
  ));
  const byIndex = new Map(rows.map((row) => [row.modelIndex, row]));
  const warnings: string[] = [];
  for (const slot of slots) {
    const row = byIndex.get(slot.modelIndex);
    if (!row || row.error) {
      warnings.push(`槽位 ${slot.modelIndex} 体型未读取，使用默认估算：${row?.error || "缺少返回数据"}`);
      continue;
    }
    // Slot scale is applied once, after the mesh-to-actor attachment chain.
    const scale = slot.transform.scale;
    const min = row.min.map((v, i) =>
      Math.min(v * [scale.x, scale.y, scale.z][i], row.max[i] * [scale.x, scale.y, scale.z][i]),
    );
    const max = row.max.map((v, i) =>
      Math.max(v * [scale.x, scale.y, scale.z][i], row.min[i] * [scale.x, scale.y, scale.z][i]),
    );
    const parsed = CharacterBodyProfileSchema.safeParse({
      source: "mesh_bounds",
      meshPath: row.meshPath,
      height: (max[2] - min[2]) / 100,
      width: (max[1] - min[1]) / 100,
      depth: (max[0] - min[0]) / 100,
      // Match formation coordinates: UE (X forward, Y right, Z up)
      // becomes stage (Y right, Z up, -X forward).
      footOffset: [(min[1] + max[1]) / 200, min[2] / 100, -(min[0] + max[0]) / 200],
      landmarkSource: "proportional",
    });
    if (!parsed.success) {
      warnings.push(`槽位 ${slot.modelIndex} 的模型尺寸异常，使用默认估算`);
      continue;
    }
    slot.bodyProfile = parsed.data;
    if (Math.abs(slot.transform.rotation.pitch) > 0.1 || Math.abs(slot.transform.rotation.roll) > 0.1) {
      warnings.push(`槽位 ${slot.modelIndex} 有俯仰或横滚；当前体型预览按直立姿态估算`);
    }
  }
  return warnings;
}
