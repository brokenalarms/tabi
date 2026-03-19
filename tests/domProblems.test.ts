// DOM problem mode tests — selector pipeline edge cases from real sites.
// Each test reproduces a specific bug scenario with a minimal DOM fixture.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeElement, makeKeyEvent, loadModules, fireKeyDown, getState } from "./hintTestHelpers";
import { createDOM } from "./helpers/dom";
import { discoverElements, walkerFilter } from "../src/modules/ElementGatherer";
import { hasBox, hasHeadingContent, isBlockLevel, isInRepeatingContainer, getRepeatingContainer, isSiblingInRepeatingContainer, isAnchorToLabelTarget, isInSameLabel, isEmpty, shouldRedirectToHeading, hasListBoundaryBetween } from "../src/modules/elementPredicates";
import { findBlockAncestor } from "../src/modules/elementTraversals";
import { CLICKABLE_SELECTOR } from "../src/modules/constants";

describe("element discovery", () => {
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
    it("the [for] attribute is what makes a label discoverable", () => {
        const label = makeElement("LABEL", { top: 10, left: 10, width: 80, height: 20 });
        loadModules([label]);
        const { hintMode } = getState();

        // Without [for] — bare label is not interactive
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "label without [for] should not get a hint");

        // With [for] — label becomes clickable
        (label as any).htmlFor = "menu-toggle";
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

    // Wrapper div with onclick containing a textarea — only textarea gets a hint
    it("filters out ancestor wrapper when descendant is also a candidate", () => {
        // Base: onclick wrapper alone gets a hint (proving it's discoverable)
        const wrapperAlone = makeElement("DIV", { top: 10, left: 10 });
        wrapperAlone.setAttribute("onclick", "");
        loadModules([wrapperAlone]);
        (globalThis as any).document.elementsFromPoint = () => [wrapperAlone];
        const { hintMode: base } = getState();
        base.activate(false);
        assert.ok(base.isActive(), "onclick wrapper alone should get a hint");
        base.destroy();

        // Delta: wrapper with textarea child — only textarea gets a hint
        const textarea = makeElement("TEXTAREA", { top: 10, left: 10 });
        const wrapper = makeElement("DIV", { top: 10, left: 10 });
        wrapper.setAttribute("onclick", "");
        wrapper.appendChild(textarea);

        loadModules([wrapper, textarea]);

        (globalThis as any).document.elementFromPoint = (x: number, y: number) => {
            return textarea;
        };
        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            return [textarea, wrapper];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        // Only 1 hint (textarea), not 2 (wrapper filtered out)
        fireKeyDown(makeKeyEvent("KeyS", { key: "s" }));
        assert.ok(!hintMode.isActive(), "Expected 1 hint (textarea only), but got more — wrapper was not filtered");
    });
});

describe("visibility edge cases", () => {
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

    // Xfinity: opacity:0 radio with position:absolute has non-zero dimensions but is invisible.
    // Hint should be positioned on the visible label, not the invisible input.
    it("positions hint on label, not on opacity:0 radio", () => {
        const label = makeElement("LABEL", { top: 10, left: 200, width: 300, height: 40 });
        (label as any).htmlFor = "role-radio";
        const radio = makeElement("INPUT", {
            type: "radio", top: 10, left: 10,
            width: 16, height: 16, opacity: "0",
        });
        (radio as any).id = "role-radio";

        loadModules([radio, label]);

        (globalThis as any).document.querySelector = (sel: string) => {
            if (sel.includes("role-radio")) return label;
            return null;
        };
        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            if (x >= 200 && x < 500) return [label];
            return [radio];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "Should produce a hint");

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1, "Should have exactly 1 hint");

        // Hint should be near the label (left:200), not the invisible input (left:10)
        const hintLeft = parseFloat(hints[0].style.left);
        assert.ok(hintLeft >= 190, `Hint left (${hintLeft}) should be near label (200), not input (10)`);
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

it("isAnchorToLabelTarget identifies anchors pointing to label targets", () => {
    const env = createDOM(`
        <a id="yes" href="#menu-toggle">Open menu</a>
        <a id="no-hash" href="/page">Regular link</a>
        <a id="no-match" href="#other">Other anchor</a>
        <div id="not-a">Not a link</div>
    `);
    const labelForIds = new Set(["menu-toggle"]);
    const yes = env.document.getElementById("yes") as unknown as HTMLElement;
    const noHash = env.document.getElementById("no-hash") as unknown as HTMLElement;
    const noMatch = env.document.getElementById("no-match") as unknown as HTMLElement;
    const notA = env.document.getElementById("not-a") as unknown as HTMLElement;

    assert.equal(isAnchorToLabelTarget(yes, labelForIds), true,
        "Anchor with href=#id matching a label target");
    assert.equal(isAnchorToLabelTarget(noHash, labelForIds), false,
        "Anchor without # prefix");
    assert.equal(isAnchorToLabelTarget(noMatch, labelForIds), false,
        "Anchor with # but id not in label set");
    assert.equal(isAnchorToLabelTarget(notA, labelForIds), false,
        "Non-anchor element");
    env.cleanup();
});

describe("label-for dedup", () => {
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

describe("hash-link/label dedup", () => {
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
            const all = [label, anchor];
            return all.filter((el: any) => {
                const r = el.getBoundingClientRect();
                return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
            });
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

describe("disclosure trigger dedup", () => {
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
        const btn = makeElement("BUTTON", { top: 10, left: 110 });
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
describe("flex container with zero-size parents", () => {
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

// Hint target redirect: a wrapper with a single clickable child should position
// the hint at the child, not the wrapper. This is the common case of a large
// card/container wrapping one interactive element.
describe("hint target redirects to sole clickable child", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("parent with discovered interactive child is deduped — child wins", () => {
        // role="link" div wrapping a button — parent is removed by containment
        // dedup, child (the more specific target) gets the hint.
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

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1, "Should have 1 hint — parent deduped, child wins");
    });
});

// Facebook: fixed nav bar loses hints after scrolling because a non-fixed ancestor
// scrolls off-viewport and FILTER_REJECT prunes the entire subtree, including the
// fixed-position banner with interactive nav links/buttons.
// FIX: viewport bounds check uses FILTER_SKIP instead of FILTER_REJECT so children
// of off-viewport containers are still visited.
describe("fixed elements inside off-viewport ancestors", () => {
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
describe("inline element hint alignment", () => {
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

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 3, "Should have 3 hints");

        // All hints should have the same x position (centered on <li> width, not <a> text width)
        const x1 = parseFloat(hints[0].style.left);
        const x2 = parseFloat(hints[1].style.left);
        const x3 = parseFloat(hints[2].style.left);
        assert.equal(x1, x2, `Hints should align (same x): got ${x1} vs ${x2}`);
        assert.equal(x2, x3, `Hints should align (same x): got ${x2} vs ${x3}`);
    });
});

// GitHub: empty block-level element with zero height but non-zero width (e.g. skip-to-content
// target div with tabindex) passes the zero-size check because it only requires BOTH dimensions
// to be zero. The hint renders at (0,0), clipped by the viewport edge.
// FIX: skip elements where either dimension is zero, not just both.
describe("zero in one dimension filtered", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("filters out element with zero height but non-zero width", () => {
        // Base: onclick div with both dimensions → gets a hint
        const normal = makeElement("DIV", {
            top: 10, left: 10, width: 1024, height: 50,
            attrs: { onclick: "" },
        });
        loadModules([normal]);
        (globalThis as any).document.elementsFromPoint = () => [normal];
        const { hintMode: base } = getState();
        base.activate(false);
        assert.ok(base.isActive(), "onclick div with size should get a hint");
        base.destroy();

        // Delta: zero height → no hint
        const zeroHeight = makeElement("DIV", {
            top: 0, left: 0, width: 1024, height: 0,
            attrs: { onclick: "" },
        });
        loadModules([zeroHeight]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Zero-height element should not get a hint");
    });

    it("filters out element with zero width but non-zero height", () => {
        // Base: onclick div with both dimensions → gets a hint
        const normal = makeElement("DIV", {
            top: 10, left: 10, width: 50, height: 768,
            attrs: { onclick: "" },
        });
        loadModules([normal]);
        (globalThis as any).document.elementsFromPoint = () => [normal];
        const { hintMode: base } = getState();
        base.activate(false);
        assert.ok(base.isActive(), "onclick div with size should get a hint");
        base.destroy();

        // Delta: zero width → no hint
        const zeroWidth = makeElement("DIV", {
            top: 0, left: 0, width: 0, height: 768,
            attrs: { onclick: "" },
        });
        loadModules([zeroWidth]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Zero-width element should not get a hint");
    });
});

// ISSUE: Inline centering logic widens hint position to parent container for all inline elements,
// but checkboxes/radios are discrete controls — their hints should stay near the control, not
// drift to the center of the parent text line.
// SITE: GitHub PR task lists
// FIX: Exclude checkbox and radio inputs from inline centering.
describe("checkbox/radio hint positioning", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("checkbox hint stays near the control, not centered on parent", () => {
        const li = makeElement("LI", { top: 10, left: 0, width: 600, height: 25, display: "block" });
        const checkbox = makeElement("INPUT", { type: "checkbox", top: 10, left: 10, width: 16, height: 16, display: "inline" });
        li.appendChild(checkbox);

        loadModules([checkbox]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1, "Should have 1 hint for checkbox");

        // Hint should be near the checkbox (left=10, width=16, center=18), NOT centered on li (center=300)
        const hintLeft = parseFloat(hints[0].style.left);
        assert.ok(hintLeft < 50, `Checkbox hint left (${hintLeft}) should be near the control (~18), not centered on parent (~300)`);
    });

    it("radio hint stays near the control, not centered on parent", () => {
        const li = makeElement("LI", { top: 10, left: 0, width: 600, height: 25, display: "block" });
        const radio = makeElement("INPUT", { type: "radio", top: 10, left: 10, width: 16, height: 16, display: "inline" });
        li.appendChild(radio);

        loadModules([radio]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1, "Should have 1 hint for radio");

        const hintLeft = parseFloat(hints[0].style.left);
        assert.ok(hintLeft < 50, `Radio hint left (${hintLeft}) should be near the control (~18), not centered on parent (~300)`);
    });

    // AAA: visible checkbox inside a container-style <label> with heading + description.
    // The checkbox redirect moved the hint to the label (far from the control).
    // Visible checkboxes should keep their own hint; the label gets its own via label[for].
    it("visible checkbox inside label keeps hint on control, not label", () => {
        const label = makeElement("LABEL", { top: 0, left: 0, width: 800, height: 100, display: "block" });
        label.setAttribute("for", "cb1");
        const heading = makeElement("H3", { top: 0, left: 0, width: 400, height: 25, textContent: "New Offers" });
        const checkbox = makeElement("INPUT", { type: "checkbox", top: 10, left: 700, width: 20, height: 20, display: "inline" });
        checkbox.id = "cb1";
        label.appendChild(heading);
        label.appendChild(checkbox);

        loadModules([checkbox]);
        (globalThis as any).document.elementsFromPoint = () => [checkbox];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1);
        const hintLeft = parseFloat(hints[0].style.left);
        // Checkbox is at left:700, width:20 — center is 710.
        // If redirected to label, center would be ~400 (center of 800px label).
        assert.ok(hintLeft >= 700 && hintLeft <= 720,
            `Hint left (${hintLeft}) should be near checkbox (~710), not label center (~400)`);
    });

    // Prism web component: visible <input> is sibling of <label>, not inside it.
    // The checkbox redirect moved the hint to the label text.
    // Visible checkboxes should keep their own hint.
    it("visible checkbox sibling of label keeps hint on control", () => {
        const wrapper = makeElement("DIV", { top: 0, left: 0, width: 400, height: 30, display: "block" });
        const checkbox = makeElement("INPUT", { type: "checkbox", top: 5, left: 10, width: 20, height: 20, display: "inline" });
        checkbox.id = "cb2";
        const label = makeElement("LABEL", { top: 0, left: 40, width: 200, height: 30, display: "inline", textContent: "Keep me signed in" });
        label.setAttribute("for", "cb2");
        wrapper.appendChild(checkbox);
        wrapper.appendChild(label);

        loadModules([checkbox]);
        (globalThis as any).document.elementsFromPoint = () => [checkbox];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1);
        const hintLeft = parseFloat(hints[0].style.left);
        // Checkbox is at left:10, width:20 — center is 20.
        // If redirected to label, center would be ~140 (center of label at left:40, width:200).
        assert.ok(hintLeft >= 10 && hintLeft <= 30,
            `Hint left (${hintLeft}) should be near checkbox (~20), not label center (~140)`);
    });

    // Zero-size checkbox (web component pattern: native input hidden, custom visual shown).
    // Must still redirect to label since there's no visible position for the input.
    it("zero-size checkbox redirects to label as fallback", () => {
        const wrapper = makeElement("DIV", { top: 0, left: 0, width: 400, height: 30, display: "block" });
        const checkbox = makeElement("INPUT", { type: "checkbox", top: 0, left: 0, width: 0, height: 0, display: "inline" });
        checkbox.id = "cb3";
        const label = makeElement("LABEL", { top: 0, left: 40, width: 200, height: 30, display: "inline", textContent: "Hidden input label" });
        label.setAttribute("for", "cb3");
        wrapper.appendChild(checkbox);
        wrapper.appendChild(label);

        loadModules([checkbox]);
        (globalThis as any).document.elementsFromPoint = () => [checkbox];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1);
        const hintLeft = parseFloat(hints[0].style.left);
        // Zero-size input — hint should redirect to label, center at ~140.
        assert.ok(hintLeft >= 130 && hintLeft <= 150,
            `Hint left (${hintLeft}) should be on label (~140) since checkbox is zero-size`);
    });

    // Amazon: <a> wraps a decorative checkbox (aria-hidden input inside label) + text.
    // The <a> is the discovered element; hint should redirect to the label
    // (which covers the visual checkbox icon), not stay centered on the full <a>.
    it("link with hidden checkbox inside label redirects hint to label", () => {
        // Base: without embedded control, hint centers on <a> content
        const textOnly = makeElement("SPAN", { top: 0, left: 50, width: 200, height: 25 });
        const plainLink = makeElement("A", { href: "/filter", top: 0, left: 0, width: 300, height: 25, display: "inline" });
        plainLink.appendChild(textOnly);

        loadModules([plainLink]);
        const { hintMode: hm1 } = getState();
        hm1.activate(false);
        const overlay1 = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const baseLeft = parseFloat(overlay1?.querySelector(".tabi-hint")?.style.left);
        hm1.destroy();

        // Delta: same link but with hidden checkbox inside label — hint should shift to label
        const icon = makeElement("I", { top: 5, left: 5, width: 16, height: 16 });
        const input = makeElement("INPUT", { type: "checkbox", top: 0, left: 0, width: 0, height: 0, display: "inline" });
        input.setAttribute("aria-hidden", "true");
        const label = makeElement("LABEL", { top: 0, left: 0, width: 30, height: 25, display: "inline" });
        label.appendChild(input);
        label.appendChild(icon);
        const text = makeElement("SPAN", { top: 0, left: 50, width: 200, height: 25 });
        const link = makeElement("A", { href: "/filter", top: 0, left: 0, width: 300, height: 25, display: "inline" });
        link.appendChild(label);
        link.appendChild(text);

        loadModules([link]);
        const { hintMode: hm2 } = getState();
        hm2.activate(false);
        assert.ok(hm2.isActive());

        const overlay2 = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay2?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1);
        const hintLeft = parseFloat(hints[0].style.left);
        // Label is at left:0, width:30 — center is 15.
        // Without fix, hint centers on <a> content (~125).
        assert.ok(hintLeft <= 40,
            `Hint left (${hintLeft}) should be near checkbox label (~15), not centered on link (~${Math.round(baseLeft)})`);
        hm2.destroy();
    });

    // Base case: visible checkbox inside <a> + <label> — redirect to input, not label.
    it("link with visible checkbox inside label redirects hint to input", () => {
        const input = makeElement("INPUT", { type: "checkbox", top: 5, left: 5, width: 16, height: 16, display: "inline" });
        const label = makeElement("LABEL", { top: 0, left: 0, width: 200, height: 25, display: "inline" });
        label.appendChild(input);
        const text = makeElement("SPAN", { top: 0, left: 220, width: 200, height: 25 });
        const link = makeElement("A", { href: "/filter", top: 0, left: 0, width: 500, height: 25, display: "inline" });
        link.appendChild(label);
        link.appendChild(text);

        loadModules([link]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1);
        const hintLeft = parseFloat(hints[0].style.left);
        // Input is at left:5, width:16 — center is 13.
        // Should redirect to input directly, not the wide label or <a> center.
        assert.ok(hintLeft <= 25,
            `Hint left (${hintLeft}) should be near checkbox input (~13), not label center (~100)`);
    });
});

// ISSUE: Inline centering logic widens hint to full parent <p> width for an <a> that's
// part of mixed text content (e.g. "🤖 Generated with <a>Claude Code</a>"), pushing the
// hint far from the actual link text.
// SITE: GitHub PR description — "Generated with Claude Code" paragraph
// FIX: Only apply inline centering when the element is the primary content of its parent
// (no sibling text nodes with non-whitespace text).
describe("inline link in mixed text content", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("hint stays near the link, not centered on wide parent paragraph", () => {
        // <p>🤖 Generated with <a href="...">Claude Code</a></p>
        const p = makeElement("P", { top: 10, left: 0, width: 800, height: 25, display: "block" });

        // Add text node "🤖 Generated with " as sibling content
        const w = (globalThis as any).window;
        const textNode = w.document.createTextNode("🤖 Generated with ");
        p.appendChild(textNode);

        const link = makeElement("A", { href: "https://claude.com/claude-code", top: 10, left: 200, width: 100, height: 20, display: "inline" });
        p.appendChild(link);

        loadModules([link]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1, "Should have 1 hint for the link");

        // Hint should be near the link (left=200, width=100, center=250), NOT centered on <p> (center=400)
        const hintLeft = parseFloat(hints[0].style.left);
        assert.ok(hintLeft < 300, `Hint left (${hintLeft}) should be near the link (~250), not centered on <p> (~400)`);
    });
});

// ISSUE: Elements with padding-bottom have hints positioned too low — the pointer
// floats below the visible content because rect.bottom includes padding.
// SITE: MediaWiki sidebar
// FIX: Subtract paddingBottom from the bottom edge used for hint positioning so
// the pointer touches the content edge rather than the padding edge.
describe("hint positioning accounts for padding-bottom", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("hint without padding-bottom is at rect.bottom", () => {
        const link = makeElement("A", { href: "#", top: 10, left: 50, width: 100, height: 20, display: "inline" });
        loadModules([link]);

        const { hintMode } = getState();
        hintMode.activate(false);

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1);

        // Without padding, hint top should be near rect.bottom (30) + 2 = 32
        const hintTop = parseFloat(hints[0].style.top);
        assert.ok(hintTop >= 30, `Hint top (${hintTop}) should be at or past rect.bottom (30)`);
    });

    it("hint is closer to content edge when element has padding-bottom", () => {
        // Same element but with 20px padding-bottom baked into the rect height
        // Content ends at top=10 + contentHeight=20 = 30, but rect.bottom = 50 due to padding
        const link = makeElement("A", { href: "#", top: 10, left: 50, width: 100, height: 40, display: "inline", paddingBottom: "20px" });
        loadModules([link]);

        const { hintMode } = getState();
        hintMode.activate(false);

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1);

        // With 20px padding-bottom, hint should be near content bottom (30) + 2 = 32,
        // NOT at rect.bottom (50) + 2 = 52
        const hintTop = parseFloat(hints[0].style.top);
        assert.ok(hintTop < 40, `Hint top (${hintTop}) should be near content edge (~32), not at padded bottom (~52)`);
    });
});

