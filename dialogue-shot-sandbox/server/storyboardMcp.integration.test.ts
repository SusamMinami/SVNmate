import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoDatabase } from "../src/data/demo";
import { findDialogueSequence } from "../src/data/dialogueRepository";
import {
  BLOCKING_POSITIONS,
  createDirectorInput,
} from "../src/director/contracts";
import {
  getStoryboardMcpPresence,
  recordStoryboardMcpActivity,
  startStoryboardMcpHeartbeat,
} from "./storyboardMcpHeartbeat";
import { routeStoryboardMcpRequest } from "../mcp/storyboardServer";
import {
  claimPendingStoryboardTask,
  completeStoryboardTask,
  createStoryboardTask,
  getStoryboardTask,
  storyboardInputContentHash,
} from "./storyboardTaskStore";
import {
  traeBridgePlugin,
  waitForCollaborationResult,
} from "./traeBridge";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const originalProjectRoot = process.env.STORYBOARD_PROJECT_ROOT;
const originalSharedLibraryDisabled =
  process.env.STORYBOARD_SHARED_LIBRARY_DISABLED;
let temporaryRoot = "";

beforeEach(() => {
  process.env.STORYBOARD_SHARED_LIBRARY_DISABLED = "1";
});

afterEach(async () => {
  if (originalProjectRoot === undefined) {
    delete process.env.STORYBOARD_PROJECT_ROOT;
  } else {
    process.env.STORYBOARD_PROJECT_ROOT = originalProjectRoot;
  }
  if (originalSharedLibraryDisabled === undefined) {
    delete process.env.STORYBOARD_SHARED_LIBRARY_DISABLED;
  } else {
    process.env.STORYBOARD_SHARED_LIBRARY_DISABLED =
      originalSharedLibraryDisabled;
  }
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5 });
    temporaryRoot = "";
  }
});

function validPlan(
  input: ReturnType<typeof createDirectorInput>,
): Record<string, unknown> {
  const isGroupDialogue = input.participants.length > 2;
  return {
    schema_version: "shot-plan.v5",
    request_id: input.request_id,
    status: "ready",
    scene_analysis: {
      dramatic_goal: "验证内部 TRAE MCP 任务闭环",
      emotional_progression: "从试探推进到合作",
      visual_strategy: "建立空间后按当前对话关系切换轴线",
    },
    blocking: {
      formation: isGroupDialogue ? "arc" : "opposed_groups",
      intent: "根据角色职能建立清晰关系和视线。",
      placements: input.participants.map((participant, index) => ({
        subject: participant.slot,
        position: BLOCKING_POSITIONS[index],
        facing: "group_center",
        entry_dialogue_id: input.dialogue[0].dialogue_id,
        exit_dialogue_id: null,
        intent: `安排角色 ${participant.slot} 的叙事位置`,
      })),
    },
    shots: input.dialogue.map((line, index) => ({
      dialogue_ids: [line.dialogue_id],
      template:
        index === 0
          ? isGroupDialogue
            ? "master_group_shot"
            : "master_two_shot"
          : isGroupDialogue
            ? "speaker_group_medium"
            : "reverse_medium",
      subject:
        index === 0
          ? isGroupDialogue
            ? "group"
            : "both"
          : line.speaker,
      look_target:
        index === 0
          ? "group_center"
          : input.participants.find(
              (participant) => participant.slot !== line.speaker,
            )?.slot,
      lens_mm: index === 0 ? (isGroupDialogue ? 28 : 35) : 50,
      end_lens_mm: index === 0 ? (isGroupDialogue ? 28 : 35) : 50,
      lens_intent:
        index === 0
          ? isGroupDialogue
            ? "spatial_context"
            : "natural_perspective"
          : "subject_isolation",
      depth_of_field: index === 0 ? "deep" : "moderate",
      camera_movement: "static",
      movement_intensity: "none",
      camera_roll_degrees: 0,
      composition_mode:
        index === 0
          ? isGroupDialogue
            ? "triangular"
            : "symmetry"
          : "rule_of_thirds",
      visual_anchor:
        index === 0
          ? "balanced"
          : line.speaker === "A"
            ? "left_third"
            : "right_third",
      negative_space: index === 0 ? "balanced" : "look_room",
      composition_transition:
        index === 0 ? "recenter" : "mirror_reverse",
      coverage_intent:
        index === 0
          ? "establish_geography"
          : isGroupDialogue
            ? "relationship"
            : "individual_perspective",
      camera_height: "eye",
      intent: `覆盖台词节点 ${line.dialogue_id}`,
    })),
  };
}

