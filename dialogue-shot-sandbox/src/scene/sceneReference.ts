import { z } from "zod";
import * as THREE from "three";
import type { UnrealTransform, Vec3, ShotValidationIssue } from "../types";

export const SceneVectorSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).readonly();
const vector = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });
export const SceneTransformSchema = z.object({
  location: vector,
  rotation: z.object({ pitch: z.number().finite(), yaw: z.number().finite(), roll: z.number().finite() }),
  scale: vector,
});
export const SceneAnchorSchema = z.object({
  id: z.string().min(1).max(1024),
  label: z.string().max(512),
  source: z.enum(["selected_actor", "level_actor", "dialogue_metadata"]),
  transform: SceneTransformSchema,
});
export const SceneObjectSchema = z.object({
  id: z.string().min(1).max(2048),
  label: z.string().max(512),
  assetPath: z.string().max(1024),
  kind: z.enum(["static_mesh", "mesh_instance"]),
  center: SceneVectorSchema,
  size: SceneVectorSchema.refine((v) => v.every((n) => n > 0 && n < 100_000)),
});
export const SceneReferenceSchema = z.object({
  version: z.literal("scene-reference.v1"),
  dialogueId: z.string().regex(/^\d{4}$/),
  formationClassPath: z.string().startsWith("/Game/").max(1024),
  mapPath: z.string().startsWith("/Game/").max(1024),
  anchor: SceneAnchorSchema,
  stageOrigin: SceneVectorSchema,
  radiusMeters: z.number().min(5).max(60),
  capturedAt: z.string().datetime(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  objects: z.array(SceneObjectSchema).max(240),
  warnings: z.array(z.string().max(1024)).max(40),
  truncated: z.boolean(),
  shareWithDirector: z.boolean(),
});
export const SceneInspectionSchema = z.object({
  mapPath: z.string(),
  candidates: z.array(SceneAnchorSchema).max(32),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  warnings: z.array(z.string()).max(40),
});
export const SceneReadRequestSchema = z.object({
  dialogueId: z.string().regex(/^\d{4}$/),
  startId: z.string().regex(/^\d{4,}$/),
  formationClassPath: z.string().regex(/^\/Game\/[^'"\r\n]+_C$/).max(1024),
  stageOrigin: SceneVectorSchema,
  radiusMeters: z.number().min(5).max(60),
  anchorId: z.string().max(1024).optional(),
  inspectionFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export const SceneReadResultSchema = z.object({
  inspection: SceneInspectionSchema,
  snapshot: SceneReferenceSchema.optional(),
});
export type SceneReference = z.infer<typeof SceneReferenceSchema>;
export type SceneObject = z.infer<typeof SceneObjectSchema>;
export type SceneInspection = z.infer<typeof SceneInspectionSchema>;
export type SceneReadRequest = z.infer<typeof SceneReadRequestSchema>;
export type SceneReadResult = z.infer<typeof SceneReadResultSchema>;

export function unrealRootMatrix(root: UnrealTransform): THREE.Matrix4 {
  const radians = THREE.MathUtils.degToRad;
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    -radians(root.rotation.roll), -radians(root.rotation.pitch), radians(root.rotation.yaw), "ZYX",
  ));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(root.location.x, root.location.y, root.location.z),
    rotation, new THREE.Vector3(root.scale.x, root.scale.y, root.scale.z),
  );
}

export function worldPointToStage(point: Vec3, root: UnrealTransform, stageOrigin: Vec3): Vec3 {
  const matrix = unrealRootMatrix(root);
  if (Math.abs(matrix.determinant()) < 1e-8) throw new Error("场景落点缩放不可逆");
  const local = new THREE.Vector3(...point).applyMatrix4(matrix.invert());
  return [local.y / 100 - stageOrigin[0], local.z / 100 - stageOrigin[1], -local.x / 100 - stageOrigin[2]];
}

export function stagePointToWorld(point: Vec3, root: UnrealTransform, stageOrigin: Vec3): Vec3 {
  const value = new THREE.Vector3(
    -(point[2] + stageOrigin[2]) * 100,
    (point[0] + stageOrigin[0]) * 100,
    (point[1] + stageOrigin[1]) * 100,
  ).applyMatrix4(unrealRootMatrix(root));
  return [value.x, value.y, value.z];
}

export function worldBoundsToStage(center: Vec3, extent: Vec3, root: UnrealTransform, origin: Vec3) {
  const box = new THREE.Box3();
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    box.expandByPoint(new THREE.Vector3(...worldPointToStage([
      center[0] + x * extent[0], center[1] + y * extent[1], center[2] + z * extent[2],
    ], root, origin)));
  }
  const middle = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { center: middle.toArray() as [number, number, number], size: size.toArray() as [number, number, number] };
}

export function sceneObjectBox(object: SceneObject): THREE.Box3 {
  return new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...object.center), new THREE.Vector3(...object.size));
}

const cachedBoxes = new WeakMap<SceneReference, THREE.Box3[]>();
function sceneBoxes(scene: SceneReference): THREE.Box3[] {
  let boxes = cachedBoxes.get(scene);
  if (!boxes) {
    boxes = scene.objects.map(sceneObjectBox);
    cachedBoxes.set(scene, boxes);
  }
  return boxes;
}

export function sceneGeometryPenalty(scene: SceneReference | undefined, camera: Vec3, target: Vec3): number {
  if (!scene) return 0;
  const from = new THREE.Vector3(...camera);
  const to = new THREE.Vector3(...target);
  const distance = from.distanceTo(to);
  const ray = new THREE.Ray(from, to.sub(from).normalize());
  const hit = new THREE.Vector3();
  let penalty = 0;
  for (const box of sceneBoxes(scene)) {
    if (box.containsPoint(from)) penalty += 150;
    else if (ray.intersectBox(box, hit) && hit.distanceTo(from) < distance - 0.05) penalty += 40;
  }
  return Math.min(900, penalty);
}

export function scenePathIssues(
  scene: SceneReference | undefined,
  start: { position: Vec3; target: Vec3 },
  end: { position: Vec3; target: Vec3 },
): ShotValidationIssue[] {
  if (!scene) return [];
  let suspected = false;
  let outside = false;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const position = start.position.map((v, i) => v + (end.position[i] - v) * t) as [number, number, number];
    const target = start.target.map((v, i) => v + (end.target[i] - v) * t) as [number, number, number];
    suspected ||= sceneGeometryPenalty(scene, position, target) > 0;
    outside ||= Math.hypot(...position) > scene.radiusMeters || Math.hypot(...target) > scene.radiusMeters;
  }
  const issues: ShotValidationIssue[] = [];
  if (suspected) issues.push({ ruleId: "SCN-BOUNDS", severity: "warning", message: "机位或视轴可能穿过场景包围盒，需在 UE 核验真实遮挡（含运动中段采样）" });
  if (outside) issues.push({ ruleId: "SCN-RANGE", severity: "warning", message: "部分机位或注视点超出场景采集半径，远景与运动路径参考不完整" });
  if (scene.truncated) issues.push({ ruleId: "SCN-PARTIAL", severity: "warning", message: "场景快照已截断，未覆盖全部附近组件" });
  return issues;
}
