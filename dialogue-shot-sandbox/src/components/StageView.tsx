import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Grid,
  Html,
  Line,
} from "@react-three/drei";
import { Camera, Map } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type {
  DialogueParticipant,
  ShotPlan,
  Vec3,
} from "../types";

interface StageViewProps {
  participants: DialogueParticipant[];
  shot: ShotPlan;
}

interface CharacterProps {
  participant: DialogueParticipant;
  compact?: boolean;
  slotOnly?: boolean;
  labelPlacement?: "body" | "below";
  showDirectionIndicator?: boolean;
}

function DirectionIndicator({ color }: { color: string }) {
  return (
    <group position={[0, 2.16, 0.02]}>
      <mesh
        position={[0, 0, 0.18]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry args={[0.045, 0.045, 0.34, 10]} />
        <meshBasicMaterial color="#202830" />
      </mesh>
      <mesh
        position={[0, 0, 0.43]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <coneGeometry args={[0.13, 0.25, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, -0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.13, 0.18, 24]} />
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Character({
  participant,
  compact = false,
  slotOnly = false,
  labelPlacement = "body",
  showDirectionIndicator = true,
}: CharacterProps) {
  const facingCenter = Math.atan2(
    participant.facingTarget[0] - participant.position[0],
    participant.facingTarget[2] - participant.position[2],
  );
  return (
    <group position={participant.position}>
      <group rotation={[0, facingCenter, 0]}>
        <mesh position={[0, 0.92, 0]} castShadow>
          <capsuleGeometry args={[0.3, 0.86, 5, 12]} />
          <meshStandardMaterial color={participant.color} roughness={0.72} />
        </mesh>
        <mesh position={[0, 1.72, 0]} castShadow>
          <sphereGeometry args={[0.29, 20, 16]} />
          <meshStandardMaterial color="#f1c9b4" roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.7, 0.27]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.055, 0.16, 12]} />
          <meshStandardMaterial color="#20262e" />
        </mesh>
        <mesh position={[-0.14, 0.25, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.12, 0.5, 12]} />
          <meshStandardMaterial color="#353c46" />
        </mesh>
        <mesh position={[0.14, 0.25, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.12, 0.5, 12]} />
          <meshStandardMaterial color="#353c46" />
        </mesh>
        <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.38, 0.45, 32]} />
          <meshBasicMaterial color={participant.color} side={THREE.DoubleSide} />
        </mesh>
        {showDirectionIndicator && (
          <DirectionIndicator color={participant.color} />
        )}
      </group>
      <Html
        center
        position={
          labelPlacement === "below"
            ? [0, 0.12, 0.82]
            : [0, compact ? 1.12 : 1.18, 0]
        }
        zIndexRange={[20, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          className={[
            "actor-label",
            "actor-label--on-body",
            labelPlacement === "below" ? "actor-label--below" : "",
            compact ? "actor-label--compact" : "",
            slotOnly ? "actor-label--slot-only" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ borderColor: participant.color }}
          title={`${participant.slot} ${participant.name} NPC ${participant.id}`}
        >
          <strong style={{ backgroundColor: participant.color }}>
            {participant.slot}
          </strong>
          {!slotOnly && (
            <>
              <span>{participant.name}</span>
              <small>{participant.id}</small>
            </>
          )}
        </div>
      </Html>
    </group>
  );
}

function StudioLighting() {
  return (
    <>
      <ambientLight intensity={1.3} />
      <directionalLight
        castShadow
        intensity={2.4}
        position={[3, 7, 5]}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight intensity={0.8} color="#9bc7ff" position={[-4, 3, -2]} />
    </>
  );
}

function StageFloor({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[compact ? 9 : 16, compact ? 7 : 12]} />
        <meshStandardMaterial color={compact ? "#f5f6f7" : "#dfe3e7"} />
      </mesh>
      <Grid
        args={[compact ? 9 : 16, compact ? 7 : 12]}
        cellSize={0.5}
        cellThickness={0.45}
        cellColor="#aeb6bf"
        sectionSize={2}
        sectionThickness={0.8}
        sectionColor="#8b949f"
        fadeDistance={compact ? 10 : 14}
        fadeStrength={1}
        infiniteGrid={false}
      />
    </>
  );
}

