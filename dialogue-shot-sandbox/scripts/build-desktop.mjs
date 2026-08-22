import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "external",
  external: ["electron"],
  sourcemap: false,
  minify: false,
  logLevel: "info",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["desktop/main.ts"],
    outfile: "desktop-dist/main.cjs",
    loader: { ".md": "text" },
  }),
  build({
    ...shared,
    entryPoints: ["desktop/preload.ts"],
    outfile: "desktop-dist/preload.cjs",
  }),
]);