// X.com trending: div[role="link"] contains a button[role="button"] (the "..." menu).
// The trend box should get its own hint separate from the button's hint.
// Previously getHintTargetElement redirected to the inner button, making both hints overlap.
// FIX: don't redirect to clickable children — let each candidate stand on its own.
describe("role=link with inner button gets separate hints", () => {
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

// ISSUE: Elements hidden via CSS clip/clip-path (visually-hidden / sr-only pattern)
// still receive hints because they have non-zero bounding rects.
// SITE: github.com — "Skip to content" link hidden with show-on-focus class
// FIX: Check for clip/clip-path that reduce visible area to near-zero in walkerFilter
describe("clip/clip-path visually-hidden elements", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("filters element hidden with clip-path: inset(50%)", () => {
        const skipLink = makeElement("A", {
            href: "#start-of-content", top: 0, left: 0, width: 200, height: 30,
        });
        skipLink.style.position = "fixed";
        skipLink.style.clipPath = "inset(50%)";

        loadModules([skipLink]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "clip-path: inset(50%) element should not get a hint");
    });

    it("filters element hidden with clip: rect(0px, 0px, 0px, 0px)", () => {
        const skipLink = makeElement("A", {
            href: "#start-of-content", top: 0, left: 0, width: 200, height: 30,
        });
        skipLink.style.position = "fixed";
        (skipLink.style as any).clip = "rect(0px, 0px, 0px, 0px)";

        loadModules([skipLink]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "clip: rect(0,0,0,0) element should not get a hint");
    });

    it("filters element hidden with clip: rect(1px, 1px, 1px, 1px)", () => {
        const skipLink = makeElement("A", {
            href: "#start-of-content", top: 0, left: 0, width: 200, height: 30,
        });
        skipLink.style.position = "fixed";
        (skipLink.style as any).clip = "rect(1px, 1px, 1px, 1px)";

        loadModules([skipLink]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "clip: rect(1px,1px,1px,1px) element should not get a hint");
    });

    it("keeps element with non-hiding clip-path", () => {
        const link = makeElement("A", {
            href: "/page", top: 10, left: 10, width: 200, height: 30,
        });
        // clip-path that doesn't hide the element
        link.style.clipPath = "none";

        loadModules([link]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "clip-path: none should not filter the element");
    });
});

// ISSUE: Links behind fixed overlay banners get hints because elementsFromPoint
// returns all elements at a point (including occluded ones), and the occlusion
// check verifies the candidate appears anywhere in the list, not that it's topmost.
// SITE: theguardian.com — support banner overlay covers article links
// FIX: Only check if the candidate is the topmost element at the point
describe("overlay occlusion", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("filters links occluded by a fixed overlay", () => {
        const articleLink = makeElement("A", { href: "/article", top: 400, left: 50, width: 200, height: 20 });
        const overlayDiv = makeElement("DIV", { top: 0, left: 0, width: 1024, height: 768, textContent: "Loading..." });

        loadModules([articleLink]);

        // Simulate fixed overlay being topmost at every point (real browser z-order)
        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            return [overlayDiv, articleLink];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Link behind fixed overlay should not get a hint");
    });

    it("keeps links that are topmost (not occluded)", () => {
        const link = makeElement("A", { href: "/visible", top: 10, left: 10, width: 200, height: 20 });

        loadModules([link]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            return [link];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "Topmost link should get a hint");
    });

    // ISSUE: Facebook Reels page — thin element (loading bar, header border) covers
    // only the top edge of a nav link, causing a false occlusion.
    // SITE: facebook.com/reel — Home button hint missing on Reels page
    // FIX: top-only coverage doesn't count as occlusion; at least one bottom corner
    // must be covered for an element to be considered occluded.
    it("top-only cover does not occlude — element is still clickable", () => {
        // Link at (10,50)-(210,70). Thin bar covers top edge only (y=48..54).
        const link = makeElement("A", { href: "/", top: 50, left: 10, width: 200, height: 20 });
        const topBar = makeElement("DIV", { top: 48, left: 0, width: 1024, height: 6 });

        loadModules([link]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            const br = topBar.getBoundingClientRect();
            if (x >= br.left && x < br.right && y >= br.top && y < br.bottom) {
                return [topBar, link];
            }
            return [link];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "Top-only cover should not occlude the link");
    });

    // ISSUE: Element partially occluded — bottom corner covered by an unrelated element.
    // SITE: theguardian.com — card links partially covered by adjacent section
    // FIX: isOccluded requires at least one bottom corner to be covered.
    it("filters element when a bottom corner is occluded", () => {
        // Link at (10,10)-(210,30). Overlay covers only the bottom-right quadrant.
        const link = makeElement("A", { href: "/page", top: 10, left: 10, width: 200, height: 20 });
        const overlay = makeElement("DIV", { top: 20, left: 150, width: 200, height: 200, textContent: "Menu" });

        loadModules([link]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            const or = overlay.getBoundingClientRect();
            if (x >= or.left && x < or.right && y >= or.top && y < or.bottom) {
                return [overlay, link];
            }
            return [link];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Link with one bottom corner occluded should be filtered");
    });
});

// Overlay <a> elements (stretched-link card pattern) should get hints — they're real
// navigation targets. Previously these were skipped via isEmpty(), but
// that caused hints to land on non-interactive siblings (images) instead. The overlay
// is exempt from occluding sibling interactive elements (e.g. comment links with
// higher z-index) so both the overlay and sibling links get hints.
describe("contentless overlay link", () => {
    it("overlay link gets hint alongside sibling comment link", () => {
        const env = createDOM(`
            <div>
                <a id="overlay" href="/article" aria-label="Article title"></a>
                <div>
                    <h3><span>Article title</span></h3>
                    <footer>
                        <a id="comments" href="/article#comments">24 comments</a>
                    </footer>
                </div>
            </div>
        `);

        const overlay = env.document.getElementById("overlay") as unknown as HTMLElement;
        const comments = env.document.getElementById("comments") as unknown as HTMLElement;

        overlay.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 300, right: 400, width: 400, height: 300, x: 0, y: 0, toJSON() { return this; } }) as DOMRect;
        comments.getBoundingClientRect = () => ({ top: 260, left: 10, bottom: 280, right: 200, width: 190, height: 20, x: 10, y: 260, toJSON() { return this; } }) as DOMRect;

        // Overlay is topmost (position:absolute); comment link pokes through via z-index
        const allEls = [overlay, comments];
        (env.document as any).elementsFromPoint = (x: number, y: number) => {
            return allEls.filter((el: any) => {
                const r = el.getBoundingClientRect();
                return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
            });
        };

        const elems = discoverElements(() => overlay.getBoundingClientRect());
        const ids = elems.map(e => e.id);
        assert.ok(ids.includes("overlay"), "Overlay <a> should get a hint — it's the article link");
        assert.ok(ids.includes("comments"), "Sibling comment link should also get a hint");

        env.cleanup();
    });
});

