import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { ok: false } }),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
  });
});

test("draws the real storyboard module boundaries without moving content", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?motion=full");

  const workspace = page.locator(
    '[data-workspace-id="storyboard"]',
  );
  const reveal = workspace.locator(".workspace-frame-reveal");
  const topLine = reveal.locator('[data-line="top"]');
  await expect(reveal).toHaveAttribute("data-active", "true");
  await expect(reveal.locator(".workspace-frame-reveal__line")).toHaveCount(5);
  await expect(page.locator(".ambient-state-field")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  await expect
    .poll(() =>
      reveal.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    )
    .toBeGreaterThan(0);

  const before = await Promise.all([
    workspace.locator(".left-panel").boundingBox(),
    workspace.locator(".viewport-panel").boundingBox(),
    workspace.locator(".right-panel").boundingBox(),
  ]);
  const lineStates = await topLine.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) {
      return null;
    }
    animation.pause();
    animation.currentTime = 0;
    const start = getComputedStyle(element).transform;
    animation.currentTime = 400;
    const end = getComputedStyle(element).transform;
    animation.play();
    return { start, end };
  });
  expect(lineStates).not.toBeNull();
  expect(lineStates!.start).not.toBe(lineStates!.end);

  await page.waitForTimeout(420);
  await workspace.screenshot({
    path: testInfo.outputPath("workspace-frame-reveal.png"),
  });
  await page.waitForTimeout(600);
  await expect(reveal).toHaveCSS("opacity", "0");
  const after = await Promise.all([
    workspace.locator(".left-panel").boundingBox(),
    workspace.locator(".viewport-panel").boundingBox(),
    workspace.locator(".right-panel").boundingBox(),
  ]);
  expect(after).toEqual(before);

  await page.getByRole("button", { name: "注册 NPC", exact: true }).click();
  await expect(reveal).toHaveAttribute("data-active", "false");
  await page.getByRole("button", {
    name: "分镜工作台",
    exact: true,
  }).click();
  await expect(reveal).toHaveAttribute("data-active", "true");
  await expect
    .poll(() =>
      reveal.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    )
    .toBeGreaterThan(0);
});

test("keeps the workspace immediately readable with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const workspace = page.locator(
    '[data-workspace-id="storyboard"]',
  );
  const reveal = workspace.locator(".workspace-frame-reveal");
  await expect(workspace.locator(".stage-view")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await expect(reveal).toHaveAttribute("data-active", "false");
  await expect(reveal).toHaveCSS("opacity", "0");
  await expect
    .poll(() =>
      workspace.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    )
    .toBe(0);
});
