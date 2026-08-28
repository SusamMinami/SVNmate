import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { larkBridgePlugin } from "./server/larkBridge";
import { traeBridgePlugin } from "./server/traeBridge";
import { restoreDevelopmentConfigCsvDirectory } from "./server/configRepository";
import { ueBridgePlugin } from "./server/ue/routes";

export default defineConfig(async () => {
  await restoreDevelopmentConfigCsvDirectory({
    environmentDirectory:
      process.env.SHOT_SANDBOX_DATA_CSV_DIRECTORY,
    appDataDirectory: process.env.APPDATA,
  });
  return {
    plugins: [react(), traeBridgePlugin(), ueBridgePlugin(), larkBridgePlugin()],
    server: {
      host: "127.0.0.1",
    },
  };
});
