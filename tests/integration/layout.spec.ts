// Layout-dependent integration tests — run in real WebKit via Playwright.
// These tests exercise viewport clipping, overflow:hidden, elementsFromPoint,
// and hint positioning, which require a real layout engine.

import { test, expect } from "@playwright/test";
import { NodeFilter } from "happy-dom";
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
    const style = getComputedStyle(heading);
    const fontSize = parseFloat(style.fontSize) || 0;
    const lineHeight = parseFloat(style.lineHeight) || 0;
    const halfLeading = lineHeight > fontSize ? (lineHeight - fontSize) / 2 : 0;
    const hints = Array.from(document.querySelectorAll(".vimium-hint")) as HTMLElement[];
    const hintTops = hints.map(h => parseFloat(h.style.top));

    hm.destroy();
    return { headingBottom: headingRect.bottom, halfLeading, hintTops };
  });

  // The heading link hint must be at or just below the visual text bottom
  // (headingBottom - halfLeading), not inside the heading text.
  const textBottom = result.headingBottom - result.halfLeading;
  const headingHintTop = result.hintTops.find(t =>
    t >= textBottom - 2 && t <= textBottom + 10
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
    const style = getComputedStyle(link);
    const fontSize = parseFloat(style.fontSize) || 0;
    const lineHeight = parseFloat(style.lineHeight) || 0;
    const halfLeading = lineHeight > fontSize ? (lineHeight - fontSize) / 2 : 0;
    const hint = document.querySelector(".vimium-hint") as HTMLElement;
    const hintTop = hint ? parseFloat(hint.style.top) : -1;

    hm.destroy();
    return {
      linkBottom: linkRect.bottom,
      firstLineBottom: clientRects[0]?.bottom ?? -1,
      lineCount: clientRects.length,
      halfLeading,
      hintTop,
    };
  });

  // Verify the link actually wraps (test precondition)
  expect(result.lineCount).toBeGreaterThan(1);
  // Pill is placed at rect.bottom - halfLeading, tightened to text bottom.
  expect(result.hintTop).toBe(result.linkBottom - result.halfLeading);
});

// Reddit "1 more reply": flex <a> is stretched to full grid width (~520px)
// but visible content (SVG + text) is ~100px on the left. Hint should center
// on the children's extent, not the full stretched box.
// SITE: reddit.com — comment thread "more replies" links
// FIX: Use union of children rects for horizontal centering.
test("stretched flex link hint centers on content, not full box", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <div style="display:grid; grid-template-columns:520px; padding:20px;">
      <a href="/more" id="link" style="display:flex; align-items:center; gap:4px; padding:4px 8px;">
        <span style="display:flex; align-items:center;">
          <svg width="16" height="16" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" fill="currentColor"/>
          </svg>
        </span>
        <span>1 more reply</span>
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
    // Compute expected content center from children
    const children = Array.from(link.children) as HTMLElement[];
    let contentLeft = Infinity, contentRight = 0;
    for (const child of children) {
      const cr = child.getBoundingClientRect();
      if (cr.width > 0) {
        contentLeft = Math.min(contentLeft, cr.left);
        contentRight = Math.max(contentRight, cr.right);
      }
    }
    const contentCenter = contentLeft + (contentRight - contentLeft) / 2;
    const boxCenter = linkRect.left + linkRect.width / 2;

    const hint = document.querySelector(".vimium-hint") as HTMLElement;
    const hintLeft = hint ? parseFloat(hint.style.left) : -1;

    hm.destroy();
    return { contentCenter, boxCenter, hintLeft, linkWidth: linkRect.width, contentWidth: contentRight - contentLeft };
  });

  // Precondition: content is significantly narrower than the box
  expect(result.contentWidth).toBeLessThan(result.linkWidth * 0.5);
  // Hint should be near the content center, not the box center
  expect(result.hintLeft).toBeCloseTo(result.contentCenter, 0);
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

