import type {
  DirectorBlocking,
  DirectorDecision,
  DirectorInput,
  DirectorProviderResult,
  ShotDirectorProvider,
} from "./contracts";
import type { ParticipantSlot } from "../types";
import {
  createDefaultBlocking,
  defaultEntryDialogueId,
} from "./blockingResolver";
import {
  estimateDialogueDuration,
  MINIMUM_DIALOGUE_LINES_PER_SHOT,
  MINIMUM_SHOT_DURATION_SECONDS,
  PREFERRED_MAXIMUM_SHOT_DURATION_SECONDS,
} from "./shotTiming";

interface AttendanceContext {
  entryIndexBySlot: Map<ParticipantSlot, number>;
  exitIndexBySlot: Map<ParticipantSlot, number | null>;
}

const TIGHT_SINGLE_TEMPLATES = new Set<DirectorDecision["template"]>([
  "reverse_medium",
  "close_up",
  "reaction_closeup",
  "low_angle_closeup",
  "high_angle_closeup",
]);

const RELATIONSHIP_WIDE_TEMPLATES = new Set<
  DirectorDecision["template"]
>(["master_two_shot", "master_group_shot"]);

function isPause(content: string): boolean {
  return /^[.…·\s]{2,}/.test(content);
}

function isEmphatic(content: string): boolean {
  return /[？！!?]|危险|必须|不能|真相|现在|立刻|到底/.test(content);
}

function hasDisorientationCue(content: string): boolean {
  return /失控|眩晕|混乱|疯狂|疯了|幻觉|不对劲|崩塌|扭曲/.test(content);
}

function hasIsolationCue(content: string): boolean {
  return /独自|一个人|只剩|没人|空无|离开我|别管我|让我静静|被抛弃|孤立|失去/.test(
    content,
  );
}

function hasOffscreenThreatCue(content: string): boolean {
  return /门外|窗外|身后|脚步|追兵|埋伏|监视|有人来了|危险正在|逼近/.test(
    content,
  );
}

function hasPressureCue(content: string): boolean {
  return /危险|必须|不能|现在|立刻|到底|威胁|逼问|住手|滚开|没有选择/.test(
    content,
  );
}

function visualAnchorFor(
  slot: ParticipantSlot,
  input: DirectorInput,
): DirectorDecision["visual_anchor"] {
  const speakerIndex = input.participants.findIndex(
    (participant) => participant.slot === slot,
  );
  const midpoint = (input.participants.length - 1) / 2;
  if (Math.abs(speakerIndex - midpoint) < 0.1) {
    return "center";
  }
  return speakerIndex < midpoint ? "left_third" : "right_third";
}

function createAttendanceContext(
  input: DirectorInput,
  blocking: DirectorBlocking,
): AttendanceContext {
  const dialogueIndexById = new Map(
    input.dialogue.map((line, index) => [line.dialogue_id, index]),
  );
  const placementBySlot = new Map(
    blocking.placements.map((placement) => [
      placement.subject,
      placement,
    ]),
  );
  return {
    entryIndexBySlot: new Map(
      input.participants.map((participant) => {
        const entryId =
          placementBySlot.get(participant.slot)?.entry_dialogue_id ??
          participant.entry_dialogue_id ??
          defaultEntryDialogueId(input, participant.first_dialogue_id);
        return [
          participant.slot,
          dialogueIndexById.get(entryId) ?? Number.POSITIVE_INFINITY,
        ];
      }),
    ),
    exitIndexBySlot: new Map(
      input.participants.map((participant) => {
        const exitId =
          placementBySlot.get(participant.slot)?.exit_dialogue_id ??
          participant.exit_dialogue_id ??
          null;
        return [
          participant.slot,
          exitId === null ? null : (dialogueIndexById.get(exitId) ?? null),
        ];
      }),
    ),
  };
}

function activeParticipantsAt(
  index: number,
  input: DirectorInput,
  attendance: AttendanceContext,
): DirectorInput["participants"] {
  return input.participants.filter((participant) => {
    const entryIndex =
      attendance.entryIndexBySlot.get(participant.slot) ??
      Number.POSITIVE_INFINITY;
    const exitIndex = attendance.exitIndexBySlot.get(participant.slot);
    return (
      entryIndex <= index &&
      (exitIndex === null || exitIndex === undefined || exitIndex >= index)
    );
  });
}

