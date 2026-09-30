import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const shots = new URL("../.impeccable/review/", import.meta.url);
await mkdir(shots, { recursive: true });
const errors = [];
const field = (page, member) => page.locator(".field").filter({
  has: page.getByText(member, { exact: true }),
});
const control = (page, member) => field(page, member).locator("input, select, textarea");
async function checkFieldName(page, member, slot) {
  const row = field(page, member);
  const title = await row.locator(".field-label > span").first().innerText();
  const target = slot === undefined ? control(page, member) : row.locator("input").nth(slot);
  const suffix = slot === undefined ? "" : ` ${await row.locator(".skill-slots label > span").nth(slot).innerText()}`;
  await expect(target).toHaveAccessibleName(title + suffix);
  await expect(target).toHaveAccessibleDescription(member);
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("dialog", d => d.accept());
  page.setDefaultNavigationTimeout(30000);
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:8766");
  await page.locator("#career-name").waitFor();
  await page.getByRole("button", { name: "技能配置", exact: true }).click();
  await page.locator("#linked-skill").selectOption("100001");
  await control(page, "Skill.skillname").fill("上挑·配置测试");
  await checkFieldName(page, "Skill.skillname");
  await page.getByRole("button", { name: "从此模板新建", exact: true }).click();
  await page.getByLabel("新技能 ID", { exact: true }).fill("1999001");
  await page.getByLabel("新技能树 ID（模板 1000001）", { exact: true }).fill("19990001");
  await page.getByRole("button", { name: "生成新建草稿", exact: true }).click();
  await expect(page.getByLabel("编辑记录", { exact: true })).toHaveValue("skill:1999001");
  await page.getByLabel("编辑记录", { exact: true }).selectOption("tree:19990001");
  await control(page, "Skillsystem.skillname").fill("上挑·技能树测试");
  await page.getByLabel("编辑记录", { exact: true }).selectOption("upgrade:1999001001");
  await control(page, "Skillupgrade.needsp").fill("2");
  await page.getByLabel("编辑记录", { exact: true }).selectOption("skill:1999001");
  await page.screenshot({ path: fileURLToPath(new URL("authoring-skill.png", shots)), fullPage: true });
  await page.getByRole("button", { name: "Buff 配置", exact: true }).click();
  await page.getByLabel("全库检索", { exact: true }).fill("100126");
  await expect(page.getByLabel("检索结果", { exact: true }).locator("option[value='100126']")).toHaveCount(1);
  await page.getByLabel("检索结果", { exact: true }).selectOption("100126");
  await page.getByRole("button", { name: "从此模板新建", exact: true }).click();
  await page.getByLabel("新Buff ID", { exact: true }).fill("1999001");
  await page.getByRole("button", { name: "生成新建草稿", exact: true }).click();
  await expect(page.getByLabel("编辑记录", { exact: true })).toHaveValue("buff:1999001");
  await control(page, "Buffbase.name").fill("合成草稿·技能增益");
  await checkFieldName(page, "Buffbase.name");
  await checkFieldName(page, "Buff.showicon");
  await page.locator("summary").filter({ hasText: "触发与后继" }).click();
  await control(page, "Buff.behavior").fill("1");
  await page.screenshot({ path: fileURLToPath(new URL("authoring-buff.png", shots)), fullPage: true });
  await page.getByLabel("配置类型", { exact: true }).selectOption("damage");
  await page.getByLabel("全库检索", { exact: true }).fill("1");
  await expect(page.getByLabel("检索结果", { exact: true }).locator("option[value='1']")).toHaveCount(1);
  await page.getByLabel("检索结果", { exact: true }).selectOption("1");
  await page.locator("summary").filter({ hasText: "附带 Buff" }).click();
  await control(page, "Skilldamage.skillbuff").nth(4).fill("1999001");
  await checkFieldName(page, "Skilldamage.skillbuff", 4);
  await page.getByRole("button", { name: "基础配置", exact: true }).click();
  await page.getByLabel("初始技能槽位 1", { exact: true }).fill("1999001;1");
  await page.reload();
  await page.locator("#career-name").waitFor();
  await expect(page.getByLabel("初始技能槽位 1", { exact: true })).toHaveValue("1999001;1");
  await page.getByRole("button", { name: "检查写入差异", exact: true }).click();
  await page.getByRole("dialog", { name: "审核隔离副本试写" }).waitFor({ timeout: 120000 });
  const review = await page.locator("dialog").innerText();
  for (const value of ["1999001001", "1999001040", "Buff.behavior", "Skilldamage.skillbuff", "CareerInfor.initial_skill"])
    assert.ok(review.includes(value), `Missing review ${value}`);
  await page.route("**/api/commit", route => route.fulfill({ json: {
    message: "合成UI回执：未执行业务 Excel 写入", paths: [],
  } }));
  await page.getByRole("button", { name: "确认试写副本", exact: true }).click();
  await expect(page.getByRole("button", { name: "检查写入差异", exact: true })).toBeDisabled();
  await context.close();

  for (const [file, width, height, scale] of [["authoring-1024", 1024, 768, 1.5], ["authoring-mobile", 390, 900, 1]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    p.on("pageerror", e => errors.push(e.message));
    await p.goto("http://127.0.0.1:8766");
    await p.locator("#career-name").waitFor();
    await p.getByRole("button", { name: "技能配置", exact: true }).click();
    await p.locator("#linked-skill").selectOption("100001");
    await control(p, "Skill.skillname").waitFor();
    await expect(p.getByLabel("检索结果", { exact: true }).locator("option[value='100001']")).toHaveCount(1);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} overflow`);
    await p.screenshot({ path: fileURLToPath(new URL(`${file}.png`, shots)), fullPage: true });
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS: skill/tree/40 levels clone, Buff creation, repeated damage slot, same-batch career link, retained drafts, real workbook review, simulated commit, accessible visible labels/descriptions, desktop/DPI/mobile bounds");
} finally { await browser.close(); }