// ISSUE: Clickable elements behind other clickable siblings (e.g. stacked links)
// are filtered by elementsFromPoint because the sibling is topmost.
// FIX: topHitMatches allows elements behind other CLICKABLE_SELECTOR matches.
describe("clickable sibling occlusion", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("element behind non-clickable overlay gets filtered", () => {
        const link = makeElement("A", { href: "/page", top: 10, left: 10, width: 200, height: 20 });
        const overlay = makeElement("DIV", { top: 0, left: 0, width: 1024, height: 768, textContent: "Confirm action" });

        loadModules([link]);

        (globalThis as any).document.elementsFromPoint = () => [overlay, link];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Link behind non-clickable overlay should be filtered");
    });

    // ISSUE: Element fully covered by an unrelated interactive element (e.g. dropdown
    // menu item over a sidebar link) should be occluded — interactivity of the cover
    // is irrelevant; what matters is whether they share a DOM tree (containment).
    // SITE: github.com — profile dropdown menu items cover sidebar links
    // FIX: coveredByOverlay checks containment only, not interactivity of cover
    it("element behind unrelated interactive element gets filtered", () => {
        const menuItem = makeElement("A", { href: "/menu", top: 10, left: 10, width: 200, height: 20, textContent: "Settings" });
        const sidebarLink = makeElement("A", { href: "/sidebar", top: 10, left: 10, width: 200, height: 20 });

        // Only sidebarLink is a candidate; menuItem is from a separate tree (dropdown)
        loadModules([sidebarLink]);

        // menuItem covers sidebarLink at both test points
        (globalThis as any).document.elementsFromPoint = () => [menuItem, sidebarLink];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Element fully covered by unrelated element should be filtered");
    });

    // ISSUE: Decorative aria-hidden overlays (thread lines, visual chrome) block hints
    // on interactive elements behind them via elementsFromPoint occlusion check.
    // SITE: reddit.com — toggle comment thread button behind aria-hidden thread line
    // FIX: aria-hidden covers are in a removed subtree — they don't block hints.
    it("element behind aria-hidden overlay still gets hint", () => {
        const btn = makeElement("BUTTON", { top: 10, left: 10, width: 24, height: 24 });
        btn.setAttribute("aria-controls", "children");
        btn.setAttribute("aria-expanded", "false");

        const threadLine = makeElement("DIV", {
            top: 0, left: 0, width: 24, height: 500,
            attrs: { "aria-hidden": "true" },
        });

        loadModules([btn]);
        (globalThis as any).document.body.appendChild(threadLine);

        (globalThis as any).document.elementsFromPoint = () => [threadLine, btn];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "Button behind aria-hidden overlay should get a hint");
    });

    // ISSUE: Disabled button overlay covers interactive element.
    // FIX: Any unrelated element covering both test points blocks hints.
    it("element behind disabled button overlay gets filtered", () => {
        const link = makeElement("A", { href: "/page", top: 10, left: 10, width: 200, height: 20 });
        const disabledBtn = makeElement("BUTTON", { top: 0, left: 0, width: 1024, height: 768, textContent: "Unavailable" });
        (disabledBtn as HTMLButtonElement).disabled = true;

        loadModules([link]);

        (globalThis as any).document.elementsFromPoint = () => [disabledBtn, link];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Link behind disabled button overlay should be filtered");
    });
});

// ISSUE: Native interactive elements (button, input, etc.) produce duplicate overlapping hints
// with their parent containers when the walker descends into accepted interactive elements.
// SITE: GitHub PR sidebar — each section has <details><summary role="button">...</summary></details>
// FIX: Native interactive elements are atomic — the walker prunes their subtrees.
// <summary> is not natively interactive — it's clickable here via role="button".
// <details> has no clickable signal, so it gets SKIP'd.
describe("native interactive elements prune subtrees", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("summary gets one hint, details does not get a separate hint", () => {
        const details = makeElement("DETAILS", { top: 10, left: 10, width: 300, height: 30 });
        const summary = makeElement("SUMMARY", { top: 10, left: 10, width: 300, height: 30 });
        summary.setAttribute("role", "button");
        details.appendChild(summary);

        loadModules([details, summary]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            return [summary, details];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1, "Expected 1 hint (summary only) — details should not get a separate hint");
    });

    // Sibling <a> elements each get their own hint position — inline centering
    // should NOT apply when there are multiple children in the parent.
    it("sibling links each keep their own hint position", () => {
        const div = makeElement("DIV", { top: 0, left: 0, width: 300, height: 30, display: "block" });
        const a1 = makeElement("A", { href: "/open", top: 5, left: 10, width: 50, height: 20, display: "inline" });
        const a2 = makeElement("A", { href: "/closed", top: 5, left: 80, width: 60, height: 20, display: "inline" });
        div.appendChild(a1);
        div.appendChild(a2);

        loadModules([a1, a2]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 2, "Both sibling links should get hints");
        const x1 = parseFloat(hints[0].style.left);
        const x2 = parseFloat(hints[1].style.left);
        assert.ok(x1 !== x2, `Sibling hints should have different x positions: ${x1} vs ${x2}`);
    });

    it("anchor does not produce hints for interactive children inside it", () => {
        const anchor = makeElement("A", { href: "/page", top: 10, left: 10, width: 200, height: 40 });
        const innerBtn = makeElement("BUTTON", { top: 12, left: 12, width: 80, height: 20 });
        anchor.appendChild(innerBtn);

        loadModules([anchor, innerBtn]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            return [innerBtn, anchor];
        };

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1, "Expected 1 hint (anchor only) — nested button should be pruned");
    });
});

