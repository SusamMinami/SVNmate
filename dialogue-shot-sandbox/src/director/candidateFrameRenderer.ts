import * as THREE from "three";
import {
  characterBody,
  characterProxyScales,
} from "./characterGeometry";
import type {
  DialogueParticipant,
  ShotPlan,
} from "../types";
import type { RuleCameraCandidateSet } from "./shotCandidateGenerator";

export interface RuleCandidateFrame {
  candidate_id: string;
  candidate_label: string;
  shot_index: number;
  dialogue_ids: string[];
  is_baseline: boolean;
  legal: boolean;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    focal_length: number;
    shot_size: ShotPlan["projection"]["measuredShotSize"];
    coverage: ShotPlan["projection"]["coverage"];
    visual_anchor: readonly [number, number];
    headroom: number | null;
    look_room: number | null;
    projection_issues: string[];
  };
  image_data_url: string;
}

export interface RuleCandidateVisualSet {
  candidate_frames: RuleCandidateFrame[];
}

const FRAME_WIDTH = 512;
const FRAME_HEIGHT = 288;

function addCharacter(
  scene: THREE.Scene,
  participant: DialogueParticipant,
  facingTarget: readonly [number, number, number] | undefined,
): THREE.Group {
  const body = characterBody(participant);
  const { bodyScale, headCorrection } = characterProxyScales(body);
  const effectiveFacingTarget = facingTarget ?? participant.facingTarget;
  const root = new THREE.Group();
  root.position.set(...participant.position);
  root.rotation.y = Math.atan2(
    effectiveFacingTarget[0] - participant.position[0],
    effectiveFacingTarget[2] - participant.position[2],
  );

  const scaled = new THREE.Group();
  scaled.position.set(...body.footOffset);
  scaled.scale.set(...bodyScale);
  root.add(scaled);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: participant.color,
    roughness: 0.72,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: "#353c46",
    roughness: 0.8,
  });
  const skinMaterial = new THREE.MeshStandardMaterial({
    color: "#f1c9b4",
    roughness: 0.8,
  });
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.86, 5, 12),
    bodyMaterial,
  );
  torso.position.y = 0.92;
  scaled.add(torso);
  const headGroup = new THREE.Group();
  headGroup.position.y = 1.72;
  headGroup.scale.set(...headCorrection);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.29, 20, 16),
    skinMaterial,
  );
  headGroup.add(head);
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.16, 12),
    darkMaterial,
  );
  nose.position.set(0, -0.02, 0.27);
  nose.rotation.x = Math.PI / 2;
  headGroup.add(nose);
  scaled.add(headGroup);
  for (const x of [-0.14, 0.14]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 0.5, 12),
      darkMaterial,
    );
    leg.position.set(x, 0.25, 0);
    scaled.add(leg);
  }
  scene.add(root);
  return root;
}

