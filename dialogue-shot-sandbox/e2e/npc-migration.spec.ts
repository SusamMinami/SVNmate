import { expect, test } from "@playwright/test";

test("opens the NPC migration workspace without layout overflow", async ({
  page,
}, testInfo) => {
  const source = {
    sourceProjectFile: "D:/Seria/Art/Art.uproject",
    sourceContentDirectory: "D:/Seria/Art/Content",
    skeletalMeshName: "SK_N28_Citizen_Male_C",
    skeletalMeshAssetPath:
      "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C.SK_N28_Citizen_Male_C",
    skeletalMeshPackageName:
      "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C",
    skeletonAssetPath:
      "/Game/Seria/NPC/N28/SKEL_N28_Citizen_Male_C.SKEL_N28_Citizen_Male_C",
    physicsAssetPath: "",
    materialAssetPaths: [],
    dependencyPackageNames: [
      "/Game/Seria/NPC/N28/SK_N28_Citizen_Male_C",
    ],
    sourceFiles: [],
    dirtyPackageNames: [],
    suggestedNpcName: "N28_Citizen_Male_C",
    suggestedTargetPackagePath: "/Game/Seria/NPC/N28",
    warnings: [],
  };
  await page.route("**/api/ue/npc-migration/source-scan", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: source,
      }),
    }),
  );
  await page.route("**/api/ue/npc-migration/plan", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          reviewToken: "a".repeat(64),
          source,
          npcName: "N28_Citizen_Male_C",
          animationName: "N28_Citizen_Male_C",
          animationPrefix: "A_N28_Citizen_Male_C_",
          targetContentDirectory: "D:/Seria/res/Content",
          targetPackagePath: "/Game/Seria/NPC/N28",
          blueprintPackagePath: "/Game/Seria/NPC/N28",
          animationSourceDirectory: "D:/FBX/N28/Animation",
          animationPackagePath: "/Game/Seria/NPC/N28/Animation",
          animationBlueprintPackagePath:
            "/Game/Seria/NPC/N28/Animation",
          montagePackagePath: "/Game/Seria/NPC/N28/Animation",
          blueprintName: "BP_N28_Citizen_Male_C",
          animationBlueprintName: "ABP_N28_Citizen_Male_C",
          bodyAnimationFiles: [
            "D:/FBX/N28/Animation/A_N28_Citizen_Male_C_Idlestand.fbx",
          ],
          faceAnimationFiles: [],
          montages: [],
          configureStandardAbp: true,
          standardAbpTemplate: "male",
          lookBlendSpaceName: "BS_N28_Citizen_Male_C_Look",
          animationRoleAssets: {
            lookDown: "",
            lookForward: "",
            lookUp: "",
            idleStand: "A_N28_Citizen_Male_C_Idlestand",
            impact: "",
            interact: "",
            walk: "",
          },
          fileOperations: [],
          steps: [
            {
              id: "source",
              label: "采集 Skeletal Mesh 与依赖",
              mode: "automatic",
              state: "ready",
              detail: "1 个包，0 个物理文件",
            },
            {
              id: "animations",
              label: "导入 Body / Face 动作",
              mode: "automatic",
              state: "blocked",
              detail: "1 个 Body FBX，0 个 Face FBX",
            },
            {
              id: "blueprint",
              label: "创建并配置 NPC BP",
              mode: "automatic",
              state: "ready",
              detail: "BP_N28_Citizen_Male_C",
            },
          ],
          canMigrate: false,
          canConfigure: false,
          blockedReasons: ["标准 ABP 缺少动作：lookDown、lookForward"],
          warnings: ["胶囊体将按 Mesh 包围盒估算，完成后仍需在蓝图视口确认"],
        },
      }),
    }),
  );
  await page.addInitScript(() => {
    window.sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
  });
  await page.goto("/");

  await page.getByRole("button", { name: "NPC 迁移" }).click();
  await page.waitForTimeout(850);
  await expect(
    page.getByRole("heading", { name: "NPC 迁移" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /全新 NPC/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /动作补充与修改/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /面部补充/ }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("npc-migration-mode-selector.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /全新 NPC/ }).click();
  await page.evaluate(() => {
    window.shotSandboxDesktop = {
      resolveNpcAnimationDirectory: async () => ({
        directoryPath: "D:/FBX/N28/Animation",
        matchedFileCount: 7,
        candidateDirectories: ["D:/FBX/N28/Animation"],
      }),
    } as unknown as NonNullable<Window["shotSandboxDesktop"]>;
  });
  await expect(
    page.getByRole("button", { name: "读取源资产" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "读取源资产" }).click();
  await expect(page.getByLabel("NPC 名称")).toHaveValue(
    "N28_Citizen_Male_C",
  );
  await expect(
    page.getByText("BP_N28_Citizen_Male_C", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("ABP_N28_Citizen_Male_C", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "动作 FBX 目录" }),
  ).toHaveValue("D:/FBX/N28/Animation");
  await expect(
    page.getByText("动作库自动匹配", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("NPC 类型", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "男性" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "动物" }),
  ).toBeVisible();
  await expect(page.getByText("迁移参数")).toBeVisible();
  await expect(page.getByText("执行审核")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "检查迁移计划" }),
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "目标工程 Content", exact: true })
    .fill("D:/Seria/res/Content");
  await page.getByRole("button", { name: "检查迁移计划" }).click();
  await expect(
    page.locator(".npc-migration-section").filter({ hasText: "源资产" }),
  ).toHaveAttribute("data-collapsed", "true");
  await expect(
    page.locator(".npc-migration-section").filter({ hasText: "迁移参数" }),
  ).toHaveAttribute("data-collapsed", "true");
  await expect(
    page.locator(".npc-migration-steps .npc-migration-step").first(),
  ).toContainText("导入 Body / Face 动作");
  await expect(
    page.locator(".npc-migration-review").getByText("人工确认"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "校验资产" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "配置 BP 文件" }),
  ).toBeVisible();
  await page.waitForTimeout(850);

  const layout = page.locator(".npc-migration-layout");
  const metrics = await layout.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);

  await page.screenshot({
    path: testInfo.outputPath("npc-migration-workspace.png"),
    fullPage: true,
  });
});

