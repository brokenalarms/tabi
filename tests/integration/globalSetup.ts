import { build } from "esbuild";
import "../../loadEnv.mjs";

const shared = {
  bundle: true,
  format: "iife" as const,
  target: "es2020",
  logLevel: "warning" as const,
  define: {
    __TABI_DEBUG__: process.env.TABI_DEBUG === "1" ? "true" : "false",
  },
};

export default async function globalSetup() {
  await Promise.all([
    build({
      ...shared,
      entryPoints: ["tests/integration/harness.ts"],
      outfile: "tests/integration/harness.js",
    }),
    build({
      ...shared,
      entryPoints: ["src/settings.ts"],
      outfile: "tests/integration/settings.js",
    }),
  ]);
}
