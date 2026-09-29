import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { listPackage } from "@electron/asar";

const packagePath = resolve(
  process.argv[2] || "artifacts/win-unpacked/resources/app.asar",
);
if (!existsSync(packagePath)) {
  throw new Error(`Desktop package not found: ${packagePath}`);
}

const packagedFiles = new Set(
  listPackage(packagePath).map((path) =>
    path.replace(/\\/g, "/").replace(/^\//, ""),
  ),
);
const requiredRuntimeFiles = [
  "desktop-dist/main.cjs",
  "dist/index.html",
  "node_modules/electron-updater/out/main.js",
  "node_modules/fs-extra/lib/index.js",
  "node_modules/zod/index.cjs",
  "node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js",
  "node_modules/papaparse/papaparse.js",
  "node_modules/three/build/three.cjs",
];
const missing = requiredRuntimeFiles.filter(
  (path) => !packagedFiles.has(path),
);
if (missing.length > 0) {
  throw new Error(
    `Desktop package is missing runtime files:\n${missing.join("\n")}`,
  );
}

process.stdout.write(
  `Desktop package verified (${packagedFiles.size} files): ${packagePath}\n`,
);
