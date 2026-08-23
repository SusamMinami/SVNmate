import * as THREE from "three";
import type {
  DialogueParticipant,
  DialogueSequence,
  ShotAxis,
  ShotComposition,
  ShotCoverage,
  ShotKind,
  ShotPlan,
  ShotSize,
  Vec3,
} from "../types";
import type { DirectorDecision } from "./contracts";
import {
  assessProjection,
  horizontalViewDelta,
  solveGroupCamera,
  solveSingleCamera,
  type CameraGeometry,
  type ProjectionAssessment,
} from "./shotGeometry";
import { estimateShotDuration } from "./shotTiming";

function cameraHeight(
  value: DirectorDecision["camera_height"],
  fallback: number,
): number {
  if (value === "low") {
    return 0.95;
  }
  if (value === "high") {
    return 2.45;
  }
  return fallback;
}

interface Geometry {
  kind: ShotKind;
  label: string;
  position: Vec3;
  target: Vec3;
  composition: string;
  compositionPlan: ShotComposition;
  shotSize: ShotSize;
  coverage: ShotCoverage;
  assessment: ProjectionAssessment;
}

interface MotionGeometry {
  endPosition: Vec3;
  endTarget: Vec3;
}

function movementAmount(
  intensity: DirectorDecision["movement_intensity"],
): number {
  if (intensity === "strong") {
    return 1.35;
  }
  if (intensity === "moderate") {
    return 0.9;
  }
  if (intensity === "subtle") {
    return 0.45;
  }
  return 0;
}

function resolveMotionGeometry(
  decision: DirectorDecision,
  geometry: Geometry,
  subject: DialogueParticipant,
  lookTarget: DialogueParticipant | null,
): MotionGeometry {
  const position = new THREE.Vector3(...geometry.position);
  const target = new THREE.Vector3(...geometry.target);
  const amount = movementAmount(decision.movement_intensity);

  if (decision.camera_movement === "pan") {
    const panTarget = lookTarget
      ? new THREE.Vector3(
          lookTarget.position[0],
          geometry.target[1],
          lookTarget.position[2],
        )
      : target
          .clone()
          .add(
            new THREE.Vector3(
              decision.visual_anchor.startsWith("left") ? 0.8 : -0.8,
              0,
              0,
            ),
          );
    const panFraction =
      decision.movement_intensity === "strong"
        ? 1
        : decision.movement_intensity === "moderate"
          ? 0.72
          : 0.45;
    return {
      endPosition: geometry.position,
      endTarget: target.lerp(panTarget, panFraction).toArray() as Vec3,
    };
  }

  if (decision.camera_movement === "tracking") {
    const destination = lookTarget?.position ?? subject.facingTarget;
    const travel = new THREE.Vector3(
      destination[0] - subject.position[0],
      0,
      destination[2] - subject.position[2],
    );
    if (travel.lengthSq() < 0.001) {
      travel.set(1, 0, 0);
    }
    travel.normalize().multiplyScalar(amount);
    return {
      endPosition: position.clone().add(travel).toArray() as Vec3,
      endTarget: geometry.target,
    };
  }

  if (
    decision.camera_movement === "dolly_zoom_in" ||
    decision.camera_movement === "dolly_zoom_out"
  ) {
    const endDistanceScale =
      decision.end_lens_mm / decision.lens_mm;
    return {
      endPosition: [
        target.x + (position.x - target.x) * endDistanceScale,
        position.y,
        target.z + (position.z - target.z) * endDistanceScale,
      ],
      endTarget: geometry.target,
    };
  }

  if (
    decision.camera_movement === "dolly_in" ||
    decision.camera_movement === "dolly_out"
  ) {
    const towardTarget = new THREE.Vector3(
      target.x - position.x,
      0,
      target.z - position.z,
    ).normalize();
    const signedAmount =
      decision.camera_movement === "dolly_in" ? amount : -amount;
    return {
      endPosition: position
        .clone()
        .add(towardTarget.multiplyScalar(signedAmount))
        .toArray() as Vec3,
      endTarget: geometry.target,
    };
  }

  return {
    endPosition: geometry.position,
    endTarget: geometry.target,
  };
}

