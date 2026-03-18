import { build } from "esbuild";
import "./loadEnv.mjs";

const outDir = "Vimium/Safari Extension/Resources";

await build({
  entryPoints: ["src/content.ts", "src/background.ts"],
  outdir: outDir,
  bundle: true,
  format: "iife",
  target: "es2020",
  sourcemap: false,
  logLevel: "info",
  define: {
    __VIMIUM_DEBUG__: process.env.VIMIUM_DEBUG === "1" ? "true" : "false",
  },
});
