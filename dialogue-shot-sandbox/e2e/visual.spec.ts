import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

function imageMetrics(buffer: Buffer) {
  const png = PNG.sync.read(buffer);
  let minimum = 255;
  let maximum = 0;
  const colors = new Set<number>();

  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
      const offset = (png.width * y + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
      colors.add((red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4));
    }
  }

  return {
    luminanceSpan: maximum - minimum,
    sampledColors: colors.size,
  };
}

function changedPixelRatio(before: Buffer, after: Buffer): number {
  const first = PNG.sync.read(before);
  const second = PNG.sync.read(after);
  expect(second.width).toBe(first.width);
  expect(second.height).toBe(first.height);
  let sampled = 0;
  let changed = 0;

  for (let y = 0; y < first.height; y += 4) {
    for (let x = 0; x < first.width; x += 4) {
      const offset = (first.width * y + x) * 4;
      const difference =
        Math.abs(first.data[offset] - second.data[offset]) +
        Math.abs(first.data[offset + 1] - second.data[offset + 1]) +
        Math.abs(first.data[offset + 2] - second.data[offset + 2]);
      sampled += 1;
      if (difference > 24) {
        changed += 1;
      }
    }
  }

  return changed / sampled;
}

test("renders nonblank shot and blocking canvases without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "镜头沙盘" })).toBeVisible();
  await page.locator(".shot-row").nth(1).click();
  await page.locator(".viewport-panel").scrollIntoViewIfNeeded();
  const movementStart = await page.locator("canvas").first().screenshot();
  await page.waitForTimeout(1_200);
  const movementProgress = await page.locator("canvas").first().screenshot();
  expect(changedPixelRatio(movementStart, movementProgress)).toBeGreaterThan(
    0.005,
  );

  const canvases = page.locator("canvas");
  await expect(canvases).toHaveCount(2);
  const insetFrame = await page.locator(".top-view__canvas").boundingBox();
  const insetCanvas = await page
    .locator(".top-view__canvas canvas")
    .boundingBox();
  expect(insetFrame).not.toBeNull();
  expect(insetCanvas).not.toBeNull();
  expect(insetCanvas!.x).toBeCloseTo(insetFrame!.x, 1);
  expect(insetCanvas!.width).toBeCloseTo(insetFrame!.width, 1);
  expect(insetCanvas!.width / insetCanvas!.height).toBeCloseTo(16 / 9, 2);
  for (let index = 0; index < 2; index += 1) {
    const canvas = canvases.nth(index);
    await expect(canvas).toBeVisible();
    const metrics = imageMetrics(await canvas.screenshot());
    expect(metrics.luminanceSpan).toBeGreaterThan(24);
    expect(metrics.sampledColors).toBeGreaterThan(18);
  }
  const cameraFrame = await page.locator(".stage-main__frame").boundingBox();
  expect(cameraFrame).not.toBeNull();
  expect(cameraFrame!.width / cameraFrame!.height).toBeCloseTo(16 / 9, 1);
  await expect(page.locator(".ultrawide-frame").first()).toBeVisible();
  await expect(page.getByText("21:9")).toBeVisible();
  await expect(page.locator(".golden")).toHaveCount(4);
  await expect(page.getByText("黄金分割", { exact: true })).toBeVisible();
  await expect(page.getByText("渐进转移", { exact: true })).toBeVisible();
  await expect(page.getByText("个人强调", { exact: true })).toBeVisible();
  await expect(page.getByText("压缩亲密", { exact: true })).toBeVisible();
  await expect(page.getByText("浅景深", { exact: true })).toBeVisible();
  await expect(page.getByText("推近 · 轻微", { exact: true })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.screenshot({
    path: testInfo.outputPath("dialogue-shot-sandbox.png"),
    fullPage: true,
  });
});