function createShotAxis(
  participants: DialogueParticipant[],
  subject: DialogueParticipant,
  lookTarget: DialogueParticipant | null,
  cameraPosition: Vec3,
): ShotAxis {
  const isDirectionAxis = !lookTarget && participants.length === 1;
  const isTwoPersonAxis = !lookTarget && participants.length === 2;
  let pair: DialogueParticipant[];
  if (lookTarget) {
    pair = [subject, lookTarget].sort((left, right) =>
      left.slot.localeCompare(right.slot),
    );
  } else if (isDirectionAxis) {
    pair = [
      subject,
      {
        ...subject,
        position: subject.facingTarget,
      },
    ];
  } else if (isTwoPersonAxis) {
    pair = [...participants].sort((left, right) =>
      left.slot.localeCompare(right.slot),
    );
  } else {
    pair = [...participants].sort(
      (left, right) =>
        left.position[0] - right.position[0] ||
        left.position[2] - right.position[2],
    );
  }
  const first = pair[0];
  const last = pair.at(-1) ?? first;
  const dx = last.position[0] - first.position[0];
  const dz = last.position[2] - first.position[2];
  const length = Math.hypot(dx, dz) || 1;
  const unitX = dx / length;
  const unitZ = dz / length;
  const extension = 1.2;
  const start: Vec3 = [
    first.position[0] - unitX * extension,
    0.04,
    first.position[2] - unitZ * extension,
  ];
  const end: Vec3 = [
    last.position[0] + unitX * extension,
    0.04,
    last.position[2] + unitZ * extension,
  ];
  const sideValue =
    dx * (cameraPosition[2] - first.position[2]) -
    dz * (cameraPosition[0] - first.position[0]);
  return {
    id: lookTarget || isTwoPersonAxis
      ? `${first.slot}-${last.slot}`
      : isDirectionAxis
        ? `${subject.slot}-look`
        : "group",
    kind:
      lookTarget || isTwoPersonAxis
        ? "relationship"
        : isDirectionAxis
          ? "direction"
          : "group",
    participantSlots:
      lookTarget || isTwoPersonAxis
        ? [first.slot, last.slot]
        : isDirectionAxis
          ? [subject.slot]
          : participants.map((participant) => participant.slot),
    start,
    end,
    cameraSide: sideValue > 0.001 ? 1 : sideValue < -0.001 ? -1 : 0,
  };
}

function adjustedSingleLabel(
  template: DirectorDecision["template"],
  subjectLabel: string,
  coverage: ShotCoverage,
  formsReversePair: boolean,
): string | null {
  if (coverage === "single") {
    return formsReversePair ? `${subjectLabel} 反打中近景` : null;
  }
  if (coverage !== "over-the-shoulder" && coverage !== "group-medium") {
    return null;
  }
  const prefix =
    coverage === "over-the-shoulder"
      ? `${subjectLabel} 过肩`
      : `${subjectLabel} 带群`;
  if (template === "reverse_medium") {
    return `${prefix}${formsReversePair ? "反打" : ""}中近景`;
  }
  if (template === "reaction_closeup") {
    return `${prefix}反应近景`;
  }
  if (template === "low_angle_closeup") {
    return `${prefix}低机位近景`;
  }
  if (template === "high_angle_closeup") {
    return `${prefix}高机位近景`;
  }
  return `${prefix}近景`;
}

