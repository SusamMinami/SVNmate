import { z } from "zod";
import type { CharacterBodyProfile, DialogueParticipant, Vec3 } from "../types";

export const CharacterBodyProfileSchema = z.object({
  source: z.enum(["mesh_bounds", "default"]),
  meshPath: z.string().max(1024),
  height: z.number().finite().min(0.05).max(100),
  width: z.number().finite().min(0.01).max(100),
  depth: z.number().finite().min(0.01).max(100),
  footOffset: z.tuple([
    z.number().finite(), z.number().finite(), z.number().finite(),
  ]).readonly(),
  landmarkSource: z.literal("proportional"),
});

export const DEFAULT_CHARACTER_BODY: CharacterBodyProfile = {
  source: "default",
  meshPath: "",
  height: 2.01,
  width: 0.68,
  depth: 0.48,
  footOffset: [0, 0, 0],
  landmarkSource: "proportional",
};

const validatedBodies = new WeakMap<CharacterBodyProfile, CharacterBodyProfile>();

export function characterBody(
  participant: Pick<DialogueParticipant, "bodyProfile">,
): CharacterBodyProfile {
  if (!participant.bodyProfile) return DEFAULT_CHARACTER_BODY;
  const cached = validatedBodies.get(participant.bodyProfile);
  if (cached) return cached;
  const parsed = CharacterBodyProfileSchema.safeParse(participant.bodyProfile);
  const body = parsed.success ? parsed.data : DEFAULT_CHARACTER_BODY;
  validatedBodies.set(participant.bodyProfile, body);
  return body;
}

export function characterPoint(
  participant: DialogueParticipant,
  referenceHeight: number,
  right = 0,
  forward = 0,
): Vec3 {
  const body = characterBody(participant);
  const yaw = Math.atan2(
    participant.facingTarget[0] - participant.position[0],
    participant.facingTarget[2] - participant.position[2],
  );
  const x = body.footOffset[0] + right;
  const z = body.footOffset[2] + forward;
  return [
    participant.position[0] + Math.cos(yaw) * x + Math.sin(yaw) * z,
    participant.position[1] + body.footOffset[1] +
      referenceHeight * body.height / DEFAULT_CHARACTER_BODY.height,
    participant.position[2] - Math.sin(yaw) * x + Math.cos(yaw) * z,
  ];
}

export function characterHeight(
  participant: DialogueParticipant,
  referenceHeight: number,
): number {
  return characterPoint(participant, referenceHeight)[1];
}

export function characterBodySummary(participant: DialogueParticipant): string {
  const body = characterBody(participant);
  return `${body.source === "mesh_bounds" ? "模型包围盒" : "默认估算"} ${Math.round(body.height * 100)} cm · 眼高按比例估算`;
}
