import { expect, test } from "@playwright/test";

test("keeps the boot surface dark before launch motion reveals the workspace", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  let releaseMain!: () => void;
  const mainGate = new Promise<void>((resolve) => {
    releaseMain = resolve;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { ok: false } }),
  );
  await page.route("**/src/main.tsx", async (route) => {
    await mainGate;
    await route.continue();
  });

  await page.goto("/", { waitUntil: "commit" });
  await page.waitForSelector("#root", { state: "attached" });
  const bootColors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    root: getComputedStyle(document.querySelector("#root")!).backgroundColor,
  }));
  expect(bootColors).toEqual({
    body: "rgb(23, 24, 22)",
    root: "rgb(23, 24, 22)",
  });
  await page.screenshot({ path: testInfo.outputPath("boot-surface.png") });

  releaseMain();
  await page.waitForLoadState("load");
  const launchScreen = page.locator(".launch-screen");
  await expect(launchScreen).toBeVisible();
  const launchStyle = await launchScreen.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      opacity: style.opacity,
    };
  });
  expect(launchStyle).toEqual({
    backgroundColor: "rgb(23, 24, 22)",
    opacity: "1",
  });
  await page.screenshot({ path: testInfo.outputPath("launch-motion.png") });

  await expect(launchScreen).toHaveCount(0, { timeout: 3_000 });
  await expect(page.locator(".app-shell")).toHaveCSS(
    "background-color",
    "rgb(217, 218, 214)",
  );
  expect(errors).toEqual([]);
});
