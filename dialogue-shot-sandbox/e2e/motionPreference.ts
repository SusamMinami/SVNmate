import type { Page } from "@playwright/test";

export async function setReducedMotion(
  page: Page,
  enabled: boolean,
): Promise<void> {
  await page.evaluate((next) => {
    window.localStorage.setItem(
      "shot-sandbox.reduced-motion.v1",
      String(next),
    );
    document.documentElement.dataset.reducedMotion = String(next);
    window.dispatchEvent(new Event("shot-sandbox:reduced-motion"));
  }, enabled);
}
