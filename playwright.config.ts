import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/integration",
  testIgnore: ["verify-url.ts"],
  use: {
    browserName: "webkit",
  },
  globalSetup: "./tests/integration/globalSetup.ts",
});
