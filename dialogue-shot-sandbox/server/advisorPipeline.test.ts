import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { routeRuleAdvisorRequest } from "./ruleAdvisorBridge";
import { createDirectorInput } from "../src/director/contracts";
import { findDialogueSequence } from "../src/data/dialogueRepository";
import { demoDatabase } from "../src/data/demo";

const nativeFetch = globalThis.fetch;
let server: Server;
let baseUrl: string;
let model: ReturnType<typeof vi.fn<typeof fetch>>;
const sequence = findDialogueSequence(demoDatabase, "2048");

beforeEach(async () => {
  vi.stubEnv("RULE_ADVISOR_API_STYLE", "openai");
  vi.stubEnv("RULE_ADVISOR_ENABLED", "1");
  vi.stubEnv("DIRECTOR_PREFERENCE_LIBRARY_DISABLED", "1");
  vi.stubEnv("RULE_ADVISOR_BASE_URL", "http://model.test/v1");
  model = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", model);
  server = createServer((req, res) => { void routeRuleAdvisorRequest(req, res); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function modelResponse(data: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }));
}

function beat(start = sequence.rows[0].id) {
  return {
    schema_version: "rule-beat.v1", request_id: "advisor-result", summary: "保持关系",
    beats: [{ start_dialogue_id: start, end_dialogue_id: sequence.rows.at(-1)!.id,
      narrative_function: "development", intensity: 40,
      coverage_strategy: "relationship_hold", reason: "同一观看重点" }],
  };
}

async function post(requestId: string, force = false) {
  return nativeFetch(`${baseUrl}/api/rule-advisor/beats`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: createDirectorInput(sequence, requestId), force_regenerate: force,
    }),
  });
}

it("rebinds cached beats to each run and does not retain invalid coverage", async () => {
  model.mockResolvedValueOnce(modelResponse(beat("missing")));
  expect((await post("invalid", true)).status).toBe(503);
  model.mockResolvedValueOnce(modelResponse(beat()));
  expect((await (await post("first")).json()).data.request_id).toBe("first");
  expect((await (await post("second")).json()).data.request_id).toBe("second");
  expect(model).toHaveBeenCalledTimes(2);
  model.mockResolvedValueOnce(modelResponse(beat()));
  await post("forced", true);
  expect(model).toHaveBeenCalledTimes(3);
});

it("aborts the model request when the client disconnects", async () => {
  let started!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  let cancelled!: () => void;
  const cancellation = new Promise<void>((resolve) => { cancelled = resolve; });
  model.mockImplementation(async (_url, init) => {
    started();
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => {
        cancelled();
        reject(new DOMException("Cancelled", "AbortError"));
      }, { once: true });
    });
  });
  const controller = new AbortController();
  const response = nativeFetch(`${baseUrl}/api/rule-advisor/beats`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
    body: JSON.stringify({ input: createDirectorInput(sequence, "disconnect"), force_regenerate: true }),
  }).catch((error: Error) => error);
  await start;
  controller.abort();
  await cancellation;
  expect(await response).toMatchObject({ name: "AbortError" });
});