function relationshipWideDecision(
  dialogueId: string,
  activeParticipants: DirectorInput["participants"],
  coverageIntent: Extract<
    DirectorDecision["coverage_intent"],
    "establish_geography" | "reestablish_geography" | "relationship"
  >,
  reason: string,
): DirectorDecision {
  const isGroup = activeParticipants.length > 2;
  return {
    dialogue_ids: [dialogueId],
    template: isGroup ? "master_group_shot" : "master_two_shot",
    subject: isGroup ? "group" : "both",
    look_target: "group_center",
    lens_mm: isGroup
      ? activeParticipants.length > 4
        ? 28
        : 32
      : 38,
    end_lens_mm: isGroup
      ? activeParticipants.length > 4
        ? 28
        : 32
      : 38,
    lens_intent: isGroup ? "spatial_context" : "natural_perspective",
    depth_of_field: "deep",
    camera_movement: "static",
    movement_intensity: "none",
    camera_roll_degrees: 0,
    composition_mode:
      activeParticipants.length === 3
        ? "triangular"
        : isGroup
          ? "layered_depth"
          : "symmetry",
    visual_anchor: "balanced",
    negative_space: "balanced",
    composition_transition: "recenter",
    coverage_intent: coverageIntent,
    camera_height: "eye",
    intent: reason,
  };
}

function lookTargetFor(
  speaker: ParticipantSlot,
  index: number,
  previousSpeaker: ParticipantSlot | null,
  activeParticipants: DirectorInput["participants"],
  input: DirectorInput,
): DirectorDecision["look_target"] {
  if (
    previousSpeaker &&
    previousSpeaker !== speaker &&
    activeParticipants.some(
      (participant) => participant.slot === previousSpeaker,
    )
  ) {
    return previousSpeaker;
  }
  const nextSpeaker = input.dialogue
    .slice(index + 1)
    .find(
      (line) =>
        line.speaker !== speaker &&
        activeParticipants.some(
          (participant) => participant.slot === line.speaker,
        ),
    )?.speaker;
  return (
    nextSpeaker ??
    activeParticipants.find((participant) => participant.slot !== speaker)
      ?.slot ??
    "group_center"
  );
}

