import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/integration",
  use: {
    browserName: "webkit",
  },
  globalSetup: "./tests/integration/globalSetup.ts",
});
