import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import Papa from "papaparse";
import { PNG } from "pngjs";

test("shows multiline node text without shrinking the shot image", async ({ page }, testInfo) => {
  const text = [
    "这是当前节点的完整对白，原始段落需要保留。",
    "这里是一段较长的对白，用于检查文本换行和完整阅读，不应挤压上方镜头画面。".repeat(12),
    "最后一行也必须可以滚动阅读。",
  ].join("\n");
  await page.route("**/api/**", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false }),
  }));
  await page.route("**/api/ue/formation/read", (route) => route.fulfill({
    json: { ok: true, data: { status: "not_found", message: "No fixture BP" } },
  }));
  await page.route("**/api/ue/dialogue/storyboard/read", (route) => route.fulfill({
    json: {
      ok: true,
      data: { status: "empty", dialogueAssetPath: "/Game/Test/735200", nodes: [], configurations: [], warnings: [] },
    },
  }));
  await page.addInitScript(() => {
    sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
  });
  const directory = testInfo.outputPath("csvdir");
  await mkdir(directory, { recursive: true });
  const files = {
    "对话表.csv": [
      ["##&Dialog.id", "Dialog.NPCID", "Dialog.Content", "Dialog.NextID", "Dialog.End"],
      ["##id", "NPC", "Content", "Next", "End"],
      ["735200", "", "", "735201", "false"],
      ["735201", "1", text, "735202", "false"],
      ["735202", "2", "下一节点的短对白。", "", "true"],
    ],
    "对话表_开始节点.csv": [
      ["##&DialogStart.id", "DialogStart.Outline"],
      ["##id", "Outline"],
      ["735200", "布局验证"],
    ],
    "NPC表.csv": [
      ["##&NPC.id", "NPC.name", "NPC.npcintroduce"],
      ["##id", "Name", "Intro"],
      ["1", "玩家", "玩家"],
      ["2", "守卫", "守卫"],
    ],
  };
  for (const [name, rows] of Object.entries(files)) {
    await writeFile(`${directory}/${name}`, Papa.unparse(rows), "utf8");
  }
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(directory);
  await page.getByLabel("四位数对话 ID 或对白内容").fill("7352");
  await page.getByRole("button", { name: "加载对白内容" }).click();
  await page.getByRole("button", { name: "规则导演" }).click();
  const content = page.getByRole("region", { name: "当前节点对白" });
  await expect(content.locator("p")).toHaveText(text);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1360, height: 900 },
    { width: 1080, height: 700 },
    { width: 1920, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(650);
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector(".viewport-panel")!.getBoundingClientRect();
      const toolbar = document.querySelector(".viewport-toolbar")!.getBoundingClientRect();
      const frame = document.querySelector(".stage-main__frame")!.getBoundingClientRect();
      const strip = document.querySelector(".dialogue-strip")!.getBoundingClientRect();
      const content = document.querySelector(".dialogue-strip__content")!;
      const originalFrameHeight = Math.min((panel.width * 9) / 16, panel.height - toolbar.height - 76);
      return {
        originalFrameHeight, frameHeight: frame.height,
        stripHeight: strip.height,
        noOverlap: frame.bottom <= strip.top,
        noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
        scrollable: content.scrollHeight > content.clientHeight,
        whiteSpace: getComputedStyle(content.querySelector("p")!).whiteSpace,
      };
    });
    expect(metrics.frameHeight).toBeCloseTo(metrics.originalFrameHeight, 0);
    expect(metrics.stripHeight).toBeGreaterThanOrEqual(76);
    expect(metrics.stripHeight).toBeLessThanOrEqual(132);
    if (viewport.width <= 1440) expect(metrics.stripHeight).toBe(132);
    expect(metrics.noOverlap).toBe(true);
    expect(metrics.noPageOverflow).toBe(true);
    expect(metrics.scrollable).toBe(true);
    expect(metrics.whiteSpace).toBe("pre-wrap");
    await page.screenshot({ path: testInfo.outputPath(`dialogue-strip-${viewport.width}.png`) });
  }

  const canvas = PNG.sync.read(await page.locator(".stage-main__frame canvas").screenshot());
  const colors = new Set<number>();
  for (let index = 0; index < canvas.data.length; index += 64) {
    colors.add((canvas.data[index] << 16) | (canvas.data[index + 1] << 8) | canvas.data[index + 2]);
  }
  expect(colors.size).toBeGreaterThan(10);
  await content.focus();
  await page.keyboard.press("End");
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const frameBeforeEdit = await page.locator(".stage-main__frame").boundingBox();
  await page.getByRole("button", { name: "编辑当前对白" }).click();
  const editor = page.getByLabel("编辑节点 735201 的对白");
  await expect(editor).toHaveValue(text);
  await page.keyboard.press("Escape");
  await expect(content.locator("p")).toHaveText(text);
  const frameAfterEdit = await page.locator(".stage-main__frame").boundingBox();
  expect(frameAfterEdit!.height).toBeCloseTo(frameBeforeEdit!.height, 0);
});