function decisionFor(
  row: DirectorInput["dialogue"][number],
  index: number,
  previousSpeaker: ParticipantSlot | null,
  input: DirectorInput,
  attendance: AttendanceContext,
): DirectorDecision {
  const screenPosition = visualAnchorFor(row.speaker, input);
  const activeParticipants = activeParticipantsAt(index, input, attendance);
  const hasEntrance = input.participants.some(
    (participant) =>
      attendance.entryIndexBySlot.get(participant.slot) === index &&
      index > 0,
  );
  const isolationCue = hasIsolationCue(row.content);
  const offscreenThreatCue = hasOffscreenThreatCue(row.content);
  const pressureCue = hasPressureCue(row.content);
  const lookTarget = lookTargetFor(
    row.speaker,
    index,
    previousSpeaker,
    activeParticipants,
    input,
  );
  if (index === 0) {
    if (activeParticipants.length === 1) {
      return {
        dialogue_ids: [row.dialogue_id],
        template: "close_up",
        subject: row.speaker,
        look_target: "group_center",
        lens_mm: 85,
        end_lens_mm: 85,
        lens_intent: "compressed_intimacy",
        depth_of_field: "shallow",
        camera_movement: "static",
        movement_intensity: "none",
        camera_roll_degrees: 0,
        composition_mode: "center",
        visual_anchor: "center",
        negative_space: "balanced",
        composition_transition: "recenter",
        coverage_intent: "individual_perspective",
        camera_height: "eye",
        intent: "先建立当前在场角色，并为后续角色登场保留空间。",
      };
    }
    return relationshipWideDecision(
      row.dialogue_id,
      activeParticipants,
      "establish_geography",
      activeParticipants.length > 2
        ? "先交代群像站位、视线关系与主要发言者位置，为后续单人镜头建立空间依据。"
        : "先交代人物距离与对话轴线，为后续正反打建立空间关系。",
    );
  }
  if (hasEntrance && activeParticipants.length > 1) {
    return relationshipWideDecision(
      row.dialogue_id,
      activeParticipants,
      "reestablish_geography",
      "新角色在该节点进入场面，使用全景重新交代全部在场角色的位置、关系和视线。",
    );
  }
  if (isPause(row.content)) {
    return {
      dialogue_ids: [row.dialogue_id],
      template: "reaction_closeup",
      subject: row.speaker,
      look_target: lookTarget,
      lens_mm: 100,
      end_lens_mm: 100,
      lens_intent: "compressed_intimacy",
      depth_of_field: "shallow",
      camera_movement: isolationCue ? "dolly_out" : "static",
      movement_intensity: isolationCue ? "subtle" : "none",
      camera_roll_degrees: hasDisorientationCue(row.content) ? 18 : 0,
      composition_mode:
        isolationCue || offscreenThreatCue
          ? "negative_space"
          : "golden_ratio",
      visual_anchor:
        screenPosition === "left_third"
          ? "left_golden"
          : screenPosition === "right_third"
            ? "right_golden"
            : "center",
      negative_space: isolationCue ? "isolation" : "look_room",
      composition_transition: "contrast",
      coverage_intent: "reaction",
      camera_height: "eye",
      intent: isolationCue
        ? "停顿与台词明确表达孤立，拉远并保留有意义空白，读取角色没有说出口的反应。"
        : offscreenThreatCue
          ? "停顿指向画外威胁，在视线前方保留信息空间并读取角色反应。"
          : "停顿构成情绪节点，以稳定近景读取角色没有说出口的反应，不额外推断孤立。",
    };
  }
  if (isEmphatic(row.content) || previousSpeaker === row.speaker) {
    return {
      dialogue_ids: [row.dialogue_id],
      template: "close_up",
      subject: row.speaker,
      look_target: lookTarget,
      lens_mm: 85,
      end_lens_mm: 85,
      lens_intent: "compressed_intimacy",
      depth_of_field: "shallow",
      camera_movement: "dolly_in",
      movement_intensity: "subtle",
      camera_roll_degrees: hasDisorientationCue(row.content) ? 18 : 0,
      composition_mode: "golden_ratio",
      visual_anchor:
        screenPosition === "left_third"
          ? "left_golden"
          : screenPosition === "right_third"
            ? "right_golden"
            : "center",
      negative_space: pressureCue ? "pressure" : "look_room",
      composition_transition: "progressive_shift",
      coverage_intent: "individual_emphasis",
      camera_height: "eye",
      intent: pressureCue
        ? "台词形成明确压力，使用轻微推近和短边构图集中注意力并制造受阻感。"
        : "台词包含追问或强调信息，使用轻微推近和常规视线空间提高情绪权重。",
    };
  }
  return {
    dialogue_ids: [row.dialogue_id],
    template:
      input.participants.length > 2
        ? "speaker_group_medium"
        : "reverse_medium",
    subject: row.speaker,
    look_target: lookTarget,
    lens_mm: input.participants.length > 2 ? 42 : 50,
    end_lens_mm: input.participants.length > 2 ? 42 : 50,
    lens_intent:
      input.participants.length > 2
        ? "natural_perspective"
        : "subject_isolation",
    depth_of_field: "moderate",
    camera_movement: "static",
    movement_intensity: "none",
    camera_roll_degrees: 0,
    composition_mode:
      input.participants.length > 2 ? "layered_depth" : "rule_of_thirds",
    visual_anchor: screenPosition,
    negative_space: "look_room",
    composition_transition:
      previousSpeaker && previousSpeaker !== row.speaker
        ? "mirror_reverse"
        : "match_eye_trace",
    coverage_intent:
      input.participants.length > 2
        ? "relationship"
        : "individual_perspective",
    camera_height: "eye",
    intent:
      input.participants.length > 2
        ? "在突出当前说话者的同时保留邻近角色轮廓，维持多人场面的空间连续。"
        : "保持在轴线同一侧，用相反视线方向完成稳定正反打。",
  };
}

export class RuleDirectorProvider implements ShotDirectorProvider {
  readonly id = "rule" as const;

  async design(input: DirectorInput): Promise<DirectorProviderResult> {
    const blocking = createDefaultBlocking(input);
    return {
      decisions: createRuleDecisions(input, blocking),
      blocking,
      analysis: createRuleAnalysis(input),
    };
  }
}