function ShotCamera({ shot }: { shot: ShotPlan }) {
  const { camera } = useThree();
  const targetPosition = useMemo(
    () => new THREE.Vector3(...shot.cameraPosition),
    [shot.cameraPosition],
  );
  const lookAt = useMemo(
    () => new THREE.Vector3(...shot.cameraTarget),
    [shot.cameraTarget],
  );

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.setFocalLength(shot.focalLength);
      camera.near = 0.1;
      camera.far = 100;
      camera.updateProjectionMatrix();
    }
  }, [camera, shot.focalLength]);

  useFrame(() => {
    camera.position.lerp(targetPosition, 0.13);
    camera.lookAt(lookAt);
  });
  return null;
}

function MainStage({
  participants,
  shot,
  inset = false,
}: {
  participants: DialogueParticipant[];
  shot: ShotPlan;
  inset?: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#cfd5da"]} />
      <fog attach="fog" args={["#cfd5da", 8, 17]} />
      <ShotCamera shot={shot} />
      <StudioLighting />
      <StageFloor />
      {participants.map((participant) => (
        <Character
          key={participant.id}
          participant={participant}
          compact={inset || participants.length > 6}
          slotOnly={inset && participants.length > 3}
          showDirectionIndicator={false}
        />
      ))}
      <ContactShadows
        opacity={0.38}
        scale={8}
        blur={2.4}
        far={4}
        position={[0, 0.01, 0]}
      />
    </>
  );
}

function diagramCameraPosition(
  shot: ShotPlan,
  participants: DialogueParticipant[],
): THREE.Vector2 {
  const camera = new THREE.Vector2(
    shot.cameraPosition[0],
    shot.cameraPosition[2],
  );
  const target = new THREE.Vector2(
    shot.cameraTarget[0],
    shot.cameraTarget[2],
  );
  const xs = participants.map((participant) => participant.position[0]);
  const participantSpan = Math.max(...xs) - Math.min(...xs);
  const maximumDistance = Math.max(
    4.2,
    Math.min(5.4, participantSpan * 0.55 + 2.8),
  );
  const offset = camera.clone().sub(target);
  if (offset.length() <= maximumDistance) {
    return camera;
  }
  return target.add(offset.normalize().multiplyScalar(maximumDistance));
}

function CameraDiagram({
  shot,
  participants,
}: {
  shot: ShotPlan;
  participants: DialogueParticipant[];
}) {
  const displayCamera = diagramCameraPosition(shot, participants);
  const cameraX = displayCamera.x;
  const cameraZ = displayCamera.y;
  const [targetX, , targetZ] = shot.cameraTarget;
  const geometry = useMemo(() => {
    const camera = new THREE.Vector2(cameraX, cameraZ);
    const target = new THREE.Vector2(targetX, targetZ);
    const direction = target.clone().sub(camera).normalize();
    const perpendicular = new THREE.Vector2(-direction.y, direction.x);
    const end = target.clone().add(direction.multiplyScalar(0.9));
    const left = end.clone().add(perpendicular.clone().multiplyScalar(1.15));
    const right = end.clone().add(perpendicular.multiplyScalar(-1.15));
    return {
      angle: Math.atan2(targetX - cameraX, targetZ - cameraZ),
      left: [left.x, 0.05, left.y] as Vec3,
      right: [right.x, 0.05, right.y] as Vec3,
    };
  }, [cameraX, cameraZ, targetX, targetZ]);

  return (
    <>
      <Line
        points={[
          [cameraX, 0.05, cameraZ],
          geometry.left,
          geometry.right,
          [cameraX, 0.05, cameraZ],
        ]}
        color="#2f96e8"
        lineWidth={1.5}
        transparent
        opacity={0.72}
      />
      <group
        position={[cameraX, 0.12, cameraZ]}
        rotation={[0, geometry.angle, 0]}
      >
        <mesh>
          <boxGeometry args={[0.36, 0.2, 0.26]} />
          <meshBasicMaterial color="#1f2730" />
        </mesh>
        <mesh position={[0, 0, -0.22]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.16, 0.25, 4]} />
          <meshBasicMaterial color="#1f2730" />
        </mesh>
      </group>
    </>
  );
}

