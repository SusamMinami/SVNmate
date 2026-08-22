import * as THREE from "three";
import type {
  DialogueParticipant,
  ParticipantSlot,
  ShotCoverage,
  ShotSize,
  Vec3,
} from "../types";
import type { DirectorDecision } from "./contracts";

const CAMERA_ASPECT_RATIO = 16 / 9;
const ULTRAWIDE_SAFE_Y = 16 / 21;
const CHARACTER_HALF_WIDTH = 0.34;
const CHARACTER_HALF_DEPTH = 0.24;
const CHARACTER_TOP = 2.01;
const SIGNIFICANT_ACTOR_AREA = 0.012;

const SHOT_FRAMES: Record<
  ShotSize,
  { bottom: number; targetY: number; desiredNdcSpan: number }
> = {
  full: { bottom: 0, targetY: 1.03, desiredNdcSpan: 1.4 },
  "medium-full": { bottom: 0.38, targetY: 1.2, desiredNdcSpan: 1.4 },
  medium: { bottom: 0.7, targetY: 1.37, desiredNdcSpan: 1.38 },
  "medium-close-up": {
    bottom: 1.02,
    targetY: 1.52,
    desiredNdcSpan: 1.36,
  },
  "close-up": { bottom: 1.32, targetY: 1.67, desiredNdcSpan: 1.34 },
  "extreme-close-up": {
    bottom: 1.48,
    targetY: 1.73,
    desiredNdcSpan: 1.3,
  },
};

const SHOT_SIZE_INDEX: Record<ShotSize, number> = {
  full: 0,
  "medium-full": 1,
  medium: 2,
  "medium-close-up": 3,
  "close-up": 4,
  "extreme-close-up": 5,
};

interface Vec2 {
  x: number;
  z: number;
}

export interface CameraGeometry {
  position: Vec3;
  target: Vec3;
}

export interface ProjectedParticipant {
  slot: ParticipantSlot;
  areaRatio: number;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
}

export interface ProjectionAssessment {
  measuredShotSize: ShotSize;
  visibleParticipantSlots: ParticipantSlot[];
  foregroundParticipantSlots: ParticipantSlot[];
  participantAreaRatios: Partial<Record<ParticipantSlot, number>>;
  subjectFaceAngle: number;
  subjectSafeForUltrawide: boolean;
  valid: boolean;
  warnings: string[];
}

interface SingleCameraRequest {
  subject: DialogueParticipant;
  participants: DialogueParticipant[];
  lensMm: number;
  cameraHeight: number;
  screenPosition: DirectorDecision["screen_position"];
  shotSize: ShotSize;
  coverage: Extract<ShotCoverage, "single" | "group-medium">;
  preferredFaceAngle?: number;
  previousGeometry?: CameraGeometry;
}

interface GroupCameraRequest {
  participants: DialogueParticipant[];
  lensMm: number;
  cameraHeight: number;
  shotSize: Extract<ShotSize, "full" | "medium-full">;
}

function add(left: Vec2, right: Vec2): Vec2 {
  return { x: left.x + right.x, z: left.z + right.z };
}

function subtract(left: Vec2, right: Vec2): Vec2 {
  return { x: left.x - right.x, z: left.z - right.z };
}

function scale(vector: Vec2, amount: number): Vec2 {
  return { x: vector.x * amount, z: vector.z * amount };
}

function length(vector: Vec2): number {
  return Math.hypot(vector.x, vector.z);
}

function normalize(vector: Vec2, fallback: Vec2 = { x: 0, z: 1 }): Vec2 {
  const magnitude = length(vector);
  if (magnitude < 0.001) {
    return fallback;
  }
  return scale(vector, 1 / magnitude);
}

function dot(left: Vec2, right: Vec2): number {
  return left.x * right.x + left.z * right.z;
}

function sceneCenter(participants: DialogueParticipant[]): Vec3 {
  const total = participants.reduce<[number, number, number]>(
    (result, participant) => [
      result[0] + participant.position[0],
      result[1] + participant.position[1],
      result[2] + participant.position[2],
    ],
    [0, 0, 0],
  );
  return [
    total[0] / participants.length,
    total[1] / participants.length,
    total[2] / participants.length,
  ];
}

