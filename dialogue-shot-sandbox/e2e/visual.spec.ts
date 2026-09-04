import { mkdir, writeFile } from "node:fs/promises";
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

async function writeDirectoryFixture(
  directory: string,
  files: Array<{ name: string; content: string }>,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  await Promise.all(
    files.map((file) =>
      writeFile(`${directory}/${file.name}`, file.content, "utf8"),
    ),
  );
  return directory;
}

function silentWavBuffer(durationMs = 400): Buffer {
  const sampleRate = 8_000;
  const sampleCount = Math.ceil((sampleRate * durationMs) / 1_000);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/lark/music/catalog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          entries: [],
          revision: 0,
          syncedAt: null,
          unmappedCount: 0,
          missingAttachmentCount: 0,
          analyzedCount: 0,
        },
      }),
    });
  });
  await page.route(
    "**/api/ue/sound-effects/preview-info",
    async (route) => {
      const request = route.request().postDataJSON() as {
        assetName: string;
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            assetName: request.assetName,
            available: false,
            reason: "测试环境未配置 Wwise 试听资源",
            durationSeconds: null,
            mediaCount: 0,
          },
        }),
      });
    },
  );
});

test("shows the launch screen once per window session", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const launchScreen = page.locator(".launch-screen");
  await expect(launchScreen).toBeVisible();
  await expect(launchScreen.getByRole("heading", { name: "镜头 沙盘" }))
    .toBeVisible();
  await expect(launchScreen.getByRole("status")).toHaveText("Loading");
  await page.waitForTimeout(700);
  await launchScreen.screenshot({
    path: testInfo.outputPath("launch-screen.png"),
  });

  await expect(launchScreen).toHaveCount(0, { timeout: 3_000 });

  await page.reload();
  await expect(page.locator(".launch-screen")).toHaveCount(0);
  await expect(page.locator(".stage-view")).toBeVisible();
  const rail = page.locator(".app-rail");
  expect((await rail.boundingBox())!.width).toBeLessThanOrEqual(60);
  await page.getByRole("button", { name: "注册 NPC" }).hover();
  await page.waitForTimeout(350);
  expect((await rail.boundingBox())!.width).toBeGreaterThan(180);
});

test("provides button morph and viewport pointer feedback", async ({
  page,
}) => {
  await page.goto("/");

  const analyzeButton = page.getByRole("button", {
    name: "分析对话与站位",
  });
  const markerBefore = await analyzeButton.evaluate(
    (element) => getComputedStyle(element, "::before").clipPath,
  );
  await analyzeButton.hover();
  await page.waitForTimeout(240);
  const markerAfter = await analyzeButton.evaluate(
    (element) => getComputedStyle(element, "::before").clipPath,
  );
  expect(markerAfter).not.toBe(markerBefore);

  const stage = page.locator(".stage-main");
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.3,
    bounds!.y + bounds!.height * 0.4,
  );
  const probe = page.locator(".stage-pointer-probe");
  await expect(probe).toHaveAttribute("data-active", "true");
  const firstValue = await probe.locator("span").textContent();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.7,
    bounds!.y + bounds!.height * 0.6,
  );
  await page.waitForTimeout(140);
  expect(await probe.locator("span").textContent()).not.toBe(firstValue);
  await page.mouse.move(10, 10);
  await expect(probe).toHaveAttribute("data-active", "false");
});

test("keeps rail icons fixed and slides between workspace levels", async ({
  page,
}) => {
  await page.goto("/");

  const hoveredShot = page.locator(".shot-row").nth(1);
  const shotNumber = hoveredShot.locator(".shot-row__number");
  const shotNumberBefore = await shotNumber.boundingBox();
  await hoveredShot.hover();
  await page.waitForTimeout(220);
  expect(await shotNumber.boundingBox()).toEqual(shotNumberBefore);

  const rail = page.locator(".app-rail");
  const npcButton = page.getByRole("button", { name: "注册 NPC" });
  const npcIcon = npcButton.locator("svg");
  const iconBefore = await npcIcon.boundingBox();
  const frameBefore = await npcButton.evaluate(
    (element) => getComputedStyle(element, "::after").opacity,
  );

  await rail.hover();
  await page.waitForTimeout(320);
  await npcButton.hover();
  await page.waitForTimeout(220);
  const iconAfter = await npcIcon.boundingBox();
  const frameAfter = await npcButton.evaluate((element) => ({
    opacity: getComputedStyle(element, "::after").opacity,
    transform: getComputedStyle(element, "::after").transform,
  }));
  expect(iconAfter).toEqual(iconBefore);
  expect(frameBefore).toBe("0");
  expect(frameAfter.opacity).toBe("1");
  expect(frameAfter.transform).toContain("matrix(1");

  await npcButton.click({ position: { x: 22, y: 22 } });
  await expect(page.getByRole("heading", { name: "注册 NPC" })).toBeVisible();
  await expect(page.locator(".header-context")).toHaveCount(0);
  await expect(page.locator(".npc-registration-modal > header")).toHaveCount(0);
  await expect(
    page.locator(".tool-workspace:not([hidden]) .workspace-floating-actions button"),
  ).toHaveCount(2);
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-workspace-direction",
    "up",
  );
  await expect(
    page.locator('[data-workspace-state="entering"]'),
  ).toHaveCSS(
    "animation-name",
    "workspace-page-enter-up",
  );
  await expect(
    page.locator('[data-workspace-state="exiting"]'),
  ).toHaveCSS(
    "animation-name",
    "workspace-page-exit-up",
  );
  await page.waitForTimeout(320);
  const enteringPage = page.locator('[data-workspace-state="entering"]');
  const exitingPage = page.locator('[data-workspace-state="exiting"]');
  const enteringMotion = await enteringPage.evaluate((element) => ({
    shadow: getComputedStyle(element).boxShadow,
    y: new DOMMatrixReadOnly(getComputedStyle(element).transform).m42,
  }));
  const exitingY = await exitingPage.evaluate(
    (element) =>
      new DOMMatrixReadOnly(getComputedStyle(element).transform).m42,
  );
  expect(enteringMotion.shadow).not.toBe("none");
  expect(enteringMotion.y).toBeGreaterThan(100);
  expect(exitingY).toBeLessThan(-100);
  await page.waitForTimeout(460);
  await expect(page.locator('[data-workspace-state="exiting"]')).toHaveCount(0);

  const refreshButton = page.locator(
    '.tool-workspace:not([hidden]) .workspace-floating-command',
  );
  await refreshButton.hover();
  await page.waitForTimeout(220);
  await expect(refreshButton).toHaveCSS("background-color", "rgb(56, 56, 56)");
  expect(await refreshButton.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  )).not.toContain("rgb(255, 250, 0)");

  await page.getByRole("button", { name: "分镜工作台", exact: true }).click({
    position: { x: 22, y: 22 },
  });
  await expect(page.getByRole("heading", { name: "分镜工作台" })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-workspace-direction",
    "down",
  );
  await expect(
    page.locator('[data-workspace-state="entering"]'),
  ).toHaveCSS(
    "animation-name",
    "workspace-page-enter-down",
  );
  await expect(
    page.locator('[data-workspace-state="exiting"]'),
  ).toHaveCSS(
    "animation-name",
    "workspace-page-exit-down",
  );
});

test("renders nonblank shot and blocking canvases without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "分镜工作台" })).toBeVisible();
  await page.locator(".shot-row").nth(1).click();
  await expect(page.locator(".stage-transition")).toHaveCSS(
    "animation-name",
    "stage-curtain-out",
  );
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
  const insetActors = await page
    .locator(".top-view .actor-label")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.x + bounds.width / 2;
      }),
    );
  expect(insetActors).toHaveLength(2);
  expect(
    (Math.max(...insetActors) - Math.min(...insetActors)) /
      insetFrame!.width,
  ).toBeGreaterThan(0.3);
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
  await expect(page.getByRole("region", { name: "场景角色" })).toBeVisible();
  await expect(page.locator(".stage-cast__item")).toHaveCount(2);
  await expect(page.locator(".stage-cast__heading")).toHaveCount(0);
  await expect(page.locator(".left-panel .cast-section")).toHaveCount(0);
  await expect(page.locator(".ultrawide-frame").first()).toBeVisible();
  await expect(page.getByText("21:9")).toBeVisible();
  await expect(page.locator(".golden")).toHaveCount(4);
  await expect(
    page.locator(".left-panel").getByText("剧情梗概"),
  ).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "摄影" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "构图" })).toHaveCount(0);
  const storyOutline = page.getByRole("button", { name: /剧情梗概/ });
  await expect(storyOutline).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByText(/围绕失踪的钥匙互相试探/),
  ).toHaveCount(0);
  await storyOutline.click();
  await expect(storyOutline).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByText(/围绕失踪的钥匙互相试探/),
  ).toBeVisible();
  await page.getByRole("tab", { name: "镜头" }).click();
  await expect(page.getByText("摄影参数", { exact: true })).toBeVisible();
  await expect(page.getByText("构图策略", { exact: true })).toBeVisible();
  await expect(page.getByText("浅景深", { exact: true })).toBeVisible();
  await expect(page.getByText("推近 · 轻微", { exact: true })).toBeVisible();
  await expect(page.getByText("压缩亲密", { exact: true })).toBeVisible();
  await expect(page.getByText("黄金分割", { exact: true })).toBeVisible();
  await expect(page.getByText("渐进转移", { exact: true })).toBeVisible();
  await expect(page.getByText("个人强调", { exact: true })).toBeVisible();
  await expect(
    page.getByText("前向视线空间", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("0.41 / 0.19", { exact: true })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.locator(".shot-row").nth(2).click();
  await expect(page.getByText("固定机位", { exact: true })).toBeVisible();
  await expect(page.getByText("0.39 / 0.17", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "导演" }).click();
  await expect(
    page.getByText(/普通停顿不会被额外解释为孤立|不额外推断孤立/),
  ).toBeVisible();

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
  await page.getByRole("button", { name: "分析对话与站位" }).click();

  await expect(page.locator(".shot-row")).toHaveCount(3);
  for (const name of ["玩家", "岑队长", "洛安", "弥莎", "赫克"]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
  await expect(page.getByText(/未绑定 UE Blueprint 站位/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "需绑定 BP 站位" }),
  ).toBeDisabled();
  await expect(page.locator(".stage-cast__item")).toHaveCount(5);
  const firstCastItem = page.locator(".stage-cast__item").first();
  await expect(firstCastItem).toHaveAttribute("tabindex", "0");
  await expect(firstCastItem).toHaveAttribute(
    "aria-label",
    /槽位 0 · 玩家 · 背景 NPC · 在场/,
  );
  const castList = page.locator(".stage-cast__list");
  await expect(castList.locator(".stage-cast__item > span")).toHaveText([
    "0",
    "1",
    "2",
    "3",
    "4",
  ]);
  await expect(castList).toHaveCSS("scrollbar-width", "none");
  await castList.evaluate((element) => {
    element.style.maxWidth = "180px";
  });
  const castBounds = await castList.boundingBox();
  expect(castBounds).not.toBeNull();
  await page.mouse.move(
    castBounds!.x + castBounds!.width - 8,
    castBounds!.y + castBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    castBounds!.x + 20,
    castBounds!.y + castBounds!.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect.poll(() =>
    castList.evaluate((element) => element.scrollLeft),
  ).toBeGreaterThan(0);
  await expect(page.locator(".stage-cast__item").last()).toBeInViewport();
  await expect(page.locator(".axis-status")).toContainText("关系轴 B-C");
  await expect(
    page.locator(".actor-label--on-body:not(.actor-label--below)"),
  ).toHaveCount(3);

  await page
    .getByRole("button", { name: /3 3人群像重建全景/ })
    .click();
  await expect(page.locator(".axis-status")).toContainText("群像总轴");
  await expect(
    page.locator(".actor-label--on-body:not(.actor-label--below)"),
  ).toHaveCount(4);
  await page
    .getByRole("button", { name: /4 4人群像重建全景/ })
    .click();
  await expect(page.locator(".axis-status")).toContainText("群像总轴");
  await expect(
    page.locator(".actor-label--on-body:not(.actor-label--below)"),
  ).toHaveCount(5);

});

test("previews future entrants as transparent blocking markers", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("四位数对话 ID").fill("3099");
  await page.getByRole("button", { name: "分析对话与站位" }).click();

  await expect(page.locator(".stage-main .actor-label")).toHaveCount(3);
  await expect(page.locator(".top-view .actor-label")).toHaveCount(5);
  await expect(page.locator(".top-view .actor-label--pending")).toHaveCount(2);
  await expect(
    page.locator(".top-view .actor-label--pending", { hasText: "弥莎" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".top-view .actor-label--pending", { hasText: "赫克" }),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "切换到俯视调度" }).click();
  await expect(page.locator(".stage-main .actor-label")).toHaveCount(5);
  await expect(page.locator(".stage-main .actor-label--pending")).toHaveCount(
    2,
  );
  await expect(page.locator(".shot-hud")).toContainText(
    "3 人在场 · 2 人未登场",
  );

  await page
    .getByRole("button", { name: /3 3人群像重建全景/ })
    .click();
  await expect(page.locator(".stage-main .actor-label--pending")).toHaveCount(
    1,
  );
  await expect(page.locator(".shot-hud")).toContainText(
    "4 人在场 · 1 人未登场",
  );

  await page
    .getByRole("button", { name: /4 4人群像重建全景/ })
    .click();
  await expect(page.locator(".stage-main .actor-label--pending")).toHaveCount(
    0,
  );
  await expect(page.locator(".shot-hud")).toContainText("5 人均已登场");
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
          expectedVersion: "0.16.1",
          serverVersion: "0.16.1",
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
      participants: Array<{ slot: "A" | "B" | "C" | "D" | "E" }>;
      dialogue: Array<{
        dialogue_id: string;
        speaker: "A" | "B" | "C" | "D";
      }>;
    };
    const positions = [
      "front_left",
      "front_right",
      "mid_center",
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
                participant.slot === "D"
                  ? "309903"
                  : participant.slot === "E"
                    ? "309904"
                    : "309901",
              exit_dialogue_id:
                participant.slot === "D" ? "309903" : null,
              intent: `安排角色 ${participant.slot} 的进出场`,
            })),
          },
          sound_effects: [],
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
                : line.speaker === "B"
                  ? "C"
                  : "B",
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
  await page.getByLabel("四位数对话 ID").fill("3099");
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  await page.getByRole("button", { name: "分析对话与站位" }).click();

  await page
    .getByRole("button", { name: /03 3 3人群像重建全景/ })
    .click();
  await expect(
    page.locator(".stage-main .actor-label", { hasText: "弥莎" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".stage-main .actor-label", { hasText: "赫克" }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: /04 4 3人群像重建全景/ })
    .click();
  await expect(
    page.locator(".stage-main .actor-label", { hasText: "弥莎" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".top-view .actor-label", { hasText: "弥莎" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".stage-main .actor-label", { hasText: "赫克" }),
  ).toHaveCount(1);
});

test("switches the main canvas between shot and blocking views", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const blockingPreview = page.getByRole("button", {
    name: "切换到俯视调度",
  });
  const viewModeButton = page.locator(".top-view");
  const shotIndicatorBefore = await page.locator(".stage-sequence").boundingBox();
  const stageStatusBefore = await page.locator(".shot-hud").boundingBox();
  await expect(blockingPreview).toBeVisible();
  await blockingPreview.click();
  await expect(viewModeButton).toHaveAttribute("aria-pressed", "true");
  const shotIndicatorAfter = await page.locator(".stage-sequence").boundingBox();
  const stageStatusAfter = await page.locator(".shot-hud").boundingBox();
  expect(shotIndicatorBefore).not.toBeNull();
  expect(stageStatusBefore).not.toBeNull();
  expect(shotIndicatorAfter!.x).toBeCloseTo(shotIndicatorBefore!.x, 1);
  expect(shotIndicatorAfter!.y).toBeCloseTo(shotIndicatorBefore!.y, 1);
  expect(stageStatusAfter!.x).toBeCloseTo(stageStatusBefore!.x, 1);
  expect(stageStatusAfter!.y).toBeCloseTo(stageStatusBefore!.y, 1);

  const shotPreview = page.getByRole("button", {
    name: "切换到镜头示意",
  });
  await expect(shotPreview).toBeVisible();
  await expect(page.locator(".shot-hud")).toContainText("俯视调度");
  await expect(page.locator(".actor-label--below")).toHaveCount(2);
  const firstActorBefore = await page
    .locator(".stage-main .actor-label--below")
    .first()
    .boundingBox();
  await page.locator(".shot-row").nth(1).click();
  const firstActorAfter = await page
    .locator(".stage-main .actor-label--below")
    .first()
    .boundingBox();
  expect(firstActorBefore).not.toBeNull();
  expect(firstActorAfter).not.toBeNull();
  expect(firstActorAfter!.x).toBeCloseTo(firstActorBefore!.x, 1);
  expect(firstActorAfter!.y).toBeCloseTo(firstActorBefore!.y, 1);
  const switchedCanvases = page.locator("canvas");
  await expect(switchedCanvases).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    const metrics = imageMetrics(
      await switchedCanvases.nth(index).screenshot(),
    );
    expect(metrics.luminanceSpan).toBeGreaterThan(24);
    expect(metrics.sampledColors).toBeGreaterThan(18);
  }
  await page.screenshot({
    path: testInfo.outputPath("blocking-view-unified-hud.png"),
    fullPage: true,
  });
  await page.locator(".shot-row").first().click();
  await shotPreview.click();

  await expect(
    page.getByRole("button", { name: "切换到俯视调度" }),
  ).toBeVisible();
  await expect(page.locator(".shot-hud")).toContainText("双人建立镜头");
});

