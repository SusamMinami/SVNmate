import { expect, test, type Page } from "@playwright/test";
import type { DialogueCameraQuickActionRequest } from "../src/types";

async function cameraPresetFixture(page: Page, moveCameraCount = 1) {
  const state = {
    node: "204801",
    reads: 0,
    readGate: Promise.resolve(),
    readError: "",
    applyError: "",
    applied: 0,
    inspections: [] as DialogueCameraQuickActionRequest[],
    writes: [] as Array<DialogueCameraQuickActionRequest & { reviewToken?: string }>,
  };
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { ok: false } }));
  await page.route("**/api/ue/dialogue/selection", (route) => route.fulfill({
    json: { ok: true, data: {
      status: "selected", dialogueNodeId: state.node, selectedNodeCount: 1,
      nodes: [{ nodeClass: "SeriaEdDialogGraphNode", dialogueNodeId: state.node, nodeTitle: `节点 ${state.node}`, nodeComment: "" }],
      message: `已同步 UE 节点 ${state.node}`,
    } },
  }));
  await page.route("**/api/ue/dialogue/storyboard/read", (route) => route.fulfill({
    json: { ok: true, data: {
      status: "empty", dialogueAssetPath: "/Game/Test/204800.204800", nodes: [], warnings: [],
      configurations: [state.node].map((dialogueId) => ({
        dialogueId, cameraPosition: "c1", moveCameraCount, cameraMoveTypes: ["EPush"], fov: 49,
        cameraVelocity: 7, cameraBlendOutTime: 2.5, cameraRelative: true,
        blendCameraType: "EBlend", blendCurve: "/Game/Test/trans_6015.trans_6015", blendDuration: 3,
        schoolCameraKeys: ["ERing"], schoolCameraCount: 1, soundEffectAssetPath: "", soundEffectAssetName: "",
        soundEffectDelaySeconds: 0, backgroundMusicStateId: 0, backgroundMusicDelaySeconds: 0,
      })),
    } },
  }));
  await page.route("**/api/ue/dialogue/camera/presets", async (route) => {
    const request = route.request().postDataJSON();
    state.reads++;
    await state.readGate;
    if (state.readError) {
      await route.fulfill({ status: 400, json: { ok: false, error: { message: state.readError } } });
      return;
    }
    await route.fulfill({ json: { ok: true, data: {
      dialogueNodeId: request.dialogueNodeId,
      fingerprint: "a".repeat(64), formationActorPath: "/Temp/Preview.Formation",
      formationClassPath: "/Game/Test/Formation.Formation_C",
      roles: [
        { modelIndex: 0, label: "Player", actorPath: "/Temp/Role0", cameraClassPath: "/Game/Test/Camera.Camera_C" },
        { modelIndex: 1, label: "BP_Guard_Long_Character_Name_For_Desktop", actorPath: "/Temp/Role1", cameraClassPath: "/Game/Test/Camera.Camera_C" },
      ].map((role) => ({ ...role, cameras: [
        { name: "1", label: "1 | +0 deg", componentPath: `${role.actorPath}.1` },
        { name: "3", label: "3 | +25 deg", componentPath: `${role.actorPath}.3` },
      ].map((camera) => ({ ...camera,
        local: { position: { X: 110, Y: 240, Z: 175 }, rotation: { Pitch: -6, Yaw: 145, Roll: 3 } },
        world: { position: { X: 210, Y: 240, Z: 175 }, rotation: { Pitch: -6, Yaw: 145, Roll: 3 } },
      })) })),
    } } });
  });
  await page.route("**/api/ue/dialogue/camera/inspect", async (route) => {
    state.inspections.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { ok: false, error: { message: "Unexpected preview request" } } });
  });
  await page.route("**/api/ue/dialogue/camera/apply", async (route) => {
    const request = route.request().postDataJSON();
    state.writes.push(request);
    if (state.applyError) {
      await route.fulfill({ status: 400, json: { ok: false, error: { message: state.applyError } } });
      return;
    }
    state.applied++;
    await route.fulfill({ json: { ok: true, data: {
      status: "updated", ...request, saved: true, dialogueAssetPath: "/Game/Test/204800.204800",
    } } });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
    window.shotSandboxDesktop = {
      getSetupStatus: async () => ({
        firstRun: false, setupCompleted: true, version: "test", packaged: true, portable: false,
        runtimeBundled: true, traeDetected: true, integrationInstalled: true, mcpConnected: true,
        defaultDataReady: true, liveDataReady: false, configDataReady: false,
        ueConnected: true, ueMcpHost: "127.0.0.1", ueMcpPort: 12031, ueConnectionMessage: "已连接",
        updateSupported: false,
      }),
      getConfigurationWindowMode: async () => false,
      setConfigurationWindowMode: async (enabled: boolean) => enabled,
    } as unknown as NonNullable<Window["shotSandboxDesktop"]>;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "进入配置小窗" }).click();
  await expect(page.locator(".inspector-header")).toContainText("UE NODE 204801");
  await expect(page.getByRole("button", { name: "添加默认镜头" })).toBeEnabled();
  return state;
}

