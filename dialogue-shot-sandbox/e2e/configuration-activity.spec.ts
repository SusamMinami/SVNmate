import { expect, test, type Page, type Route } from "@playwright/test";

test("unchanged selection polling only updates the local status indicator", async ({ page }, info) => {
  await page.addInitScript(() => {
    (window as any).appCommits = 0;
    (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberUnmount: () => {},
      onCommitFiberRoot: (_id: number, root: any) => {
        const visit = (fiber: any) => {
          if (!fiber) return;
          if (fiber.type?.name === "App" && (fiber.flags & 1)) (window as any).appCommits++;
          visit(fiber.child);
          visit(fiber.sibling);
        };
        visit(root.current);
      },
    };
  });
  const { selectionCount, errors } = await fixture(page);
  await activity(page, "dialogue");
  await expect(page.getByRole("button", { name: "修改当前镜头" })).toContainText("FOV 62");
  await page.waitForTimeout(1_400);
  const before = await page.evaluate(() => (window as any).appCommits);
  const reads = selectionCount();
  await page.waitForTimeout(3_800);
  const result = {
    selectionReads: selectionCount() - reads,
    appCommits: await page.evaluate(() => (window as any).appCommits) - before,
  };
  await info.attach("polling-render-counts", { body: JSON.stringify(result), contentType: "application/json" });
  console.log("polling-render-counts", result);
  expect(result.selectionReads).toBeGreaterThanOrEqual(3);
  if (!process.env.PERFORMANCE_BASELINE) expect(result.appCommits).toBe(0);
  expect(errors).toEqual([]);
});

async function activity(page: Page, state: "dialogue" | "other" | "unknown") {
  await page.evaluate((next) => (window as any).testActivity(next), state);
}

async function fixture(page: Page) {
  const errors: string[] = [];
  const requests: string[] = [];
  const state = { node: "204801", hold: false, pending: undefined as Route | undefined };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/ue/")) requests.push(request.url());
  });
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { ok: false } }));
  const selected = (node: string) => ({ ok: true, data: {
    status: "selected", dialogueNodeId: node, selectedNodeCount: 1,
    nodes: [{ nodeClass: "SeriaEdDialogGraphNode", dialogueNodeId: node, nodeTitle: node, nodeComment: "" }],
    message: node,
  } });
  await page.route("**/api/ue/dialogue/selection*", (route) => {
    if (state.hold) { state.pending = route; return; }
    return route.fulfill({ json: selected(state.node) });
  });
  await page.route("**/api/ue/dialogue/storyboard/read", (route) => route.fulfill({ json: { ok: true, data: {
    status: "empty", dialogueAssetPath: "/Game/Test/204800.204800", nodes: [], warnings: [],
    configurations: route.request().postDataJSON().dialogueIds.map((dialogueId: string) => ({
      dialogueId, cameraPosition: "c1", moveCameraCount: 1, cameraMoveTypes: ["EPush"], fov: 62,
      blendCameraType: "ECutShot", blendCurve: "", blendDuration: 0, schoolCameraKeys: [],
      schoolCameraCount: 0, soundEffectAssetPath: "", soundEffectAssetName: "",
      soundEffectDelaySeconds: 0, backgroundMusicStateId: 0, backgroundMusicDelaySeconds: 0,
    })),
  } } }));
  await page.addInitScript(() => {
    sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
    let snapshot = { state: "unknown", message: "正在识别工作窗口" };
    let listener: ((snapshot: object) => void) | undefined;
    (window as any).monitorEvents = [];
    (window as any).testActivity = (state: string) => {
      snapshot = { state, message: state === "dialogue" ? "对话编辑器已激活" : "当前在其他窗口，已暂停 UE 自动读取" };
      listener?.(snapshot);
    };
    window.shotSandboxDesktop = {
      getSetupStatus: async () => ({
        firstRun: false, setupCompleted: true, version: "test", packaged: true, portable: false,
        runtimeBundled: true, traeDetected: true, integrationInstalled: true, mcpConnected: true,
        defaultDataReady: true, liveDataReady: false, configDataReady: false,
        ueConnected: true, ueMcpHost: "127.0.0.1", ueMcpPort: 12031, updateSupported: false,
      }),
      getConfigurationWindowMode: async () => false,
      setConfigurationWindowMode: async (enabled: boolean) => enabled,
      monitorConfigurationActivity: async (enabled: boolean) => {
        (window as any).monitorEvents.push(enabled);
        return snapshot;
      },
      onConfigurationActivity: (next: (snapshot: object) => void) => {
        listener = next; return () => { listener = undefined; };
      },
    } as unknown as NonNullable<Window["shotSandboxDesktop"]>;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "进入配置小窗" }).click();
  await page.setViewportSize({ width: 310, height: 900 });
  await expect(page.locator(".right-panel")).toHaveAttribute("inert", "");
  const selectionCount = () => requests.filter((url) => url.includes("/dialogue/selection")).length;
  return { errors, requests, state, selected, selectionCount };
}