test("renders every participant in a multi-character dialogue", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("四位数对话 ID").fill("3099");
  await page.getByRole("button", { name: "查找并生成分镜" }).click();

  await expect(page.getByText("双人建立镜头").first()).toBeVisible();
  for (const name of ["岑队长", "洛安", "弥莎", "赫克"]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
  await expect(page.getByText(/支持 2-12 人动态进出场/)).toBeVisible();
  await expect(page.locator(".cast-row")).toHaveCount(4);
  await expect(page.locator(".axis-status")).toContainText("关系轴 A-B");
  await expect(
    page.locator(".actor-label--on-body:not(.actor-label--below)"),
  ).toHaveCount(2);

  await page
    .getByRole("button", { name: /C 3人群像重建全景/ })
    .click();
  await expect(page.locator(".axis-status")).toContainText("群像总轴");
  await expect(
    page.locator(".actor-label--on-body:not(.actor-label--below)"),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: /D 4人群像重建全景/ })
    .click();
  await expect(page.locator(".axis-status")).toContainText("群像总轴");
  await expect(
    page.locator(".actor-label--on-body:not(.actor-label--below)"),
  ).toHaveCount(4);

  const canvases = page.locator("canvas");
  await expect(canvases).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    const metrics = imageMetrics(await canvases.nth(index).screenshot());
    expect(metrics.luminanceSpan).toBeGreaterThan(24);
    expect(metrics.sampledColors).toBeGreaterThan(18);
  }
});