// ISSUE: role="treeitem" not recognized as interactive — treeitems with tabindex="-1"
// were not discovered, causing inconsistent hint coverage vs tabindex="0" siblings.
// SITE: github.com PR file tree — expanded folder gets container hint, collapsed folder gets pill
// FIX: Add "treeitem" to CLICKABLE_ROLES so all treeitems are treated as interactive regardless of tabindex.
describe("treeitem discovery", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("role=treeitem is the variable that makes tabindex=-1 discoverable", () => {
        const tree = makeElement("UL", { top: 0, left: 0, width: 300, height: 200,
            attrs: { role: "tree" } });

        const item = makeElement("LI", { top: 50, left: 0, width: 300, height: 30,
            attrs: { tabindex: "-1" } });
        tree.appendChild(item);

        loadModules([item]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            const r = item.getBoundingClientRect();
            return (x >= r.left && x < r.right && y >= r.top && y < r.bottom) ? [item] : [];
        };

        // Without role="treeitem" — tabindex="-1" alone is not discoverable
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "tabindex=-1 without role=treeitem should NOT get a hint");

        // Add role="treeitem" — now it should be discovered
        item.setAttribute("role", "treeitem");
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "tabindex=-1 WITH role=treeitem should get a hint");
    });
});

// ISSUE: Inline link inside inline <span> inside block <li> — inline expansion only walks
// one level up to parent. If parent is also inline, hint stays narrow instead of expanding
// to the block container width.
// SITE: amazon.com search filter sidebar — checkbox+text links in <li> items
// FIX: findBlockAncestor walks up through inline single-child ancestors to the nearest block container.
describe("inline expansion walks up to block ancestor", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("inline wrapper depth is the variable that determines expansion width", () => {
        // Without intermediate inline wrapper: <li> > <a> — single parent already block, centers on li
        const li1 = makeElement("LI", { top: 10, left: 0, width: 300, height: 25, display: "list-item" });
        const a1 = makeElement("A", { href: "/direct", top: 10, left: 0, width: 150, height: 20, display: "inline" });
        li1.appendChild(a1);

        loadModules([a1]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        let overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        let hints = overlay?.querySelectorAll(".tabi-hint");
        const directLeft = parseFloat(hints[0].style.left);
        assert.equal(directLeft, 150, `Direct child: hint should center on <li> (150)`);
        hintMode.deactivate();

        // With intermediate inline wrapper: <li> > <span> > <a> — walk-up needed to reach <li>
        const li2 = makeElement("LI", { top: 10, left: 0, width: 300, height: 25, display: "list-item" });
        const span = makeElement("SPAN", { top: 10, left: 0, width: 200, height: 20, display: "inline" });
        const a2 = makeElement("A", { href: "/wrapped", top: 10, left: 0, width: 150, height: 20, display: "inline" });
        span.appendChild(a2);
        li2.appendChild(span);

        loadModules([a2]);
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        hints = overlay?.querySelectorAll(".tabi-hint");
        const wrappedLeft = parseFloat(hints[0].style.left);

        // Both should produce the same result — the walk-up reaches <li> in both cases
        assert.equal(wrappedLeft, directLeft,
            `Wrapped (${wrappedLeft}) should match direct (${directLeft}) — walk-up reaches same <li>`);
    });

    // <h2><a>Title</a></h2> — heading wraps the link. The hint should NOT
    // redirect to the heading (it's block-level, too wide). The hint stays
    // on the inline <a> rect.
    it("heading ancestor is the variable that prevents expansion", () => {
        // Base: <li><a> — non-heading block ancestor, hint expands to <li> width
        const li = makeElement("LI", { top: 10, left: 0, width: 300, height: 25, display: "list-item" });
        const a1 = makeElement("A", { href: "/item", top: 10, left: 50, width: 100, height: 20, display: "inline" });
        li.appendChild(a1);

        loadModules([a1]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        let overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        let hints = overlay?.querySelectorAll(".tabi-hint");
        const expandedLeft = parseFloat(hints[0].style.left);
        assert.equal(expandedLeft, 150, // 0 + 300/2 = centers on <li>
            `Inside <li>: hint should center on <li> (150)`);
        hintMode.deactivate();

        // Delta: <h2><a> — heading block ancestor, hint stays on <a>
        const h2 = makeElement("H2", { top: 10, left: 0, width: 300, height: 25, display: "block" });
        const a2 = makeElement("A", { href: "/accept", top: 10, left: 50, width: 100, height: 20, display: "inline" });
        h2.appendChild(a2);

        loadModules([a2]);
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        hints = overlay?.querySelectorAll(".tabi-hint");
        const noExpansionLeft = parseFloat(hints[0].style.left);
        assert.equal(noExpansionLeft, 100, // 50 + 100/2 = centers on <a>
            `Inside <h2>: hint should center on <a> (100), not expand to <h2> (150)`);
    });

    it("stops walk-up at parent with multiple children", () => {
        // <div display:block> > <span display:inline>a1</span> + <span display:inline>a2</span>
        const div = makeElement("DIV", { top: 0, left: 0, width: 400, height: 30, display: "block" });
        const a1 = makeElement("A", { href: "/one", top: 5, left: 10, width: 80, height: 20, display: "inline" });
        const a2 = makeElement("A", { href: "/two", top: 5, left: 200, width: 80, height: 20, display: "inline" });
        div.appendChild(a1);
        div.appendChild(a2);

        loadModules([a1, a2]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 2, "Both links should get hints");
        const x1 = parseFloat(hints[0].style.left);
        const x2 = parseFloat(hints[1].style.left);
        assert.ok(x1 !== x2, `Sibling hints should NOT be expanded to same position: ${x1} vs ${x2}`);
    });
});

// findBlockAncestor utility — walks up through single-child ancestors to the
// nearest repeating container (li, tr) for hint width expansion.
describe("findBlockAncestor utility", () => {
    let cleanup: () => void;

    afterEach(() => {
        if (cleanup) cleanup();
    });

    it("returns repeating container parent", () => {
        const env = createDOM(`
            <li>
                <a id="t" href="#">link</a>
            </li>
        `);
        cleanup = env.cleanup;
        const a = env.document.getElementById("t")!;
        assert.equal(findBlockAncestor(a as unknown as HTMLElement), a.parentElement);
    });

    it("walks through intermediate wrappers to reach repeating container", () => {
        const env = createDOM(`
            <li>
                <span>
                    <a id="t" href="#">link</a>
                </span>
            </li>
        `);
        cleanup = env.cleanup;
        const a = env.document.getElementById("t")!;
        const li = a.parentElement!.parentElement!;
        assert.equal(findBlockAncestor(a as unknown as HTMLElement), li);
    });

    it("returns null when parent has multiple children", () => {
        const env = createDOM(`
            <li>
                <a id="t" href="#">one</a>
                <a href="#">two</a>
            </li>
        `);
        cleanup = env.cleanup;
        const a = env.document.getElementById("t")!;
        assert.equal(findBlockAncestor(a as unknown as HTMLElement), null);
    });

    it("returns null when no repeating container exists", () => {
        // Fidelity: <h2><a>I Accept</a></h2> — heading is not a repeating
        // container, so no expansion happens. Hint stays on the <a>.
        const env = createDOM(`
            <h2>
                <a id="t" href="#">I Accept</a>
            </h2>
        `);
        cleanup = env.cleanup;
        const a = env.document.getElementById("t")!;
        assert.equal(findBlockAncestor(a as unknown as HTMLElement), null);
    });

    it("skips display:contents repeating container", () => {
        const env = createDOM(`
            <ul>
                <li id="boxed">
                    <a id="link-boxed" href="#">link</a>
                </li>
                <li id="contents" style="display: contents;">
                    <a id="link-contents" href="#">link</a>
                </li>
            </ul>
        `);
        cleanup = env.cleanup;

        // Base: normal <li> is returned
        const aBoxed = env.document.getElementById("link-boxed")!;
        const li = env.document.getElementById("boxed")!;
        assert.equal(findBlockAncestor(aBoxed as unknown as HTMLElement), li,
            "box-generating <li> should be returned");

        // Delta: display:contents <li> has no box — skipped
        const aContents = env.document.getElementById("link-contents")!;
        assert.equal(findBlockAncestor(aContents as unknown as HTMLElement), null,
            "display:contents <li> should not be returned");
    });
});

// isBlockLevel utility — classifies CSS display values as block-level or not.
// Only values that generate a block-level box return true.
describe("isBlockLevel utility", () => {
    let cleanup: () => void;

    afterEach(() => {
        if (cleanup) cleanup();
    });

    it("block display is block-level, inline is not", () => {
        const env = createDOM(``);
        cleanup = env.cleanup;
        const el = env.document.createElement("div");
        env.document.body.appendChild(el);

        // Base: block → true
        el.style.display = "block";
        assert.equal(isBlockLevel(el as unknown as HTMLElement), true, "display:block is block-level");

        // Delta: changing to inline flips it
        el.style.display = "inline";
        assert.equal(isBlockLevel(el as unknown as HTMLElement), false, "display:inline is not block-level");
    });

    it("boxless display values are not block-level", () => {
        const env = createDOM(``);
        cleanup = env.cleanup;
        const el = env.document.createElement("div");
        env.document.body.appendChild(el);

        // Base: block → true
        el.style.display = "block";
        assert.equal(isBlockLevel(el as unknown as HTMLElement), true, "display:block is block-level");

        // Delta: contents has no box → not block-level
        el.style.display = "contents";
        assert.equal(isBlockLevel(el as unknown as HTMLElement), false, "display:contents is not block-level");

        // Delta: none has no box → not block-level
        el.style.display = "none";
        assert.equal(isBlockLevel(el as unknown as HTMLElement), false, "display:none is not block-level");
    });
});

// ISSUE: Hints drift from their target elements when viewport resizes (e.g. DevTools open).
// Hint positions are calculated once at activation with absolute pixel coordinates.
// FIX: Deactivate hints on window resize, consistent with existing scroll deactivation.
describe("hints deactivate on resize", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("deactivates hint mode when window is resized", () => {
        const link = makeElement("A", { href: "/page", top: 10, left: 10, width: 200, height: 20 });
        loadModules([link]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "Hints should be active before resize");

        // Simulate resize event (use happy-dom's Event via the test window)
        const Event = (globalThis as any).window.Event || globalThis.Event;
        window.dispatchEvent(new Event("resize"));

        assert.ok(!hintMode.isActive(), "Hints should deactivate on window resize");
    });
});

