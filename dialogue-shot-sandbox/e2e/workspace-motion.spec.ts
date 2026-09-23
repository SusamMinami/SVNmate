import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { ok: false } }));
  await page.addInitScript(() =>
    sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  await page.goto("/");
  await expect(page.locator(".shot-row").first()).toBeVisible();
  return errors;
}

// Freeze a real compositor animation mid-flight, then redirect it in the same
// browser task. Comparing its new first frame catches fixed-origin replay.
async function interrupt(page: Page, label: string) {
  return page.evaluate(async (name) => {
    const pages = Array.from(document.querySelectorAll<HTMLElement>(
      ".app-shell > [data-workspace-id]:not([hidden])"));
    const before = pages.map((element) => {
      element.getAnimations().forEach((animation) => {
        animation.pause();
        animation.currentTime = 75;
      });
      return { id: element.dataset.workspaceId!, transform: getComputedStyle(element).transform };
    });
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".app-rail button"))
      .find((element) => element.title === name)!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return before.map((sample) => {
      const element = document.querySelector<HTMLElement>(`[data-workspace-id="${sample.id}"]`)!;
      const animation = element.getAnimations()[0];
      animation?.pause();
      return {
        ...sample,
        hidden: element.hidden,
        from: (animation?.effect as KeyframeEffect)?.getKeyframes()[0].transform,
      };
    });
  }, label);
}

for (const scale of [1, 1.5, 2]) {
  test.describe(`workspace continuity at ${scale * 100}% pixel density`, () => {
    test.use({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: scale });
    test("retargets current positions and preserves visited workspaces", async ({ page }, testInfo) => {
      const errors = await fixture(page);
      const canvas = await page.locator(".stage-main__frame canvas").elementHandle();
      // Preload the relevant lazy workspace and give it an editable draft.
      await page.getByRole("button", { name: "任务目标物", exact: true }).click();
      const input = page.getByLabel("BP 文件名", { exact: true });
      await input.fill("7352");
      await page.getByRole("button", { name: "分镜工作台", exact: true }).click();
      await expect(page.locator('[data-workspace-state="exiting"]')).toHaveCount(0);

      await page.getByRole("button", { name: "注册 NPC", exact: true }).click();
      for (const label of ["分镜工作台", "任务目标物"]) {
        const samples = await interrupt(page, label);
        expect(samples.length).toBeGreaterThanOrEqual(2);
        for (const sample of samples) {
          expect(sample.hidden).toBe(false);
          expect(sample.from).toBe(sample.transform);
        }
      }
      await expect(page.locator(".app-shell")).toHaveAttribute("data-workspace-direction", "up");
      // All three interrupted pages survive until the final movement completes.
      await expect(page.locator('[data-workspace-state="exiting"]')).toHaveCount(2);
      await page.screenshot({ path: testInfo.outputPath(`workspace-midflight-${scale}.png`) });
      await page.evaluate(() => document.querySelectorAll<HTMLElement>("[data-workspace-id]")
        .forEach((element) => element.getAnimations().forEach((animation) => animation.finish())));
      await expect(page.locator('[data-workspace-state="exiting"]')).toHaveCount(0);
      await expect(input).toHaveValue("7352");
      await expect(page.locator('[data-workspace-id="targets"]')).toHaveCSS("will-change", "auto");
      await expect(page.locator('[data-workspace-id="npc"]')).toHaveAttribute("inert", "");
      await page.screenshot({ path: testInfo.outputPath(`workspace-${scale}.png`) });

      // Keyboard navigation skips the spatial transition entirely.
      const storyboard = page.getByRole("button", { name: "分镜工作台", exact: true });
      await storyboard.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator('[data-workspace-state="exiting"]')).toHaveCount(0);
      await expect(page.locator(".workspace")).toHaveAttribute("data-workspace-state", "active");
      expect(await canvas!.evaluate((element) =>
        element === document.querySelector(".stage-main__frame canvas"))).toBe(true);
      await page.getByRole("button", { name: "进入配置小窗" }).click();
      await expect(page.locator(".tool-workspace")).toHaveCount(0);
      await expect(page.locator(".stage-view")).toHaveCount(0);
      await page.getByRole("button", { name: "返回完整窗口" }).click();
      await expect(page.locator(".tool-workspace")).toHaveCount(2);
      await expect(page.locator(".stage-view")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}

test("settles an in-flight workspace immediately when motion is reduced", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "注册 NPC", exact: true }).click();
  await page.evaluate(() => document.querySelectorAll<HTMLElement>("[data-workspace-id]")
    .forEach((element) => element.getAnimations().forEach((animation) => animation.pause())));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator('[data-workspace-state="exiting"]')).toHaveCount(0);
  await expect(page.locator('[data-workspace-id="npc"]')).toHaveCSS("will-change", "auto");
  await page.getByRole("button", { name: "任务目标物", exact: true }).click();
  await expect(page.locator('[data-workspace-state="exiting"]')).toHaveCount(0);
});

test("status popovers reverse, dismiss, and share immediate adjacent tooltips", async ({ page }, testInfo) => {
  const errors = await fixture(page);
  const collaboration = page.getByRole("button", { name: "协作连接状态", exact: true });
  const data = page.getByRole("button", { name: "数据源状态", exact: true });
  await collaboration.hover();
  await expect(collaboration.locator(".workspace-status-tooltip")).toBeVisible();
  await data.hover();
  await expect(data).toHaveAttribute("data-tooltip-instant", "true");
  await expect(data.locator(".workspace-status-tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(data.locator(".workspace-status-tooltip")).toBeHidden();

  await data.click();
  const panel = page.locator(".data-source-status__popover");
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(panel).toHaveCSS("opacity", "1");
  const reversal = await data.evaluate(async (button) => {
    const element = document.querySelector<HTMLElement>(".data-source-status__popover")!;
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await frame();
    element.getAnimations().forEach((animation) => {
      animation.pause();
      animation.currentTime = 30;
    });
    const opacity = Number(getComputedStyle(element).opacity);
    const inert = element.inert;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await frame();
    const frames = element.getAnimations().flatMap((animation) =>
      (animation.effect as KeyframeEffect).getKeyframes());
    return { opacity, inert, from: Number(frames.find((frame) => "opacity" in frame)?.opacity) };
  });
  expect(reversal.inert).toBe(true);
  expect(reversal.opacity).toBeGreaterThan(0);
  expect(reversal.opacity).toBeLessThan(1);
  expect(reversal.from).toBeCloseTo(reversal.opacity, 2);
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(panel).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("status-popover.png") });
  await collaboration.click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(collaboration).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(collaboration).toBeFocused();
  await expect(page.getByRole("dialog", { name: "协作连接状态" })).toHaveCount(0);

  await data.focus();
  await page.keyboard.press("Space");
  await expect(panel).toBeFocused();
  await expect(panel).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("Escape");
  await expect(data).toBeFocused();
  await data.click();
  const query = page.getByRole("textbox").first();
  await query.click();
  await expect(query).toBeFocused();
  await expect(panel).toHaveAttribute("data-open", "false");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await data.click();
  await expect(panel).toHaveCSS("transition-duration", "0s");
  await data.click();
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});
