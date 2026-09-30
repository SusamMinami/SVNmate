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
  await page.goto("/");

  const workspace = page.locator(
    '[data-workspace-id="storyboard"]',
  );
  const leftPanel = workspace.locator(".left-panel");
  await expect(workspace).toHaveAttribute("data-frame-phase", "pending");
  await expect(page.locator(".workspace-frame-reveal")).toHaveCount(0);
  await expect(page.locator(".ambient-state-field")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "false",
  );
  await expect(leftPanel).toHaveCSS(
    "border-right-color",
    "rgba(0, 0, 0, 0)",
  );

  const pendingDivider = await leftPanel.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return {
      color: style.backgroundColor,
      transform: style.transform,
    };
  });
  await expect(workspace).toHaveAttribute(
    "data-frame-phase",
    "revealing",
  );
  await expect
    .poll(() =>
      workspace.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    )
    .toBeGreaterThan(0);

  const before = await Promise.all([
    workspace.locator(".left-panel").boundingBox(),
    workspace.locator(".viewport-panel").boundingBox(),
    workspace.locator(".right-panel").boundingBox(),
  ]);
  await page.waitForTimeout(280);
  await workspace.screenshot({
    path: testInfo.outputPath("workspace-frame-reveal.png"),
  });
  await expect(workspace).toHaveAttribute(
    "data-frame-phase",
    "settled",
  );
  const settledDivider = await leftPanel.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return {
      color: style.backgroundColor,
      transform: style.transform,
    };
  });
  expect(settledDivider.transform).not.toBe(pendingDivider.transform);
  expect(settledDivider.color).toBe(pendingDivider.color);
  const after = await Promise.all([
    leftPanel.boundingBox(),
    workspace.locator(".viewport-panel").boundingBox(),
    workspace.locator(".right-panel").boundingBox(),
  ]);
  expect(after).toEqual(before);

  await page.getByRole("button", { name: "注册 NPC", exact: true }).click();
  await expect(workspace).toHaveAttribute("data-frame-phase", "idle");
  await page.getByRole("button", {
    name: "分镜工作台",
    exact: true,
  }).click();
  await expect(workspace).toHaveAttribute(
    "data-frame-phase",
    "revealing",
  );
});

test("keeps the workspace immediately readable with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?motion=reduced");

  const workspace = page.locator(
    '[data-workspace-id="storyboard"]',
  );
  const leftPanel = workspace.locator(".left-panel");
  await expect(workspace.locator(".stage-view")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await expect(workspace).toHaveAttribute(
    "data-frame-phase",
    "settled",
  );
  await expect(leftPanel).toHaveCSS(
    "border-right-color",
    "rgba(0, 0, 0, 0)",
  );
  expect(
    await leftPanel.evaluate(
      (element) => getComputedStyle(element, "::after").transform,
    ),
  ).not.toContain("matrix(1, 0, 0, 0");
  await expect
    .poll(() =>
      workspace.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
    )
    .toBe(0);
});
