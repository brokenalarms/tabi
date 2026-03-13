import { build } from "esbuild";

const outDir = "Vimium/Safari Extension/Resources";

await build({
  entryPoints: ["src/content.ts", "src/background.ts"],
  outdir: outDir,
  bundle: true,
  format: "iife",
  target: "es2020",
  sourcemap: false,
  logLevel: "info",
});
