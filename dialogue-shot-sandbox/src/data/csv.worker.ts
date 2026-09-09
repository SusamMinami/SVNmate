import {
  parseDialogueDatabasePayload,
  type DialogueCsvPayload,
} from "./csv";
import type {
  DialogueCsvWorkerRequest,
  DialogueCsvWorkerResponse,
} from "./csvWorkerProtocol";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<DialogueCsvWorkerRequest>) => void) | null;
  postMessage: (response: DialogueCsvWorkerResponse) => void;
};

async function readPayload(request: DialogueCsvWorkerRequest): Promise<DialogueCsvPayload> {
  if (request.kind === "configured") {
    const response = await fetch("/api/ue/config-data/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json().catch(() => null) as {
      ok?: boolean;
      data?: DialogueCsvPayload;
      error?: { message?: string };
    } | null;
    if (!response.ok || !result?.ok || !result.data) {
      throw new Error(
        result?.error?.message ||
          `已保存的数据目录读取失败（HTTP ${response.status}）`,
      );
    }
    return result.data;
  }
  const payload: DialogueCsvPayload = {
    sourceName: request.sourceName,
    dialogueText: "", startText: "", npcText: "", modelText: "",
    missionText: "", dungeonMissionText: "", missionPositionText: "",
    mapConfigText: "", mapResourceText: "", careerText: "",
  };
  await Promise.all(
    Object.entries(request.files).map(async ([key, file]) => {
      payload[key as Exclude<keyof DialogueCsvPayload, "sourceName">] =
        file ? await file.text() : "";
    }),
  );
  return payload;
}

workerScope.onmessage = async (event) => {
  try {
    workerScope.postMessage({
      ok: true,
      database: parseDialogueDatabasePayload(await readPayload(event.data)),
    });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : "CSV 解析失败",
    });
  }
};