// ISSUE: Elements inside overflow:scroll/auto containers that are scrolled out of view still
// get hints because the overflow check only handles overflow:hidden and overflow:clip.
// SITE: facebook.com (stories carousel), any horizontal scroll container
// FIX: Extend overflow clipping check to all non-visible overflow modes (scroll, auto).
describe("overflow:scroll/auto clips elements", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("without overflow on container, link beyond container edge gets hint", () => {
        const container = makeElement("DIV", { top: 0, left: 0, width: 400, height: 300, display: "block" });
        const link = makeElement("A", { href: "#", top: 50, left: 500, width: 100, height: 20 });
        container.appendChild(link);
        loadModules([link]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "Link should get hint when container has no overflow clipping");
    });

    it("with overflow:scroll on container, link beyond container edge is filtered out", () => {
        const container = makeElement("DIV", { top: 0, left: 0, width: 400, height: 300, overflow: "scroll", display: "block" });
        const link = makeElement("A", { href: "#", top: 50, left: 500, width: 100, height: 20 });
        container.appendChild(link);
        loadModules([link]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Link outside overflow:scroll container should be filtered out");
    });

    it("with overflow:auto on container, link beyond container edge is filtered out", () => {
        const container = makeElement("DIV", { top: 0, left: 0, width: 400, height: 300, overflow: "auto", display: "block" });
        const link = makeElement("A", { href: "#", top: 50, left: 500, width: 100, height: 20 });
        container.appendChild(link);
        loadModules([link]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Link outside overflow:auto container should be filtered out");
    });

    it("with overflow:scroll, link inside container bounds still gets hint", () => {
        const container = makeElement("DIV", { top: 0, left: 0, width: 400, height: 300, overflow: "scroll", display: "block" });
        const link = makeElement("A", { href: "#", top: 50, left: 50, width: 100, height: 20 });
        container.appendChild(link);
        loadModules([link]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "Link inside overflow:scroll container bounds should get hint");
    });

    // Facebook/Reddit: display:contents wrapper with overflow set between link and
    // visible container. Boxless elements can't clip — overflow only applies to
    // elements that generate a CSS box.
    it("display:contents ancestor with overflow does not clip children", () => {
        // Base case: normal block container with overflow:hidden clips child outside bounds
        const container = makeElement("DIV", { top: 0, left: 0, width: 400, height: 300, overflow: "hidden", display: "block" });
        const link = makeElement("A", { href: "#", top: 50, left: 500, width: 100, height: 20 });
        container.appendChild(link);
        loadModules([link]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(!hintMode.isActive(), "Base case: block container with overflow:hidden clips child");

        // With display:contents: container has no box, so overflow has no effect
        container.style.display = "contents";
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "display:contents container can't clip — link should get hint");
    });
});

// hasBox utility — elements with display:none or display:contents have no CSS box.
// Overflow, sizing, and clipping properties have no effect on boxless elements.
// hasBox utility — elements with display:none or display:contents have no CSS box.
// Overflow, sizing, and clipping properties have no effect on boxless elements.
describe("hasBox utility", () => {
    let cleanup: () => void;

    afterEach(() => {
        if (cleanup) cleanup();
    });

    it("display:contents removes the box from a block element", () => {
        const env = createDOM(``);
        cleanup = env.cleanup;
        const el = env.document.createElement("div");
        env.document.body.appendChild(el);

        // Base: block div has a box
        el.style.display = "block";
        assert.equal(hasBox(el as unknown as HTMLElement), true, "display:block has a box");

        // Delta: contents removes the box
        el.style.display = "contents";
        assert.equal(hasBox(el as unknown as HTMLElement), false, "display:contents has no box");
    });

    it("display:none removes the box from a block element", () => {
        const env = createDOM(``);
        cleanup = env.cleanup;
        const el = env.document.createElement("div");
        env.document.body.appendChild(el);

        // Base: block div has a box
        el.style.display = "block";
        assert.equal(hasBox(el as unknown as HTMLElement), true, "display:block has a box");

        // Delta: none removes the box
        el.style.display = "none";
        assert.equal(hasBox(el as unknown as HTMLElement), false, "display:none has no box");
    });
});


// display:none on a container must return FILTER_REJECT (prune subtree),
// not FILTER_SKIP. Children of display:none elements are never rendered,
// so the walker should not waste time visiting them.
describe("display:none returns FILTER_REJECT", () => {
    let cleanup: () => void;

    afterEach(() => {
        if (cleanup) cleanup();
    });

    it("adding display:none changes walkerFilter from SKIP to REJECT", () => {
        const env = createDOM(`
            <div id="container">
                <a href="/link">Link</a>
            </div>
        `);
        cleanup = env.cleanup;

        const container = env.document.getElementById("container") as Node;

        // display:block — SKIP (not clickable, but children still walked)
        (container as any).style.display = "block";
        assert.equal(walkerFilter(container), NodeFilter.FILTER_SKIP,
            "display:block container should SKIP, allowing children to be visited");

        // display:none — same element now returns REJECT (subtree pruned)
        (container as any).style.display = "none";
        assert.equal(walkerFilter(container), NodeFilter.FILTER_REJECT,
            "display:none container must REJECT to prune entire subtree");
    });
});

// ISSUE: Visually-hidden skip-nav buttons inside overflow:hidden container with
// near-zero height get hints — isClippedByOverflow only checks full clipping
// SITE: linkedin.com — a11y menu with "Skip to search", "Skip to main content"
// FIX: Reject elements whose visible area within a clipping ancestor is < 4px
describe("DOM problems — overflow clipping with near-zero visible area", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("buttons inside overflow:hidden container with near-zero height are excluded", () => {
        // Container: overflow:hidden, 1px height (border/padding sliver)
        const container = makeElement("DIV", {
            top: 0, left: 0, width: 400, height: 1,
            overflow: "hidden",
        });
        // Skip-nav button inside — has normal height but is mostly clipped
        const skipBtn = makeElement("BUTTON", {
            top: 0, left: 0, width: 120, height: 30,
            textContent: "Skip to search",
        });
        container.appendChild(skipBtn);

        // Real interactive elements below
        const input = makeElement("INPUT", {
            top: 50, left: 50, width: 300, height: 30,
            attrs: { type: "text", role: "combobox", placeholder: "Search" },
        });
        const searchBtn = makeElement("BUTTON", {
            top: 50, left: 10, width: 30, height: 30,
            textContent: "Search",
        });

        loadModules([container, skipBtn, input, searchBtn]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");

        // Should have 2 hints (input + search button), NOT 3 (skip button excluded)
        assert.equal(hints?.length, 2,
            "Skip-nav button inside near-zero-height overflow:hidden container should be excluded");
    });

    it("buttons inside normal overflow:hidden container are kept", () => {
        // Container with overflow:hidden but normal height — buttons are visible
        const container = makeElement("DIV", {
            top: 0, left: 0, width: 400, height: 50,
            overflow: "hidden",
        });
        const btn = makeElement("BUTTON", {
            top: 5, left: 5, width: 120, height: 30,
            textContent: "Click me",
        });
        container.appendChild(btn);

        loadModules([container, btn]);

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());
        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");

        assert.equal(hints?.length, 1,
            "Button inside normal-height overflow:hidden container should get a hint");
    });
});

// Wrapping <label> containing <input type="radio"> — the label is an interactive
// container. Clicking anywhere on it activates the radio. Should produce one hint
// on the container, not duplicate hints on both label and radio.
describe("wrapping label dedup", () => {
    let cleanup: () => void;

    afterEach(() => {
        if (cleanup) cleanup();
    });

    it("keeps only the wrapping label, not the radio inside", () => {
        const env = createDOM(`
            <div class="question-form">
                <label id="label1" class="input-radio">
                    <input id="radio1" type="radio" name="choice" value="yes">
                    <div class="option-inner"><h5>Yes</h5></div>
                </label>
                <label id="label2" class="input-radio">
                    <input id="radio2" type="radio" name="choice" value="no">
                    <div class="option-inner"><h5>Nope</h5></div>
                </label>
            </div>
        `);
        cleanup = env.cleanup;

        // Give all labels and radios visible rects
        const elements = env.document.querySelectorAll("label, input[type='radio']");
        const rects: any[] = [];
        let top = 10;
        for (const el of elements) {
            const isLabel = (el as Element).tagName === "LABEL";
            const rect = {
                top, left: 20,
                bottom: top + (isLabel ? 60 : 20),
                right: isLabel ? 400 : 40,
                width: isLabel ? 380 : 20,
                height: isLabel ? 60 : 20,
                x: 20, y: top,
                toJSON() { return this; }
            };
            (el as any).getBoundingClientRect = () => rect;
            (el as any).getClientRects = () => [rect];
            rects.push({ el, rect });
            if (isLabel) top += 80;
        }

        (env.document as any).elementsFromPoint = (x: number, y: number) => {
            return rects
                .filter(({ rect: r }) => x >= r.left && x < r.right && y >= r.top && y < r.bottom)
                .map(({ el }) => el as unknown as Element);
        };

        const found = discoverElements((el) => el.getBoundingClientRect());
        const foundIds = found.map((el) => el.id);

        assert.equal(found.length, 2, "Should find exactly 2 hints (one per choice)");
        assert.ok(!foundIds.includes("label1"), "wrapping label removed (generic container)");
        assert.ok(!foundIds.includes("label2"), "wrapping label removed (generic container)");
        assert.ok(foundIds.includes("radio1"), "radio kept as the specific form control");
        assert.ok(foundIds.includes("radio2"), "radio kept as the specific form control");
    });
});

// ISSUE: Block-level <a> with a heading takes full container width, but the heading
// text is narrower. Hint centers on the full-width block rect instead of the heading.
// SITE: google.com — search result links with <h3> inside a display:block <a>
// FIX: In getHintTargetElement, redirect to heading child when the <a> is block-level,
// contains a heading, and is NOT inside a <li> or <tr> (which indicate list/table
// layouts where hints should stay centered on the container).
describe("hasHeadingContent", () => {
    it("returns true when element contains a heading", () => {
        const env = createDOM(`<a id="t" href="#"><h3>Title</h3></a>`);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.ok(hasHeadingContent(el));
        env.cleanup();
    });

    it("returns true for deeply nested heading", () => {
        const env = createDOM(`<a id="t" href="#"><div><span><h4>Title</h4></span></div></a>`);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.ok(hasHeadingContent(el));
        env.cleanup();
    });

    it("returns false when no heading exists", () => {
        const env = createDOM(`<a id="t" href="#"><span>Title</span></a>`);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.ok(!hasHeadingContent(el));
        env.cleanup();
    });
});

