import { expect, test, type Page } from "@playwright/test";

async function handoffFixture(page: Page) {
  const state = {
    node: "204801",
    actionReads: [] as Array<{ dialogueIds: string[]; includeCatalogs: boolean }>,
    configurationReads: [] as string[][],
    inspectedRequests: [] as Array<Record<string, any>>,
    exportedRequests: [] as Array<Record<string, any>>,
    selectionReads: 0,
    gate: Promise.resolve(),
    emptyNodes: false,
  };
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { ok: false } }),
  );
  await page.route("**/api/ue/dialogue/selection", (route) => {
    state.selectionReads++;
    return route.fulfill({ json: { ok: true, data: {
      status: "selected", dialogueNodeId: state.node, selectedNodeCount: 1,
      nodes: [{ nodeClass: "SeriaEdDialogGraphNode", dialogueNodeId: state.node, nodeTitle: state.node, nodeComment: "" }],
      message: state.node,
    } } });
  });
  await page.route("**/api/ue/dialogue/storyboard/read", (route) => {
    const { dialogueIds } = route.request().postDataJSON();
    state.configurationReads.push(dialogueIds);
    return route.fulfill({ json: { ok: true, data: {
      status: "empty", dialogueAssetPath: "/Game/Test/204800.204800",
      nodes: [], warnings: [],
      configurations: dialogueIds.map((dialogueId: string) => ({
        dialogueId, cameraPosition: "c1", moveCameraCount: 1,
        cameraMoveTypes: ["EPush"], fov: 62, blendCameraType: "ECutShot",
        blendCurve: "", blendDuration: 0, schoolCameraKeys: [],
        schoolCameraCount: 0, soundEffectAssetPath: "", soundEffectAssetName: "",
        soundEffectDelaySeconds: 0, backgroundMusicStateId: 0, backgroundMusicDelaySeconds: 0,
      })),
    } } });
  });
  await page.route("**/api/ue/npc-actions/read", async (route) => {
    const request = route.request().postDataJSON();
    state.actionReads.push(request);
    await state.gate;
    await route.fulfill({ json: { ok: true, data: {
      dialogueAssetPath: "/Game/Test/204800.204800",
      catalogs: request.includeCatalogs ? [{
        modelIndex: 0, blueprintClassPath: "/Game/Test/Player.Player_C",
        characterLabel: "Player", status: "loaded", message: "",
        actions: [{ name: "AM_Idle", assetPath: "/Game/Test/AM_Idle.AM_Idle" }],
      }] : [],
      tracks: state.emptyNodes ? [] : request.dialogueIds.map((dialogueId: string) => ({
        dialogueId, modelIndex: 0, preservedComplexActionCount: 0,
        actions: [
          {
            montageName: "AM_Idle",
            delaySeconds: 0.4,
            sourceIndex: 0,
            behaviourType: "ENone",
          },
          {
            montageName: "None",
            delaySeconds: 0,
            behaviourType: "EStateMachineWalk",
          },
          {
            montageName: "AM_TurnRight90",
            delaySeconds: 0.2,
            sourceIndex: 2,
            behaviourType: "ERotate",
          },
        ],
      })),
      viewLineNodes: state.emptyNodes ? [] : request.dialogueIds.map((dialogueId: string) => ({
        dialogueId, lines: [], lockedObserverModelIndexes: [], preservedComplexLineCount: 0,
      })),
    } } });
  });
  await page.route("**/api/ue/storyboard/inspect", async (route) => {
    const request = route.request().postDataJSON();
    state.inspectedRequests.push(request);
    const characterActions = (request.characterActions ?? []).map(
      (item: Record<string, any>, characterActionIndex: number) => ({
        characterActionIndex,
        ...item,
        characterLabel: "Player",
        existingActions: [
          {
            montageName: "AM_Idle",
            delaySeconds: 0.4,
            sourceIndex: 0,
            behaviourType: "ENone",
          },
          {
            montageName: "None",
            delaySeconds: 0,
            behaviourType: "EStateMachineWalk",
          },
          {
            montageName: "AM_TurnRight90",
            delaySeconds: 0.2,
            sourceIndex: 2,
            behaviourType: "ERotate",
          },
        ],
        desiredActions: item.actions,
        preservedComplexActionCount: 0,
        action: "replace",
      }),
    );
    await route.fulfill({ json: { ok: true, data: {
      reviewToken: "a".repeat(64),
      dialogueId: "2048",
      startId: "204800",
      dialogueAssetPath: "/Game/Test/204800.204800",
      formationAssetPath: "/Game/Test/BP_204800.BP_204800",
      cameraName: "c1",
      shotCount: 0,
      changedNodeCount: 0,
      overwrittenNodeCount: 0,
      clearedNodeCount: 0,
      invalidShotCount: 0,
      globalBlockedReasons: [],
      blockedReasons: [],
      warnings: [],
      shots: [],
      nodes: [],
      characterActions,
      characterActionBlockedReasons: [],
      characterActionCount: characterActions.length,
      changedCharacterActionCount: characterActions.length,
      changedViewLineCount: 0,
      soundEffects: [],
      music: [],
    } } });
  });
  await page.route("**/api/ue/storyboard/export", async (route) => {
    const request = route.request().postDataJSON();
    state.exportedRequests.push(request);
    await route.fulfill({ json: { ok: true, data: {
      status: "exported",
      dialogueId: "2048",
      startId: "204800",
      dialogueAssetPath: "/Game/Test/204800.204800",
      changedNodeCount: 0,
      changedCharacterActionCount: request.characterActions.length,
      changedViewLineCount: 0,
      changedSoundEffectCount: 0,
      changedMusicCount: 0,
      saved: true,
    } } });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
    window.shotSandboxDesktop = {
      getSetupStatus: async () => ({
        firstRun: false, setupCompleted: true, version: "test", packaged: true, portable: false,
        runtimeBundled: true, traeDetected: true, integrationInstalled: true, mcpConnected: true,
        defaultDataReady: true, liveDataReady: false, configDataReady: false,
        ueConnected: true, ueMcpHost: "127.0.0.1", ueMcpPort: 12031, ueConnectionMessage: "Connected",
        updateSupported: false,
      }),
      getConfigurationWindowMode: async () => false,
      setConfigurationWindowMode: async (enabled: boolean) => enabled,
    } as unknown as NonNullable<Window["shotSandboxDesktop"]>;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "进入配置小窗" }).click();
  await expect(page.locator(".inspector-header")).toContainText("UE NODE 204801");
  await expect.poll(() => state.configurationReads.length).toBe(1);
  return state;
}