test("selects the animal migration profile for an E05 cat mesh", async ({
  page,
}, testInfo) => {
  await page.route("**/api/ue/npc-migration/source-scan", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          sourceProjectFile: "D:/Seria/Art/Art.uproject",
          sourceContentDirectory: "D:/Seria/Art/Content",
          skeletalMeshName: "SK_E05_Cat02",
          skeletalMeshAssetPath:
            "/Game/Seria/BioSystems/E05_Cat/SK_E05_Cat02.SK_E05_Cat02",
          skeletalMeshPackageName:
            "/Game/Seria/BioSystems/E05_Cat/SK_E05_Cat02",
          skeletonAssetPath:
            "/Game/Seria/BioSystems/E05_Cat/SKEL_E05_Cat.SKEL_E05_Cat",
          physicsAssetPath:
            "/Game/Seria/BioSystems/E05_Cat/PHYS_E05_Cat.PHYS_E05_Cat",
          materialAssetPaths: [],
          dependencyPackageNames: [
            "/Game/Seria/BioSystems/E05_Cat/SK_E05_Cat02",
          ],
          sourceFiles: [],
          dirtyPackageNames: [],
          suggestedNpcName: "E05_Cat02",
          suggestedTargetPackagePath:
            "/Game/Seria/BioSystems/E05_Cat",
          warnings: [],
        },
      }),
    }),
  );
  await page.addInitScript(() => {
    window.sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
  });
  await page.goto("/");

  await page.getByRole("button", { name: "NPC 迁移" }).click();
  await page.getByRole("button", { name: /全新 NPC/ }).click();
  await page.getByRole("button", { name: "读取源资产" }).click();

  await expect(
    page.getByRole("button", { name: "动物" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("BP_E05_CAT02_NPC", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("ABP_E05_CAT02_NPC", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("A_E05_Cat_", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("/Game/Seria/NPC/E05_Cat", { exact: true }),
  ).toBeVisible();
  await page.getByText("高级配置", { exact: true }).click();
  await expect(page.getByText("套用模板胶囊体")).toBeVisible();

  const segment = page.getByRole("group", { name: "NPC 类型" });
  expect(
    await segment.locator("button").evaluateAll((buttons) =>
      buttons.map((button) => ({
        text: button.textContent?.trim(),
        active: button.classList.contains("is-active"),
        pressed: button.getAttribute("aria-pressed"),
      })),
    ),
  ).toEqual([
    { text: "男性", active: false, pressed: "false" },
    { text: "女性", active: false, pressed: "false" },
    { text: "动物", active: true, pressed: "true" },
  ]);
  const metrics = await segment.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);

  await page.screenshot({
    path: testInfo.outputPath("npc-migration-animal-profile.png"),
    fullPage: true,
  });
});

test("opens the face supplement review flow", async ({ page }, testInfo) => {
  const target = {
    targetProjectFile: "D:/Seria/res/res.uproject",
    targetContentDirectory: "D:/Seria/res/Content",
    selectedAssetPath: "/Game/Seria/NPC/N28/BP_N28.BP_N28",
    selectedAssetName: "BP_N28",
    selectedAssetType: "Blueprint",
    npcName: "N28",
    skeletalMeshAssetPath: "/Game/Seria/NPC/N28/SK_N28.SK_N28",
    skeletonAssetPath: "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
    faceSkeletalMeshAssetPath:
      "/Game/Seria/NPC/N28/SK_N28_Face.SK_N28_Face",
    faceSkeletonAssetPath:
      "/Game/Seria/NPC/N28/SKEL_N28_Face.SKEL_N28_Face",
    targetPackagePath: "/Game/Seria/NPC/N28",
    animationPackagePath: "/Game/Seria/NPC/N28/Animation",
    existingAssetPaths: [
      "/Game/Seria/NPC/N28/Animation/A_N28_Talk.A_N28_Talk",
    ],
    dirtyPackageNames: [],
    warnings: [],
  };
  await page.route(
    "**/api/ue/npc-migration/supplement-target",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: target }),
      }),
  );
  await page.route("**/api/ue/npc-migration/supplement-plan", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          reviewToken: "a".repeat(64),
          kind: "face",
          target,
          sourceDirectory: "D:/FBX/N28/Animation/Face",
          npcPrefix: "A_N28_",
          items: [
            {
              sourceFile:
                "D:/FBX/N28/Animation/Face/A_N28_Talk_Face.fbx",
              sourceAssetName: "A_N28_Talk_Face",
              sourceModifiedTimeMs: 1_788_966_000_000,
              actionName: "Talk",
              targetAssetPath:
                "/Game/Seria/NPC/N28/Animation/Face/A_N28_Talk_Face",
              bodyAssetPath:
                "/Game/Seria/NPC/N28/Animation/A_N28_Talk",
              montageName: "AM_Talk",
              montageAssetPath:
                "/Game/Seria/NPC/N28/Animation/AM_Talk",
              montageState: "create",
              montageSlotName: "",
              copyFaceCurves: true,
              makeMontage: true,
              state: "new",
              included: true,
              blockedReason: "",
              pairedFace: null,
            },
          ],
          canApply: true,
          blockedReasons: [],
          warnings: [
            "将使用 Face Skeleton 导入动作、锁定根骨骼并自动保存",
            "将直接调用 Seria 原生函数复制表情曲线并按清单生成 Montage",
          ],
        },
      }),
    }),
  );
  await page.addInitScript(() => {
    window.sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
  });
  await page.goto("/");

  await page.getByRole("button", { name: "NPC 迁移" }).click();
  await page.getByRole("button", { name: /面部补充/ }).click();
  await page.getByRole("button", { name: "读取 UE 目标" }).click();
  await expect(page.getByText("SKEL_N28_Face", { exact: false })).toBeVisible();
  await page
    .getByRole("textbox", { name: "动作 FBX 目录" })
    .fill("D:/FBX/N28/Animation/Face");
  await page.getByRole("button", { name: "生成动作清单" }).click();

  await expect(page.getByText("Talk", { exact: true })).toBeVisible();
  await expect(page.getByText("Body 配对", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "复制" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "生成" }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "执行面部补充" }),
  ).toBeEnabled();

  const layout = page.locator(".npc-supplement-layout");
  const metrics = await layout.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);

  await page.screenshot({
    path: testInfo.outputPath("npc-face-supplement.png"),
    fullPage: true,
  });
});