test("keeps configuration mode active while switching shots", async ({
  page,
}, testInfo) => {
  const requestedWindowModes: Array<{
    enabled: boolean;
    contentSize?: { width: number; height: number };
  }> = [];
  await page.exposeFunction(
    "__recordConfigurationWindowMode",
    (
      enabled: boolean,
      contentSize?: { width: number; height: number },
    ) => {
      requestedWindowModes.push({ enabled, contentSize });
    },
  );
  await page.addInitScript(() => {
    const setupStatus = {
      firstRun: false,
      setupCompleted: true,
      version: "0.22.8",
      packaged: true,
      portable: false,
      runtimeBundled: true,
      traeDetected: true,
      traeExecutable: "C:\\Test\\Trae.exe",
      integrationInstalled: true,
      integrationRoot: "C:\\Test\\Shot Sandbox\\trae-integration",
      mcpConnected: true,
      mcpVersion: "test",
      expectedMcpVersion: "test",
      defaultDataReady: true,
      liveDataReady: false,
      configDataReady: false,
      liveResDirectory: "",
      configDocDirectory: "",
      liveCsvDirectory: "",
      configCsvDirectory: "",
      missionTargetTablePath: "",
      ueConnected: true,
      ueMcpHost: "127.0.0.1",
      ueMcpPort: 12031,
      ueConnectionMessage: "已连接",
      updateSupported: false,
      updatePage: "https://example.com/update",
    };
    window.shotSandboxDesktop = {
      getSetupStatus: async () => setupStatus,
      getConfigurationWindowMode: async () => false,
      setConfigurationWindowMode: async (
        enabled: boolean,
        contentSize?: { width: number; height: number },
      ) => {
        await (
          window as typeof window & {
            __recordConfigurationWindowMode: (
              value: boolean,
              nextContentSize?: { width: number; height: number },
            ) => Promise<void>;
          }
        ).__recordConfigurationWindowMode(enabled, contentSize);
        return enabled;
      },
    } as unknown as NonNullable<Window["shotSandboxDesktop"]>;
  });
  await page.goto("/");
  const fullPanelBounds = await page.locator(".right-panel").boundingBox();
  const fullHeaderBounds = await page.locator(".app-header").boundingBox();
  expect(fullPanelBounds).not.toBeNull();
  expect(fullHeaderBounds).not.toBeNull();
  await page.getByRole("button", { name: "进入配置小窗" }).click();
  await expect.poll(() => requestedWindowModes.length).toBe(1);
  expect(requestedWindowModes[0]).toEqual({
    enabled: true,
    contentSize: {
      width: Math.round(fullPanelBounds!.width),
      height: Math.round(fullPanelBounds!.height + fullHeaderBounds!.height),
    },
  });

  const appShell = page.locator(".app-shell");
  await expect(appShell).toHaveAttribute("data-configuration-mode", "true");
  await expect(appShell).toHaveAttribute(
    "data-configuration-transition",
    "false",
  );
  await expect(page.locator(".app-header")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "协作连接状态" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "数据源状态" }),
  ).toBeDisabled();
  await expect(page.locator(".left-panel")).toBeHidden();
  await expect(page.locator(".viewport-panel")).toBeHidden();
  await expect(page.getByRole("tab", { name: "导演" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "镜头" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "音频" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "UE" })).toBeVisible();

  await page.getByRole("button", { name: "下一个镜头" }).click();
  await expect(page.locator(".inspector-header")).toContainText("SHOT 02 / 04");
  await expect(page.getByRole("tab", { name: "音频" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "上一个镜头" }).click();
  await expect(page.locator(".inspector-header")).toContainText("SHOT 01 / 04");

  await page.setViewportSize({
    width: Math.round(fullPanelBounds!.width),
    height: Math.round(fullPanelBounds!.height + fullHeaderBounds!.height),
  });
  const compactPanelBounds = await page.locator(".right-panel").boundingBox();
  expect(compactPanelBounds).not.toBeNull();
  expect(compactPanelBounds!.width).toBeCloseTo(fullPanelBounds!.width, 1);
  expect(compactPanelBounds!.height).toBeCloseTo(fullPanelBounds!.height, 1);
  await page.getByRole("tab", { name: "UE" }).click();
  await expect(page.getByRole("tab", { name: "UE" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "音频" }).click();
  await expect(page.getByRole("tab", { name: "音频" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".inspector-tab-panel")).toHaveCSS(
    "animation-name",
    "none",
  );
  const audioLibrary = page.locator(".audio-library-browser");
  await expect(audioLibrary).toBeVisible();
  await audioLibrary
    .getByRole("button", { name: /音效资料库/ })
    .click();
  await audioLibrary
    .locator(".audio-library-browser__categories button")
    .first()
    .click();
  const resourceList = audioLibrary.locator(
    ".audio-library-browser__resources",
  );
  await expect(resourceList).toBeVisible();
  await expect(resourceList).toHaveCSS("overflow-y", "visible");
  await expect(page.locator(".inspector-tab-panel")).toHaveCSS(
    "overflow-y",
    "auto",
  );
  await page.waitForTimeout(350);
  await page.screenshot({
    path: testInfo.outputPath("configuration-window.png"),
    fullPage: true,
  });
  await audioLibrary
    .getByRole("combobox", { name: "资料库资源应用节点" })
    .selectOption("204802");
  const compactApplySoundEffect = resourceList.getByRole("button", {
    name: "应用资料库音效 A_SFX_Dialog_516301 到节点 204802",
  });
  await expect(compactApplySoundEffect).toHaveCount(0);
  await resourceList
    .getByRole("button", {
      name: "试听资料库音效 A_SFX_Dialog_516301",
    })
    .click();
  await expect(compactApplySoundEffect).toBeVisible();
  await compactApplySoundEffect.click();
  const appliedSoundEffectNode = page.getByRole("combobox", {
    name: "音效 A_SFX_Dialog_516301 的对话节点",
  });
  await expect(appliedSoundEffectNode).toHaveValue("204802");
  await page
    .getByRole("spinbutton", {
      name: "音效 A_SFX_Dialog_516301 的延迟",
    })
    .fill("0.4");

  await page.getByRole("button", { name: "返回完整窗口" }).click();
  await expect.poll(() => requestedWindowModes.length).toBe(2);
  expect(requestedWindowModes[1]).toEqual({
    enabled: false,
    contentSize: undefined,
  });
  await expect(appShell).toHaveAttribute("data-configuration-mode", "false");
  await expect(page.getByRole("tab", { name: "导演" })).toBeVisible();
});

test("shows local content while TRAE works and applies the completed plan directly", async ({
  page,
}, testInfo) => {
  let formationRequests = 0;
  let directorRequests = 0;
  let soundOnlyExportRequest: Record<string, unknown> | null = null;
  let musicPreviewRequests = 0;
  let soundPreviewRequests = 0;
  let releaseDirector!: () => void;
  const directorGate = new Promise<void>((resolve) => {
    releaseDirector = resolve;
  });

  await page.unroute("**/api/lark/music/catalog");
  await page.route("**/api/lark/music/catalog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          entries: [
            {
              recordId: "recSincere",
              name: "情绪-真诚",
              stateName: "Sincere",
              stateId: 18,
              tags: ["日常轻松"],
              notes: "温馨可爱，事件解决，圆满和平",
              fileToken: "fileSincere",
              fileName: "sincere.wav",
              analysis: {
                estimatedBpm: 78,
                bpmSource: "音频估算",
                tempoConfidence: 0.72,
                integratedLufs: -22,
                loudnessRangeLu: 7,
                truePeakDbfs: -1,
                dynamicRangeDb: 12,
                spectralCentroidHz: 1_100,
                lowFrequencyRatio: 0.3,
                midFrequencyRatio: 0.5,
                highFrequencyRatio: 0.2,
                tempoLevel: "慢",
                energyLevel: "低",
                brightness: "偏暗",
                summary: "慢速、低能量、音色偏暗",
              },
            },
          ],
          revision: 206,
          syncedAt: "2026-08-27T16:00:00.000Z",
          unmappedCount: 0,
          missingAttachmentCount: 0,
          analyzedCount: 1,
        },
      }),
    });
  });
  await page.route("**/api/lark/music/file?**", async (route) => {
    musicPreviewRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: silentWavBuffer(10_000),
    });
  });
  await page.unroute("**/api/ue/sound-effects/preview-info");
  await page.route(
    "**/api/ue/sound-effects/preview-info",
    async (route) => {
      const request = route.request().postDataJSON() as {
        assetName: string;
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            assetName: request.assetName,
            available: true,
            reason: "已找到 UE/Wwise 试听媒体",
            durationSeconds: 6.98,
            mediaCount: 1,
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/sound-effects/preview-prepare",
    async (route) => {
      const request = route.request().postDataJSON() as {
        assetName: string;
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            assetName: request.assetName,
            available: true,
            reason: "已找到 UE/Wwise 试听媒体",
            durationSeconds: 6.98,
            mediaCount: 1,
            url: `/api/ue/sound-effects/preview-file?assetName=${request.assetName}`,
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/sound-effects/preview-file?**",
    async (route) => {
      soundPreviewRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: silentWavBuffer(),
      });
    },
  );
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
          expectedVersion: "0.16.1",
          serverVersion: "0.16.1",
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
    directorRequests += 1;
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
          sound_effects: [
            {
              dialogue_id: input.dialogue[0].dialogue_id,
              asset_name: "A_SFX_Dialog_516918",
              category: "special",
              reason: "画外系统警报预告封锁区危险升级。",
            },
          ],
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
  await page.route("**/api/ue/formation/read", async (route) => {
    formationRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { status: "not_found", message: "未找到测试 BP" },
      }),
    });
  });
  await page.route("**/api/ue/storyboard/inspect", async (route) => {
    const request = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          reviewToken: "a".repeat(64),
          dialogueId: "2048",
          startId: "204800",
          dialogueAssetPath: "/Game/Test/204800.204800",
          formationAssetPath: "",
          cameraName: "",
          shotCount: 0,
          changedNodeCount: 0,
          overwrittenNodeCount: 0,
          clearedNodeCount: 0,
          soundEffectCount: request.soundEffects.length,
          changedSoundEffectCount: request.soundEffects.length,
          replacedSoundEffectCount: 0,
          invalidShotCount: 0,
          globalBlockedReasons: [],
          blockedReasons: [],
          warnings: [],
          shots: [],
          nodes: [],
          soundEffects: request.soundEffects.map(
            (
              soundEffect: { dialogueId: string; assetName: string },
              soundEffectIndex: number,
            ) => ({
              soundEffectIndex,
              ...soundEffect,
              resolvedAssetPath: `/Game/Audio/${soundEffect.assetName}.${soundEffect.assetName}`,
              existingAssetPath: "",
              action: "add",
            }),
          ),
        },
      }),
    });
  });
  await page.route("**/api/ue/storyboard/export", async (route) => {
    soundOnlyExportRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "exported",
          dialogueId: "2048",
          startId: "204800",
          dialogueAssetPath: "/Game/Test/204800.204800",
          changedNodeCount: 0,
          changedSoundEffectCount: 1,
          saved: true,
        },
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  await expect(
    page.locator(".left-panel").getByText("收集返修案例"),
  ).toHaveCount(0);
  const providerStatus = page.getByRole("button", {
    name: "协作连接状态",
  });
  const dataSourceStatus = page.getByRole("button", {
    name: "数据源状态",
  });
  await expect(providerStatus).toBeVisible();
  await expect(
    page.getByRole("button", { name: "返修案例状态" }),
  ).toHaveCount(0);
  const statusIcons = page.locator(
    ".app-header__status > div > .workspace-status-icon",
  );
  await expect(statusIcons).toHaveCount(2);
  const [providerBox, dataSourceBox] = await Promise.all([
    statusIcons.nth(0).boundingBox(),
    statusIcons.nth(1).boundingBox(),
  ]);
  expect(
    Math.round(
      (dataSourceBox?.x ?? 0) -
        (providerBox?.x ?? 0) -
        (providerBox?.width ?? 0),
    ),
  ).toBe(6);
  await providerStatus.hover();
  await expect(page.getByText("内部 TRAE MCP 已连接")).toBeVisible();
  await dataSourceStatus.click();
  await expect(page.getByRole("checkbox", { name: /收集返修案例/ }))
    .toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "数据源配置" }),
  ).toContainText("返修案例库已连接");
  await expect(
    page.getByRole("dialog", { name: "数据源配置" }),
  ).not.toContainText("实时数据");
  await expect(
    page.getByRole("dialog", { name: "数据源配置" }),
  ).not.toContainText("配置文档");
  await expect(
    page.getByRole("dialog", { name: "数据源配置" }),
  ).not.toContainText("目标物表");
  await page.screenshot({
    path: testInfo.outputPath("header-status-popover.png"),
    fullPage: true,
  });
  await page.locator(".viewport-toolbar").click();
  await expect(
    page.getByRole("dialog", { name: "数据源配置" }),
  ).toHaveCount(0);

  await expect(page.locator(".section-label--sticky")).toContainText(
    "本地预览",
  );
  await expect(
    page.getByRole("button", { name: /剧情梗概/ }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(directorRequests).toBe(1);
  expect(formationRequests).toBe(0);

  const thirdLocalShot = page.locator(".shot-row").nth(2);
  await thirdLocalShot.click();
  await expect(thirdLocalShot).toHaveClass(/is-active/);
  const ruleDirectorButton = page.getByRole("button", {
    name: "规则导演",
  });
  await expect(ruleDirectorButton).toBeEnabled();
  await ruleDirectorButton.click();
  await expect(ruleDirectorButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".shot-row").nth(2)).toHaveClass(/is-active/);
  expect(directorRequests).toBe(1);

  releaseDirector();
  await expect(
    page.getByRole("dialog", { name: "对比 AI 与当前占位" }),
  ).toHaveCount(0);
  const completedTraeButton = page.getByRole("button", {
    name: "TRAE 协作",
  });
  await expect(completedTraeButton).toBeEnabled();
  await completedTraeButton.click();
  await expect(page.getByText(/实际：内部 TRAE/)).toBeVisible();
  await expect(page.locator(".shot-row").nth(2)).toHaveClass(/is-active/);
  await page.locator(".shot-row").first().click();
  await expect(page.getByText("A 单人近景").first()).toBeVisible();
  await page.getByRole("tab", { name: "导演" }).click();
  await expect(page.locator(".sound-effect-list")).toHaveCount(0);
  await expect(page.locator(".music-recommendation-list")).toHaveCount(0);
  await page.getByRole("tab", { name: "音频" }).click();
  await expect(page.locator(".sound-effect-list")).toContainText(
    "A_SFX_Dialog_516918",
  );
  await expect(page.locator(".sound-effect-list")).toContainText(
    "画外系统警报预告封锁区危险升级。",
  );
  const audioLibrary = page.locator(".audio-library-browser");
  await audioLibrary
    .getByRole("button", { name: /音效资料库/ })
    .click();
  await expect(
    audioLibrary.getByRole("group", { name: "音效分类" }),
  ).toBeVisible();
  await expect(
    audioLibrary.getByRole("list", { name: "特殊音效" }),
  ).toHaveCount(0);
  await audioLibrary.getByRole("button", { name: /特殊/ }).click();
  const soundLibraryList = audioLibrary.getByRole("list", {
    name: "特殊音效",
  });
  await expect(soundLibraryList).toContainText("A_SFX_Dialog_516918");
  const applySoundEffect = soundLibraryList.getByRole("button", {
    name: "应用资料库音效 A_SFX_Dialog_516918 到节点 204801",
  });
  await expect(applySoundEffect).toHaveCount(0);
  await soundLibraryList
    .getByRole("button", {
      name: "试听资料库音效 A_SFX_Dialog_516918",
    })
    .click();
  await expect.poll(() => soundPreviewRequests).toBe(1);
  await expect(applySoundEffect).toBeVisible();
  await applySoundEffect.click();
  await expect(applySoundEffect).toHaveAttribute("aria-pressed", "true");

  await audioLibrary
    .getByRole("button", { name: /音乐资料库/ })
    .click();
  await expect(
    audioLibrary.getByRole("group", { name: "音乐分类" }),
  ).toBeVisible();
  await expect(
    audioLibrary.getByRole("list", { name: "日常轻松音乐" }),
  ).toHaveCount(0);
  await audioLibrary.getByRole("button", { name: /日常轻松/ }).click();
  const musicLibraryList = audioLibrary.getByRole("list", {
    name: "日常轻松音乐",
  });
  await expect(musicLibraryList).toContainText("情绪-真诚");
  const libraryMusicItem = musicLibraryList
    .getByRole("listitem")
    .filter({ hasText: "情绪-真诚" });
  await audioLibrary.screenshot({
    path: testInfo.outputPath("audio-library-browser.png"),
  });
  const applyMusic = musicLibraryList.getByRole("button", {
    name: "应用资料库音乐 情绪-真诚 到节点 204801",
  });
  await expect(applyMusic).toHaveCount(0);
  await musicLibraryList
    .getByRole("button", { name: "试听资料库音乐 情绪-真诚" })
    .click();
  await expect.poll(() => musicPreviewRequests).toBe(1);
  await expect(libraryMusicItem).toHaveClass(/is-playing/);
  await expect(libraryMusicItem).toHaveAttribute("aria-current", "true");
  await expect(libraryMusicItem).toHaveCSS(
    "background-color",
    "rgb(255, 253, 232)",
  );
  await expect(applyMusic).toBeVisible();
  await applyMusic.click();
  await expect(applyMusic).toHaveAttribute("aria-pressed", "true");

  const soundPreviewButton = page.getByRole("button", {
    name: "试听音效 A_SFX_Dialog_516918",
  });
  await expect(soundPreviewButton).toBeEnabled();
  await soundPreviewButton.click();
  await expect.poll(() => soundPreviewRequests).toBe(2);
  await expect(libraryMusicItem).not.toHaveClass(/is-playing/);
  await page
    .getByRole("spinbutton", {
      name: "音效 A_SFX_Dialog_516918 的延迟",
    })
    .fill("0.6");
  await expect(page.locator(".music-recommendation-list")).toContainText(
    "情绪-真诚",
  );
  await expect(page.locator(".music-recommendation-list")).toContainText(
    "慢速、低能量、音色偏暗",
  );
  await page.getByRole("button", { name: "试听配乐 情绪-真诚" }).click();
  await expect.poll(() => musicPreviewRequests).toBe(2);
  const recommendedMusicItem = page
    .locator(".music-recommendation-list > div")
    .filter({ hasText: "情绪-真诚" });
  await expect(recommendedMusicItem).toHaveClass(/is-playing/);
  await expect(recommendedMusicItem).toHaveAttribute("aria-current", "true");
  await expect(libraryMusicItem).not.toHaveClass(/is-playing/);
  await libraryMusicItem
    .getByRole("button", {
      name: "试听资料库音乐 情绪-真诚",
    })
    .click();
  await expect.poll(() => musicPreviewRequests).toBe(3);
  await expect(recommendedMusicItem).not.toHaveClass(/is-playing/);
  await expect(
    page.getByRole("button", { name: "试听配乐 情绪-真诚" }),
  ).toBeVisible();
  await expect(libraryMusicItem).toHaveClass(/is-playing/);
  await page.locator(".right-panel").screenshot({
    path: testInfo.outputPath("audio-playback-highlight.png"),
  });
  await page.locator(".shot-row").nth(1).click();
  await expect(page.locator(".music-recommendations")).toContainText("沿用中");
  await expect(page.locator(".music-recommendation-list")).toContainText(
    "沿用自节点 204801",
  );
  await page.locator(".shot-row").first().click();
  await page.locator(".right-panel").screenshot({
    path: testInfo.outputPath("director-sound-effect-recommendations.png"),
  });
  await page.getByRole("button", { name: "写入本镜音效" }).click();
  const soundExportDialog = page.getByRole("dialog", {
    name: "写入当前分镜音效 01",
  });
  await expect(soundExportDialog).toBeVisible();
  await expect(
    soundExportDialog.getByRole("checkbox", {
      name: "选择音效 A_SFX_Dialog_516918",
    }),
  ).toBeChecked();
  await expect(soundExportDialog).toContainText("0.6s");
  await expect(soundExportDialog.getByText("镜头数据")).toHaveCount(0);
  await expect(soundExportDialog).toContainText("尚未连接 UE");
  await soundExportDialog
    .getByRole("button", { name: "检查所选内容" })
    .click();
  await soundExportDialog
    .getByLabel(
      /已核对 0 个镜头节点、 0 组角色动作、 1 个音效和 0 首音乐/,
    )
    .check();
  await soundExportDialog
    .getByRole("button", { name: "确认写入并保存" })
    .click();
  await expect(
    soundExportDialog.getByText(
      "已写入 0 个镜头节点、0 组角色动作、1 个音效和 0 首音乐并保存",
    ),
  ).toBeVisible();
  expect(soundOnlyExportRequest).toMatchObject({
    usesBlueprintFormation: false,
    dialogueIds: [],
    shots: [],
    soundEffects: [
      {
        dialogueId: "204801",
        assetName: "A_SFX_Dialog_516918",
        delaySeconds: 0.6,
      },
    ],
    music: [],
  });
  await soundExportDialog.getByRole("button", { name: "完成" }).click();
  await page.locator(".shot-row").nth(1).click();
  await expect(page.locator(".sound-effect-list")).toHaveCount(0);
  await expect(
    page.getByText("当前分镜内容没有与现有目录充分匹配的音效。"),
  ).toBeVisible();
});

test("manages the pending TRAE queue from the status popover", async ({
  page,
}, testInfo) => {
  let queue = [
    {
      requestId: "queue-a",
      dialogueId: "3001",
      outline: "第一段待处理剧情",
      firstLine: "第一段台词",
      dialogueCount: 4,
      participantNames: ["玩家", "甲"],
      createdAt: "2026-08-27T01:00:00.000Z",
    },
    {
      requestId: "queue-b",
      dialogueId: "3002",
      outline: "第二段待处理剧情",
      firstLine: "第二段台词",
      dialogueCount: 6,
      participantNames: ["玩家", "乙"],
      createdAt: "2026-08-27T01:01:00.000Z",
    },
  ];
  const reorderedRequests: string[][] = [];
  const deletedRequests: string[] = [];
  const cancelledRequests: string[] = [];
  let processingTask: {
    requestId: string;
    status: "processing";
    dialogueId: string;
    outline: string;
    firstLine: string;
    dialogueCount: number;
    participantNames: string[];
    createdAt: string;
    updatedAt: string;
  } | null = {
    requestId: "processing-c",
    status: "processing",
    dialogueId: "3003",
    outline: "正在生成的剧情",
    firstLine: "处理中台词",
    dialogueCount: 5,
    participantNames: ["玩家", "丙"],
    createdAt: "2026-08-27T01:02:00.000Z",
    updatedAt: "2026-08-27T01:03:00.000Z",
  };
  await page.addInitScript(() => {
    window.sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
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
          expectedVersion: "0.19.0",
          serverVersion: "0.19.0",
          transport: "http",
          lastSeenAt: "2026-08-27T01:02:00.000Z",
          mcpName: "internal-storyboard-collaboration",
          mcpConfigPath: "C:\\workspace\\.trae\\mcp.json",
          skillName: "internal-storyboard-director",
          stats: {
            pending: queue.length,
            processing: processingTask ? 1 : 0,
            completed: 0,
            failed: 0,
            cancelled: processingTask ? 0 : 1,
          },
          queue,
          tasks: [
            ...queue.map((task) => ({ ...task, status: "pending" })),
            ...(processingTask ? [processingTask] : []),
          ],
        },
      }),
    });
  });
  await page.route("**/api/trae/queue/reorder", async (route) => {
    const request = route.request().postDataJSON() as {
      request_ids: string[];
    };
    reorderedRequests.push(request.request_ids);
    const byId = new Map(queue.map((task) => [task.requestId, task]));
    queue = request.request_ids.map((requestId) => byId.get(requestId)!);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: queue }),
    });
  });
  await page.route("**/api/trae/queue/delete", async (route) => {
    const request = route.request().postDataJSON() as {
      request_id: string;
    };
    deletedRequests.push(request.request_id);
    queue = queue.filter((task) => task.requestId !== request.request_id);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { requestId: request.request_id },
      }),
    });
  });
  await page.route("**/api/trae/tasks/cancel", async (route) => {
    const request = route.request().postDataJSON() as {
      request_id: string;
    };
    cancelledRequests.push(request.request_id);
    processingTask = null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          requestId: request.request_id,
          status: "cancelled",
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "协作连接状态" }).click();
  const statusDialog = page.getByRole("dialog", { name: "协作连接状态" });
  await expect(statusDialog).toBeVisible();
  await expect(
    statusDialog.getByRole("button", { name: "关闭状态详情" }),
  ).toHaveCount(0);
  const queueItems = statusDialog.locator(".workspace-status-queue li");
  await expect(queueItems).toHaveCount(3);
  await expect(queueItems.nth(0)).toContainText("对话 3001");
  await expect(queueItems.nth(2)).toContainText("处理中");
  await statusDialog.screenshot({
    path: testInfo.outputPath("trae-pending-queue.png"),
  });

  await queueItems.nth(0).dragTo(queueItems.nth(1));
  await expect.poll(() => reorderedRequests.length).toBe(1);
  expect(reorderedRequests[0]).toEqual(["queue-b", "queue-a"]);
  await expect(queueItems.nth(0)).toContainText("对话 3002");

  page.once("dialog", async (dialog) => dialog.dismiss());
  await statusDialog
    .getByRole("button", { name: "删除待处理分镜 3002" })
    .click();
  expect(deletedRequests).toEqual([]);
  await expect(queueItems).toHaveCount(3);

  page.once("dialog", async (dialog) => dialog.accept());
  await statusDialog
    .getByRole("button", { name: "删除待处理分镜 3002" })
    .click();
  await expect.poll(() => deletedRequests).toEqual(["queue-b"]);
  await expect(queueItems).toHaveCount(2);
  await expect(queueItems.first()).toContainText("对话 3001");

  page.once("dialog", async (dialog) => dialog.accept());
  await statusDialog
    .getByRole("button", { name: "中断正在处理分镜 3003" })
    .click();
  await expect.poll(() => cancelledRequests).toEqual(["processing-c"]);
  await expect(queueItems).toHaveCount(1);

  await page.locator(".viewport-toolbar").click();
  await expect(statusDialog).toHaveCount(0);
});

test("interrupts an active TRAE analysis from the storyboard", async ({
  page,
}, testInfo) => {
  let directorRequest: Record<string, unknown> | null = null;
  let cancelRequest: Record<string, unknown> | null = null;
  let releaseDirector!: () => void;
  const directorGate = new Promise<void>((resolve) => {
    releaseDirector = resolve;
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
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
          expectedVersion: "0.19.0",
          serverVersion: "0.19.0",
          transport: "http",
          lastSeenAt: "2026-08-29T01:02:00.000Z",
          mcpName: "internal-storyboard-collaboration",
          mcpConfigPath: "C:\\workspace\\.trae\\mcp.json",
          skillName: "internal-storyboard-director",
          stats: {
            pending: 0,
            processing: directorRequest ? 1 : 0,
            completed: 0,
            failed: 0,
            cancelled: cancelRequest ? 1 : 0,
          },
          queue: [],
          tasks: [],
        },
      }),
    });
  });
  await page.route("**/api/director/trae", async (route) => {
    directorRequest = route.request().postDataJSON();
    await directorGate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          code: "TRAE_TASK_CANCELLED",
          message: "用户在镜头沙盘中断了 TRAE 分镜分析",
        },
      }),
    });
  });
  await page.route("**/api/trae/tasks/cancel", async (route) => {
    cancelRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          requestId: cancelRequest?.request_id,
          status: "cancelled",
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  const cancelButton = page.getByRole("button", { name: "中断分析" });
  await expect(cancelButton).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("trae-active-cancel.png"),
  });

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("当前已显示的占位和分镜会保留");
    await dialog.accept();
  });
  await cancelButton.click();

  await expect.poll(() => cancelRequest).not.toBeNull();
  expect(cancelRequest).toMatchObject({
    request_id: directorRequest?.request_id,
    input: {
      request_id: directorRequest?.request_id,
      dialogue_prefix: "2048",
    },
  });
  await expect(page.locator(".director-loading")).toHaveCount(0);
  await expect(
    page.getByText("TRAE 分析已中断，当前占位和分镜已保留"),
  ).toBeVisible();
  await expect(page.locator(".shot-row")).not.toHaveCount(0);
  releaseDirector();
});

