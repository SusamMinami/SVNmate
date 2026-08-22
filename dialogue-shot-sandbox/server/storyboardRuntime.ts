import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

function isSourceCheckout(path: string): boolean {
  return (
    existsSync(join(path, "mcp", "storyboardServer.ts")) &&
    existsSync(join(path, "src", "director", "contracts.ts"))
  );
}

export function storyboardRuntimeRoot(): string {
  const requestedRoot = resolve(
    process.env.STORYBOARD_PROJECT_ROOT || process.cwd(),
  );
  const appData = process.env.APPDATA;

  if (appData && isSourceCheckout(requestedRoot)) {
    return join(appData, "Shot Sandbox", "runtime");
  }
  return requestedRoot;
}