test("stages a preset in the existing small-window camera tab and writes only after footer confirmation", async ({ page }, testInfo) => {
  const state = await cameraPresetFixture(page);
  expect(state.reads).toBe(0);
  await page.setViewportSize({ width: 420, height: 820 });
  await page.getByRole("button", { name: "添加默认镜头" }).click();
  const role = page.getByLabel("预设机位角色");
  const angle = page.getByLabel("预设机位角度");
  const write = page.getByRole("button", { name: "写入节点", exact: true });
  await expect(role).toBeDisabled();
  expect(state.reads).toBe(0);
  await page.getByRole("button", { name: "读取预设机位", exact: true }).click();
  await expect(role).toBeEnabled();
  await expect(angle).toBeDisabled();
  expect(state.inspections).toHaveLength(0);
  await role.selectOption("0");
  await expect(write).toBeDisabled();
  await angle.selectOption("3");
  await expect(write).toBeEnabled();
  const review = page.getByLabel("节点镜头写入确认");
  await expect(review).toContainText("0 · Player · 机位 3");
  await expect(review).toContainText("EPush · 速度 7 · Blend Out 2.5 · FOV 49");
  await expect(review).toContainText("110.0 / 240.0 / 175.0 cm");
  await expect(review).toContainText("可能覆盖主镜头");
  expect(state.writes).toHaveLength(0);
  expect(state.reads).toBe(1);
  expect(state.inspections).toHaveLength(0);
  for (const viewport of [{ width: 420, height: 820 }, { width: 520, height: 720 }]) {
    await page.setViewportSize(viewport);
    const bounds = await page.evaluate(() => {
      const picker = document.querySelector(".node-camera-preset-picker")!.getBoundingClientRect();
      const panel = document.querySelector(".inspector-tab-panel")!.getBoundingClientRect();
      const review = document.querySelector(".node-camera-review")!.getBoundingClientRect();
      const footer = document.querySelector(".inspector-footer--export")!.getBoundingClientRect();
      return {
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        pickerInside: picker.right <= innerWidth && picker.left >= 0,
        noOverlap: panel.bottom <= review.top + 1 && review.bottom <= footer.top + 1,
        footerInside: footer.bottom <= innerHeight,
      };
    });
    expect(bounds).toEqual({ horizontalOverflow: false, pickerInside: true, noOverlap: true, footerInside: true });
    await page.screenshot({ path: testInfo.outputPath(`preset-picker-${viewport.width}.png`) });
  }
  await write.click();
  await expect(page.getByText("节点 204801 的镜头配置已写入并保存")).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({
    mode: "preset_camera", dialogueNodeId: "204801",
    presetCamera: { modelIndex: 0, cameraName: "3", fingerprint: "a".repeat(64) },
  });
  expect(state.writes[0]).not.toHaveProperty("reviewToken");
  expect(state.writes[0]).not.toHaveProperty("fov");
  expect(state.writes[0]).not.toHaveProperty("blendOutTime");
  expect(state.applied).toBe(1);
  await expect(role).toHaveCount(0);
});

