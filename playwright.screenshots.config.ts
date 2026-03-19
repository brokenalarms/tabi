import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "scripts",
  testMatch: "screenshots.ts",
  use: {
    browserName: "chromium",
  },
  globalSetup: "./tests/integration/globalSetup.ts",
});