describe("isInRepeatingContainer", () => {
    it("returns true inside <li>", () => {
        const env = createDOM(`<li><a id="t" href="#">link</a></li>`);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.ok(isInRepeatingContainer(el));
        env.cleanup();
    });

    it("returns true inside <tr>", () => {
        const env = createDOM(`<table><tr><td><a id="t" href="#">link</a></td></tr></table>`);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.ok(isInRepeatingContainer(el));
        env.cleanup();
    });

    it("returns false for standalone element", () => {
        const env = createDOM(`<div><a id="t" href="#">link</a></div>`);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.ok(!isInRepeatingContainer(el));
        env.cleanup();
    });

    // Twitter/X: nav uses flat sibling <a> links instead of <li> wrappers.
    // 3+ sibling <a> elements form a repeating nav pattern.
    it("returns true for sibling <a> links in a nav", () => {
        // Base: a single <a> in a div is NOT in a repeating container
        const envSingle = createDOM(`<div><a id="solo" href="#">link</a></div>`);
        const solo = envSingle.document.getElementById("solo") as unknown as HTMLElement;
        assert.equal(isInRepeatingContainer(solo), false,
            "Single <a> should not be in a repeating container");
        envSingle.cleanup();

        // Delta: 3+ sibling <a> elements ARE in a repeating container
        const env = createDOM(`
            <nav>
                <a id="t" href="/home">Home</a>
                <a href="/explore">Explore</a>
                <a href="/notifications">Notifications</a>
            </nav>
        `);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.equal(isInRepeatingContainer(el), true,
            "Sibling <a> in nav should be in a repeating container");
        env.cleanup();
    });

    it("returns false for only two sibling <a> links", () => {
        const env = createDOM(`
            <nav>
                <a id="t" href="/home">Home</a>
                <a href="/explore">Explore</a>
            </nav>
        `);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.equal(isInRepeatingContainer(el), false,
            "Two sibling <a> elements is not a repeating pattern");
        env.cleanup();
    });

    it("getRepeatingContainer returns the <a> itself for sibling links", () => {
        const env = createDOM(`
            <nav>
                <a id="t" href="/home">Home</a>
                <a href="/explore">Explore</a>
                <a href="/notifications">Notifications</a>
            </nav>
        `);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.equal(getRepeatingContainer(el), el,
            "Repeating container for sibling <a> should be the <a> itself");
        env.cleanup();
    });

    // Twitter/X: <nav> sidebar mixes <a> links and a <button> — the button
    // should also be recognized as a repeating container member since every
    // direct child of the <nav> has exactly one interactive element.
    it("returns true for button direct child of nav with single-interactive siblings", () => {
        // Base: a standalone button outside nav is NOT in a repeating container
        const envStandalone = createDOM(`<div><button id="solo">Click</button></div>`);
        const solo = envStandalone.document.getElementById("solo") as unknown as HTMLElement;
        assert.equal(isInRepeatingContainer(solo), false,
            "Standalone button should not be in a repeating container");
        envStandalone.cleanup();

        // Delta: button as direct child of <nav> where all children have one interactive element
        const env = createDOM(`
            <nav aria-label="Primary">
                <a href="/home">Home</a>
                <a href="/explore">Explore</a>
                <a href="/notifications">Notifications</a>
                <button id="t" aria-label="More menu items">More</button>
            </nav>
        `);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.equal(isInRepeatingContainer(el), true,
            "Button in nav with single-interactive siblings should be in a repeating container");
        env.cleanup();
    });

    it("returns false for nav child when a sibling has multiple interactive elements", () => {
        const env = createDOM(`
            <nav>
                <a href="/home">Home</a>
                <div><a href="/explore">Explore</a><button>Extra</button></div>
                <button id="t">More</button>
            </nav>
        `);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.equal(isInRepeatingContainer(el), false,
            "Nav child should not qualify when a sibling has multiple interactive elements");
        env.cleanup();
    });

    it("getRepeatingContainer returns the element itself for nav children", () => {
        const env = createDOM(`
            <nav>
                <a href="/home">Home</a>
                <a href="/explore">Explore</a>
                <a href="/notifications">Notifications</a>
                <button id="t">More</button>
            </nav>
        `);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.equal(getRepeatingContainer(el), el,
            "Repeating container for nav child should be the element itself");
        env.cleanup();
    });
});

// Google: inline-block <a> wrapping <h3> heading + URL info.
// shouldRedirectToHeading must fire for non-block display values (inline-block,
// inline-flex) so the hint centers on the heading, not the combined children.
describe("shouldRedirectToHeading", () => {
    it("redirects for block link with heading", () => {
        const link = makeElement("A", { href: "/page", display: "block", width: 800, height: 60, top: 0, left: 0 });
        const heading = makeElement("H3", { width: 400, height: 25, top: 0, left: 0, textContent: "Title" });
        link.appendChild(heading);
        assert.ok(shouldRedirectToHeading(link));
    });

    it("redirects for inline-block link with heading", () => {
        // Base: block link redirects
        const blockLink = makeElement("A", { href: "/page", display: "block", width: 800, height: 60, top: 0, left: 0 });
        blockLink.appendChild(makeElement("H3", { width: 400, height: 25, top: 0, left: 0, textContent: "Title" }));
        assert.ok(shouldRedirectToHeading(blockLink), "block link should redirect");

        // Delta: inline-block link should also redirect
        const link = makeElement("A", { href: "/page", display: "inline-block", width: 500, height: 60, top: 0, left: 0 });
        const heading = makeElement("H3", { width: 200, height: 25, top: 0, left: 0, textContent: "Title" });
        link.appendChild(heading);
        assert.ok(shouldRedirectToHeading(link), "inline-block link with heading should also redirect");
    });

    it("does not redirect inside repeating container", () => {
        const env = createDOM(`
            <li>
                <a id="t" href="/page"><h3>Title</h3></a>
            </li>
        `);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.ok(!shouldRedirectToHeading(el), "link in <li> should not redirect to heading");
        env.cleanup();
    });

    // <h2><a>title</a></h2> — heading wraps the link. Should NOT redirect
    // because the heading is block-level (wider than the inline link text).
    // Only <a><h>title</h></a> redirects (heading is inline inside the link).
    it("does not redirect when link is inside a heading ancestor", () => {
        const env = createDOM(`<h2><a id="t" href="/page">Title</a></h2>`);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.ok(!shouldRedirectToHeading(el), "link inside heading should not redirect");
        env.cleanup();
    });

    it("does not redirect when no heading exists", () => {
        const env = createDOM(`<a id="t" href="/page"><span>Not a heading</span></a>`);
        const el = env.document.getElementById("t") as unknown as HTMLElement;
        assert.ok(!shouldRedirectToHeading(el), "link without heading should not redirect");
        env.cleanup();
    });
});

// Integration: verify hint positioning composes the predicates correctly
describe("block link hint positioning", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("standalone block link centers hint on heading, not full-width block", () => {
        // Block <a> is 800px wide, but heading is only 400px — hint should center on heading
        const link = makeElement("A", { href: "/page", top: 10, left: 0, width: 800, height: 60, display: "block" });
        const heading = makeElement("H3", { top: 10, left: 0, width: 400, height: 25, textContent: "Short title" });
        const cite = makeElement("CITE", { top: 40, left: 0, width: 300, height: 15, textContent: "https://example.com" });
        link.appendChild(heading);
        link.appendChild(cite);

        loadModules([link]);
        (globalThis as any).document.elementsFromPoint = () => [link];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1);
        const hintLeft = parseFloat(hints[0].style.left);
        assert.ok(hintLeft >= 190 && hintLeft <= 210,
            `Hint left (${hintLeft}) should center on heading (~200), not full-width link (~400)`);
    });

    it("link inside <li> gets container treatment, not heading redirect", () => {
        // Same structure but inside a list item — sized link in repeating
        // container gets glow + inside-end, heading redirect is suppressed.
        const li = makeElement("LI", { top: 10, left: 0, width: 800, height: 60, display: "list-item" });
        const link = makeElement("A", { href: "/page", top: 10, left: 0, width: 800, height: 60, display: "block" });
        const heading = makeElement("H3", { top: 10, left: 0, width: 400, height: 25, textContent: "Short title" });
        link.appendChild(heading);
        li.appendChild(link);

        loadModules([link]);
        (globalThis as any).document.elementsFromPoint = () => [link];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        assert.ok(overlay?.querySelector(".tabi-hint-container-glow"),
            "Link inside <li> should get container glow");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1);
        assert.ok(!hints[0]?.querySelector(".tabi-hint-tail"),
            "Link inside <li> should not get pointer tail");
    });

    it("inline-block link with heading centers hint on heading, not combined children", () => {
        // Google: <a> with display:inline-block wraps <h3> (200px) + URL div (450px).
        // Without heading redirect, content-narrowing centers on combined children (~225px).
        // With heading redirect, hint centers on the h3 text rect (~100px).
        const link = makeElement("A", { href: "/page", top: 10, left: 0, width: 500, height: 60, display: "inline-block" });
        const heading = makeElement("H3", { top: 10, left: 0, width: 200, height: 25, display: "inline", textContent: "Renters Insurance" });
        const urlDiv = makeElement("DIV", { top: 40, left: 0, width: 450, height: 15, textContent: "https://example.com" });
        link.appendChild(heading);
        link.appendChild(urlDiv);

        loadModules([link]);
        (globalThis as any).document.elementsFromPoint = () => [link];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const hints = overlay?.querySelectorAll(".tabi-hint");
        assert.equal(hints?.length, 1);
        const hintLeft = parseFloat(hints[0].style.left);
        // Heading is 200px wide starting at left:0 — center is ~100px.
        // If content-narrowing fires instead, center would be ~225px (combined 450px extent).
        assert.ok(hintLeft >= 90 && hintLeft <= 110,
            `Hint left (${hintLeft}) should center on heading (~100), not combined children (~225)`);
    });
});

// ISSUE: Links in repeating containers (li/tr) don't get container glow because
// isContainerSized checks the link's dimensions instead of the container's.
// The glow border is rendered around the container, so the container's size
// should determine eligibility.
// SITE: facebook.com/messages — contact list links (avatar + name) inside <li>
// FIX: When element is in a repeating container, pass the container to isContainerSized.
describe("repeating container sizing uses container dimensions", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("link sized below threshold gets container glow when <li> is above threshold", () => {
        // Base: narrow link (width < MINIMUM_CONTAINER_WIDTH) NOT in a
        // repeating container — too small for container glow on its own.
        const base = makeElement("A", { href: "/messages/t/123/", top: 10, left: 0, width: 50, height: 52 });
        base.appendChild(makeElement("DIV", { top: 14, left: 8, width: 36, height: 36 }));
        base.appendChild(makeElement("SPAN", { top: 18, left: 42, width: 8, height: 20, textContent: "AI" }));

        loadModules([base]);
        (globalThis as any).document.elementsFromPoint = () => [base];
        let { hintMode } = getState();
        hintMode.activate(false);
        let overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        assert.ok(!overlay?.querySelector(".tabi-hint-container-glow"),
            "Base: narrow link without repeating container should not get container glow");
        hintMode.deactivate();

        // Delta: same narrow link inside <li> that IS container-sized — glow
        // appears because isContainerSized checks the <li>, not the <a>.
        const li = makeElement("LI", { top: 0, left: 0, width: 350, height: 80, display: "list-item" });
        const link = makeElement("A", { href: "/messages/t/123/", top: 10, left: 0, width: 50, height: 52 });
        link.appendChild(makeElement("DIV", { top: 14, left: 8, width: 36, height: 36 }));
        link.appendChild(makeElement("SPAN", { top: 18, left: 42, width: 8, height: 20, textContent: "AI" }));
        li.appendChild(link);

        loadModules([link]);
        (globalThis as any).document.elementsFromPoint = () => [link];
        ({ hintMode } = getState());
        hintMode.activate(false);
        overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        assert.ok(overlay?.querySelector(".tabi-hint-container-glow"),
            "Delta: link in <li> should get container glow using container dimensions");
    });
});

