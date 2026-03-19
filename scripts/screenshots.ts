/**
 * Capture screenshots of tabi UI panels for PR review.
 *
 * Usage:
 *   npm run screenshots
 *
 * Outputs PNGs to scripts/screenshots/:
 *   hints.png      — hint mode with mode bar
 *   help.png       — help overlay
 *   tab-search.png — tab search modal
 */

import { test } from "@playwright/test";
import path from "path";
import fs from "fs";

const HARNESS_PATH = path.resolve(__dirname, "../tests/integration/harness.js");
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const CSS_DIR = path.resolve(__dirname, "../Tabi/Safari Extension/Resources/styles");

const CSS_FILES = ["themes.css", "panel.css", "hints.css", "tab-search.css", "help.css"];

async function setupPage(page: import("@playwright/test").Page, bodyHTML: string) {
  // Force dark color scheme so panels render with frosted glass on dark bg
  await page.emulateMedia({ colorScheme: "dark" });

  await page.setContent(`<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1024px; height: 768px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    background: #1a1a2e; color: #e0e0e0;
  }
</style></head>
<body>${bodyHTML}</body>
</html>`);

  // Load tabi CSS
  for (const file of CSS_FILES) {
    const css = fs.readFileSync(path.join(CSS_DIR, file), "utf-8");
    await page.addStyleTag({ content: css });
  }

  // Stub browser.runtime
  await page.evaluate(() => {
    (window as any).browser = {
      runtime: { sendMessage: () => Promise.resolve([]) },
    };
  });

  // Freeze animations for stable screenshots (same technique as Jetlag).
  // Force opacity:1 on hints since their fade-in animation won't run.
  await page.addStyleTag({
    content: "*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; } .tabi-hint-overlay { opacity: 1 !important; }",
  });

  await page.addScriptTag({ path: HARNESS_PATH });
}

test("screenshot: hint mode", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await setupPage(page, `
    <nav style="display:flex; gap:16px; padding:16px; background:rgba(255,255,255,0.06); border-bottom:1px solid rgba(255,255,255,0.1);">
      <a href="/home" style="padding:8px 16px; color:#ccc; text-decoration:none;">Home</a>
      <a href="/about" style="padding:8px 16px; color:#ccc; text-decoration:none;">About</a>
      <a href="/docs" style="padding:8px 16px; color:#ccc; text-decoration:none;">Docs</a>
      <button style="padding:8px 16px; margin-left:auto; background:#333; color:#eee; border:1px solid #555; border-radius:6px;">Sign In</button>
    </nav>
    <main style="padding:32px;">
      <h1 style="font-size:24px; margin-bottom:16px; color:#f0f0f0;">Welcome</h1>
      <p style="margin-bottom:16px; color:#aaa;">Navigate the web with your keyboard.</p>
      <div style="display:flex; gap:12px;">
        <a href="/start" style="padding:10px 20px; background:#0066cc; color:#fff; border-radius:6px; text-decoration:none;">Get Started</a>
        <a href="/learn" style="padding:10px 20px; border:1px solid #555; border-radius:6px; text-decoration:none; color:#ccc;">Learn More</a>
      </div>
    </main>
  `);

  await page.evaluate(() => {
    const { KeyHandler, HintMode, Mode } = window.TestHarness;
    const kh = new KeyHandler();
    const hm = new HintMode(kh);
    hm.wireCommands();
    kh.on("exitToNormal", () => {
      if (hm.isActive()) hm.deactivate();
      kh.setMode(Mode.NORMAL);
    });
    hm.activate(false);
  });

  await page.waitForSelector(".tabi-hint");

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "hints.png") });
});

test("screenshot: help overlay", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await setupPage(page, `
    <div style="padding:32px;">
      <h1 style="font-size:24px; color:#f0f0f0;">Some page content</h1>
      <p style="color:#aaa;">The help overlay appears in the bottom-right corner.</p>
    </div>
  `);

  await page.evaluate(() => {
    const { KeyHandler, HelpOverlay } = window.TestHarness;
    const kh = new KeyHandler();
    const ho = new HelpOverlay(kh);
    ho.activate();
  });

  await page.waitForSelector(".tabi-help-modal");

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "help.png") });
});

test("screenshot: tab search", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await setupPage(page, `
    <div style="padding:32px;">
      <h1 style="font-size:24px; color:#f0f0f0;">Background page</h1>
      <p style="color:#aaa;">The tab search modal appears centered at the top.</p>
    </div>
  `);

  // Build the tab search modal DOM directly (TabSearch.activate() needs
  // real browser.runtime.sendMessage which isn't available in Playwright)
  await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.className = "tabi-overlay";

    const modal = document.createElement("div");
    modal.className = "tabi-panel tabi-tab-search-modal";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Search tabs\u2026";
    modal.appendChild(input);

    const results = document.createElement("div");
    results.className = "tabi-tab-search-results";

    const tabs = [
      { title: "GitHub - brokenalarms/tabi", url: "github.com/brokenalarms/tabi", selected: true },
      { title: "Playwright Documentation", url: "playwright.dev/docs/intro", selected: false },
      { title: "MDN Web Docs", url: "developer.mozilla.org", selected: false },
      { title: "Stack Overflow - CSS backdrop-filter", url: "stackoverflow.com/questions/...", selected: false },
    ];

    for (const tab of tabs) {
      const item = document.createElement("div");
      item.className = "tabi-tab-search-item" + (tab.selected ? " selected" : "");
      const title = document.createElement("div");
      title.className = "tabi-tab-search-item-title";
      title.textContent = tab.title;
      const url = document.createElement("div");
      url.className = "tabi-tab-search-item-url";
      url.textContent = tab.url;
      item.appendChild(title);
      item.appendChild(url);
      results.appendChild(item);
    }

    modal.appendChild(results);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });

  await page.waitForSelector(".tabi-tab-search-modal");

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "tab-search.png") });
});