function sceneCameraSide(participants: DialogueParticipant[]): Vec2 {
  const sorted = [...participants].sort(
    (left, right) =>
      left.position[0] - right.position[0] ||
      left.position[2] - right.position[2],
  );
  const first = sorted[0];
  const last = sorted.at(-1) ?? first;
  const axis = normalize({
    x: last.position[0] - first.position[0],
    z: last.position[2] - first.position[2],
  });
  let side = normalize({ x: -axis.z, z: axis.x });
  if (side.z < -0.001 || (Math.abs(side.z) <= 0.001 && side.x < 0)) {
    side = scale(side, -1);
  }
  return side;
}

function subjectFacing(
  subject: DialogueParticipant,
  participants: DialogueParticipant[],
): Vec2 {
  const explicit = {
    x: subject.facingTarget[0] - subject.position[0],
    z: subject.facingTarget[2] - subject.position[2],
  };
  if (length(explicit) >= 0.05) {
    return normalize(explicit);
  }
  const nearest = participants
    .filter((participant) => participant.id !== subject.id)
    .map((participant) => ({
      participant,
      distance: Math.hypot(
        participant.position[0] - subject.position[0],
        participant.position[2] - subject.position[2],
      ),
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.participant;
  if (nearest) {
    return normalize({
      x: nearest.position[0] - subject.position[0],
      z: nearest.position[2] - subject.position[2],
    });
  }
  return scale(sceneCameraSide(participants), -1);
}

function cameraDirectionForSubject(
  subject: DialogueParticipant,
  participants: DialogueParticipant[],
  faceAngleDegrees: number,
): Vec2 {
  const facing = subjectFacing(subject, participants);
  const preferredSide = sceneCameraSide(participants);
  let localSide = normalize({ x: -facing.z, z: facing.x });
  if (dot(localSide, preferredSide) < 0) {
    localSide = scale(localSide, -1);
  }
  const radians = THREE.MathUtils.degToRad(faceAngleDegrees);
  return normalize(
    add(scale(facing, Math.cos(radians)), scale(localSide, Math.sin(radians))),
  );
}

function cameraFor(
  position: Vec3,
  target: Vec3,
  lensMm: number,
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    42,
    CAMERA_ASPECT_RATIO,
    0.1,
    100,
  );
  camera.position.set(...position);
  camera.setFocalLength(lensMm);
  camera.lookAt(new THREE.Vector3(...target));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function projectPoint(
  camera: THREE.PerspectiveCamera,
  point: Vec3,
): THREE.Vector3 {
  return new THREE.Vector3(...point).project(camera);
}

function projectedParticipant(
  camera: THREE.PerspectiveCamera,
  participant: DialogueParticipant,
): ProjectedParticipant {
  const points: THREE.Vector3[] = [];
  for (const x of [-CHARACTER_HALF_WIDTH, CHARACTER_HALF_WIDTH]) {
    for (const y of [0, CHARACTER_TOP]) {
      for (const z of [-CHARACTER_HALF_DEPTH, CHARACTER_HALF_DEPTH]) {
        points.push(
          projectPoint(camera, [
            participant.position[0] + x,
            y,
            participant.position[2] + z,
          ]),
        );
      }
    }
  }
  const inFront = points.filter((point) => point.z >= -1 && point.z <= 1);
  if (inFront.length === 0) {
    return {
      slot: participant.slot,
      areaRatio: 0,
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    };
  }
  const minX = Math.min(...inFront.map((point) => point.x));
  const maxX = Math.max(...inFront.map((point) => point.x));
  const minY = Math.min(...inFront.map((point) => point.y));
  const maxY = Math.max(...inFront.map((point) => point.y));
  const clippedWidth = Math.max(0, Math.min(1, maxX) - Math.max(-1, minX));
  const clippedHeight = Math.max(0, Math.min(1, maxY) - Math.max(-1, minY));
  return {
    slot: participant.slot,
    areaRatio: (clippedWidth * clippedHeight) / 4,
    bounds: { minX, maxX, minY, maxY },
  };
}

function measureShotSize(
  camera: THREE.PerspectiveCamera,
  subject: DialogueParticipant,
): ShotSize {
  const landmarkY = {
    feet: 0,
    knees: 0.4,
    waist: 0.7,
    chest: 1.02,
    shoulders: 1.32,
  };
  const projectedY = (height: number) =>
    projectPoint(camera, [
      subject.position[0],
      height,
      subject.position[2],
    ]).y;
  if (projectedY(landmarkY.feet) >= -0.94) {
    return "full";
  }
  if (projectedY(landmarkY.knees) >= -0.94) {
    return "medium-full";
  }
  if (projectedY(landmarkY.waist) >= -0.94) {
    return "medium";
  }
  if (projectedY(landmarkY.chest) >= -0.94) {
    return "medium-close-up";
  }
  if (projectedY(landmarkY.shoulders) >= -0.94) {
    return "close-up";
  }
  return "extreme-close-up";
}

export function horizontalViewDelta(
  left: CameraGeometry,
  right: CameraGeometry,
): number {
  const leftView = normalize({
    x: left.target[0] - left.position[0],
    z: left.target[2] - left.position[2],
  });
  const rightView = normalize({
    x: right.target[0] - right.position[0],
    z: right.target[2] - right.position[2],
  });
  return THREE.MathUtils.radToDeg(
    Math.acos(THREE.MathUtils.clamp(dot(leftView, rightView), -1, 1)),
  );
}

export function assessProjection(
  geometry: CameraGeometry,
  subject: DialogueParticipant,
  participants: DialogueParticipant[],
  lensMm: number,
  expectedShotSize: ShotSize,
  coverage: ShotCoverage,
): ProjectionAssessment {
  const camera = cameraFor(geometry.position, geometry.target, lensMm);
  const projected = participants.map((participant) =>
    projectedParticipant(camera, participant),
  );
  const visibleParticipantSlots = projected
    .filter((participant) => participant.areaRatio >= SIGNIFICANT_ACTOR_AREA)
    .map((participant) => participant.slot);
  const subjectDistance = Math.hypot(
    geometry.position[0] - subject.position[0],
    geometry.position[1] - 1.1,
    geometry.position[2] - subject.position[2],
  );
  const participantBySlot = new Map(
    participants.map((participant) => [participant.slot, participant]),
  );
  const foregroundParticipantSlots = visibleParticipantSlots.filter((slot) => {
    if (slot === subject.slot) {
      return false;
    }
    const participant = participantBySlot.get(slot);
    if (!participant) {
      return false;
    }
    const distance = Math.hypot(
      geometry.position[0] - participant.position[0],
      geometry.position[1] - 1.1,
      geometry.position[2] - participant.position[2],
    );
    return distance < subjectDistance - 0.15;
  });
  const participantAreaRatios = Object.fromEntries(
    projected.map((participant) => [
      participant.slot,
      Number(participant.areaRatio.toFixed(4)),
    ]),
  ) as Partial<Record<ParticipantSlot, number>>;
  const measuredShotSize = measureShotSize(camera, subject);
  const facing = subjectFacing(subject, participants);
  const cameraDirection = normalize({
    x: geometry.position[0] - subject.position[0],
    z: geometry.position[2] - subject.position[2],
  });
  const subjectFaceAngle = THREE.MathUtils.radToDeg(
    Math.acos(THREE.MathUtils.clamp(dot(facing, cameraDirection), -1, 1)),
  );
  const eyes = projectPoint(camera, [
    subject.position[0],
    1.74,
    subject.position[2],
  ]);
  const chin = projectPoint(camera, [
    subject.position[0],
    1.43,
    subject.position[2],
  ]);
  const subjectSafeForUltrawide =
    Math.abs(eyes.x) <= 0.9 &&
    Math.abs(chin.x) <= 0.9 &&
    Math.abs(eyes.y) <= ULTRAWIDE_SAFE_Y &&
    Math.abs(chin.y) <= ULTRAWIDE_SAFE_Y;
  const warnings: string[] = [];

  if (measuredShotSize !== expectedShotSize) {
    warnings.push(
      `实测景别 ${measuredShotSize} 与目标景别 ${expectedShotSize} 不一致`,
    );
  }
  if (!visibleParticipantSlots.includes(subject.slot)) {
    warnings.push(`主体 ${subject.slot} 未形成有效画面面积`);
  }
  if (
    coverage === "single" &&
    visibleParticipantSlots.some((slot) => slot !== subject.slot)
  ) {
    warnings.push("单人镜头包含其他主要可见角色");
  }
  if (coverage === "two-shot" && visibleParticipantSlots.length !== 2) {
    warnings.push("双人镜头的主要可见角色数量不是 2");
  }
  if (coverage === "group" && visibleParticipantSlots.length < participants.length) {
    warnings.push("群像建立镜头未覆盖全部在场角色");
  }
  if (coverage === "group-medium" && visibleParticipantSlots.length < 2) {
    warnings.push("带群中景未保留关系角色");
  }
  if (coverage === "single" && subjectFaceAngle > 45.1) {
    warnings.push(`单人镜头偏离角色正面 ${subjectFaceAngle.toFixed(1)}°`);
  }
  if (!subjectSafeForUltrawide) {
    warnings.push("主体眼部或下巴超出 21:9 安全区域");
  }

  return {
    measuredShotSize,
    visibleParticipantSlots,
    foregroundParticipantSlots,
    participantAreaRatios,
    subjectFaceAngle: Number(subjectFaceAngle.toFixed(1)),
    subjectSafeForUltrawide,
    valid: warnings.length === 0,
    warnings,
  };
}

function distanceForShotSize(lensMm: number, shotSize: ShotSize): number {
  const frame = SHOT_FRAMES[shotSize];
  const filmHeight = 35 / CAMERA_ASPECT_RATIO;
  const halfVerticalFov = Math.atan(filmHeight / (2 * lensMm));
  return (
    (CHARACTER_TOP - frame.bottom) /
    (frame.desiredNdcSpan * Math.tan(halfVerticalFov))
  );
}

function targetForScreenPosition(
  subject: DialogueParticipant,
  cameraDirection: Vec2,
  distance: number,
  lensMm: number,
  targetY: number,
  screenPosition: DirectorDecision["screen_position"],
): Vec3 {
  const desiredSubjectNdc =
    screenPosition === "left_third"
      ? -0.32
      : screenPosition === "right_third"
        ? 0.32
        : 0;
  const filmHeight = 35 / CAMERA_ASPECT_RATIO;
  const halfVerticalFov = Math.atan(filmHeight / (2 * lensMm));
  const halfHorizontalWidth =
    distance * Math.tan(halfVerticalFov) * CAMERA_ASPECT_RATIO;
  const cameraRight = normalize({
    x: cameraDirection.z,
    z: -cameraDirection.x,
  });
  const targetOffset = -desiredSubjectNdc * halfHorizontalWidth;
  return [
    subject.position[0] + cameraRight.x * targetOffset,
    targetY,
    subject.position[2] + cameraRight.z * targetOffset,
  ];
}

export function solveSingleCamera(
  request: SingleCameraRequest,
): {
  geometry: CameraGeometry;
  assessment: ProjectionAssessment;
} {
  const preferredAngle = request.preferredFaceAngle ?? 28;
  const angleCandidates = [...new Set([preferredAngle, 18, 38, 8, 45])];
  const distanceScales = [1, 0.94, 1.06, 0.86, 1.16, 1.28];
  const oppositeScreenPosition: DirectorDecision["screen_position"] =
    request.screenPosition === "left_third"
      ? "right_third"
      : request.screenPosition === "right_third"
        ? "left_third"
        : "center";
  const screenPositionCandidates = (
    [
      request.screenPosition,
      oppositeScreenPosition,
      "center",
    ] as DirectorDecision["screen_position"][]
  ).filter((position, index, values) => values.indexOf(position) === index);
  const frame = SHOT_FRAMES[request.shotSize];
  const baseDistance = distanceForShotSize(request.lensMm, request.shotSize);
  let best:
    | {
        geometry: CameraGeometry;
        assessment: ProjectionAssessment;
        score: number;
      }
    | undefined;

  for (const faceAngle of angleCandidates) {
    const cameraDirection = cameraDirectionForSubject(
      request.subject,
      request.participants,
      faceAngle,
    );
    for (const distanceScale of distanceScales) {
      for (const screenPosition of screenPositionCandidates) {
        const distance = baseDistance * distanceScale;
        const position: Vec3 = [
          request.subject.position[0] + cameraDirection.x * distance,
          request.cameraHeight,
          request.subject.position[2] + cameraDirection.z * distance,
        ];
        const target = targetForScreenPosition(
          request.subject,
          cameraDirection,
          distance,
          request.lensMm,
          frame.targetY,
          screenPosition,
        );
        const geometry = { position, target };
        const assessment = assessProjection(
          geometry,
          request.subject,
          request.participants,
          request.lensMm,
          request.shotSize,
          request.coverage,
        );
        const otherVisibleCount = assessment.visibleParticipantSlots.filter(
          (slot) => slot !== request.subject.slot,
        ).length;
        const sizeDelta = Math.abs(
          SHOT_SIZE_INDEX[assessment.measuredShotSize] -
            SHOT_SIZE_INDEX[request.shotSize],
        );
        const viewDelta = request.previousGeometry
          ? horizontalViewDelta(request.previousGeometry, geometry)
          : 90;
        const score =
          sizeDelta * 500 +
          (request.coverage === "single" ? otherVisibleCount * 800 : 0) +
          (request.coverage === "group-medium" &&
          assessment.visibleParticipantSlots.length < 2
            ? 800
            : 0) +
          (!assessment.visibleParticipantSlots.includes(request.subject.slot)
            ? 1_000
            : 0) +
          (!assessment.subjectSafeForUltrawide ? 180 : 0) +
          Math.max(0, assessment.subjectFaceAngle - 45) * 20 +
          Math.max(0, 30 - viewDelta) * 4 +
          Math.abs(faceAngle - preferredAngle) +
          Math.abs(distanceScale - 1) * 12 +
          (screenPosition === request.screenPosition ? 0 : 24);
        if (!best || score < best.score) {
          best = { geometry, assessment, score };
        }
      }
    }
  }

  if (!best) {
    throw new Error(`无法为角色 ${request.subject.slot} 求解摄影机`);
  }
  return best;
}

export function solveGroupCamera(
  request: GroupCameraRequest,
): CameraGeometry {
  const center = sceneCenter(request.participants);
  const side = sceneCameraSide(request.participants);
  const frame = SHOT_FRAMES[request.shotSize];
  const verticalDistance = distanceForShotSize(
    request.lensMm,
    request.shotSize,
  );
  const axisDirection = { x: side.z, z: -side.x };
  const halfWidth =
    Math.max(
      ...request.participants.map((participant) =>
        Math.abs(
          dot(
            {
              x: participant.position[0] - center[0],
              z: participant.position[2] - center[2],
            },
            axisDirection,
          ),
        ),
      ),
    ) + CHARACTER_HALF_WIDTH;
  const filmHeight = 35 / CAMERA_ASPECT_RATIO;
  const halfVerticalFov = Math.atan(filmHeight / (2 * request.lensMm));
  const halfHorizontalFov = Math.atan(
    Math.tan(halfVerticalFov) * CAMERA_ASPECT_RATIO,
  );
  const horizontalDistance = halfWidth / (0.78 * Math.tan(halfHorizontalFov));
  const distance = Math.max(verticalDistance, horizontalDistance) * 1.08;
  return {
    position: [
      center[0] + side.x * distance,
      request.cameraHeight,
      center[2] + side.z * distance,
    ],
    target: [center[0], frame.targetY, center[2]],
  };
}
