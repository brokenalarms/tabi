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

test("contentless overlay does not occlude sibling interactive elements", async ({ page }) => {
  // Stretched-link card pattern: empty <a> overlay positioned over a card
  // with a visible comment link sibling. The overlay is contentless (no text,
  // no images) so it should be exempt from occluding the real link beneath.
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <div style="position:relative; width:300px; height:200px;">
      <a href="/article" style="position:absolute; inset:0; z-index:1;"></a>
      <p style="padding:10px;">Card content text</p>
      <a href="/comments" style="position:relative; z-index:2; margin:10px;">3 comments</a>
    </div>
  `);

  const hintCount = await activateHints(page);
  // Both the overlay link and the comment link should get hints
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

// Google search result: block <a> with <h3> heading + site info below.
// Heading redirect fires — getClientRects on inline headings returns per-line
// rects, and padding-bottom subtraction can push the hint into the heading.
// The hint must sit below the h3's bounding rect, not overlap it.
// SITE: google.com — search result links
// FIX: Skip getClientRects and padding-bottom subtraction for heading-redirect targets.
test("heading redirect hint sits below h3, not inside it", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });

  // Inline h3 with wrapping text: getClientRects returns per-line rects.
  // Without the fix, picking the first line rect positions the hint mid-heading.
  await setupPage(page, `
    <div style="width:600px; padding:20px;">
      <a href="/result" id="link" style="display:block; text-decoration:none;">
        <h3 id="heading" style="font-size:20px; line-height:1.3; display:inline;">
          Chelsea 2-0 Man Utd: Women's League Cup glory secured as Lauren James and Aggie Beever-Jones score
        </h3>
        <br>
        <div style="display:flex; align-items:center; gap:8px; padding:4px 0;">
          <span>Sky Sports</span>
          <cite>https://www.skysports.com</cite>
        </div>
      </a>
      <p style="margin-top:4px;">
        <a href="/readmore" id="readmore">Read more</a>
      </p>
    </div>
  `);

  const result = await page.evaluate(() => {
    const { KeyHandler, HintMode, Mode } = window.TestHarness;
    const kh = new KeyHandler();
    const hm = new HintMode(kh);
    hm.wireCommands();
    kh.on("exitToNormal", () => {
      if (hm.isActive()) hm.deactivate();
      kh.setMode(Mode.NORMAL);
    });
    hm.activate(false);

    const heading = document.getElementById("heading")!;
    const headingRect = heading.getBoundingClientRect();
    const hints = Array.from(document.querySelectorAll(".vimium-hint")) as HTMLElement[];
    const hintTops = hints.map(h => parseFloat(h.style.top));

    hm.destroy();
    return { headingBottom: headingRect.bottom, hintTops };
  });

  // The heading link hint must be at or just below the heading bottom edge,
  // not inside the heading text (which would mean delta < 0).
  const headingHintTop = result.hintTops.find(t =>
    t >= result.headingBottom - 2 && t <= result.headingBottom + 10
  );
  expect(headingHintTop).toBeDefined();
});

// Multi-line inline link: hint must sit below the last line, not the first.
// getClientRects() returns per-line rects for inline elements — using the
// first rect would position the hint mid-link. getBoundingClientRect()
// gives the full bounding box whose bottom is the last line's bottom.
test("multi-line link hint sits below last line", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <div style="width:300px; padding:20px;">
      <a href="/article" id="link" style="font-size:16px; line-height:1.4;">
        This is a long link that wraps to multiple lines due to the narrow container width
      </a>
    </div>
  `);

  const result = await page.evaluate(() => {
    const { KeyHandler, HintMode, Mode } = window.TestHarness;
    const kh = new KeyHandler();
    const hm = new HintMode(kh);
    hm.wireCommands();
    kh.on("exitToNormal", () => {
      if (hm.isActive()) hm.deactivate();
      kh.setMode(Mode.NORMAL);
    });
    hm.activate(false);

    const link = document.getElementById("link")!;
    const linkRect = link.getBoundingClientRect();
    const clientRects = link.getClientRects();
    const hint = document.querySelector(".vimium-hint") as HTMLElement;
    const hintTop = hint ? parseFloat(hint.style.top) : -1;

    hm.destroy();
    return {
      linkBottom: linkRect.bottom,
      firstLineBottom: clientRects[0]?.bottom ?? -1,
      lineCount: clientRects.length,
      hintTop,
    };
  });

  // Verify the link actually wraps (test precondition)
  expect(result.lineCount).toBeGreaterThan(1);
  // Pill is placed at rect.bottom + 2; the 4px tail intrudes into the text.
  // hintTop should be exactly linkBottom + 2.
  expect(result.hintTop).toBe(result.linkBottom + 2);
});

