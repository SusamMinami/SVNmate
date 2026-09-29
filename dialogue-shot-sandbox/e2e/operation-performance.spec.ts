import { expect, test } from "@playwright/test";

test("large target lists retain correct slots and selection while editing the query", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: { ok: false } }));
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  const targets = Array.from({ length: 2000 }, (_, index) => ({
    targetId: String(500000 + index), type: 1, description: `合成角色 ${index}`,
    npcId: index + 1, npcName: `测试 ${index}`, modelId: index + 1,
    modelClassPath: `/Game/Test/BP_${index}`, previewKind: "asset",
    transform: { location: { x: index, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 },
      scale: { x: 1, y: 1, z: 1 } }, ambientDialogues: [],
  }));
  const plan = { taskId: "331102", taskName: "合成大列表", taskSource: "测试夹具",
    mapId: "1", mapName: "测试", mapAssetPath: "/Game/Test/Map", targets, warnings: [] };
  await page.route("**/api/ue/mission-targets/resolve", route => route.fulfill({ json: { ok: true, data: plan } }));
  await page.route("**/api/ue/mission-targets/inspect-blueprint", route => route.fulfill({ json: { ok: true, data: {
    blueprintState: "empty", blueprintAssetPath: "/Game/Test/BP_204800", dialogueId: "204800",
    slots: targets.map((target, index) => ({ modelIndex: index + 1, targetId: target.targetId,
      status: "registered", existingModelName: `Test_${index}`, suggestedModelName: `Test_${index}` })),
    appendSlots: [], message: "合成审核就绪",
  } } }));
  await page.goto(process.env.PERFORMANCE_URL || "/");
  await page.getByRole("button", { name: "任务目标物", exact: true }).click();
  const region = page.getByRole("region", { name: "任务目标物", exact: true });
  await region.getByLabel("任务节点 ID").fill("331102");
  await region.getByLabel("BP 文件名").fill("BP_204800");
  const search = region.getByRole("button", { name: "解析任务目标物" });
  await search.click();
  await expect(search).toBeEnabled();
  await search.click();
  const rows = region.locator(".mission-target-table tbody tr");
  await expect(rows).toHaveCount(2000);
  await expect(rows.last()).toContainText("BP 2000 · Test_1999");
  // Measure input-to-next-paint on the actual component, excluding Playwright transport time.
  const samples = await region.getByLabel("BP 文件名").evaluate(async (input) => {
    const times: number[] = [];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (let index = 0; index < 8; index++) {
      const start = performance.now();
      setter.call(input, `BP_204800_${index}`);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      times.push(performance.now() - start);
    }
    return times;
  });
  const result = { count: targets.length, inputToFrameMs: samples,
    medianMs: [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)] };
  console.log("target-list-performance", JSON.stringify(result));
  await info.attach("target-list-performance", { body: JSON.stringify(result), contentType: "application/json" });
  const first = region.getByLabel("选择目标物 500000", { exact: true });
  await first.uncheck();
  await expect(rows.first()).toContainText("不导入");
  // Changing the BP query invalidates its old inspection; selection numbering remains correct.
  await expect(rows.last()).toContainText("BP 1999 · -");
  await first.check();
  await expect(rows.first()).toContainText("BP 1 · -");
  await expect(rows.last()).toContainText("BP 2000 · -");
  await page.screenshot({ path: info.outputPath("targets-2000.png") });
  expect(errors).toEqual([]);
});

test("search icon follows the actual request and stops on failure, hidden page and reduced motion", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: { ok: false } }));
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  let finish: (() => Promise<void>) | undefined;
  await page.route("**/api/ue/mission-targets/inspect-blueprint", route => {
    finish = () => route.fulfill({ status: 400, json: { ok: false, error: { message: "测试检查失败" } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "任务目标物", exact: true }).click();
  await page.getByLabel("BP 文件名").fill("BP_204800");
  const button = page.getByRole("button", { name: "检查 BP 与对话模型" });
  const icon = button.locator(".operation-icon");
  await button.click();
  await expect(icon).toHaveAttribute("data-running", "true");
  await expect(icon.locator("svg")).toHaveCSS("animation-name", "operation-search");
  await expect(page.locator('.mission-target-modal .operation-icon[data-running="true"]')).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(icon).toHaveAttribute("data-running", "false");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(icon).toHaveAttribute("data-running", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(icon).toHaveAttribute("data-running", "false");
  await expect.poll(() => Boolean(finish)).toBe(true);
  await finish!();
  await expect(page.getByRole("alert")).toContainText("测试检查失败");
  await expect(icon).toHaveAttribute("data-busy", "false");
});
