import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { SequenceSnapshot } from "../src/animationVoice";

const sample: SequenceSnapshot = {
  assetPath: "/Game/Seria/Sequences/LS_MechanicalCemetery.LS_MechanicalCemetery",
  name: "LS_MechanicalCemetery", revision: "r1", stateRevision: "s1", dirty: false,
  start: 0, end: 35, displayRate: 30, tickResolution: 24000,
  director: { path: "", parent: "" },
  tracks: [{ path: "track", name: "Dialogue", className: "MovieSceneDialogueTrack", binding: "", sections: [
    { path: "section1", className: "MovieSceneDialogueSection", start: 4.2, end: 5.4, active: true, dialogueId: 9032023 },
  ] }],
  voices: [{ id: 9032023, name: "看守反派", text: "目标锁定", delayMs: 0 },
    { id: 9032024, name: "看守反派", text: "预计5分钟接触", delayMs: 0 }],
  events: [], marks: [], warnings: [],
  skipBlockedReasons: ["缺少 Director Blueprint，请在 UE 创建并配置跳过端点"],
};

test("animation workspace restores cached scans without reading every UE asset", async ({ page }) => {
  let scanCalls = 0;
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  await page.route("**/api/ue/animation-voice/*", async (route) => {
    const action = route.request().url().split("/").at(-1);
    let data: unknown;
    if (action === "cache") data = {
      root: "/Game/Seria/Sequences",
      catalog: [{ path: sample.assetPath, name: sample.name }],
      catalogCachedAt: "2026-09-24T12:00:00.000Z",
      snapshots: {
        [sample.assetPath]: { snapshot: sample, cachedAt: "2026-09-24T12:00:00.000Z" },
      },
    };
    else if (action === "speech-status") data = { ready: false, reason: "端侧语音环境未安装", root: "runtime", busy: false, canInstall: true, installing: false };
    else if (action === "scan") { scanCalls++; data = sample; }
    else if (action === "catalog") data = [{ path: sample.assetPath, name: sample.name }];
    else throw new Error(`Unexpected request: ${action}`);
    await route.fulfill({ json: { ok: true, data } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  await expect(page.getByText("本地缓存", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("目标锁定", { exact: true })).toBeVisible();
  expect(scanCalls).toBe(0);
});

test("animation workspace scans, reviews exact changes and preserves drafts", async ({ page }) => {
  let scanCalls = 0;
  let applyCalls = 0;
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  await page.route("**/api/ue/animation-voice/*", async (route) => {
    const action = route.request().url().split("/").at(-1);
    const body = route.request().postDataJSON();
    let data: unknown;
    if (action === "cache") data = { root: "/Game/Seria/Sequences", catalog: [], catalogCachedAt: null, snapshots: {} };
    else if (action === "catalog") data = [{ path: sample.assetPath, name: sample.name }];
    else if (action === "scan") { scanCalls++; data = sample; }
    else if (action === "speech-status") data = { ready: false, reason: "端侧语音环境未安装", root: "runtime", busy: false, canInstall: true, installing: false };
    else if (action === "review") data = { token: "token", patch: body, changes: ["修改字幕 9032023：4.200–5.400s → 4.200–5.600s"] };
    else {
      applyCalls++; expect(body).toEqual({ token: "token" });
      data = { applied: true, snapshot: { ...sample, dirty: true, revision: "r2" }, message: "已写入并回读；动画尚未保存，请在 UE 检查并保存" };
    }
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  await expect(page.getByRole("heading", { name: "动画语音", exact: true })).toBeVisible();
  expect(scanCalls).toBe(0);
  await page.getByRole("button", { name: "读取列表" }).click();
  expect(scanCalls).toBe(0);
  await page.getByRole("button", { name: "扫描配置" }).click();
  await expect(page.getByText("目标锁定", { exact: true })).toBeVisible();
  const layout = await page.evaluate(() => {
    const catalogHead = document.querySelector(".animation-voice__catalog-head")!.getBoundingClientRect();
    const identity = document.querySelector(".animation-voice__identity")!.getBoundingClientRect();
    const filter = document.querySelector<HTMLInputElement>(".animation-voice__catalog-filter input")!.getBoundingClientRect();
    const scroller = document.querySelector<HTMLElement>(".animation-voice__scroll")!;
    const tableHeader = document.querySelector<HTMLElement>(".animation-subtitle__table th")!;
    return {
      topDelta: Math.abs(catalogHead.top - identity.top),
      filterTop: filter.top,
      identityBottom: identity.bottom,
      identityInsideScroller: scroller.contains(document.querySelector(".animation-voice__identity")),
      tableHeaderPosition: getComputedStyle(tableHeader).position,
      scrollbarWidth: getComputedStyle(scroller, "::-webkit-scrollbar").width,
    };
  });
  expect(layout.topDelta).toBeLessThanOrEqual(1);
  expect(layout.filterTop).toBeLessThan(layout.identityBottom);
  expect(layout.identityInsideScroller).toBe(true);
  expect(layout.tableHeaderPosition).not.toBe("sticky");
  expect(layout.scrollbarWidth).toBe("8px");
  await expect(page.getByLabel("校正已有事件")).toBeDisabled();
  await expect(page.getByLabel("字幕 2 开始")).toHaveValue("");
  await page.getByLabel("字幕 1 结束").fill("5.6");
  await page.getByRole("button", { name: "检查写入差异" }).click();
  await expect(page.getByLabel("写入差异")).toBeVisible();
  await page.getByLabel("字幕 1 结束").fill("5.7");
  await expect(page.getByLabel("写入差异")).toHaveCount(0);
  await page.getByLabel("字幕 1 结束").fill("5.6");
  await page.getByRole("button", { name: "分镜工作台", exact: true }).click();
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  await expect(page.getByLabel("字幕 1 结束")).toHaveValue("5.6");
  expect(scanCalls).toBe(1);
  await page.getByRole("button", { name: "检查写入差异" }).click();
  await mkdir(".impeccable/review", { recursive: true });
  await page.mouse.move(900, 500);
  await page.waitForTimeout(600);
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.locator(".animation-voice").evaluate((el) => ({
      width: el.clientWidth, scrollWidth: el.scrollWidth,
      pageWidth: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.pageScroll).toBeLessThanOrEqual(metrics.pageWidth + 1);
    await expect(page.getByRole("button", { name: "确认写入 UE" })).toBeInViewport();
    await page.screenshot({ path: `.impeccable/review/animation-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "确认写入 UE" }).click();
  await expect(page.getByText("已写入并回读；动画尚未保存，请在 UE 检查并保存")).toBeVisible();
  expect(applyCalls).toBe(1);
});

test("animation workspace reports scan failures and retains old revision after rescan", async ({ page }) => {
  let revision = "r1";
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  await page.route("**/api/ue/animation-voice/*", async (route) => {
    if (route.request().url().endsWith("/cache")) {
      await route.fulfill({ json: { ok: true, data: { root: "/Game/Seria/Sequences", catalog: [], catalogCachedAt: null, snapshots: {} } } });
    } else if (route.request().url().endsWith("/speech-status")) {
      await route.fulfill({ json: { ok: true, data: { ready: false, reason: "端侧语音环境未安装", root: "runtime", busy: false, canInstall: true, installing: false } } });
    } else if (route.request().url().endsWith("/catalog")) {
      await route.fulfill({ json: { ok: true, data: [
        { path: sample.assetPath, name: sample.name }, { path: "/Game/Bad.Bad", name: "Bad" },
      ] } });
    } else if (route.request().postDataJSON().assetPath === "/Game/Bad.Bad") {
      await route.fulfill({ status: 400, json: { ok: false, error: { message: "资产读取失败" } } });
    } else await route.fulfill({ json: { ok: true, data: { ...sample, revision } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  await page.getByRole("button", { name: "读取列表" }).click();
  await page.getByRole("button", { name: "扫描配置" }).click();
  await expect(page.getByText("读取失败", { exact: true })).toBeVisible();
  await page.getByLabel("字幕 1 结束").fill("5.6");
  revision = "r2";
  await page.getByRole("button", { name: "扫描配置" }).click();
  await expect(page.getByRole("button", { name: "扫描配置" })).toBeEnabled();
  await page.getByRole("button", { name: "检查写入差异" }).click();
  await expect(page.getByRole("alert")).toContainText("动画配置已变化");
});

test("event correction inputs lock when a rescan loses the director", async ({ page }) => {
  let blocked = false;
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  await page.route("**/api/ue/animation-voice/*", (route) => route.fulfill({
    json: { ok: true, data: route.request().url().endsWith("/cache")
      ? { root: "/Game/Seria/Sequences", catalog: [], catalogCachedAt: null, snapshots: {} }
      : route.request().url().endsWith("/speech-status")
        ? { ready: false, reason: "端侧语音环境未安装", root: "runtime", busy: false, canInstall: true, installing: false }
        : route.request().url().endsWith("/catalog")
          ? [{ path: sample.assetPath, name: sample.name }]
          : { ...sample, skipBlockedReasons: blocked ? sample.skipBlockedReasons : [] } },
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  await page.getByRole("button", { name: "读取列表" }).click();
  await page.getByRole("button", { name: "扫描配置" }).click();
  await page.getByLabel("校正已有事件").check();
  await expect(page.getByLabel("显示跳过按钮时间")).toBeEnabled();
  blocked = true;
  await page.getByRole("button", { name: "扫描配置" }).click();
  await expect(page.getByRole("button", { name: "扫描配置" })).toBeEnabled();
  await expect(page.getByLabel("显示跳过按钮时间")).toBeDisabled();
  await expect(page.getByLabel("隐藏跳过按钮时间")).toBeDisabled();
});
