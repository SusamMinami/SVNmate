import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const execFileAsync = promisify(execFile);
const executable = resolve(
  process.argv[2] || "artifacts/win-unpacked/镜头沙盘.exe",
);
const application = spawn(executable, [], {
  stdio: "ignore",
  windowsHide: true,
});

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:43127/mcp");
      if (response.status === 405) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw lastError || new Error("Packaged MCP server did not start");
}

const transport = new StreamableHTTPClientTransport(
  new URL("http://127.0.0.1:43127/mcp"),
);
const client = new Client({
  name: "packaged-storyboard-verifier",
  version: "1.0.0",
});

try {
  await waitForServer();
  const configResponse = await fetch(
    "http://127.0.0.1:43127/api/trae/mcp-config",
  );
  const configBody = await configResponse.json();
  const configuredUrl =
    configBody?.data?.config?.mcpServers?.[
      "internal-storyboard-collaboration"
    ]?.url;
  if (configuredUrl !== "http://127.0.0.1:43127/mcp") {
    throw new Error(`Unexpected packaged MCP URL: ${configuredUrl}`);
  }
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name);
  const required = [
    "storyboard_get_pending_request",
    "storyboard_submit_plan",
    "storyboard_fail_request",
    "storyboard_get_request_status",
  ];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`Packaged MCP is missing tools: ${missing.join(", ")}`);
  }
  console.log(
    JSON.stringify(
      {
        executable,
        connected: true,
        transport: "streamable-http",
        configuredUrl,
        tools: names,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close().catch(() => undefined);
  if (process.platform === "win32") {
    await execFileAsync("taskkill", [
      "/PID",
      String(application.pid),
      "/T",
      "/F",
    ]).catch(() => undefined);
  } else {
    application.kill("SIGTERM");
  }
}
