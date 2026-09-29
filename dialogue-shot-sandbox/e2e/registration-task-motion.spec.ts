import { expect, test, type Page, type Route } from "@playwright/test";
import type { BackgroundPropImportPreview } from "../src/types";

async function isolate(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { ok: false } }));
  await page.addInitScript(() => sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1"));
  return errors;
}

async function hidden(page: Page, value: boolean) {
  await page.evaluate((next) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: next });
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
}

const actor = {
  actorRef: "BP_Guard_C_0", label: "测试守卫", classPath: "/Game/Test/BP_Guard.BP_Guard_C",
  transform: { location: { x: 100, y: 200, z: 300 }, rotation: { pitch: 0, yaw: 90, roll: 0 },
    scale: { x: 1, y: 1, z: 1 } },
};
const selection = { mapAssetPath: "/Game/Test/Maps/TestMap", actors: [actor] };
const scan = {
  selection, candidates: [{
    actor, modelOptions: [{ id: 200135, configuredPath: "/Game/Test/BP_Guard",
      generatedClassPath: actor.classPath, rowNumber: 3 }],
    npcOptions: [{ id: 101968, name: "守卫", note: "", introduction: "", resourceId: 200135,
      title: "安保", canTurn: true, hasDialogue: false, hasAvatar: false }],
    positionMatches: [], targetMatches: [], mapId: "1204", mapName: "测试地图",
    mapOptions: [{ id: "1204", name: "测试地图", resourceId: "100128",
      assetPath: selection.mapAssetPath, rowNumber: 3 }],
  }],
};

