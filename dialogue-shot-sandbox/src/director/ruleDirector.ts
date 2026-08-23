import type {
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

function isPause(content: string): boolean {
  return /^[.…·\s]{2,}/.test(content);
}

function isEmphatic(content: string): boolean {
  return /[？！!?]|危险|必须|不能|真相|现在|立刻|到底/.test(content);
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
): DirectorDecision {
  const screenPosition = visualAnchorFor(row.speaker, input);
  const dialogueIndexById = new Map(
    input.dialogue.map((line, dialogueIndex) => [
      line.dialogue_id,
      dialogueIndex,
    ]),
  );
  const activeParticipants = input.participants.filter((participant) => {
    const entryDialogueId = defaultEntryDialogueId(
      input,
      participant.first_dialogue_id,
    );
    return (
      (dialogueIndexById.get(entryDialogueId) ?? Number.POSITIVE_INFINITY) <=
      index
    );
  });
  const enteringParticipant = input.participants.find(
    (participant) =>
      participant.slot === row.speaker &&
      defaultEntryDialogueId(input, participant.first_dialogue_id) ===
        row.dialogue_id &&
      index > 0,
  );
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
        lens_mm: 50,
        composition_mode: "center",
        visual_anchor: "center",
        negative_space: "balanced",
        composition_transition: "recenter",
        camera_height: "eye",
        intent: "先建立当前在场角色，并为后续角色登场保留空间。",
      };
    }
    return {
      dialogue_ids: [row.dialogue_id],
      template:
        activeParticipants.length > 2
          ? "master_group_shot"
          : "master_two_shot",
      subject: activeParticipants.length > 2 ? "group" : "both",
      look_target: "group_center",
      lens_mm: activeParticipants.length > 4 ? 28 : 38,
      composition_mode:
        activeParticipants.length > 2 ? "triangular" : "symmetry",
      visual_anchor: "balanced",
      negative_space: "balanced",
      composition_transition: "recenter",
      camera_height: "eye",
      intent:
        activeParticipants.length > 2
          ? "先交代群像站位、视线关系与主要发言者位置，为后续单人镜头建立空间依据。"
          : "先交代人物距离与对话轴线，为后续正反打建立空间关系。",
    };
  }
  if (enteringParticipant) {
    return {
      dialogue_ids: [row.dialogue_id],
      template:
        activeParticipants.length > 2
          ? "speaker_group_medium"
          : "reverse_medium",
      subject: row.speaker,
      look_target: lookTarget,
      lens_mm: 42,
      composition_mode:
        activeParticipants.length > 2
          ? "layered_depth"
          : "asymmetrical_balance",
      visual_anchor: screenPosition,
      negative_space: "look_room",
      composition_transition: "progressive_shift",
      camera_height: "eye",
      intent: "新角色在该台词节点进入场面，镜头明确其位置并更新群体关系。",
    };
  }
  if (isPause(row.content)) {
    return {
      dialogue_ids: [row.dialogue_id],
      template: "reaction_closeup",
      subject: row.speaker,
      look_target: lookTarget,
      lens_mm: 78,
      composition_mode: "negative_space",
      visual_anchor:
        screenPosition === "left_third"
          ? "left_golden"
          : screenPosition === "right_third"
            ? "right_golden"
            : "center",
      negative_space: "isolation",
      composition_transition: "contrast",
      camera_height: "eye",
      intent: "停顿构成情绪节点，收紧景别读取角色没有说出口的反应。",
    };
  }
  if (isEmphatic(row.content) || previousSpeaker === row.speaker) {
    return {
      dialogue_ids: [row.dialogue_id],
      template: "close_up",
      subject: row.speaker,
      look_target: lookTarget,
      lens_mm: 68,
      composition_mode: "golden_ratio",
      visual_anchor:
        screenPosition === "left_third"
          ? "left_golden"
          : screenPosition === "right_third"
            ? "right_golden"
            : "center",
      negative_space: "pressure",
      composition_transition: "progressive_shift",
      camera_height: "eye",
      intent: "台词包含追问或强调信息，使用近景集中注意力并提高情绪权重。",
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
    composition_mode:
      input.participants.length > 2 ? "layered_depth" : "rule_of_thirds",
    visual_anchor: screenPosition,
    negative_space: "look_room",
    composition_transition:
      previousSpeaker && previousSpeaker !== row.speaker
        ? "mirror_reverse"
        : "match_eye_trace",
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
    return {
      decisions: createRuleDecisions(input),
      blocking: createDefaultBlocking(input),
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
      ? "先建立完整群像，普通镜头至少承载两句台词，不因说话人变化立即切镜，并在强调处收紧至单人近景"
      : "建立镜头后使用轴线内正反打，普通镜头至少承载两句台词，不因说话人变化立即切镜",
  };
}

export function createRuleDecisions(input: DirectorInput): DirectorDecision[] {
  let previousSpeaker: ParticipantSlot | null = null;
  const dialogueIndexById = new Map(
    input.dialogue.map((line, index) => [line.dialogue_id, index]),
  );
  const rawDecisions = input.dialogue.map((row, index) => {
    const decision = decisionFor(row, index, previousSpeaker, input);
    previousSpeaker = row.speaker;
    return decision;
  });
  const entryDialogueIds = new Set(
    input.participants.map((participant) =>
      defaultEntryDialogueId(input, participant.first_dialogue_id),
    ),
  );
  const lastDialogueIds = new Set(
    input.participants.map((participant) => participant.last_dialogue_id),
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
      lastDialogueIds.has(input.dialogue[index - 1].dialogue_id));

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
  return drafts.map(
    ({ decision, retainedForTiming, startIndex, endIndex }) => {
      const segmentDecisions = rawDecisions.slice(startIndex, endIndex + 1);
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
          const activeAlternative = input.participants.find((participant) => {
            const entryId = defaultEntryDialogueId(
              input,
              participant.first_dialogue_id,
            );
            return (
              participant.slot !== previousVisualSubject &&
              (dialogueIndexById.get(entryId) ?? Number.POSITIVE_INFINITY) <=
                endIndex
            );
          });
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
              visual_anchor: visualAnchorFor(
                activeAlternative.slot,
                input,
              ),
              intent: `${selected.intent} 保留另一位在场角色的反应，避免连续镜头重复同一主体。`,
            };
          }
        }
      }

      const selectedSubject =
        selected.subject === "both" || selected.subject === "group"
          ? null
          : selected.subject;
      previousVisualSubject = selectedSubject;
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
