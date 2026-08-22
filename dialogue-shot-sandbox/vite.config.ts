import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { larkBridgePlugin } from "./server/larkBridge";
import { traeBridgePlugin } from "./server/traeBridge";

export default defineConfig({
  plugins: [react(), traeBridgePlugin(), larkBridgePlugin()],
  server: {
    host: "127.0.0.1",
  },
});