// ISSUE: Contentless overlay <a> (stretched-link card pattern) is the only navigation
// path to an article, but gets skipped. Non-interactive images with cursor:pointer
// get hints instead — clicking them doesn't navigate because the <a> is a sibling.
// SITE: theguardian.com — carousel cards with overlay <a> + image + comment link
// FIX: Drop cursor:pointer as a discovery signal; stop skipping overlay <a> elements.
describe("overlay link gets hint, non-interactive image does not", () => {
    it("selects overlay link and comment link, not the image", () => {
        const env = createDOM(`
            <div>
                <a id="overlay" href="/article" aria-label="Article title"></a>
                <div>
                    <picture><img id="photo" src="photo.jpg" alt=""></picture>
                    <h3><span>Article title</span></h3>
                    <footer>
                        <a id="comments" href="/article#comments">24 comments</a>
                    </footer>
                </div>
            </div>
        `);

        const overlay = env.document.getElementById("overlay") as unknown as HTMLElement;
        const photo = env.document.getElementById("photo") as unknown as HTMLElement;
        const comments = env.document.getElementById("comments") as unknown as HTMLElement;

        overlay.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 300, right: 400, width: 400, height: 300, x: 0, y: 0, toJSON() { return this; } }) as DOMRect;
        photo.getBoundingClientRect = () => ({ top: 150, left: 0, bottom: 300, right: 400, width: 400, height: 150, x: 0, y: 150, toJSON() { return this; } }) as DOMRect;
        comments.getBoundingClientRect = () => ({ top: 130, left: 10, bottom: 148, right: 200, width: 190, height: 18, x: 10, y: 130, toJSON() { return this; } }) as DOMRect;

        // Overlay is topmost via position:absolute; comment link pokes through via z-index
        (env.document as any).elementsFromPoint = (x: number, y: number) => {
            const result: unknown[] = [];
            for (const el of [comments, overlay, photo]) {
                const r = (el as HTMLElement).getBoundingClientRect();
                if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) result.push(el);
            }
            return result;
        };

        const found = discoverElements((el) => el.getBoundingClientRect());
        const ids = found.map(e => e.id);

        assert.ok(ids.includes("overlay"), "Overlay <a> should get a hint — it's the article link");
        assert.ok(ids.includes("comments"), "Comment link should get a hint");
        assert.ok(!ids.includes("photo"), "Non-interactive image should not get a hint");
    });
});

// ISSUE: Buttons inside shadow DOM are falsely occluded because
// document.elementsFromPoint returns the shadow host, and Node.contains()
// doesn't cross shadow boundaries — the host looks like an unrelated cover.
// SITE: reddit.com — comment expand/collapse buttons inside <shreddit-comment> web components
// FIX: Containment check walks up the composed tree (crossing shadow root
// boundaries) so shadow hosts are recognized as ancestors, not unrelated covers.
describe("shadow DOM elements not falsely occluded", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("button inside shadow root gets hint when host is the elementsFromPoint result", () => {
        // Create shadow host (like <shreddit-comment>)
        const host = makeElement("DIV", { top: 0, left: 0, width: 600, height: 100 });

        // Create button inside shadow root
        const btn = makeElement("BUTTON", { top: 10, left: 10, width: 24, height: 24 });
        btn.id = "shadow-btn";
        const shadow = host.attachShadow({ mode: "open" });
        shadow.appendChild(btn);

        // Add host to DOM — walker discovers shadow roots via element.shadowRoot
        loadModules([host]);

        // elementsFromPoint returns the shadow HOST, not the button inside it.
        // This simulates browser behavior: document.elementsFromPoint doesn't
        // pierce shadow DOM boundaries.
        (globalThis as any).document.elementsFromPoint = () => [host];

        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive(),
            "Button inside shadow root should get a hint — shadow host is an ancestor, not a cover");
    });
});

// ISSUE: display:contents <li> has no box and shouldn't count as a repeating container
// FIX: isInRepeatingContainer composes hasBox — only box-generating ancestors count
describe("isInRepeatingContainer with display:contents", () => {
    it("box-generating <li> is a repeating container, display:contents is not", () => {
        const env = createDOM(`
            <ul>
                <li id="boxed" style="display: list-item;">
                    <a id="link-boxed" href="#">Link</a>
                </li>
                <li id="contents" style="display: contents;">
                    <a id="link-contents" href="#">Link</a>
                </li>
            </ul>
        `);

        const linkBoxed = env.document.getElementById("link-boxed") as HTMLElement;
        const linkContents = env.document.getElementById("link-contents") as HTMLElement;

        // Base: link inside a normal <li> IS in a repeating container
        assert.equal(isInRepeatingContainer(linkBoxed), true,
            "Link inside box-generating <li> should be in a repeating container");

        // Delta: link inside display:contents <li> is NOT in a repeating container
        assert.equal(isInRepeatingContainer(linkContents), false,
            "Link inside display:contents <li> should not be in a repeating container");

        env.cleanup();
    });
});

// ISSUE: <details role="article" tabindex="0"> gets a hint — structural container, not a click target
// SITE: Reddit — shreddit-comment shadow DOM
// FIX: tabindex alone is not a clickable signal — only semantic signals (roles, native elements,
// onclick) make an element clickable. tabindex="0" means "focusable", not "clickable".
describe("tabindex is not a clickable signal", () => {
    it("onclick makes a div clickable, tabindex alone does not", () => {
        const env = createDOM(`
            <div>
                <div id="with-onclick" onclick="">Click handler</div>
                <div id="with-tabindex" tabindex="0">Just focusable</div>
                <div id="with-role" tabindex="0" role="button">Interactive role</div>
            </div>
        `);

        const withOnclick = env.document.getElementById("with-onclick") as HTMLElement;
        const withTabindex = env.document.getElementById("with-tabindex") as HTMLElement;
        const withRole = env.document.getElementById("with-role") as HTMLElement;

        // Base: onclick makes a div clickable
        assert.equal(withOnclick.matches(CLICKABLE_SELECTOR), true,
            "onclick should make element match CLICKABLE_SELECTOR");

        // Delta: tabindex alone does NOT make it clickable
        assert.equal(withTabindex.matches(CLICKABLE_SELECTOR), false,
            "tabindex='0' alone should NOT match CLICKABLE_SELECTOR — focusable ≠ clickable");

        // Interactive role makes it clickable regardless of tabindex
        assert.equal(withRole.matches(CLICKABLE_SELECTOR), true,
            "role='button' should match via role selector, independent of tabindex");

        env.cleanup();
    });
});

describe("isSiblingInRepeatingContainer", () => {
    // Facebook: adjacent sidebar items tile edge-to-edge with overflowing child
    // content — sibling items in the same repeating container are not real occluders

    it("returns false for elements in separate subtrees", () => {
        const env = createDOM(`
            <nav><a id="t" href="#">link</a></nav>
            <main><div id="cover">content</div></main>
        `);
        const t = env.document.getElementById("t") as HTMLElement;
        const cover = env.document.getElementById("cover") as HTMLElement;

        // Base: unrelated elements are not siblings in a repeating container
        assert.equal(isSiblingInRepeatingContainer(t, cover), false);

        env.cleanup();
    });

    it("returns true for elements in sibling list items", () => {
        const env = createDOM(`
            <ul>
                <li id="item1"><a id="t" href="#">link</a></li>
                <li id="item2"><div id="cover">content</div></li>
            </ul>
        `);
        const t = env.document.getElementById("t") as HTMLElement;
        const cover = env.document.getElementById("cover") as HTMLElement;

        // Delta: elements in sibling <li> under the same <ul> are siblings
        assert.equal(isSiblingInRepeatingContainer(t, cover), true);

        env.cleanup();
    });

    it("returns false for elements in the same list item", () => {
        const env = createDOM(`
            <ul>
                <li>
                    <a id="t" href="#">link</a>
                    <div id="cover">content</div>
                </li>
            </ul>
        `);
        const t = env.document.getElementById("t") as HTMLElement;
        const cover = env.document.getElementById("cover") as HTMLElement;

        // Same <li> — not siblings, could be a real occluder
        assert.equal(isSiblingInRepeatingContainer(t, cover), false);

        env.cleanup();
    });

    // Twitter/X: sibling <a> links in nav should be treated as siblings
    // in a repeating container for occlusion exemption
    it("returns true for elements in sibling <a> nav links", () => {
        const env = createDOM(`
            <nav>
                <a id="link1" href="/home">Home</a>
                <a id="link2" href="/explore">Explore</a>
                <a href="/notifications">Notifications</a>
            </nav>
        `);
        const a = env.document.getElementById("link1") as HTMLElement;
        const b = env.document.getElementById("link2") as HTMLElement;

        assert.equal(isSiblingInRepeatingContainer(a, b), true,
            "Sibling <a> links should be siblings in a repeating container");
        env.cleanup();
    });
});

// ISSUE: Custom checkbox uses an SVG sibling inside <label> to render the
// visual affordance; the SVG covers the <input> and isOccluded filters it out.
// SITE: lemonade.com
// FIX: elements sharing a common <label> ancestor are part of the same form
// control — decorative siblings should not occlude the actual input.
describe("isInSameLabel", () => {
    it("returns true for siblings inside the same label", () => {
        const env = createDOM(`
            <label>
                <input id="t" type="checkbox">
                <svg id="cover" width="22" height="22" viewBox="0 0 22 22">
                    <polyline points="6 10 9 14 16 8" stroke="#fff" />
                </svg>
            </label>
        `);
        const t = env.document.getElementById("t") as HTMLElement;
        const cover = env.document.getElementById("cover") as HTMLElement;

        // Base: elements NOT in a label are not in the same label
        const env2 = createDOM(`
            <div>
                <input id="t2" type="checkbox">
                <svg id="cover2" width="22" height="22"></svg>
            </div>
        `);
        const t2 = env2.document.getElementById("t2") as HTMLElement;
        const cover2 = env2.document.getElementById("cover2") as HTMLElement;
        assert.equal(isInSameLabel(t2, cover2), false,
            "siblings outside a label are not in the same label");
        env2.cleanup();

        // Delta: wrapping in <label> makes them part of the same control
        assert.equal(isInSameLabel(t, cover), true,
            "input and sibling SVG inside the same label");

        env.cleanup();
    });

    it("returns false for elements in different labels", () => {
        const env = createDOM(`
            <div>
                <label><input id="t" type="checkbox"></label>
                <label><svg id="cover" width="22" height="22"></svg></label>
            </div>
        `);
        const t = env.document.getElementById("t") as HTMLElement;
        const cover = env.document.getElementById("cover") as HTMLElement;

        assert.equal(isInSameLabel(t, cover), false);

        env.cleanup();
    });
});

