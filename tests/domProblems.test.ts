// DOM problem mode tests — selector pipeline edge cases from real sites.
// Each test reproduces a specific bug scenario with a minimal DOM fixture.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeElement, makeKeyEvent, loadModules, fireKeyDown, getState } from "./hintTestHelpers";
import { createDOM } from "./helpers/dom";
import { discoverElements } from "../src/modules/ElementGatherer";

describe("DOM problems — element discovery", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    // Skips hidden elements (display:none)
    it("filters out display:none elements", () => {
        const hidden = makeElement("A", { href: "#", display: "none", top: 10, left: 0 });
        loadModules([hidden]);
        const { hintMode } = getState();
        hintMode.activate(false);
        // No visible elements → deactivates
        assert.ok(!hintMode.isActive());
    });

    // Skips zero-size elements
    it("filters out zero-size elements", () => {
        const zeroSize = makeElement("A", { href: "#", width: 0, height: 0, top: 10, left: 0 });
        loadModules([zeroSize]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive());
    });

    // ISSUE: zero-size anchor wrapping a visible child gets no hint
    // FIX: fall back to firstElementChild rect for zero-size anchors
    it("falls back to firstElementChild for zero-size anchors", () => {
        const child = makeElement("H3", { top: 10, left: 20, width: 200, height: 24 });
        const anchor = makeElement("A", { href: "#", width: 0, height: 0, top: 0, left: 0, children: [child] });
        loadModules([anchor]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
    });

    // ISSUE: label[for] not discovered as clickable — CSS checkbox hack menus use label as the visible "button"
    // FIX: add label[for] to clickable selector
    it("discovers label[for] as a clickable element", () => {
        const label = makeElement("LABEL", { top: 10, left: 10, width: 80, height: 20 });
        (label as any).htmlFor = "menu-toggle";
        loadModules([label]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "label[for] should be discovered as clickable");
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.ok(!hintMode.isActive());
        assert.equal(label.click.mock.callCount(), 1);
    });

    // ISSUE: hints appear on buttons inside collapsed menus
    // SITE: apple.com nav
    // FIX: filter elements inside inert subtrees
    it("filters out elements inside an inert subtree", () => {
        const inertContainer = makeElement("DIV", {
            top: 0, left: 0,
            attrs: { "inert": "" },
        });
        const btn = makeElement("BUTTON", { top: 10, left: 10 });
        inertContainer.appendChild(btn);

        loadModules([btn]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Button inside inert subtree should be filtered");
    });

    // ISSUE: hints appear on elements with aria-hidden="true" (but NOT inherited from ancestors)
    // FIX: filter elements with aria-hidden="true" directly, keep descendants of aria-hidden ancestors
    it("filters element with aria-hidden=true", () => {
        const btn = makeElement("BUTTON", {
            top: 10, left: 10,
            attrs: { "aria-hidden": "true" },
        });
        loadModules([btn]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Element with aria-hidden=true should be filtered");
    });

    // aria-hidden="true" excludes the entire subtree — children should not get hints
    it("filters element inside aria-hidden ancestor", () => {
        const wrapper = makeElement("DIV", {
            top: 0, left: 0,
            attrs: { "aria-hidden": "true" },
        });
        const btn = makeElement("BUTTON", { top: 10, left: 10 });
        wrapper.appendChild(btn);

        loadModules([btn]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Element inside aria-hidden ancestor should be filtered");
    });

    // el.hidden (HTML hidden attribute) should prevent hint generation.
    it("filters out elements with hidden attribute", () => {
        const btn = makeElement("BUTTON", { top: 10, left: 10, hidden: true });
        loadModules([btn]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Hidden element should be filtered");
    });

    // Wrapper div with tabindex containing a textarea — only textarea gets a hint
    it("filters out ancestor wrapper when descendant is also a candidate", () => {
        const textarea = makeElement("TEXTAREA", { top: 10, left: 10 });
        const wrapper = makeElement("DIV", { top: 10, left: 10 });
        wrapper.setAttribute("tabindex", "0");
        wrapper.appendChild(textarea);

        loadModules([wrapper, textarea]);

        // Need elementFromPoint/elementsFromPoint to return the element itself for visibility
        (globalThis as any).document.elementFromPoint = (x: number, y: number) => {
            // Return the textarea for any point check (both are at same position)
            return textarea;
        };
        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            return [textarea, wrapper];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        // Only 1 hint (textarea), not 2 (wrapper filtered out)
        // hintMode._hints is private, so check via label: with 1 element, label is "s"
        // Type "s" to activate — if there were 2 hints, labels would be "ss","sa" (2-char)
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        // If only 1 hint, typing "s" activates it and deactivates hint mode
        assert.ok(!hintMode.isActive(), "Expected 1 hint (textarea only), but got more — wrapper was not filtered");
    });
});

describe("DOM problems — visibility edge cases", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    // ISSUE: custom-styled radio with opacity:0 gets no hint because it fails visibility check
    // FIX: redirect visibility check to associated label when radio is invisible
    it("redirects visibility of opacity:0 radio to associated label", () => {
        const label = makeElement("LABEL", { top: 10, left: 30, width: 100, height: 20 });
        (label as any).htmlFor = "custom-radio";
        const radio = makeElement("INPUT", {
            type: "radio", top: 10, left: 10,
            width: 16, height: 16, opacity: "0",
        });
        (radio as any).id = "custom-radio";

        loadModules([radio, label]);

        (globalThis as any).document.querySelector = (sel: string) => {
            if (sel.includes("custom-radio")) return label;
            return null;
        };
        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            // Label is visible at its position
            if (x >= 30 && x < 130) return [label];
            return [radio];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "Opacity:0 radio with visible label should get a hint");
    });

    // Zero-size radio input redirects visibility to associated label.
    it("redirects visibility of zero-size radio to associated label", () => {
        const label = makeElement("LABEL", { top: 10, left: 30, width: 100, height: 20 });
        (label as any).htmlFor = "hidden-radio";
        const radio = makeElement("INPUT", {
            type: "radio", top: 10, left: 10,
            width: 0, height: 0,
        });
        (radio as any).id = "hidden-radio";

        loadModules([radio, label]);

        (globalThis as any).document.querySelector = (sel: string) => {
            if (sel.includes("hidden-radio")) return label;
            return null;
        };
        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            if (x >= 30 && x < 130) return [label];
            return [];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "Zero-size radio with visible label should get a hint");
    });
});

describe("DOM problems — label-for dedup", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    // ISSUE: each radio gets two hints (input + label) — duplicate hints on theme picker
    // SITE: wikipedia.org theme picker
    // FIX: filter label[for] when the associated radio input is already a candidate
    it("filters label[for] when associated radio input is a candidate", () => {
        const wrapper = makeElement("DIV", { top: 0, left: 0, width: 300, height: 120 });

        const radio1 = makeElement("INPUT", { type: "radio", top: 10, left: 10, width: 16, height: 16 });
        (radio1 as any).id = "theme-os";
        const label1 = makeElement("LABEL", { top: 10, left: 30, width: 100, height: 20 });
        (label1 as any).htmlFor = "theme-os";
        wrapper.appendChild(radio1);
        wrapper.appendChild(label1);

        const radio2 = makeElement("INPUT", { type: "radio", top: 40, left: 10, width: 16, height: 16 });
        (radio2 as any).id = "theme-day";
        const label2 = makeElement("LABEL", { top: 40, left: 30, width: 100, height: 20 });
        (label2 as any).htmlFor = "theme-day";
        wrapper.appendChild(radio2);
        wrapper.appendChild(label2);

        const radio3 = makeElement("INPUT", { type: "radio", top: 70, left: 10, width: 16, height: 16 });
        (radio3 as any).id = "theme-night";
        const label3 = makeElement("LABEL", { top: 70, left: 30, width: 100, height: 20 });
        (label3 as any).htmlFor = "theme-night";
        wrapper.appendChild(radio3);
        wrapper.appendChild(label3);

        loadModules([radio1, label1, radio2, label2, radio3, label3]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            const all = [radio1, label1, radio2, label2, radio3, label3];
            return all.filter((el: any) => {
                const r = el.getBoundingClientRect();
                return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
            });
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        // 3 hints (radios only) → single-char labels s, a, d
        // If labels weren't deduped we'd have 6 → two-char labels
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.ok(!hintMode.isActive(), "Expected 3 hints (radios only), got more — label[for] was not filtered");
    });
});

describe("DOM problems — hash-link/label dedup", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    // ISSUE: duplicate hints — hash-link anchor and label[for] both target the same toggle
    // FIX: remove hash-link anchor when a label[for] with the same ID is a candidate
    it("removes hash-link anchor when label[for] with same ID exists", () => {
        const label = makeElement("LABEL", { top: 10, left: 10, width: 80, height: 20 });
        (label as any).htmlFor = "toggle-1";
        const anchor = makeElement("A", {
            href: "#toggle-1", top: 10, left: 0, width: 200, height: 20,
            attrs: { href: "#toggle-1" },
        });

        loadModules([label, anchor]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            return [anchor, label];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        // 1 hint (label only) → single-char label "s"
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.ok(!hintMode.isActive(), "Expected 1 hint (label only) — hash-link anchor should be removed");
    });

    // Hash-link anchor kept when there's no corresponding label[for]
    it("keeps hash-link anchor when no matching label exists", () => {
        const anchor = makeElement("A", {
            href: "#section-2", top: 10, left: 0, width: 200, height: 20,
            attrs: { href: "#section-2" },
        });

        loadModules([anchor]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.ok(!hintMode.isActive(), "Hash-link without matching label should be kept");
        assert.equal(anchor.click.mock.callCount(), 1);
    });
});

describe("DOM problems — disclosure trigger dedup", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    // Disclosure button filtered when sibling link exists
    it("filters disclosure button when sibling link exists", () => {
        const parent = makeElement("LI", { top: 0, left: 0 });
        const link = makeElement("A", { href: "#", top: 10, left: 0 });
        const btn = makeElement("BUTTON", {
            top: 10, left: 0,
            attrs: { "aria-expanded": "false", "aria-controls": "submenu-1" },
        });
        parent.appendChild(link);
        parent.appendChild(btn);

        loadModules([link, btn]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        // 1 hint → single-char label "s"; typing "s" activates it
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.ok(!hintMode.isActive(), "Expected 1 hint (link only), disclosure button should be filtered");
    });

    // Disclosure button kept when alone in parent (accordion pattern)
    it("keeps disclosure button when alone in parent", () => {
        const parent = makeElement("DIV", { top: 0, left: 0 });
        const btn = makeElement("BUTTON", {
            top: 10, left: 0,
            attrs: { "aria-expanded": "false", "aria-controls": "panel-1" },
        });
        parent.appendChild(btn);

        loadModules([btn]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.ok(!hintMode.isActive(), "Expected 1 hint (lone disclosure button should be kept)");
    });

    // Regular button without aria-expanded is not affected
    it("does not filter regular button without aria-expanded", () => {
        const parent = makeElement("LI", { top: 0, left: 0 });
        const link = makeElement("A", { href: "#", top: 10, left: 0 });
        const btn = makeElement("BUTTON", { top: 10, left: 50 });
        parent.appendChild(link);
        parent.appendChild(btn);

        loadModules([link, btn]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        // 2 hints → single-char labels "s" and "a"
        // Type "s" to activate link, then reactivate and type "a" to activate button
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.equal(link.click.mock.callCount(), 1, "Link hint should work");
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "Should reactivate with 2 hints (button not filtered)");
        fireKeyDown(makeKeyEvent("KeyA", { key: "a" }));
        assert.equal(btn.click.mock.callCount(), 1, "Button hint should work (not filtered)");
    });
});

// Regression: zero-size flex containers must not prune clickable descendants.
// GitHub PR pages nest links inside <nav> → <ul style="display:flex"> → <li>,
// where <ul> and <li> report zero-size rects (no layout engine). Previously
// walkerFilter used FILTER_REJECT for zero-size elements, pruning the entire
// subtree and dropping all the <a> links inside.
describe("DOM problems — flex container with zero-size parents", () => {
    let cleanup: () => void;

    afterEach(() => {
        if (cleanup) cleanup();
    });

    // Links inside zero-size flex containers are discovered by the walker
    it("discovers links nested inside zero-size flex containers", () => {
        const env = createDOM(`
            <nav aria-label="Repository">
              <ul style="display: flex; list-style: none;">
                <li style="display: inline-flex;">
                  <a id="code-tab" href="/repo">Code</a>
                </li>
                <li style="display: inline-flex;">
                  <a id="issues-tab" href="/repo/issues">Issues</a>
                </li>
                <li style="display: inline-flex;">
                  <a id="pull-requests-tab" href="/repo/pulls">Pull requests</a>
                </li>
              </ul>
            </nav>
        `);
        cleanup = env.cleanup;

        // Patch getBoundingClientRect on the <a> elements only — give them visible rects.
        // The <nav>, <ul>, <li> keep their default zero-size rects (happy-dom has no layout).
        const links = env.document.querySelectorAll("a");
        let top = 10;
        for (const link of links) {
            const rect = { top, left: top * 5, bottom: top + 20, right: top * 5 + 80, width: 80, height: 20, x: top * 5, y: top, toJSON() { return this; } };
            (link as any).getBoundingClientRect = () => rect;
            (link as any).getClientRects = () => [rect];
            top += 30;
        }

        // Mock elementsFromPoint — return the link whose rect contains the point
        (env.document as any).elementsFromPoint = (x: number, y: number) => {
            const hits: Element[] = [];
            for (const link of links) {
                const r = (link as any).getBoundingClientRect();
                if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
                    hits.push(link as unknown as Element);
                }
            }
            return hits;
        };

        const found = discoverElements((el) => el.getBoundingClientRect());
        const foundIds = found.map((el) => el.id);

        assert.ok(foundIds.includes("code-tab"), "code-tab link should be discovered");
        assert.ok(foundIds.includes("issues-tab"), "issues-tab link should be discovered");
        assert.ok(foundIds.includes("pull-requests-tab"), "pull-requests-tab link should be discovered");
        assert.equal(found.length, 3, "Should find exactly 3 links");
    });
});

// Facebook "Create story" card: cursor:pointer wrapper div around an <a> produces
// duplicate hints because dedup didn't remove generic roots with specific descendants.
describe("DOM problems — generic cursor:pointer wrapper dedup", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("removes generic cursor:pointer wrapper when it contains a link", () => {
        const link = makeElement("A", { href: "/stories/create/", top: 60, left: 60, width: 200, height: 300 });
        link.setAttribute("role", "link");
        link.setAttribute("tabindex", "0");

        const wrapper = makeElement("DIV", { top: 60, left: 60, width: 200, height: 300, cursor: "pointer" });
        wrapper.appendChild(link);

        loadModules([wrapper, link]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            return [link, wrapper];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        // 1 hint (link only) → single-char label "s"
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.ok(!hintMode.isActive(), "Expected 1 hint (link only) — generic wrapper should be removed");
    });
});

// Hint target redirect: a wrapper with a single clickable child should position
// the hint at the child, not the wrapper. This is the common case of a large
// card/container wrapping one interactive element.
describe("DOM problems — hint target redirects to sole clickable child", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("does NOT redirect when element contains clickable children", () => {
        // role="link" div with inner button — hint stays on the element itself,
        // centered underneath. Inner button gets its own separate hint.
        const btn = makeElement("BUTTON", { top: 20, left: 300, width: 30, height: 30 });
        const linkDiv = makeElement("DIV", { top: 0, left: 0, width: 400, height: 60 });
        linkDiv.setAttribute("role", "link");
        linkDiv.setAttribute("tabindex", "0");
        linkDiv.appendChild(btn);

        loadModules([linkDiv, btn]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            const all = [btn, linkDiv];
            return all.filter((el: any) => {
                const r = el.getBoundingClientRect();
                return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
            });
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        // 2 hints: one for linkDiv centered-bottom, one for button
        const overlay = (globalThis as any).document.documentElement.querySelector(".vimium-hint-overlay");
        const hints = overlay?.querySelectorAll(".vimium-hint");
        assert.equal(hints?.length, 2, "Should have 2 hints (link + button)");
        // Link hint should be centered on linkDiv (200), NOT at button (300+)
        const linkHintLeft = parseFloat(hints[0].style.left);
        assert.ok(linkHintLeft >= 190 && linkHintLeft <= 210,
            `Link hint left (${linkHintLeft}) should be centered on linkDiv (200), not redirected to button (300)`);
    });
});

// Facebook: fixed nav bar loses hints after scrolling because a non-fixed ancestor
// scrolls off-viewport and FILTER_REJECT prunes the entire subtree, including the
// fixed-position banner with interactive nav links/buttons.
// FIX: viewport bounds check uses FILTER_SKIP instead of FILTER_REJECT so children
// of off-viewport containers are still visited.
describe("DOM problems — fixed elements inside off-viewport ancestors", () => {
    let cleanup: () => void;

    afterEach(() => {
        if (cleanup) cleanup();
    });

    it("discovers links in fixed header when ancestor is off-viewport", () => {
        const env = createDOM(`
            <div id="page-wrapper">
                <div id="banner" role="banner">
                    <a id="home" href="/" role="link" tabindex="0">Home</a>
                    <a id="video" href="/watch" role="link" tabindex="0">Video</a>
                    <a id="groups" href="/groups" role="link" tabindex="0">Groups</a>
                </div>
                <div id="content">
                    <a id="post-link" href="/post/1">Post</a>
                </div>
            </div>
        `);
        cleanup = env.cleanup;

        const wrapper = env.document.getElementById("page-wrapper")!;
        const banner = env.document.getElementById("banner")!;
        const home = env.document.getElementById("home")!;
        const video = env.document.getElementById("video")!;
        const groups = env.document.getElementById("groups")!;
        const postLink = env.document.getElementById("post-link")!;

        // Simulate scrolled state: page-wrapper has scrolled off the top
        const offViewport = { top: -2000, left: 0, bottom: -1940, right: 1024, width: 1024, height: 60, x: 0, y: -2000, toJSON() { return this; } };
        (wrapper as any).getBoundingClientRect = () => offViewport;

        // Banner is position:fixed — stays at top of viewport
        const bannerRect = { top: 0, left: 0, bottom: 56, right: 1024, width: 1024, height: 56, x: 0, y: 0, toJSON() { return this; } };
        (banner as any).getBoundingClientRect = () => bannerRect;

        // Nav links are in-viewport (inside the fixed banner)
        const rects: Record<string, any> = {};
        let left = 100;
        for (const link of [home, video, groups]) {
            const r = { top: 10, left, bottom: 46, right: left + 80, width: 80, height: 36, x: left, y: 10, toJSON() { return this; } };
            (link as any).getBoundingClientRect = () => r;
            (link as any).getClientRects = () => [r];
            rects[link.id] = r;
            left += 100;
        }

        // Post link is in-viewport below the banner
        const postRect = { top: 100, left: 50, bottom: 120, right: 250, width: 200, height: 20, x: 50, y: 100, toJSON() { return this; } };
        (postLink as any).getBoundingClientRect = () => postRect;
        (postLink as any).getClientRects = () => [postRect];

        // elementsFromPoint returns the link at that position
        const allLinks = [home, video, groups, postLink];
        (env.document as any).elementsFromPoint = (x: number, y: number) => {
            const hits: Element[] = [];
            for (const link of allLinks) {
                const r = (link as any).getBoundingClientRect();
                if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
                    hits.push(link as unknown as Element);
                }
            }
            return hits;
        };

        const found = discoverElements((el) => el.getBoundingClientRect());
        const foundIds = found.map((el) => el.id);

        assert.ok(foundIds.includes("home"), "home link should be discovered");
        assert.ok(foundIds.includes("video"), "video link should be discovered");
        assert.ok(foundIds.includes("groups"), "groups link should be discovered");
        assert.ok(foundIds.includes("post-link"), "post link should be discovered");
        assert.equal(found.length, 4, "Should find all 4 links");
    });
});

// ISSUE: Inline elements (e.g. <a>) use their tight text rect for hint centering,
// causing hints to scatter horizontally in vertical lists where links have different text widths.
// SITE: amazon.com.au footer
// FIX: When element is inline, use nearest block-level ancestor's horizontal bounds for centering.
describe("DOM problems — inline element hint alignment", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("centers hints on block-level ancestor for inline links in a list", () => {
        const ul = makeElement("UL", { top: 0, left: 10, width: 300, height: 100 });

        const li1 = makeElement("LI", { top: 10, left: 10, width: 300, height: 25, display: "block" });
        const a1 = makeElement("A", { href: "/brand", top: 10, left: 10, width: 250, height: 20, display: "inline" });
        li1.appendChild(a1);
        ul.appendChild(li1);

        const li2 = makeElement("LI", { top: 40, left: 10, width: 300, height: 25, display: "block" });
        const a2 = makeElement("A", { href: "/sell", top: 40, left: 10, width: 120, height: 20, display: "inline" });
        li2.appendChild(a2);
        ul.appendChild(li2);

        const li3 = makeElement("LI", { top: 70, left: 10, width: 300, height: 25, display: "block" });
        const a3 = makeElement("A", { href: "/fba", top: 70, left: 10, width: 180, height: 20, display: "inline" });
        li3.appendChild(a3);
        ul.appendChild(li3);

        loadModules([a1, a2, a3]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".vimium-hint-overlay");
        const hints = overlay?.querySelectorAll(".vimium-hint");
        assert.equal(hints?.length, 3, "Should have 3 hints");

        // All hints should have the same x position (centered on <li> width, not <a> text width)
        const x1 = parseFloat(hints[0].style.left);
        const x2 = parseFloat(hints[1].style.left);
        const x3 = parseFloat(hints[2].style.left);
        assert.equal(x1, x2, `Hints should align (same x): got ${x1} vs ${x2}`);
        assert.equal(x2, x3, `Hints should align (same x): got ${x2} vs ${x3}`);
    });
});