function drawFrameOverlay(
  output: HTMLCanvasElement,
  source: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  shot: ShotPlan,
  participants: DialogueParticipant[],
  shotIndex: number,
): void {
  const context = output.getContext("2d");
  if (!context) return;
  context.drawImage(source, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  context.strokeStyle = "rgba(255,255,255,0.72)";
  context.lineWidth = 1;
  const ultrawideHeight = FRAME_WIDTH * 9 / 21;
  const bar = (FRAME_HEIGHT - ultrawideHeight) / 2;
  context.strokeRect(0.5, bar + 0.5, FRAME_WIDTH - 1, ultrawideHeight - 1);
  context.fillStyle = "rgba(15,18,20,0.76)";
  context.fillRect(0, 0, FRAME_WIDTH, 24);
  context.fillStyle = "#ffffff";
  context.font = "600 12px 'Microsoft YaHei UI', sans-serif";
  context.fillText(
    `SHOT ${String(shotIndex + 1).padStart(2, "0")}  ${shot.label}  ${shot.focalLength}mm`,
    10,
    16,
  );

  for (const participant of participants) {
    const body = characterBody(participant);
    const point = new THREE.Vector3(
      participant.position[0] + body.footOffset[0],
      participant.position[1] + body.footOffset[1] + body.height * 0.82,
      participant.position[2] + body.footOffset[2],
    ).project(camera);
    if (point.z < -1 || point.z > 1) continue;
    const x = (point.x + 1) * 0.5 * FRAME_WIDTH;
    const y = (1 - point.y) * 0.5 * FRAME_HEIGHT;
    const label = `${participant.slot} ${participant.name}`;
    context.font = "600 11px 'Microsoft YaHei UI', sans-serif";
    const width = context.measureText(label).width + 12;
    context.fillStyle = "rgba(15,18,20,0.82)";
    context.fillRect(x - width / 2, y - 10, width, 19);
    context.fillStyle = participant.color;
    context.fillRect(x - width / 2, y - 10, 3, 19);
    context.fillStyle = "#ffffff";
    context.fillText(label, x - width / 2 + 7, y + 3);
  }
}

function createFrameRenderer(participants: DialogueParticipant[]) {
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_WIDTH;
  canvas.height = FRAME_HEIGHT;
  const output = document.createElement("canvas");
  output.width = FRAME_WIDTH;
  output.height = FRAME_HEIGHT;
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });

  function dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.width = canvas.height = output.width = output.height = 0;
  }

  try {
    renderer.setSize(FRAME_WIDTH, FRAME_HEIGHT, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene.background = new THREE.Color("#cfd5da");
    scene.fog = new THREE.Fog("#cfd5da", 8, 17);
    scene.add(new THREE.AmbientLight("#ffffff", 1.3));
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.4);
    keyLight.position.set(3, 7, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight("#9bc7ff", 0.8);
    fillLight.position.set(-4, 3, -2);
    scene.add(fillLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 12),
      new THREE.MeshStandardMaterial({ color: "#dfe3e7" }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(16, 32, "#8b949f", "#aeb6bf");
    grid.position.y = 0.002;
    scene.add(grid);

    const characters = participants.map((participant) => ({
      participant,
      root: addCharacter(scene, participant, undefined),
    }));

    const camera = new THREE.PerspectiveCamera(
      42,
      FRAME_WIDTH / FRAME_HEIGHT,
      0.1,
      100,
    );
    const target = new THREE.Vector3();
    return {
      render(shot: ShotPlan, shotIndex: number): string {
        const presentParticipants: DialogueParticipant[] = [];
        for (const { participant, root } of characters) {
          root.visible =
            participant.entryIndex <= shot.dialogueEndIndex &&
            (participant.exitIndex === null ||
              participant.exitIndex >= shot.dialogueEndIndex);
          const facing = shot.facingOverrides[participant.slot] ?? participant.facingTarget;
          root.rotation.y = Math.atan2(
            facing[0] - participant.position[0],
            facing[2] - participant.position[2],
          );
          if (root.visible) presentParticipants.push(participant);
        }
        camera.position.set(...shot.cameraPosition);
        camera.setFocalLength(shot.focalLength);
        camera.lookAt(target.set(...shot.cameraTarget));
        camera.rotateZ(THREE.MathUtils.degToRad(shot.cameraRollDegrees));
        camera.updateMatrixWorld();
        renderer.render(scene, camera);
        drawFrameOverlay(output, canvas, camera, shot, presentParticipants, shotIndex);
        return output.toDataURL("image/jpeg", 0.78);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function renderRuleCandidateFrames(
  participants: DialogueParticipant[],
  candidateSets: RuleCameraCandidateSet[],
): RuleCandidateVisualSet | null {
  if (typeof document === "undefined") {
    return null;
  }
  const frames: RuleCandidateFrame[] = [];
  if (candidateSets.length === 0) return { candidate_frames: frames };
  let frameRenderer: ReturnType<typeof createFrameRenderer> | undefined;
  try {
    frameRenderer = createFrameRenderer(participants);
    for (const candidateSet of candidateSets) {
      const shotFrames = candidateSet.candidates.flatMap((candidate) => {
        try {
          const { shot } = candidate;
          return [
            {
              candidate_id: candidate.candidateId,
              candidate_label: candidate.label,
              shot_index: candidate.shotIndex,
              dialogue_ids: [...candidateSet.dialogueIds],
              is_baseline: candidate.isBaseline,
              legal: candidate.legal,
              camera: {
                position: [...shot.cameraPosition] as [
                  number,
                  number,
                  number,
                ],
                target: [...shot.cameraTarget] as [
                  number,
                  number,
                  number,
                ],
                focal_length: shot.focalLength,
                shot_size: shot.projection.measuredShotSize,
                coverage: shot.projection.coverage,
                visual_anchor: shot.projection.visualAnchor,
                headroom: shot.projection.headroom,
                look_room: shot.projection.lookRoom,
                projection_issues: shot.projection.issues
                  ?.filter((issue) => issue.severity !== "info")
                  .map((issue) => issue.message) ?? [],
              },
              image_data_url: frameRenderer!.render(shot, candidate.shotIndex),
            },
          ];
        } catch {
          return [];
        }
      });
      if (shotFrames.length === 0) {
        return null;
      }
      frames.push(...shotFrames);
    }
    return {
      candidate_frames: frames,
    };
  } catch {
    return null;
  } finally {
    frameRenderer?.dispose();
  }
}
