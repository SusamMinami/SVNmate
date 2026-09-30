import { expect, test, type Page, type Route } from "@playwright/test";
import { PNG } from "pngjs";
import { setReducedMotion } from "./motionPreference";

async function isolate(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { ok: false } }));
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  return errors;
}

async function animations(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => el.getAnimations({ subtree: true }).length);
}

async function hidden(page: Page, value: boolean) {
  await page.evaluate((next) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: next });
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}

const source = {
  sourceProjectFile: "D:/Art/Art.uproject", sourceContentDirectory: "D:/Art/Content",
  skeletalMeshName: "SK_N28", skeletalMeshAssetPath: "/Game/N28.SK_N28",
  skeletalMeshPackageName: "/Game/N28", skeletonAssetPath: "", physicsAssetPath: "",
  materialAssetPaths: [], dependencyPackageNames: ["/Game/N28"], sourceFiles: [],
  dirtyPackageNames: [], suggestedNpcName: "N28", suggestedTargetPackagePath: "/Game/N28", warnings: [],
};

for (const density of [1, 1.5, 2]) {
  test.describe(`other task feedback at ${density * 100}% density`, () => {
    test.use({ deviceScaleFactor: density });
    test("NPC wait pauses in background, retries and keeps a neutral ready result", async ({ page }, info) => {
      const errors = await isolate(page);
      let pending: Route | undefined;
      let calls = 0;
      await page.route("**/api/ue/npc-migration/source-scan", (route) => { pending = route; calls++; });
      await page.goto("/");
      await page.getByRole("button", { name: "NPC 迁移", exact: true }).click();
      await page.getByRole("button", { name: /全新 NPC/ }).click();
      const read = page.getByRole("button", { name: "读取源资产" });
      const glyph = page.locator(".npc-migration-workspace .task-glyph");
      await read.click();
      await expect(glyph).toHaveAttribute("data-phase", "running");
      await expect.poll(() => animations(page, ".task-notice")).toBeGreaterThan(0);
      await page.mouse.move(800, 450);
      await expect(page.locator('[data-workspace-state="exiting"]')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`npc-running-${density}.png`) });
      await page.getByRole("button", { name: "分镜工作台", exact: true }).click();
      await expect(glyph).toHaveAttribute("data-running", "false");
      expect(await animations(page, ".task-notice")).toBe(0);
      await expect.poll(() => Boolean(pending)).toBe(true);
      await pending!.fulfill({ status: 400, json: { ok: false, error: { message: "请选择源 Skeletal Mesh" } } });
      pending = undefined;
      await page.getByRole("button", { name: "NPC 迁移", exact: true }).click();
      await expect(glyph).toHaveAttribute("data-phase", "failed");
      await expect(page.getByRole("alert")).toContainText("请选择源");
      expect(await animations(page, ".task-notice")).toBe(0);
      await read.focus();
      await page.keyboard.press("Enter");
      await expect(glyph).toHaveAttribute("data-phase", "running");
      await hidden(page, true);
      await expect(glyph).toHaveAttribute("data-running", "false");
      await hidden(page, false);
      await setReducedMotion(page, true);
      await expect(glyph).toHaveAttribute("data-running", "false");
      await expect.poll(() => Boolean(pending)).toBe(true);
      await pending!.fulfill({ json: { ok: true, data: source } });
      await expect(glyph).toHaveAttribute("data-phase", "ready");
      expect(await animations(page, ".task-notice")).toBe(0);
      expect(calls).toBe(2);
      await page.screenshot({ path: info.outputPath(`npc-ready-${density}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(errors).toEqual([]);
    });
  });
}

test("director node wait pauses, keeps the scene and cancels without replay", async ({ page }, info) => {
  const errors = await isolate(page);
  let pending: Route | undefined;
  let cancelCalls = 0;
  await page.route("**/api/director/trae", (route) => { pending = route; });
  await page.route("**/api/trae/tasks/cancel", (route) => {
    cancelCalls++;
    return route.fulfill({ json: { ok: true, data: {
      requestId: route.request().postDataJSON().request_id, status: "cancelled",
    } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "TRAE 协作", exact: true }).click();
  const glyph = page.locator(".director-loading .task-glyph");
  await expect(glyph).toHaveAttribute("data-variant", "nodes");
  await expect.poll(() => animations(page, ".director-loading")).toBeGreaterThan(0);
  const samples = await glyph.evaluate((el) => {
    const animation = el.getAnimations({ subtree: true })[0];
    animation.pause();
    animation.currentTime = 300;
    const first = getComputedStyle(el.querySelector(".task-glyph__symbol")!).opacity;
    animation.currentTime = 950;
    const second = getComputedStyle(el.querySelector(".task-glyph__symbol")!).opacity;
    animation.play();
    return [first, second];
  });
  expect(samples[0]).not.toBe(samples[1]);
  await expect(page.locator(".stage-main__frame canvas")).toBeVisible();
  expect(await page.locator(".stage-main__frame canvas").evaluate((canvas: HTMLCanvasElement) =>
    canvas.width > 0 && canvas.height > 0)).toBe(true);
  await expect.poll(async () => {
    const png = PNG.sync.read(await page.locator(".stage-main__frame canvas").screenshot());
    const colors = new Set<number>();
    for (let offset = 0; offset < png.data.length; offset += 64) {
      colors.add((png.data[offset] << 16) | (png.data[offset + 1] << 8) | png.data[offset + 2]);
    }
    return colors.size;
  }).toBeGreaterThan(18);
  await page.screenshot({ path: info.outputPath("director-nodes-running.png") });
  await page.getByRole("button", { name: "NPC 迁移", exact: true }).click();
  await expect(glyph).toHaveAttribute("data-running", "false");
  await page.getByRole("button", { name: "分镜工作台", exact: true }).click();
  await setReducedMotion(page, true);
  await expect(glyph).toHaveAttribute("data-running", "false");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "中断分析", exact: true }).click();
  await expect(glyph).toHaveCount(0);
  expect(cancelCalls).toBe(1);
  await expect.poll(() => Boolean(pending)).toBe(true);
  await pending!.fulfill({ status: 503, json: { ok: false, error: {
    code: "TRAE_TASK_CANCELLED", message: "用户中断了分析",
  } } });
  await expect(page.locator(".director-loading")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Real export hook + modal, isolated from formation/asset setup. Every API is intercepted.
async function exportFixture(page: Page) {
  const errors = await isolate(page);
  await page.route("**/__export-motion", (route) => route.fulfill({
    contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8">
      <link rel="stylesheet" href="/src/styles.css"></head><body><div id="fixture" class="app-shell" data-ark-theme="endfield"></div>
      <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { useStoryboardExport } = await import('/src/app/useStoryboardExport.ts');
      const { StoryboardExportModal } = await import('/src/components/StoryboardExportModal.tsx');
      const options = { sequence: { prefix: '2048', startId: '204800', participants: [] },
        shots: [], characterActions: [], viewLines: [], musicRecommendations: [],
        soundEffects: [{ dialogueId: '204801', assetName: 'A_SFX_Test' }] };
      function Fixture() {
        const controller = useStoryboardExport(options);
        window.exportPreview = controller.preview;
        return React.createElement(React.Fragment, null,
          React.createElement('button', { onClick: () => controller.previewCurrentNodeAudio(['204801']) }, '打开导出'),
          controller.preview && React.createElement(StoryboardExportModal, {
            ...controller, onClose: controller.close, onShowAll: controller.previewAll,
            onRefresh: controller.refresh, onConfirm: controller.confirm }));
      }
      createRoot(document.getElementById('fixture')).render(React.createElement(Fixture));
      </script></body></html>`,
  }));
  await page.goto("/__export-motion");
  await expect.poll(async () => ({
    buttons: await page.getByRole("button", { name: "打开导出" }).count(), errors,
  })).toEqual({ buttons: 1, errors: [] });
  await page.getByRole("button", { name: "打开导出" }).click();
  return errors;
}

test("export has one waiting glyph and separates inspection failure, uncertain write and saved result", async ({ page }, info) => {
  const errors = await exportFixture(page);
  const pending = new Map<string, Route>();
  let writes = 0;
  await page.route("**/api/ue/storyboard/*", (route) => {
    const action = route.request().url().split("/").at(-1)!;
    pending.set(action, route);
    if (action === "export") writes++;
  });
  const take = async (action: string) => {
    await expect.poll(() => pending.has(action)).toBe(true);
    const route = pending.get(action)!;
    pending.delete(action);
    return route;
  };
  const glyph = page.locator(".storyboard-export-modal footer .task-glyph");
  const icon = page.locator(".storyboard-export-modal footer .operation-icon");
  await page.getByRole("button", { name: "检查所选内容" }).click();
  await expect(icon).toHaveAttribute("data-running", "true");
  await expect(icon).toHaveAttribute("data-kind", "search");
  await expect.poll(() => animations(page, ".storyboard-export-modal")).toBe(1);
  await (await take("inspect")).fulfill({ status: 400, json: { ok: false, error: { message: "UE 未连接" } } });
  await expect(glyph).toHaveAttribute("data-phase", "failed");
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "检查所选内容" }).click();
  const preview = await page.evaluate(() => (window as unknown as { exportPreview: object }).exportPreview);
  await (await take("inspect")).fulfill({ json: { ok: true, data: {
    ...preview, reviewToken: "review-token", dialogueAssetPath: "/Game/Dialog_2048",
  } } });
  await expect(icon).toHaveAttribute("data-busy", "false");
  const confirm = page.getByRole("button", { name: "确认写入并保存" });
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox", { name: /已核对/ }).check();
  await confirm.click();
  await expect(icon).toHaveAttribute("data-running", "true");
  await expect(icon).toHaveAttribute("data-kind", "write");
  await expect(page.getByRole("button", { name: "关闭导出预检" })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("export-writing.png") });
  await hidden(page, true);
  await expect(icon).toHaveAttribute("data-running", "false");
  await hidden(page, false);
  await (await take("export")).fulfill({ status: 500, json: { ok: false, error: { message: "写入连接中断" } } });
  await expect(glyph).toHaveAttribute("data-phase", "uncertain");
  await expect(page.getByRole("alert")).toContainText("核对 UE 资产");
  await expect(glyph).toHaveAttribute("data-running", "false");
  expect(await glyph.evaluate((el) => el.getAnimations({ subtree: true })
    .filter((animation) => !(animation instanceof CSSTransition)).length)).toBe(0);
  await page.getByRole("button", { name: "重新检查 UE" }).click();
  await (await take("inspect")).fulfill({ json: { ok: true, data: { ...preview, reviewToken: "fresh-token" } } });
  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox", { name: /已核对/ }).check();
  await setReducedMotion(page, true);
  await confirm.focus();
  await page.keyboard.press("Enter");
  await (await take("export")).fulfill({ json: { ok: true, data: {
    status: "exported", changedNodeCount: 0, changedSoundEffectCount: 1,
  } } });
  await expect(glyph).toHaveAttribute("data-phase", "success");
  await expect(page.getByText(/已写入.*并保存/)).toBeVisible();
  expect(await glyph.evaluate((el) => el.getAnimations({ subtree: true })
    .filter((animation) => !(animation instanceof CSSTransition)).length)).toBe(0);
  expect(writes).toBe(2);
  expect(errors).toEqual([]);
});