function TopCamera({
  participants,
  shot,
}: {
  participants: DialogueParticipant[];
  shot: ShotPlan;
}) {
  const { camera, size } = useThree();
  const frame = useMemo(() => {
    const displayCamera = diagramCameraPosition(shot, participants);
    const points = [
      ...participants.map((participant) => [
        participant.position[0],
        participant.position[2],
      ]),
      [displayCamera.x, displayCamera.y],
      [shot.cameraTarget[0], shot.cameraTarget[2]],
      [shot.axis.start[0], shot.axis.start[2]],
      [shot.axis.end[0], shot.axis.end[2]],
    ];
    const xs = points.map((point) => point[0]);
    const zs = points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    return {
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      worldWidth: Math.max(8, maxX - minX + 2.4),
      worldDepth: Math.max(6, maxZ - minZ + 2.2),
    };
  }, [
    participants,
    shot.axis.end,
    shot.axis.start,
    shot.cameraPosition,
    shot.cameraTarget,
  ]);
  useFrame(() => {
    const targetZoom = Math.max(
      12,
      Math.min(
        size.width / frame.worldWidth,
        size.height / frame.worldDepth,
      ),
    );
    camera.position.set(frame.centerX, 10, frame.centerZ);
    camera.up.set(0, 0, -1);
    camera.lookAt(frame.centerX, 0, frame.centerZ);
    camera.updateMatrixWorld();
    if (
      camera instanceof THREE.OrthographicCamera &&
      camera.zoom !== targetZoom
    ) {
      camera.zoom = targetZoom;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

function TopStage({
  participants,
  shot,
  inset = false,
}: {
  participants: DialogueParticipant[];
  shot: ShotPlan;
  inset?: boolean;
}) {
  return (
    <>
      <color attach="background" args={["#eef0f2"]} />
      <TopCamera participants={participants} shot={shot} />
      <ambientLight intensity={2} />
      <StageFloor compact />
      <Line
        points={[shot.axis.start, shot.axis.end]}
        color="#dc5c45"
        lineWidth={2}
        dashed
        dashSize={0.18}
        gapSize={0.12}
      />
      {participants.map((participant) => (
        <Character
          key={participant.id}
          participant={participant}
          compact={inset}
          labelPlacement="below"
        />
      ))}
      <CameraDiagram shot={shot} participants={participants} />
    </>
  );
}

function CameraFrameGuides({
  shot,
  compact = false,
}: {
  shot: ShotPlan;
  compact?: boolean;
}) {
  const showThirds = [
    "rule_of_thirds",
    "asymmetrical_balance",
    "negative_space",
  ].includes(shot.compositionPlan.mode);
  const showGolden = shot.compositionPlan.mode === "golden_ratio";
  const showCenter = ["center", "symmetry"].includes(
    shot.compositionPlan.mode,
  );
  const showTriangle = shot.compositionPlan.mode === "triangular";
  return (
    <>
      {!compact && (
        <div
          className={`composition-overlay composition-overlay--${shot.compositionPlan.mode}`}
          aria-hidden="true"
        >
          {showThirds && (
            <>
              <i className="third third--v1" />
              <i className="third third--v2" />
              <i className="third third--h1" />
              <i className="third third--h2" />
            </>
          )}
          {showGolden && (
            <>
              <i className="golden golden--v1" />
              <i className="golden golden--v2" />
              <i className="golden golden--h1" />
              <i className="golden golden--h2" />
            </>
          )}
          {showCenter && <i className="center-axis" />}
          {showTriangle && (
            <>
              <i className="triangle-guide triangle-guide--left" />
              <i className="triangle-guide triangle-guide--right" />
            </>
          )}
          <i className="safe-frame" />
        </div>
      )}
      <div
        className={`ultrawide-frame ${compact ? "ultrawide-frame--compact" : ""}`}
        aria-hidden="true"
      >
        <i className="ultrawide-frame__top" />
        <i className="ultrawide-frame__bottom" />
        <span>21:9</span>
      </div>
    </>
  );
}

export function StageView({ participants, shot }: StageViewProps) {
  const [viewMode, setViewMode] = useState<"shot" | "blocking">("shot");
  const showingShot = viewMode === "shot";
  const visibleParticipants = useMemo(
    () =>
      participants.filter(
        (participant) =>
          participant.entryIndex <= shot.dialogueEndIndex &&
          (participant.exitIndex === null ||
            participant.exitIndex >= shot.dialogueEndIndex),
      ),
    [participants, shot.dialogueEndIndex],
  );
  const stagedParticipants = useMemo(
    () =>
      visibleParticipants.map((participant) => {
        const facingTarget = shot.facingOverrides[participant.slot];
        return facingTarget ? { ...participant, facingTarget } : participant;
      }),
    [visibleParticipants, shot.facingOverrides],
  );

  return (
    <div className={`stage-view stage-view--${viewMode}`}>
      <div className="stage-main">
        <div
          className={`stage-main__frame ${
            showingShot ? "" : "stage-main__frame--blocking"
          }`}
        >
          {showingShot ? (
            <Canvas
              key="shot-main"
              shadows
              dpr={[1, 1.6]}
              camera={{ position: [...shot.cameraPosition], fov: 42 }}
              gl={{ antialias: true }}
            >
              <MainStage participants={stagedParticipants} shot={shot} />
            </Canvas>
          ) : (
            <Canvas
              key="blocking-main"
              orthographic
              camera={{ position: [0, 10, 0], zoom: 24, near: 0.1, far: 40 }}
              dpr={[1, 1.5]}
              gl={{ antialias: true }}
            >
              <TopStage participants={stagedParticipants} shot={shot} />
            </Canvas>
          )}

          {showingShot && <CameraFrameGuides shot={shot} />}

          <div className="shot-hud">
            <span>{showingShot ? shot.label : "俯视调度"}</span>
            <strong>
              {showingShot
                ? `${shot.focalLength} mm`
                : `${stagedParticipants.length} 人站位`}
            </strong>
          </div>
        </div>
      </div>

      <button
        className="top-view"
        type="button"
        aria-label={
          showingShot ? "切换到俯视调度" : "切换到镜头示意"
        }
        onClick={() =>
          setViewMode((current) =>
            current === "shot" ? "blocking" : "shot",
          )
        }
      >
        <header>
          <span>
            {showingShot ? <Map size={12} /> : <Camera size={12} />}
            {showingShot ? "俯视调度" : "镜头示意"}
          </span>
          <small>点击切换</small>
        </header>
        <div className="top-view__canvas">
          {showingShot ? (
            <Canvas
              key="blocking-inset"
              orthographic
              camera={{ position: [0, 10, 0], zoom: 24, near: 0.1, far: 40 }}
              dpr={[1, 1.5]}
              gl={{ antialias: true }}
            >
              <TopStage
                participants={stagedParticipants}
                shot={shot}
                inset
              />
            </Canvas>
          ) : (
            <Canvas
              key="shot-inset"
              shadows
              dpr={[1, 1.4]}
              camera={{ position: [...shot.cameraPosition], fov: 42 }}
              gl={{ antialias: true }}
            >
              <MainStage
                participants={stagedParticipants}
                shot={shot}
                inset
              />
            </Canvas>
          )}
          {!showingShot && <CameraFrameGuides shot={shot} compact />}
        </div>
      </button>
    </div>
  );
}
