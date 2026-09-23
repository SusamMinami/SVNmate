import { expect, test } from "@playwright/test";
import { refinementBaselinePlan, type ShotRefinementRequest } from "../src/director/shotRefinement";
import { PNG } from "pngjs";

test.use({ deviceScaleFactor: 1.25 });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  // These checks use the bundled demo and never contact UE, audio libraries or models.
  await page.route("**/api/**", (route) => route.fulfill({
    status: 503, json: { ok: false, error: { message: "离线桌面验收" } },
  }));
});

test("submits a local baseline and adopts only the current shot", async ({ page }, testInfo) => {
  let request: ShotRefinementRequest | undefined;
  let ready = false;
  await page.route("**/api/trae/refinements", async (route) => {
    request = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, data: {
      requestId: request!.input.request_id, baselineVersion: "a".repeat(64),
    } } });
  });
  await page.route("**/api/trae/refinements/status?**", async (route) => {
    const result = refinementBaselinePlan(request!);
    result.shots[0] = { ...result.shots[0], intent: "精修验收：保持双方空间，明确交流关系。" };
    await route.fulfill({ json: { ok: true, data: {
      requestId: request!.input.request_id, baselineVersion: "a".repeat(64),
      status: ready ? "completed" : "processing", ...(ready ? { result } : {}),
    } } });
  });
  await page.goto("/");
  const panel = page.getByRole("region", { name: "TRAE 局部精修" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("精修要求").fill("交代双方空间，保留当前动作");
  await panel.getByRole("button", { name: "精修当前镜头" }).click();
  await expect(panel).toContainText("TRAE 正在精修当前镜头");
  expect(request!.target_indexes).toEqual([0]);
  expect(request!.input.constraints.lock_player_position).toBe(true);
  ready = true;
  await expect(panel.getByRole("button", { name: "采纳精修到草稿" })).toBeVisible();
  await panel.getByRole("button", { name: "预览精修镜头" }).click();
  await expect(page.getByText("建议预览 · 尚未采纳")).toBeVisible();
  await panel.getByRole("button", { name: "返回当前镜头" }).click();
  await panel.scrollIntoViewIfNeeded();
  await page.mouse.move(10, 10);
  await expect(panel.getByRole("button", { name: "采纳精修到草稿" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("refinement-1440.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByRole("button", { name: "采纳精修到草稿" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "预览精修镜头" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "采纳精修到草稿" })).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("refinement-1280.png"), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const image = PNG.sync.read(await page.locator(".stage-view canvas").first().screenshot());
  const colors = new Set<number>();
  for (let i = 0; i < image.data.length; i += 64) colors.add(image.data[i] * 65536 + image.data[i + 1] * 256 + image.data[i + 2]);
  expect(colors.size).toBeGreaterThan(30);
  await panel.getByRole("button", { name: "采纳精修到草稿" }).click();
  await expect(panel).toBeFocused();
  await expect(panel).toContainText("已采纳当前镜头精修");
  await expect(page.locator(".right-panel")).toContainText("精修验收：保持双方空间");
  await page.locator(".shot-row").nth(1).click();
  await expect(page.locator(".right-panel")).toContainText(request!.baseline.shots[1].decision.intent);
});

for (const action of ["stop", "switch-workspace", "switch-dialogue"] as const) {
  test(`cancels a task acknowledged after ${action}`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let cancelled = "";
    let id = "";
    await page.route("**/api/trae/refinements", async (route) => {
      id = (route.request().postDataJSON() as ShotRefinementRequest).input.request_id;
      await gate;
      await route.fulfill({ json: { ok: true, data: { requestId: id, baselineVersion: "a".repeat(64) } } });
    });
    await page.route("**/api/trae/tasks/cancel", async (route) => {
      cancelled = route.request().postDataJSON().request_id;
      await route.fulfill({ json: { ok: true, data: { requestId: cancelled, status: "cancelled" } } });
    });
    await page.goto("/");
    const panel = page.getByRole("region", { name: "TRAE 局部精修" });
    await panel.getByLabel("精修要求").fill("保留空间关系");
    await panel.getByRole("button", { name: "精修当前镜头" }).click();
    await expect.poll(() => id).not.toBe("");
    if (action === "stop") await panel.getByRole("button", { name: "停止精修" }).click();
    else if (action === "switch-workspace") await page.getByRole("button", { name: "注册 NPC", exact: true }).click();
    else {
      await page.getByLabel("四位数对话 ID 或对白内容").fill("3099");
      await page.getByRole("button", { name: "加载对白内容" }).click();
    }
    release();
    await expect.poll(() => cancelled).toBe(id);
    await expect(page.getByRole("button", { name: "采纳精修到草稿" })).toHaveCount(0);
  });
}

test("rejects a completed response with an old baseline version", async ({ page }) => {
  let request: ShotRefinementRequest;
  await page.route("**/api/trae/refinements", async (route) => {
    request = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, data: {
      requestId: request.input.request_id, baselineVersion: "a".repeat(64),
    } } });
  });
  await page.route("**/api/trae/refinements/status?**", (route) => route.fulfill({
    json: { ok: true, data: { requestId: request.input.request_id,
      baselineVersion: "b".repeat(64), status: "completed", result: refinementBaselinePlan(request) } },
  }));
  await page.goto("/");
  const panel = page.getByRole("region", { name: "TRAE 局部精修" });
  await panel.getByLabel("精修要求").fill("保留空间关系");
  await panel.getByRole("button", { name: "精修当前镜头" }).click();
  await expect(panel).toContainText("精修结果版本不一致");
  await expect(panel.getByRole("button", { name: "采纳精修到草稿" })).toHaveCount(0);
});