for (const density of [1, 1.25, 1.5, 2]) {
  test.describe(`registration feedback ${density * 100}%`, () => {
    test.use({ deviceScaleFactor: density });
    test("one notice covers read, cancel, uncertain write and unsaved Excel success", async ({ page }, info) => {
      const errors = await isolate(page);
      const pending = new Map<string, Route>();
      let writes = 0;
      await page.route("**/api/ue/selection/registration", (route) => { pending.set("read", route); });
      await page.route("**/api/ue/config-registration/write", (route) => { writes++; pending.set("write", route); });
      const take = async (key: string) => {
        await expect.poll(() => pending.has(key)).toBe(true);
        const route = pending.get(key)!;
        pending.delete(key);
        return route;
      };
      await page.goto("/");
      await page.getByRole("button", { name: "注册 NPC", exact: true }).click();
      const region = page.getByRole("region", { name: "注册 NPC", exact: true });
      const glyph = page.locator(".npc-registration-modal .task-glyph");
      const read = region.getByRole("button", { name: "读取 UE 选择" });
      const readIcon = page.locator('.npc-registration-modal .operation-icon[data-kind="read"]');
      await read.click();
      await expect(glyph).toHaveCount(1);
      await expect(glyph).toHaveAttribute("data-phase", "running");
      await expect(readIcon).toHaveAttribute("data-running", "true");
      await expect(readIcon.locator("svg")).toHaveCSS("animation-name", "operation-read");
      await expect(glyph).toHaveAttribute("data-running", "false");
      await expect(region.locator(".spin")).toHaveCount(0);
      await page.getByRole("button", { name: "分镜工作台", exact: true }).click();
      await expect(readIcon).toHaveAttribute("data-running", "false");
      await expect(glyph).toHaveAttribute("data-running", "false");
      await (await take("read")).fulfill({ status: 400, json: { ok: false, error: { message: "读取选择失败" } } });
      await page.getByRole("button", { name: "注册 NPC", exact: true }).click();
      await expect(glyph).toHaveAttribute("data-phase", "failed");
      await read.click();
      await hidden(page, true);
      await expect(readIcon).toHaveAttribute("data-running", "false");
      await hidden(page, false);
      await (await take("read")).fulfill({ json: { ok: true, data: scan } });
      await expect(glyph).toHaveAttribute("data-phase", "ready");
      const write = region.getByRole("button", { name: "写入新增项", exact: true });
      page.once("dialog", (dialog) => dialog.dismiss());
      await write.click();
      await expect(glyph).toHaveAttribute("data-phase", "cancelled");
      expect(writes).toBe(0);
      page.once("dialog", (dialog) => dialog.accept());
      await write.click();
      await expect(glyph).toHaveAttribute("data-phase", "running");
      await expect(write.locator(".operation-icon")).toHaveAttribute("data-running", "true");
      await expect(write.locator("svg")).toHaveCSS("animation-name", "operation-write");
      await expect(region.locator('.operation-icon[data-running="true"]')).toHaveCount(1);
      await expect(region.getByLabel("选择待注册 Actor 测试守卫")).toBeDisabled();
      await expect(region.getByLabel("测试守卫 MapID")).toBeDisabled();
      await page.mouse.move(900, 500);
      await page.screenshot({ path: info.outputPath(`registration-writing-${density}.png`) });
      await (await take("write")).fulfill({ status: 500, json: { ok: false, error: { message: "Excel 连接中断" } } });
      await expect(glyph).toHaveAttribute("data-phase", "uncertain");
      await expect(write.locator(".operation-icon")).toHaveAttribute("data-running", "false");
      await expect(region.getByRole("alert")).toContainText("核对 Excel 未保存内容");
      // Simulates the operator checking Excel and explicitly retrying.
      await page.emulateMedia({ reducedMotion: "reduce" });
      page.once("dialog", (dialog) => dialog.accept());
      await write.focus();
      await page.keyboard.press("Enter");
      await expect(glyph).toHaveAttribute("data-running", "false");
      await (await take("write")).fulfill({ json: { ok: true, data: {
        createdModels: [], createdNpcs: [], createdTargets: [{ actorRef: actor.actorRef, id: 500010 }],
        reusedTargets: [], openedWorkbooks: ["fixture.xlsm"],
      } } });
      await expect(glyph).toHaveAttribute("data-phase", "success");
      await expect(region.getByRole("status")).toContainText("未保存草稿");
      await expect(write).toBeDisabled();
      expect(writes).toBe(2);
      expect(await glyph.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
      await page.screenshot({ path: info.outputPath(`registration-success-${density}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(errors).toEqual([]);
    });
  });
}

test("target inspection and background overlay keep one feedback location", async ({ page }, info) => {
  const errors = await isolate(page);
  const pending = new Map<string, Route>();
  for (const action of ["inspect-blueprint", "background-props/inspect", "background-props/apply"]) {
    await page.route(`**/api/ue/mission-targets/${action}`, (route) => { pending.set(action, route); });
  }
  await page.route("**/api/ue/selection/read", (route) => route.fulfill({ json: { ok: true, data: selection } }));
  const take = async (key: string) => {
    await expect.poll(() => pending.has(key)).toBe(true);
    const route = pending.get(key)!;
    pending.delete(key);
    return route;
  };
  await page.goto("/");
  await page.getByRole("button", { name: "任务目标物", exact: true }).click();
  const region = page.getByRole("region", { name: "任务目标物", exact: true });
  const glyph = region.locator(".task-glyph");
  await region.getByLabel("BP 文件名").fill("BP_204800");
  await region.getByRole("button", { name: "检查 BP 与对话模型" }).click();
  await expect(glyph).toHaveCount(1);
  await expect(glyph).toHaveAttribute("data-phase", "running");
  await (await take("inspect-blueprint")).fulfill({ status: 400, json: { ok: false, error: { message: "未找到 BP" } } });
  await expect(glyph).toHaveAttribute("data-phase", "failed");
  await region.getByRole("button", { name: "检查 BP 与对话模型" }).click();
  await (await take("inspect-blueprint")).fulfill({ json: { ok: true, data: {
    blueprintState: "empty", blueprintAssetPath: "/Game/Test/BP_204800", dialogueId: "204800",
    slots: [], appendSlots: [], message: "检查已就绪，尚未写入",
  } } });
  await expect(glyph).toHaveAttribute("data-phase", "ready");
  const read = region.getByRole("button", { name: "读取 UE 选择" });
  const preview: BackgroundPropImportPreview = {
    blueprintAssetPath: "/Game/Test/BP_204800", mapAssetPath: selection.mapAssetPath, reviewToken: "fixture",
    blockedReasons: [], rootTransform: actor.transform, willCreatePlayerSlot: false, willCreateCameraSlot: false,
    items: [{
      actorRef: actor.actorRef, actorLabel: actor.label, action: "create", importMode: "background",
      componentName: "Guard", assetPath: actor.classPath, assetKind: "blueprint_actor",
      componentClass: "ChildActorComponent", assetPropertyName: "ChildActorClass", message: "新增组件",
      relativeTransform: actor.transform, worldTransform: actor.transform,
    }],
  };
  await read.click();
  await (await take("background-props/inspect")).fulfill({ json: { ok: true, data: preview } });
  const dialog = page.getByRole("dialog", { name: "UE 选择写入 BP" });
  await expect(dialog).toBeVisible();
  await expect(glyph).toHaveCount(1);
  await expect(glyph).toHaveAttribute("data-phase", "ready");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(glyph).toHaveAttribute("data-phase", "cancelled");
  await read.click();
  await (await take("background-props/inspect")).fulfill({ json: { ok: true, data: preview } });
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "写入 BP", exact: true }).click();
  await expect(glyph).toHaveCount(1);
  await expect(glyph).toHaveAttribute("data-phase", "running");
  await expect(dialog.getByRole("checkbox").first()).toBeDisabled();
  await page.screenshot({ path: info.outputPath("targets-background-writing.png") });
  await (await take("background-props/apply")).fulfill({ status: 500, json: { ok: false, error: { message: "UE 连接中断" } } });
  await expect(glyph).toHaveAttribute("data-phase", "uncertain");
  await expect(dialog.getByRole("alert")).toContainText("核对 UE 资产");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await read.click();
  await (await take("background-props/inspect")).fulfill({ json: { ok: true, data: preview } });
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "写入 BP", exact: true }).click();
  await (await take("background-props/apply")).fulfill({ json: { ok: true, data: {
    status: "updated", createdComponentNames: ["Guard"], updatedComponentNames: [], saved: true,
  } } });
  await expect(dialog).toHaveCount(0);
  await expect(glyph).toHaveCount(1);
  await expect(glyph).toHaveAttribute("data-phase", "success");
  const body = region.locator(".mission-target-body");
  const successNotice = body.locator(".mission-target-message");
  await expect(successNotice).toBeVisible();
  const widthBeforeOverflow = await body.evaluate((element) => element.clientWidth);
  await body.evaluate((element) => {
    const spacer = document.createElement("div");
    spacer.dataset.testScrollSpacer = "true";
    spacer.style.height = "1200px";
    element.append(spacer);
  });
  await expect(region.locator(".inspector-overlay-scrollbar__thumb")).toBeVisible();
  expect(await body.evaluate((element) => element.clientWidth)).toBe(
    widthBeforeOverflow,
  );
  const verticalAlignment = await successNotice.evaluate((element) => {
    const noticeBounds = element.getBoundingClientRect();
    const glyphBounds = element.querySelector(".task-glyph")!.getBoundingClientRect();
    const textBounds = element.querySelector(":scope > span:last-child")!.getBoundingClientRect();
    const noticeCenter = noticeBounds.top + noticeBounds.height / 2;
    return Math.max(
      Math.abs(glyphBounds.top + glyphBounds.height / 2 - noticeCenter),
      Math.abs(textBounds.top + textBounds.height / 2 - noticeCenter),
    );
  });
  expect(verticalAlignment).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("targets-success-aligned.png") });
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(() =>
      successNotice.evaluate((notice) => {
        const noticeBounds = notice.getBoundingClientRect();
        const bodyBounds = notice.parentElement!.getBoundingClientRect();
        return noticeBounds.bottom <= bodyBounds.top;
      }),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test("target errors stay centered and map reload interruptions remain recoverable", async ({
  page,
}, info) => {
  const errors = await isolate(page);
  const plan = {
    taskId: "331102",
    taskName: "乐园广场目标物",
    taskSource: "任务表",
    mapId: "1204",
    mapName: "乐园广场",
    mapAssetPath: "/Game/Test/Maps/ParadiseSquare",
    targets: [
      {
        targetId: "102464",
        type: 3,
        description: "任务触发器",
        npcId: 0,
        npcName: "",
        modelId: 0,
        modelClassPath: "",
        itemId: 0,
        blueprintModelId: null,
        mapId: "1204",
        previewKind: "marker",
        transform: actor.transform,
      },
    ],
    warnings: [],
  };
  await page.route("**/api/ue/mission-targets/resolve", async (route) => {
    const { taskId } = route.request().postDataJSON();
    if (taskId === "331101") {
      await route.fulfill({
        status: 400,
        json: {
          ok: false,
          error: {
            message: "任务节点 331101 的显示目标物存在重复 ID：102464",
          },
        },
      });
      return;
    }
    await route.fulfill({ json: { ok: true, data: plan } });
  });
  await page.route("**/api/ue/mission-targets/map-status", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          currentMapAssetPath: "/Game/Test/Maps/Old",
          expectedMapAssetPath: plan.mapAssetPath,
          matches: false,
        },
      },
    }),
  );
  await page.route("**/api/ue/mission-targets/load", (route) =>
    route.fulfill({
      status: 500,
      json: {
        ok: false,
        error: {
          message:
            "UE 自动切换到 乐园广场 失败：'this' pointer is invalid. 'this' pointer is invalid.",
        },
      },
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "任务目标物", exact: true }).click();
  const region = page.getByRole("region", { name: "任务目标物", exact: true });
  const taskInput = region.getByLabel("任务节点 ID");
  const resolveButton = region.getByRole("button", { name: "解析任务目标物" });
  const queryLayout = await region.evaluate((element) => {
    const regionBounds = element.getBoundingClientRect();
    const query = element.querySelector<HTMLElement>(".mission-target-query")!;
    const body = element.querySelector<HTMLElement>(".mission-target-body")!;
    const taskField = element.querySelector<HTMLInputElement>("#mission-task-id")!;
    const blueprintField = element.querySelector<HTMLInputElement>(
      "#mission-blueprint-name",
    )!;
    const queryBounds = query.getBoundingClientRect();
    return {
      topGap: queryBounds.top - regionBounds.top,
      height: queryBounds.height,
      bodyGap: body.getBoundingClientRect().top - queryBounds.bottom,
      fieldTopDelta:
        taskField.getBoundingClientRect().top -
        blueprintField.getBoundingClientRect().top,
    };
  });
  expect(Math.abs(queryLayout.topGap)).toBeLessThanOrEqual(1);
  expect(queryLayout.height).toBeLessThanOrEqual(58);
  expect(Math.abs(queryLayout.bodyGap)).toBeLessThanOrEqual(1);
  expect(Math.abs(queryLayout.fieldTopDelta)).toBeLessThanOrEqual(1);

  await taskInput.fill("331101");
  await resolveButton.click();
  await expect(resolveButton).toBeEnabled();
  await resolveButton.click();
  const duplicateNotice = region.locator(
    ".mission-target-body .mission-target-message",
  );
  await expect(duplicateNotice).toContainText("重复 ID：102464");
  await expect(duplicateNotice).toHaveAttribute("data-phase", "failed");
  expect(
    await duplicateNotice.evaluate((element) => {
      const notice = element.getBoundingClientRect();
      const glyph = element.querySelector(".task-glyph")!.getBoundingClientRect();
      const text = element
        .querySelector(":scope > span:last-child")!
        .getBoundingClientRect();
      const noticeCenter = notice.top + notice.height / 2;
      return Math.max(
        Math.abs(glyph.top + glyph.height / 2 - noticeCenter),
        Math.abs(text.top + text.height / 2 - noticeCenter),
      );
    }),
  ).toBeLessThanOrEqual(1);
  await page.mouse.move(900, 500);
  await page.waitForTimeout(350);
  await page.screenshot({
    path: info.outputPath("targets-duplicate-centered.png"),
  });

  await taskInput.fill("331102");
  await resolveButton.click();
  await expect(resolveButton).toBeEnabled();
  await resolveButton.click();
  await region.getByRole("button", { name: "加载到 UE" }).click();
  const mapChoice = region.getByRole("alertdialog", {
    name: "选择地图加载方式",
  });
  await mapChoice.getByRole("button", { name: "软件自动切换" }).click();
  const pendingChoice = region.getByRole("alertdialog", {
    name: "等待 UE 完成地图加载",
  });
  await expect(pendingChoice.getByRole("status")).toContainText(
    "大型关卡加载期间可能暂时无法响应",
  );
  await expect(pendingChoice).not.toContainText("pointer is invalid");
  await expect(
    pendingChoice.getByRole("button", { name: "检查并加载" }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("targets-map-load-recoverable.png"),
  });
  expect(errors).toEqual([]);
});
