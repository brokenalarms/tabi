// Layout-dependent integration tests — run in real WebKit via Playwright.
// These tests exercise viewport clipping, overflow:hidden, elementsFromPoint,
// and hint positioning, which require a real layout engine.

import { test, expect } from "@playwright/test";
import path from "path";

const HARNESS_PATH = path.resolve(__dirname, "harness.js");

/** Set up a page with the test harness and a stub browser global. */
async function setupPage(page: import("@playwright/test").Page, bodyHTML: string) {
  await page.setContent(`<!DOCTYPE html>
<html>
<head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1024px; height: 768px; }
</style></head>
<body>${bodyHTML}</body>
</html>`);

  // Stub the Safari browser.runtime API that HintMode uses
  await page.evaluate(() => {
    (window as any).browser = {
      runtime: { sendMessage: () => {} },
    };
  });

  await page.addScriptTag({ path: HARNESS_PATH });
}

/** Activate hint mode and return the number of hints created. */
async function activateHints(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const { KeyHandler, HintMode, Mode } = window.TestHarness;
    const kh = new KeyHandler();
    const hm = new HintMode(kh);
    hm.wireCommands();
    kh.on("exitToNormal", () => {
      if (hm.isActive()) hm.deactivate();
      kh.setMode(Mode.NORMAL);
    });
    hm.activate(false);
    const count = document.querySelectorAll(".vimium-hint").length;
    hm.destroy();
    return count;
  });
}

test("filters out elements below viewport", async ({ page }) => {
  // Visible link at top; second link far below the viewport (top: 2000px)
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <a href="#" style="position:absolute; top:10px; left:0;">Visible</a>
    <a href="#" style="position:absolute; top:2000px; left:0;">Below viewport</a>
  `);

  const hintCount = await activateHints(page);
  expect(hintCount).toBe(1);
});

test("filters element clipped by overflow:hidden ancestor", async ({ page }) => {
  // Container with overflow:hidden has a fixed height; button is positioned
  // below the container's visible area
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <div style="position:relative; width:200px; height:50px; overflow:hidden;">
      <button style="position:absolute; top:100px; left:10px; width:80px; height:20px;">
        Clipped
      </button>
    </div>
  `);

  const hintCount = await activateHints(page);
  expect(hintCount).toBe(0);
});

test("detects element behind transparent overlay via elementsFromPoint", async ({ page }) => {
  // Two stacked links at the same position — both should get hints because
  // elementsFromPoint returns all elements at a given point
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <a href="#a" style="position:absolute; top:10px; left:10px; width:200px; height:40px; z-index:1;">
      Front link
    </a>
    <a href="#b" style="position:absolute; top:10px; left:10px; width:200px; height:40px; z-index:0;">
      Back link
    </a>
  `);

  const hintCount = await activateHints(page);
  expect(hintCount).toBe(2);
});

test("targets nav text, not aria-hidden badge count", async ({ page }) => {
  // Anchor wraps an aria-hidden badge and visible nav text — hint should
  // position at the nav text, not the badge
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <a href="/mynetwork" style="position:absolute; top:0; left:30px; width:80px; height:50px;">
      <span aria-hidden="true" style="position:absolute; top:5px; left:20px; width:16px; height:16px;">2</span>
      <span style="position:absolute; top:30px; left:0; width:80px; height:16px;">My Network</span>
    </a>
  `);

  const hintTop = await page.evaluate(() => {
    const { KeyHandler, HintMode, Mode } = window.TestHarness;
    const kh = new KeyHandler();
    const hm = new HintMode(kh);
    hm.wireCommands();
    kh.on("exitToNormal", () => {
      if (hm.isActive()) hm.deactivate();
      kh.setMode(Mode.NORMAL);
    });
    hm.activate(false);
    const hintDiv = document.querySelector(".vimium-hint") as HTMLElement;
    const top = hintDiv ? parseFloat(hintDiv.style.top) : -1;
    hm.destroy();
    return top;
  });

  // Hint should target the nav text span (top ~30px), not the badge (top ~5px)
  expect(hintTop).toBeGreaterThanOrEqual(25);
});

test("skips visually-hidden 1x1 span inside large button", async ({ page }) => {
  // Button wraps a 1x1 visually-hidden span — hint should position at the
  // button, not the tiny span
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <button style="position:absolute; top:0; left:0; width:600px; height:600px;">
      <span style="position:absolute; top:5px; left:5px; width:1px; height:1px; overflow:hidden;">
        Activate to view larger image
      </span>
    </button>
  `);

  const hintTop = await page.evaluate(() => {
    const { KeyHandler, HintMode, Mode } = window.TestHarness;
    const kh = new KeyHandler();
    const hm = new HintMode(kh);
    hm.wireCommands();
    kh.on("exitToNormal", () => {
      if (hm.isActive()) hm.deactivate();
      kh.setMode(Mode.NORMAL);
    });
    hm.activate(false);
    const hintDiv = document.querySelector(".vimium-hint") as HTMLElement;
    const top = hintDiv ? parseFloat(hintDiv.style.top) : -1;
    hm.destroy();
    return top;
  });

  // Hint should target the button (top: 0), not the 1x1 span (top: 5)
  expect(hintTop).toBeLessThanOrEqual(2);
});
