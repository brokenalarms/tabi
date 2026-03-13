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