test("applies a cached TRAE plan and regenerates it without a second placement round", async ({
  page,
}) => {
  const requestUrls: string[] = [];
  const requestBodies: Array<{
    request_id: string;
    participants: Array<{
      slot: string;
      initial_position: [number, number, number];
    }>;
    dialogue: Array<{ dialogue_id: string; speaker: "A" | "B" }>;
    constraints: {
      preserve_input_formation?: boolean;
      lock_player_position?: boolean;
    };
  }> = [];
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
          expectedVersion: "0.19.0",
          serverVersion: "0.19.0",
          lastSeenAt: "2026-08-26T00:00:00.000Z",
          mcpName: "internal-storyboard-collaboration",
          mcpConfigPath: "C:\\workspace\\.trae\\mcp.json",
          skillName: "internal-storyboard-director",
          stats: { pending: 0, processing: 0, completed: 1, failed: 0 },
        },
      }),
    });
  });
  await page.route("**/api/director/trae*", async (route) => {
    requestUrls.push(route.request().url());
    const input = route.request().postDataJSON() as {
      request_id: string;
      participants: Array<{
        slot: string;
        initial_position: [number, number, number];
      }>;
      dialogue: Array<{ dialogue_id: string; speaker: "A" | "B" }>;
      constraints: {
        preserve_input_formation?: boolean;
        lock_player_position?: boolean;
      };
    };
    requestBodies.push(input);
    const requestNumber = requestUrls.length;
    const regenerated = requestNumber > 1;
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
            dramatic_goal:
              regenerated
                  ? "重新生成的 TRAE 方案"
                  : "已缓存的 TRAE 方案",
            emotional_progression: "由试探逐步推进到合作。",
            visual_strategy: "保持关系镜头后进入正反打。",
          },
          blocking: {
            formation: "opposed_groups",
            intent: "保持双方清晰的对景关系。",
            placements: input.participants.map((participant, index) => ({
              subject: participant.slot,
              position: index === 0 ? "mid_left" : "mid_right",
              facing: index === 0 ? "B" : "A",
              entry_dialogue_id: input.dialogue[0].dialogue_id,
              exit_dialogue_id: null,
              intent: `角色 ${participant.slot} 保持对景站位。`,
            })),
          },
          sound_effects: [],
          shots: input.dialogue.map((line, index) => ({
            dialogue_ids: [line.dialogue_id],
            template: index === 0 ? "master_two_shot" : "close_up",
            subject: index === 0 ? "both" : line.speaker,
            look_target:
              index === 0
                ? "group_center"
                : line.speaker === "A"
                  ? "B"
                  : "A",
            lens_mm: index === 0 ? 38 : regenerated ? 65 : 55,
            end_lens_mm: index === 0 ? 38 : regenerated ? 65 : 55,
            lens_intent:
              index === 0 ? "natural_perspective" : "subject_isolation",
            depth_of_field: index === 0 ? "deep" : "moderate",
            camera_movement: "static",
            movement_intensity: "none",
            camera_roll_degrees: 0,
            composition_mode: index === 0 ? "symmetry" : "rule_of_thirds",
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
                : "individual_perspective",
            camera_height: "eye",
            intent:
              regenerated
                  ? "强制重新生成。"
                  : "直接复用缓存。",
          })),
        },
        meta: {
          source: regenerated ? "generated" : "local-cache",
          task_request_id: input.request_id,
          shared_conflict: null,
        },
      }),
    });
  });

  await page.goto("/");
  const traeButton = page.getByRole("button", { name: "TRAE 协作" });
  await traeButton.click();

  await expect(page.getByText(/实际：内部 TRAE/)).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "对比 AI 与当前占位" }),
  ).toHaveCount(0);
  expect(new URL(requestUrls[0]).search).toBe("");

  await page.locator(".shot-row").nth(2).click();
  await expect(page.locator(".shot-row").nth(2)).toHaveClass(/is-active/);
  await traeButton.click();

  await expect.poll(() => requestUrls.length).toBe(2);
  expect(new URL(requestUrls[1]).search).toBe("?force=1");
  expect(requestBodies[1].constraints).toMatchObject({
    preserve_input_formation: false,
    lock_player_position: false,
  });
  await expect(
    page.getByRole("dialog", { name: "对比 AI 与当前占位" }),
  ).toHaveCount(0);
  await expect(page.getByText(/实际：内部 TRAE/)).toBeVisible();
  await expect(page.locator(".section-label--sticky")).not.toContainText(
    "本地预览",
  );
  await expect(page.locator(".shot-row").nth(2)).toHaveClass(/is-active/);
  await page.getByRole("tab", { name: "导演" }).click();
  await expect(page.getByText("强制重新生成。", { exact: true }))
    .toBeVisible();
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
          expectedVersion: "0.16.1",
          serverVersion: "0.16.1",
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
      sound_effects: [],
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

  const dialog = page.getByRole("dialog", {
    name: "预览并选择分镜方案",
  });
  await expect(dialog).toBeVisible();
  const comparePosition = dialog.locator(".shared-compare-shots__head span");
  await dialog.getByRole("button", { name: "对比下一个镜头" }).click();
  await dialog.getByRole("button", { name: "对比下一个镜头" }).click();
  await expect(comparePosition).toContainText("3 /");
  await dialog.getByRole("button", { name: "共享方案" }).click();
  await expect(comparePosition).toContainText("3 /");
  await expect(
    dialog.getByRole("button", { name: "采用共享方案" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("shared-plan-conflict.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "本地方案" }).click();
  await expect(comparePosition).toContainText("3 /");
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
  await page.getByRole("button", { name: "分析对话与站位" }).click();

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
  await page.getByRole("button", { name: "协作连接状态" }).click();
  const statusDialog = page.getByRole("dialog", {
    name: "协作连接状态",
  });
  await expect(
    statusDialog.getByText(/内部 TRAE MCP 已连接/),
  ).toBeVisible();
  await page.locator(".viewport-toolbar").click();
  await expect(statusDialog).toHaveCount(0);

  await expect(
    page.getByText(
      /TRAE 协作本次未完成，当前显示规则导演结果：模拟内部 TRAE 协作超时/,
    ),
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
          expectedVersion: "0.16.1",
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
  await page.getByLabel("四位数对话 ID").fill("3099");
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  await page.getByRole("button", { name: "协作连接状态" }).click();

  const statusDialog = page.getByRole("dialog", {
    name: "协作连接状态",
  });
  await expect(statusDialog.getByText("MCP 仍在运行旧版本")).toBeVisible();
  await expect(
    statusDialog.getByText(
      /当前 0\.13\.0 · 需要 0\.16\.1；请在 TRAE 中停用后重新启用/,
    ),
  ).toBeVisible();
  await expect(
    statusDialog.getByRole("button", { name: "配置内部 TRAE MCP" }),
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
  await page.getByLabel("四位数对话 ID").fill("3099");
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  await page.getByRole("button", { name: "协作连接状态" }).click();
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
          miraMissingScopes: ["search:bot", "im:message.send_as_user"],
          baseMissingScopes: [],
          docsMissingScopes: [],
          caseLibraryReady: true,
          soundEffectCatalogReady: true,
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
          miraMissingScopes: [],
          baseMissingScopes: [],
          docsMissingScopes: [],
          caseLibraryReady: true,
          soundEffectCatalogReady: true,
          miraBot: null,
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Mira AI" }).click();
  await page.getByRole("button", { name: "协作连接状态" }).click();
  await page.getByRole("button", { name: "授权飞书" }).click();

  await expect(
    page.getByRole("dialog", { name: "连接飞书数据与 Mira" }),
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
    page.getByRole("dialog", { name: "连接飞书数据与 Mira" }),
  ).toBeHidden();
  expect(finishRequests).toBe(1);
});

test("guides first desktop launch to select live and config directories", async ({
  page,
}, testInfo) => {
  await page.route("**/api/ue/config-data/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          dialogueText: [
            "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
            "##对话ID,人物,内容,下一ID,结束",
            "735000,,,735001,false",
            "735001,1,首次启动测试。,,true",
          ].join("\n"),
          startText: [
            "##&DialogStart.id,DialogStart.Outline",
            "##对话ID,剧情梗概",
            "735000,首次启动目录",
          ].join("\n"),
          npcText: [
            "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
            "##id,名称,介绍,资源",
            "1,玩家,玩家,",
          ].join("\n"),
          sourceName:
            "F:\\NarrativeData\\Game\\res + F:\\NarrativeData\\doc\\csvdir",
          modelText: "",
          missionText: [
            "##&字段标记,Mission.id,Mission.Name,Mission.ShowNPC",
            "##任务类型,任务ID,任务名称,显示目标物",
          ].join("\n"),
          dungeonMissionText: "",
          missionPositionText: "",
          mapConfigText: "",
          mapResourceText: "",
        },
      }),
    });
  });
  await page.route("**/api/lark/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          cliAvailable: true,
          authorized: false,
          identity: "bot",
          userName: "",
          openId: "",
          userStatus: "missing",
          missingScopes: [
            "search:bot",
            "im:message.send_as_user",
            "base:record:read",
            "base:record:create",
          ],
          miraMissingScopes: [
            "search:bot",
            "im:message.send_as_user",
          ],
          baseMissingScopes: [
            "base:record:read",
            "base:record:create",
          ],
          caseLibraryReady: false,
          miraBot: null,
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
          verificationUrl: "https://example.com/feishu-first-run",
          qrDataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          expiresAt: Date.now() + 300_000,
          scopes: ["base:record:read", "base:record:create"],
        },
      }),
    });
  });
  await page.addInitScript(() => {
    let status = {
      firstRun: true,
      setupCompleted: false,
      version: "0.17.2",
      packaged: true,
      portable: false,
      runtimeBundled: true,
      traeDetected: false,
      traeExecutable: null,
      integrationInstalled: false,
      integrationRoot: "C:\\Test\\Shot Sandbox\\trae-integration",
      mcpConnected: false,
      mcpVersion: null,
      expectedMcpVersion: "test",
      defaultDataReady: false,
      liveDataReady: false,
      configDataReady: false,
      liveResDirectory: "",
      configDocDirectory: "",
      liveCsvDirectory: "",
      configCsvDirectory: "",
      missionTargetTablePath: "",
      ueConnected: false,
      ueMcpHost: "127.0.0.1",
      ueMcpPort: 12031,
      ueConnectionMessage: "未连接",
      updateSupported: false,
      updatePage: "https://example.com/update",
    };
    window.shotSandboxDesktop = {
      getSetupStatus: async () => status,
      installTraeIntegration: async () => status,
      openIntegrationFolder: async () => undefined,
      openTraeDownload: async () => undefined,
      setUeMcpPort: async () => status,
      getPathForFile: (file: File) =>
        file.name === "对话表.csv"
          ? "F:\\NarrativeData\\Game\\res\\Content\\Seria\\Tables\\csvdir\\对话表.csv"
          : "F:\\NarrativeData\\doc\\csvdir\\NPC表.csv",
      setLiveResDirectory: async (directoryPath: string) => {
        status = {
          ...status,
          liveDataReady: true,
          liveResDirectory: directoryPath,
          liveCsvDirectory: `${directoryPath}\\Content\\Seria\\Tables\\csvdir`,
          defaultDataReady: status.configDataReady,
        };
        return status;
      },
      setConfigDocDirectory: async (directoryPath: string) => {
        status = {
          ...status,
          configDataReady: true,
          configDocDirectory: directoryPath,
          configCsvDirectory: `${directoryPath}\\csvdir`,
          missionTargetTablePath:
            "F:\\NarrativeData\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
          defaultDataReady: status.liveDataReady,
        };
        return status;
      },
      restoreDataDirectories: async () => status,
      completeSetup: async () => {
        status = {
          ...status,
          firstRun: false,
          setupCompleted: true,
        };
        return status;
      },
      checkForUpdates: async () => ({ state: "idle" }),
      getUpdateSnapshot: async () => ({ state: "idle" }),
      installUpdate: async () => undefined,
      openUpdatePage: async () => undefined,
      onUpdateState: () => () => undefined,
    };
  });

  const liveFixtureRoot = testInfo.outputPath("first-run-res");
  await writeDirectoryFixture(
    `${liveFixtureRoot}/Content/Seria/Tables/csvdir`,
    [
    {
      name: "对话表.csv",
      content: [
        "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
        "##对话ID,人物,内容,下一ID,结束",
        "735000,,,735001,false",
        "735001,1,首次启动测试。,,true",
      ].join("\n"),
    },
    {
      name: "对话表_开始节点.csv",
      content: [
        "##&DialogStart.id,DialogStart.Outline",
        "##对话ID,剧情梗概",
        "735000,首次启动目录",
      ].join("\n"),
    },
    {
      name: "任务表.csv",
      content: [
        "##&字段标记,Mission.id,Mission.Name,Mission.ShowNPC",
        "##任务类型,任务ID,任务名称,显示目标物",
      ].join("\n"),
    },
    ],
  );
  const configFixtureRoot = testInfo.outputPath("first-run-config");
  await writeDirectoryFixture(`${configFixtureRoot}/csvdir`, [
    {
      name: "NPC表.csv",
      content: [
        "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
        "##id,名称,介绍,资源",
        "1,玩家,玩家,",
      ].join("\n"),
    },
  ]);

  await page.goto("/");
  await page.keyboard.press("Escape");
  await expect(page.locator(".launch-screen")).toHaveCount(0);

  const setup = page.getByRole("dialog", {
    name: "配置项目数据目录",
  });
  await expect(setup).toBeVisible();
  const startButton = setup.getByRole("button", { name: "开始使用" });
  await expect(startButton).toBeDisabled();
  await expect(setup.getByText("res 实时数据 · 待选择")).toBeVisible();
  await expect(setup.getByText("doc 配置文档 · 待选择")).toBeVisible();
  await expect(setup.getByText("SHOT SANDBOX")).toHaveCount(0);
  await setup.screenshot({
    path: testInfo.outputPath("desktop-first-run.png"),
  });

  await setup.getByRole("button", { name: "选择 res 目录" }).click();
  await page.locator('input[type="file"]').setInputFiles(liveFixtureRoot);
  await expect(setup.getByText("res 实时数据 · 已就绪")).toBeVisible();
  await expect(setup.getByText("doc 配置文档 · 待选择")).toBeVisible();
  await expect(startButton).toBeDisabled();
  await setup.getByRole("button", { name: "选择 doc 目录" }).click();
  await page.locator('input[type="file"]').setInputFiles(configFixtureRoot);
  await expect(setup.getByText("doc 配置文档 · 已就绪")).toBeVisible();
  await expect(
    setup.getByText(
      "F:\\NarrativeData\\doc",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(setup.getByRole("alert")).toHaveCount(0);
  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(setup).toHaveCount(0);
  await expect(page.getByLabel("四位数对话 ID 或对白内容")).toHaveValue("");
  await expect(page.getByText("等待对话", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "分镜工作台" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("desktop-workspace-ready-collapsed.png"),
  });
  await page.locator(".app-rail").hover();
  await page.waitForTimeout(320);
  await page.screenshot({
    path: testInfo.outputPath("desktop-workspace-ready.png"),
  });
});

test("manually syncs the sound and music catalogs from settings", async ({
  page,
}, testInfo) => {
  let syncRequests = 0;
  let musicSyncRequests = 0;
  await page.unroute("**/api/lark/music/catalog");
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
          miraMissingScopes: [],
          baseMissingScopes: [],
          docsMissingScopes: [],
          caseLibraryReady: true,
          soundEffectCatalogReady: true,
          miraBot: null,
        },
      }),
    });
  });
  await page.route(
    "**/api/lark/sound-effects/catalog",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            entries: Array.from({ length: 98 }, (_, index) => ({
              category: "action",
              assetName: `A_SFX_Dialog_${index}`,
              description: `测试音效 ${index}`,
            })),
            sourceUrl: "https://example.com/catalog",
            libraryUrl: "https://example.com/library",
            revisionId: 49,
            syncedAt: null,
            source: "bundled",
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/lark/sound-effects/sync",
    async (route) => {
      syncRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            entries: [
              {
                category: "special",
                assetName: "A_SFX_Dialog_900001",
                description: "同步后的测试音效",
              },
            ],
            sourceUrl: "https://example.com/catalog",
            libraryUrl: "https://example.com/library",
            revisionId: 50,
            syncedAt: "2026-08-26T13:00:00.000Z",
            source: "lark",
          },
        }),
      });
    },
  );
  await page.route("**/api/lark/music/catalog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          entries: Array.from({ length: 120 }, (_, index) => ({
            recordId: `rec${index}`,
            name: `测试音乐 ${index}`,
            stateName: `Music_${index}`,
            stateId: index + 4,
            tags: ["日常轻松"],
            notes: "",
            fileToken: `fileToken${index}`,
            fileName: `music-${index}.wav`,
          })),
          revision: 206,
          syncedAt: "2026-08-27T16:00:00.000Z",
          unmappedCount: 2,
          missingAttachmentCount: 0,
          analyzedCount: 119,
        },
      }),
    });
  });
  await page.route("**/api/lark/music/sync", async (route) => {
    musicSyncRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          entries: [
            {
              recordId: "recSincere",
              name: "情绪-真诚",
              stateName: "Sincere",
              stateId: 18,
              tags: ["日常轻松"],
              notes: "温馨",
              fileToken: "fileSincere",
              fileName: "sincere.wav",
            },
          ],
          revision: 207,
          syncedAt: "2026-08-27T17:00:00.000Z",
          unmappedCount: 0,
          missingAttachmentCount: 0,
          analyzedCount: 1,
        },
      }),
    });
  });
  await page.addInitScript(() => {
    const status = {
      firstRun: true,
      setupCompleted: true,
      version: "0.20.1",
      packaged: true,
      portable: false,
      runtimeBundled: true,
      traeDetected: true,
      traeExecutable: "C:\\Test\\Trae.exe",
      integrationInstalled: true,
      integrationRoot: "C:\\Test\\Shot Sandbox\\trae-integration",
      mcpConnected: true,
      mcpVersion: "test",
      expectedMcpVersion: "test",
      defaultDataReady: true,
      liveDataReady: true,
      configDataReady: true,
      liveResDirectory: "C:\\Test\\Game\\res",
      configDocDirectory: "C:\\Test\\doc",
      liveCsvDirectory:
        "C:\\Test\\Game\\res\\Content\\Seria\\Tables\\csvdir",
      configCsvDirectory: "C:\\Test\\doc\\csvdir",
      missionTargetTablePath:
        "C:\\Test\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
      ueConnected: true,
      ueMcpHost: "127.0.0.1",
      ueMcpPort: 12031,
      ueConnectionMessage: "已连接",
      updateSupported: false,
      updatePage: "https://example.com/update",
    };
    window.shotSandboxDesktop = {
      getSetupStatus: async () => status,
      installTraeIntegration: async () => status,
      openIntegrationFolder: async () => undefined,
      openTraeDownload: async () => undefined,
      setUeMcpPort: async () => status,
      getPathForFile: () => "C:\\Test\\doc\\csvdir\\NPC表.csv",
      setLiveResDirectory: async () => status,
      setConfigDocDirectory: async () => status,
      completeSetup: async () => ({
        ...status,
        firstRun: false,
        setupCompleted: true,
      }),
      checkForUpdates: async () => ({
        state: "available",
        version: "0.22.15",
        releaseNotes:
          "# 镜头沙盘｜近期更新\n\n> 2026-08-30\n\n## 音效与音乐\n\n- 正在试听的资源会整行高亮，新的试听会自动暂停上一条。\n\n## 导出体验\n\n- 导出前先查看本地清单，再按选择内容连接 UE 检查差异。",
      }),
      getUpdateSnapshot: async () => ({
        state: "available",
        version: "0.22.15",
        releaseNotes:
          "# 镜头沙盘｜近期更新\n\n> 2026-08-30\n\n## 音效与音乐\n\n- 正在试听的资源会整行高亮，新的试听会自动暂停上一条。\n\n## 导出体验\n\n- 导出前先查看本地清单，再按选择内容连接 UE 检查差异。",
      }),
      installUpdate: async () => undefined,
      openUpdatePage: async () => undefined,
      onUpdateState: () => () => undefined,
    };
  });

  await page.goto("/");

  const setup = page.getByRole("dialog", {
    name: "运行环境与数据协作",
  });
  await expect(setup.getByText("发现 0.22.15")).toBeVisible();
  const updateNotes = setup.locator(".setup-update__notes");
  await updateNotes.getByText("查看本次更新内容").click();
  await expect(updateNotes).toContainText("音效与音乐");
  await expect(updateNotes).toContainText(
    "正在试听的资源会整行高亮，新的试听会自动暂停上一条。",
  );
  const soundEffectStatus = setup
    .locator(".setup-status-list > div")
    .filter({ hasText: "音效资料库" });
  const musicStatus = setup
    .locator(".setup-status-list > div")
    .filter({ hasText: "音乐资料库" });
  const statusItem = (label: string) =>
    setup
      .locator(".setup-status-list > div")
      .filter({ hasText: label })
      .first();
  for (const [leftLabel, rightLabel] of [
    ["res 实时数据", "doc 配置文档"],
    ["音效资料库", "音乐资料库"],
    ["TRAE", "分镜 MCP"],
  ]) {
    const [leftBox, rightBox] = await Promise.all([
      statusItem(leftLabel).boundingBox(),
      statusItem(rightLabel).boundingBox(),
    ]);
    expect(leftBox?.y).toBe(rightBox?.y);
  }
  await expect(setup.getByText("98 项 · 内置版本")).toBeVisible();
  await setup
    .getByRole("button", { name: "从飞书同步音效资料库" })
    .click();
  await expect.poll(() => syncRequests).toBe(1);
  await expect(soundEffectStatus).toContainText("已同步 1 项，文档版本 50");
  await expect(setup.getByText("120 首 · 119 首已分析 · 版本 206 · 2 条未映射"))
    .toBeVisible();
  await setup
    .getByRole("button", { name: "从飞书同步音乐资料库" })
    .click();
  await expect.poll(() => musicSyncRequests).toBe(1);
  await expect(musicStatus).toContainText("已同步 1 首音乐");
  await expect(soundEffectStatus).toContainText("已同步 1 项，文档版本 50");
  await setup.screenshot({
    path: testInfo.outputPath("media-catalog-sync.png"),
  });
});

test("syncs the selected desktop doc path for registration data", async ({
  page,
}, testInfo) => {
  let selectedDocDirectory = "";
  await page.exposeFunction(
    "__recordDocDirectory",
    (directoryPath: string) => {
      selectedDocDirectory = directoryPath;
    },
  );
  await page.route("**/api/ue/config-data/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          dialogueText: [
            "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
            "##对话ID,人物,内容,下一ID,结束",
            "735000,,,735001,false",
            "735001,1,你来了。,735002,false",
            "735002,101968,请止步。,,true",
          ].join("\n"),
          startText: [
            "##&DialogStart.id,DialogStart.Outline",
            "##对话ID,剧情梗概",
            "735000,自定义目录测试",
          ].join("\n"),
          npcText: [
            "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
            "##id,名称,介绍,资源",
            "1,玩家,玩家,",
            "101968,商会安保,守卫,200135",
          ].join("\n"),
          sourceName:
            "C:\\trunk\\Game\\res + D:\\TeamProject\\doc",
          modelText: "",
          missionText: "",
          dungeonMissionText: "",
          missionPositionText: "",
          mapConfigText: "",
          mapResourceText: "",
        },
      }),
    });
  });
  await page.route("**/api/ue/formation/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "not_found",
          message: "未找到 BP_735000",
        },
      }),
    });
  });
  await page.addInitScript(() => {
    let status = {
      firstRun: false,
      setupCompleted: true,
      version: "0.17.2",
      packaged: true,
      portable: false,
      runtimeBundled: true,
      traeDetected: true,
      traeExecutable: "C:\\Test\\Trae.exe",
      integrationInstalled: true,
      integrationRoot: "C:\\Test\\Shot Sandbox\\trae-integration",
      mcpConnected: false,
      mcpVersion: null,
      expectedMcpVersion: "0.17.2",
      defaultDataReady: true,
      liveDataReady: true,
      configDataReady: true,
      liveResDirectory: "C:\\trunk\\Game\\res",
      configDocDirectory: "C:\\trunk\\doc",
      liveCsvDirectory:
        "C:\\trunk\\Game\\res\\Content\\Seria\\Tables\\csvdir",
      configCsvDirectory: "C:\\trunk\\doc\\csvdir",
      missionTargetTablePath:
        "C:\\trunk\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
      ueConnected: false,
      ueMcpHost: "127.0.0.1",
      ueMcpPort: 12031,
      ueConnectionMessage: "未连接",
      updateSupported: false,
      updatePage: "https://example.com/update",
    };
    window.shotSandboxDesktop = {
      getSetupStatus: async () => status,
      installTraeIntegration: async () => status,
      openIntegrationFolder: async () => undefined,
      openTraeDownload: async () => undefined,
      setUeMcpPort: async () => status,
      getPathForFile: (file: File) =>
        file.webkitRelativePath.includes("invalid-doc")
          ? "D:\\Invalid\\doc\\csvdir\\NPC表.csv"
          : file.webkitRelativePath.replaceAll("\\", "/").includes(
                "/csvspecial/",
              )
          ? "D:\\TeamProject\\doc\\csvspecial\\NPC表.csv"
          : "D:\\TeamProject\\doc\\csvdir\\NPC表.csv",
      setLiveResDirectory: async () => status,
      setConfigDocDirectory: async (directoryPath: string) => {
        if (directoryPath === "D:\\Invalid\\doc") {
          throw new Error(
            "所选 doc 目录中缺少 csvdir 下的 NPC、模型、目标物或地图 CSV",
          );
        }
        await (
          window as typeof window & {
            __recordDocDirectory: (
              value: string,
            ) => Promise<void>;
          }
        ).__recordDocDirectory(directoryPath);
        status = {
          ...status,
          configDocDirectory: directoryPath,
          configCsvDirectory: `${directoryPath}\\csvdir`,
        };
        return status;
      },
      restoreDataDirectories: async () => status,
      completeSetup: async () => status,
      checkForUpdates: async () => ({ state: "idle" }),
      getUpdateSnapshot: async () => ({ state: "idle" }),
      installUpdate: async () => undefined,
      openUpdatePage: async () => undefined,
      onUpdateState: () => () => undefined,
    };
  });
  const fixtureRoot = testInfo.outputPath("custom-doc");
  await writeDirectoryFixture(
    `${fixtureRoot}/csvdir`,
    [
      {
        name: "对话表.csv",
        content: [
          "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
          "##对话ID,人物,内容,下一ID,结束",
          "735000,,,735001,false",
          "735001,1,你来了。,735002,false",
          "735002,101968,请止步。,,true",
        ].join("\n"),
      },
      {
        name: "对话表_开始节点.csv",
        content: [
          "##&DialogStart.id,DialogStart.Outline",
          "##对话ID,剧情梗概",
          "735000,自定义目录测试",
        ].join("\n"),
      },
      {
        name: "NPC表.csv",
        content: [
          "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
          "##id,名称,介绍,资源",
          "1,玩家,玩家,",
          "101968,商会安保,守卫,200135",
        ].join("\n"),
      },
    ],
  );
  await writeDirectoryFixture(`${fixtureRoot}/csvspecial`, [
    {
      name: "NPC表.csv",
      content: [
        "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
        "##id,名称,介绍,资源",
        "999999,不应选择的 NPC,错误目录,",
      ].join("\n"),
    },
  ]);
  const invalidFixtureRoot = testInfo.outputPath("invalid-doc");
  await writeDirectoryFixture(`${invalidFixtureRoot}/csvdir`, [
    {
      name: "NPC表.csv",
      content: [
        "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
        "##id,名称,介绍,资源",
        "1,玩家,玩家,",
      ].join("\n"),
    },
  ]);

  await page.goto("/");
  const settingsButton = page.getByRole("button", {
    name: "桌面版设置与更新",
  });
  await expect(settingsButton).toBeVisible();
  await expect(settingsButton).toBeEnabled();
  await expect(
    page
      .getByRole("navigation", { name: "全局工具" })
      .getByRole("button", { name: "选择数据目录" }),
  ).toHaveCount(0);
  await settingsButton.click();
  const settingsDialog = page.getByRole("dialog", {
    name: "运行环境与数据协作",
  });
  await expect(settingsDialog).toBeVisible();
  await expect(
    settingsDialog.getByRole("heading", { name: "TRAE 集成" }),
  ).toBeVisible();
  await expect(
    settingsDialog.getByText(
      "应用每次启动都会同步内置 Skill；TRAE 已打开时请重载窗口。",
    ),
  ).toBeVisible();
  await expect(
    settingsDialog.getByText(
      "C:\\Test\\Shot Sandbox\\trae-integration",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    settingsDialog.getByRole("button", { name: "同步配置与 Skill" }),
  ).toBeVisible();
  await settingsDialog.getByRole("button", { name: "选择 doc 目录" }).click();
  await page.locator('input[type="file"]').setInputFiles(invalidFixtureRoot);
  await expect(settingsDialog.getByRole("alert")).toContainText(
    "所选 doc 目录中缺少 csvdir",
  );

  await settingsDialog.getByRole("button", { name: "选择 doc 目录" }).click();
  await page.locator('input[type="file"]').setInputFiles(fixtureRoot);
  await expect(page.getByLabel("四位数对话 ID 或对白内容")).toHaveValue("");
  await settingsDialog.getByRole("button", { name: "关闭桌面版设置" }).click();
  await page.getByLabel("四位数对话 ID 或对白内容").fill("7350");
  await page.getByRole("button", { name: "分析对话与站位" }).click();
  const outlineToggle = page.getByRole("button", { name: /剧情梗概/ });
  await expect(outlineToggle).toHaveAttribute("aria-expanded", "false");
  await outlineToggle.click();
  await expect(page.getByText("自定义目录测试", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "数据源状态" }).click();
  const sourceDialog = page.getByRole("dialog", { name: "数据源配置" });
  await expect(
    sourceDialog.getByText("C:\\trunk\\Game\\res + D:\\TeamProject\\doc", {
      exact: true,
    }),
  ).toBeVisible();
  const sourceDialogBox = await sourceDialog.boundingBox();
  expect(sourceDialogBox).not.toBeNull();
  expect(
    (sourceDialogBox?.x ?? 0) + (sourceDialogBox?.width ?? 0),
  ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  expect(selectedDocDirectory).toBe("D:\\TeamProject\\doc");
});