test("invalidates a preset review on role changes, refreshes and node switches", async ({ page }) => {
  const state = await cameraPresetFixture(page);
  const write = page.getByRole("button", { name: "写入节点", exact: true });
  await page.getByRole("button", { name: "添加默认镜头" }).click();
  await page.getByRole("button", { name: "读取预设机位", exact: true }).click();
  const role = page.getByLabel("预设机位角色");
  const angle = page.getByLabel("预设机位角度");
  await role.selectOption("0");
  await angle.selectOption("3");
  await expect(write).toBeEnabled();
  await role.selectOption("1");
  await expect(angle).toHaveValue("");
  await expect(write).toBeDisabled();
  await angle.selectOption("1");
  await expect(write).toBeEnabled();
  await page.getByRole("button", { name: "重新读取预设机位" }).click();
  await expect(role).toBeEnabled();
  await expect(angle).toBeDisabled();
  await expect(write).toBeDisabled();
  expect(state.reads).toBe(2);
  await role.selectOption("0");
  let release!: () => void;
  state.readGate = new Promise<void>((resolve) => { release = resolve; });
  await angle.selectOption("3");
  await expect(write).toBeEnabled();
  await page.getByRole("button", { name: "重新读取预设机位" }).click();
  await expect(write).toBeDisabled();
  state.node = "204803";
  await expect(page.locator(".inspector-header")).toContainText("UE NODE 204803", { timeout: 10_000 });
  release();
  await expect(role).toHaveCount(0);
  await expect(page.getByLabel("节点镜头写入确认")).toHaveCount(0);
  await expect(write).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});

test("shows missing-preview and stale-snapshot errors without reporting a successful write", async ({ page }) => {
  const state = await cameraPresetFixture(page);
  state.readError = "请打开当前对话预览并初始化角色";
  await page.getByRole("button", { name: "添加默认镜头" }).click();
  await page.getByRole("button", { name: "读取预设机位", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(state.readError);
  const role = page.getByLabel("预设机位角色");
  await expect(role).toBeDisabled();
  state.readError = "";
  await page.getByRole("button", { name: "读取预设机位", exact: true }).click();
  await role.selectOption("0");
  state.applyError = "UE 预览站位或预设机位已变化，请重新读取并选择";
  await page.getByLabel("预设机位角度").selectOption("3");
  await page.getByRole("button", { name: "写入节点", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(state.applyError);
  await expect(page.getByText("节点 204801 的镜头配置已写入并保存")).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.applied).toBe(0);
});

test("labels a multi-segment preset as blocked, never as already matching", async ({ page }, testInfo) => {
  const state = await cameraPresetFixture(page, 2);
  await page.getByRole("button", { name: "添加默认镜头" }).click();
  await page.getByRole("button", { name: "读取预设机位", exact: true }).click();
  await page.getByLabel("预设机位角色").selectOption("0");
  await page.getByLabel("预设机位角度").selectOption("3");
  const review = page.getByLabel("节点镜头写入确认");
  await expect(review).toContainText("无法应用此预设");
  await expect(review).toContainText("当前节点包含多段运镜");
  await expect(review).not.toContainText("当前参数已经一致");
  await expect(page.getByRole("button", { name: "写入节点", exact: true })).toBeDisabled();
  for (const viewport of [{ width: 420, height: 820 }, { width: 520, height: 720 }]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: testInfo.outputPath(`blocked-preset-${viewport.width}.png`) });
  }
  expect(state.inspections).toHaveLength(0);
  expect(state.writes).toHaveLength(0);
});
