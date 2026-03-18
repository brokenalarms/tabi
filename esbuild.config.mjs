import { build } from "esbuild";
import "./loadEnv.mjs";

const outDir = "Tabi/Safari Extension/Resources";

await build({
  entryPoints: ["src/content.ts", "src/background.ts"],
  outdir: outDir,
  bundle: true,
  format: "iife",
  target: "es2020",
  sourcemap: false,
  logLevel: "info",
  define: {
    __TABI_DEBUG__: process.env.TABI_DEBUG === "1" ? "true" : "false",
  },
});