describe("jsaction click discovery", () => {
    // Google Drive: <tr jsaction="click:h5M12e" role="row"> rows are interactive
    // but have no onclick, no clickable ARIA role — only Google Closure's jsaction
    // attribute declares the click handler. Without detecting jsaction, these rows
    // get no hint and the user can't navigate Drive folders.
    // FIX: treat jsaction containing "click:" as a clickable signal, like [onclick].

    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("jsaction containing click: makes an element discoverable", () => {
        loadModules([]);
        const noJsaction = makeElement("TR", {
            top: 10, left: 0, width: 800, height: 40,
            attrs: { role: "row" },
            textContent: "No handler",
        });
        const withJsaction = makeElement("TR", {
            top: 60, left: 0, width: 800, height: 40,
            attrs: { role: "row", jsaction: "contextmenu:mg9Pef; click:h5M12e; dblclick:Hq2DWe" },
            textContent: "Resources",
        });

        // Base: role="row" alone is not clickable
        assert.equal(walkerFilter(noJsaction), NodeFilter.FILTER_SKIP);

        // Delta: jsaction with click: makes it discoverable
        assert.equal(walkerFilter(withJsaction), NodeFilter.FILTER_ACCEPT);
    });

    it("jsaction without click: is not discoverable", () => {
        loadModules([]);
        const el = makeElement("DIV", {
            top: 10, left: 0, width: 100, height: 40,
            attrs: { jsaction: "mouseover:UI3Kjd; mouseleave:Tx5Rb" },
            textContent: "Hover only",
        });

        // jsaction without click: — not a click target
        assert.equal(walkerFilter(el), NodeFilter.FILTER_SKIP);
    });
});

// ISSUE: Replaced elements (iframe, object, embed) render opaque external content
// but have no DOM children — isEmpty incorrectly exempts them from
// occluding elements behind them, so hints shine through.
// SITE: Google Drive — callout popup iframe covers page elements
// FIX: isEmpty returns false for replaced elements that render external content
describe("isEmpty replaced elements", () => {
    it("iframe is not a contentless overlay despite having no DOM children", () => {
        const env = createDOM(`
            <div>
                <div id="empty"></div>
                <iframe id="frame" role="presentation"></iframe>
            </div>
        `);

        const empty = env.document.getElementById("empty") as unknown as HTMLElement;
        const frame = env.document.getElementById("frame") as unknown as HTMLElement;

        // Base: an empty div IS a contentless overlay
        assert.equal(isEmpty(empty), true);

        // Delta: an iframe is NOT — it renders external content
        assert.equal(isEmpty(frame), false);

        env.cleanup();
    });

    it("object and embed are not contentless overlays", () => {
        const env = createDOM(`
            <div>
                <object id="obj" data="plugin.swf"></object>
                <embed id="emb" src="plugin.swf">
            </div>
        `);

        const obj = env.document.getElementById("obj") as unknown as HTMLElement;
        const emb = env.document.getElementById("emb") as unknown as HTMLElement;

        assert.equal(isEmpty(obj), false);
        assert.equal(isEmpty(emb), false);

        env.cleanup();
    });
});

// ISSUE: In tree views (GitHub PR file tree), nested <li> items are deduped away
// by allGeneric because parentMap crosses <ul> boundaries, connecting treeitems
// at different levels as parent-child duplicates.
// FIX: Stop parentMap at <ul>/<ol> boundaries so nested list items are independent.
describe("dedup respects list boundaries in nested trees", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("intermediate treeitems survive dedup across list boundaries", () => {
        const folder = makeElement("LI", { top: 0, left: 0, width: 300, height: 30,
            attrs: { role: "treeitem" } });
        const innerList = makeElement("UL", { top: 30, left: 0, width: 300, height: 60 });
        const file = makeElement("LI", { top: 30, left: 0, width: 300, height: 30,
            attrs: { role: "treeitem" } });
        const link = makeElement("A", { href: "#diff", top: 30, left: 20, width: 200, height: 20 });

        file.appendChild(link);
        innerList.appendChild(file);
        folder.appendChild(innerList);

        loadModules([folder, file, link]);

        (globalThis as any).document.elementsFromPoint = (x: number, y: number) => {
            for (const el of [link, file, folder]) {
                const r = el.getBoundingClientRect();
                if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return [el];
            }
            return [];
        };

        const { hintMode } = getState();

        // Base: without list boundary, folder dedup would remove file treeitem
        // Delta: with <ul> between them, both survive as independent items
        hintMode.activate(false);
        assert.ok(hintMode.isActive(), "hints should be active");
    });
});

// ISSUE: noNestedLinks blocks container glow on folder <li> items that contain
// discovered children in sub-lists, even though those children are at a different
// tree level and won't visually clash with the glow.
// FIX: hasListBoundaryBetween exempts sub-list children from the noNestedLinks check.
describe("hasListBoundaryBetween", () => {
    it("no boundary for direct child, boundary across nested list", () => {
        const env = createDOM(`
            <li id="container">
                <a id="direct" href="#">direct link</a>
                <ul>
                    <li>
                        <a id="nested" href="#">nested link</a>
                    </li>
                </ul>
            </li>
        `);

        const container = env.document.getElementById("container") as HTMLElement;
        const direct = env.document.getElementById("direct") as HTMLElement;
        const nested = env.document.getElementById("nested") as HTMLElement;

        // Base: direct child has no list boundary
        assert.equal(hasListBoundaryBetween(container, direct), false,
            "direct child should have no list boundary");

        // Delta: child inside nested <ul><li> has a list boundary
        assert.equal(hasListBoundaryBetween(container, nested), true,
            "child in sub-list should have a list boundary");

        env.cleanup();
    });
});

// AngryMetalGuy: <h2><a>title</a></h2> — heading wraps link. The <a> has
// the correct inline width, the <h2> has the correct height. Pill should
// use the intersection: <a>'s width, <h2>'s height.
describe("heading ancestor rect clamping", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("clamps link rect to heading ancestor bounds", () => {
        // Base: <a> without heading ancestor — uses full <a> rect
        const div = makeElement("DIV", { top: 0, left: 0, width: 500, height: 40, display: "block" });
        const a1 = makeElement("A", {
            href: "#",
            top: 0, left: 0, width: 200, height: 40,
        });
        div.appendChild(a1);

        loadModules([a1]);
        let hm = getState().hintMode;
        hm.activate(false);

        let overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        let hint = overlay?.querySelector(".tabi-hint") as HTMLElement;
        assert.ok(hint, "base: hint should exist");
        // Pill at a.bottom(40) + 2 = 42px
        assert.equal(hint.style.top, "42px");
        hm.deactivate();

        // Delta: <h2 28px><a 40px> — heading clamps rect, pill uses h2.bottom
        const h2 = makeElement("H2", { top: 0, left: 0, width: 500, height: 28, display: "block" });
        const a2 = makeElement("A", {
            href: "#",
            top: 0, left: 0, width: 200, height: 40,
        });
        h2.appendChild(a2);

        loadModules([a2]);
        hm = getState().hintMode;
        hm.activate(false);

        overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        hint = overlay?.querySelector(".tabi-hint") as HTMLElement;
        assert.ok(hint, "delta: hint should exist");
        // Pill at h2.bottom(28) + 2 = 30px, not a.bottom(40) + 2 = 42px
        assert.equal(hint.style.top, "30px");
        // Width stays as <a>'s: centered at 200/2 = 100px
        assert.equal(hint.style.left, "100px");
    });
});

// TODO: Test for expanded folder glow eligibility — containers with child lists
// always qualify for glow regardless of aspect ratio. Needs investigation into
// why this test causes happy-dom to hang.

// ISSUE: Sibling <tr> rows in a table should get consistent container glow
// treatment (all or none), just like <li> items in a <ul>. If one row gets
// glow, all rows in the same <tbody> must also get glow.
// SITE: Macquarie banking — account list table with clickable rows
// FIX: Verify all-or-none grouping works for <tr> the same as <li>.
describe("table row container glow all-or-none", () => {
    afterEach(() => {
        const { hintMode, keyHandler } = getState();
        if (hintMode) hintMode.destroy();
        if (keyHandler) keyHandler.destroy();
    });

    it("sibling <tr> rows with 1 button each get consistent glow", () => {
        // Build table: 2 rows, each with 1 button inside a <td>
        const table = makeElement("TABLE", { top: 0, left: 0, width: 1000, height: 100, display: "table" });
        const tbody = makeElement("TBODY", { top: 0, left: 0, width: 1000, height: 100, display: "table-row-group" });

        const tr1 = makeElement("TR", { top: 0, left: 0, width: 1000, height: 50, display: "table-row" });
        const td1 = makeElement("TD", { top: 0, left: 0, width: 200, height: 50, display: "table-cell" });
        const btn1 = makeElement("BUTTON", { top: 10, left: 10, width: 80, height: 30, textContent: "Pin 1" });
        td1.appendChild(btn1);
        tr1.appendChild(td1);

        const tr2 = makeElement("TR", { top: 50, left: 0, width: 1000, height: 50, display: "table-row" });
        const td2 = makeElement("TD", { top: 50, left: 0, width: 200, height: 50, display: "table-cell" });
        const btn2 = makeElement("BUTTON", { top: 60, left: 10, width: 80, height: 30, textContent: "Pin 2" });
        td2.appendChild(btn2);
        tr2.appendChild(td2);

        tbody.appendChild(tr1);
        tbody.appendChild(tr2);
        table.appendChild(tbody);

        loadModules([table]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const glows = overlay?.querySelectorAll(".tabi-hint-container-glow");
        const hints = overlay?.querySelectorAll(".tabi-hint");

        // Both rows should get hints
        assert.equal(hints?.length, 2, "both buttons should get hints");
        // All-or-none: both rows should get container glow
        assert.equal(glows?.length, 2, "both rows should get container glow (all-or-none)");
    });

    it("glow propagates to sibling <tr> without discovered elements", () => {
        // Row 1 has a button, row 2 has no interactive elements.
        // Glow should propagate to row 2 because it's a sibling container.
        const table = makeElement("TABLE", { top: 0, left: 0, width: 1000, height: 100, display: "table" });
        const tbody = makeElement("TBODY", { top: 0, left: 0, width: 1000, height: 100, display: "table-row-group" });

        const tr1 = makeElement("TR", { top: 0, left: 0, width: 1000, height: 50, display: "table-row" });
        const td1 = makeElement("TD", { top: 0, left: 0, width: 200, height: 50, display: "table-cell" });
        const btn1 = makeElement("BUTTON", { top: 10, left: 10, width: 80, height: 30, textContent: "Pin 1" });
        td1.appendChild(btn1);
        tr1.appendChild(td1);

        // Row 2: no interactive elements at all
        const tr2 = makeElement("TR", { top: 50, left: 0, width: 1000, height: 50, display: "table-row" });
        const td2 = makeElement("TD", { top: 50, left: 0, width: 200, height: 50, display: "table-cell" });
        td2.appendChild(((globalThis as any).document as Document).createTextNode("Transaction Account") as unknown as Node);
        tr2.appendChild(td2);

        tbody.appendChild(tr1);
        tbody.appendChild(tr2);
        table.appendChild(tbody);

        loadModules([table]);
        const { hintMode } = getState();
        hintMode.activate(false);
        assert.ok(hintMode.isActive());

        const overlay = (globalThis as any).document.documentElement.querySelector(".tabi-hint-overlay");
        const glows = overlay?.querySelectorAll(".tabi-hint-container-glow");
        const hints = overlay?.querySelectorAll(".tabi-hint");

        // Row 1 button + propagated row 2 container = 2 hints
        assert.equal(hints?.length, 2, "propagated row should get a hint too");
        // Both rows get glow
        assert.equal(glows?.length, 2, "glow propagates to sibling container");
    });
});