export function createRuleAnalysis(
  input: DirectorInput,
): NonNullable<DirectorProviderResult["analysis"]> {
  const isGroupDialogue = input.participants.length > 2;
  return {
    dramaticGoal: "规则导演未进行深层剧情推理",
    emotionalProgression: "根据句长、停顿、标点和说话人切换判断节奏",
    visualStrategy: isGroupDialogue
      ? "前三镜建立关系全景，进出场后重新建立空间；普通关系段优先自然焦段的带群或群像，重要情绪才以长焦收紧并轻微推拉"
      : "先用自然焦段双人镜头建立关系，共同反应保留同框，重要台词用长焦轻微推近、停顿反应用长焦轻微拉远，并在连续紧景后回到双人空间",
  };
}

export function createRuleDecisions(
  input: DirectorInput,
  blocking = createDefaultBlocking(input),
): DirectorDecision[] {
  let previousSpeaker: ParticipantSlot | null = null;
  const attendance = createAttendanceContext(input, blocking);
  const rawDecisions = input.dialogue.map((row, index) => {
    const decision = decisionFor(
      row,
      index,
      previousSpeaker,
      input,
      attendance,
    );
    previousSpeaker = row.speaker;
    return decision;
  });
  const entryDialogueIds = new Set(
    [...attendance.entryIndexBySlot.values()]
      .filter(Number.isFinite)
      .map((index) => input.dialogue[index].dialogue_id),
  );
  const exitDialogueIds = new Set(
    [...attendance.exitIndexBySlot.values()]
      .filter((index): index is number => index !== null)
      .map((index) => input.dialogue[index].dialogue_id),
  );
  const drafts: Array<{
    decision: DirectorDecision;
    duration: number;
    startIndex: number;
    endIndex: number;
    retainedForTiming: boolean;
  }> = [];

  const hasHardBoundaryBefore = (index: number): boolean =>
    index > 0 &&
    (entryDialogueIds.has(input.dialogue[index].dialogue_id) ||
      exitDialogueIds.has(input.dialogue[index - 1].dialogue_id));

  const appendToCurrent = (
    draft: (typeof drafts)[number],
    index: number,
  ): void => {
    draft.decision.dialogue_ids.push(input.dialogue[index].dialogue_id);
    draft.duration += estimateDialogueDuration(input.dialogue[index].content);
    draft.endIndex = index;
    draft.retainedForTiming = true;
  };

  for (const [index, row] of input.dialogue.entries()) {
    const decision = rawDecisions[index];
    const duration = estimateDialogueDuration(row.content);
    const current = drafts.at(-1);
    if (!current) {
      drafts.push({
        decision: { ...decision, dialogue_ids: [...decision.dialogue_ids] },
        duration,
        startIndex: index,
        endIndex: index,
        retainedForTiming: false,
      });
      continue;
    }

    const speakerChanged =
      input.dialogue[current.endIndex].speaker !== row.speaker;
    const pauseCut = isPause(row.content);
    const dramaticCut = isEmphatic(row.content);
    const currentIsLongEnough =
      current.duration >= MINIMUM_SHOT_DURATION_SECONDS;
    const currentIsTooLong =
      current.duration >= PREFERRED_MAXIMUM_SHOT_DURATION_SECONDS;
    const currentHasEnoughLines =
      current.decision.dialogue_ids.length >=
      MINIMUM_DIALOGUE_LINES_PER_SHOT;
    const shouldStartNewShot =
      hasHardBoundaryBefore(index) ||
      pauseCut ||
      (currentHasEnoughLines &&
        (currentIsTooLong ||
          (currentIsLongEnough && (speakerChanged || dramaticCut))));

    if (shouldStartNewShot) {
      drafts.push({
        decision: { ...decision, dialogue_ids: [...decision.dialogue_ids] },
        duration,
        startIndex: index,
        endIndex: index,
        retainedForTiming: false,
      });
    } else {
      appendToCurrent(current, index);
    }
  }

  for (let index = drafts.length - 1; index > 0; index -= 1) {
    const current = drafts[index];
    const previous = drafts[index - 1];
    if (
      current.duration >= MINIMUM_SHOT_DURATION_SECONDS ||
      hasHardBoundaryBefore(current.startIndex) ||
      previous.duration + current.duration >
        PREFERRED_MAXIMUM_SHOT_DURATION_SECONDS
    ) {
      continue;
    }
    previous.decision.dialogue_ids.push(
      ...current.decision.dialogue_ids,
    );
    previous.duration += current.duration;
    previous.endIndex = current.endIndex;
    previous.retainedForTiming = true;
    drafts.splice(index, 1);
  }

  let previousVisualSubject: ParticipantSlot | null = null;
  let previousRelationshipPair: ParticipantSlot[] | null = null;
  let tightSingleRun = 0;
  let relationshipWideInOpening = false;
  return drafts.map(
    ({ decision, retainedForTiming, startIndex, endIndex }, shotIndex) => {
      const segmentDecisions = rawDecisions.slice(startIndex, endIndex + 1);
      const segmentRows = input.dialogue.slice(startIndex, endIndex + 1);
      const activeParticipants = activeParticipantsAt(
        endIndex,
        input,
        attendance,
      );
      const hasPauseBeat = segmentRows.some((row) => isPause(row.content));
      const hasEmphasisBeat = segmentRows.some((row) =>
        isEmphatic(row.content),
      );
      const segmentSpeakers = new Set(
        segmentRows.map((row) => row.speaker),
      );
      const hasEntranceAtStart = input.participants.some(
        (participant) =>
          attendance.entryIndexBySlot.get(participant.slot) === startIndex &&
          startIndex > 0,
      );
      const hasExitBeforeStart =
        startIndex > 0 &&
        input.participants.some(
          (participant) =>
            attendance.exitIndexBySlot.get(participant.slot) ===
            startIndex - 1,
        );
      const keepsGroupComposition = [
        "master_two_shot",
        "profile_two_shot",
        "master_group_shot",
      ].includes(decision.template);
      const pauseDecision = segmentDecisions.find((candidate, offset) =>
        isPause(input.dialogue[startIndex + offset].content),
      );
      let selected = keepsGroupComposition
        ? decision
        : (pauseDecision ?? segmentDecisions.at(-1) ?? decision);
      const selectedIsSingle =
        selected.subject !== "both" && selected.subject !== "group";

      if (selectedIsSingle && selected.subject === previousVisualSubject) {
        const differentSegmentDecision = [...segmentDecisions]
          .reverse()
          .find(
            (candidate) =>
              candidate.subject !== "both" &&
              candidate.subject !== "group" &&
              candidate.subject !== previousVisualSubject,
          );
        if (differentSegmentDecision) {
          selected = differentSegmentDecision;
        } else {
          const activeAlternative = activeParticipants.find(
            (participant) =>
              participant.slot !== previousVisualSubject,
          );
          if (activeAlternative) {
            const previousSubject = selected.subject;
            selected = {
              ...selected,
              subject: activeAlternative.slot,
              look_target: previousSubject,
              template:
                input.participants.length > 2
                  ? "speaker_group_medium"
                  : selected.template === "reaction_closeup"
                    ? "reaction_closeup"
                    : "reverse_medium",
              lens_mm:
                selected.template === "reaction_closeup"
                  ? selected.lens_mm
                  : input.participants.length > 2
                    ? 42
                    : 50,
              end_lens_mm:
                selected.template === "reaction_closeup"
                  ? selected.end_lens_mm
                  : input.participants.length > 2
                    ? 42
                    : 50,
              lens_intent:
                selected.template === "reaction_closeup"
                  ? selected.lens_intent
                  : input.participants.length > 2
                    ? "natural_perspective"
                    : "subject_isolation",
              depth_of_field:
                selected.template === "reaction_closeup"
                  ? selected.depth_of_field
                  : "moderate",
              visual_anchor: visualAnchorFor(
                activeAlternative.slot,
                input,
              ),
              coverage_intent:
                input.participants.length > 2
                  ? "shared_reaction"
                  : selected.coverage_intent,
              intent: `${selected.intent} 保留另一位在场角色的反应，避免连续镜头重复同一主体。`,
            };
          }
        }
      }

      const currentRelationshipPair =
        selected.subject !== "both" &&
        selected.subject !== "group" &&
        selected.look_target !== "group_center"
          ? [selected.subject, selected.look_target]
          : null;
      const relationshipChangedWithoutSharedActor =
        previousRelationshipPair !== null &&
        currentRelationshipPair !== null &&
        !previousRelationshipPair.some((slot) =>
          currentRelationshipPair.includes(slot),
        );
      const needsOpeningRelationshipWide =
        shotIndex < 3 &&
        !relationshipWideInOpening &&
        activeParticipants.length >= 2;
      const needsWideAfterTightRun =
        tightSingleRun >= 3 &&
        !hasPauseBeat &&
        !hasEmphasisBeat &&
        activeParticipants.length >= 2;
      const needsRelationshipWide =
        activeParticipants.length >= 2 &&
        (hasEntranceAtStart ||
          hasExitBeforeStart ||
          relationshipChangedWithoutSharedActor ||
          needsOpeningRelationshipWide ||
          needsWideAfterTightRun);
      const needsClosingRelationshipShot =
        shotIndex === drafts.length - 1 &&
        tightSingleRun >= 2 &&
        !hasPauseBeat &&
        !hasEmphasisBeat &&
        activeParticipants.length === 2;

      if (needsRelationshipWide) {
        const reason = hasEntranceAtStart
          ? "新角色进入场面，使用全景重新交代全部在场角色的位置、关系和视线。"
          : hasExitBeforeStart
            ? "角色离场后使用全景重新交代剩余角色的位置和新的空间关系。"
            : relationshipChangedWithoutSharedActor
              ? "当前互动双方改变且新旧关系轴没有共享角色，使用全景重建空间。"
              : needsWideAfterTightRun
                ? "连续紧景已达到三镜，回到关系全景让观众重新确认人物位置。"
                : "在前三个镜头内建立全部当前在场角色的关系和站位。";
        selected = relationshipWideDecision(
          input.dialogue[startIndex].dialogue_id,
          activeParticipants,
          shotIndex === 0
            ? "establish_geography"
            : "reestablish_geography",
          reason,
        );
      } else if (
        activeParticipants.length === 2 &&
        (segmentSpeakers.size >= 2 || needsClosingRelationshipShot) &&
        !hasPauseBeat &&
        !hasEmphasisBeat
      ) {
        selected = {
          ...selected,
          template: "master_two_shot",
          subject: "both",
          look_target: "group_center",
          lens_mm: 42,
          end_lens_mm: 42,
          lens_intent: "natural_perspective",
          depth_of_field: "moderate",
          camera_movement: "static",
          movement_intensity: "none",
          camera_roll_degrees: 0,
          composition_mode: "asymmetrical_balance",
          visual_anchor: "balanced",
          negative_space: "balanced",
          composition_transition: "match_eye_trace",
          coverage_intent: "relationship",
          intent: needsClosingRelationshipShot
            ? "连续紧景后在段落结尾回到双人镜头，交代双方共享结果并恢复关系空间。"
            : "当前段落的重点是双方互动和共同反应，使用双人镜头保留身体语言并避免机械正反打。",
        };
      } else if (
        activeParticipants.length > 2 &&
        segmentSpeakers.size >= 2 &&
        TIGHT_SINGLE_TEMPLATES.has(selected.template) &&
        !hasPauseBeat &&
        !hasEmphasisBeat
      ) {
        selected = {
          ...selected,
          template: "speaker_group_medium",
          lens_mm: 42,
          end_lens_mm: 42,
          lens_intent: "natural_perspective",
          depth_of_field: "moderate",
          camera_movement: "static",
          movement_intensity: "none",
          camera_roll_degrees: 0,
          composition_mode: "layered_depth",
          negative_space: "look_room",
          composition_transition: "match_eye_trace",
          coverage_intent: "shared_reaction",
          intent:
            "当前段落包含多位角色互动，保留主体与关系角色的共同反应和空间背景。",
        };
      }

      const selectedSubject =
        selected.subject === "both" || selected.subject === "group"
          ? null
          : selected.subject;
      previousVisualSubject = selectedSubject;
      if (RELATIONSHIP_WIDE_TEMPLATES.has(selected.template)) {
        if (shotIndex < 3) {
          relationshipWideInOpening = true;
        }
        previousRelationshipPair = null;
      } else {
        previousRelationshipPair =
          selected.subject !== "both" &&
          selected.subject !== "group" &&
          selected.look_target !== "group_center"
            ? [selected.subject, selected.look_target]
            : null;
      }
      tightSingleRun = TIGHT_SINGLE_TEMPLATES.has(selected.template)
        ? tightSingleRun + 1
        : 0;
      return {
        ...selected,
        dialogue_ids: [...decision.dialogue_ids],
        intent: retainedForTiming
          ? `${selected.intent} 连续台词保留在同一镜头内，普通镜头至少承载两句，避免随说话人频繁切换。`
          : selected.intent,
      };
    },
  );
}