test("unlocks compact existing actions for delay edits and drag ordering", async ({
  page,
}, testInfo) => {
  const state = await handoffFixture(page);
  await page.setViewportSize({ width: 310, height: 900 });
  await page.getByRole("tab", { name: "UE", exact: true }).click();
  await expect(page.getByText("已读取 1 个 BP、1 个动作")).toBeVisible();

  const actionTrack = page.locator(".character-action-track").first();
  const lockedRows = actionTrack.locator(".character-action-existing-row");
  await expect(lockedRows).toHaveCount(3);
  await expect(lockedRows.getByRole("spinbutton")).toHaveCount(0);
  await lockedRows
    .filter({ hasText: "AM_Idle" })
    .getByRole("button", { name: /解锁.*AM_Idle/ })
    .click();

  const editableRows = actionTrack.locator(".character-action-row");
  await expect(editableRows).toHaveCount(2);
  await expect(
    page.locator(
      ".character-action-section--actions > .character-action-section__toggle",
    ),
  ).toContainText("3 动作");
  const idleRow = editableRows.filter({ hasText: "AM_Idle" });
  const turnRow = editableRows.filter({ hasText: "AM_TurnRight90" });
  await expect(
    idleRow.getByRole("spinbutton", { name: /AM_Idle.*延迟/ }),
  ).toBeEnabled();
  await expect(
    turnRow.getByRole("spinbutton", { name: /AM_TurnRight90.*延迟/ }),
  ).toBeDisabled();
  await idleRow
    .getByRole("spinbutton", { name: /AM_Idle.*延迟/ })
    .fill("0.8");
  await idleRow.dragTo(turnRow);
  await expect(
    editableRows.nth(0).locator(".character-action-row__name"),
  ).toHaveText("AM_TurnRight90");
  await expect(
    editableRows.nth(1).locator(".character-action-row__name"),
  ).toHaveText("AM_Idle");

  await page.screenshot({
    path: testInfo.outputPath("compact-existing-action-edit.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "写入节点" }).click();
  await expect.poll(() => state.inspectedRequests.length).toBe(1);
  await expect.poll(() => state.exportedRequests.length).toBe(1);
  expect(state.inspectedRequests[0]).toMatchObject({
    dialogueAssetDirtyPolicy: "save_existing",
    characterActions: [{
      dialogueId: "204801",
      modelIndex: 0,
      editMode: "replace_editable",
      actions: [
        {
          montageName: "AM_TurnRight90",
          delaySeconds: 0.2,
          sourceIndex: 2,
        },
        {
          montageName: "AM_Idle",
          delaySeconds: 0.8,
          sourceIndex: 0,
        },
      ],
    }],
  });
  expect(state.exportedRequests[0]).toMatchObject({
    characterActions: state.inspectedRequests[0].characterActions,
  });
  await expect(
    page.getByText("节点 204801 的动作与视线已写入并保存"),
  ).toBeVisible();
  await expect(actionTrack.locator(".character-action-existing-row")).toHaveCount(3);
  await expect(
    actionTrack.locator(".character-action-existing-row").first(),
  ).toContainText("AM_TurnRight90");
});

test("reuses compact node snapshots when expanding to the storyboard", async ({ page }, testInfo) => {
  const state = await handoffFixture(page);
  await page.getByRole("tab", { name: "UE", exact: true }).click();
  await expect(page.getByText("已读取 1 个 BP、1 个动作")).toBeVisible();
  expect(state.actionReads[0].dialogueIds).toEqual(["204801"]);
  await page.getByRole("button", { name: "返回完整窗口" }).click();
  await expect.poll(() => state.actionReads.length).toBe(2);
  expect(state.actionReads[1].dialogueIds).not.toContain("204801");
  expect(state.actionReads[1].includeCatalogs).toBe(false);
  await expect(page.getByText("已读取 1 个 BP、1 个动作")).toBeVisible();
  await expect(page.locator(".character-action-editor")).toContainText("AM_Idle");
  const selectionReads = state.selectionReads;
  await page.waitForTimeout(1_500);
  expect(state.selectionReads).toBe(selectionReads);
  await page.screenshot({ path: testInfo.outputPath("storyboard-handoff.png") });
  await page.getByRole("button", { name: "进入配置小窗" }).click();
  await expect(page.locator(".inspector-header")).toContainText("UE NODE 204801");
  await expect(page.getByText("已读取 1 个 BP、1 个动作")).toBeVisible();
  expect(state.actionReads).toHaveLength(2);
  await page.getByRole("tab", { name: "镜头", exact: true }).click();
  await expect(page.getByRole("button", { name: "修改当前镜头" })).toBeEnabled();
  expect(state.configurationReads).toEqual([["204801"]]);
});

test("keeps empty nodes cached and refreshes only on an explicit request", async ({ page }) => {
  const state = await handoffFixture(page);
  state.emptyNodes = true;
  await page.getByRole("tab", { name: "UE", exact: true }).click();
  await expect(page.getByText("已读取 1 个 BP、1 个动作")).toBeVisible();
  state.node = "204802";
  await expect(page.locator(".inspector-header")).toContainText("UE NODE 204802");
  await expect.poll(() => state.actionReads.length).toBe(2);
  await expect(page.getByText("已读取 1 个 BP、1 个动作")).toBeVisible();
  state.node = "204801";
  await expect(page.locator(".inspector-header")).toContainText("UE NODE 204801");
  await expect(page.getByText("已读取 1 个 BP、1 个动作")).toBeVisible();
  expect(state.actionReads).toHaveLength(2);
  await page.getByRole("button", { name: "返回完整窗口" }).click();
  await expect.poll(() => state.actionReads.length).toBe(3);
  expect(state.actionReads[2].dialogueIds).toEqual([
    "204803", "204804", "204805", "204806", "204807",
  ]);
  await expect(page.getByText("已读取 1 个 BP、1 个动作")).toBeVisible();
  await page.getByRole("button", { name: "重新读取角色动作" }).click();
  await expect.poll(() => state.actionReads.length).toBe(4);
  expect(state.actionReads[3].includeCatalogs).toBe(true);
  expect(state.actionReads[3].dialogueIds).toHaveLength(7);
});

test("keeps cached actions visible while loading the remaining nodes", async ({ page }) => {
  const state = await handoffFixture(page);
  await page.getByRole("tab", { name: "UE", exact: true }).click();
  await expect(page.getByText("已读取 1 个 BP、1 个动作")).toBeVisible();
  let release!: () => void;
  state.gate = new Promise<void>((resolve) => { release = resolve; });
  try {
    await page.getByRole("button", { name: "返回完整窗口" }).click();
    await expect.poll(() => state.actionReads.length).toBe(2);
    await expect(
      page
        .locator(".character-action-existing-row")
        .filter({ hasText: "AM_Idle" }),
    ).toBeVisible();
    expect(state.actionReads[1].dialogueIds).not.toContain("204801");
  } finally {
    release();
  }
  await expect(page.getByText("已读取 1 个 BP、1 个动作")).toBeVisible();
});

test("prefers configured character names over Blueprint labels in compact mode", async ({
  page,
}) => {
  let cameraPresetRequest: {
    roleHints: Array<{ modelIndex: number; label: string }>;
  } | null = null;
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { ok: false } }),
  );
  await page.route("**/api/ue/config-data/read", (route) =>
    route.fulfill({ json: { ok: true, data: {
      dialogueText: [
        "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
        "##对话ID,人物,内容,下一ID,结束",
        "735000,,,735001,false",
        "735001,101968,请止步。,,true",
      ].join("\n"),
      startText: [
        "##&DialogStart.id,DialogStart.Outline",
        "##对话ID,剧情梗概",
        "735000,角色名称测试",
      ].join("\n"),
      npcText: [
        "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id",
        "##id,名称,介绍,资源",
        "101968,商会安保,守卫,200135",
      ].join("\n"),
      modelText: [
        "##&Model.id,,Model.path",
        "##id,配置填写在此列，Model.path保存时自动生成，由程序调用,生成路径",
        "200135,/Game/Test/BP_N36_Commerce_Guard,/Game/Test/BP_N36_Commerce_Guard.BP_N36_Commerce_Guard_C",
      ].join("\n"),
      sourceName: "Test res + Test doc",
      careerText: "", missionText: "", dungeonMissionText: "",
      missionPositionText: "", mapConfigText: "", mapResourceText: "",
    } } }),
  );
  await page.route("**/api/ue/dialogue/selection", (route) =>
    route.fulfill({ json: { ok: true, data: {
      status: "selected", dialogueNodeId: "735001", selectedNodeCount: 1,
      nodes: [{ nodeClass: "SeriaEdDialogGraphNode", dialogueNodeId: "735001", nodeTitle: "735001", nodeComment: "" }],
      message: "已同步 UE 节点 735001",
    } } }),
  );
  await page.route("**/api/ue/dialogue/storyboard/read", (route) =>
    route.fulfill({ json: { ok: true, data: {
      status: "empty", dialogueAssetPath: "/Game/Test/735000.735000",
      nodes: [], warnings: [],
      configurations: [{
        dialogueId: "735001", cameraPosition: "c1",
        moveCameraCount: 1, cameraMoveTypes: ["EPush"], fov: 62,
        blendCameraType: "ECutShot", blendCurve: "", blendDuration: 0,
        schoolCameraKeys: [], schoolCameraCount: 0,
        soundEffectAssetPath: "", soundEffectAssetName: "",
        soundEffectDelaySeconds: 0, backgroundMusicStateId: 0,
        backgroundMusicDelaySeconds: 0,
      }],
    } } }),
  );
  await page.route("**/api/ue/npc-actions/read", (route) =>
    route.fulfill({ json: { ok: true, data: {
      dialogueAssetPath: "/Game/Test/735000.735000",
      catalogs: [{
        modelIndex: 1,
        blueprintClassPath:
          "/Game/Test/BP_N36_Commerce_Guard.BP_N36_Commerce_Guard_C",
        characterLabel: "BP_N36_Commerce_Guard",
        status: "loaded",
        message: "",
        actions: [{
          name: "AM_Idle",
          assetPath: "/Game/Test/AM_Idle.AM_Idle",
        }],
      }],
      tracks: [],
      viewLineNodes: [],
    } } }),
  );
  await page.route("**/api/ue/dialogue/camera/presets", (route) => {
    cameraPresetRequest = route.request().postDataJSON();
    const label =
      cameraPresetRequest?.roleHints.find(
        (role) => role.modelIndex === 1,
      )?.label ?? "BP_N36_Commerce_Guard";
    return route.fulfill({ json: { ok: true, data: {
      dialogueNodeId: "735001",
      fingerprint: "a".repeat(64),
      formationActorPath: "/Temp/Preview.Formation",
      formationClassPath: "/Game/Test/BP_735000.BP_735000_C",
      roles: [{
        modelIndex: 1, label,
        actorPath: "/Temp/Preview.Guard",
        cameraClassPath:
          "/Game/Test/BP_N36_Commerce_Guard.BP_N36_Commerce_Guard_C",
        cameras: [{
          name: "1", label: "1 | +0 deg",
          componentPath: "/Temp/Preview.Guard.Camera1",
          actorRelative: {
            position: { X: 180, Y: 0, Z: 70 },
            rotation: { Pitch: 0, Yaw: -180, Roll: 0 },
          },
          local: {
            position: { X: 100, Y: 200, Z: 170 },
            rotation: { Pitch: -5, Yaw: 180, Roll: 0 },
          },
          world: {
            position: { X: 100, Y: 200, Z: 170 },
            rotation: { Pitch: -5, Yaw: 180, Roll: 0 },
          },
        }],
      }],
    } } });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
    window.shotSandboxDesktop = {
      getSetupStatus: async () => ({
        firstRun: false, setupCompleted: true, version: "test", packaged: true, portable: false,
        runtimeBundled: true, traeDetected: true, integrationInstalled: true, mcpConnected: true,
        defaultDataReady: true, liveDataReady: true, configDataReady: true,
        ueConnected: true, ueMcpHost: "127.0.0.1", ueMcpPort: 12031, ueConnectionMessage: "Connected",
        updateSupported: false,
      }),
      getConfigurationWindowMode: async () => false,
      setConfigurationWindowMode: async (enabled: boolean) => enabled,
    } as unknown as NonNullable<Window["shotSandboxDesktop"]>;
  });

  await page.goto("/");
  await expect(page.locator(".query-section .section-label").first()).toContainText(
    "2 条台词",
  );
  await page.getByPlaceholder("例如 7352 或台词关键词").fill("7350");
  await page.getByRole("button", { name: "加载对白内容" }).click();
  await expect(page.getByRole("button", { name: "进入配置小窗" })).toBeEnabled();
  await page.getByRole("button", { name: "进入配置小窗" }).click();
  await page.getByRole("tab", { name: "UE", exact: true }).click();
  const rolePicker = page.getByRole("combobox", {
    name: "节点 735001 添加角色",
  });
  await expect(rolePicker).toContainText("1 商会安保");
  await expect(rolePicker).not.toContainText("BP_N36_Commerce_Guard");
  await page.getByRole("tab", { name: "镜头", exact: true }).click();
  await page.getByRole("button", { name: "修改当前镜头" }).click();
  await expect(page.getByLabel("预设机位角色")).toContainText(
    "1 · 商会安保",
  );
  expect(cameraPresetRequest?.roleHints).toEqual([
    { modelIndex: 1, label: "商会安保" },
  ]);
});