// Direct walkerFilter test on FB Messenger DOM — traces every ancestor
// to find which element gets REJECTED and prunes the contacts subtree.
test("walkerFilter traces each ancestor of FB contact link", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const fs = await import("fs");
  const fixturePath = path.resolve(__dirname, "fixtures/fb-messenger-contacts.html");
  const fixtureHTML = fs.existsSync?.(fixturePath)
    ? fs.readFileSync(fixturePath, "utf-8") : "";

  // Realistic FB layout: sidebar on the right side of a wide page
  await setupPage(page, `
    <style>
      .x78zum5 { display: flex; }
      .xdt5ytf { flex-direction: column; }
      .x1n2onr6 { position: relative; }
      .x1iyjqo2 { flex-grow: 1; }
      .x2lwn1j { min-width: 0; }
      .x193iq5w { width: 100%; }
      .x1ey2m1c { position: absolute; }
      .x10l6tqk { top: 0; }
      .x13vifvy { bottom: 0; }
      .x47corl { right: 0; }
      .xg01cxk { left: 0; }
      .x1i10hfl { display: block; cursor: pointer; text-decoration: none; }
      .x1lliihq { color: inherit; }
      .xdl72j9 { overflow: hidden; }
      .html-div { padding: var(--x-paddingBlock, 0) var(--x-paddingInline, 0); }
    </style>
    <div style="display:flex;">
      <div style="flex:1; width:1000px; height:900px;">Main content</div>
      <div style="width:350px; overflow:hidden;">
        <div style="overflow-x:hidden; overflow-y:auto; height:900px;">
          ${fixtureHTML || `
          <ul style="list-style:none; padding:0; margin:0;">
            <li><div class="x78zum5 xdt5ytf"><div class="x78zum5 xdt5ytf x1iyjqo2 x2lwn1j"><div class="x78zum5 xdt5ytf">
              <a class="x1i10hfl x1n2onr6 xdl72j9 x1lliihq" href="/messages/t/1/" role="link" tabindex="0">
                <div class="html-div x78zum5 xdt5ytf" style="--x-paddingInline:8px;--x-paddingBlock:8px;">
                  <div class="x78zum5"><svg style="height:36px;width:36px;"><circle cx="18" cy="18" r="18" fill="#ccc"/></svg>
                  <span>Alice</span></div>
                </div>
                <div class="x1ey2m1c x10l6tqk x13vifvy x47corl xg01cxk" role="none" style="border-radius:8px;inset:0;"></div>
              </a>
            </div></div></div></li>
            <li><div><div data-visualcompletion="ignore-late-mutation"><div class="x78zum5 xdt5ytf"><div class="x78zum5 xdt5ytf x1iyjqo2 x2lwn1j"><div class="x78zum5 xdt5ytf">
              <a class="x1i10hfl x1n2onr6 xdl72j9 x1lliihq" href="/messages/t/2/" role="link" tabindex="0">
                <div class="html-div x78zum5 xdt5ytf" style="--x-paddingInline:8px;--x-paddingBlock:8px;">
                  <div class="x78zum5"><svg style="height:36px;width:36px;"><circle cx="18" cy="18" r="18" fill="#ccc"/></svg>
                  <span>Bob</span></div>
                </div>
                <div class="x1ey2m1c x10l6tqk x13vifvy x47corl xg01cxk" role="none"></div>
              </a>
            </div></div></div></div></div></li>
          </ul>`}
        </div>
      </div>
    </div>
  `);

  // Call walkerFilter directly on each contact <a> and every ancestor
  const trace = await page.evaluate(() => {
    const { walkerFilter } = window.TestHarness;
    const NF = NodeFilter;
    const links = document.querySelectorAll('a[href*="/messages/"]');
    return Array.from(links).map(a => {
      // Trace ancestors from body down to <a>
      const chain: Array<{tag: string; verdict: string; rect: string}> = [];
      const ancestors: HTMLElement[] = [];
      let el: HTMLElement | null = a as HTMLElement;
      while (el && el !== document.body) {
        ancestors.unshift(el);
        el = el.parentElement;
      }
      for (const anc of ancestors) {
        const v = walkerFilter(anc);
        const r = anc.getBoundingClientRect();
        chain.push({
          tag: anc.tagName + (anc.getAttribute("role") ? `[${anc.getAttribute("role")}]` : ""),
          verdict: v === NF.FILTER_ACCEPT ? "ACCEPT" : v === NF.FILTER_REJECT ? "REJECT" : "SKIP",
          rect: Math.round(r.width) + "x" + Math.round(r.height),
        });
      }
      return { href: (a.getAttribute("href") || "").slice(0, 25), chain };
    });
  });

  for (const link of trace) {
    console.log(`\n--- ${link.href} ---`);
    for (const step of link.chain) {
      const marker = step.verdict === "REJECT" ? "❌" : step.verdict === "ACCEPT" ? "✅" : "⏭️";
      console.log(`  ${marker} ${step.verdict} ${step.tag} ${step.rect}`);
    }
  }

  // No ancestor should REJECT
  for (const link of trace) {
    const rejects = link.chain.filter(s => s.verdict === "REJECT");
    expect(rejects).toEqual([]);
  }
});

