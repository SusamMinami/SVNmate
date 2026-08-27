import {
  parseDialogueDatabasePayload,
  type DialogueCsvPayload,
} from "./csv";
import type { DialogueDatabase } from "../types";

type DialogueCsvWorkerResponse =
  | { ok: true; database: DialogueDatabase }
  | { ok: false; message: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<DialogueCsvPayload>) => void) | null;
  postMessage: (response: DialogueCsvWorkerResponse) => void;
};

workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({
      ok: true,
      database: parseDialogueDatabasePayload(event.data),
    });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : "CSV 解析失败",
    });
  }
};
