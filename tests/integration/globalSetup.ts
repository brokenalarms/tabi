import { build } from "esbuild";

export default async function globalSetup() {
  await build({
    entryPoints: ["tests/integration/harness.ts"],
    outfile: "tests/integration/harness.js",
    bundle: true,
    format: "iife",
    target: "es2020",
    logLevel: "warning",
  });
}