// Container-style hint: wide element with branching children in a repeating
// container (<li>) gets a glow border + inside-end pill (no pointer tail).
// The glow wraps the <li>, the pill is vertically centered on the right edge.
test("container element gets glow border and inside-end pill", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <ul style="list-style:none; padding:0;">
      <li id="item" style="width:400px; height:80px; padding:10px;">
        <a href="/article" id="link" style="display:block; width:100%; height:100%; text-decoration:none;">
          <span>Article Title</span>
          <span>Description text here</span>
        </a>
      </li>
    </ul>
  `);

  const result = await page.evaluate(() => {
    const { KeyHandler, HintMode, Mode } = window.TestHarness;
    const kh = new KeyHandler();
    const hm = new HintMode(kh);
    hm.wireCommands();
    kh.on("exitToNormal", () => {
      if (hm.isActive()) hm.deactivate();
      kh.setMode(Mode.NORMAL);
    });
    hm.activate(false);

    const item = document.getElementById("item")!;
    const itemRect = item.getBoundingClientRect();
    const glow = document.querySelector(".vimium-hint-container-glow") as HTMLElement;
    const hint = document.querySelector(".vimium-hint") as HTMLElement;
    const tail = document.querySelector(".vimium-hint-tail");

    const res = {
      hasGlow: glow !== null,
      hasTail: tail !== null,
      hintTransform: hint?.style.transform ?? "",
      // Glow should wrap the <li>
      glowLeft: glow ? parseFloat(glow.style.left) : -1,
      glowTop: glow ? parseFloat(glow.style.top) : -1,
      glowWidth: glow ? parseFloat(glow.style.width) : -1,
      glowHeight: glow ? parseFloat(glow.style.height) : -1,
      // Pill should be vertically centered on the element
      hintTop: hint ? parseFloat(hint.style.top) : -1,
      itemMidY: itemRect.top + itemRect.height / 2,
      itemRight: itemRect.right,
    };

    hm.destroy();
    return res;
  });

  // Container style: has glow, no tail
  expect(result.hasGlow).toBe(true);
  expect(result.hasTail).toBe(false);
  // Pill uses translate(-100%, -50%) for inside-end placement
  expect(result.hintTransform).toBe("translate(-100%, -50%)");
  // Pill is vertically centered on the element
  expect(result.hintTop).toBeCloseTo(result.itemMidY, 0);
  // Glow dimensions approximately match the element
  expect(result.glowWidth).toBeGreaterThan(390);
  expect(result.glowHeight).toBeGreaterThan(70);
});

test("hint targets button, not visually-hidden 1x1 span inside it", async ({ page }) => {
  // Button wraps a 1x1 visually-hidden span. The hint should be positioned
  // relative to the button's bounding rect (pill-below-pointer at bottom + 2),
  // not the tiny span's position. Button top=0, height=100, so hint ~102px.
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <button style="position:absolute; top:0; left:0; width:200px; height:100px;">
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

  // Pill-below-pointer: hint is placed at button.bottom + 2 = ~102px.
  // If hint targeted the span instead, it'd be near 5+1+2 = ~8px.
  expect(hintTop).toBeGreaterThan(90);
  expect(hintTop).toBeLessThan(110);
});