// clip: rect(0 0 0 0) on a position:static ancestor has no visual effect
// but the walker's clip check must not REJECT the subtree.
test("clip on non-positioned ancestor does not prune visible links", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 768 });

  // First verify: does WebKit report clip on a static element?
  await setupPage(page, `
    <div id="static-clip" style="clip: rect(0 0 0 0); position: static;">
      <a href="/test" style="display:block; padding:10px;">Visible link</a>
    </div>
  `);

  const clipInfo = await page.evaluate(() => {
    const div = document.getElementById("static-clip")!;
    const s = getComputedStyle(div);
    return {
      clip: s.getPropertyValue("clip"),
      position: s.position,
      childVisible: div.querySelector("a")!.getBoundingClientRect().height > 0,
    };
  });
  console.log("Clip on static element:", JSON.stringify(clipInfo));

  const hintCount = await activateHints(page);
  console.log("Hints with clip on static ancestor:", hintCount);
  expect(hintCount).toBe(1);
});

// Multi-line heading link: inline <a> inside block <h2> has a bounding rect
// whose bottom corners extend into the adjacent metadata below. The metadata
// elements (<i>, <a>) are falsely detected as occluders because they appear
// at the heading link's bottom corners via elementsFromPoint.
// SITE: angrymetalguy.com — article heading links
// FIX: Adjacent content in a nearby sibling subtree is not a real occluder.
test("multi-line link inside heading is not falsely occluded by adjacent content", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <div style="display:flex; gap:20px; padding:20px;">
      <div style="width:300px; height:300px; background:#ccc;">
        <a href="/review/">
          <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
               style="width:300px; height:300px;">
        </a>
      </div>
      <div style="width:400px;">
        <h2 style="font-size:24px; line-height:1.3; margin:0; padding:0;">
          <a href="/review/" id="heading-link">Decipher – A Very Long Album Title That Wraps to Two Lines</a>
        </h2>
        <div id="meta" style="margin-top:-8px; padding:0; font-size:14px; line-height:1.3;">
          <i>By</i> <a href="/author/">Author Name</a> <i>in</i>
          <a href="/cat1/">Category One</a>, <a href="/cat2/">Category Two</a>
        </div>
      </div>
    </div>
  `);

  // Verify precondition: heading link bottom corners overlap with metadata
  const overlaps = await page.evaluate(() => {
    const link = document.getElementById("heading-link")!;
    const rect = link.getBoundingClientRect();
    const hit = document.elementsFromPoint(rect.left + 2, rect.bottom - 2)[0] as HTMLElement;
    return !link.contains(hit) && !hit.contains(link);
  });
  expect(overlaps).toBe(true);

  const verdict = await page.evaluate(() => {
    const { walkerFilter } = window.TestHarness;
    return walkerFilter(document.getElementById("heading-link")!);
  });

  expect(verdict).toBe(NodeFilter.FILTER_ACCEPT);
});

// Clicking a hint dispatches a click to the target element only after the
// collapse animation finishes. If deactivation interrupts the animation
// (e.g. from a layout shift), the click must NOT be dispatched.
test("hint click dispatches after collapse animation completes", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupPage(page, `
    <a id="target" href="#" style="position:absolute; top:50px; left:50px; width:100px; height:30px;">Link</a>
  `);

  // Inject the hint animation CSS so animationend fires in WebKit
  await page.addStyleTag({ content: `
    .vimium-hint-active {
      --poof-x: 0px; --poof-y: 0px;
      animation: vimium-hint-collapse 150ms ease-in forwards;
    }
    @keyframes vimium-hint-collapse {
      0%   { opacity: 1; transform: scale(1) translate(0,0); }
      100% { opacity: 0; transform: scale(0.3) translate(var(--poof-x), var(--poof-y)); }
    }
  `});

  const clicked = await page.evaluate(() => {
    return new Promise<boolean>((resolve) => {
      const target = document.getElementById("target")!;
      let wasClicked = false;
      target.addEventListener("click", () => { wasClicked = true; });

      const { KeyHandler, HintMode, Mode } = window.TestHarness;
      const kh = new KeyHandler();
      const hm = new HintMode(kh);
      hm.wireCommands();
      kh.on("exitToNormal", () => {
        if (hm.isActive()) hm.deactivate();
        kh.setMode(Mode.NORMAL);
      });
      hm.activate(false);

      // With a single element, the label is the first hint char "s".
      // Simulate typing it to trigger activateHint.
      const event = new KeyboardEvent("keydown", {
        key: "s", code: "KeyS", bubbles: true,
      });
      document.dispatchEvent(event);

      // Click should not have happened yet (animation is 150ms)
      const clickedBeforeAnimation = wasClicked;

      // Wait for animation to complete + buffer
      setTimeout(() => {
        resolve(!clickedBeforeAnimation && wasClicked);
      }, 300);
    });
  });

  expect(clicked).toBe(true);
});