test("removes a character after the AI-directed exit node", async ({
  page,
}) => {
  await page.route("**/api/trae/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          configured: true,
          connected: true,
          versionMismatch: false,
          expectedVersion: "0.15.0",
          serverVersion: "0.15.0",
          lastSeenAt: "2026-08-22T00:00:00.000Z",
          mcpName: "internal-storyboard-collaboration",
          mcpConfigPath: "C:\\workspace\\.trae\\mcp.json",
          skillName: "internal-storyboard-director",
          stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
        },
      }),
    });
  });
  await page.route("**/api/director/trae", async (route) => {
    const input = route.request().postDataJSON() as {
      request_id: string;
      participants: Array<{ slot: "A" | "B" | "C" | "D" }>;
      dialogue: Array<{
        dialogue_id: string;
        speaker: "A" | "B" | "C" | "D";
      }>;
    };
    const positions = [
      "front_left",
      "front_right",
      "back_left",
      "back_right",
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          schema_version: "shot-plan.v5",
          request_id: input.request_id,
          status: "ready",
          scene_analysis: {
            dramatic_goal: "小队成员汇报后离场确认风险。",
            emotional_progression: "警戒逐步转为协同行动。",
            visual_strategy: "在离场节点切镜并更新群体构图。",
          },
          blocking: {
            formation: "arc",
            intent: "侦察角色在完成警告后退出当前场面。",
            placements: input.participants.map((participant, index) => ({
              subject: participant.slot,
              position: positions[index],
              facing: "group_center",
              entry_dialogue_id:
                participant.slot === "C"
                  ? "309903"
                  : participant.slot === "D"
                    ? "309904"
                    : "309901",
              exit_dialogue_id:
                participant.slot === "C" ? "309903" : null,
              intent: `安排角色 ${participant.slot} 的进出场`,
            })),
          },
          shots: input.dialogue.map((line, index) => ({
            dialogue_ids: [line.dialogue_id],
            template:
              index === 0
                ? "master_two_shot"
                : index === 1
                  ? "reverse_medium"
                  : index === 2 || index === 3
                    ? "master_group_shot"
                    : "speaker_group_medium",
            subject:
              index === 0
                ? "both"
                : index === 2 || index === 3
                  ? "group"
                  : line.speaker,
            look_target:
              index === 0 || index === 2 || index === 3
                ? "group_center"
                : line.speaker === "A"
                  ? "B"
                  : "A",
            lens_mm: index === 0 ? 35 : 50,
            end_lens_mm: index === 0 ? 35 : 50,
            lens_intent: "natural_perspective",
            depth_of_field: index === 0 ? "deep" : "moderate",
            camera_movement: "static",
            movement_intensity: "none",
            camera_roll_degrees: 0,
            composition_mode: index === 0 ? "symmetry" : "center",
            visual_anchor: index === 0 ? "balanced" : "center",
            negative_space: index === 0 ? "balanced" : "look_room",
            composition_transition:
              index === 0 ? "recenter" : "match_eye_trace",
            coverage_intent:
              index === 0
                ? "establish_geography"
                : index === 2 || index === 3
                  ? "reestablish_geography"
                  : "individual_perspective",
            camera_height: "eye",
            intent: `覆盖进出场节点 ${line.dialogue_id}`,
          })),
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  await page.getByLabel("四位数对话 ID").fill("3099");
  await page.getByRole("button", { name: "查找并生成分镜" }).click();
  await page
    .getByRole("dialog", { name: "故事梗概" })
    .getByRole("button", { name: "进入分镜" })
    .click();

  await page
    .getByRole("button", { name: /03 C 3人群像重建全景/ })
    .click();
  await expect(
    page.locator(".stage-main .actor-label", { hasText: "弥莎" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".stage-main .actor-label", { hasText: "赫克" }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: /04 D 3人群像重建全景/ })
    .click();
  await expect(
    page.locator(".stage-main .actor-label", { hasText: "弥莎" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".stage-main .actor-label", { hasText: "赫克" }),
  ).toHaveCount(1);
});

test("switches the main canvas between shot and blocking views", async ({
  page,
}) => {
  await page.goto("/");

  const blockingPreview = page.getByRole("button", {
    name: "切换到俯视调度",
  });
  await expect(blockingPreview).toBeVisible();
  await blockingPreview.click();

  const shotPreview = page.getByRole("button", {
    name: "切换到镜头示意",
  });
  await expect(shotPreview).toBeVisible();
  await expect(page.locator(".shot-hud")).toContainText("俯视调度");
  await expect(page.locator(".actor-label--below")).toHaveCount(2);
  const switchedCanvases = page.locator("canvas");
  await expect(switchedCanvases).toHaveCount(2);
  const insetFrame = await page.locator(".top-view__canvas").boundingBox();
  const insetCanvas = await page
    .locator(".top-view__canvas canvas")
    .boundingBox();
  expect(insetFrame).not.toBeNull();
  expect(insetCanvas).not.toBeNull();
  expect(insetCanvas!.x).toBeCloseTo(insetFrame!.x, 1);
  expect(insetCanvas!.width).toBeCloseTo(insetFrame!.width, 1);
  expect(insetCanvas!.width / insetCanvas!.height).toBeCloseTo(16 / 9, 2);
  for (let index = 0; index < 2; index += 1) {
    const metrics = imageMetrics(
      await switchedCanvases.nth(index).screenshot(),
    );
    expect(metrics.luminanceSpan).toBeGreaterThan(24);
    expect(metrics.sampledColors).toBeGreaterThan(18);
  }
  await shotPreview.click();

  await expect(
    page.getByRole("button", { name: "切换到俯视调度" }),
  ).toBeVisible();
  await expect(page.locator(".shot-hud")).toContainText("双人建立镜头");
});

test("shows local content immediately and presents the AI story brief before applying it", async ({
  page,
}) => {
  let releaseDirector!: () => void;
  const directorGate = new Promise<void>((resolve) => {
    releaseDirector = resolve;
  });

  await page.route("**/api/trae/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          configured: true,
          connected: true,
          versionMismatch: false,
          expectedVersion: "0.15.0",
          serverVersion: "0.15.0",
          lastSeenAt: "2026-08-22T00:00:00.000Z",
          mcpName: "internal-storyboard-collaboration",
          mcpConfigPath: "C:\\workspace\\.trae\\mcp.json",
          skillName: "internal-storyboard-director",
          stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
        },
      }),
    });
  });
  await page.route("**/api/director/trae", async (route) => {
    const input = route.request().postDataJSON() as {
      request_id: string;
      dialogue: Array<{
        dialogue_id: string;
        speaker: "A" | "B";
      }>;
    };
    await directorGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          schema_version: "shot-plan.v5",
          request_id: input.request_id,
          status: "ready",
          scene_analysis: {
            dramatic_goal: "迫使隐瞒者说明钥匙真相。",
            emotional_progression: "试探逐步转为承认与合作。",
            visual_strategy: "由对峙全景逐步收紧到关键人物。",
          },
          blocking: {
            formation: "opposed_groups",
            intent: "让双方保持明确距离，体现尚未消除的戒备。",
            placements: [
              {
                subject: "A",
                position: "mid_left",
                facing: "B",
                entry_dialogue_id: input.dialogue[0].dialogue_id,
                exit_dialogue_id: null,
                intent: "A 主动面对 B。",
              },
              {
                subject: "B",
                position: "mid_right",
                facing: "A",
                entry_dialogue_id: input.dialogue[0].dialogue_id,
                exit_dialogue_id: null,
                intent: "B 保持回应距离。",
              },
            ],
          },
          shots: input.dialogue.map((line) => ({
            dialogue_ids: [line.dialogue_id],
            template: "close_up",
            subject: line.speaker,
            look_target: line.speaker === "A" ? "B" : "A",
            lens_mm: 55,
            end_lens_mm: 55,
            lens_intent: "subject_isolation",
            depth_of_field: "moderate",
            camera_movement: "static",
            movement_intensity: "none",
            camera_roll_degrees: 0,
            composition_mode: "rule_of_thirds",
            visual_anchor:
              line.speaker === "A" ? "left_third" : "right_third",
            negative_space: "look_room",
            composition_transition: "mirror_reverse",
            coverage_intent: "individual_perspective",
            camera_height: "eye",
            intent: "测试 AI 镜头。",
          })),
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  await page.getByRole("button", { name: "查找并生成分镜" }).click();

  await expect(page.locator(".section-label--sticky")).toContainText(
    "本地预览",
  );
  await expect(page.getByText(/围绕失踪的钥匙互相试探/)).toBeVisible();

  releaseDirector();
  const dialog = page.getByRole("dialog", { name: "故事梗概" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("迫使隐瞒者说明钥匙真相。")).toBeVisible();
  await expect(dialog.getByText("对峙分组")).toBeVisible();

  await dialog.getByRole("button", { name: "进入分镜" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/实际：内部 TRAE/)).toBeVisible();
  await expect(page.getByText("A 单人近景").first()).toBeVisible();
});

test("previews shared and local plans before resolving a library conflict", async ({
  page,
}, testInfo) => {
  let resolvedChoice = "";
  await page.route("**/api/trae/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          configured: true,
          connected: true,
          versionMismatch: false,
          expectedVersion: "0.15.0",
          serverVersion: "0.15.0",
          transport: "http",
          lastSeenAt: "2026-08-22T00:00:00.000Z",
          mcpName: "internal-storyboard-collaboration",
          mcpConfigPath: "C:\\workspace\\.trae\\mcp.json",
          skillName: "internal-storyboard-director",
          stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
        },
      }),
    });
  });
  await page.route("**/api/director/trae", async (route) => {
    const input = route.request().postDataJSON();
    const blocking = {
      formation: "opposed_groups",
      intent: "保持双方清晰的对景关系。",
      placements: input.participants.map(
        (participant: { slot: string }, index: number) => ({
          subject: participant.slot,
          position: index === 0 ? "mid_left" : "mid_right",
          facing: index === 0 ? "B" : "A",
          entry_dialogue_id: input.dialogue[0].dialogue_id,
          exit_dialogue_id: null,
          intent: `角色 ${participant.slot} 的测试站位。`,
        }),
      ),
    };
    const makePlan = (requestId: string, lens: number, goal: string) => ({
      schema_version: "shot-plan.v5",
      request_id: requestId,
      status: "ready",
      scene_analysis: {
        dramatic_goal: goal,
        emotional_progression: "由试探推进到合作。",
        visual_strategy: "普通镜头覆盖连续两句台词。",
      },
      blocking,
      shots: input.dialogue.map(
        (line: { dialogue_id: string; speaker: "A" | "B" }) => ({
          dialogue_ids: [line.dialogue_id],
          template: "close_up",
          subject: line.speaker,
          look_target: line.speaker === "A" ? "B" : "A",
          lens_mm: lens,
          end_lens_mm: lens,
          lens_intent:
            lens <= 50 ? "natural_perspective" : "subject_isolation",
          depth_of_field: "moderate",
          camera_movement: "static",
          movement_intensity: "none",
          camera_roll_degrees: 0,
          composition_mode: "rule_of_thirds",
          visual_anchor:
            line.speaker === "A" ? "left_third" : "right_third",
          negative_space: "look_room",
          composition_transition: "mirror_reverse",
          coverage_intent: "individual_perspective",
          camera_height: "eye",
          intent: goal,
        }),
      ),
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: makePlan(input.request_id, 55, "本地方案"),
        meta: {
          source: "generated",
          task_request_id: input.request_id,
          shared_conflict: {
            record_id: "rec_shared",
            input: { ...input, request_id: "shared-request" },
            plan: makePlan("shared-request", 42, "共享方案"),
          },
        },
      }),
    });
  });
  await page.route("**/api/trae/shared/resolve", async (route) => {
    resolvedChoice = route.request().postDataJSON().choice;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          accepted: true,
          choice: resolvedChoice,
          record_id: "rec_shared",
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  await page.getByRole("button", { name: "查找并生成分镜" }).click();

  const dialog = page.getByRole("dialog", {
    name: "预览并选择分镜方案",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "共享方案" }).click();
  await expect(
    dialog.getByRole("button", { name: "采用共享方案" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("shared-plan-conflict.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "本地方案" }).click();
  await dialog.getByRole("button", { name: "采用并覆盖共享库" }).click();

  await expect(dialog).toBeHidden();
  expect(resolvedChoice).toBe("local");
});

test("switches to Mira and visibly degrades when the bridge fails", async ({
  page,
}) => {
  await page.route("**/api/lark/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          cliAvailable: true,
          authorized: true,
          identity: "user",
          userName: "测试用户",
          openId: "ou_test",
          userStatus: "ready",
          missingScopes: [],
          miraBot: {
            openId: "ou_mira",
            name: "Mira",
            description: "",
            chatId: "oc_test",
          },
        },
      }),
    });
  });
  await page.route("**/api/lark/mira/discover", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          selected: {
            openId: "ou_mira",
            name: "Mira",
            description: "",
            chatId: "oc_test",
          },
          candidates: [],
        },
      }),
    });
  });
  await page.route("**/api/director/mira", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          code: "MIRA_TIMEOUT",
          message: "模拟 Mira 超时",
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Mira AI" }).click();
  await page.getByRole("button", { name: "查找并生成分镜" }).click();

  await expect(
    page.getByText(/已自动使用规则导演：模拟 Mira 超时/),
  ).toBeVisible();
  await expect(page.getByText(/实际：规则导演/)).toBeVisible();
  await expect(page.getByText(/规则导演（已降级）/)).toBeVisible();
});

