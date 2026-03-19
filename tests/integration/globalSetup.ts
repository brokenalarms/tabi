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
      __TABI_DEBUG__: process.env.TABI_DEBUG === "1" ? "true" : "false",
    },
  });
}