test("excludes close-UI node content from visible dialogue analysis", async ({
  page,
}, testInfo) => {
  await page.route("**/api/ue/formation/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "not_found",
          message: "未找到测试 BP",
        },
      }),
    });
  });
  const fixtureDirectory = await writeDirectoryFixture(
    testInfo.outputPath("camera-keyframe", "csvdir"),
    [
      {
        name: "对话表.csv",
        content: [
          "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End,Dialog.State,Dialog.CameraPosition,Dialog.CameraMoveString",
          "##对话ID,人物,内容,下一ID,结束,状态,机位,运镜",
          "735000,,,735001,false,,,",
          "735001,1,不可见的重复台词,735002,false,4,c1,move",
          "735002,1,第一句可见台词。,735003,false,0,c1,",
          "735003,101968,第二句可见台词。,,true,0,,",
        ].join("\n"),
      },
      {
        name: "对话表_开始节点.csv",
        content: [
          "##&DialogStart.id,DialogStart.Outline",
          "##对话ID,剧情梗概",
          "735000,镜头关键帧测试",
        ].join("\n"),
      },
      {
        name: "NPC表.csv",
        content: [
          "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
          "##id,名称,介绍,资源",
          "1,玩家,玩家,",
          "101968,商会安保,守卫,200135",
        ].join("\n"),
      },
    ],
  );

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixtureDirectory);
  await page.getByLabel("四位数对话 ID 或对白内容").fill("7350");
  await page.getByRole("button", { name: "分析对话与站位" }).click();

  await expect(page.getByText("不可见的重复台词", { exact: true }))
    .toHaveCount(0);
  const shotBody = page.locator(".shot-row__body").first();
  await expect(shotBody).toContainText("第一句可见台词。");
  await expect(shotBody).toContainText("第二句可见台词。");
  await expect(page.getByText("已忽略 1 个关闭 UI 节点", { exact: false }))
    .toBeVisible();
});

test("searches dialogue text and reuses only previously designed storyboards", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const searchInput = page.getByLabel("四位数对话 ID 或对白内容");

  await searchInput.fill("谁拿走了钥匙");
  await page.getByRole("button", { name: "搜索对白内容" }).click();

  await expect(page.getByText("文字搜索", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 处命中 · 1 组对话/)).toBeVisible();
  await expect(
    page.locator(".dialogue-search-context").getByText("对话 2048"),
  ).toBeVisible();
  await expect(
    page.locator(".dialogue-search-context").getByText("已有分镜"),
  ).toBeVisible();
  await expect(page.locator(".dialogue-search-row")).toHaveCount(3);
  await expect(page.locator(".dialogue-search-row.is-match mark")).toHaveText(
    "谁拿走了钥匙",
  );
  await expect(page.locator(".stage-view")).toBeVisible();

  await searchInput.fill("我们先合作");
  await page.getByRole("button", { name: "搜索对白内容" }).click();
  await expect(
    page.locator(".dialogue-search-context").getByText("对话 2049"),
  ).toBeVisible();
  await expect(
    page.locator(".dialogue-search-context").getByText("仅文本"),
  ).toBeVisible();
  await expect(page.locator(".stage-view")).toHaveCount(0);
  await expect(
    page.locator(".dialogue-preview").getByText("我们先合作", {
      exact: false,
    }),
  ).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("dialogue-text-search.png"),
    fullPage: true,
  });
});

test("edits the active dialogue, cancels on outside click and saves to UE", async ({
  page,
}, testInfo) => {
  let updateRequest: Record<string, unknown> | null = null;
  await page.route("**/api/ue/formation/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "not_found",
          message: "未找到测试 BP",
        },
      }),
    });
  });
  await page.route("**/api/ue/dialogue/content", async (route) => {
    updateRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "updated",
          dialogueId: "7352",
          startId: "735200",
          dialogueNodeId: "735201",
          dialogueAssetPath:
            "/Game/Seria/Task/dialoggraph/Test/735200.735200",
          content: "修改后的对白。",
          saved: true,
        },
      }),
    });
  });
  const fixtureDirectory = await writeDirectoryFixture(
    testInfo.outputPath("dialogue-edit", "csvdir"),
    [
      {
        name: "对话表.csv",
        content: [
          "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
          "##对话ID,人物,内容,下一ID,结束",
          "735200,,,735201,false",
          "735201,1,你来了。,735202,false",
          "735202,101968,请止步。,,true",
        ].join("\n"),
      },
      {
        name: "对话表_开始节点.csv",
        content: [
          "##&DialogStart.id,DialogStart.Outline",
          "##对话ID,剧情梗概",
          "735200,对白编辑测试",
        ].join("\n"),
      },
      {
        name: "NPC表.csv",
        content: [
          "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
          "##id,名称,介绍,资源",
          "1,玩家,玩家,",
          "101968,商会安保,守卫,200135",
        ].join("\n"),
      },
    ],
  );

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixtureDirectory);
  await page.getByLabel("四位数对话 ID 或对白内容").fill("7352");
  await page.getByRole("button", { name: "分析对话与站位" }).click();
  await expect(page.getByRole("button", { name: "编辑当前对白" })).toBeEnabled();

  await page.getByRole("button", { name: "编辑当前对白" }).click();
  const editor = page.getByLabel("编辑节点 735201 的对白");
  await expect(editor).toBeVisible();
  await editor.fill("这次不保存。");
  await page.locator(".viewport-toolbar").click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText("你来了。", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "编辑当前对白" }).click();
  await page.getByLabel("编辑节点 735201 的对白").fill("修改后的对白。");
  await page.getByRole("button", { name: "保存对白" }).click();

  await expect(
    page.getByText("节点 735201 已写入并保存", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("修改后的对白。", { exact: true })).toBeVisible();
  expect(updateRequest).toEqual({
    dialogueId: "7352",
    startId: "735200",
    dialogueNodeId: "735201",
    previousContent: "你来了。",
    content: "修改后的对白。",
  });

  await page.screenshot({
    path: testInfo.outputPath("dialogue-content-edited.png"),
    fullPage: true,
  });
});

test("batch edits text search results without requiring a storyboard", async ({
  page,
}, testInfo) => {
  let batchRequest: Record<string, unknown> | null = null;
  await page.route("**/api/ue/formation/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "not_found",
          message: "未找到测试 BP",
        },
      }),
    });
  });
  await page.route("**/api/ue/dialogue/content/batch", async (route) => {
    batchRequest = route.request().postDataJSON();
    const items = batchRequest?.items as Array<Record<string, string>>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          updatedCount: items.length,
          unchangedCount: 0,
          savedAssetCount: 2,
          items: items.map((item, index) => ({
            status: "updated",
            dialogueId: item.dialogueId,
            startId: item.startId,
            dialogueNodeId: item.dialogueNodeId,
            dialogueAssetPath: `/Game/Test/${item.startId}.${item.startId}`,
            content: item.content,
            saved: true,
            index,
          })),
        },
      }),
    });
  });
  const fixtureDirectory = await writeDirectoryFixture(
    testInfo.outputPath("dialogue-batch-edit", "csvdir"),
    [
      {
        name: "对话表.csv",
        content: [
          "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
          "##对话ID,人物,内容,下一ID,结束",
          "735200,,,735201,false",
          "735201,1,旧称在第一段。,735202,false",
          "735202,101968,第一段结束。,,true",
          "735300,,,735301,false",
          "735301,101968,第二段也使用旧称。,,true",
        ].join("\n"),
      },
      {
        name: "对话表_开始节点.csv",
        content: [
          "##&DialogStart.id,DialogStart.Outline",
          "##对话ID,剧情梗概",
          "735200,第一组",
          "735300,第二组",
        ].join("\n"),
      },
      {
        name: "NPC表.csv",
        content: [
          "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
          "##id,名称,介绍,资源",
          "1,玩家,玩家,",
          "101968,商会安保,守卫,200135",
        ].join("\n"),
      },
    ],
  );

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixtureDirectory);
  const searchInput = page.getByLabel("四位数对话 ID 或对白内容");
  await searchInput.fill("旧称");
  await page.getByRole("button", { name: "搜索对白内容" }).click();
  await page
    .getByRole("button", { name: /对话 7353 节点 735301/ })
    .click();
  await expect(page.locator(".stage-view")).toHaveCount(0);

  await page.getByRole("button", { name: "编辑搜索结果" }).click();
  const editor = page.getByRole("dialog", { name: "对白文本编辑" });
  await expect(editor).toBeVisible();
  await expect(
    editor.getByLabel("选择对白节点 735301"),
  ).toBeChecked();
  await editor.getByLabel("选择全部匹配对白").check();
  await editor.getByLabel("批量替换内容").fill("新称");
  await expect(editor.getByText("旧称在第一段。", { exact: true })).toBeVisible();
  await expect(editor.getByText("新称在第一段。", { exact: true })).toBeVisible();
  await editor.screenshot({
    path: testInfo.outputPath("dialogue-batch-editor.png"),
  });

  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("修改 2 条对白");
    await confirmation.accept();
  });
  await editor.getByRole("button", { name: "应用 2 条" }).click();

  await expect(
    page.getByText("已修改 2 条对白并保存 2 个对话资产"),
  ).toBeVisible();
  expect(batchRequest).toMatchObject({
    items: [
      {
        dialogueId: "7352",
        startId: "735200",
        dialogueNodeId: "735201",
        previousContent: "旧称在第一段。",
        content: "新称在第一段。",
      },
      {
        dialogueId: "7353",
        startId: "735300",
        dialogueNodeId: "735301",
        previousContent: "第二段也使用旧称。",
        content: "第二段也使用新称。",
      },
    ],
  });
});

test("offers BP or rule placement after ignored missing models", async ({
  page,
}, testInfo) => {
  let formationReady = false;
  let formationRequests = 0;
  await page.route("**/api/ue/formation/read", async (route) => {
    formationRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "found",
          message: "已读取 2 个 BP 站位槽",
          snapshot: {
            dialogueId: "7370",
            blueprintAssetPath: "/Game/Test/BP_737000.BP_737000",
            blueprintClassPath: "/Game/Test/BP_737000.BP_737000_C",
            dialogueModels: [
              "player",
              formationReady ? "Im" : "Wrong",
            ],
            warnings: [],
            slots: [
              {
                modelIndex: 0,
                componentName: "ChildActorComponent_0_GEN_VARIABLE",
                componentGuid: "player-guid",
                modelClassPath:
                  "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
                transform: {
                  location: { x: -150, y: 0, z: 92 },
                  rotation: { pitch: 0, yaw: -90, roll: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                },
              },
              {
                modelIndex: 1,
                componentName: "ChildActorComponent_1_GEN_VARIABLE",
                componentGuid: "npc-guid",
                modelClassPath: formationReady
                  ? "/Game/Test/BP_Im.BP_Im_C"
                  : "/Game/Test/BP_Wrong.BP_Wrong_C",
                transform: {
                  location: { x: 150, y: 0, z: 92 },
                  rotation: { pitch: 0, yaw: 90, roll: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                },
              },
            ],
          },
        },
      }),
    });
  });
  const fixtureDirectory = await writeDirectoryFixture(
    testInfo.outputPath("missing-npc-model", "csvdir"),
    [
      {
        name: "对话表.csv",
        content: [
          "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End,Dialog.CharacterBehaviourString",
          "##对话ID,人物,内容,下一ID,结束,动作",
          "737000,,,737001,false,",
          '737001,102101,只有声音，不需要出现在镜头中。,737002,false,";0.000000,AM_Talk,0,0,0,0,0,0,0,0|0.200000,AM_TurnRight90,1,0,0,0,0,0,0,0"',
          '737002,1,我听见了。,,true,"0.000000,AM_Talk,0,0,0,0,0,0,0,0;"',
        ].join("\n"),
      },
      {
        name: "对话表_开始节点.csv",
        content: [
          "##&DialogStart.id,DialogStart.Outline,DialogStart.Formation,DialogStart.Model",
          "##对话ID,剧情梗概,模板,模型",
          "737000,画外通讯,/Game/Test/BP_737000.BP_737000_C,player;Wrong",
        ].join("\n"),
      },
      {
        name: "NPC表.csv",
        content: [
          "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
          "##id,名称,介绍,资源",
          "1,玩家,玩家,",
          "102101,伊姆,画外通讯,200526",
        ].join("\n"),
      },
      {
        name: "m模型资源表.csv",
        content: [
          "##&Model.id,,Model.path",
          "##id,配置填写在此列，Model.path保存时自动生成，由程序调用,生成路径",
          "200526,/Game/Test/BP_Im,/Game/Test/BP_Im.BP_Im_C",
        ].join("\n"),
      },
    ],
  );

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixtureDirectory);
  const searchInput = page.getByLabel("四位数对话 ID 或对白内容");
  await searchInput.fill("7370");
  await page.getByRole("button", { name: "分析对话与站位" }).click();

  const missingModal = page.getByRole("dialog", {
    name: "确认缺失模型 NPC",
  });
  await expect(missingModal).toBeVisible();
  await expect(missingModal).toContainText("伊姆");
  await expect(missingModal).toContainText("102101");
  await expect(missingModal).toContainText(
    "AM_Talk 指向 BP 槽位 1，但该槽模型与 NPC 不一致",
  );
  const ignoreNpc = missingModal.getByRole("checkbox", {
    name: "忽略 NPC 伊姆 的模型缺失",
  });
  await ignoreNpc.check();
  await missingModal.screenshot({
    path: testInfo.outputPath("missing-npc-model-review.png"),
  });

  await missingModal.getByRole("button", { name: "刷新 BP" }).click();
  await expect.poll(() => formationRequests).toBe(2);
  await expect(ignoreNpc).toBeChecked();
  await expect(missingModal).toContainText("刷新后仍有 1 个");

  formationReady = true;
  await missingModal.getByRole("button", { name: "刷新 BP" }).click();
  await expect(missingModal).toBeHidden();
  const formationModal = page.getByRole("dialog", {
    name: "选择镜头分析使用的占位",
  });
  await expect(formationModal).toBeVisible();
  await formationModal.getByRole("button", { name: "关闭占位选择" }).click();

  formationReady = false;
  await page.getByRole("button", { name: "分析对话与站位" }).click();
  await expect(missingModal).toBeVisible();
  await expect(
    missingModal.getByRole("button", { name: "忽略并选择占位" }),
  ).toBeDisabled();
  await missingModal
    .getByRole("checkbox", { name: "忽略 NPC 伊姆 的模型缺失" })
    .check();
  await missingModal
    .getByRole("button", { name: "忽略并选择占位" })
    .click();
  await expect(missingModal).toBeHidden();
  await expect(formationModal).toBeVisible();
  await expect(
    formationModal.getByRole("button", { name: "BP_737000" }),
  ).toBeVisible();
  await expect(
    formationModal.getByRole("button", { name: "规则占位" }),
  ).toBeVisible();
  await expect(formationModal).toContainText(
    "缺失模型角色使用规则临时占位",
  );
  await formationModal.screenshot({
    path: testInfo.outputPath("missing-model-formation-choice.png"),
  });
  await formationModal
    .getByRole("button", { name: "规则占位" })
    .click();
  await formationModal.getByRole("button", { name: "使用此占位" }).click();
  await expect(page.locator(".formation-status")).toContainText(
    "使用规则导演自动安排的角色位置",
  );
  await page.getByRole("tab", { name: "UE" }).click();
  await expect(
    page.getByText(
      "已从对话文件读取 1 项动作；规则占位下现有动作只读",
    ),
  ).toBeVisible();
  const ruleActionTrack = page
    .locator(".character-action-track")
    .filter({ hasText: "伊姆" });
  await expect(ruleActionTrack).toContainText("AM_TurnRight90");
  await expect(
    ruleActionTrack.locator(".character-action-existing-row"),
  ).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("rule-placement-existing-actions.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "导演" }).click();
  await page.getByRole("button", { name: "切换占位方案" }).click();
  const switchModal = page.getByRole("dialog", {
    name: "切换占位方案",
  });
  await switchModal
    .getByRole("button", { name: "BP_737000" })
    .click();
  await switchModal.getByRole("button", { name: "使用此占位" }).click();
  await expect(switchModal).toBeHidden();
  await expect(page.locator(".shot-row")).not.toHaveCount(0);
  await expect(page.locator(".formation-status")).toContainText(
    "保留 UE Formation",
  );
  await expect(page.locator(".formation-status")).toContainText(
    "1 位缺失模型角色使用规则临时占位",
  );
  await expect(
    page.locator(".stage-cast__item", { hasText: "伊姆" }),
  ).toBeVisible();
});

