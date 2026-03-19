import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "scripts",
  testMatch: "screenshots.ts",
  use: {
    browserName: "webkit",
  },
  globalSetup: "./tests/integration/globalSetup.ts",
});
