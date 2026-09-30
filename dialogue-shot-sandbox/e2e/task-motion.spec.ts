import { expect, test, type Page, type Route } from "@playwright/test";
import type { SequenceSnapshot } from "../src/animationVoice";
import { setReducedMotion } from "./motionPreference";

const snapshot: SequenceSnapshot = {
  assetPath: "/Game/Sequences/LS_Test.LS_Test", name: "LS_Test", revision: "r1", stateRevision: "s1",
  dirty: false, start: 0, end: 30, displayRate: 30, tickResolution: 24000,
  director: { path: "", parent: "" }, events: [], marks: [], warnings: [], skipBlockedReasons: [],
  tracks: [{ path: "track", name: "字幕", className: "DialogueTrack", binding: "", sections: [
    { path: "subtitle", className: "DialogueSection", active: true, dialogueId: 123, start: 1, end: 2 },
  ] }], voices: [{ id: 123, name: "角色", text: "目标已锁定，准备行动。", delayMs: 0 }],
};

async function fixture(page: Page) {
  const requests: Record<string, number> = {};
  const pending = new Map<string, Route[]>();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { ok: false } }));
  await page.route("**/api/ue/animation-voice/*", async (route) => {
    const action = route.request().url().split("/").at(-1)!;
    requests[action] = (requests[action] ?? 0) + 1;
    if (action === "cache") return route.fulfill({ json: { ok: true, data: {
      root: "/Game/Seria/Sequences", catalogCachedAt: "2026-09-28T00:00:00Z",
      catalog: [snapshot, { assetPath: "/Game/Sequences/LS_B.LS_B", name: "LS_B" },
        { assetPath: "/Game/Sequences/LS_C.LS_C", name: "LS_C" }].map((s) => ({ path: s.assetPath, name: s.name })),
      snapshots: { [snapshot.assetPath]: { snapshot, cachedAt: "2026-09-28T00:00:00Z" } },
    } } });
    if (action === "speech-status") return route.fulfill({ json: { ok: true, data: {
      ready: false, reason: "端侧语音环境未安装", canInstall: true,
    } } });
    pending.set(action, [...(pending.get(action) ?? []), route]);
  });
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  await page.goto("/");
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  await expect(page.getByLabel("字幕 1 结束")).toHaveValue("2");
  async function take(action: string) {
    await expect.poll(() => pending.get(action)?.length ?? 0).toBeGreaterThan(0);
    return pending.get(action)!.shift()!;
  }
  async function reply(action: string, data: unknown) {
    await (await take(action)).fulfill({ json: { ok: true, data } });
  }
  return { requests, errors, take, reply };
}

async function animationCount(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => el.getAnimations({ subtree: true }).length);
}