test("offers the detected Blueprint formation before designing shots", async ({
  page,
}, testInfo) => {
  let traeDirectorInput: {
    constraints: {
      preserve_input_formation?: boolean;
      lock_player_position?: boolean;
    };
  } | null = null;
  const inspectedExportRequests: Record<string, unknown>[] = [];
  let exportedStoryboardRequest: Record<string, unknown> | null = null;
  let exportRequests = 0;
  let formationDirty = true;
  let formationRequests = 0;
  let releaseFormation!: () => void;
  const formationGate = new Promise<void>((resolve) => {
    releaseFormation = resolve;
  });
  let releaseAllExportPreview!: () => void;
  const allExportPreviewGate = new Promise<void>((resolve) => {
    releaseAllExportPreview = resolve;
  });
  let releaseDirector!: () => void;
  const directorGate = new Promise<void>((resolve) => {
    releaseDirector = resolve;
  });
  await page.unroute("**/api/lark/music/catalog");
  await page.route("**/api/lark/music/catalog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          entries: [
            {
              recordId: "recDanger",
              name: "情绪-危机爆发",
              stateName: "Crisis_Breakout",
              stateId: 13,
              tags: ["危险战斗"],
              notes: "非常危险，已经在战斗",
              fileToken: "fileDanger",
              fileName: "danger.wav",
            },
          ],
          revision: 206,
          syncedAt: "2026-08-27T16:00:00.000Z",
          unmappedCount: 0,
          missingAttachmentCount: 0,
        },
      }),
    });
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
          expectedVersion: "0.16.1",
          serverVersion: "0.16.1",
          lastSeenAt: "2026-08-26T00:00:00.000Z",
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
      dialogue: Array<{ dialogue_id: string }>;
      participants: Array<{
        slot: "A" | "B" | "C";
        role: "dialogue" | "background";
      }>;
      constraints: {
        preserve_input_formation?: boolean;
        lock_player_position?: boolean;
      };
    };
    traeDirectorInput = input;
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
            dramatic_goal: "测试占位方案切换。",
            emotional_progression: "双方建立稳定对话关系。",
            visual_strategy: "使用 AI 对景占位。",
          },
          blocking: {
            formation: "arc",
            intent: "AI 将双方安排为清晰对景。",
            placements: input.participants.map((participant, index) => ({
              subject: participant.slot,
              position: ["front_left", "front_right", "back_center"][index],
              facing:
                participant.role === "background"
                  ? "group_center"
                  : participant.slot === "A"
                    ? "B"
                    : "A",
              entry_dialogue_id: input.dialogue[0].dialogue_id,
              exit_dialogue_id: null,
              intent: "建立 AI 对景占位。",
            })),
          },
          sound_effects: [
            {
              dialogue_id: input.dialogue[0].dialogue_id,
              asset_name: "A_SFX_Dialog_516918",
              category: "special",
              reason: "对话开场需要警报提示。",
            },
          ],
          shots: [
            {
              dialogue_ids: input.dialogue.map((line) => line.dialogue_id),
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
              composition_mode: "symmetry",
              visual_anchor: "balanced",
              negative_space: "balanced",
              composition_transition: "recenter",
              coverage_intent: "establish_geography",
              camera_height: "eye",
              intent: "测试 AI 占位切换。",
            },
          ],
        },
      }),
    });
  });
  await page.route("**/api/ue/formation/read", async (route) => {
    formationRequests += 1;
    await formationGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "found",
          message: "已读取 3 个 BP 站位槽",
          snapshot: {
            dialogueId: "7350",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000.BP_735000",
            blueprintClassPath:
              "/Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000.BP_735000_C",
            dialogueModels: [
              "player",
              "M63_Cityguard",
              "N115_Finance_Female",
            ],
            warnings: [],
            slots: [
              {
                modelIndex: 0,
                componentName: "ChildActorComponent_0_GEN_VARIABLE",
                componentGuid: "player-guid",
                modelClassPath:
                  "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
                transform: {
                  location: { x: -300, y: 120, z: 92 },
                  rotation: { pitch: 0, yaw: -90, roll: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                },
              },
              {
                modelIndex: 1,
                componentName: "ChildActorComponent_1_GEN_VARIABLE",
                componentGuid: "guard-guid",
                modelClassPath:
                  "/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC.BP_M63_Cityguard_NPC_C",
                transform: {
                  location: { x: 260, y: -140, z: 92 },
                  rotation: { pitch: 0, yaw: 90, roll: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                },
              },
              {
                modelIndex: 2,
                componentName: "ChildActorComponent_2_GEN_VARIABLE",
                componentGuid: "background-guid",
                modelClassPath:
                  "/Game/Seria/NPC/N115_Finance_Female/BP_N115_Finance_Female.BP_N115_Finance_Female_C",
                transform: {
                  location: { x: 520, y: 230, z: 92 },
                  rotation: { pitch: 0, yaw: 180, roll: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                },
              },
            ],
          },
        },
      }),
    });
  });
  await page.route("**/api/ue/npc-actions/read", async (route) => {
    const request = route.request().postDataJSON() as {
      models: Array<{
        modelIndex: number;
        blueprintClassPath: string;
      }>;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          dialogueAssetPath:
            "/Game/Seria/Task/dialoggraph/Test/735000.735000",
          catalogs: request.models.map((model) => ({
            ...model,
            status: "loaded",
            message: "已读取 5 个 Montage",
            actions: [
              {
                name: "AM_Idle1",
                assetPath: `${model.blueprintClassPath}/Animation/AM_Idle1`,
              },
              {
                name: "AM_Talk",
                assetPath: `${model.blueprintClassPath}/Animation/AM_Talk`,
              },
              {
                name: "AM_TurnRight45",
                assetPath: `${model.blueprintClassPath}/Animation/AM_TurnRight45`,
              },
              {
                name: "AM_TurnRight90",
                assetPath: `${model.blueprintClassPath}/Animation/AM_TurnRight90`,
              },
              {
                name: "AM_Wave",
                assetPath: `${model.blueprintClassPath}/Animation/AM_Wave`,
              },
            ],
          })),
          tracks: [
            {
              dialogueId: "735001",
              modelIndex: 1,
              actions: [
                {
                  montageName: "AM_Idle1",
                  delaySeconds: 0,
                  behaviourType: "ENone",
                },
              ],
              preservedComplexActionCount: 1,
            },
          ],
        },
      }),
    });
  });
  await page.route("**/api/ue/storyboard/inspect", async (route) => {
    const request = route.request().postDataJSON();
    inspectedExportRequests.push(request);
    if (inspectedExportRequests.length === 3) {
      await allExportPreviewGate;
    }
    const characterActions = (request.characterActions ?? []).map(
      (
        item: {
          dialogueId: string;
          modelIndex: number;
          characterLabel?: string;
          actions: Array<{
            montageName: string;
            delaySeconds: number;
          }>;
        },
        characterActionIndex: number,
      ) => ({
        characterActionIndex,
        ...item,
        existingActions: [
          {
            montageName: "AM_Idle1",
            delaySeconds: 0,
            behaviourType: "ENone",
          },
        ],
        desiredActions: [
          {
            montageName: "AM_Idle1",
            delaySeconds: 0,
            behaviourType: "ENone",
          },
          ...item.actions,
        ],
        preservedComplexActionCount: 1,
        action: "add",
      }),
    );
    const soundEffects = (request.soundEffects ?? []).map(
      (
        soundEffect: { dialogueId: string; assetName: string },
        soundEffectIndex: number,
      ) => ({
        soundEffectIndex,
        ...soundEffect,
        resolvedAssetPath: `/Game/Audio/${soundEffect.assetName}.${soundEffect.assetName}`,
        existingAssetPath: "",
        action: "add",
      }),
    );
    const music = (request.music ?? []).map(
      (
        item: {
          dialogueId: string;
          stateId: number;
          stateName: string;
          musicName: string;
        },
        musicIndex: number,
      ) => ({
        musicIndex,
        ...item,
        existingStateId: 1,
        action: "add",
      }),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          reviewToken: String(
            inspectedExportRequests.length % 10,
          ).repeat(64),
          dialogueId: "7350",
          startId: "735000",
          dialogueAssetPath:
            "/Game/Seria/Task/dialoggraph/Test/735000.735000",
          formationAssetPath:
            "/Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000.BP_735000",
          cameraName: "c1",
          shotCount: 1,
          changedNodeCount: 2,
          overwrittenNodeCount: 1,
          clearedNodeCount: 1,
          characterActionCount: characterActions.length,
          changedCharacterActionCount: characterActions.length,
          soundEffectCount: soundEffects.length,
          changedSoundEffectCount: soundEffects.length,
          replacedSoundEffectCount: 0,
          musicCount: music.length,
          changedMusicCount: music.length,
          replacedMusicCount: 0,
          invalidShotCount: 1,
          globalBlockedReasons: formationDirty
            ? [
                "Formation BP /Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000 存在未保存修改，请先在 UE 中保存或撤销",
              ]
            : [],
          characterActionBlockedReasons: [
            {
              modelIndex: 1,
              reason:
                "角色 BP /Game/Test/BP_Guard 存在未保存修改，请先在 UE 中保存或撤销",
            },
          ],
          blockedReasons: [
            ...(formationDirty
              ? [
                  "Formation BP /Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000 存在未保存修改，请先在 UE 中保存或撤销",
                ]
              : []),
            "角色 BP /Game/Test/BP_Guard 存在未保存修改，请先在 UE 中保存或撤销",
          ],
          warnings: ["1 个镜头的投影验收未通过，确认后仍可导出"],
          shots: [
            {
              shotIndex: 0,
              dialogueIds: ["735001", "735002"],
              projectionValid: false,
              actorActionCount: 2,
              blockedReasons: [],
            },
          ],
          nodes: [
            {
              dialogueId: "735001",
              shotIndex: 0,
              role: "shot_start",
              action: "replace",
              existingCameraPosition: "old",
              desiredCameraPosition: "c1",
              existingMovementCount: 1,
              desiredMovementCount: 1,
            },
            {
              dialogueId: "735002",
              shotIndex: 0,
              role: "continuation",
              action: "clear",
              existingCameraPosition: "c2",
              desiredCameraPosition: "",
              existingMovementCount: 1,
              desiredMovementCount: 0,
            },
          ],
          characterActions,
          soundEffects,
          music,
        },
      }),
    });
  });
  await page.route("**/api/ue/storyboard/export", async (route) => {
    exportRequests += 1;
    const request = route.request().postDataJSON();
    exportedStoryboardRequest = request;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "exported",
          dialogueId: "7350",
          startId: "735000",
          dialogueAssetPath:
            "/Game/Seria/Task/dialoggraph/Test/735000.735000",
          changedNodeCount: request.shots.length > 0 ? 2 : 0,
          changedCharacterActionCount: request.characterActions.length,
          changedSoundEffectCount: request.soundEffects.length,
          changedMusicCount: request.music.length,
          saved: true,
        },
      }),
    });
  });
  await page.goto("/");
  const fixtureDirectory = await writeDirectoryFixture(
    testInfo.outputPath("csvdir"),
    [
    {
      name: "对话表.csv",
      content: [
          "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End,Dialog.State,Dialog.CharacterBehaviourString,Dialog.RelativeTransformsString",
          "##对话ID,人物,内容,下一ID,结束,状态,动作,相对位置",
          "735000,,,735009,false,,,",
          '735009,1,不可见的镜头关键帧,735001,false,4,"0.000000,AM_Talk,0,0,0,0,0,0,0,0;",',
          '735001,1,你来了。,735002,false,0,"0.000000,AM_Talk,0,0,0,0,0,0,0,0;0.000000,AM_TurnRight90,1,0,0,0,0,0,0,0|0.000000,AM_Walk,2,0,0,0,100,200,0,0|0.000000,None,3,100,200,0,50,300,0,0",',
          '735002,101968,巡逻队马上就会回来。,,true,0,";0.000000,AM_Talk,0,0,0,0,0,0,0,0",',
      ].join("\n"),
    },
    {
      name: "对话表_开始节点.csv",
      content: [
        "##&DialogStart.id,DialogStart.Outline,DialogStart.Formation,DialogStart.Model",
        "##对话ID,剧情梗概,模板,模型",
        "735000,敌人逼近，双方在危险中对话,/Game/Seria/Task/Mod/MainQuest/Cha9/BP_735000.BP_735000_C,player;M63_Cityguard",
      ].join("\n"),
    },
    {
      name: "NPC表.csv",
      content: [
        "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
        "##id,名称,介绍,资源",
        "1,玩家,玩家,",
        "101968,商会安保,守卫,200135",
        "101892,西维尔,背景职员,200528",
      ].join("\n"),
    },
    {
      name: "m模型资源表.csv",
      content: [
        "##&Model.id,,Model.path",
        "##id,配置填写在此列，Model.path保存时自动生成，由程序调用,生成路径",
        "200135,/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC,/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC.BP_M63_Cityguard_NPC_C",
        "200528,/Game/Seria/NPC/N115_Finance_Female/BP_N115_Finance_Female,/Game/Seria/NPC/N115_Finance_Female/BP_N115_Finance_Female.BP_N115_Finance_Female_C",
      ].join("\n"),
      },
    ],
  );
  await page.locator('input[type="file"]').setInputFiles(fixtureDirectory);
  await page.getByLabel("四位数对话 ID 或对白内容").fill("7350");
  await page.getByRole("button", { name: "分析对话与站位" }).click();
  await expect(
    page.getByRole("button", { name: "分析对话与站位" }),
  ).toBeDisabled();
  await expect(
    page.locator(".dialogue-preview p").filter({ hasText: "你来了。" }),
  ).toBeVisible();
  await expect(page.locator(".dialogue-row")).toHaveCount(2);
  await expect(page.locator(".shot-row")).toHaveCount(0);
  await expect(
    page.getByText("正在查询 UE Blueprint 站位").first(),
  ).toBeVisible();
  releaseFormation();

  const dialog = page.getByRole("dialog", {
    name: "选择镜头分析使用的占位",
  });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByText("LOCAL CAMERA WORKSPACE / 01"),
  ).toBeHidden();
  await expect(dialog.getByText("BP 角色槽")).toBeVisible();
  await expect(dialog.locator(".formation-compare-metrics")).toContainText(
    "对白 / 背景2 / 1",
  );
  await expect(dialog.getByText(/背景 NPC 只参与构图/)).toBeVisible();
  const playerPositionLock = dialog.getByRole("checkbox", {
    name: /固定 0 号玩家位置/,
  });
  await expect(playerPositionLock).not.toBeChecked();
  await expect(
    dialog.getByText(/取消后仅允许导演调整 0 号位/),
  ).toBeVisible();
  await expect(
    dialog.locator(".actor-label").filter({ hasText: "玩家" }).first(),
  ).not.toHaveAttribute("data-facing-target", "-1.500,0.000,4.600");
  await playerPositionLock.check();
  await expect(
    dialog.locator(".actor-label").filter({ hasText: "玩家" }).first(),
  ).toHaveAttribute("data-facing-target", "-1.500,0.000,4.600");
  await playerPositionLock.uncheck();
  await dialog.screenshot({
    path: testInfo.outputPath("blueprint-formation-choice.png"),
  });
  await dialog.getByRole("button", { name: "关闭占位选择" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "切换占位方案" }).click();
  const reopenedDialog = page.getByRole("dialog", {
    name: "切换占位方案",
  });
  await reopenedDialog.getByRole("button", { name: "BP_735000" }).click();
  await reopenedDialog.getByRole("button", { name: "使用此占位" }).click();
  const formationStatus = page.locator(".formation-status").first();
  await expect(formationStatus).toContainText("占位方案");
  await expect(formationStatus).toContainText("BP_735000");
  await expect(formationStatus).not.toContainText("/Game/");
  await page.getByRole("button", { name: "切换占位方案" }).click();
  const switchDialog = page.getByRole("dialog", {
    name: "切换占位方案",
  });
  await expect(
    switchDialog.getByRole("button", { name: "BP_735000" }),
  ).toBeVisible();
  await switchDialog.getByRole("button", { name: "规则占位" }).click();
  await switchDialog.getByRole("button", { name: "使用此占位" }).click();
  await expect(formationStatus).toContainText("规则导演占位");
  await expect(
    page.getByRole("button", { name: "需绑定 BP 站位" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/未绑定 UE Blueprint 站位/),
  ).toBeVisible();
  await page.getByRole("button", { name: "切换占位方案" }).click();
  await page
    .getByRole("dialog", { name: "切换占位方案" })
    .getByRole("button", { name: "BP_735000" })
    .click();
  await page
    .getByRole("dialog", { name: "切换占位方案" })
    .getByRole("button", { name: "使用此占位" })
    .click();
  await expect(formationStatus).toContainText("BP_735000");
  expect(formationRequests).toBe(1);
  await page
    .getByRole("button", { name: "重新读取 BP_735000 位置" })
    .click();
  const refreshedDialog = page.getByRole("dialog", {
    name: "切换占位方案",
  });
  await expect(refreshedDialog).toBeVisible();
  expect(formationRequests).toBe(2);
  await refreshedDialog
    .getByRole("button", { name: "关闭占位方案切换" })
    .click();
  await page.getByRole("button", { name: "TRAE 协作" }).click();
  const traeStrategyDialog = page.getByRole("dialog", {
    name: "选择 TRAE 分镜使用的占位",
  });
  await expect(traeStrategyDialog).toBeVisible();
  await expect(
    traeStrategyDialog.getByRole("button", { name: "BP_735000" }),
  ).toHaveAttribute("aria-pressed", "true");
  const traeAutonomousPlacement = traeStrategyDialog.getByRole("button", {
    name: "TRAE 自主占位",
  });
  const traePlayerPositionLock = traeStrategyDialog.getByRole("checkbox", {
    name: /固定 0 号玩家位置/,
  });
  await expect(traeAutonomousPlacement).toBeVisible();
  await traeAutonomousPlacement.click();
  await expect(traePlayerPositionLock).toBeDisabled();
  await expect(
    traeStrategyDialog.getByText(/重新设计全部角色位置/),
  ).toBeVisible();
  await traeStrategyDialog
    .getByRole("button", { name: "BP_735000" })
    .click();
  await expect(
    traePlayerPositionLock,
  ).not.toBeChecked();
  await traeStrategyDialog.screenshot({
    path: testInfo.outputPath("trae-formation-strategy.png"),
  });
  await traeStrategyDialog
    .getByRole("button", { name: "开始 TRAE 分析" })
    .click();
  await expect(traeStrategyDialog).toBeHidden();
  await expect.poll(() => traeDirectorInput).not.toBeNull();
  expect(traeDirectorInput).toMatchObject({
    constraints: {
      preserve_input_formation: true,
      lock_player_position: false,
    },
  });
  await expect(
    page.getByText("AI 后台生成中，可导出当前方案"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新读取 BP_735000 位置" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "重新读取 BP_735000 位置" }),
  ).toHaveAttribute("title", /中断 TRAE 并重新读取/);
  const backgroundExportButton = page.getByRole("button", {
    name: "导出到 UE",
  });
  await expect(backgroundExportButton).toBeEnabled();
  await backgroundExportButton.click();
  const backgroundExportDialog = page.getByRole("dialog", {
    name: "导出当前镜头 01",
  });
  await expect(backgroundExportDialog).toBeVisible();
  await backgroundExportDialog
    .getByRole("button", { name: "关闭导出预检" })
    .click();
  inspectedExportRequests.length = 0;
  releaseDirector();
  await expect(
    page.getByRole("dialog", { name: "对比 AI 与当前占位" }),
  ).toHaveCount(0);
  await expect(page.getByText(/实际：内部 TRAE/)).toBeVisible();
  await page.getByRole("button", { name: "切换占位方案" }).click();
  const aiSwitchDialog = page.getByRole("dialog", {
    name: "切换占位方案",
  });
  await expect(
    aiSwitchDialog.getByRole("button", { name: "内部 TRAE 占位" }),
  ).toBeVisible();
  await page.waitForTimeout(350);
  await aiSwitchDialog.screenshot({
    path: testInfo.outputPath("formation-switch-options.png"),
  });
  await aiSwitchDialog
    .getByRole("button", { name: "内部 TRAE 占位" })
    .click();
  await aiSwitchDialog
    .getByRole("button", { name: "使用此占位" })
    .click();
  await expect(formationStatus).toContainText("内部 TRAE 占位");
  await expect(
    page.getByRole("button", { name: "导出到 UE" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "切换占位方案" }).click();
  await page
    .getByRole("dialog", { name: "切换占位方案" })
    .getByRole("button", { name: "BP_735000" })
    .click();
  await page
    .getByRole("dialog", { name: "切换占位方案" })
    .getByRole("button", { name: "使用此占位" })
    .click();
  await expect(formationStatus).toContainText("BP_735000");
  await expect(page.getByText("已忽略 1 个关闭 UI 节点", { exact: false }))
    .toBeVisible();
  await expect(page.locator(".stage-cast__item")).toHaveCount(3);
  await expect(
    page.locator(".stage-cast__item", { hasText: "玩家" }),
  ).toHaveAttribute("title", /对白角色 · 在场 · BP 0/);
  await expect(
    page.locator(".stage-cast__item", { hasText: "玩家" }),
  ).not.toHaveAttribute("title", /初始朝向 -90°/);
  await expect(
    page
      .locator(".stage-cast__item", { hasText: "玩家" })
      .locator(":scope > span"),
  ).toHaveText("0");
  await expect(
    page.locator(".stage-cast__item", { hasText: "西维尔" }),
  ).toHaveAttribute("title", /背景 NPC · 在场 · BP 2 · 初始朝向 -180°/);
  await expect(
    page
      .locator(".stage-cast__item", { hasText: "西维尔" })
      .locator(":scope > span"),
  ).toHaveText("2");
  await page.getByRole("tab", { name: "导演" }).click();
  await expect(page.getByText("演员动作", { exact: true })).toBeVisible();
  await expect(page.getByText("右转 45°", { exact: true })).toHaveCount(1);
  await page.waitForTimeout(350);
  await page.screenshot({
    path: testInfo.outputPath("blueprint-facing-and-turn-plan.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "UE" }).click();
  await expect(page.getByText(/已读取 3 个 BP、15 个动作/)).toBeVisible();
  const firstActionNode = page.locator(".character-action-node__toggle").first();
  await expect(firstActionNode).toHaveAttribute("aria-expanded", "true");
  await firstActionNode.click();
  await expect(
    page.locator('.character-action-node__toggle[aria-expanded="true"]'),
  ).toHaveCount(0);
  await expect(page.locator(".character-action-node__body")).toHaveCount(0);
  await firstActionNode.click();
  await expect(firstActionNode).toHaveAttribute("aria-expanded", "true");
  const guardActions = page
    .locator(".character-action-track")
    .filter({ hasText: "商会安保" });
  await expect(
    guardActions.locator(".character-action-existing-row"),
  ).toHaveCount(4);
  await expect(
    guardActions.getByText("AM_Idle1", { exact: true }),
  ).toBeVisible();
  await expect(
    guardActions.getByText("AM_TurnRight90", { exact: true }),
  ).toBeVisible();
  await expect(
    guardActions.getByText("AM_Walk", { exact: true }),
  ).toBeVisible();
  await expect(
    guardActions.getByText(/状态机走位/),
  ).toBeVisible();
  await expect(
    guardActions.locator(".character-action-existing-row").getByRole(
      "combobox",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "节点 735001 添加角色" }),
  ).toHaveValue("-1");
  const guardFacingLabel = page
    .locator(".actor-label")
    .filter({ hasText: "商会安保" })
    .first();
  await expect(guardFacingLabel).toHaveAttribute(
    "data-position",
    "0.900,0.000,-1.500",
  );
  const facingBeforeTurn = await guardFacingLabel.getAttribute(
    "data-facing-target",
  );
  await guardActions.getByRole("button", { name: "添加动作" }).click();
  const firstActionPicker = guardActions
    .locator(".character-action-row")
    .first()
    .getByRole("combobox");
  await expect(firstActionPicker).toHaveValue("");
  await firstActionPicker.fill("TurnRight90");
  await page.screenshot({
    path: testInfo.outputPath("character-action-search.png"),
    fullPage: true,
  });
  await guardActions
    .getByRole("option", { name: "AM_TurnRight90", exact: true })
    .click();
  await page.waitForTimeout(500);
  expect(
    await guardFacingLabel.getAttribute("data-facing-target"),
  ).not.toBe(
    facingBeforeTurn,
  );
  await guardActions.getByRole("button", { name: "添加动作" }).click();
  const secondActionPicker = guardActions
    .locator(".character-action-row")
    .nth(1)
    .getByRole("combobox");
  await expect(secondActionPicker).toHaveValue("");
  await secondActionPicker.fill("wave");
  await guardActions
    .getByRole("option", { name: "AM_Wave", exact: true })
    .click();
  await guardActions
    .locator(".character-action-row")
    .nth(1)
    .getByRole("spinbutton")
    .fill("0.6");
  await expect(guardActions.locator(".character-action-row")).toHaveCount(2);
  await expect(guardActions).toContainText("另保留 1 个无 Montage 特殊动作");
  await guardActions
    .locator(".character-action-row")
    .evaluateAll((rows) => {
      const transfer = new DataTransfer();
      rows[1].dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          dataTransfer: transfer,
        }),
      );
      rows[0].dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
      rows[0].dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    });
  await expect(
    guardActions.locator(".character-action-row").first().getByRole("combobox"),
  ).toHaveValue("AM_Wave");
  await page.screenshot({
    path: testInfo.outputPath("character-action-editor.png"),
    fullPage: true,
  });
  await expect(page.locator(".shot-row.is-invalid")).toHaveCount(0);
  await expect(page.getByLabel("投影验收未通过")).toHaveCount(0);
  await page.getByRole("button", { name: "进入配置小窗" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-configuration-mode",
    "true",
  );
  await expect(page.locator(".left-panel")).toBeHidden();
  await expect(page.locator(".viewport-panel")).toBeHidden();
  await expect(page.getByRole("tab", { name: "导演" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "镜头" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "音频" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "UE" })).toBeVisible();
  await page.getByRole("tab", { name: "音频" }).click();
  await page.getByRole("tab", { name: "UE" }).click();
  await expect(
    guardActions.locator(".character-action-row").first().getByRole("combobox"),
  ).toHaveValue("AM_Wave");
  await page.getByRole("tab", { name: "音频" }).click();
  await expect(page.locator(".music-recommendation-list")).toContainText(
    "情绪-危机爆发",
  );
  const exportButton = page.getByRole("button", { name: "导出到 UE" });
  await expect(exportButton).toBeEnabled();
  await exportButton.click();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-configuration-mode",
    "false",
  );
  await expect(page.getByRole("tab", { name: "导演" })).toBeVisible();
  const exportDialog = page.getByRole("dialog");
  await expect(exportDialog).toBeVisible();
  await expect(
    exportDialog.getByRole("heading", { name: "导出当前镜头 01" }),
  ).toBeVisible();
  await expect(exportDialog).toContainText("尚未连接 UE");
  await expect(exportDialog.getByText("商会安保")).toBeVisible();
  await expect(exportDialog.getByText("BP 1")).toBeVisible();
  expect(inspectedExportRequests).toHaveLength(0);
  const currentShotCheckbox = exportDialog.getByRole("checkbox", {
    name: "选择镜头 01",
  });
  await expect(currentShotCheckbox).toBeChecked();
  await currentShotCheckbox.uncheck();
  await expect(exportDialog.getByText("01 · 未选")).toBeVisible();
  await exportDialog
    .getByRole("checkbox", { name: "选择音效 A_SFX_Dialog_729701" })
    .uncheck();
  await exportDialog
    .getByRole("checkbox", { name: "选择音乐 情绪-危机爆发" })
    .uncheck();
  await exportDialog
    .getByRole("button", { name: "检查所选内容" })
    .click();
  await expect.poll(() => inspectedExportRequests.length).toBe(1);
  expect(inspectedExportRequests[0]).toMatchObject({
    dialogueIds: [],
    participantModelIndexes: [1],
    shots: [],
    characterActions: [
      {
        dialogueId: "735001",
        modelIndex: 1,
        characterLabel: "商会安保",
      },
    ],
    soundEffects: [],
    music: [],
  });
  await exportDialog
    .getByRole("button", { name: "关闭导出预检" })
    .click();
  inspectedExportRequests.length = 0;
  await exportButton.click();
  await expect(exportDialog).toContainText("尚未连接 UE");
  const reopenedCurrentShotCheckbox = exportDialog.getByRole("checkbox", {
    name: "选择镜头 01",
  });
  await expect(reopenedCurrentShotCheckbox).toBeChecked();
  await reopenedCurrentShotCheckbox.uncheck();
  await expect(exportDialog.getByText("01 · 未选")).toBeVisible();
  await reopenedCurrentShotCheckbox.check();
  await expect(exportDialog.getByText("01 · 已选")).toBeVisible();
  await exportDialog
    .getByRole("button", { name: "检查所选内容" })
    .click();
  await expect(
    exportDialog.getByText(/Formation BP .*存在未保存修改/),
  ).toBeVisible();
  formationDirty = false;
  await exportDialog
    .getByRole("button", {
      name: "刷新 UE 未保存状态：Formation BP",
    })
    .click();
  await expect(
    exportDialog.getByText(/Formation BP .*存在未保存修改/),
  ).toHaveCount(0);
  await expect(reopenedCurrentShotCheckbox).toBeChecked();
  await expect(exportDialog.getByText("覆盖", { exact: true })).toBeVisible();
  await expect(
    exportDialog.getByText("清空旧镜头", { exact: true }),
  ).toBeVisible();
  expect(inspectedExportRequests[0]).toMatchObject({
    dialogueId: "7350",
    startId: "735000",
    dialogueIds: ["735001", "735002"],
    participantModelIndexes: [0, 1, 2],
    usesBlueprintFormation: true,
    characterActions: [
      {
        dialogueId: "735001",
        modelIndex: 1,
        actions: [
          { montageName: "AM_Wave", delaySeconds: 0.6 },
          { montageName: "AM_TurnRight90", delaySeconds: 0 },
        ],
      },
    ],
    soundEffects: [
      {
        dialogueId: "735002",
        assetName: "A_SFX_Dialog_729701",
      },
    ],
    music: [
      {
        dialogueId: "735001",
        stateId: 13,
        stateName: "Crisis_Breakout",
        musicName: "情绪-危机爆发",
      },
    ],
    shots: [
      expect.objectContaining({
        actorActions: [
          expect.objectContaining({
            modelIndex: 0,
            montageName: "AM_TurnLeft45",
          }),
          expect.objectContaining({
            modelIndex: 1,
            montageName: "AM_TurnRight45",
          }),
        ],
      }),
    ],
  });
  await expect(
    exportDialog.getByText(/2 个自动转身建议.*动作编辑器/),
  ).toBeVisible();
  await expect(
    exportDialog.getByRole("checkbox", {
      name: "选择节点 735001 槽 1 的角色动作",
    }),
  ).toBeChecked();
  await expect(
    exportDialog.getByRole("checkbox", {
      name: "选择音效 A_SFX_Dialog_729701",
    }),
  ).toBeChecked();
  await exportDialog.screenshot({
    path: testInfo.outputPath("storyboard-export-current.png"),
  });
  await exportDialog.getByRole("button", { name: "全部导出" }).click();
  await expect(exportDialog).toContainText("尚未连接 UE");
  await exportDialog
    .getByRole("button", { name: "检查所选内容" })
    .click();
  await expect(
    exportDialog.getByRole("button", { name: "检查中" }),
  ).toBeVisible();
  await expect(
    exportDialog.getByText("写入中", { exact: true }),
  ).toHaveCount(0);
  releaseAllExportPreview();
  await expect(
    exportDialog.getByRole("heading", { name: "导出全部分镜" }),
  ).toBeVisible();
  expect(inspectedExportRequests).toHaveLength(3);
  const exportSections = ["镜头数据", "角色动作", "音效建议", "音乐建议"];
  for (const sectionName of exportSections) {
    const toggle = exportDialog.getByRole("button", {
      name: new RegExp(sectionName),
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  }
  await exportDialog.screenshot({
    path: testInfo.outputPath("storyboard-export-collapsed.png"),
  });
  for (const sectionName of exportSections) {
    const toggle = exportDialog.getByRole("button", {
      name: new RegExp(sectionName),
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
  await exportDialog.screenshot({
    path: testInfo.outputPath("storyboard-export-preview.png"),
  });
  const confirmButton = exportDialog.getByRole("button", {
    name: "确认写入并保存",
  });
  const shotCheckbox = exportDialog.getByRole("checkbox", {
    name: "选择镜头 01",
  });
  await expect(shotCheckbox).toBeChecked();
  await shotCheckbox.uncheck();
  await expect(exportDialog.getByText("0 / 1")).toBeVisible();
  await expect(confirmButton).toBeDisabled();
  const soundEffectCheckbox = exportDialog.getByRole("checkbox", {
    name: "选择音效 A_SFX_Dialog_729701",
  });
  await expect(soundEffectCheckbox).toBeChecked();
  const characterActionCheckbox = exportDialog.getByRole("checkbox", {
    name: "选择节点 735001 槽 1 的角色动作",
  });
  await expect(characterActionCheckbox).toBeChecked();
  await expect(
    exportDialog.getByText(/角色 BP .*存在未保存修改/),
  ).toBeVisible();
  const musicCheckbox = exportDialog.getByRole("checkbox", {
    name: "选择音乐 情绪-危机爆发",
  });
  await expect(musicCheckbox).toBeChecked();
  await characterActionCheckbox.uncheck();
  await expect(
    exportDialog.getByText(/角色 BP .*存在未保存修改/),
  ).toHaveCount(0);
  await soundEffectCheckbox.uncheck();
  await expect(confirmButton).toBeInViewport();
  await expect(
    exportDialog.getByRole("button", { name: "取消" }),
  ).toBeInViewport();
  const exportDialogBox = await exportDialog.boundingBox();
  const exportFooterBox = await exportDialog.locator("footer").boundingBox();
  expect(exportDialogBox).not.toBeNull();
  expect(exportFooterBox).not.toBeNull();
  expect(exportFooterBox!.y + exportFooterBox!.height).toBeLessThanOrEqual(
    exportDialogBox!.y + exportDialogBox!.height + 1,
  );
  await exportDialog.screenshot({
    path: testInfo.outputPath("storyboard-export-no-selection.png"),
  });
  await exportDialog
    .getByLabel(
      /已核对 0 个镜头节点、 0 组角色动作、 0 个音效和 1 首音乐/,
    )
    .check();
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(
    exportDialog.getByText(
      "已写入 0 个镜头节点、0 组角色动作、0 个音效和 1 首音乐并保存",
    ),
  ).toBeVisible();
  expect(exportRequests).toBe(1);
  expect(exportedStoryboardRequest).toMatchObject({
    dialogueIds: [],
    shots: [],
    characterActions: [],
    soundEffects: [],
    music: [
      {
        dialogueId: "735001",
        stateId: 13,
        stateName: "Crisis_Breakout",
        musicName: "情绪-危机爆发",
      },
    ],
  });
  await page.screenshot({
    path: testInfo.outputPath("blueprint-invalid-shot.png"),
    fullPage: true,
  });
});

test("previews mission targets and blocks mixed MapIDs before UE loading", async ({
  page,
}, testInfo) => {
  let loadRequests = 0;
  let formationRequests = 0;
  let createRequests = 0;
  let createdBlueprintName = "";
  let createdTargetIds: string[] = [];
  let targetOnlyWriteItems: Array<{
    existingModelId: number | null;
    existingNpcId: number | null;
    mapId: string;
    newNpc: { name: string; title: string } | null;
  }> = [];
  let npcOnlyWriteItems: Array<{
    existingModelId: number | null;
    existingNpcId: number | null;
    mapId: string;
    newNpc: { name: string; title: string } | null;
  }> = [];
  let registrationWriteScope = "";
  let selectionReadRequests = 0;
  let targetUpdateItems: Array<{
    targetId: string;
    mapId: string;
    originalTransform: {
      location: { x: number; y: number; z: number };
      rotation: { pitch: number; yaw: number; roll: number };
    };
    transform: {
      location: { x: number; y: number; z: number };
      rotation: { pitch: number; yaw: number; roll: number };
    };
  }> = [];
  let loadedTaskId = "";
  let loadedTargetIds: string[] = [];
  let loadedMapMode = "";
  let mapStatusMatches = false;
  let refreshedTaskRequests = 0;
  await page.route(
    "**/api/ue/mission-targets/resolve",
    async (route) => {
      refreshedTaskRequests += 1;
      const request = route.request().postDataJSON();
      expect(request.taskId).toBe("900002");
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: {
            message:
              "任务节点 900002 的目标物 MapID 不一致（500001:1204、500003:1205），请检查配置后重试",
          },
        }),
      });
    },
  );
  await page.route("**/api/ue/formation/read", async (route) => {
    formationRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "not_found",
          message: "未找到 BP_735000",
        },
      }),
    });
  });
  await page.route(
    "**/api/ue/mission-targets/create-blueprint",
    async (route) => {
      createRequests += 1;
      const request = route.request().postDataJSON();
      createdBlueprintName = request.blueprintName;
      createdTargetIds = request.selectedTargetIds;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            status: "created",
            taskId: request.plan.taskId,
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/MainQuest/Test/BP_Test.BP_Test",
            targetCount: createdTargetIds.length,
            componentNames: ["0", "1", "c1"],
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/check-blueprint",
    async (route) => {
      const request = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            status: "matched",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/MainQuest/Test/BP_Test.BP_Test",
            dialogueId: request.plan.taskId,
            dialogueAssetPath:
              "/Game/Seria/Task/dialoggraph/Test.Test",
            formationClassPath:
              "/Game/Seria/Task/Mod/MainQuest/Test/BP_Test.BP_Test_C",
            dialogueModels: [],
            selectedModels: [],
            message: "Formation 和模型顺序均匹配",
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/inspect-blueprint",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            blueprintState: "empty",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/MainQuest/Test/BP_Test.BP_Test",
            blueprintClassPath:
              "/Game/Seria/Task/Mod/MainQuest/Test/BP_Test.BP_Test_C",
            parentClassPath:
              "/Game/Seria/Blueprint/Task/PositionModeBase.PositionModeBase_C",
            dialogueId: null,
            dialogueAssetPath: null,
            formationClassPath: null,
            slots: [],
            message: "BP 尚未创建站位组件",
          },
        }),
      });
    },
  );
  await page.route("**/api/ue/selection/registration", async (route) => {
    const existingActor = {
      actorRef: "BP_Guard_C_0",
      label: "守卫预览",
      classPath:
        "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
      transform: {
        location: { x: 10, y: 20, z: 30 },
        rotation: { pitch: 0, yaw: 90, roll: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    };
    const newActor = {
      actorRef: "BP_Guard_C_1",
      label: "守卫新增",
      classPath:
        "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
      transform: {
        location: { x: 100, y: 200, z: 300 },
        rotation: { pitch: 0, yaw: 45, roll: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    };
    const model = {
      id: 200135,
      configuredPath: "/Game/Seria/NPC/Guard/BP_Guard",
      generatedClassPath:
        "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
      rowNumber: 3,
    };
    const npc = {
      id: 101968,
      name: "商会安保",
      note: "",
      introduction: "",
      resourceId: 200135,
      hasDialogue: true,
      hasAvatar: true,
    };
    const target = {
      id: "500001",
      type: 1,
      description: "商会安保",
      npcId: 101968,
      itemId: 0,
      blueprintModelId: null,
      mapId: "1204",
      positionText: "(X=10,Y=20,Z=30)",
      rotationText: "(Pitch=0,Yaw=90,Roll=0)",
      rowNumber: 3,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          selection: {
            mapAssetPath:
              "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
            actors: [existingActor, newActor],
          },
          candidates: [
            {
              actor: existingActor,
              modelOptions: [model],
              npcOptions: [npc],
              positionMatches: [target],
              targetMatches: [target],
              mapOptions: [
                {
                  id: "1204",
                  name: "上城区",
                  resourceId: "100128",
                  assetPath:
                    "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
                  rowNumber: 3,
                },
              ],
              mapId: "1204",
              mapName: "上城区",
            },
            {
              actor: newActor,
              modelOptions: [model],
              npcOptions: [npc],
              positionMatches: [],
              targetMatches: [],
              mapOptions: [
                {
                  id: "1204",
                  name: "上城区",
                  resourceId: "100128",
                  assetPath:
                    "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
                  rowNumber: 3,
                },
              ],
              mapId: "1204",
              mapName: "上城区",
            },
          ],
        },
      }),
    });
  });
  await page.route("**/api/ue/selection/read", async (route) => {
    selectionReadRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          mapAssetPath:
            "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
          actors: [
            {
              actorRef:
                "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea.PersistentLevel.ShotSandboxMissionTargetPreview_900001_500001",
              label:
                "ShotSandboxMissionTargetPreview_900001_500001",
              classPath:
                "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
              transform: {
                location: { x: 15, y: 25, z: 35 },
                rotation: { pitch: 0, yaw: 95, roll: 0 },
                scale: { x: 1, y: 1, z: 1 },
              },
            },
          ],
        },
      }),
    });
  });
  await page.route("**/api/ue/config-table/open", async (route) => {
    const table = route.request().postDataJSON().table;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          table,
          path: "C:\\trunk\\doc\\xlsdir\\test.xlsm",
        },
      }),
    });
  });
  await page.route("**/api/ue/config-registration/write", async (route) => {
    const request = route.request().postDataJSON();
    registrationWriteScope = request.scope;
    if (request.scope === "npc_only") {
      npcOnlyWriteItems = request.items;
    } else if (request.scope === "target_only") {
      targetOnlyWriteItems = request.items;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          createdModels: [],
          createdNpcs:
            request.scope === "npc_only"
              ? [{ actorRef: "BP_Guard_C_1", id: 101999 }]
              : [],
          createdTargets:
            request.scope === "target_only"
              ? [{ actorRef: "BP_Guard_C_1", id: 500005 }]
              : [],
          reusedTargets: [],
          openedWorkbooks: [
            request.scope === "npc_only"
              ? "C:\\trunk\\doc\\xlsdir\\NPC表.xlsm"
              : "C:\\trunk\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
          ],
        },
      }),
    });
  });
  await page.route(
    "**/api/ue/config-registration/update-targets",
    async (route) => {
      targetUpdateItems = route.request().postDataJSON().items;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            updatedTargets: [{ targetId: "500001", rowNumber: 3 }],
            unchangedTargetIds: [],
            openedWorkbooks: [
              "C:\\trunk\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
            ],
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/map-status",
    async (route) => {
      const request = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            currentMapAssetPath: mapStatusMatches
              ? request.mapAssetPath
              : "/Game/Seria/Maps/Old/Old",
            expectedMapAssetPath: request.mapAssetPath,
            matches: mapStatusMatches,
          },
        }),
      });
    },
  );
  await page.route("**/api/ue/mission-targets/load", async (route) => {
    loadRequests += 1;
    const request = route.request().postDataJSON();
    loadedTaskId = request.plan.taskId;
    loadedMapMode = request.mapMode;
    loadedTargetIds = request.plan.targets.map(
      (target: { targetId: string }) => target.targetId,
    );
    if (request.mapMode === "auto") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "loaded",
            taskId: request.plan.taskId,
          mapId: "1204",
          mapAssetPath:
            "/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
            autoOpenedMap: request.mapMode === "auto",
          spawnedCount: loadedTargetIds.length,
          assetCount: 1,
          markerCount: Math.max(0, loadedTargetIds.length - 1),
        },
      }),
    });
  });

  const fixtureDirectory = await writeDirectoryFixture(
    testInfo.outputPath("fixture", "csvdir"),
    [
      {
        name: "对话表.csv",
        content: [
          "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
          "##对话ID,人物,内容,下一ID,结束",
          "735000,,,735001,false",
          "735001,1,你来了。,735002,false",
          "735002,101968,请止步。,,true",
        ].join("\n"),
      },
      {
        name: "对话表_开始节点.csv",
        content: [
          "##&DialogStart.id,DialogStart.Outline",
          "##对话ID,剧情梗概",
          "735000,目标物测试",
        ].join("\n"),
      },
      {
        name: "NPC表.csv",
        content: [
          "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
          "##id,名称,介绍,资源",
          "1,玩家,玩家,",
          "101968,商会安保,守卫,200135",
        ].join("\n"),
      },
      {
        name: "m模型资源表.csv",
        content: [
          "##&Model.id,,Model.path",
          "##id,配置路径,生成路径",
          "200135,/Game/Seria/NPC/Guard/BP_Guard,/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
        ].join("\n"),
      },
      {
        name: "任务表.csv",
        content: [
          "##&字段标记,Mission.id,Mission.Name,Mission.ShowNPC",
          "##任务类型,任务ID,任务名称,显示目标物",
          ',900001,同地图任务,"500001,500002"',
          ',900002,错误地图任务,"500001,500003"',
        ].join("\n"),
      },
      {
        name: "m目标物表.csv",
        content: [
          "##&MissionPosition.ID,,,MissionPosition.type,MissionPosition.NPCID,MissionPosition.ItemID,MissionPosition.BluePrint,MissionPosition.MapID,MissionPosition.Position,MissionPosition.Rotation",
          "##ID,类型,描述,坐标类型,NPCID,物品ID,蓝图路径,地图ID,座标,旋转",
          '500001,剧情NPC,商会安保,1,101968,0,,1204,"(X=10,Y=20,Z=30)","(Pitch=0,Yaw=90,Roll=0)"',
          '500002,触发器,抵达区域,3,0,0,,1204,"(X=40,Y=50,Z=60)","(Pitch=0,Yaw=0,Roll=0)"',
          '500003,触发器,错误地图,3,0,0,,1205,"(X=70,Y=80,Z=90)","(Pitch=0,Yaw=0,Roll=0)"',
        ].join("\n"),
      },
      {
        name: "d地图配置表.csv",
        content: [
          "##&MapConfig.id,MapConfig.name,,,MapConfig.resourceid",
          "##ID,地图名称,地图备注,地图资源（注释用）,资源ID",
          "1204,上城区,,,100128",
          "1205,其他地图,,,100129",
        ].join("\n"),
      },
      {
        name: "d地图资源表.csv",
        content: [
          "##&Scene.id,Scene.path",
          "##id,path",
          "100128,/Game/Seria/Maps/08_01_UrbanArea/08_01_UrbanArea",
          "100129,/Game/Seria/Maps/Other/Other",
        ].join("\n"),
      },
    ],
  );

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixtureDirectory);
  await page.getByLabel("四位数对话 ID 或对白内容").fill("7350");
  await page.getByRole("button", { name: "分析对话与站位" }).click();
  const outlineToggle = page.getByRole("button", { name: /剧情梗概/ });
  await expect(outlineToggle).toHaveAttribute("aria-expanded", "false");
  await outlineToggle.click();
  await expect(page.getByText("目标物测试", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/未找到 BP_735000，已跳过 BP 并使用自动站位/),
  ).toBeVisible();
  await expect(page.getByText(/实际：规则导演/)).toBeVisible();
  await expect(page.locator(".shot-row")).toHaveCount(1);
  expect(formationRequests).toBe(1);
  await page.getByRole("button", { name: "任务目标物" }).click();
  const dialog = page.getByRole("region", {
    name: "任务目标物",
    exact: true,
  });

  await dialog.getByLabel("任务节点 ID").fill("900001");
  const readSelectionButton = dialog.getByRole("button", {
    name: "读取 UE 选择",
  });
  await expect(readSelectionButton).toBeEnabled();
  await readSelectionButton.click();
  await expect(dialog.getByText("同地图任务")).toBeVisible();
  await expect(dialog.getByText("上城区 · 1204")).toBeVisible();
  await expect(dialog.locator(".mission-target-table tbody tr")).toHaveCount(2);
  await expect(dialog.getByText("0°, 90°, 0°")).toBeVisible();
  const firstTargetModelCell = dialog
    .locator(".mission-target-table tbody tr")
    .first()
    .locator("td")
    .nth(4);
  await expect(firstTargetModelCell).toHaveText("200135 · BP_Guard");
  await expect(firstTargetModelCell).toHaveAttribute(
    "title",
    "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
  );
  const selectionResult = dialog.getByRole("region", {
    name: "UE 当前选择识别结果",
  });
  await expect(selectionResult).toContainText(
    "ShotSandboxMissionTargetPreview_900001_500001",
  );
  await expect(selectionResult).toContainText("目标物 500001");
  await expect(selectionResult).toContainText("商会安保 · NPC 101968");
  await expect(dialog.getByLabel("选择目标物 500001")).toBeChecked();
  await expect(dialog.getByLabel("选择目标物 500002")).not.toBeChecked();
  await expect(
    dialog
      .locator(".mission-target-row--ue-selected")
      .getByText("UE 已选"),
  ).toBeVisible();
  await expect(dialog.getByText(/已选择 1 \/ 2 个目标物/)).toBeVisible();
  expect(selectionReadRequests).toBe(1);
  await dialog.getByLabel("BP 文件名").fill("BP_Test");
  await dialog.getByRole("button", { name: "检查 BP 与对话模型" }).click();
  await expect(dialog.getByText("BP 尚未创建站位组件")).toBeVisible();
  const modalBounds = await dialog.boundingBox();
  const footerBounds = await dialog.locator("footer").boundingBox();
  expect(modalBounds).not.toBeNull();
  expect(footerBounds).not.toBeNull();
  expect(footerBounds!.y + footerBounds!.height).toBeLessThanOrEqual(
    modalBounds!.y + modalBounds!.height + 1,
  );
  await dialog.screenshot({
    path: testInfo.outputPath("mission-target-selection.png"),
  });
  await dialog.getByRole("button", { name: "创建 BP" }).click();
  await expect(
    dialog.getByText(/0 号玩家、1 个目标物和 c1 摄像机/),
  ).toBeVisible();
  expect(createRequests).toBe(1);
  expect(createdBlueprintName).toBe("BP_Test");
  expect(createdTargetIds).toEqual(["500001"]);
  await dialog.getByRole("button", { name: "加载到 UE" }).click();
  const mapChoice = dialog.getByRole("alertdialog", {
    name: "选择地图加载方式",
  });
  await expect(mapChoice).toBeVisible();
  await expect(
    mapChoice.getByRole("button", { name: "软件自动切换" }),
  ).toBeVisible();
  await mapChoice.screenshot({
    path: testInfo.outputPath("mission-target-map-choice.png"),
  });
  await mapChoice.getByRole("button", { name: "我来手动切换" }).click();
  await expect(
    dialog.getByRole("alertdialog", { name: "等待手动切换地图" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "检查并加载" }).click();
  await expect(dialog.getByText("UE 尚未完成目标地图切换")).toBeVisible();
  expect(loadRequests).toBe(0);
  mapStatusMatches = true;
  await dialog.getByRole("button", { name: "检查并加载" }).click();
  await expect(dialog.getByText(/当前已是\s*上城区/)).toBeVisible();
  expect(loadRequests).toBe(1);
  expect(loadedTaskId).toBe("900001");
  expect(loadedMapMode).toBe("require-current");
  expect(loadedTargetIds).toEqual(["500001"]);

  mapStatusMatches = false;
  await dialog.getByRole("button", { name: "加载到 UE" }).click();
  await dialog
    .getByRole("alertdialog", { name: "选择地图加载方式" })
    .getByRole("button", { name: "软件自动切换" })
    .click();
  await expect(
    dialog.getByRole("alertdialog", {
      name: "正在等待 UE 加载地图",
    }),
  ).toContainText("大型关卡可能需要数十秒");
  await expect(dialog.getByText(/已自动打开\s*上城区/)).toBeVisible();
  expect(loadRequests).toBe(2);
  expect(loadedMapMode).toBe("auto");
  mapStatusMatches = true;

  await dialog.getByRole("button", { name: "修改位置" }).click();
  const targetEditor = page.getByRole("region", {
    name: "修改目标物位置",
    exact: true,
  });
  await expect(targetEditor.getByText("500001", { exact: true })).toBeVisible();
  await expect(
    targetEditor.getByRole("button", { name: "写入修改" }),
  ).toBeEnabled();
  await expect(
    targetEditor.getByRole("button", { name: "重新读取 UE 选择" }),
  ).toBeVisible();
  await expect(targetEditor.getByLabel("目标物 500001 新位置")).toHaveValue(
    "(X=15.000000,Y=25.000000,Z=35.000000)",
  );
  await expect(targetEditor.getByLabel("目标物 500001 新旋转")).toHaveValue(
    "(Pitch=0.000000,Yaw=95.000000,Roll=0.000000)",
  );
  await targetEditor.screenshot({
    path: testInfo.outputPath("mission-target-edit.png"),
  });
  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("仅更新位置和旋转");
    await confirmation.accept();
  });
  await targetEditor.getByRole("button", { name: "写入修改" }).click();
  await expect(targetEditor.getByText(/修改 1 个目标物/)).toBeVisible();
  expect(selectionReadRequests).toBe(1);
  expect(targetUpdateItems).toEqual([
    expect.objectContaining({
      targetId: "500001",
      mapId: "1204",
      originalTransform: expect.objectContaining({
        location: { x: 10, y: 20, z: 30 },
        rotation: { pitch: 0, yaw: 90, roll: 0 },
      }),
      transform: expect.objectContaining({
        location: { x: 15, y: 25, z: 35 },
        rotation: { pitch: 0, yaw: 95, roll: 0 },
      }),
    }),
  ]);
  await targetEditor
    .getByRole("button", { name: "返回任务目标物" })
    .click();
  await expect(dialog.getByText("15, 25, 35")).toBeVisible();
  await expect(dialog.getByText("0°, 95°, 0°")).toBeVisible();

  await dialog.getByLabel("任务节点 ID").fill("900002");
  await dialog.getByRole("button", { name: "解析任务目标物" }).click();
  await expect(dialog.getByText(/目标物 MapID 不一致/)).toBeVisible();
  expect(refreshedTaskRequests).toBe(0);
  await dialog.getByRole("button", { name: "解析任务目标物" }).click();
  await expect.poll(() => refreshedTaskRequests).toBe(1);
  await expect(
    dialog.getByRole("button", { name: /加载|计算.*站位/ }),
  ).toHaveCount(0);
  expect(loadRequests).toBe(2);

  await dialog.getByRole("button", { name: "返回分镜工作台" }).click();
  await page.getByRole("button", { name: "注册 NPC" }).click();
  const registration = page.getByRole("region", {
    name: "注册 NPC",
    exact: true,
  });
  await registration.getByRole("button", { name: "读取 UE 选择" }).click();
  await expect(registration.getByText("守卫预览")).toBeVisible();
  await expect(registration.getByText("已有 500001")).toBeVisible();
  await expect(registration.getByText("200135").first()).toBeVisible();
  await expect(
    registration.getByLabel("守卫预览 NPC 复用方式"),
  ).toHaveValue("101968");
  await expect(
    registration
      .getByLabel("守卫预览 NPC 复用方式")
      .locator('option[value="101968"]'),
  ).toHaveText(/有对白 · 有头像/);
  await expect(
    registration.getByLabel("选择待注册 Actor 守卫预览"),
  ).toBeChecked();
  const newActorCheckbox = registration.getByLabel(
    "选择待注册 Actor 守卫新增",
  );
  await expect(newActorCheckbox).toBeChecked();
  await newActorCheckbox.uncheck();
  await expect(
    registration.getByRole("button", { name: "NPC 表" }),
  ).toBeDisabled();
  await newActorCheckbox.check();
  const newNpcSelect = registration.getByLabel("守卫新增 NPC 复用方式");
  await expect(newNpcSelect.locator("option").first()).toHaveText("新建 NPC");
  await newNpcSelect.selectOption("new");
  await expect(registration.getByLabel("守卫新增 名字")).toHaveValue("");
  await expect(registration.getByLabel("守卫新增 名字")).toHaveAttribute(
    "placeholder",
    "名字",
  );
  await expect(registration.getByLabel("守卫新增 头衔")).toHaveAttribute(
    "placeholder",
    "头衔",
  );
  const previewMapSelect = registration.getByLabel("守卫预览 MapID");
  const newActorMapSelect = registration.getByLabel("守卫新增 MapID");
  await expect(previewMapSelect).toHaveValue("1204");
  await expect(newActorMapSelect).toHaveValue("1204");
  await expect(previewMapSelect.locator("option:checked")).toHaveText(
    "1204 · 上城区",
  );
  await registration.screenshot({
    path: testInfo.outputPath("npc-registration-selection.png"),
  });
  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("不写入目标物表");
    await confirmation.accept();
  });
  await registration.getByRole("button", { name: "NPC 表" }).click();
  await expect(
    registration.getByText(/守卫新增 → 101999/),
  ).toBeVisible();
  expect(registrationWriteScope).toBe("npc_only");
  expect(npcOnlyWriteItems).toEqual([
    expect.objectContaining({
      actorRef: "BP_Guard_C_1",
      existingModelId: 200135,
      existingNpcId: null,
      mapId: "",
      newNpc: expect.objectContaining({
        name: "",
        title: "",
      }),
    }),
  ]);
  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("只向目标物表新增 1 行");
    expect(confirmation.message()).toContain("不打开另外两张表");
    await confirmation.accept();
  });
  await registration.getByRole("button", { name: "写入新增项" }).click();
  await expect(
    registration.getByText(/守卫新增 → 500005/),
  ).toBeVisible();
  expect(registrationWriteScope).toBe("target_only");
  expect(targetOnlyWriteItems).toEqual([
    expect.objectContaining({
      actorRef: "BP_Guard_C_1",
      targetDescription: "守卫新增",
      existingModelId: 200135,
      existingNpcId: 101999,
      mapId: "1204",
      newNpc: null,
    }),
  ]);
  await expect(
    registration.getByRole("button", { name: "写入新增项" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "任务目标物" }).click();
  await expect(dialog.getByLabel("任务节点 ID")).toHaveValue("900002");
  await expect(dialog.getByText(/目标物 MapID 不一致/)).toBeVisible();

  await page.getByRole("button", { name: "注册 NPC" }).click();
  await expect(
    registration.getByText(/守卫新增 → 500005/),
  ).toBeVisible();
});