test("switches to internal TRAE and visibly degrades when collaboration fails", async ({
  page,
}) => {
  await page.route("**/api/trae/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          configured: true,
          connected: true,
          lastSeenAt: "2026-08-22T00:00:00.000Z",
          mcpName: "internal-storyboard-collaboration",
          mcpConfigPath: "C:\\workspace\\.trae\\mcp.json",
          skillName: "internal-storyboard-director",
          stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
        },
      }),
    });
  });
  await page.route("**/api/director/trae", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          code: "TRAE_COLLABORATION_ERROR",
          message: "模拟内部 TRAE 协作超时",
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  await expect(page.getByText(/内部 TRAE MCP 已连接/)).toBeVisible();
  await page.getByRole("button", { name: "查找并生成分镜" }).click();

  await expect(
    page.getByText(/已自动使用规则导演：模拟内部 TRAE 协作超时/),
  ).toBeVisible();
  await expect(page.getByText(/实际：规则导演/)).toBeVisible();
  await expect(page.getByText(/规则导演（已降级）/)).toBeVisible();
});

test("explains that an old MCP must be restarted inside TRAE", async ({
  page,
}) => {
  await page.route("**/api/trae/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          configured: true,
          connected: false,
          versionMismatch: true,
          expectedVersion: "0.15.0",
          serverVersion: "0.13.0",
          transport: "stdio",
          lastSeenAt: "2026-08-23T04:19:22.608Z",
          mcpName: "internal-storyboard-collaboration",
          mcpConfigPath: "C:\\workspace\\.trae\\mcp.json",
          skillName: "internal-storyboard-director",
          stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "TRAE 协作" }).click();

  await expect(page.getByText("MCP 仍在运行旧版本")).toBeVisible();
  await expect(
    page.getByText(/当前 0\.13\.0 · 需要 0\.15\.0；请在 TRAE 中停用后重新启用/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "配置内部 TRAE MCP" }),
  ).toHaveAttribute("title", "查看 MCP 重启步骤");
});

