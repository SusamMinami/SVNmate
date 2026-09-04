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
  await expect(
    page.getByRole("heading", { name: "NPC 迁移" }),
  ).toBeVisible();
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
