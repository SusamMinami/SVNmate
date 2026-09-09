import type { DialogueDatabase } from "../types";
import type { DialogueCsvPayload } from "./csv";

export type DialogueCsvFiles = Partial<
  Record<Exclude<keyof DialogueCsvPayload, "sourceName">, File>
>;

export type DialogueCsvWorkerRequest =
  | { kind: "configured" }
  | { kind: "files"; files: DialogueCsvFiles; sourceName: string };

export type DialogueCsvWorkerResponse =
  | { ok: true; database: DialogueDatabase }
  | { ok: false; message: string };
