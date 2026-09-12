import { expect, test, type Page } from "@playwright/test";

const storageKey = "shot-sandbox.settings-status-intro.v1";

async function openSettings(page: Page, options: {
  slowModel?: boolean;
  failedLark?: boolean;
  blockedStorage?: boolean;
} = {}) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(({ blockedStorage }) => {
    if (blockedStorage) {
      Storage.prototype.getItem = () => { throw new Error("Storage blocked"); };
      Storage.prototype.setItem = () => { throw new Error("Storage blocked"); };
    }
  }, options);
  // Render the production modal without contacting UE, Lark or local model services.
  await page.route("**/settings-status-fixture", (route) => route.fulfill({
    contentType: "text/html",
    body: `<html><head><meta charset="utf-8"></head><body><div id="root"></div>
      <script type="module">
        import RefreshRuntime from "/@react-refresh";
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const { createElement: h, useState } = (await import("/node_modules/.vite/deps/react.js")).default;
        const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
        const { DesktopSetupModal } = await import("/src/components/DesktopSetupModal.tsx");
        await import("/src/styles.css");
        const status = {
          firstRun: false, setupCompleted: true, version: "test",
          runtimeBundled: true, traeDetected: true, integrationInstalled: true,
          integrationRoot: "Test/trae-integration", mcpConnected: false,
          expectedMcpVersion: "test", defaultDataReady: true,
          liveDataReady: true, configDataReady: true,
          liveResDirectory: "Test/res", configDocDirectory: "Test/doc",
          npcAnimationDirectories: [], ueConnected: false,
          ueMcpHost: "127.0.0.1", ueMcpPort: 12031
        };
        let onModelState = () => {};
        const model = {
          state: "ready", model: "test-model", runtimeAvailable: true,
          serviceAvailable: true, modelInstalled: true, message: "Model ready"
        };
        window.shotSandboxDesktop = {
          getUpdateSnapshot: async () => ({state: "current"}),
          onUpdateState: () => () => {},
          getAdvisorModelStatus: () => ${options.slowModel ? "new Promise(() => {})" : "Promise.resolve(model)"},
          onAdvisorModelState: (callback) => { onModelState = callback; return () => {}; },
          setUeMcpPort: async () => { onModelState(model); return status; }
        };
        function Fixture() {
          const [open, setOpen] = useState(true);
          return open ? h(DesktopSetupModal, {
            initialStatus: status, onClose: () => setOpen(false),
            onRefreshTrae: () => {}, larkLoading: false,
            larkStatus: { authorized: true, baseMissingScopes: [], docsMissingScopes: [] },
            larkError: ${JSON.stringify(options.failedLark ? "Connection failed" : "")},
            soundEffectCatalog: {entries: [{}], source: "bundled", revisionId: 1},
            musicCatalog: {entries: [], revision: 0},
            dataLoading: false, dataError: "",
            onChooseLiveDirectory: () => {}, onChooseConfigDirectory: () => {},
            onAuthorize: () => {}, onRefreshLark: () => {},
            onSyncSoundEffectCatalog: async () => { throw new Error("Sync failed"); },
            onSyncMusicCatalog: async () => ({entries: [{}], revision: 1})
          }) : h("button", {onClick: () => setOpen(true)}, "Reopen");
        }
        createRoot(document.getElementById("root")).render(
          h("div", {className: "app-shell", "data-ark-theme": "endfield"}, h(Fixture))
        );
      </script></body></html>`,
  }));
  await page.goto("/settings-status-fixture");
  await expect(page.getByRole("dialog")).toBeVisible().catch((error) => {
    throw new Error(`${error.message}\n${pageErrors.join("\n")}`);
  });
}