test("applies one MapID to selected actors and writes reusable NPCs as targets only", async ({
  page,
}, testInfo) => {
  await page.context().grantPermissions([
    "clipboard-read",
    "clipboard-write",
  ]);
  let writeRequest: {
    scope: string;
    items: Array<{
      actorRef: string;
      mapId: string;
      existingModelId: number | null;
      existingNpcId: number | null;
      newNpc: unknown;
    }>;
  } | null = null;
  await page.route("**/api/ue/formation/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { status: "not_found", message: "未找到测试 BP" },
      }),
    });
  });
  const model = {
    id: 200135,
    configuredPath: "/Game/Test/BP_Guard",
    generatedClassPath: "/Game/Test/BP_Guard.BP_Guard_C",
    rowNumber: 3,
  };
  const npc = {
    id: 101968,
    name: "批量守卫",
    note: "",
    introduction: "",
    resourceId: 200135,
    title: "安保",
    canTurn: true,
    hasDialogue: true,
    hasAvatar: true,
  };
  const mapOptions = [
    {
      id: "1204",
      name: "上城区 A",
      resourceId: "100128",
      assetPath: "/Game/Test/Maps/TestMap",
      rowNumber: 3,
    },
    {
      id: "1209",
      name: "上城区 B",
      resourceId: "100129",
      assetPath: "/Game/Test/Maps/TestMap",
      rowNumber: 4,
    },
  ];
  const actors = ["A", "B"].map((suffix, index) => ({
    actorRef: `BP_Guard_C_${index}`,
    label: `批量守卫 ${suffix}`,
    classPath: "/Game/Test/BP_Guard.BP_Guard_C",
    transform: {
      location: { x: 100 + index * 100, y: 200, z: 300 },
      rotation: { pitch: 0, yaw: 90, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }));
  await page.route("**/api/ue/selection/registration", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          selection: {
            mapAssetPath: "/Game/Test/Maps/TestMap",
            actors,
          },
          candidates: actors.map((actor) => ({
            actor,
            modelOptions: [model],
            npcOptions: [npc],
            positionMatches: [],
            targetMatches: [],
            mapOptions,
            mapId: null,
            mapName: "上城区",
          })),
        },
      }),
    });
  });
  await page.route("**/api/ue/config-registration/write", async (route) => {
    writeRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          createdModels: [],
          createdNpcs: [],
          createdTargets: actors.map((actor, index) => ({
            actorRef: actor.actorRef,
            id: 500010 + index,
          })),
          reusedTargets: [],
          openedWorkbooks: [
            "C:\\trunk\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
          ],
        },
      }),
    });
  });

  await page.goto("/");
  await expect(page.locator(".launch-screen")).toHaveCount(0, {
    timeout: 3_000,
  });
  await page.getByRole("button", { name: "注册 NPC" }).click();
  const registration = page.getByRole("region", {
    name: "注册 NPC",
    exact: true,
  });
  await registration.getByRole("button", { name: "读取 UE 选择" }).click();
  const firstNpc = registration.getByLabel("批量守卫 A NPC 复用方式");
  const secondNpc = registration.getByLabel("批量守卫 B NPC 复用方式");
  await secondNpc.selectOption("new");
  await registration
    .getByRole("button", {
      name: "将 批量守卫 A 的 NPC 应用到全部已选 Actor",
    })
    .click();
  await expect(firstNpc).toHaveValue("101968");
  await expect(secondNpc).toHaveValue("101968");
  await expect(
    registration.getByText(/已将 NPC 101968 应用到 2 个已选 Actor/),
  ).toBeVisible();
  const firstMap = registration.getByLabel("批量守卫 A MapID");
  const secondMap = registration.getByLabel("批量守卫 B MapID");
  await firstMap.selectOption("1209");
  await expect(secondMap).toHaveValue("");
  await registration
    .getByRole("button", {
      name: "将 批量守卫 A 的 MapID 应用到全部已选 Actor",
    })
    .click();
  await expect(secondMap).toHaveValue("1209");
  await expect(
    registration.getByText(/已将 MapID 1209 应用到 2 个已选 Actor/),
  ).toBeVisible();
  await registration.screenshot({
    path: testInfo.outputPath("npc-registration-bulk-map.png"),
  });

  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("只向目标物表新增 2 行");
    expect(confirmation.message()).toContain("不打开另外两张表");
    await confirmation.accept();
  });
  await registration.getByRole("button", { name: "写入新增项" }).click();
  await expect(
    registration.getByText(/批量守卫 A → 500010/),
  ).toBeVisible();
  await expect(
    registration.getByText(/批量守卫 B → 500011/),
  ).toBeVisible();
  const actorRows = registration.locator(
    ".npc-registration-write-table tbody tr",
  );
  await expect(
    actorRows.nth(0).getByText("目标物 ID 500010", { exact: true }),
  ).toBeVisible();
  await expect(
    actorRows.nth(1).getByText("目标物 ID 500011", { exact: true }),
  ).toBeVisible();
  await expect(registration.getByText("已写入 500010")).toBeVisible();
  await expect(registration.getByText("已写入 500011")).toBeVisible();
  const copyTargetIds = registration.getByRole("button", {
    name: "复制目标物 ID",
  });
  await expect(copyTargetIds).toBeVisible();
  await copyTargetIds.click();
  await expect(
    registration.getByText(
      "已复制 2 个目标物 ID，可直接粘贴到任务节点",
    ),
  ).toBeVisible();
  await expect(
    registration.getByRole("button", { name: "复制目标物 ID" }),
  ).toHaveText("已复制");
  expect(
    await page.evaluate(() => navigator.clipboard.readText()),
  ).toBe("500010,500011");
  await registration.screenshot({
    path: testInfo.outputPath("npc-registration-copy-target-ids.png"),
  });
  expect(writeRequest).toMatchObject({
    scope: "target_only",
    items: [
      {
        actorRef: "BP_Guard_C_0",
        targetDescription: "批量守卫",
        mapId: "1209",
        existingModelId: 200135,
        existingNpcId: 101968,
        newNpc: null,
      },
      {
        actorRef: "BP_Guard_C_1",
        targetDescription: "批量守卫",
        mapId: "1209",
        existingModelId: 200135,
        existingNpcId: 101968,
        newNpc: null,
      },
    ],
  });
});

