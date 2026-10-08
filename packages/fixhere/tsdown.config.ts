import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/vite.ts", "src/react.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  dts: { eager: true },
  // Workspace packages are private; inline them into the published build.
  deps: { alwaysBundle: [/^@fixhere\//] },
});