test("sorts action supplements by source modification time", async ({
  page,
}, testInfo) => {
  let planRequestCount = 0;
  const target = {
    targetProjectFile: "D:/Seria/res/res.uproject",
    targetContentDirectory: "D:/Seria/res/Content",
    selectedAssetPath: "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
    selectedAssetName: "SKEL_N28",
    selectedAssetType: "Skeleton",
    npcName: "N28",
    skeletalMeshAssetPath: "/Game/Seria/NPC/N28/SK_N28.SK_N28",
    skeletonAssetPath: "/Game/Seria/NPC/N28/SKEL_N28.SKEL_N28",
    faceSkeletalMeshAssetPath:
      "/Game/Seria/NPC/N28/SK_N28_Face.SK_N28_Face",
    faceSkeletonAssetPath:
      "/Game/Seria/NPC/N28/SKEL_N28_Face.SKEL_N28_Face",
    targetPackagePath: "/Game/Seria/NPC/N28",
    animationPackagePath: "/Game/Seria/NPC/N28/Animation",
    existingAssetPaths: [],
    dirtyPackageNames: [],
    warnings: [],
  };
  await page.route(
    "**/api/ue/npc-migration/supplement-target",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: target }),
      }),
  );
  await page.route(
    "**/api/ue/npc-migration/supplement-plan",
    (route) => {
      planRequestCount += 1;
      const request = route.request().postDataJSON() as {
        includedSourceFiles?: string[];
      };
      const includedFiles = request.includedSourceFiles
        ? new Set(request.includedSourceFiles)
        : null;
      const idleFile = "D:/FBX/N28/Animation/A_N28_Idle.fbx";
      const waveFile = "D:/FBX/N28/Animation/A_N28_Wave.fbx";
      const idleIncluded = includedFiles?.has(idleFile) ?? true;
      const waveIncluded = includedFiles?.has(waveFile) ?? true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            reviewToken: "b".repeat(64),
            kind: "actions",
            target,
            sourceDirectory: "D:/FBX/N28/Animation",
            npcPrefix: "A_N28_",
            items: [
              {
                sourceFile: idleFile,
                sourceAssetName: "A_N28_Idle",
                sourceModifiedTimeMs: 1_788_880_000_000,
                actionName: "Idle",
                targetAssetPath:
                  "/Game/Seria/NPC/N28/Animation/A_N28_Idle",
                bodyAssetPath: "",
                montageName: "AM_Idle1",
                montageAssetPath:
                  "/Game/Seria/NPC/N28/Animation/AM_Idle1",
                montageState: "create",
                montageSlotName: "IdleSlot",
                copyFaceCurves: false,
                makeMontage: true,
                state: "new",
                included: idleIncluded,
                blockedReason: "",
                pairedFace: null,
              },
              {
                sourceFile: waveFile,
                sourceAssetName: "A_N28_Wave",
                sourceModifiedTimeMs: 1_788_966_000_000,
                actionName: "Wave",
                targetAssetPath:
                  "/Game/Seria/NPC/N28/Animation/A_N28_Wave",
                bodyAssetPath: "",
                montageName: "AM_Wave",
                montageAssetPath:
                  "/Game/Seria/NPC/N28/Animation/AM_Wave",
                montageState: "create",
                montageSlotName: "IdleSlot",
                copyFaceCurves: false,
                makeMontage: false,
                state: "new",
                included: waveIncluded,
                blockedReason: "",
                pairedFace: {
                  sourceFile:
                    "D:/FBX/N28/Animation/Face/A_N28_Wave_Face.fbx",
                  sourceAssetName: "A_N28_Wave_Face",
                  sourceModifiedTimeMs: 1_788_966_100_000,
                  targetAssetPath:
                    "/Game/Seria/NPC/N28/Animation/Face/A_N28_Wave_Face",
                  state: "new",
                  copyFaceCurves: true,
                  blockedReason: "",
                },
              },
            ],
            canApply: idleIncluded || waveIncluded,
            blockedReasons: [],
            warnings: [
              "同名动作会按已审核清单重新导入并覆盖",
              "已自动匹配 1 个同名 _Face FBX，将在 Body 导入后连续处理且不重建 Montage",
            ],
          },
        }),
      });
    },
  );
  await page.route(
    "**/api/ue/npc-migration/supplement-apply",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            status: "partial",
            kind: "actions",
            importedAssetPaths: [
              "/Game/Seria/NPC/N28/Animation/A_N28_Wave.A_N28_Wave",
              "/Game/Seria/NPC/N28/Animation/Face/A_N28_Wave_Face.A_N28_Wave_Face",
            ],
            createdMontageAssetPaths: [],
            reusedMontageAssetPaths: [],
            montageFailures: [
              {
                sourceAssetName: "A_N28_Wave",
                montageName: "AM_Wave",
                error: "Montage factory failed",
              },
            ],
            lockedRootAssetPaths: [
              "/Game/Seria/NPC/N28/Animation/Face/A_N28_Wave_Face.A_N28_Wave_Face",
            ],
            curveCopiedBodyAssetPaths: [],
            processedBodyAssetPaths: [
              "/Game/Seria/NPC/N28/Animation/A_N28_Wave.A_N28_Wave",
            ],
            manualChecks: [
              "AM_Wave 未创建（A_N28_Wave）：Montage factory failed",
            ],
          },
        }),
      }),
  );
  await page.addInitScript(() => {
    window.sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
  });
  await page.goto("/");

  await page.getByRole("button", { name: "NPC 迁移" }).click();
  await page
    .getByRole("button", { name: /动作补充与修改/ })
    .click();
  await page.evaluate(() => {
    window.shotSandboxDesktop = {
      resolveNpcAnimationDirectory: async () => ({
        directoryPath: "D:/FBX/N28/Animation",
        matchedFileCount: 2,
        candidateDirectories: [
          "D:/FBX/N28/Animation",
          "D:/FBX/Archive/N28/Animation",
        ],
      }),
    } as unknown as NonNullable<Window["shotSandboxDesktop"]>;
  });
  await page.getByRole("button", { name: "读取 UE 目标" }).click();
  await expect(
    page.getByText("SKEL_N28", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "动作 FBX 目录" }),
  ).toHaveValue("D:/FBX/N28/Animation");
  await expect(
    page.getByText(
      "动作库已自动匹配 · 2 个 Body FBX · 已从 2 个候选中选择最佳目录",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "动作 FBX 目录" }),
  ).toHaveAttribute("readonly", "");
  await expect(page.getByText("动作库自动匹配")).toBeVisible();

  const actionNames = page.locator(
    ".npc-supplement-row__action > strong",
  );
  const selectAllCheckbox = page.getByRole("checkbox", {
    name: "全选可处理动作",
  });
  const actionCheckboxes = page.getByRole("checkbox", { name: /^处理 / });
  const sortControl = page.getByLabel("动作排序");
  await expect(actionNames).toHaveText(["Wave", "Idle"]);
  await expect(selectAllCheckbox).toBeChecked();
  await expect(
    page.getByText("动作清单", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("新增 Face", { exact: true })).toBeVisible();
  await expect(
    page.getByText("AM_Wave · IdleSlot", { exact: true }),
  ).toBeVisible();
  await sortControl.selectOption("modified-asc");
  await expect(actionNames).toHaveText(["Idle", "Wave"]);

  await selectAllCheckbox.uncheck();
  expect(
    await actionCheckboxes.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).checked),
    ),
  ).toEqual([false, false]);
  await expect(page.getByText("正在同步选择")).toBeVisible();
  await expect(page.getByText("正在同步选择")).toBeHidden();
  await selectAllCheckbox.check();
  expect(
    await actionCheckboxes.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).checked),
    ),
  ).toEqual([true, true]);
  await expect(page.getByText("正在同步选择")).toBeVisible();
  await expect(page.getByText("正在同步选择")).toBeHidden();
  await page
    .getByRole("checkbox", { name: "处理 A_N28_Idle" })
    .uncheck();
  await expect(page.getByText("正在同步选择")).toBeVisible();
  await expect(page.getByText("正在同步选择")).toBeHidden();
  expect(
    await selectAllCheckbox.evaluate(
      (element) => (element as HTMLInputElement).indeterminate,
    ),
  ).toBe(true);
  expect(planRequestCount).toBe(4);
  await expect(
    page.getByText("选择已自动审核：Body 1，Face 1"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "执行动作增补" }),
  ).toBeEnabled();

  const tableHeader = page.locator(".npc-supplement-table__head");
  const actionHeader = page.locator(
    ".npc-supplement-table__action-head",
  );
  const positions = await Promise.all([
    tableHeader.boundingBox(),
    actionHeader.boundingBox(),
    selectAllCheckbox.boundingBox(),
    sortControl.boundingBox(),
  ]);
  expect(positions.every(Boolean)).toBe(true);
  expect(positions[0]!.height).toBeLessThanOrEqual(32);
  expect(positions[2]!.x).toBeLessThan(positions[3]!.x);
  expect(positions[3]!.x).toBeGreaterThanOrEqual(positions[1]!.x);
  expect(positions[3]!.x + positions[3]!.width).toBeLessThanOrEqual(
    positions[1]!.x + positions[1]!.width + 1,
  );

  await page.screenshot({
    path: testInfo.outputPath("npc-action-supplement-sorted.png"),
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "执行动作增补" }).click();
  await expect(
    page.getByText("动作已导入，1 个 Montage 未创建；其余项已继续处理"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "执行有遗漏" }),
  ).toBeVisible();
  await expect(page.getByText("待补 Montage 1")).toBeVisible();
  await expect(
    page.getByText(
      "AM_Wave 未创建（A_N28_Wave）：Montage factory failed",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "返回分镜工作台" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "返回模块选择" })
    .click();
  await expect(
    page.getByRole("button", { name: /面部补充/ }),
  ).toBeVisible();
});
