import { build } from "esbuild";

// CLI env takes precedence over .env file
const cliDebug = process.env.TABI_DEBUG;
await import("./loadEnv.mjs");

const outDir = "Tabi/Safari Extension/Resources";

await build({
  entryPoints: ["src/content.ts", "src/background.ts", "src/popup.ts"],
  outdir: outDir,
  bundle: true,
  format: "iife",
  target: "es2020",
  sourcemap: false,
  logLevel: "info",
  define: {
    __TABI_DEBUG__: (cliDebug ?? process.env.TABI_DEBUG) === "1" ? "true" : "false",
  },
});
