import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { ok: false } }),
  );
  await page.addInitScript(() => {
    sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
  });
});

test("reveals the empty mission target toolbar and traces each control frame", async ({
  page,
}, testInfo) => {
  await page.goto("/?motion=full");
  await page.getByRole("button", { name: "任务目标物", exact: true }).click();

  const workspace = page.getByRole("region", {
    name: "任务目标物",
    exact: true,
  });
  const query = workspace.locator(".mission-target-query");
  const taskInput = workspace.getByLabel("任务节点 ID");
  const blueprintInput = workspace.getByLabel("BP 文件名", {
    exact: true,
  });
  const readSelection = workspace.getByRole("button", {
    name: "读取 UE 选择",
  });
  const clearPreview = workspace.getByRole("button", {
    name: "清除预览",
  });
  const iconAndActionButtons = [
    workspace.getByRole("button", { name: "解析任务目标物" }),
    workspace.getByRole("button", { name: "展开对话节点 ID" }),
    workspace.getByRole("button", { name: "检查 BP 与对话模型" }),
    readSelection,
    workspace.getByRole("button", { name: "返回分镜工作台" }),
    clearPreview,
  ];
  const frameInputs = [taskInput, blueprintInput];
  const controls = [...frameInputs, ...iconAndActionButtons];
  const boundsBefore = await Promise.all(
    controls.map((control) => control.boundingBox()),
  );

  await expect(workspace).toHaveAttribute(
    "data-empty-entry-phase",
    "revealing",
  );
  expect(
    await query.evaluate(
      (element) => getComputedStyle(element, "::before").animationName,
    ),
  ).toBe("mission-target-empty-header-reveal");
  for (const input of frameInputs) {
    await expect(input).toHaveCSS(
      "animation-name",
      "mission-target-empty-frame-trace",
    );
  }
  for (const button of iconAndActionButtons) {
    await expect(button).toHaveCSS("animation-name", "none");
  }
  const delays = await Promise.all(
    frameInputs.map((input) =>
      input.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).animationDelay) * 1_000,
      ),
    ),
  );
  expect(delays).toEqual([...delays].sort((left, right) => left - right));
  expect(new Set(delays).size).toBe(2);

  await workspace.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      if (
        animation instanceof CSSAnimation &&
        animation.animationName.startsWith("mission-target-empty-")
      ) {
        animation.pause();
        animation.currentTime = 520;
      }
    }
  });
  const tracedFrame = await taskInput.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.backgroundImage.match(/rgba?\([^)]+\)/)?.[0],
      origin: style.backgroundOrigin,
      clip: style.backgroundClip,
    };
  });
  expect(tracedFrame.origin).toBe(
    "border-box, border-box, border-box, border-box",
  );
  expect(tracedFrame.clip).toBe(
    "border-box, border-box, border-box, border-box",
  );
  await page.screenshot({
    path: testInfo.outputPath("mission-target-empty-entry.png"),
    fullPage: true,
  });
  await workspace.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) {
      animation.play();
    }
  });

  await expect(workspace).toHaveAttribute(
    "data-empty-entry-phase",
    "settled",
  );
  await expect(taskInput).toHaveCSS(
    "border-top-color",
    tracedFrame.color!,
  );
  expect(
    await Promise.all(controls.map((control) => control.boundingBox())),
  ).toEqual(boundsBefore);
  await page.getByRole("button", { name: "分镜工作台", exact: true }).click();
  await page.getByRole("button", { name: "任务目标物", exact: true }).click();
  await expect(workspace).toHaveAttribute(
    "data-empty-entry-phase",
    "revealing",
  );
});

test("shows the complete empty mission target workspace with reduced motion", async ({
  page,
}) => {
  await page.goto("/?motion=reduced");
  await page.getByRole("button", { name: "任务目标物", exact: true }).click();

  const workspace = page.getByRole("region", {
    name: "任务目标物",
    exact: true,
  });
  const taskInput = workspace.getByLabel("任务节点 ID");
  await expect(workspace).toHaveAttribute(
    "data-empty-entry-phase",
    "settled",
  );
  await expect(taskInput).toHaveCSS("animation-name", "none");
  await expect(taskInput).not.toHaveCSS(
    "border-top-color",
    "rgba(0, 0, 0, 0)",
  );
  expect(
    await workspace.evaluate(
      (element) =>
        element
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation instanceof CSSAnimation &&
              animation.animationName.startsWith("mission-target-empty-"),
          ).length,
    ),
  ).toBe(0);
});