for (const density of [1, 1.5, 2]) {
  test.describe(`task feedback at ${density * 100}% pixel density`, () => {
    test.use({ deviceScaleFactor: density });
    test("shows real scan counts, stops cleanly and distinguishes review from written", async ({ page }, info) => {
      const api = await fixture(page);
      const scan = page.getByRole("button", { name: "扫描配置", exact: true });
      const scanGlyph = scan.locator(".task-glyph");
      const bar = page.getByRole("progressbar", { name: "动画配置扫描进度" });
      // Hydrated results do not play a completion animation.
      expect(await page.locator(".animation-voice .task-glyph").count()).toBe(0);
      await scan.click();
      await expect(scanGlyph).toHaveAttribute("data-phase", "running");
      await expect(bar).toHaveAttribute("aria-valuenow", "0");
      await expect.poll(() => animationCount(page, '.animation-voice__catalog-head')).toBeGreaterThan(0);
      // Sample real compositor animation at two times rather than checking just a class.
      const positions = await scanGlyph.evaluate((el) => {
        const animation = el.getAnimations({ subtree: true })[0];
        animation.pause();
        animation.currentTime = 500;
        const first = getComputedStyle(el.querySelector(".task-glyph__sweep")!).transform;
        animation.currentTime = 1100;
        const second = getComputedStyle(el.querySelector(".task-glyph__sweep")!).transform;
        animation.play();
        return [first, second];
      });
      expect(positions[0]).not.toBe(positions[1]);
      await page.screenshot({ path: info.outputPath(`scan-running-${density}.png`) });
      await page.getByRole("button", { name: "停止后续扫描" }).click();
      await expect(page.getByText("等待当前项结束后停止", { exact: false })).toBeVisible();
      await api.reply("scan", snapshot);
      await expect(scanGlyph).toHaveAttribute("data-phase", "cancelled");
      await expect(bar).toHaveAttribute("aria-valuenow", "1");
      expect(api.requests.scan).toBe(1);
      expect(await animationCount(page, ".animation-voice__catalog-head")).toBe(0);

      // A retry gets a fresh run; failures advance processed count but are not "cached".
      await scan.click();
      await expect(bar).toHaveAttribute("aria-valuenow", "0");
      await api.reply("scan", snapshot);
      await expect(bar).toHaveAttribute("aria-valuenow", "1");
      await (await api.take("scan")).fulfill({ status: 400, json: { ok: false, error: { message: "读取失败" } } });
      await expect(bar).toHaveAttribute("aria-valuenow", "2");
      const last = await api.take("scan");
      await last.fulfill({ json: { ok: true, data: { ...snapshot, assetPath: last.request().postDataJSON().assetPath, name: "LS_C" } } });
      await expect(scanGlyph).toHaveAttribute("data-phase", "warning");
      await expect(page.locator(".animation-voice__footer")).toContainText("2 个已缓存 · 1 个失败");
      await expect(bar).toHaveAttribute("aria-valuenow", "3");

      await page.getByLabel("字幕 1 结束").fill("2.5");
      await page.getByRole("button", { name: "检查写入差异" }).click();
      const writeGlyph = page.locator(".animation-voice__footer .task-glyph");
      await expect(writeGlyph).toHaveAttribute("data-phase", "running");
      await api.reply("review", { token: "review", changes: ["字幕 123：1–2s → 1–2.5s"] });
      await expect(writeGlyph).toHaveAttribute("data-phase", "ready");
      expect(api.requests.apply ?? 0).toBe(0);
      await page.getByRole("button", { name: "确认写入 UE" }).dblclick();
      await expect(writeGlyph).toHaveAttribute("data-phase", "running");
      await expect(page.getByLabel("写入差异")).toBeVisible();
      await page.screenshot({ path: info.outputPath(`write-running-${density}.png`) });
      await api.reply("apply", { applied: true, snapshot: { ...snapshot, dirty: true, revision: "r2" },
        message: "已写入并回读；动画尚未保存，请在 UE 检查并保存" });
      await expect(writeGlyph).toHaveAttribute("data-phase", "success");
      await expect(page.locator(".animation-voice__footer")).toContainText("尚未保存");
      expect(api.requests.apply).toBe(1);
      await expect.poll(() => animationCount(page, ".animation-voice")).toBe(0);
      await page.screenshot({ path: info.outputPath(`write-complete-${density}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(api.errors).toEqual([]);
    });
  });
}

test("failed checks and uncertain writes stop immediately; hidden/reduced motion never replays results", async ({ page }) => {
  const api = await fixture(page);
  await page.getByLabel("字幕 1 结束").fill("2.5");
  const glyph = page.locator(".animation-voice__footer .task-glyph");
  await page.getByRole("button", { name: "检查写入差异" }).click();
  await (await api.take("review")).fulfill({ status: 400, json: { ok: false, error: { message: "资产已变化，请重读" } } });
  await expect(glyph).toHaveAttribute("data-phase", "failed");
  expect(await animationCount(page, ".animation-voice__footer")).toBe(0);
  await page.getByRole("button", { name: "检查写入差异" }).click();
  await expect(glyph).toHaveAttribute("data-running", "true");
  await setReducedMotion(page, true);
  await expect(glyph).toHaveAttribute("data-running", "false");
  expect(await animationCount(page, ".animation-voice__footer")).toBe(0);
  await api.reply("review", { token: "r2", changes: ["修改字幕时间"] });
  await page.getByRole("button", { name: "确认写入 UE" }).click();
  await api.reply("apply", { applied: true, snapshot: null, message: "已写入，但最终扫描失败，请在 UE 检查" });
  await expect(glyph).toHaveAttribute("data-phase", "uncertain");
  await expect(page.locator(".animation-voice__footer")).toContainText("待核对");
  expect(await animationCount(page, ".animation-voice__footer")).toBe(0);
  // Restore a writable local draft, then simulate a lost response.
  await page.getByLabel("字幕 1 结束").fill("2.6");
  await page.getByRole("button", { name: "检查写入差异" }).click();
  await api.reply("review", { token: "r3", changes: ["修改字幕时间"] });
  await page.getByRole("button", { name: "确认写入 UE" }).click();
  await (await api.take("apply")).abort("connectionreset");
  await expect(glyph).toHaveAttribute("data-phase", "uncertain");
  await expect(page.getByRole("alert")).toContainText("请先在 UE 核对");

  await setReducedMotion(page, false);
  await page.getByRole("button", { name: "扫描配置", exact: true }).click();
  const scanGlyph = page.getByRole("button", { name: "扫描配置", exact: true, includeHidden: true }).locator(".task-glyph");
  await expect(scanGlyph).toHaveAttribute("data-running", "true");
  // Document visibility and workspace visibility are independent stop conditions.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(scanGlyph).toHaveAttribute("data-running", "false");
  expect(await animationCount(page, ".animation-voice")).toBe(0);
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(scanGlyph).toHaveAttribute("data-running", "true");
  await page.getByRole("button", { name: "停止后续扫描" }).click();
  await page.getByRole("button", { name: "分镜工作台", exact: true }).click();
  await expect(scanGlyph).toHaveAttribute("data-running", "false");
  await api.reply("scan", snapshot);
  await page.getByRole("button", { name: "动画语音", exact: true }).click();
  await expect(scanGlyph).toHaveAttribute("data-phase", "cancelled");
  expect(await animationCount(page, ".animation-voice")).toBe(0);
  expect(api.errors).toEqual([]);
});