function geometryFor(
  decision: DirectorDecision,
  participant: DialogueParticipant,
  lookTarget: DialogueParticipant | null,
  participants: DialogueParticipant[],
  previousGeometry?: CameraGeometry,
): Geometry {
  const groupSubject =
    decision.subject === "both" || decision.subject === "group";
  const groupLabel =
    participants.length === 2 ? "双人" : `${participants.length}人群像`;
  const subjectLabel = groupSubject ? groupLabel : participant.slot;
  const framingLabels: Record<
    DirectorDecision["composition_mode"],
    string
  > = {
    center: "中心构图",
    rule_of_thirds: "三分法构图",
    golden_ratio: "黄金分割构图",
    symmetry: "对称构图",
    asymmetrical_balance: "不对称平衡构图",
    triangular: "三角构图",
    negative_space: "负空间构图",
    layered_depth: "纵深层次构图",
  };
  const framing = framingLabels[decision.composition_mode];
  const compositionPlan = {
    mode: decision.composition_mode,
    visualAnchor: decision.visual_anchor,
    negativeSpace: decision.negative_space,
    transition: decision.composition_transition,
  } as const;

  const groupGeometry = (
    shotSize: Extract<ShotSize, "full" | "medium-full">,
    coverage: Extract<ShotCoverage, "two-shot" | "group">,
  ): {
    geometry: CameraGeometry;
    assessment: ProjectionAssessment;
  } => {
    const geometry = solveGroupCamera({
      participants,
      lensMm: decision.lens_mm,
      cameraHeight: cameraHeight(decision.camera_height, 1.72),
      shotSize,
      composition: compositionPlan,
    });
    return {
      geometry,
      assessment: assessProjection(
        geometry,
        participant,
        participants,
        decision.lens_mm,
        shotSize,
        coverage,
        compositionPlan,
        undefined,
        decision.camera_roll_degrees,
      ),
    };
  };
  const singleGeometry = (
    shotSize: ShotSize,
    coverage: Extract<ShotCoverage, "single" | "group-medium">,
    fallbackHeight: number,
  ) => {
    return solveSingleCamera({
      subject: participant,
      lookTarget: lookTarget ?? undefined,
      participants,
      lensMm: decision.lens_mm,
      cameraHeight: cameraHeight(decision.camera_height, fallbackHeight),
      composition: compositionPlan,
      shotSize,
      coverage,
      previousGeometry,
      cameraRollDegrees: decision.camera_roll_degrees,
    });
  };

  switch (decision.template) {
    case "master_two_shot": {
      const result = groupGeometry("full", "two-shot");
      const label =
        decision.coverage_intent === "reestablish_geography"
          ? "双人重建全景"
          : decision.coverage_intent === "establish_geography"
            ? "双人建立镜头"
            : "双人关系全景";
      return {
        kind: "master",
        label,
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `两人同框，${framing}，先建立空间和人物距离`,
        compositionPlan,
        shotSize: "full",
        coverage: "two-shot",
        assessment: result.assessment,
      };
    }
    case "profile_two_shot": {
      const result = groupGeometry("medium-full", "two-shot");
      return {
        kind: "profile-two-shot",
        label: "双人侧面镜头",
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `两人侧面对峙，${framing}，强化关系张力`,
        compositionPlan,
        shotSize: "medium-full",
        coverage: "two-shot",
        assessment: result.assessment,
      };
    }
    case "master_group_shot": {
      const result = groupGeometry("full", "group");
      const label =
        decision.coverage_intent === "reestablish_geography"
          ? `${participants.length}人群像重建全景`
          : decision.coverage_intent === "establish_geography"
            ? `${participants.length}人群像建立镜头`
            : `${participants.length}人群像关系全景`;
      return {
        kind: "master",
        label,
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `${groupLabel}完整同框，${framing}，建立站位层次与多人视线关系`,
        compositionPlan,
        shotSize: "full",
        coverage: "group",
        assessment: result.assessment,
      };
    }
    case "speaker_group_medium": {
      const result = singleGeometry("medium", "group-medium", 1.68);
      return {
        kind: "group-medium",
        label: `${subjectLabel} 带群中景`,
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `${subjectLabel}位于${framing}，邻近角色保留为关系前景或背景`,
        compositionPlan: result.composition,
        shotSize: "medium",
        coverage: "group-medium",
        assessment: result.assessment,
      };
    }
    case "reaction_closeup": {
      const result = singleGeometry("close-up", "single", 1.64);
      return {
        kind: "reaction",
        label: `${subjectLabel} 反应近景`,
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `${subjectLabel} 位于${framing}，保留视线空间读取无声反应`,
        compositionPlan: result.composition,
        shotSize: "close-up",
        coverage: "single",
        assessment: result.assessment,
      };
    }
    case "low_angle_closeup": {
      const result = singleGeometry("close-up", "single", 0.95);
      return {
        kind: "low-angle",
        label: `${subjectLabel} 低机位近景`,
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `${subjectLabel} 位于${framing}，低机位增强压迫或权力感`,
        compositionPlan: result.composition,
        shotSize: "close-up",
        coverage: "single",
        assessment: result.assessment,
      };
    }
    case "high_angle_closeup": {
      const result = singleGeometry("close-up", "single", 2.45);
      return {
        kind: "high-angle",
        label: `${subjectLabel} 高机位近景`,
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `${subjectLabel} 位于${framing}，高机位表现脆弱或被动`,
        compositionPlan: result.composition,
        shotSize: "close-up",
        coverage: "single",
        assessment: result.assessment,
      };
    }
    case "close_up": {
      const result = singleGeometry("close-up", "single", 1.66);
      return {
        kind: "close-up",
        label: `${subjectLabel} 单人近景`,
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `${subjectLabel} 位于${framing}，集中呈现表情和关键信息`,
        compositionPlan: result.composition,
        shotSize: "close-up",
        coverage: "single",
        assessment: result.assessment,
      };
    }
    case "reverse_medium": {
      const result = singleGeometry("medium-close-up", "single", 1.62);
      return {
        kind: "close-up",
        label: `${subjectLabel} 单人中近景`,
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `${subjectLabel} 位于${framing}，保持轴线同侧和相反视线方向`,
        compositionPlan: result.composition,
        shotSize: "medium-close-up",
        coverage: "single",
        assessment: result.assessment,
      };
    }
  }
}

