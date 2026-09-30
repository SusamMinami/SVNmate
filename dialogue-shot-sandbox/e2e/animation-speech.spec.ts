import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { SequenceSnapshot } from "../src/animationVoice";
import { setReducedMotion } from "./motionPreference";

const assetPath = "/Game/Seria/Sequences/LS_Voice.LS_Voice";
const sample: SequenceSnapshot = {
  assetPath, name: "LS_Voice", revision: "r1", stateRevision: "s1", dirty: false,
  start: 0, end: 35, displayRate: 30, tickResolution: 24000, director: { path: "", parent: "" },
  tracks: [
    { path: "track", name: "Dialogue", className: "MovieSceneDialogueTrack", binding: "", sections: [
      { path: "subtitle", className: "MovieSceneDialogueSection", start: 1, end: 2, active: true, dialogueId: 123 },
    ] },
    { path: "audio", name: "Audio", className: "MovieSceneAkAudioEventTrack", binding: "", sections: [
      { path: "voiceSection", className: "MovieSceneAkAudioEventSection", start: 0, end: 35, active: true, audioEvent: "A_Voice_LS_MechanicalCemetery_ShowOff" },
    ] },
  ],
  voices: [{ id: 123, name: "看守反派", text: "目标锁定", delayMs: 0 }],
  marks: [], events: [], warnings: [], skipBlockedReasons: ["缺少 Director Blueprint，请在 UE 创建并配置跳过端点"],
};
const wav = () => {
  const data = Buffer.alloc(44 + 16000 * 2 * 10);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
};