test("reveals settings once in reading order without moving rows", async ({ page }, testInfo) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await openSettings(page);
  const list = page.getByRole("region", { name: "环境检查" });
  await expect(list).toHaveAttribute("data-status-intro", "true");
  await expect(list.locator(".setup-status-icon")).toHaveCount(11);
  const before = await list.boundingBox();
  const animation = await list.locator(".setup-status-icon__result").evaluateAll((nodes) =>
    nodes.map((node) => ({
      name: getComputedStyle(node).animationName,
      delay: parseFloat(getComputedStyle(node).animationDelay),
    })),
  );
  expect(animation.every((item) => item.name === "setup-status-reveal")).toBe(true);
  expect(animation.map((item) => item.delay)).toEqual(
    [...animation.map((item) => item.delay)].sort((a, b) => a - b),
  );
  await list.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 0;
    }
  });
  await expect(list.locator(".setup-status-icon__result").first()).toHaveCSS("opacity", "0");
  await page.getByRole("dialog").screenshot({ path: testInfo.outputPath("settings-pending.png") });
  await list.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      animation.currentTime = 650;
    }
  });
  await expect(list.locator(".setup-status-icon__result").first()).toHaveCSS("opacity", "1");
  await expect(list.locator(".setup-status-icon__result").last()).toHaveCSS("opacity", "0");
  await page.getByRole("dialog").screenshot({ path: testInfo.outputPath("settings-revealing.png") });
  await page.clock.runFor(1400);
  await expect(list).toHaveAttribute("data-status-intro", "false");
  await expect(list.locator(".setup-status-icon__result").first()).toHaveCSS("opacity", "1");
  expect(await list.boundingBox()).toEqual(before);
  await expect(page.getByRole("img", { name: "应用运行时：已就绪", exact: true }))
    .toHaveAttribute("data-state", "ready");
  await expect(page.getByRole("img", { name: "NPC 动作库：待配置", exact: true }))
    .toHaveAttribute("data-state", "warning");
  await expect(page.getByRole("img", { name: "音乐资料库：待同步", exact: true }))
    .toHaveAttribute("data-state", "warning");
  await page.getByRole("dialog").screenshot({ path: testInfo.outputPath("settings-ready.png") });
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe("seen");
  await page.getByRole("button", { name: "关闭桌面版设置" }).click();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(list).toHaveAttribute("data-status-intro", "false");
  await page.reload();
  await expect(list).toHaveAttribute("data-status-intro", "false");
});

test("keeps slow checks and errors truthful and allows immediate interaction", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await openSettings(page, { slowModel: true, failedLark: true });
  const list = page.getByRole("region", { name: "环境检查" });
  const model = page.getByRole("img", { name: "端侧导演模型：处理中", exact: true });
  const lark = page.getByRole("img", { name: "飞书数据：异常", exact: true });
  await expect(lark).toHaveAttribute("data-state", "error");
  await expect(lark.locator(".setup-status-icon__result")).toHaveCSS("opacity", "1");
  await page.clock.runFor(1400);
  await expect(model).toHaveAttribute("data-state", "loading");
  await page.getByRole("button", { name: "检测", exact: true }).click();
  await expect(page.getByRole("img", { name: "端侧导演模型：已就绪", exact: true }))
    .toHaveAttribute("data-state", "ready");
  await page.getByRole("button", { name: "从飞书同步音效资料库" }).click();
  await expect(page.getByRole("img", { name: "音效资料库：异常", exact: true }))
    .toHaveAttribute("data-state", "error");
  await expect(list).toContainText("Sync failed");
});

test("keyboard interaction skips the intro and exposes status without color", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await openSettings(page);
  const icon = page.getByRole("img", { name: "应用运行时：已就绪", exact: true });
  await icon.focus();
  await expect(icon).toBeFocused();
  expect(await icon.evaluate((node) => getComputedStyle(node, "::after").visibility)).toBe("visible");
  await icon.press("Tab");
  await expect(page.getByRole("region", { name: "环境检查" }))
    .toHaveAttribute("data-status-intro", "false");
});

test("respects reduced motion and desktop scaling", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    await openSettings(page, { slowModel: true });
    await expect(page.getByRole("region", { name: "环境检查" }))
      .toHaveAttribute("data-status-intro", "false");
    await expect(page.locator(".setup-status-icon__result").first()).toHaveCSS("animation-name", "none");
    await expect(page.locator(".setup-status-icon .spin")).toHaveCSS("animation-name", "none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("dialog").screenshot({ path: testInfo.outputPath("settings-150-percent.png") });
  } finally {
    await context.close();
  }
});

test("handles blocked storage and early close without replaying", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await openSettings(page, { blockedStorage: true });
  await page.getByRole("button", { name: "关闭桌面版设置" }).click();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("region", { name: "环境检查" }))
    .toHaveAttribute("data-status-intro", "false");
});
