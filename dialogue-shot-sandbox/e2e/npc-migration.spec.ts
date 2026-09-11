import { expect, test } from "@playwright/test";

test("opens the NPC migration workspace without layout overflow", async ({
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
    page.getByText("自动估算胶囊体"),
  ).toBeVisible();
  await expect(page.getByText("标准 NPC ABP 模板")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "男性" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("迁移参数")).toBeVisible();
  await expect(page.getByText("执行审核")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "检查迁移计划" }),
  ).toBeEnabled();
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
  await expect(actionNames).toHaveText(["Wave", "Idle"]);
  await expect(page.getByText("新增 Face", { exact: true })).toBeVisible();
  await expect(
    page.getByText("AM_Wave · IdleSlot", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("动作排序").selectOption("modified-asc");
  await expect(actionNames).toHaveText(["Idle", "Wave"]);

  await page
    .getByRole("checkbox", { name: "处理 A_N28_Idle" })
    .uncheck();
  await expect(page.getByText("正在同步选择")).toBeVisible();
  await expect(page.getByText("正在同步选择")).toBeHidden();
  expect(planRequestCount).toBe(2);
  await expect(
    page.getByText("选择已自动审核：Body 1，Face 1"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "执行动作增补" }),
  ).toBeEnabled();

  const header = page.locator(".npc-supplement-list > header");
  const bulkActions = page.locator(".npc-supplement-list-actions");
  const sortControl = page.locator(".npc-supplement-sort");
  const positions = await Promise.all([
    header.boundingBox(),
    bulkActions.boundingBox(),
    sortControl.boundingBox(),
  ]);
  expect(positions.every(Boolean)).toBe(true);
  expect(positions[1]!.x).toBeLessThan(positions[2]!.x);

  await page.screenshot({
    path: testInfo.outputPath("npc-action-supplement-sorted.png"),
    fullPage: true,
  });
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
