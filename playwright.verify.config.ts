import { defineConfig } from "@playwright/test";
import "./loadEnv.mjs";

export default defineConfig({
  testDir: "tests/integration",
  testMatch: "verify-url.ts",
  timeout: 60000,
  use: {
    browserName: "webkit",
  },
  globalSetup: "./tests/integration/globalSetup.ts",
});
