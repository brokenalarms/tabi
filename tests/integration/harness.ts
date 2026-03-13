// Test harness entry point — exposes HintMode and KeyHandler as globals
// for Playwright integration tests. Built by esbuild before tests run.

import { KeyHandler } from "../../src/modules/KeyHandler";
import { HintMode } from "../../src/modules/HintMode";
import { Mode } from "../../src/commands";

declare global {
  interface Window {
    TestHarness: {
      KeyHandler: typeof KeyHandler;
      HintMode: typeof HintMode;
      Mode: typeof Mode;
    };
  }
}

window.TestHarness = { KeyHandler, HintMode, Mode };