export function resolveShotDecisions(
  sequence: DialogueSequence,
  decisions: DirectorDecision[],
): ShotPlan[] {
  const rowsById = new Map(sequence.rows.map((row) => [row.id, row]));
  const rowIndexById = new Map(
    sequence.rows.map((row, index) => [row.id, index]),
  );
  const participantsById = new Map<number, DialogueParticipant>();
  for (const participant of sequence.participants) {
    if (!participantsById.has(participant.id)) {
      participantsById.set(participant.id, participant);
    }
  }
  const participantsBySlot = new Map(
    sequence.participants.map((participant) => [participant.slot, participant]),
  );
  const coveredIds = new Set<string>();
  let previousGeometry: CameraGeometry | undefined;
  let previousVisualSubjectSlot: DialogueParticipant["slot"] | null = null;
  let previousLookTargetSlot: DialogueParticipant["slot"] | null = null;
  let previousCoverage: ShotCoverage | null = null;
  let previousAxis: ShotAxis | null = null;
  let previousVisualAnchor: readonly [number, number] | null = null;

  const shots = decisions.map((decision, index) => {
    const rows = decision.dialogue_ids.map((dialogueId) => {
      const row = rowsById.get(dialogueId);
      if (!row) {
        throw new Error(`AI 返回了未知台词节点 ${dialogueId}`);
      }
      if (coveredIds.has(dialogueId)) {
        throw new Error(`AI 重复安排了台词节点 ${dialogueId}`);
      }
      coveredIds.add(dialogueId);
      return row;
    });
    const firstRow = rows[0];
    const dialogueStartIndex = Math.min(
      ...rows.map((row) => rowIndexById.get(row.id) ?? 0),
    );
    const dialogueEndIndex = Math.max(
      ...rows.map((row) => rowIndexById.get(row.id) ?? 0),
    );
    const attendanceChange = sequence.participants.find(
      (participant) =>
        (participant.entryIndex > dialogueStartIndex &&
          participant.entryIndex <= dialogueEndIndex) ||
        (participant.exitIndex !== null &&
          participant.exitIndex >= dialogueStartIndex &&
          participant.exitIndex < dialogueEndIndex),
    );
    if (attendanceChange) {
      throw new Error(
        `镜头 ${index + 1} 跨越了角色 ${attendanceChange.slot} 的进出场节点，请在该节点切镜`,
      );
    }
    const activeParticipants = sequence.participants.filter(
      (participant) =>
        participant.entryIndex <= dialogueEndIndex &&
        (participant.exitIndex === null ||
          participant.exitIndex >= dialogueEndIndex),
    );
    const firstSpeaker =
      (firstRow.speakerSlot
        ? participantsBySlot.get(firstRow.speakerSlot)
        : undefined) ??
      (firstRow.npcId === null ? undefined : participantsById.get(firstRow.npcId));
    const groupSubject =
      decision.subject === "both" || decision.subject === "group";
    const subject =
      decision.subject === "both" || decision.subject === "group"
        ? firstSpeaker
        : participantsBySlot.get(decision.subject);
    let lookTarget: DialogueParticipant | null =
      decision.look_target === "group_center"
        ? null
        : (participantsBySlot.get(decision.look_target) ?? null);
    if (!firstSpeaker || !subject) {
      throw new Error(`镜头 ${index + 1} 无法解析主体 ${decision.subject}`);
    }
    if (
      !activeParticipants.some(
        (participant) => participant.slot === subject.slot,
      )
    ) {
      throw new Error(
        `镜头 ${index + 1} 的主体 ${subject.slot} 尚未登场或已经离场`,
      );
    }
    if (
      groupSubject &&
      decision.look_target !== "group_center"
    ) {
      throw new Error(`镜头 ${index + 1} 的群体镜头必须面向 group_center`);
    }
    if (!groupSubject && activeParticipants.length > 1) {
      const lookTargetIsActive =
        lookTarget &&
        lookTarget.slot !== subject.slot &&
        activeParticipants.some(
          (participant) => participant.slot === lookTarget?.slot,
        );
      if (!lookTargetIsActive) {
        lookTarget =
          activeParticipants.find(
            (participant) => participant.slot !== subject.slot,
          ) ?? null;
      }
      if (!lookTarget) {
        throw new Error(
          `镜头 ${index + 1} 无法建立主体 ${subject.slot} 的关系轴`,
        );
      }
    }
    if (
      !groupSubject &&
      activeParticipants.length > 1 &&
      decision.look_target === subject.slot
    ) {
      throw new Error(
        `镜头 ${index + 1} 的主体 ${subject.slot} 不能看向自己`,
      );
    }
    if (
      decision.subject === "both" &&
      activeParticipants.length !== 2
    ) {
      throw new Error(`镜头 ${index + 1} 的双人主体只能用于两位角色`);
    }
    if (
      decision.subject === "group" &&
      (decision.template !== "master_group_shot" ||
        activeParticipants.length < 3)
    ) {
      throw new Error(
        `镜头 ${index + 1} 的群像主体需要至少三位在场角色和群像建立镜头模板`,
      );
    }
    if (
      decision.subject === "both" &&
      !["master_two_shot", "profile_two_shot"].includes(decision.template)
    ) {
      throw new Error(`镜头 ${index + 1} 的模板不支持双人主体`);
    }
    if (
      ["master_two_shot", "profile_two_shot"].includes(decision.template) &&
      decision.subject !== "both"
    ) {
      throw new Error(`镜头 ${index + 1} 的双人模板必须使用 both 主体`);
    }
    if (
      decision.template === "master_group_shot" &&
      decision.subject !== "group"
    ) {
      throw new Error(`镜头 ${index + 1} 的群像建立镜头必须使用 group 主体`);
    }
    if (
      decision.template === "speaker_group_medium" &&
      (groupSubject || activeParticipants.length < 2)
    ) {
      throw new Error(
        `镜头 ${index + 1} 的带群中景需要至少两位在场角色并指定单个主体`,
      );
    }
    const geometry = geometryFor(
      decision,
      subject,
      lookTarget,
      activeParticipants,
      previousGeometry,
    );
    const motionGeometry = resolveMotionGeometry(
      decision,
      geometry,
      subject,
      lookTarget,
    );
    const axis = createShotAxis(
      activeParticipants,
      subject,
      groupSubject ? null : lookTarget,
      geometry.position,
    );
    const motionEndAxis = createShotAxis(
      activeParticipants,
      subject,
      groupSubject ? null : lookTarget,
      motionGeometry.endPosition,
    );
    if (
      axis.kind === "relationship" &&
      axis.cameraSide !== 0 &&
      motionEndAxis.cameraSide !== 0 &&
      motionEndAxis.cameraSide !== axis.cameraSide
    ) {
      throw new Error(
        `镜头 ${index + 1} 的镜内运动越过了关系轴 ${axis.id}`,
      );
    }
    const hardProjectionWarnings = geometry.assessment.warnings.filter(
      (warning) =>
        !warning.startsWith("单人镜头偏离角色正面") &&
        !warning.startsWith("单人镜头包含其他主要可见角色") &&
        !warning.startsWith("构图"),
    );
    if (hardProjectionWarnings.length > 0) {
      throw new Error(
        `镜头 ${index + 1} 投影验收失败：${hardProjectionWarnings.join("；")}`,
      );
    }
    const additionalVisibleSlots =
      geometry.coverage === "single"
        ? geometry.assessment.visibleParticipantSlots.filter(
            (slot) => slot !== subject.slot,
          )
        : [];
    const resolvedCoverage: ShotCoverage =
      additionalVisibleSlots.length === 0
        ? geometry.coverage
        : geometry.assessment.foregroundParticipantSlots.length === 1 &&
            additionalVisibleSlots.length === 1 &&
            (geometry.assessment.participantAreaRatios[
              geometry.assessment.foregroundParticipantSlots[0]
            ] ?? 1) <= 0.33
          ? "over-the-shoulder"
          : "group-medium";
    const previousWasSingleCoverage =
      previousCoverage === "single" ||
      previousCoverage === "over-the-shoulder";
    const formsReversePair =
      decision.template === "reverse_medium" &&
      (resolvedCoverage === "single" ||
        resolvedCoverage === "over-the-shoulder") &&
      previousWasSingleCoverage &&
      previousVisualSubjectSlot !== null &&
      previousVisualSubjectSlot !== subject.slot &&
      previousAxis?.id === axis.id &&
      previousLookTargetSlot === subject.slot &&
      lookTarget?.slot === previousVisualSubjectSlot;
    const projectionWarnings = [...geometry.assessment.warnings];
    let motionEndAssessment: ProjectionAssessment | null = null;
    if (decision.camera_movement !== "static") {
      motionEndAssessment = assessProjection(
        {
          position: motionGeometry.endPosition,
          target: motionGeometry.endTarget,
        },
        subject,
        activeParticipants,
        decision.end_lens_mm,
        geometry.shotSize,
        geometry.coverage,
        geometry.compositionPlan,
        lookTarget ?? undefined,
        decision.camera_roll_degrees,
      );
      if (
        decision.camera_movement !== "pan" &&
        !motionEndAssessment.visibleParticipantSlots.includes(subject.slot)
      ) {
        projectionWarnings.push("运镜终点未保留当前主体");
      }
      if (
        decision.camera_movement !== "pan" &&
        !motionEndAssessment.subjectSafeForUltrawide
      ) {
        projectionWarnings.push("运镜终点的主体超出 21:9 安全区域");
      }
      if (decision.camera_movement.startsWith("dolly_zoom")) {
        const startArea =
          geometry.assessment.participantAreaRatios[subject.slot] ?? 0;
        const endArea =
          motionEndAssessment.participantAreaRatios[subject.slot] ?? 0;
        if (Math.abs(startArea - endArea) > 0.03) {
          projectionWarnings.push("Dolly zoom 起止主体尺寸未能保持稳定");
        }
      }
    }
    const eyeTraceDelta = previousVisualAnchor
      ? Math.abs(
          geometry.assessment.visualAnchor[0] - previousVisualAnchor[0],
        )
      : null;
    if (
      eyeTraceDelta !== null &&
      decision.composition_transition === "match_eye_trace" &&
      eyeTraceDelta > 0.35
    ) {
      projectionWarnings.push(
        `上下镜注视落点偏移 ${eyeTraceDelta.toFixed(2)} NDC`,
      );
    }
    if (
      previousVisualAnchor &&
      decision.composition_transition === "mirror_reverse"
    ) {
      const previousX = previousVisualAnchor[0];
      const currentX = geometry.assessment.visualAnchor[0];
      const mirrored =
        Math.sign(previousX) !== 0 &&
        Math.sign(currentX) !== 0 &&
        Math.sign(previousX) !== Math.sign(currentX);
      if (!mirrored || Math.abs(Math.abs(previousX) - Math.abs(currentX)) > 0.2) {
        projectionWarnings.push("正反打构图未形成左右互补落点");
      }
    }
    if (
      decision.composition_transition === "recenter" &&
      Math.abs(geometry.assessment.visualAnchor[0]) > 0.18
    ) {
      projectionWarnings.push("重新建立空间的镜头未回到中央视觉重心");
    }
    if (decision.template === "reverse_medium" && !formsReversePair) {
      projectionWarnings.push("当前镜头没有可配对的前置反打镜头，已按实测画面降级");
    }
    if (previousGeometry) {
      const viewDelta = horizontalViewDelta(previousGeometry, geometry);
      if (viewDelta < 30) {
        projectionWarnings.push(
          `与上一镜的水平视角变化仅 ${viewDelta.toFixed(1)}°`,
        );
      }
    }
    if (
      previousAxis?.kind === "relationship" &&
      axis.kind === "relationship" &&
      previousAxis.id === axis.id &&
      previousAxis.cameraSide !== 0 &&
      axis.cameraSide !== previousAxis.cameraSide
    ) {
      throw new Error(`镜头 ${index + 1} 越过了关系轴 ${axis.id}`);
    }
    if (
      previousAxis?.kind === "relationship" &&
      axis.kind === "relationship" &&
      previousAxis.id !== axis.id &&
      !previousAxis.participantSlots.some((slot) =>
        axis.participantSlots.includes(slot),
      )
    ) {
      projectionWarnings.push(
        `关系轴从 ${previousAxis.id} 切换到 ${axis.id}，缺少共享角色或群像重建`,
      );
    }
    const content = rows
      .map((row) => {
        const speaker =
          (row.speakerSlot
            ? participantsBySlot.get(row.speakerSlot)
            : undefined) ??
          (row.npcId === null ? undefined : participantsById.get(row.npcId));
        return `${speaker?.name ?? "未知"}：${row.content}`;
      })
      .join(" ");
    const adjustedLabel =
      groupSubject || geometry.coverage !== "single"
      ? null
      : adjustedSingleLabel(
          decision.template,
          subject.slot,
          resolvedCoverage,
          formsReversePair,
        );

    const shot = {
      id: `shot-${String(index + 1).padStart(2, "0")}`,
      index,
      dialogueId: firstRow.id,
      dialogueIds: rows.map((row) => row.id),
      dialogueEndIndex,
      speakerId: groupSubject ? firstSpeaker.id : subject.id,
      speakerSlot: groupSubject ? firstSpeaker.slot : subject.slot,
      speakerName: groupSubject
        ? activeParticipants.length === 2
          ? "双人"
          : `${activeParticipants.length}人群像`
        : subject.name,
      content,
      kind: formsReversePair ? "reverse-shot" : geometry.kind,
      label: adjustedLabel ?? geometry.label,
      focalLength: decision.lens_mm,
      endFocalLength: decision.end_lens_mm,
      lensIntent: decision.lens_intent,
      depthOfField: decision.depth_of_field,
      duration: estimateShotDuration(rows.map((row) => row.content)),
      cameraPosition: geometry.position,
      cameraTarget: geometry.target,
      cameraEndPosition: motionGeometry.endPosition,
      cameraEndTarget: motionGeometry.endTarget,
      cameraMovement: decision.camera_movement,
      movementIntensity: decision.movement_intensity,
      cameraRollDegrees: decision.camera_roll_degrees,
      coverageIntent: decision.coverage_intent,
      compositionPlan: geometry.compositionPlan,
      composition: geometry.composition,
      rationale: decision.intent,
      visualSubjectSlot: groupSubject ? null : subject.slot,
      lookTargetSlot: lookTarget?.slot ?? null,
      facingOverrides:
        groupSubject || !lookTarget
          ? {}
          : {
              [subject.slot]: lookTarget.position,
              [lookTarget.slot]: subject.position,
            },
      axis,
      projection: {
        expectedShotSize: geometry.shotSize,
        measuredShotSize: geometry.assessment.measuredShotSize,
        coverage: resolvedCoverage,
        visibleParticipantSlots: geometry.assessment.visibleParticipantSlots,
        foregroundParticipantSlots:
          geometry.assessment.foregroundParticipantSlots,
        participantAreaRatios: geometry.assessment.participantAreaRatios,
        subjectFaceAngle: groupSubject
          ? null
          : geometry.assessment.subjectFaceAngle,
        subjectSafeForUltrawide:
          geometry.assessment.subjectSafeForUltrawide,
        visualAnchor: geometry.assessment.visualAnchor,
        targetAnchor: geometry.assessment.targetAnchor,
        anchorDistance: geometry.assessment.anchorDistance,
        headroom: geometry.assessment.headroom,
        lookRoom: geometry.assessment.lookRoom,
        backRoom: geometry.assessment.backRoom,
        visualWeightBias: geometry.assessment.visualWeightBias,
        projectedTriangleArea:
          geometry.assessment.projectedTriangleArea,
        depthSpread: geometry.assessment.depthSpread,
        eyeTraceDelta:
          eyeTraceDelta === null ? null : Number(eyeTraceDelta.toFixed(3)),
        valid: projectionWarnings.length === 0,
        warnings: projectionWarnings,
      },
    } satisfies ShotPlan;
    previousGeometry = {
      position: shot.cameraEndPosition,
      target: shot.cameraEndTarget,
    };
    previousVisualSubjectSlot = shot.visualSubjectSlot;
    previousLookTargetSlot = shot.lookTargetSlot;
    previousCoverage = shot.projection.coverage;
    previousAxis =
      shot.cameraMovement === "static" ? shot.axis : motionEndAxis;
    previousVisualAnchor =
      motionEndAssessment?.visualAnchor ?? shot.projection.visualAnchor;
    return shot;
  });

  const missingRows = sequence.rows.filter((row) => !coveredIds.has(row.id));
  if (missingRows.length > 0) {
    throw new Error(
      `AI 未安排台词节点：${missingRows.map((row) => row.id).join("、")}`,
    );
  }
  return shots;
}