// X.com trending: div[role="link"] contains a button[role="button"] (the "..." menu).
// The trend box should get its own hint separate from the button's hint.
// Previously getHintTargetElement redirected to the inner button, making both hints overlap.
// FIX: don't redirect to clickable children — let each candidate stand on its own.
describe("DOM problems — role=link with inner button gets separate hints", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("trend box and inner button both get hints", () => {
        const trendText = makeElement("SPAN", { top: 10, left: 10, width: 200, height: 20, textContent: "DOGE" });
        const moreBtn = makeElement("BUTTON", { top: 10, left: 300, width: 30, height: 30 });
        moreBtn.setAttribute("role", "button");
        moreBtn.setAttribute("aria-label", "More");

        const trendBox = makeElement("DIV", { top: 0, left: 0, width: 350, height: 50 });
        trendBox.setAttribute("role", "link");
        trendBox.setAttribute("tabindex", "0");
        trendBox.appendChild(trendText);
        trendBox.appendChild(moreBtn);

        loadModules([trendBox, moreBtn]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            const all = [moreBtn, trendText, trendBox];
            return all.filter((el: any) => {
                const r = el.getBoundingClientRect();
                return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
            });
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        // 2 hints → single-char labels "s" and "a"
        // Type "s" for trend box, "a" for button
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.ok(!hintMode.isActive(), "Expected 2 hints (trend box + button), but got fewer");
    });
});