test("shows the internal TRAE MCP configuration guide", async ({ page }) => {
  await page.route("**/api/trae/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          configured: false,
          connected: false,
          lastSeenAt: null,
          mcpName: "internal-storyboard-collaboration",
          mcpConfigPath: "C:\\workspace\\.trae\\mcp.json",
          skillName: "internal-storyboard-director",
          stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
        },
      }),
    });
  });
  await page.route("**/api/trae/mcp-config", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          config: {
            mcpServers: {
              "internal-storyboard-collaboration": {
                command: "node",
              },
            },
          },
          configText:
            '{\n  "mcpServers": {\n    "internal-storyboard-collaboration": {\n      "command": "node"\n    }\n  }\n}',
          configPath: "C:\\workspace\\.trae\\mcp.json",
          instructions: [
            "启用项目级 MCP",
            "粘贴配置",
            "启用 internal-storyboard-collaboration",
          ],
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  await page.getByRole("button", { name: "配置内部 TRAE MCP" }).click();

  const dialog = page.getByRole("dialog", {
    name: "连接分镜 MCP",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("pre")).toContainText(
    "internal-storyboard-collaboration",
  );
  await expect(dialog.getByRole("button", { name: "复制配置" })).toBeVisible();
});

test("opens the incremental Feishu authorization dialog", async ({ page }) => {
  let finishRequests = 0;
  await page.route("**/api/lark/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          cliAvailable: true,
          authorized: true,
          identity: "user",
          userName: "测试用户",
          openId: "ou_test",
          userStatus: "ready",
          missingScopes: ["search:bot", "im:message.send_as_user"],
          miraBot: null,
        },
      }),
    });
  });
  await page.route("**/api/lark/mira/discover", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          selected: {
            openId: "ou_mira",
            name: "Mira",
            description: "",
            chatId: "oc_test",
          },
          candidates: [],
        },
      }),
    });
  });
  await page.route("**/api/lark/auth/start", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          verificationUrl: "https://example.com/feishu-auth",
          qrDataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          expiresAt: Date.now() + 300_000,
          scopes: ["im:message.send_as_user"],
        },
      }),
    });
  });
  await page.route("**/api/lark/auth/finish", async (route) => {
    finishRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          cliAvailable: true,
          authorized: true,
          identity: "user",
          userName: "测试用户",
          openId: "ou_test",
          userStatus: "ready",
          missingScopes: [],
          miraBot: null,
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Mira AI" }).click();
  await page.getByRole("button", { name: "授权飞书" }).click();

  await expect(
    page.getByRole("dialog", { name: "连接 Mira AI 导演" }),
  ).toBeVisible();
  await expect(page.getByAltText("飞书授权二维码")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /在浏览器打开授权页/ }),
  ).toHaveAttribute("href", "https://example.com/feishu-auth");

  await page
    .getByRole("button", { name: "我已完成授权" })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    page.getByRole("dialog", { name: "连接 Mira AI 导演" }),
  ).toBeHidden();
  expect(finishRequests).toBe(1);
});
