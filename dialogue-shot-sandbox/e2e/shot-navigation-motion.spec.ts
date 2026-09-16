import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { demoDatabase } from "../src/data/demo";
import { findDialogueSequence } from "../src/data/dialogueRepository";
import { createShotPlan } from "../src/director/shotPlanner";

const shots = createShotPlan(findDialogueSequence(demoDatabase, "2048"));

for (const scale of [1, 1.5, 2]) {
  test.describe(`shot navigation at ${scale * 100}% pixel density`, () => {
    test.use({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: scale });

    test("keeps rapid selections readable and keyboard/reduced motion immediate", async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      const externalOperations: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // Isolate every backend request: no live UE, AI, Feishu or local business data.
      await page.route("**/api/**", (route) => {
        if (route.request().method() === "POST") {
          externalOperations.push(new URL(route.request().url()).pathname);
        }
        return route.fulfill({ status: 503, json: { ok: false } });
      });
      await page.addInitScript(() => {
        sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
      });
      await page.goto("/");
      const rows = page.locator(".shot-row");
      const selection = page.locator(".shot-list__selection");
      await expect(rows).toHaveCount(shots.length);
      await page.getByRole("tab", { name: "镜头", exact: true }).click();
      const initialOperations = externalOperations.length;
      const canvasBefore = await page.locator(".stage-main__frame canvas").elementHandle();
      const frameBefore = await page.locator(".stage-main__frame").boundingBox();
      const stageBefore = await page.locator(".stage-main").boundingBox();
      const positions = [];
      for (let index = 0; index < shots.length; index++) {
        positions.push((await rows.nth(index).boundingBox())!);
      }

      // Raw pointer events do not wait for the previous CSS transition to finish.
      for (const index of [1, 2, 0, 3, 1, 0, 2, 3, 0, 2]) {
        const box = positions[index];
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        const state = await page.evaluate(() => {
          const selected = document.querySelector<HTMLElement>(".shot-row.is-active")!;
          const panel = document.querySelector<HTMLElement>("#shot-inspector-panel")!;
          return {
            label: selected.querySelector("strong")!.textContent,
            shotNumber: document.querySelector(".stage-sequence strong")!.textContent,
            pressed: selected.getAttribute("aria-pressed"),
            foreground: getComputedStyle(selected).color,
            background: getComputedStyle(selected).backgroundColor,
            selectionTransition: getComputedStyle(selected).transitionDuration,
            panelAnimation: getComputedStyle(panel).animationName,
            panelOpacity: getComputedStyle(panel).opacity,
            panelClip: getComputedStyle(panel).clipPath,
            curtains: document.querySelectorAll(".stage-transition").length,
          };
        });
        expect(state).toMatchObject({
          label: shots[index].label,
          shotNumber: String(index + 1).padStart(2, "0"),
          pressed: "true",
          foreground: "rgb(255, 255, 255)",
          background: "rgb(25, 25, 25)",
          selectionTransition: "0s",
          panelAnimation: "none",
          panelOpacity: "1",
          panelClip: "none",
          curtains: 0,
        });
        await expect(page.locator(".inspector-header")).toContainText(shots[index].label);
        const projection = shots[index].projection;
        await expect(page.locator(".inspector-tab-panel dt")
          .filter({ hasText: "视线前/后" }).locator("..").locator("dd"))
          .toHaveText(projection.lookRoom === null || projection.backRoom === null
            ? "不适用"
            : `${projection.lookRoom.toFixed(2)} / ${projection.backRoom.toFixed(2)}`);
      }
      await expect(page.getByRole("tab", { name: "镜头", exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expect(selection).toHaveCSS("transition-duration", "0.16s");
      expect(await canvasBefore!.evaluate((element) => element ===
        document.querySelector(".stage-main__frame canvas"))).toBe(true);
      expect(externalOperations.length).toBe(initialOperations);

      // Native Enter and Space activation must both skip marker travel.
      await rows.nth(0).focus();
      await page.keyboard.press("Enter");
      await expect(rows.nth(0)).toHaveAttribute("aria-pressed", "true");
      await expect(selection).toHaveCSS("transition-duration", "0s");
      await expect(selection).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Space");
      await expect(rows.nth(1)).toBeFocused();
      await expect(rows.nth(1)).toHaveAttribute("aria-pressed", "true");
      await expect(selection).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 62)");
      const next = page.getByRole("button", { name: "下一个镜头", exact: true });
      await next.focus();
      await page.keyboard.down("Space");
      await expect(next).toHaveCSS("transform", "none");
      await page.keyboard.up("Space");
      await expect(rows.nth(2)).toHaveAttribute("aria-pressed", "true");
      await expect(selection).toHaveCSS("transition-duration", "0s");

      // Every inspector page is readable immediately, including returning audio.
      for (const name of ["导演", "音频", "UE", "镜头"]) {
        await page.getByRole("tab", { name, exact: true }).focus();
        await page.keyboard.press("Enter");
        const panel = page.locator(".inspector-tab-panel:visible");
        await expect(panel).toHaveCSS("animation-name", "none");
        await expect(panel).toHaveCSS("opacity", "1");
      }

      // Change the preference while a pointer transition is still in flight.
      await page.mouse.click(positions[0].x + 100, positions[0].y + 25);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await rows.nth(3).click();
      await expect(selection).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 186)");
      expect(await selection.evaluate((element) => element.getAnimations()
        .filter((animation) => animation.playState === "running").length)).toBe(0);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await rows.nth(2).click();
      await expect(selection).toHaveCSS("transition-duration", "0.16s");

      for (const name of ["切换到俯视调度", "切换到镜头示意"]) {
        await page.getByRole("button", { name }).click();
        await expect(page.locator(".stage-transition")).toHaveCount(0);
        const frame = await page.locator(".stage-main__frame").boundingBox();
        // The existing blocking view fills the stage; the shot frame stays 16:9.
        const expectedFrame = name === "切换到俯视调度" ? stageBefore : frameBefore;
        expect(frame!.width).toBeCloseTo(expectedFrame!.width, 0);
        expect(frame!.height).toBeCloseTo(expectedFrame!.height, 0);
        // Switching projection mounts a new Canvas; wait for its rendered content,
        // not a fixed animation delay or only the presence of the canvas element.
        await expect.poll(async () => {
          const png = PNG.sync.read(await page.locator(".stage-main__frame canvas").screenshot());
          const colors = new Set<number>();
          for (let offset = 0; offset < png.data.length; offset += 64) {
            colors.add((png.data[offset] << 16) | (png.data[offset + 1] << 8) | png.data[offset + 2]);
          }
          return colors.size;
        }, { timeout: 3000 }).toBeGreaterThan(18);
      }
      expect(await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`navigation-${scale}.png`) });
    });
  });
}