describe("internal storyboard MCP", () => {
  it("keeps HTTP presence when a temporary stdio session closes", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-presence-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    await recordStoryboardMcpActivity("http");
    const stopStdioHeartbeat = await startStoryboardMcpHeartbeat();

    await expect(getStoryboardMcpPresence()).resolves.toMatchObject({
      connected: true,
      transport: "http",
    });
    await stopStdioHeartbeat();
    await expect(getStoryboardMcpPresence()).resolves.toMatchObject({
      connected: true,
      transport: "http",
    });
  });

  it("exposes the storyboard tools over Streamable HTTP", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-http-mcp-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    await expect(getStoryboardMcpPresence()).resolves.toMatchObject({
      connected: false,
      transport: null,
    });
    const httpServer = createHttpServer(async (request, response) => {
      if (!(await routeStoryboardMcpRequest(request, response))) {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolvePromise) => {
      httpServer.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("测试 MCP 服务未绑定 TCP 端口");
    }
    const client = new Client({
      name: "storyboard-http-integration-test",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
    );

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "storyboard_get_pending_request",
          "storyboard_submit_plan",
          "storyboard_fail_request",
          "storyboard_get_request_status",
        ]),
      );
      await expect(getStoryboardMcpPresence()).resolves.toMatchObject({
        connected: true,
        compatible: true,
        transport: "http",
      });
    } finally {
      await client.close();
      await new Promise<void>((resolvePromise, reject) => {
        httpServer.close((error) =>
          error ? reject(error) : resolvePromise(),
        );
      });
    }
  });

  it(
    "completes the HTTP queue through the stdio MCP server",
    async () => {
      temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-mcp-"));
      process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
      const sequence = findDialogueSequence(demoDatabase, "3099");
      const input = createDirectorInput(sequence, "mcp-integration-request");
      const vite = await createServer({
        configFile: false,
        cacheDir: join(temporaryRoot, ".vite-cache"),
        plugins: [traeBridgePlugin()],
        server: { host: "127.0.0.1", port: 0 },
      });
      await vite.listen();
      const address = vite.httpServer?.address();
      if (!address || typeof address === "string") {
        throw new Error("测试服务器未绑定 TCP 端口");
      }
      const responsePromise = fetch(
        `http://127.0.0.1:${address.port}/api/director/trae`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
          join(projectRoot, "mcp", "storyboardServer.ts"),
        ],
        cwd: projectRoot,
        env: {
          ...getDefaultEnvironment(),
          STORYBOARD_PROJECT_ROOT: temporaryRoot,
        },
        stderr: "pipe",
      });
      const client = new Client({
        name: "storyboard-integration-test",
        version: "1.0.0",
      });

      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining([
            "storyboard_get_pending_request",
            "storyboard_submit_plan",
            "storyboard_fail_request",
            "storyboard_get_request_status",
          ]),
        );

        let presence = await getStoryboardMcpPresence();
        for (
          let attempt = 0;
          attempt < 20 && !presence.connected;
          attempt += 1
        ) {
          await new Promise((resolvePromise) =>
            setTimeout(resolvePromise, 50),
          );
          presence = await getStoryboardMcpPresence();
        }
        expect(presence.connected).toBe(true);
        expect(presence.compatible).toBe(true);
        expect(presence.serverVersion).toBe("0.16.2");
        expect(presence.transport).toBe("stdio");

        let claimed = await client.callTool({
          name: "storyboard_get_pending_request",
          arguments: {},
        });
        for (
          let attempt = 0;
          attempt < 10 &&
          (claimed.structuredContent as { found?: boolean } | undefined)
            ?.found !== true;
          attempt += 1
        ) {
          await new Promise((resolvePromise) =>
            setTimeout(resolvePromise, 50),
          );
          claimed = await client.callTool({
            name: "storyboard_get_pending_request",
            arguments: {},
          });
        }
        expect(claimed.structuredContent).toMatchObject({
          found: true,
          request_id: input.request_id,
        });

        let submitted = await client.callTool({
          name: "storyboard_submit_plan",
          arguments: {
            request_id: input.request_id,
            plan: validPlan(input),
          },
        });
        expect(submitted.isError).not.toBe(true);
        expect(submitted.structuredContent).toMatchObject({
          accepted: false,
          retry_required: true,
          request_id: input.request_id,
          revision_attempt: 1,
        });
        const failedShots = (
          submitted.structuredContent as {
            failed_shots?: Array<Record<string, unknown>>;
          }
        ).failed_shots;
        expect(failedShots?.length).toBeGreaterThan(0);
        expect(failedShots?.[0]).toMatchObject({
          shot_index: expect.any(Number),
          dialogue_ids: expect.any(Array),
          warnings: expect.any(Array),
          previous_decision: expect.any(Object),
        });

        const duplicateInitial = await client.callTool({
          name: "storyboard_submit_plan",
          arguments: {
            request_id: input.request_id,
            plan: validPlan(input),
          },
        });
        expect(duplicateInitial.structuredContent).toMatchObject({
          accepted: false,
          retry_required: true,
          revision_attempt: 1,
        });

        submitted = await client.callTool({
          name: "storyboard_submit_plan",
          arguments: {
            request_id: input.request_id,
            plan: validPlan(input),
            revision_attempt: 1,
          },
        });
        expect(submitted.isError).not.toBe(true);
        expect(submitted.structuredContent).toMatchObject({
          accepted: true,
          request_id: input.request_id,
          status: "completed",
          projection_validation: "failed_after_retry",
        });

        const response = await responsePromise;
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          ok: true,
          data: {
            schema_version: "shot-plan.v5",
            request_id: input.request_id,
            status: "ready",
          },
        });
        const completed = await getStoryboardTask(input.request_id);
        expect(completed?.status).toBe("completed");
        expect(completed?.result?.status).toBe("ready");

        const cachedInput = createDirectorInput(
          sequence,
          "mcp-cache-hit-request",
        );
        const cachedResponse = await fetch(
          `http://127.0.0.1:${address.port}/api/director/trae`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cachedInput),
          },
        );
        expect(cachedResponse.status).toBe(200);
        await expect(cachedResponse.json()).resolves.toMatchObject({
          ok: true,
          data: {
            request_id: cachedInput.request_id,
            status: "ready",
          },
        });
        expect(
          await getStoryboardTask(cachedInput.request_id),
        ).toBeNull();
      } finally {
        await client.close();
        await vite.close();
      }
    },
    20_000,
  );

  it("reuses an active task for identical dialogue input", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-dedupe-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const first = createDirectorInput(sequence, "dedupe-first-request");
    const second = createDirectorInput(sequence, "dedupe-second-request");

    const firstTask = await createStoryboardTask(first);
    const secondTask = await createStoryboardTask(second);

    expect(secondTask.requestId).toBe(firstTask.requestId);
    expect(await getStoryboardTask(second.request_id)).toBeNull();
  });

  it("keeps a queued task active when the UI wait expires", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-queue-timeout-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const input = createDirectorInput(
      findDialogueSequence(demoDatabase, "2048"),
      "queue-timeout-request",
    );
    await createStoryboardTask(input);

    await expect(
      waitForCollaborationResult(input.request_id, input.request_id, {
        queueTimeoutMs: 10,
        processingTimeoutMs: 100,
        pollIntervalMs: 1,
      }),
    ).rejects.toMatchObject({ code: "TRAE_QUEUE_TIMEOUT" });
    expect((await getStoryboardTask(input.request_id))?.status).toBe(
      "pending",
    );
  });

  it("keeps a claimed task active when the UI wait expires", async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "storyboard-processing-timeout-"),
    );
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const input = createDirectorInput(
      findDialogueSequence(demoDatabase, "2048"),
      "processing-timeout-request",
    );
    await createStoryboardTask(input);
    await claimPendingStoryboardTask();

    await expect(
      waitForCollaborationResult(input.request_id, input.request_id, {
        queueTimeoutMs: 100,
        processingTimeoutMs: 10,
        pollIntervalMs: 1,
      }),
    ).rejects.toMatchObject({ code: "TRAE_PROCESSING_TIMEOUT" });
    expect((await getStoryboardTask(input.request_id))?.status).toBe(
      "processing",
    );
  });

  it("keeps content hashes stable when JSON object keys are reordered", () => {
    const input = createDirectorInput(
      findDialogueSequence(demoDatabase, "2048"),
      "stable-hash-request",
    );
    const reordered = {
      constraints: input.constraints,
      adjacent_context: input.adjacent_context,
      dialogue: input.dialogue,
      participants: input.participants,
      outline: input.outline,
      start_id: input.start_id,
      dialogue_prefix: input.dialogue_prefix,
      schema_version: input.schema_version,
      request_id: "different-request",
    };

    expect(storyboardInputContentHash(reordered)).toBe(
      storyboardInputContentHash(input),
    );
  });

  it("rejects plans that do not cover every dialogue node in order", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-store-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const input = createDirectorInput(sequence, "coverage-validation-request");
    await createStoryboardTask(input);
    const plan = validPlan(input);
    const shots = plan.shots as Array<Record<string, unknown>>;
    plan.shots = shots.slice(1);

    await expect(
      completeStoryboardTask(input.request_id, plan),
    ).rejects.toThrow("按原顺序覆盖所有 dialogue_id");
    expect((await getStoryboardTask(input.request_id))?.status).toBe("pending");
  });

  it("rejects legacy plans without executable composition semantics", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-v2-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const input = createDirectorInput(sequence, "composition-schema-request");
    await createStoryboardTask(input);
    const plan = validPlan(input);
    plan.schema_version = "shot-plan.v3";

    await expect(
      completeStoryboardTask(input.request_id, plan),
    ).rejects.toThrow();
    expect((await getStoryboardTask(input.request_id))?.status).toBe("pending");
  });

  it("rejects plans without a relationship wide shot in the first three shots", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-opening-wide-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const input = createDirectorInput(sequence, "opening-wide-request");
    await createStoryboardTask(input);
    const plan = validPlan(input);
    const shots = plan.shots as Array<Record<string, unknown>>;
    Object.assign(shots[0], {
      template: "close_up",
      subject: "A",
      look_target: "B",
      coverage_intent: "individual_perspective",
    });

    await expect(
      completeStoryboardTask(input.request_id, plan),
    ).rejects.toThrow("前三个镜头必须至少包含一个");
    expect((await getStoryboardTask(input.request_id))?.status).toBe("pending");
  });

  it("rejects a tight shot when a new character enters", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-entry-wide-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const sequence = findDialogueSequence(demoDatabase, "3099");
    const input = createDirectorInput(sequence, "entry-wide-request");
    await createStoryboardTask(input);
    const plan = validPlan(input);
    const blocking = plan.blocking as {
      placements: Array<{
        subject: string;
        entry_dialogue_id: string;
      }>;
    };
    blocking.placements.find(
      (placement) => placement.subject === "C",
    )!.entry_dialogue_id = "309903";

    await expect(
      completeStoryboardTask(input.request_id, plan),
    ).rejects.toThrow("位于角色进出场边界");
    expect((await getStoryboardTask(input.request_id))?.status).toBe("pending");
  });

  it("rejects overlapping semantic character positions", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-blocking-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const sequence = findDialogueSequence(demoDatabase, "3099");
    const input = createDirectorInput(sequence, "blocking-validation-request");
    await createStoryboardTask(input);
    const plan = validPlan(input);
    const blocking = plan.blocking as {
      placements: Array<{ position: string }>;
    };
    blocking.placements[1].position = blocking.placements[0].position;

    await expect(
      completeStoryboardTask(input.request_id, plan),
    ).rejects.toThrow("position 不能重复");
    expect((await getStoryboardTask(input.request_id))?.status).toBe("pending");
  });

  it("rejects a single shot whose relationship target is the subject", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-axis-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const input = createDirectorInput(sequence, "axis-validation-request");
    await createStoryboardTask(input);
    const plan = validPlan(input);
    const shots = plan.shots as Array<{
      subject: string;
      look_target: string;
    }>;
    shots[1].look_target = shots[1].subject;

    await expect(
      completeStoryboardTask(input.request_id, plan),
    ).rejects.toThrow("不能看向自己");
    expect((await getStoryboardTask(input.request_id))?.status).toBe("pending");
  });

  it("rejects an entrance scheduled after the character first speaks", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-entry-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const sequence = findDialogueSequence(demoDatabase, "3099");
    const input = createDirectorInput(sequence, "entry-validation-request");
    await createStoryboardTask(input);
    const plan = validPlan(input);
    const blocking = plan.blocking as {
      placements: Array<{
        subject: string;
        entry_dialogue_id: string;
      }>;
    };
    const participantC = blocking.placements.find(
      (placement) => placement.subject === "C",
    );
    participantC!.entry_dialogue_id = "309904";

    await expect(
      completeStoryboardTask(input.request_id, plan),
    ).rejects.toThrow("不能晚于首次发言");
    expect((await getStoryboardTask(input.request_id))?.status).toBe("pending");
  });

  it("rejects an exit scheduled before the character last speaks", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-exit-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const sequence = findDialogueSequence(demoDatabase, "3099");
    const input = createDirectorInput(sequence, "exit-validation-request");
    await createStoryboardTask(input);
    const plan = validPlan(input);
    const blocking = plan.blocking as {
      placements: Array<{
        subject: string;
        exit_dialogue_id: string | null;
      }>;
    };
    const participantA = blocking.placements.find(
      (placement) => placement.subject === "A",
    );
    participantA!.exit_dialogue_id = "309904";

    await expect(
      completeStoryboardTask(input.request_id, plan),
    ).rejects.toThrow("离场不能早于最后发言");
    expect((await getStoryboardTask(input.request_id))?.status).toBe("pending");
  });

  it("accepts an exit after the character's final line", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "storyboard-valid-exit-"));
    process.env.STORYBOARD_PROJECT_ROOT = temporaryRoot;
    const sequence = findDialogueSequence(demoDatabase, "3099");
    const input = createDirectorInput(sequence, "valid-exit-request");
    await createStoryboardTask(input);
    const plan = validPlan(input);
    const blocking = plan.blocking as {
      placements: Array<{
        subject: string;
        exit_dialogue_id: string | null;
      }>;
    };
    const participantC = blocking.placements.find(
      (placement) => placement.subject === "C",
    );
    participantC!.exit_dialogue_id = "309903";
    const shots = plan.shots as Array<{
      template: string;
      subject: string;
      look_target: string;
      composition_mode: string;
      visual_anchor: string;
      negative_space: string;
      composition_transition: string;
      coverage_intent: string;
    }>;
    Object.assign(shots[3], {
      template: "master_group_shot",
      subject: "group",
      look_target: "group_center",
      composition_mode: "triangular",
      visual_anchor: "balanced",
      negative_space: "balanced",
      composition_transition: "recenter",
      coverage_intent: "reestablish_geography",
    });

    const task = await completeStoryboardTask(input.request_id, plan);

    expect(task.status).toBe("completed");
    expect(task.result).toMatchObject({
      status: "ready",
      blocking: {
        placements: expect.arrayContaining([
          expect.objectContaining({
            subject: "C",
            exit_dialogue_id: "309903",
          }),
        ]),
      },
    });
  });
});
