import type {
  DialogueParticipant,
  DialogueSequence,
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
  shotSize: ShotSize;
  coverage: ShotCoverage;
  assessment: ProjectionAssessment;
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
  participants: DialogueParticipant[],
  previousGeometry?: CameraGeometry,
): Geometry {
  const groupSubject =
    decision.subject === "both" || decision.subject === "group";
  const groupLabel =
    participants.length === 2 ? "双人" : `${participants.length}人群像`;
  const subjectLabel = groupSubject ? groupLabel : participant.slot;
  const framing =
    decision.screen_position === "balanced"
      ? "平衡构图"
      : decision.screen_position === "center"
        ? "中央构图"
        : decision.screen_position === "left_third"
          ? "左侧三分线"
          : "右侧三分线";

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
      ),
    };
  };
  const singleGeometry = (
    shotSize: ShotSize,
    coverage: Extract<ShotCoverage, "single" | "group-medium">,
    fallbackHeight: number,
  ) =>
    solveSingleCamera({
      subject: participant,
      participants,
      lensMm: decision.lens_mm,
      cameraHeight: cameraHeight(decision.camera_height, fallbackHeight),
      screenPosition: decision.screen_position,
      shotSize,
      coverage,
      previousGeometry,
    });

  switch (decision.template) {
    case "master_two_shot": {
      const result = groupGeometry("full", "two-shot");
      return {
        kind: "master",
        label: "双人建立镜头",
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `两人同框，${framing}，先建立空间和人物距离`,
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
        shotSize: "medium-full",
        coverage: "two-shot",
        assessment: result.assessment,
      };
    }
    case "master_group_shot": {
      const result = groupGeometry("full", "group");
      return {
        kind: "master",
        label: `${participants.length}人群像建立镜头`,
        position: result.geometry.position,
        target: result.geometry.target,
        composition: `${groupLabel}完整同框，${framing}，建立站位层次与多人视线关系`,
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
  const participantsById = new Map(
    sequence.participants.map((participant) => [participant.id, participant]),
  );
  const participantsBySlot = new Map(
    sequence.participants.map((participant) => [participant.slot, participant]),
  );
  const coveredIds = new Set<string>();
  let previousGeometry: CameraGeometry | undefined;
  let previousVisualSubjectSlot: DialogueParticipant["slot"] | null = null;
  let previousCoverage: ShotCoverage | null = null;

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
      firstRow.npcId === null ? undefined : participantsById.get(firstRow.npcId);
    const groupSubject =
      decision.subject === "both" || decision.subject === "group";
    const subject =
      decision.subject === "both" || decision.subject === "group"
        ? firstSpeaker
        : participantsBySlot.get(decision.subject);
    if (!firstSpeaker || !subject) {
      throw new Error(`镜头 ${index + 1} 无法解析主体 ${decision.subject}`);
    }
    if (!activeParticipants.some((participant) => participant.id === subject.id)) {
      throw new Error(
        `镜头 ${index + 1} 的主体 ${subject.slot} 尚未登场或已经离场`,
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
      activeParticipants,
      previousGeometry,
    );
    const hardProjectionWarnings = geometry.assessment.warnings.filter(
      (warning) =>
        !warning.startsWith("单人镜头偏离角色正面") &&
        !warning.startsWith("单人镜头包含其他主要可见角色"),
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
      previousVisualSubjectSlot !== subject.slot;
    const projectionWarnings = [...geometry.assessment.warnings];
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
    const content = rows
      .map((row) => {
        const speaker =
          row.npcId === null ? undefined : participantsById.get(row.npcId);
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
      duration: estimateShotDuration(rows.map((row) => row.content)),
      cameraPosition: geometry.position,
      cameraTarget: geometry.target,
      composition: geometry.composition,
      rationale: decision.intent,
      visualSubjectSlot: groupSubject ? null : subject.slot,
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
        valid: projectionWarnings.length === 0,
        warnings: projectionWarnings,
      },
    } satisfies ShotPlan;
    previousGeometry = {
      position: shot.cameraPosition,
      target: shot.cameraTarget,
    };
    previousVisualSubjectSlot = shot.visualSubjectSlot;
    previousCoverage = shot.projection.coverage;
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