test("registers TaskActorBase with model and target tables only", async ({
  page,
}, testInfo) => {
  let writeRequest: {
    scope: string;
    items: Array<Record<string, unknown>>;
  } | null = null;
  const actor = {
    actorRef: "PersistentLevel.BP_TaskProp_C_0",
    label: "任务装置",
    classPath:
      "/Game/Seria/Task/BPtriger/TaskActor/BP_TaskProp.BP_TaskProp_C",
    parentClassPath:
      "/Game/Seria/Task/BPtriger/TaskActor/TaskActorBase.TaskActorBase_C",
    transform: {
      location: { x: 100, y: 200, z: 300 },
      rotation: { pitch: 0, yaw: 45, roll: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
  await page.route("**/api/ue/selection/registration", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          selection: {
            mapAssetPath: "/Game/Test/Maps/TestMap",
            actors: [actor],
          },
          candidates: [
            {
              actor,
              registrationKind: "task_actor",
              modelOptions: [],
              npcOptions: [],
              positionMatches: [],
              targetMatches: [],
              mapOptions: [
                {
                  id: "1204",
                  name: "测试地图",
                  resourceId: "100128",
                  assetPath: "/Game/Test/Maps/TestMap",
                  rowNumber: 3,
                },
              ],
              mapId: "1204",
              mapName: "测试地图",
            },
          ],
        },
      }),
    });
  });
  await page.route("**/api/ue/config-registration/write", async (route) => {
    writeRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          createdModels: [{ actorRef: actor.actorRef, id: 500712 }],
          createdNpcs: [],
          createdTargets: [{ actorRef: actor.actorRef, id: 100999 }],
          reusedTargets: [],
          openedWorkbooks: [
            "C:\\trunk\\doc\\xlsdir\\m模型资源表.xlsm",
            "C:\\trunk\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
          ],
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "注册 NPC" }).click();
  const registration = page.getByRole("region", {
    name: "注册 NPC",
    exact: true,
  });
  await registration.getByRole("button", { name: "读取 UE 选择" }).click();

  await expect(registration.getByText("任务装置")).toBeVisible();
  await expect(registration.getByText("无需 NPC")).toBeVisible();
  await expect(
    registration.getByLabel("任务装置 NPC 复用方式"),
  ).toHaveCount(0);
  await expect(
    registration.getByText(/1 个 TaskActor · 1 个模型待注册 · 0 个 NPC 待新建/),
  ).toBeVisible();
  await registration.screenshot({
    path: testInfo.outputPath("task-actor-registration.png"),
  });

  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("新增 1 个模型、0 个 NPC");
    await confirmation.accept();
  });
  await registration.getByRole("button", { name: "写入新增项" }).click();
  await expect(
    registration.getByText(/模型 1、NPC 0、目标物 1/),
  ).toBeVisible();
  expect(writeRequest).toMatchObject({
    scope: "all",
    items: [
      {
        actorRef: actor.actorRef,
        registrationKind: "task_actor",
        existingModelId: null,
        existingNpcId: null,
        mapId: "1204",
        newNpc: null,
      },
    ],
  });
});

test("locks and registers every existing numeric Blueprint slot", async ({
  page,
}, testInfo) => {
  let registrationRequest: Record<string, unknown> | null = null;
  const inspectionRequests: Array<Record<string, unknown>> = [];
  await page.route(
    "**/api/ue/mission-targets/inspect-blueprint",
    async (route) => {
      const request = route.request().postDataJSON();
      inspectionRequests.push(request);
      const dialogueId = request.dialogueId ?? "735200";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            blueprintState: "populated",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/Test/BP_735200.BP_735200",
            blueprintClassPath:
              "/Game/Seria/Task/Mod/Test/BP_735200.BP_735200_C",
            parentClassPath:
              "/Game/Seria/Task/Mod/PositionMode/PositionModeBase.PositionModeBase_C",
            dialogueId,
            dialogueAssetPath:
              `/Game/Seria/Task/dialoggraph/Test/${dialogueId}.${dialogueId}`,
            formationClassPath: null,
            slots: [
              {
                modelIndex: 0,
                targetId: null,
                modelClassPath:
                  "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
                existingModelName: "player",
                suggestedModelName: "player",
                candidateModelNames: ["player"],
                status: "registered",
              },
              {
                modelIndex: 1,
                targetId: null,
                modelClassPath: "/Game/Test/BP_One.BP_One_C",
                existingModelName: "One",
                suggestedModelName: "One",
                candidateModelNames: ["One"],
                status: "registered",
              },
              {
                modelIndex: 2,
                targetId: null,
                modelClassPath: "/Game/Test/BP_Two.BP_Two_C",
                existingModelName: "None",
                suggestedModelName: "Two",
                candidateModelNames: ["Two"],
                status: "available",
              },
              {
                modelIndex: 3,
                targetId: null,
                modelClassPath: "/Game/Test/BP_Three.BP_Three_C",
                existingModelName: "None",
                suggestedModelName: null,
                candidateModelNames: [],
                status: "unmapped",
              },
            ],
            message:
              "BP 已识别 4 个角色位（含 0 号玩家）；对话已注册 2 个角色；Formation 未指向当前 BP",
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/register-dialogue",
    async (route) => {
      registrationRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            status: "registered",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/Test/BP_735200.BP_735200",
            dialogueId: registrationRequest?.dialogueId ?? "735200",
            dialogueAssetPath:
              `/Game/Seria/Task/dialoggraph/Test/${registrationRequest?.dialogueId ?? "735200"}.${registrationRequest?.dialogueId ?? "735200"}`,
            dialogueModels: ["player", "One", "Two", "None"],
            registeredCount: 2,
            characterCount: 3,
            emptyCount: 1,
            unresolvedIndexes: [3],
            spatialStatus: "unchanged",
            spatialMapAssetPath: "/Game/Test/Maps/TestMap.TestMap",
          },
        }),
      });
    },
  );

  await page.goto("/");
  await page.getByRole("button", { name: "任务目标物" }).click();
  const workspace = page.getByRole("region", {
    name: "任务目标物",
    exact: true,
  });
  await workspace.getByLabel("BP 文件名").fill("7352");
  await expect(
    workspace.getByLabel("对话节点 ID（可选）"),
  ).toHaveCount(0);
  const dialogueIdToggle = workspace.getByRole("button", {
    name: "展开对话节点 ID",
  });
  await expect(dialogueIdToggle).toHaveText("");
  expect((await dialogueIdToggle.boundingBox())?.width).toBeLessThanOrEqual(36);
  await dialogueIdToggle.click();
  const dialogueIdInput = workspace.getByLabel("对话节点 ID（可选）");
  expect((await dialogueIdInput.boundingBox())?.width).toBeLessThanOrEqual(160);
  await dialogueIdInput.fill("846500");
  const collapseDialogueId = workspace.getByRole("button", {
    name: "收起对话节点 ID",
  });
  await expect(collapseDialogueId).toHaveText("");
  await collapseDialogueId.click();
  await expect(dialogueIdInput).toHaveCount(0);
  await expect(
    workspace.getByRole("button", {
      name: "展开对话节点 ID，当前 846500",
    }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "检查 BP 与对话模型" })
    .click();

  await expect(
    workspace.getByText("BP 已有内容", { exact: true }),
  ).toBeVisible();
  await expect(workspace.getByText("846500", { exact: true })).toBeVisible();
  expect(inspectionRequests[0]).toMatchObject({
    blueprintName: "7352",
    dialogueId: "846500",
  });
  await workspace
    .getByRole("button", { name: "收起 BP 已有内容" })
    .click();
  await expect(
    workspace.locator(".mission-target-dialogue-table tbody tr"),
  ).toHaveCount(0);
  await workspace
    .getByRole("button", { name: "展开 BP 已有内容" })
    .click();
  await expect(
    workspace.locator(".mission-target-dialogue-table tbody tr"),
  ).toHaveCount(4);
  await expect(workspace.getByLabel("BP 已有槽位 0 固定保留")).toBeChecked();
  await expect(workspace.getByLabel("BP 已有槽位 0 固定保留")).toBeDisabled();
  await expect(workspace.getByLabel("BP 已有槽位 2 固定保留")).toBeChecked();
  await expect(workspace.getByLabel("BP 已有槽位 2 固定保留")).toBeDisabled();
  await expect(workspace.getByText(/BP 已有 4 个固定角色位/)).toBeVisible();
  await workspace.screenshot({
    path: testInfo.outputPath("existing-blueprint-slot-registration.png"),
  });
  await workspace
    .getByRole("button", { name: "按 BP 注册到对话" })
    .click();

  expect(registrationRequest).toEqual({
    blueprintName: "7352",
    dialogueId: "846500",
    selectedModelIndexes: [1, 2, 3],
    targetOverrides: [],
  });
  await expect(
    workspace.getByText(/角色 3 个（含 0 号玩家）/),
  ).toBeVisible();
});