async function setup(page: Page, options: { multi?: boolean; waiting?: boolean; multipleLines?: boolean } = {}) {
  let mode = "align", jobPolls = 0, starts = 0;
  let submitted: Record<string, unknown> = {};
  const current = structuredClone(sample);
  if (options.multipleLines) {
    current.tracks[0].sections.push({ path: "subtitle2", className: "MovieSceneDialogueSection", start: 2, end: 3, active: true, dialogueId: 124 });
    current.voices.push({ id: 124, name: "看守反派", text: "你们去吧", delayMs: 0 });
  }
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { ok: false } }));
  await page.route("**/api/ue/animation-voice/*", async (route) => {
    const action = route.request().url().split("/").at(-1)!;
    if (action.startsWith("audio-file")) {
      await route.fulfill({ contentType: "audio/wav", body: wav() }); return;
    }
    const body = route.request().postDataJSON();
    let data: unknown;
    if (action === "cache") data = { root: "/Game/Seria/Sequences", catalog: [], catalogCachedAt: null, snapshots: {} };
    else if (action === "catalog") data = [{ path: assetPath, name: sample.name }];
    else if (action === "scan") data = current;
    else if (action === "speech-status") data = { ready: true, reason: "Qwen3 ASR / ForcedAligner · 本地离线", root: "runtime", busy: false };
    else if (action === "speech-media") data = [
      { id: "1", name: "Voice_CN_1.wav", eventName: "A_Voice_Test", language: "CN" },
      ...(options.multi ? [{ id: "2", name: "Voice_CN_2.wav", eventName: "A_Voice_Test", language: "CN" }] : []),
    ];
    else if (action === "speech-audio") data = {
      token: "9a00eb34-5c0b-4b16-8b0e-68a8dca06c3b", url: "/api/ue/animation-voice/audio-file?token=test",
      duration: 10, eventName: "A_Voice_Test", mediaId: body.mediaId, assetPath, revision: "r1", sectionPath: "voiceSection", sectionStart: 0,
    };
    else if (action === "speech-start") {
      starts++; mode = body.mode; submitted = body;
      data = { id: `job-${starts}`, state: "running", stage: "加载本地模型" };
    } else if (action === "speech-job") {
      jobPolls++;
      data = options.waiting ? { id: `job-${starts}`, state: "running", stage: "对齐台词与音频时间" } : {
        id: `job-${starts}`, state: "complete", stage: "完成，显存已释放", result: {
          mode, device: "cuda:0", model: "Qwen3-ForcedAligner-0.6B", elapsed: 12.8,
          warnings: ["对齐结果仅提供时间建议，不含可信度评分，也不校验音频内容是否与台词一致。"],
          lines: [{ key: mode === "align" ? "subtitle" : "asr-0", dialogueId: mode === "align" ? 123 : undefined,
            text: mode === "align" ? "目标锁定" : "新的识别台词", start: 4.3, end: 5.1, audioStart: 4.3, audioEnd: 5.1, warnings: [] },
          ...(options.multipleLines ? [{ key: "subtitle2", dialogueId: 124, text: "你们去吧", start: 6, end: 6.8, audioStart: 6, audioEnd: 6.8, warnings: [] }] : [])],
        },
      };
    } else if (action === "speech-cancel") data = { id: body.id, state: "cancelled", stage: "已取消" };
    else if (action === "review") data = { token: "review", patch: body, changes: ["字幕 123：1–2s → 4.300–5.100s"] };
    else throw new Error(`Unexpected mutation/request: ${action}`);
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  await page.getByRole("button", { name: "读取列表" }).click();
  await page.getByRole("button", { name: "扫描配置" }).click();
  await page.getByLabel("语音事件", { exact: true }).selectOption("voiceSection");
  await page.getByRole("button", { name: "读取媒体" }).click();
  return { polls: () => jobPolls, starts: () => starts, request: () => submitted };
}

async function extract(page: Page) {
  await page.getByRole("button", { name: "提取语音" }).click();
  await expect(page.getByLabel("源语音试听")).toHaveJSProperty("readyState", 4);
  await page.getByLabel("已核对时间映射").check();
}

test("missing speech models can be installed from the workspace", async ({ page }) => {
  let installCalls = 0;
  let installationStarted = false;
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  await page.route("**/api/ue/animation-voice/*", async (route) => {
    const action = route.request().url().split("/").at(-1)!;
    let data: unknown;
    if (action === "cache") data = {
      root: "/Game/Seria/Sequences",
      catalog: [{ path: assetPath, name: sample.name }],
      catalogCachedAt: "2026-09-24T12:00:00.000Z",
      snapshots: { [assetPath]: { snapshot: sample, cachedAt: "2026-09-24T12:00:00.000Z" } },
    };
    else if (action === "speech-install") {
      installCalls += 1;
      installationStarted = true;
      data = {
        ready: false, reason: "正在下载端侧模型 Qwen3-ASR-0.6B", root: "runtime",
        busy: false, canInstall: true, installing: true,
      };
    } else if (action === "speech-status") {
      data = installationStarted
        ? { ready: true, reason: "Qwen3 ASR / ForcedAligner · 本地离线", root: "runtime", busy: false, canInstall: true, installing: false }
        : { ready: false, reason: "端侧语音环境未安装", root: "runtime", busy: false, canInstall: true, installing: false };
    } else throw new Error(`Unexpected request: ${action}`);
    await route.fulfill({ json: { ok: true, data } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  await expect(page.getByRole("button", { name: "安装端侧模型" })).toBeVisible();
  expect(installCalls).toBe(0);
  await page.getByRole("button", { name: "安装端侧模型" }).click();
  await expect(page.getByText("Qwen3 ASR / ForcedAligner · 本地离线", { exact: true })).toBeVisible();
  expect(installCalls).toBe(1);
});

test("alignment requires explicit media choice, tracks audition and supports partial adoption", async ({ page }) => {
  const state = await setup(page, { multi: true, multipleLines: true });
  await expect(page.getByRole("button", { name: "提取语音" })).toBeDisabled();
  await page.getByLabel("中文媒体", { exact: true }).selectOption("2");
  await extract(page);
  await page.getByRole("button", { name: "开始对齐" }).click();
  await expect(page.getByLabel("字幕与对齐")).toBeVisible();
  expect(state.starts()).toBe(1);
  expect(state.request().lines).toEqual([
    { key: "subtitle", dialogueId: 123, text: "目标锁定" },
    { key: "subtitle2", dialogueId: 124, text: "你们去吧" },
  ]);
  await expect(page.getByText("目标锁定", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("字幕 1 开始")).toHaveValue("1");
  await expect(page.getByRole("button", { name: "检查写入差异" })).toBeDisabled();
  await page.getByLabel("选择字幕 2 写入").check();
  await page.getByLabel("选择字幕 2 写入").uncheck();
  await page.getByRole("button", { name: "试听语音结果 1" }).click();
  await expect(page.getByText("试听中", { exact: true })).toBeVisible();
  await expect(page.getByLabel("源语音试听")).toHaveJSProperty("paused", false);
  await page.waitForFunction(() => (document.querySelector("audio")?.currentTime ?? 0) > 4.3);
  await expect(page.getByLabel("源语音试听")).toHaveJSProperty("paused", true, { timeout: 3000 });
  await expect(page.getByText("已试听", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "采用到待写入" }).first().click();
  await expect(page.getByLabel("字幕 1 开始")).toHaveValue("4.300");
  await expect(page.getByLabel("字幕 2 开始")).toHaveValue("2");
  await expect(page.getByLabel("选择字幕 1 写入")).toBeChecked();
  await expect(page.getByText("已采用到待写入", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "检查写入差异" })).toBeEnabled();
  await mkdir(".impeccable/review", { recursive: true });
  await page.mouse.move(900, 200);
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator(".animation-voice__scroll").evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `.impeccable/review/speech-${width}.png`, fullPage: true });
    const fits = await page.locator(".animation-voice__scroll").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
    await expect(page.getByRole("button", { name: "检查写入差异" })).toBeInViewport();
  }
  await page.getByRole("button", { name: "采用到待写入" }).click();
  await expect(page.getByLabel("字幕 2 开始")).toHaveValue("6.000");
  await page.getByRole("button", { name: "检查写入差异" }).click();
  await expect(page.getByLabel("写入差异")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认写入 UE" })).toBeVisible();
});

test("an unmatched transcription is a draft with no invented DialogueID", async ({ page }) => {
  await setup(page); await extract(page);
  await page.getByRole("button", { name: "语音转文字", exact: true }).click();
  await page.getByRole("button", { name: "开始识别" }).click();
  await page.getByRole("button", { name: "采用到待写入" }).click();
  await expect(page.getByLabel("字幕 2 ID")).toHaveValue("");
  await expect(page.getByLabel("字幕 2 开始")).toHaveValue("4.300");
  await expect(page.getByLabel("选择字幕 2 写入")).toBeChecked();
  await page.getByRole("button", { name: "检查写入差异" }).click();
  await expect(page.getByRole("alert")).toContainText("ID");
});

test("newer subtitle edits cannot be overwritten by an older alignment result", async ({ page }) => {
  await setup(page); await extract(page);
  await page.getByRole("button", { name: "开始对齐" }).click();
  await page.getByLabel("字幕 1 开始").fill("1.5");
  await page.getByRole("button", { name: "采用到待写入" }).click();
  await expect(page.getByRole("alert")).toContainText("字幕草稿已变化");
  await expect(page.getByLabel("字幕 1 开始")).toHaveValue("1.5");
});

test("hidden workspace pauses polling; cancellation stays available on return", async ({ page }) => {
  const state = await setup(page, { multi: false, waiting: true }); await extract(page);
  await page.getByRole("button", { name: "开始对齐" }).click();
  await expect(page.getByText("对齐台词与音频时间", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "分镜工作台", exact: true }).click();
  await page.waitForTimeout(1200);
  const count = state.polls();
  await page.waitForTimeout(1500);
  expect(state.polls()).toBe(count);
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始对齐" })).toBeEnabled();
});

test("speech motion follows real jobs, ignores late cancellation polls and adopts without replay", async ({ page }, info) => {
  await setup(page); await extract(page);
  let held: import("@playwright/test").Route | undefined;
  await page.route("**/api/ue/animation-voice/speech-job", (route) => { held = route; });
  await page.getByRole("button", { name: "开始对齐" }).click();
  const glyph = page.locator(".animation-speech__task .task-glyph");
  await expect(glyph).toHaveAttribute("data-running", "true");
  await expect.poll(() => held !== undefined).toBe(true);
  await page.screenshot({ path: info.outputPath("speech-running.png") });
  await setReducedMotion(page, true);
  await expect(glyph).toHaveAttribute("data-running", "false");
  expect(await glyph.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await setReducedMotion(page, false);
  await expect(glyph).toHaveAttribute("data-running", "true");
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect(glyph).toHaveAttribute("data-phase", "cancelled");
  await held!.fulfill({ json: { ok: true, data: { id: "job-1", state: "running", stage: "过期轮询" } } });
  await page.unroute("**/api/ue/animation-voice/speech-job");
  await expect(page.getByRole("button", { name: "开始对齐" })).toBeEnabled();
  await expect(glyph).toHaveAttribute("data-phase", "cancelled");

  await page.getByRole("button", { name: "开始对齐" }).click();
  await expect(glyph).toHaveAttribute("data-phase", "ready");
  // Record newly created WAAPI effects without slowing business updates.
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    (window as unknown as { receiptAnimations: number }).receiptAnimations = 0;
    Element.prototype.animate = function (...args) {
      if (this.hasAttribute("data-task-receipt")) {
        (window as unknown as { receiptAnimations: number }).receiptAnimations++;
      }
      return animate.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "采用到待写入", exact: true }).click();
  await expect(page.getByLabel("字幕 1 开始")).toHaveValue("4.300");
  await expect(page.getByLabel("选择字幕 1 写入")).toBeChecked();
  expect(await page.evaluate(() => (window as unknown as { receiptAnimations: number }).receiptAnimations)).toBe(1);
  await page.getByRole("button", { name: "分镜工作台", exact: true }).click();
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { receiptAnimations: number }).receiptAnimations)).toBe(1);
  expect(await page.locator(".animation-speech").evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.screenshot({ path: info.outputPath("speech-adopted.png") });
  await page.getByRole("button", { name: "开始对齐" }).click();
  await expect(glyph).toHaveAttribute("data-phase", "ready");
  await page.getByRole("button", { name: "采用到待写入", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("选择字幕 1 写入")).toBeChecked();
  expect(await page.evaluate(() => (window as unknown as { receiptAnimations: number }).receiptAnimations)).toBe(1);
});

test("failed speech and unknown polling states never look complete", async ({ page }) => {
  await setup(page); await extract(page);
  let failed = false;
  await page.route("**/api/ue/animation-voice/speech-job", (route) => failed
    ? route.fulfill({ json: { ok: true, data: { id: "job-1", state: "failed", stage: "任务失败", error: "显存不足" } } })
    : route.fulfill({ status: 503, json: { ok: false, error: { message: "状态暂不可用" } } }));
  await page.getByRole("button", { name: "开始对齐" }).click();
  const glyph = page.locator(".animation-speech__task .task-glyph");
  await expect(glyph).toHaveAttribute("data-phase", "uncertain");
  expect(await glyph.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  failed = true;
  await expect(glyph).toHaveAttribute("data-phase", "failed", { timeout: 6000 });
  await expect(page.getByRole("alert")).toContainText("显存不足");
  await expect(page.getByRole("button", { name: "采用到待写入", exact: true })).toHaveCount(0);
});
