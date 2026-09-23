import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { PNG } from "pngjs";
import { ExistingStoryboardReviewRequestSchema } from "../src/director/ruleAdvisorContracts";

const cameras = [
  { dialogueId: "735001", cameraPosition: [0.8, 1.6, 3.2], cameraTarget: [0, 1.45, 0] },
  { dialogueId: "735002", cameraPosition: [-0.8, 1.6, -3.2], cameraTarget: [0, 1.45, 0] },
].map((camera, index) => ({
  ...camera, cameraEndPosition: camera.cameraPosition, cameraEndTarget: camera.cameraTarget,
  cameraName: `c${index + 1}`, moveType: "EPush", focalLength: 50,
  cameraRollDegrees: 0, cameraMovement: "static", movementIntensity: "none",
}));

async function loadExisting(page: Page, info: TestInfo, validFormation = true) {
  // No UE, cloud library or local model is contacted by this test.
  await page.route("**/api/**", (route) => route.fulfill({
    status: 503, contentType: "application/json", body: '{"ok":false}',
  }));
  await page.route("**/api/ue/formation/read", (route) => route.fulfill({ json: {
    ok: true, data: validFormation ? {
      status: "found", message: "已读取 BP 站位", snapshot: {
        dialogueId: "7350", blueprintAssetPath: "/Game/Test/BP_735000.BP_735000",
        blueprintClassPath: "/Game/Test/BP_735000.BP_735000_C",
        dialogueModels: ["player", "M63_Cityguard"], warnings: [],
        slots: [0, 1].map((modelIndex) => ({
          modelIndex, componentName: `Actor_${modelIndex}`, componentGuid: `guid-${modelIndex}`,
          modelClassPath: modelIndex === 0 ? "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C"
            : "/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC.BP_M63_Cityguard_NPC_C",
          transform: { location: { x: 0, y: modelIndex === 0 ? -80 : 80, z: 0 },
            rotation: { pitch: 0, yaw: modelIndex === 0 ? 90 : -90, roll: 0 },
            scale: { x: 1, y: 1, z: 1 } },
        })),
      },
    } : { status: "not_found", message: "未找到 BP" },
  } }));
  await page.route("**/api/ue/dialogue/storyboard/read", (route) => route.fulfill({ json: {
    ok: true, data: { status: "found", dialogueAssetPath: "/Game/Test/735000.735000",
      warnings: [], message: "已读取 2 个已有镜头", nodes: cameras, configurations: [] },
  } }));
  const directory = info.outputPath("csv");
  await mkdir(directory, { recursive: true });
  const files = {
    "对话表.csv": [
      "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End,Dialog.State",
      "##对话ID,人物,内容,下一ID,结束,状态",
      "735000,,,735001,false,", "735001,1,这里发生了什么？,735002,false,0",
      "735002,101968,守卫已经离开。,,true,0",
      "736000,,,736001,false,", "736001,1,另一段对白。,736002,false,0",
      "736002,101968,新的回答。,,true,0",
    ],
    "对话表_开始节点.csv": [
      "##&DialogStart.id,DialogStart.Outline,DialogStart.Formation,DialogStart.Model",
      "##对话ID,剧情梗概,模板,模型",
      "735000,询问守卫,/Game/Test/BP_735000.BP_735000_C,player;M63_Cityguard",
      "736000,新对白,,player;M63_Cityguard",
    ],
    "NPC表.csv": [
      "##&NPC.id,NPC.name,NPC.npcintroduce,NPC.resource_id", "##id,名称,介绍,资源",
      "1,玩家,玩家,", "101968,商会安保,守卫,200135",
    ],
    "m模型资源表.csv": [
      "##&Model.id,,Model.path", "##id,配置,路径",
      "200135,/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC,/Game/Seria/NPC/M63_Cityguard/BP_M63_Cityguard_NPC.BP_M63_Cityguard_NPC_C",
    ],
  };
  for (const [name, lines] of Object.entries(files)) await writeFile(`${directory}/${name}`, lines.join("\n"));
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(directory);
  await page.getByLabel("四位数对话 ID 或对白内容").fill("7350");
  await page.getByRole("button", { name: "加载对白内容" }).click();
  await expect(page.locator(".shot-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "评估已有分镜", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "读取 BP 站位" }).click();
  await expect(page.locator(".shot-row")).toHaveCount(2);
}

test("reviews imported cameras on request, preserves pixels and shows per-shot feedback", async ({ page }, info) => {
  await loadExisting(page, info);
  let requests = 0;
  await page.route("**/api/rule-advisor/review", async (route) => {
    requests++;
    const request = ExistingStoryboardReviewRequestSchema.parse(route.request().postDataJSON());
    expect(request.candidate_frames).toHaveLength(2);
    request.candidate_frames.forEach((frame, index) => {
      expect(frame.camera.position).toEqual(cameras[index].cameraPosition);
      expect(frame.camera.target).toEqual(cameras[index].cameraTarget);
      expect(frame.image_data_url).toMatch(/^data:image\/jpeg;base64,/);
    });
    await route.fulfill({ json: { ok: true, data: {
      schema_version: "rule-camera-ranking.v1", request_id: request.input.request_id,
      model: "test-vlm", summary: "已评估原分镜",
      visual_scores: request.candidate_frames.map((frame, index) => ({
        shot_index: index, candidate_id: frame.candidate_id, candidate_label: frame.candidate_label,
        is_baseline: true, overall: 80 - index * 10, composition: 80, subject_readability: 80,
        occlusion: 80, continuity: 80,
        issues: [`第 ${index + 1} 镜建议增加视线空间`], assessment: `第 ${index + 1} 镜主体清晰，可改善留白。`,
      })),
      rankings: request.candidate_frames.map((frame, index) => ({
        shot_index: index, selected_candidate_id: frame.candidate_id,
        ranked_candidate_ids: [frame.candidate_id], reason: "只读评估",
      })),
    } } });
  });
  expect(requests).toBe(0);
  const canvas = page.locator(".stage-view canvas").first();
  await expect(canvas).toBeVisible();
  // Demand rendering settles when a real frame contains varied colors.
  await expect.poll(async () => {
    const pixels = PNG.sync.read(await canvas.screenshot()).data;
    const colors = new Set<number>();
    for (let i = 0; i < pixels.length; i += 256) colors.add(pixels.readUInt32BE(i));
    return colors.size;
  }).toBeGreaterThan(30);
  const before = PNG.sync.read(await canvas.screenshot());
  await page.getByRole("button", { name: "评估已有分镜", exact: true }).click();
  await expect(page.locator(".existing-review-control")).toContainText("视觉均分 75/100");
  await expect(page.locator(".existing-shot-review")).toContainText("视觉评分 80/100");
  const after = PNG.sync.read(await canvas.screenshot());
  expect(after.data.equals(before.data)).toBe(true);
  await page.locator(".shot-row").nth(1).click();
  await expect(page.locator(".existing-shot-review")).toContainText("第 2 镜建议增加视线空间");
  await expect(page.locator(".existing-shot-review .projection-issue--warning").first())
    .toHaveCSS("color", "rgb(138, 86, 18)");
  await expect(page.getByText(/实际：UE 已有镜头/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("existing-review-desktop.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".existing-shot-review")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("existing-review-desktop-1280.png") });
});

test("keeps rule feedback when model fails and skips model without BP coordinates", async ({ page }, info) => {
  await loadExisting(page, info);
  await page.getByRole("button", { name: "评估已有分镜", exact: true }).click();
  await expect(page.locator(".existing-review-control")).toContainText("已保留规则检查");
  await expect(page.locator(".existing-shot-review")).toBeVisible();
  await expect(page.locator(".existing-shot-review")).not.toContainText("视觉评分");
  await page.route("**/api/ue/formation/read", (route) => route.fulfill({
    json: { ok: true, data: { status: "not_found", message: "未找到 BP" } },
  }));
  let modelCalls = 0;
  await page.route("**/api/rule-advisor/review", (route) => {
    modelCalls++; return route.fulfill({ json: { ok: true, data: null } });
  });
  await page.getByRole("button", { name: "读取 BP 站位" }).click();
  await expect(page.locator(".shot-row")).toHaveCount(2);
  await page.getByRole("button", { name: "评估已有分镜", exact: true }).click();
  await expect(page.locator(".existing-review-control")).toContainText("角色站位不完整");
  expect(modelCalls).toBe(0);
});

test("stops evaluation and discards late results after changing dialogue", async ({ page }, info) => {
  await loadExisting(page, info);
  let release!: () => void;
  let calls = 0;
  let gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/rule-advisor/review", async (route) => {
    calls++;
    await gate;
    await route.fulfill({ json: { ok: true, data: null } }).catch(() => {});
  });
  await page.getByRole("button", { name: "评估已有分镜", exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole("button", { name: "停止评估", exact: true }).click();
  await expect(page.locator(".existing-review-control")).toContainText("评估已停止");
  release();
  gate = new Promise<void>((resolve) => { release = resolve; });
  await page.getByRole("button", { name: "重新评估已有分镜", exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await page.getByLabel("四位数对话 ID 或对白内容").fill("7360");
  await page.getByRole("button", { name: "加载对白内容" }).click();
  release();
  await expect(page.locator(".shot-row")).toHaveCount(0);
  await expect(page.locator(".existing-shot-review")).toHaveCount(0);
  await expect(page.locator(".existing-review-control")).toHaveCount(0);
});

test("previews, keeps, adopts and undoes a suggested camera without UE writes", async ({ page }, info) => {
  await loadExisting(page, info);
  let suggestionCalls = 0;
  let reviewPositions: number[][] = [];
  let selectedPosition: number[] = [];
  const writes: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/ue\/.*(?:export|write|apply)/.test(request.url())) writes.push(request.url());
  });
  await page.route("**/api/rule-advisor/review", async (route) => {
    const request = ExistingStoryboardReviewRequestSchema.parse(route.request().postDataJSON());
    const suggesting = request.purpose === "suggest_existing";
    if (suggesting) {
      suggestionCalls++;
      expect(request.candidate_frames.length).toBeGreaterThan(1);
      selectedPosition = [...request.candidate_frames.find((frame) => !frame.is_baseline)!.camera.position];
    } else reviewPositions = request.candidate_frames.map((frame) => [...frame.camera.position]);
    await route.fulfill({ json: { ok: true, data: {
      schema_version: "rule-camera-ranking.v1", request_id: request.input.request_id,
      model: "test-vlm", summary: "候选比较",
      visual_scores: request.candidate_frames.map((frame, index) => ({
        shot_index: frame.shot_index, candidate_id: frame.candidate_id, candidate_label: frame.candidate_label,
        is_baseline: frame.is_baseline, overall: frame.is_baseline ? 65 : 91 - index,
        composition: 80, subject_readability: 80, occlusion: 80, continuity: 80,
        issues: ["仍需确认 UE 中的场景遮挡"], assessment: frame.is_baseline ? "原镜头留白可改善。" : "人物间距更清晰，头顶空间更完整。",
      })),
      rankings: [{
        shot_index: request.candidate_frames[0].shot_index,
        selected_candidate_id: request.candidate_frames.at(-1)!.candidate_id,
        ranked_candidate_ids: request.candidate_frames.map((f) => f.candidate_id), reason: "比较",
      }],
    } } });
  });
  const evaluate = async () => {
    await page.getByRole("button", { name: /^(评估已有分镜|重新评估已有分镜)$/ }).click();
    await expect(page.locator(".existing-review-control")).toContainText("已完成 2 镜评估");
  };
  await evaluate();
  await page.getByRole("button", { name: "生成调整建议", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".existing-shot-suggestion")).toContainText("本轮比较 65 → 90/100");
  await expect(page.locator(".existing-shot-suggestion")).toBeFocused();
  const canvas = page.locator(".stage-view canvas").first();
  const before = PNG.sync.read(await canvas.screenshot());
  const originalFrameRestored = async () => {
    const current = PNG.sync.read(await canvas.screenshot());
    if (current.width !== before.width || current.height !== before.height) return false;
    let changed = 0;
    for (let i = 0; i < before.data.length; i += 4) {
      if (Math.abs(current.data[i] - before.data[i]) +
        Math.abs(current.data[i + 1] - before.data[i + 1]) +
        Math.abs(current.data[i + 2] - before.data[i + 2]) > 30) changed++;
    }
    return changed / (before.width * before.height) < 0.01;
  };
  await page.getByRole("button", { name: "预览调整方案", exact: true }).click();
  await expect(page.getByText("建议预览 · 尚未采纳", { exact: true })).toBeVisible();
  const proposed = PNG.sync.read(await canvas.screenshot());
  expect(proposed.data.equals(before.data)).toBe(false);
  await page.getByRole("button", { name: "返回原镜头", exact: true }).click();
  await expect.poll(originalFrameRestored).toBe(true);
  await page.getByRole("button", { name: "保留原镜头", exact: true }).click();
  await expect(page.locator(".existing-shot-suggestion")).toBeFocused();
  await expect(page.locator(".existing-shot-suggestion")).toContainText("已保留原镜头");
  await expect.poll(originalFrameRestored).toBe(true);
  await evaluate();
  expect(reviewPositions).toEqual(cameras.map((camera) => camera.cameraPosition));
  await page.getByRole("button", { name: "重新生成调整建议", exact: true }).click();
  await expect(page.getByRole("button", { name: "采纳到草稿", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "预览调整方案", exact: true }).click();
  await page.screenshot({ path: info.outputPath("suggestion-1440.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("suggestion-1280.png") });
  await page.getByRole("button", { name: "采纳到草稿", exact: true }).click();
  await expect(page.locator(".existing-shot-suggestion")).toBeFocused();
  await expect(page.locator(".existing-shot-suggestion")).toContainText("已采纳到本地草稿");
  await expect(page.locator(".existing-shot-review")).toHaveCount(0);
  await evaluate();
  expect(reviewPositions[0]).toEqual(selectedPosition);
  expect(reviewPositions[1]).toEqual(cameras[1].cameraPosition);
  await page.getByRole("button", { name: "撤销本次采纳", exact: true }).click();
  await expect(page.locator(".existing-shot-suggestion")).toBeFocused();
  await evaluate();
  expect(reviewPositions).toEqual(cameras.map((camera) => camera.cameraPosition));
  expect(suggestionCalls).toBe(2);
  expect(writes).toEqual([]);
});

test("rejects mismatched candidate scores and discards suggestions after changing dialogue", async ({ page }, info) => {
  await loadExisting(page, info);
  let calls = 0;
  let release: (() => void) | undefined;
  await page.route("**/api/rule-advisor/review", async (route) => {
    const request = route.request().postDataJSON();
    if (request.purpose === "review_existing") {
      await route.fulfill({ json: { ok: true, data: null } });
      return;
    }
    calls++;
    if (calls === 1) {
      await route.fulfill({ json: { ok: true, data: {
        schema_version: "rule-camera-ranking.v1", request_id: request.input.request_id,
        model: "test", summary: "缺失候选",
        visual_scores: [{ shot_index: 999, candidate_id: "wrong", candidate_label: "wrong",
          is_baseline: false, overall: 99, composition: 99, subject_readability: 99, occlusion: 99,
          continuity: 99, issues: [], assessment: "错误绑定" }],
        rankings: [{ shot_index: 999, selected_candidate_id: "wrong", ranked_candidate_ids: ["wrong"], reason: "wrong" }],
      } } });
      return;
    }
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { ok: true, data: null } }).catch(() => {});
  });
  await page.getByRole("button", { name: "评估已有分镜", exact: true }).click();
  await expect(page.locator(".existing-review-control")).toContainText("已保留规则检查");
  await page.getByRole("button", { name: "生成调整建议", exact: true }).click();
  await expect(page.locator(".existing-shot-suggestion")).toContainText("候选评分不完整或不匹配");
  await expect(page.getByRole("button", { name: "采纳到草稿" })).toHaveCount(0);
  await page.getByRole("button", { name: "重新生成调整建议", exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await page.getByRole("button", { name: "停止生成建议", exact: true }).click();
  await expect(page.locator(".existing-shot-suggestion")).toContainText("已停止生成建议");
  release?.();
  await page.getByRole("button", { name: "重新生成调整建议", exact: true }).click();
  await expect.poll(() => calls).toBe(3);
  await page.getByLabel("四位数对话 ID 或对白内容").fill("7360");
  await page.getByRole("button", { name: "加载对白内容" }).click();
  release?.();
  await expect(page.locator(".existing-shot-suggestion")).toHaveCount(0);
  await expect(page.locator(".shot-row")).toHaveCount(0);
});

test("keeps the original when alternatives score lower", async ({ page }, info) => {
  await loadExisting(page, info);
  await page.route("**/api/rule-advisor/review", async (route) => {
    const request = ExistingStoryboardReviewRequestSchema.parse(route.request().postDataJSON());
    if (request.purpose === "review_existing") {
      await route.fulfill({ json: { ok: true, data: null } });
      return;
    }
    const frames = request.candidate_frames;
    await route.fulfill({ json: { ok: true, data: {
      schema_version: "rule-camera-ranking.v1", request_id: request.input.request_id,
      model: "test", summary: "保留原镜头",
      visual_scores: frames.map((frame) => ({
        shot_index: frame.shot_index, candidate_id: frame.candidate_id, candidate_label: frame.candidate_label,
        is_baseline: frame.is_baseline, overall: frame.is_baseline ? 90 : 70,
        composition: 80, subject_readability: 80, occlusion: 80, continuity: 80,
        issues: [], assessment: "当前方案已有足够的视线空间。",
      })),
      rankings: [{ shot_index: frames[0].shot_index, selected_candidate_id: frames[0].candidate_id,
        ranked_candidate_ids: frames.map((f) => f.candidate_id), reason: "原画面更合适" }],
    } } });
  });
  await page.getByRole("button", { name: "评估已有分镜", exact: true }).click();
  await expect(page.locator(".existing-review-control")).toContainText("已保留规则检查");
  await page.getByRole("button", { name: "生成调整建议", exact: true }).click();
  await expect(page.locator(".existing-shot-suggestion")).toContainText("模型没有选出评分更高的可用方案");
  await expect(page.getByRole("button", { name: "采纳到草稿" })).toHaveCount(0);
  await expect(page.locator(".shot-row").first()).toContainText("已有镜头 · c1");
});
