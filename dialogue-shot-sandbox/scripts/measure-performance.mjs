import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "@playwright/test";

// Serve only the production build and synthetic data, never the live UE bridge.
const label = process.argv[2] || "current";
const rows = Number(process.env.PERF_ROWS || 50_000);
assert.match(label, /^[a-zA-Z0-9_-]+$/);
assert.ok(Number.isInteger(rows) && rows > 0 && rows <= 1_000_000);
const payload = {
  dialogueText: [
    "##&Dialog.id,Dialog.NPCID,Dialog.Content,Dialog.NextID,Dialog.End",
    "##id,NPC,Content,Next,End",
    ...Array.from({ length: rows }, (_, index) =>
      `${100000 + index},1,${"Performance fixture dialogue ".repeat(8)}${index},,true`),
  ].join("\n"),
  startText: "##&DialogStart.id,DialogStart.Outline\n##id,Outline\n100000,Fixture",
  npcText: "##&NPC.id,NPC.name,NPC.npcintroduce\n##id,Name,Intro\n1,Player,Player",
  sourceName: "performance-fixture",
  modelText: "",
  missionText: "",
  dungeonMissionText: "",
  missionPositionText: "",
  mapConfigText: "",
  mapResourceText: "",
};
const root = resolve("dist");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    response.setHeader("Content-Type", "application/json");
    if (url.pathname === "/api/ue/config-data/read") {
      response.end(JSON.stringify({ ok: true, data: payload }));
    } else if (url.pathname === "/api/ue/dialogue/selection") {
      response.end(JSON.stringify({
        ok: true,
        data: { status: "empty", dialogueNodeId: null, selectedNodeCount: 0, nodes: [], message: "" },
      }));
    } else {
      response.statusCode = 503;
      response.end(JSON.stringify({ ok: false, error: { message: "Isolated performance run" } }));
    }
    return;
  }
  try {
    const path = resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
    assert.ok(path.startsWith(root + "\\") || path.startsWith(root + "/"));
    response.setHeader("Content-Type", types[extname(path)] || "application/octet-stream");
    response.end(await readFile(path));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem("shot-sandbox.launch-screen-seen", "1");
    window.shotSandboxDesktop = {
      getConfigurationWindowMode: async () => false,
      setConfigurationWindowMode: async (enabled) => enabled,
      getSetupStatus: async () => ({
        setupCompleted: true, firstRun: false, defaultDataReady: true,
        liveDataReady: true, configDataReady: true, version: "test",
      }),
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const samples = [];
  const timer = setInterval(async () => {
    try {
      const { metrics } = await cdp.send("Performance.getMetrics");
      samples.push(metrics.find((metric) => metric.name === "JSHeapUsedSize").value);
    } catch { /* The page may close between samples. */ }
  }, 100);
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "数据源状态", exact: true }).click();
    await page.getByText("performance-fixture", { exact: false }).first().waitFor({ state: "attached" });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".spin"));
  } finally {
    clearInterval(timer);
  }
  await page.getByRole("button", { name: "进入配置小窗", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".app-shell")?.getAttribute("data-configuration-mode") === "true");
  await page.waitForTimeout(2000);
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const result = {
    label, rows,
    peakRendererHeapMiB: Math.max(...samples) / 1024 / 1024,
    retainedRendererHeapMiB: metrics.find((metric) => metric.name === "JSHeapUsedSize").value / 1024 / 1024,
    ...await page.evaluate(() => ({
      canvasCount: document.querySelectorAll("canvas").length,
      loadedStage: performance.getEntriesByType("resource")
        .some((entry) => /\/StageView-/.test(entry.name)),
      scriptBytes: performance.getEntriesByType("resource")
        .filter((entry) => entry.name.endsWith(".js"))
        .reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    })),
    errors,
  };
  assert.equal(result.canvasCount, 0);
  assert.deepEqual(errors, []);
  if (process.argv.includes("--check")) assert.equal(result.loadedStage, false);
  await mkdir("artifacts/performance", { recursive: true });
  await page.screenshot({ path: `artifacts/performance/${label}.png` });
  await writeFile(`artifacts/performance/${label}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