test("separates four-digit registration from six-digit node positioning", async ({
  page,
}, testInfo) => {
  let inspectionRequests = 0;
  let mapStatusRequests = 0;
  let loadedRequest: Record<string, any> | null = null;
  const dialoguePreviewPlan = {
    taskId: "735200",
    taskName: "BP_735200 对话模型",
    taskSource: "任务表",
    mapId: "735200",
    mapName: "当前 UE 关卡",
    mapAssetPath: "/Game/CurrentLevel",
    targets: [
      {
        targetId: "0",
        type: 1,
        description: "BP 槽位 0",
        npcId: null,
        npcName: "player",
        modelId: null,
        modelClassPath:
          "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
        itemId: null,
        blueprintModelId: 0,
        mapId: "735200",
        previewKind: "asset",
        transform: {
          location: { x: 100, y: 200, z: 300 },
          rotation: { pitch: 0, yaw: 90, roll: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      {
        targetId: "1",
        type: 1,
        description: "BP 槽位 1",
        npcId: null,
        npcName: "Guard",
        modelId: null,
        modelClassPath: "/Game/Test/BP_Guard.BP_Guard_C",
        itemId: null,
        blueprintModelId: 1,
        mapId: "735200",
        previewKind: "asset",
        transform: {
          location: { x: 350, y: 450, z: 300 },
          rotation: { pitch: 0, yaw: 105, roll: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        dialogueAdjustment: {
          initialTransform: {
            location: { x: 100, y: 300, z: 300 },
            rotation: { pitch: 0, yaw: 105, roll: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          movementActionCount: 1,
          rotationActionCount: 0,
          positionDelta: 291.548,
          rotationDelta: 0,
          lastAdjustedDialogueId: "735201",
        },
      },
      ...Array.from({ length: 8 }, (_, offset) => {
        const modelIndex = offset + 2;
        return {
          targetId: String(modelIndex),
          type: 1,
          description: `BP 槽位 ${modelIndex}`,
          npcId: null,
          npcName: `Background ${modelIndex}`,
          modelId: null,
          modelClassPath: `/Game/Test/BP_Background_${modelIndex}.BP_Background_${modelIndex}_C`,
          itemId: null,
          blueprintModelId: modelIndex,
          mapId: "735200",
          previewKind: "asset",
          transform: {
            location: {
              x: 100 + modelIndex * 40,
              y: 200 + modelIndex * 30,
              z: 300,
            },
            rotation: { pitch: 0, yaw: 90, roll: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          dialogueAdjustment: {
            initialTransform: {
              location: {
                x: 100 + modelIndex * 40,
                y: 200 + modelIndex * 30,
                z: 300,
              },
              rotation: { pitch: 0, yaw: 90, roll: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
            movementActionCount: 0,
            rotationActionCount: 0,
            positionDelta: 0,
            rotationDelta: 0,
            lastAdjustedDialogueId: null,
          },
        };
      }),
    ],
    warnings: [],
    dialogueTimeline: {
      nodeCount: 2,
      finalDialogueId: "735201",
      adjustedCharacterCount: 1,
      movementActionCount: 1,
      rotationActionCount: 0,
    },
  };

  await page.route("**/api/ue/formation/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { status: "not_found", message: "未找到测试 BP" },
      }),
    });
  });
  await page.route(
    "**/api/ue/mission-targets/inspect-blueprint",
    async (route) => {
      inspectionRequests += 1;
      const request = route.request().postDataJSON();
      if (request.dialogueId) {
        expect(request).toMatchObject({
          blueprintName: "7352",
          dialogueId: "735200",
          dialogueTimeline: [
            { id: "735200" },
            {
              id: "735201",
              characterBehaviourString: expect.stringContaining("AM_Walk"),
            },
          ],
        });
      } else {
        expect(request.blueprintName).toBe("7352");
        expect(request.dialogueTimeline).toBeUndefined();
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            blueprintState: "populated",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/Test/BP_735200.BP_735200",
            blueprintClassPath:
              "/Game/Seria/Task/Mod/Test/BP_735200.BP_735200_C",
            parentClassPath:
              "/Game/Seria/Task/Mod/PositionMode/PositionModeBase.PositionModeBase_C",
            dialogueId: "735200",
            dialogueAssetPath:
              "/Game/Seria/Task/dialoggraph/Test/735200.735200",
            formationClassPath:
              "/Game/Seria/Task/Mod/Test/BP_735200.BP_735200_C",
            slots: dialoguePreviewPlan.targets.map((target) => ({
              modelIndex: target.blueprintModelId,
              targetId: null,
              modelClassPath: target.modelClassPath,
              existingModelName: target.npcName,
              suggestedModelName: target.npcName,
              candidateModelNames: [target.npcName],
              status: "registered",
            })),
            dialoguePreviewPlan: request.dialogueTimeline
              ? dialoguePreviewPlan
              : undefined,
            dialoguePreviewBlockedReasons: [],
            message: request.dialogueTimeline
              ? "已按对话坐标解析 2 个模型"
              : "BP 已识别 2 个角色位（含 0 号玩家）",
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/map-status",
    async (route) => {
      mapStatusRequests += 1;
      const request = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            currentMapAssetPath: "/Game/Test/Maps/OpenMap",
            expectedMapAssetPath: request.mapAssetPath,
            matches: true,
          },
        }),
      });
    },
  );
  await page.route("**/api/ue/mission-targets/load", async (route) => {
    loadedRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          status: "loaded",
          taskId: "735200",
          mapId: "735200",
          mapAssetPath: "/Game/Test/Maps/OpenMap",
          autoOpenedMap: false,
          spawnedCount: dialoguePreviewPlan.targets.length,
          assetCount: dialoguePreviewPlan.targets.length,
          markerCount: 0,
          selectedActorCount: 1,
        },
      }),
    });
  });

  await page.goto("/");
  const fixtureDirectory = await writeDirectoryFixture(
    testInfo.outputPath("dialogue-position-csvdir"),
    [
      {
        name: "对话表.csv",
        content: [
          "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End,Dialog.CharacterBehaviourString,Dialog.RelativeTransformsString",
          "##对话ID,人物,内容,下一ID,结束,动作,相对位置",
          "735200,,,735201,false,,",
          '735201,1,开始移动,735299,false,";0.000000,AM_Walk,2,100,0,100,200,100,100,0","0|1,0,0,0,0,0,0;1|1,0,0,0,0,0,0"',
          '735299,101968,最终位置,,true,";0.000000,AM_TurnRight45,1,0,0,0,0,0,0,0","0|1,0,0,0,0,0,0;1|0,0,45,0,200,100,100"',
        ].join("\n"),
      },
      {
        name: "对话表_开始节点.csv",
        content: [
          "##&DialogStart.id,DialogStart.Outline",
          "##对话ID,剧情梗概",
          "735200,最终站位测试",
        ].join("\n"),
      },
      {
        name: "NPC表.csv",
        content: [
          "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
          "##id,名称,介绍,资源",
          "1,玩家,玩家,",
          "101968,守卫,守卫,200135",
        ].join("\n"),
      },
      {
        name: "m模型资源表.csv",
        content: [
          "##&Model.id,,Model.path",
          "##id,配置路径,生成路径",
          "200135,/Game/Test/BP_Guard,/Game/Test/BP_Guard.BP_Guard_C",
        ].join("\n"),
      },
    ],
  );
  await page.locator('input[type="file"]').setInputFiles(fixtureDirectory);
  await page.getByRole("button", { name: "任务目标物" }).click();
  const workspace = page.getByRole("region", {
    name: "任务目标物",
    exact: true,
  });
  await workspace.getByLabel("BP 文件名").fill("7352");
  await expect(
    workspace.getByRole("button", { name: /加载|计算.*站位/ }),
  ).toHaveCount(0);
  await workspace
    .getByRole("button", { name: "检查 BP 与对话模型" })
    .click();
  await expect(
    workspace.getByRole("button", { name: "按 BP 注册到对话" }),
  ).toBeEnabled();
  expect(inspectionRequests).toBe(1);
  expect(loadedRequest).toBeNull();

  await workspace.getByLabel("BP 文件名").fill("735201");
  await expect(
    workspace.getByText(
      "六位对话节点 ID 请填写到 BP 右侧的展开输入框",
    ),
  ).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "检查 BP 与对话模型" }),
  ).toBeDisabled();

  await workspace.getByLabel("BP 文件名").fill("7352");
  await workspace.getByRole("button", {
    name: "展开对话节点 ID",
  }).click();
  await workspace.getByLabel("对话节点 ID（可选）").fill("735201");
  await workspace.getByRole("button", { name: "计算节点站位" }).click();
  const dialoguePreview = workspace.getByRole("region", {
    name: "对话节点站位俯视图",
  });
  await expect(dialoguePreview).toContainText("节点 735201 · 2 个节点");
  await expect(dialoguePreview).toContainText(
    "1 位变化 · 1 次走位 · 0 次旋转",
  );
  await expect(
    dialoguePreview.locator('[data-target-id="1"]'),
  ).toHaveAttribute("data-position-delta", "291.548");
  const positionMap = dialoguePreview.locator(
    ".mission-target-dialogue-preview__map",
  );
  const positionList = dialoguePreview.locator(
    ".mission-target-dialogue-preview__list",
  );
  await expect
    .poll(() =>
      positionList.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  const mapBoundsBefore = await positionMap.boundingBox();
  await positionList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => positionList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const mapBoundsAfter = await positionMap.boundingBox();
  expect(mapBoundsAfter?.y).toBe(mapBoundsBefore?.y);
  expect(mapBoundsAfter?.height).toBe(mapBoundsBefore?.height);
  await dialoguePreview.screenshot({
    path: testInfo.outputPath("dialogue-node-position-preview.png"),
  });
  await expect(
    workspace.getByRole("button", { name: "按 BP 注册到对话" }),
  ).toHaveCount(0);
  expect(loadedRequest).toBeNull();
  await workspace.getByRole("button", { name: "写入到 UE" }).click();
  await expect(
    workspace.getByText(
      `已加载到当前 UE 关卡，加载 ${dialoguePreviewPlan.targets.length} 个资产和 0 个定位标记`,
    ),
  ).toBeVisible();
  await expect(workspace.getByText(/已选中 1 个变更角色供 NPC 注册/))
    .toBeVisible();
  expect(inspectionRequests).toBe(2);
  expect(loadedRequest).toMatchObject({
    plan: dialoguePreviewPlan,
    mapMode: "current",
  });
  expect(mapStatusRequests).toBe(0);
});

test("offers bidirectional position sync for a registered Blueprint", async ({
  page,
}, testInfo) => {
  let updateBlueprintRequest: Record<string, unknown> | null = null;
  let updateTargetsRequest: Record<string, unknown> | null = null;
  let appendBlueprintRequest: Record<string, unknown> | null = null;
  let backgroundApplyRequest: Record<string, unknown> | null = null;
  let backgroundDialogueRequest: Record<string, unknown> | null = null;
  const backgroundInspectRequests: Record<string, unknown>[] = [];
  let backgroundInspectCount = 0;
  let refreshedTaskRequests = 0;
  await page.route(
    "**/api/ue/mission-targets/resolve",
    async (route) => {
      refreshedTaskRequests += 1;
      const request = route.request().postDataJSON();
      expect(request.taskId).toBe("900001");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            taskId: "900001",
            taskName: "同步任务",
            taskSource: "任务表",
            mapId: "1204",
            mapName: "测试地图",
            mapAssetPath: "/Game/Test/Maps/TestMap",
            targets: [
              {
                targetId: "500001",
                type: 1,
                description: "守卫",
                npcId: 700001,
                npcName: "守卫",
                modelId: 200777,
                modelClassPath:
                  "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
                itemId: 0,
                blueprintModelId: null,
                mapId: "1204",
                previewKind: "asset",
                transform: {
                  location: { x: 110, y: 220, z: 330 },
                  rotation: { pitch: 0, yaw: 90, roll: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                },
              },
              {
                targetId: "500002",
                type: 1,
                description: "新增角色",
                npcId: 700002,
                npcName: "新增角色",
                modelId: 200778,
                modelClassPath:
                  "/Game/Seria/NPC/Added/BP_Added.BP_Added_C",
                itemId: 0,
                blueprintModelId: null,
                mapId: "1204",
                previewKind: "asset",
                transform: {
                  location: { x: 150, y: 260, z: 350 },
                  rotation: { pitch: 0, yaw: 45, roll: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                },
              },
            ],
            warnings: [],
          },
        }),
      });
    },
  );
  await page.route("**/api/ue/formation/read", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { status: "not_found", message: "未找到测试 BP" },
      }),
    });
  });
  await page.route(
    "**/api/ue/mission-targets/inspect-blueprint",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            blueprintState: "populated",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/Test/BP_735000.BP_735000",
            blueprintClassPath:
              "/Game/Seria/Task/Mod/Test/BP_735000.BP_735000_C",
            parentClassPath:
              "/Game/Seria/Task/Mod/PositionMode/PositionModeBase.PositionModeBase_C",
            dialogueId: "735000",
            dialogueAssetPath:
              "/Game/Seria/Task/dialoggraph/Test/735000.735000",
            formationClassPath:
              "/Game/Seria/Task/Mod/Test/BP_735000.BP_735000_C",
            slots: [
              {
                modelIndex: 0,
                targetId: null,
                modelClassPath:
                  "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
                existingModelName: "player",
                existingModelClassPath:
                  "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C",
                registrationMatchesModel: true,
                suggestedModelName: "player",
                candidateModelNames: ["player"],
                status: "registered",
              },
              {
                modelIndex: 1,
                targetId: "500001",
                modelClassPath:
                  "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
                existingModelName: "Guard",
                existingModelClassPath:
                  "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
                registrationMatchesModel: true,
                suggestedModelName: "Guard",
                candidateModelNames: ["Guard"],
                status: "registered",
              },
            ],
            appendSlots: [
              {
                modelIndex: 2,
                targetId: "500002",
                modelClassPath:
                  "/Game/Seria/NPC/Added/BP_Added.BP_Added_C",
                existingModelName: "None",
                existingModelClassPath: null,
                registrationMatchesModel: false,
                suggestedModelName: "Added",
                candidateModelNames: ["Added"],
                status: "available",
              },
            ],
            message:
              "BP 已有 1 个模型槽；对话已注册 1 个模型；匹配 1 个任务目标物",
            sync: {
              sourceName: "D:\\TeamProject\\doc\\csvdir",
              rootTransform: {
                location: { x: 100, y: 200, z: 200 },
                rotation: { pitch: 0, yaw: 0, roll: 0 },
              },
              hasExplicitRoot: true,
              mappings: [
                {
                  modelIndex: 1,
                  targetId: "500001",
                  modelClassPath:
                    "/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
                  currentBlueprintTransform: {
                    location: { x: 0, y: 0, z: 100 },
                    rotation: { pitch: 0, yaw: 0, roll: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                  },
                  desiredBlueprintTransform: {
                    location: { x: 10, y: 20, z: 130 },
                    rotation: { pitch: 0, yaw: 90, roll: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                  },
                  currentTargetTransform: {
                    location: { x: 110, y: 220, z: 330 },
                    rotation: { pitch: 0, yaw: 90, roll: 0 },
                  },
                  blueprintWorldTransform: {
                    location: { x: 100, y: 200, z: 300 },
                    rotation: { pitch: 0, yaw: 0, roll: 0 },
                  },
                  positionDelta: 37.416574,
                  rotationDelta: 90,
                },
              ],
              unmatchedTargetIds: ["500002"],
              unmatchedModelIndexes: [],
              canUpdateBlueprint: true,
              canUpdateTargets: true,
              blockedReasons: [],
            },
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/update-blueprint",
    async (route) => {
      updateBlueprintRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            status: "updated",
            taskId: "900001",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/Test/BP_735000.BP_735000",
            dialogueAssetPath:
              "/Game/Seria/Task/dialoggraph/Test/735000.735000",
            updatedModelIndexes: [1],
            blueprintSaved: true,
            dialogueSaved: true,
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/append-blueprint",
    async (route) => {
      appendBlueprintRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            status: "appended",
            taskId: "900001",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/Test/BP_735000.BP_735000",
            addedTargetIds: ["500002"],
            addedModelIndexes: [2],
            componentNames: ["2"],
            dialogueRegistration: {
              status: "registered",
              blueprintAssetPath:
                "/Game/Seria/Task/Mod/Test/BP_735000.BP_735000",
              dialogueId: "735000",
              dialogueAssetPath:
                "/Game/Seria/Task/dialoggraph/Test/735000.735000",
              dialogueModels: ["player", "Guard", "Added"],
              registeredCount: 2,
              characterCount: 3,
              emptyCount: 0,
              unresolvedIndexes: [],
              spatialStatus: "unchanged",
            },
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/update-from-blueprint",
    async (route) => {
      updateTargetsRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            taskId: "900001",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/Test/BP_735000.BP_735000",
            items: [
              {
                targetId: "500001",
                mapId: "1204",
                originalTransform: {
                  location: { x: 110, y: 220, z: 330 },
                  rotation: { pitch: 0, yaw: 90, roll: 0 },
                },
                transform: {
                  location: { x: 100, y: 200, z: 300 },
                  rotation: { pitch: 0, yaw: 0, roll: 0 },
                },
              },
            ],
            updatedTargets: [{ targetId: "500001", rowNumber: 3 }],
            unchangedTargetIds: [],
            openedWorkbooks: [
              "C:\\trunk\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
            ],
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/selection/read",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            mapAssetPath: "/Game/Test/Maps/TestMap",
            actors: [
              {
                actorRef:
                  "PersistentLevel.ShotSandboxMissionTargetPreview_900001_500002",
                label:
                  "ShotSandboxMissionTargetPreview_900001_500002",
                classPath:
                  "/Game/Seria/NPC/Added/BP_Added.BP_Added_C",
                assetKind: "blueprint_actor",
                assetPath:
                  "/Game/Seria/NPC/Added/BP_Added.BP_Added",
                transform: {
                  location: { x: 150, y: 260, z: 350 },
                  rotation: { pitch: 0, yaw: 45, roll: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                },
              },
              {
                actorRef: "PersistentLevel.SkeletalMeshActor_1",
                label: "场景旗帜",
                classPath: "/Script/Engine.SkeletalMeshActor",
                assetKind: "skeletal_mesh",
                assetPath: "/Game/Test/Props/SK_Banner.SK_Banner",
                transform: {
                  location: { x: 130, y: 260, z: 340 },
                  rotation: { pitch: 0, yaw: 45, roll: 0 },
                  scale: { x: 1.5, y: 0.75, z: 2 },
                },
              },
            ],
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/background-props/inspect",
    async (route) => {
      backgroundInspectCount += 1;
      backgroundInspectRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            reviewToken: "a".repeat(64),
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/Test/BP_735000.BP_735000",
            mapAssetPath: "/Game/Test/Maps/TestMap",
            rootTransform: {
              location: { x: 100, y: 200, z: 200 },
              rotation: { pitch: 0, yaw: 0, roll: 0 },
            },
            items: [
              {
                actorRef: "PersistentLevel.SkeletalMeshActor_1",
                actorLabel: "场景旗帜",
                assetKind: "skeletal_mesh",
                assetPath:
                  "/Game/Test/Props/SK_Banner.SK_Banner",
                componentName: "SK_Banner",
                componentClass:
                  "/Script/Engine.SkeletalMeshComponent",
                assetPropertyName: "SkeletalMesh",
                worldTransform: {
                  location: { x: 130, y: 260, z: 340 },
                  rotation: { pitch: 0, yaw: 45, roll: 0 },
                  scale: { x: 1.5, y: 0.75, z: 2 },
                },
                relativeTransform: {
                  location: { x: 30, y: 60, z: 140 },
                  rotation: { pitch: 0, yaw: 45, roll: 0 },
                  scale: { x: 1.5, y: 0.75, z: 2 },
                },
                action: "create",
                message: "新增背景组件",
              },
            ],
            blockedReasons:
              backgroundInspectCount === 1
                ? [
                    "对话 Formation 尚未指向当前 BP",
                    "对话尚未配置 Preview Level",
                  ]
                : [],
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/register-dialogue",
    async (route) => {
      backgroundDialogueRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            status: "registered",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/Test/BP_735000.BP_735000",
            dialogueId: "735000",
            dialogueAssetPath:
              "/Game/Seria/Task/dialoggraph/Test/735000.735000",
            dialogueModels: ["player", "Guard"],
            registeredCount: 1,
            emptyCount: 0,
            unresolvedIndexes: [],
            spatialStatus: "configured",
            spatialSource: "selected_actor",
            spatialMapAssetPath: "/Game/Test/Maps/TestMap.TestMap",
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/mission-targets/background-props/apply",
    async (route) => {
      backgroundApplyRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            status: "updated",
            blueprintAssetPath:
              "/Game/Seria/Task/Mod/Test/BP_735000.BP_735000",
            createdComponentNames: ["SK_Banner"],
            updatedComponentNames: [],
            saved: true,
          },
        }),
      });
    },
  );
  const fixtureDirectory = await writeDirectoryFixture(
    testInfo.outputPath("blueprint-sync", "csvdir"),
    [
      {
        name: "对话表.csv",
        content: [
          "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
          "##对话ID,人物,内容,下一ID,结束",
          "735000,,,735001,false",
          "735001,1,测试。,,true",
        ].join("\n"),
      },
      {
        name: "对话表_开始节点.csv",
        content: [
          "##&DialogStart.id,DialogStart.Outline",
          "##对话ID,剧情梗概",
          "735000,BP 双向同步",
        ].join("\n"),
      },
      {
        name: "NPC表.csv",
        content: [
          "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
          "##id,名称,介绍,资源",
          "1,玩家,玩家,",
          "700001,守卫,测试,200777",
          "700002,新增角色,测试,200778",
        ].join("\n"),
      },
      {
        name: "m模型资源表.csv",
        content: [
          "##&Model.id,,Model.path",
          "##id,配置路径,生成路径",
          "200777,/Game/Test/BP_Guard,/Game/Seria/NPC/Guard/BP_Guard.BP_Guard_C",
          "200778,/Game/Test/BP_Added,/Game/Seria/NPC/Added/BP_Added.BP_Added_C",
        ].join("\n"),
      },
      {
        name: "任务表.csv",
        content: [
          "##&字段标记,Mission.id,Mission.Name,Mission.ShowNPC",
          "##任务类型,任务ID,任务名称,显示目标物",
          ',900001,同步任务,"500001,500002"',
        ].join("\n"),
      },
      {
        name: "m目标物表.csv",
        content: [
          "##&MissionPosition.ID,,,MissionPosition.type,MissionPosition.NPCID,MissionPosition.ItemID,MissionPosition.BluePrint,MissionPosition.MapID,MissionPosition.Position,MissionPosition.Rotation",
          "##ID,类型,描述,坐标类型,NPCID,物品ID,蓝图路径,地图ID,座标,旋转",
          '500001,剧情 NPC,守卫,1,700001,0,,1204,"(X=110,Y=220,Z=330)","(Pitch=0,Yaw=90,Roll=0)"',
          '500002,剧情 NPC,新增角色,1,700002,0,,1204,"(X=150,Y=260,Z=350)","(Pitch=0,Yaw=45,Roll=0)"',
        ].join("\n"),
      },
      {
        name: "d地图配置表.csv",
        content: [
          "##&MapConfig.id,MapConfig.name,,,MapConfig.resourceid",
          "##ID,地图名称,地图备注,地图资源（注释用）,资源ID",
          "1204,测试地图,,,100128",
        ].join("\n"),
      },
      {
        name: "d地图资源表.csv",
        content: [
          "##&Scene.id,Scene.path",
          "##id,path",
          "100128,/Game/Test/Maps/TestMap",
        ].join("\n"),
      },
    ],
  );

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(fixtureDirectory);
  await page.getByRole("button", { name: "任务目标物" }).click();
  const dialog = page.getByRole("region", {
    name: "任务目标物",
    exact: true,
  });
  await dialog.getByLabel("BP 文件名").fill("BP_735000");
  await dialog.getByLabel("任务节点 ID").fill("900001");
  await dialog.getByRole("button", { name: "解析任务目标物" }).click();

  await expect(
    dialog.getByRole("button", { name: "目标物 → BP" }),
  ).toBeEnabled();
  expect(refreshedTaskRequests).toBe(0);
  await dialog.getByRole("button", { name: "解析任务目标物" }).click();
  await expect.poll(() => refreshedTaskRequests).toBe(1);
  const reverseButton = dialog.getByRole("button", {
    name: "BP → 目标物",
  });
  await expect(reverseButton).toBeEnabled();
  await expect(
    dialog.getByText(/BP 已有 2 个固定角色位；待追加 0 \/ 1 个目标物/),
  ).toBeVisible();
  await expect(dialog.getByText("BP 已有内容", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "展开 BP 已有内容" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "展开 BP 已有内容" })
    .click();
  const existingRows = dialog.locator(
    ".mission-target-dialogue-table tbody .mission-target-row--existing",
  );
  await expect(existingRows).toHaveCount(2);
  await expect(dialog.getByLabel("BP 已有槽位 1 固定保留")).toBeDisabled();
  await expect(dialog.getByLabel("选择目标物 500002")).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "按 BP 注册到对话" }),
  ).toBeEnabled();

  await dialog.getByLabel("选择目标物 500002").check();
  await expect(
    dialog.getByRole("button", { name: "添加到 BP 并注册" }),
  ).toBeEnabled();
  await expect(dialog.getByText("BP 2 · Added")).toBeVisible();
  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("2 = 新增角色");
    await confirmation.accept();
  });
  await dialog
    .getByRole("button", { name: "添加到 BP 并注册" })
    .click();
  expect(appendBlueprintRequest).toMatchObject({
    blueprintName: "BP_735000",
    selectedTargetIds: ["500002"],
  });
  await expect(dialog.getByText(/已追加 BP 槽位 2/)).toBeVisible();

  await dialog.getByRole("button", { name: "读取 UE 选择" }).click();
  const backgroundDialog = dialog.getByRole("dialog", {
    name: "UE 选择写入 BP",
  });
  await expect(dialog.getByLabel("选择目标物 500002")).toBeChecked();
  await expect(
    backgroundDialog.getByText(/已识别任务目标物\s+500002/),
  ).toBeVisible();
  await expect(backgroundDialog.getByText("场景旗帜")).toBeVisible();
  await expect(backgroundDialog.getByText(/ShotSandboxMissionTargetPreview/)).toHaveCount(0);
  await expect(backgroundDialog.getByText("Skeletal Mesh")).toBeVisible();
  await expect(
    backgroundDialog.getByText("SK_Banner", { exact: true }),
  ).toBeVisible();
  await expect(backgroundDialog.getByText("1.50, 0.75, 2.00")).toBeVisible();
  await expect(
    backgroundDialog.getByText(/Formation 尚未指向当前 BP/),
  ).toBeVisible();
  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("现有 DialogModels 保持不变");
    await confirmation.accept();
  });
  await backgroundDialog
    .getByRole("button", { name: "补齐对话配置" })
    .click();
  await expect(
    backgroundDialog.getByRole("button", {
      name: "写入 BP",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(dialog.getByLabel("选择目标物 500002")).toBeChecked();
  expect(backgroundDialogueRequest).toEqual({
    blueprintName: "BP_735000",
    selectedModelIndexes: [],
    taskId: "900001",
    targetOverrides: [],
    preserveModels: true,
  });
  expect(backgroundInspectRequests).toEqual([
    {
      blueprintName: "BP_735000",
      actorRefs: ["PersistentLevel.SkeletalMeshActor_1"],
      taskId: "900001",
    },
    {
      blueprintName: "BP_735000",
      actorRefs: ["PersistentLevel.SkeletalMeshActor_1"],
      taskId: "900001",
    },
  ]);
  await backgroundDialog.screenshot({
    path: testInfo.outputPath("background-prop-import.png"),
  });
  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("不会写入 NPC 表或目标物表");
    await confirmation.accept();
  });
  await backgroundDialog
    .getByRole("button", { name: "写入 BP", exact: true })
    .click();
  await expect(dialog.getByText(/已直接写入 BP：新增 1 个/)).toBeVisible();
  expect(backgroundApplyRequest).toEqual({
    blueprintName: "BP_735000",
    reviewToken: "a".repeat(64),
    selectedActorRefs: ["PersistentLevel.SkeletalMeshActor_1"],
    reviewedActorRefs: ["PersistentLevel.SkeletalMeshActor_1"],
    taskId: "900001",
  });

  await dialog.screenshot({
    path: testInfo.outputPath("blueprint-bidirectional-sync.png"),
  });

  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("最新配置");
    await confirmation.accept();
  });
  await dialog.getByRole("button", { name: "目标物 → BP" }).click();
  await expect(dialog.getByText(/已更新 BP 槽位 1/)).toBeVisible();
  expect(updateBlueprintRequest).toEqual({
    blueprintName: "BP_735000",
    taskId: "900001",
    selectedTargetIds: ["500001"],
    targetOverrides: [],
  });

  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toContain("写入目标物表");
    await confirmation.accept();
  });
  await reverseButton.click();
  await expect(
    dialog.getByText(/已将 BP 位置写入 1 个目标物/),
  ).toBeVisible();
  expect(updateTargetsRequest).toEqual({
    blueprintName: "BP_735000",
    taskId: "900001",
    selectedTargetIds: ["500001"],
    targetOverrides: [],
  });
});