test("compact activity pauses all automatic UE reads and preserves the editor draft", async ({ page }, info) => {
  test.setTimeout(60_000);
  const { errors, requests, state, selected, selectionCount } = await fixture(page);
  expect(selectionCount()).toBe(0);
  await activity(page, "dialogue");
  await expect(page.locator(".inspector-header")).toContainText("UE NODE 204801");
  await expect(page.getByRole("button", { name: "修改当前镜头" })).toContainText("FOV 62");
  await page.getByRole("button", { name: "添加镜头曲线" }).click();
  const draft = page.getByLabel("镜头混合曲线资产名");
  await draft.fill("trans_keep_draft");
  const firstRead = requests.find((url) => url.includes("/dialogue/selection"))!;
  expect(new URL(firstRead).searchParams.get("fresh")).toBe("1");
  const beforeActive = selectionCount();
  await page.waitForTimeout(3_800);
  const activeReads = selectionCount() - beforeActive;
  expect(activeReads).toBeGreaterThanOrEqual(3);
  const activePanelBounds = await page.locator(".right-panel").boundingBox();
  await activity(page, "other");
  await expect(page.locator(".right-panel")).toHaveAttribute("inert", "");
  const beforePause = requests.length;
  await page.waitForTimeout(3_800);
  const pausedReads = requests.length - beforePause;
  expect(pausedReads).toBe(0);
  // inert keeps the actual editor in the DOM, including unsaved input.
  expect(await draft.inputValue()).toBe("trans_keep_draft");
  const pauseNotice = page.locator(
    ".app-header > .configuration-pause-notice",
  );
  await expect(pauseNotice).toHaveText("自动读取已暂停");
  const pausedPanelBounds = await page.locator(".right-panel").boundingBox();
  expect(Math.round(pausedPanelBounds!.y)).toBe(
    Math.round(activePanelBounds!.y),
  );
  expect(Math.round(pausedPanelBounds!.height)).toBe(
    Math.round(activePanelBounds!.height),
  );
  const pausedStatusIcons = page.locator(
    '.app-header__status .workspace-status-icon[data-state="paused"]',
  );
  await expect(pausedStatusIcons).toHaveCount(2);
  const pauseToggleGlyphOpacity = await page
    .getByRole("button", { name: "自动暂停 UE 监听" })
    .locator("svg")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity));
  expect(pauseToggleGlyphOpacity).toBeLessThan(0.7);
  await page.screenshot({ path: info.outputPath("compact-paused-draft.png") });
  await activity(page, "dialogue");
  await expect(page.locator(".right-panel")).not.toHaveAttribute("inert");
  await expect(pauseNotice).toHaveCount(0);
  expect(await draft.inputValue()).toBe("trans_keep_draft");
  expect(new URL(requests.filter((url) => url.includes("/dialogue/selection")).at(-1)!).searchParams.get("fresh")).toBe("1");

  // Pause with a request already executing, then switch twice before it returns.
  state.hold = true;
  await expect.poll(() => Boolean(state.pending)).toBe(true);
  const late = state.pending!;
  state.pending = undefined;
  await activity(page, "other");
  await activity(page, "dialogue");
  await activity(page, "other");
  const beforeLate = selectionCount();
  await late.fulfill({ json: selected("204802") });
  await page.waitForTimeout(1_400);
  expect(selectionCount()).toBe(beforeLate);
  await expect(page.locator(".inspector-header")).toContainText("UE NODE 204801");
  expect(await draft.inputValue()).toBe("trans_keep_draft");
  state.hold = false;
  await activity(page, "dialogue");
  await expect(page.locator(".right-panel")).not.toHaveAttribute("inert");
  expect(await draft.inputValue()).toBe("trans_keep_draft");

  // Hidden documents pause even in manual listening mode.
  await page.getByRole("button", { name: "自动暂停 UE 监听" }).click();
  await expect(page.getByRole("button", { name: "自动暂停 UE 监听" })).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".right-panel")).toHaveAttribute("inert", "");
  const hiddenCount = requests.length;
  await page.waitForTimeout(1_400);
  expect(requests.length).toBe(hiddenCount);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".right-panel")).not.toHaveAttribute("inert");
  await page.getByRole("button", { name: "返回完整窗口" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".viewport-panel")).toBeVisible();
  const events = await page.evaluate(() => (window as any).monitorEvents);
  expect(events.at(-1)).toBe(false);
  await info.attach("request-counts", { body: JSON.stringify({ intervalMs: 3800, activeSelectionReads: activeReads,
    pausedAllUeReads: pausedReads }), contentType: "application/json" });
  console.log(JSON.stringify({ intervalMs: 3800, activeSelectionReads: activeReads, pausedAllUeReads: pausedReads }));
  expect(errors).toEqual([]);
});

test("re-enabling automatic mode cannot send a poll using an old dialogue snapshot", async ({ page }) => {
  const { requests, errors, selectionCount } = await fixture(page);
  await activity(page, "dialogue");
  await expect(page.locator(".right-panel")).not.toHaveAttribute("inert");
  const toggle = page.getByRole("button", { name: "自动暂停 UE 监听" });
  await toggle.click();
  await activity(page, "unknown");
  const before = selectionCount();
  await toggle.click();
  await expect(page.locator(".right-panel")).toHaveAttribute("inert", "");
  await page.waitForTimeout(1_400);
  expect(selectionCount()).toBe(before);
  await activity(page, "dialogue");
  await expect.poll(selectionCount).toBe(before + 1);
  await expect(page.locator(".right-panel")).not.toHaveAttribute("inert");
  expect(new URL(requests.filter((url) => url.includes("/dialogue/selection")).at(-1)!).searchParams.get("fresh")).toBe("1");
  expect(errors).toEqual([]);
});
