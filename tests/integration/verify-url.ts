/**
 * Visual verification tool — navigates to a real URL in WebKit, injects
 * the hint mode harness, and takes before/after screenshots.
 *
 * Usage:
 *   VERIFY_URL=https://example.com npm run test:verify
 *   VERIFY_URL=https://example.com VERIFY_SELECTOR="nav" npm run test:verify
 *
 * Debug logging is controlled by TABI_DEBUG=1 in .env (build-time flag).
 *
 * Environment variables:
 *   VERIFY_URL       — URL to navigate to (required)
 *   VERIFY_SELECTOR  — CSS selector to crop screenshots to a specific area
 *
 * Outputs:
 *   tests/integration/screenshots/before.png  — page without hints
 *   tests/integration/screenshots/after.png   — page with hints active
 *   tests/integration/screenshots/element.png — cropped to --selector if provided
 *
 * Console output includes a JSON summary of discovered hints.
 */

import { test } from "@playwright/test";
import path from "path";
import fs from "fs";

const HARNESS_PATH = path.resolve(__dirname, "harness.js");
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");

test("verify hints on live URL", async ({ page }) => {
  const url = process.env.VERIFY_URL;
  if (!url) {
    console.log("No URL provided. Set VERIFY_URL env var.");
    test.skip();
    return;
  }

  const selector = process.env.VERIFY_SELECTOR;
  const viewportWidth = parseInt(process.env.VERIFY_WIDTH ?? "1280", 10);
  const viewportHeight = parseInt(process.env.VERIFY_HEIGHT ?? "900", 10);

  await page.setViewportSize({ width: viewportWidth, height: viewportHeight });

  // Capture console output from the page (debug logs, errors)
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "log" || type === "warn" || type === "error") {
      console.log(`[page:${type}]`, msg.text());
    }
  });

  // Navigate and wait for network idle
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  // Ensure screenshot directory exists
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Before screenshot
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "before.png"),
    fullPage: false,
  });
  console.log("Saved: screenshots/before.png");

  // Crop to selector if provided
  if (selector) {
    const el = page.locator(selector).first();
    await el.screenshot({ path: path.join(SCREENSHOT_DIR, "element.png") });
    console.log(`Saved: screenshots/element.png (${selector})`);
  }

  // Inject browser.runtime stub + harness
  await page.evaluate(() => {
    if (!(window as any).browser) {
      (window as any).browser = {
        runtime: { sendMessage: () => {} },
      };
    }
  });
  await page.addScriptTag({ path: HARNESS_PATH });

  // Activate hints and collect summary
  const summary = await page.evaluate(() => {
    const { KeyHandler, HintMode, Mode } = window.TestHarness;
    const kh = new KeyHandler();
    const hm = new HintMode(kh);
    hm.wireCommands();
    kh.on("exitToNormal", () => {
      if (hm.isActive()) hm.deactivate();
      kh.setMode(Mode.NORMAL);
    });
    hm.activate();

    const hints = Array.from(document.querySelectorAll(".tabi-hint")) as HTMLElement[];
    const hintData = hints.map((h) => {
      const label = h.textContent ?? "";
      const top = parseFloat(h.style.top);
      const left = parseFloat(h.style.left);
      // Walk up to find the target element
      const target = h.parentElement?.querySelector("[data-tabi-target]") as HTMLElement | null;
      const targetTag = target?.tagName ?? "unknown";
      const targetText = (target?.textContent ?? "").slice(0, 50).trim();
      return { label, top: Math.round(top), left: Math.round(left), targetTag, targetText };
    });

    return {
      totalHints: hints.length,
      hints: hintData.slice(0, 50), // cap at 50 for readability
    };
  });

  console.log(`\nDiscovered ${summary.totalHints} hints`);
  console.log(JSON.stringify(summary.hints, null, 2));

  // After screenshot (with hints visible)
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "after.png"),
    fullPage: false,
  });
  console.log("\nSaved: screenshots/after.png");

  // Crop to selector with hints if provided
  if (selector) {
    const el = page.locator(selector).first();
    await el.screenshot({ path: path.join(SCREENSHOT_DIR, "element-hints.png") });
    console.log(`Saved: screenshots/element-hints.png (${selector})`);
  }
});
