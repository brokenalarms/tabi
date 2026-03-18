import { build } from "esbuild";
import "../../loadEnv.mjs";

export default async function globalSetup() {
  await build({
    entryPoints: ["tests/integration/harness.ts"],
    outfile: "tests/integration/harness.js",
    bundle: true,
    format: "iife",
    target: "es2020",
    logLevel: "warning",
    define: {
      __VIMIUM_DEBUG__: process.env.VIMIUM_DEBUG === "1" ? "true" : "false",
    },
  });
}
