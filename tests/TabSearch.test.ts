// TabSearch unit tests — using Node.js built-in test runner + happy-dom
// Tests fuzzy matching/scoring, overlay lifecycle, keyboard navigation,
// tab switching, favicon rendering, match highlighting, and command wiring.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom";
import { KeyHandler } from "../src/modules/KeyHandler";
import { TabSearch, fuzzyMatch } from "../src/modules/TabSearch";
import { Mode } from "../src/commands";

let env: DOMEnvironment;
let keyHandler: KeyHandler;
let tabSearch: TabSearch;
let sentMessages: any[];

function setupBrowserMock() {
    sentMessages = [];
    (globalThis as any).browser = {
        runtime: {
            sendMessage(msg: any) {
                sentMessages.push(msg);
                if (msg.command === "queryTabs") {
                    return Promise.resolve([
                        { id: 1, title: "GitHub - Home", url: "https://github.com", active: true },
                        { id: 2, title: "Google Search", url: "https://google.com/search?q=test", active: false, favIconUrl: "https://google.com/favicon.ico" },
                        { id: 3, title: "Stack Overflow - JavaScript", url: "https://stackoverflow.com/questions", active: false },
                        { id: 4, title: "MDN Web Docs", url: "https://developer.mozilla.org", active: false, favIconUrl: "https://developer.mozilla.org/favicon.ico" },
                        { id: 5, title: "YouTube", url: "https://youtube.com", active: false },
                    ]);
                }
                return Promise.resolve({ status: "ok" });
            },
        },
    };
}

function fireKeyDown(code: string, opts: { key?: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) {
    const event = new (env.window as any).KeyboardEvent("keydown", {
        code,
        key: opts.key || "",
        shiftKey: opts.shiftKey || false,
        ctrlKey: opts.ctrlKey || false,
        altKey: opts.altKey || false,
        metaKey: opts.metaKey || false,
        bubbles: true,
        cancelable: true,
    });
    env.document.dispatchEvent(event);
    return event;
}

describe("fuzzyMatch", () => {
    // Proves that fuzzy matching finds characters in order across gaps
    it("matches characters scattered across text", () => {
        const result = fuzzyMatch("ghb", "GitHub");
        assert.ok(result.score > 0);
        assert.deepEqual(result.indices, [0, 3, 5]);
    });

    // Proves prefix bonus is applied when first char matches index 0
    it("awards prefix bonus when match starts at position 0", () => {
        // Base: match starting mid-string gets no prefix bonus
        const mid = fuzzyMatch("oo", "foobar");

        // Delta: match starting at position 0 scores higher
        const prefix = fuzzyMatch("fo", "foobar");
        assert.ok(prefix.score > mid.score, "prefix should score higher than mid-string");
    });

    // Proves word-boundary bonus is applied after separators
    it("awards word-boundary bonus after separator", () => {
        // Base: match in middle of word, no boundary bonus
        const midWord = fuzzyMatch("ub", "foobar-sub");
        // u(7), b(8) — no boundary, just contiguous

        // Delta: match at word boundary after separator scores higher
        const boundary = fuzzyMatch("su", "foobar-sub");
        // s(7), u(8) — s is after '-' separator, gets boundary bonus + contiguous
        assert.ok(boundary.score > midWord.score, "boundary match should outscore mid-word");
    });

    // Proves contiguous run of matches gets bonus
    it("awards contiguous bonus for adjacent matched characters", () => {
        // Base: scattered matches (no contiguous bonus)
        const scattered = fuzzyMatch("gth", "GitHub");
        // indices: g(0), t(2), h(3) — only t->h is contiguous (1 bonus)

        // Delta: fully contiguous matches get more bonus
        const contiguous = fuzzyMatch("git", "GitHub");
        // indices: g(0), i(1), t(2) — all contiguous (2 bonuses)
        assert.ok(contiguous.score > scattered.score, "contiguous should outscore scattered");
    });

    // Proves no match returns score -1 and empty indices
    it("returns -1 and empty indices for no match", () => {
        const result = fuzzyMatch("xyz", "GitHub");
        assert.equal(result.score, -1);
        assert.deepEqual(result.indices, []);
    });

    // Proves empty query returns no match
    it("returns -1 for empty query", () => {
        assert.equal(fuzzyMatch("", "text").score, -1);
    });

    // Proves case-insensitive matching
    it("matches case-insensitively", () => {
        const result = fuzzyMatch("GIT", "github");
        assert.ok(result.score > 0);
        assert.deepEqual(result.indices, [0, 1, 2]);
    });

    // Proves indices track correct character positions
    it("returns correct indices for each matched character", () => {
        const result = fuzzyMatch("mdn", "MDN Web Docs");
        assert.deepEqual(result.indices, [0, 1, 2]);
    });
});

describe("TabSearch", () => {
    beforeEach(() => {
        env = createDOM();
        setupBrowserMock();
        keyHandler = new KeyHandler();
        tabSearch = new TabSearch(keyHandler);
        keyHandler.on("exitToNormal", () => {
            if (tabSearch.isActive()) tabSearch.deactivate();
            keyHandler.setMode(Mode.NORMAL);
        });
    });

    afterEach(() => {
        if (tabSearch) tabSearch.destroy();
        if (keyHandler) keyHandler.destroy();
        delete (globalThis as any).browser;
        env.cleanup();
    });

    describe("activation and deactivation", () => {
        it("creates overlay on activate and sets TAB_SEARCH mode", async () => {
            await tabSearch.activate();
            assert.equal(tabSearch.isActive(), true);
            assert.equal(keyHandler.getMode(), Mode.TAB_SEARCH);
            const overlay = env.document.querySelector(".tabi-overlay");
            assert.ok(overlay, "overlay element should exist in DOM");
        });

        it("removes overlay on deactivate and returns to NORMAL", async () => {
            await tabSearch.activate();
            tabSearch.deactivate();
            assert.equal(tabSearch.isActive(), false);
            assert.equal(keyHandler.getMode(), Mode.NORMAL);
            const overlay = env.document.querySelector(".tabi-overlay");
            assert.equal(overlay, null, "overlay should be removed from DOM");
        });

        // Deactivating tab search must restore the page scroll position
        // to exactly where it was before the overlay was opened.
        it("preserves scroll position on deactivate", async () => {
            let mockScrollX = 0;
            let mockScrollY = 500;
            Object.defineProperty(env.window, "scrollX", { get: () => mockScrollX, configurable: true });
            Object.defineProperty(env.window, "scrollY", { get: () => mockScrollY, configurable: true });
            const scrollCalls: [number, number][] = [];
            (env.window as any).scrollTo = (x: number, y: number) => {
                scrollCalls.push([x, y]);
                mockScrollX = x;
                mockScrollY = y;
            };

            await tabSearch.activate();
            // Simulate browser scroll jump (focus change moves scroll to top)
            mockScrollY = 0;

            tabSearch.deactivate();
            const lastCall = scrollCalls[scrollCalls.length - 1];
            assert.deepEqual(lastCall, [0, 500], "scroll should be restored to pre-activation position");
        });

        it("ignores double activate", async () => {
            await tabSearch.activate();
            await tabSearch.activate();
            const overlays = env.document.querySelectorAll(".tabi-overlay");
            assert.equal(overlays.length, 1);
        });

        it("excludes the active tab from results", async () => {
            await tabSearch.activate();
            // 5 tabs total, 1 active → 4 shown
            assert.equal((tabSearch as any).scored.length, 4);
            assert.ok((tabSearch as any).scored.every((e: any) => !e.tab.active));
        });

        // Tab search renders results on activation
        it("renders tab results on activation", async () => {
            await tabSearch.activate();
            const items = env.document.querySelectorAll(".tabi-tab-search-item");
            assert.equal(items.length, 4, "should render 4 tab results");
            const overlay = env.document.querySelector(".tabi-overlay");
            assert.ok(overlay, "overlay should exist");
        });

        // Second activation after deactivate must render results again
        it("renders tab results on second activation", async () => {
            // First activation works
            await tabSearch.activate();
            assert.equal(env.document.querySelectorAll(".tabi-tab-search-item").length, 4);

            // Deactivate
            tabSearch.deactivate();
            assert.equal(env.document.querySelector(".tabi-overlay"), null);

            // Second activation must also show results
            await tabSearch.activate();
            const items = env.document.querySelectorAll(".tabi-tab-search-item");
            assert.equal(items.length, 4, "second activation should render 4 tab results");
            const overlay = env.document.querySelector(".tabi-overlay");
            assert.ok(overlay, "overlay should exist on second activation");
        });
    });

    describe("keyboard navigation", () => {
        it("ArrowDown moves selection down", async () => {
            await tabSearch.activate();
            assert.equal((tabSearch as any).selectedIndex, 0);
            fireKeyDown("ArrowDown");
            assert.equal((tabSearch as any).selectedIndex, 1);
        });

        it("ArrowUp wraps around from first to last", async () => {
            await tabSearch.activate();
            assert.equal((tabSearch as any).selectedIndex, 0);
            fireKeyDown("ArrowUp");
            assert.equal((tabSearch as any).selectedIndex, (tabSearch as any).scored.length - 1);
        });

        it("Ctrl-j moves selection down", async () => {
            await tabSearch.activate();
            fireKeyDown("KeyJ", { ctrlKey: true });
            assert.equal((tabSearch as any).selectedIndex, 1);
        });

        it("Ctrl-k moves selection up (wraps)", async () => {
            await tabSearch.activate();
            fireKeyDown("KeyK", { ctrlKey: true });
            assert.equal((tabSearch as any).selectedIndex, (tabSearch as any).scored.length - 1);
        });

        it("ArrowDown wraps from last to first", async () => {
            await tabSearch.activate();
            const lastIdx = (tabSearch as any).scored.length - 1;
            (tabSearch as any).selectedIndex = lastIdx;
            fireKeyDown("ArrowDown");
            assert.equal((tabSearch as any).selectedIndex, 0);
        });
    });

    describe("Escape key", () => {
        it("dismisses overlay on Escape", async () => {
            await tabSearch.activate();
            fireKeyDown("Escape");
            assert.equal(tabSearch.isActive(), false);
            assert.equal(keyHandler.getMode(), Mode.NORMAL);
        });
    });

    describe("Ctrl-x close", () => {
        // Proves Ctrl-x dismisses the tab search overlay like Escape
        it("dismisses overlay on Ctrl-x", async () => {
            // Base: search is active
            await tabSearch.activate();
            assert.equal(tabSearch.isActive(), true);

            // Delta: Ctrl-x deactivates
            fireKeyDown("KeyX", { ctrlKey: true });
            assert.equal(tabSearch.isActive(), false);
            assert.equal(keyHandler.getMode(), Mode.NORMAL);
        });
    });

    describe("Enter key", () => {
        it("sends switchTab for selected tab on Enter", async () => {
            await tabSearch.activate();
            const selectedTab = (tabSearch as any).scored[0].tab;
            fireKeyDown("Enter");
            const switchMsg = sentMessages.find(m => m.command === "switchTab");
            assert.ok(switchMsg, "switchTab message should be sent");
            assert.equal(switchMsg.tabId, selectedTab.id);
            assert.equal(tabSearch.isActive(), false);
        });

        it("does nothing when no results match", async () => {
            await tabSearch.activate();
            (tabSearch as any).scored = [];
            (tabSearch as any).selectedIndex = 0;
            const beforeCount = sentMessages.length;
            fireKeyDown("Enter");
            const switchMsg = sentMessages.slice(beforeCount).find((m: any) => m.command === "switchTab");
            assert.equal(switchMsg, undefined);
        });
    });

    describe("search filtering", () => {
        it("filters tabs on input", async () => {
            await tabSearch.activate();
            (tabSearch as any).inputEl.value = "google";
            (tabSearch as any).onInputBound();
            assert.equal((tabSearch as any).scored.length, 1);
            assert.equal((tabSearch as any).scored[0].tab.title, "Google Search");
        });

        it("shows all tabs when input cleared", async () => {
            await tabSearch.activate();
            (tabSearch as any).inputEl.value = "google";
            (tabSearch as any).onInputBound();
            (tabSearch as any).inputEl.value = "";
            (tabSearch as any).onInputBound();
            assert.equal((tabSearch as any).scored.length, 4);
        });

        it("resets selection on filter change", async () => {
            await tabSearch.activate();
            (tabSearch as any).selectedIndex = 2;
            (tabSearch as any).inputEl.value = "stack";
            (tabSearch as any).onInputBound();
            assert.equal((tabSearch as any).selectedIndex, 0);
        });
    });

    describe("key event isolation", () => {
        it("prevents default for ArrowDown", async () => {
            await tabSearch.activate();
            const event = fireKeyDown("ArrowDown");
            assert.equal(event.defaultPrevented, true);
        });
    });

    describe("favicon rendering", () => {
        // Proves that tabs with favIconUrl render an img element
        it("renders favicon img when favIconUrl is present", async () => {
            await tabSearch.activate();
            const items = env.document.querySelectorAll(".tabi-tab-search-item");
            // Tab id=2 (Google Search) has a favIconUrl — it's the first non-active tab
            const firstItem = items[0];
            const img = firstItem.querySelector("img.tabi-tab-search-favicon") as HTMLImageElement | null;
            assert.ok(img, "favicon img should be rendered");
            assert.equal(img!.src, "https://google.com/favicon.ico");
        });

        // Proves that tabs without favIconUrl don't render an img element
        it("omits favicon img when favIconUrl is absent", async () => {
            await tabSearch.activate();
            const items = env.document.querySelectorAll(".tabi-tab-search-item");
            // Tab id=3 (Stack Overflow) has no favIconUrl — it's the second item
            const secondItem = items[1];
            const img = secondItem.querySelector("img.tabi-tab-search-favicon");
            assert.equal(img, null, "no favicon img when URL missing");
        });
    });

    describe("match highlighting", () => {
        // Proves that matched chars are wrapped in <mark> elements
        it("wraps matched characters in mark elements", async () => {
            await tabSearch.activate();
            (tabSearch as any).inputEl.value = "google";
            (tabSearch as any).onInputBound();
            const titleEl = env.document.querySelector(".tabi-tab-search-item-title");
            assert.ok(titleEl, "title element should exist");
            const marks = titleEl!.querySelectorAll("mark");
            assert.ok(marks.length > 0, "should have mark elements for matched chars");
            // "Google" is a prefix match on "Google Search", all 6 chars should be marked
            const markedText = Array.from(marks).map(m => m.textContent).join("");
            assert.equal(markedText, "Google");
        });

        // Proves that unmatched text is rendered as plain text nodes
        it("renders unmatched text as text nodes", async () => {
            await tabSearch.activate();
            (tabSearch as any).inputEl.value = "google";
            (tabSearch as any).onInputBound();
            const titleEl = env.document.querySelector(".tabi-tab-search-item-title");
            // " Search" should be a text node
            const text = titleEl!.textContent;
            assert.equal(text, "Google Search");
        });
    });

    describe("fuzzy matching", () => {
        // Proves tab search uses fuzzy matching (character skipping)
        it("finds tabs with scattered character matches", async () => {
            await tabSearch.activate();
            // "ggl" matches "Google" via fuzzy character skipping
            (tabSearch as any).inputEl.value = "ggl";
            (tabSearch as any).onInputBound();
            assert.ok((tabSearch as any).scored.length > 0, "fuzzy should find matches");
            assert.equal((tabSearch as any).scored[0].tab.title, "Google Search");
        });
    });

    describe("click interactions", () => {
        // Clicking a result item switches to that tab and dismisses the overlay
        it("clicking a result item switches to that tab", async () => {
            await tabSearch.activate();
            const items = env.document.querySelectorAll(".tabi-tab-search-item");
            assert.ok(items.length >= 3, "should have at least 3 items");
            const expectedTabId = (tabSearch as any).scored[2].tab.id;

            // Click the third item (index 2)
            const clickEvent = new (env.window as any).MouseEvent("click", { bubbles: true });
            items[2].dispatchEvent(clickEvent);

            const switchMsg = sentMessages.find((m: any) => m.command === "switchTab");
            assert.ok(switchMsg, "switchTab message should be sent on click");
            assert.equal(switchMsg.tabId, expectedTabId);
            assert.equal(tabSearch.isActive(), false, "overlay should dismiss after click");
        });

        // Clicking the overlay background (not a result) dismisses the search
        it("clicking overlay background dismisses the search", async () => {
            await tabSearch.activate();
            assert.equal(tabSearch.isActive(), true);

            const overlay = env.document.querySelector(".tabi-overlay") as HTMLElement;
            const clickEvent = new (env.window as any).MouseEvent("click", { bubbles: true });
            // Dispatch directly on overlay (simulates clicking the background)
            overlay.dispatchEvent(clickEvent);

            assert.equal(tabSearch.isActive(), false, "should dismiss on background click");
        });

        // Clicking inside the modal (not on an item) does NOT dismiss
        it("clicking inside modal does not dismiss", async () => {
            await tabSearch.activate();
            const modal = env.document.querySelector(".tabi-tab-search-modal") as HTMLElement;
            const clickEvent = new (env.window as any).MouseEvent("click", { bubbles: true });
            modal.dispatchEvent(clickEvent);

            assert.equal(tabSearch.isActive(), true, "should not dismiss when clicking modal");
        });
    });

    describe("mouse hover selection", () => {
        // Mousemove over a result item updates the visual selection
        it("mousemove updates selected item", async () => {
            await tabSearch.activate();
            const items = env.document.querySelectorAll(".tabi-tab-search-item");

            // Base: first item is selected
            assert.ok(items[0].classList.contains("selected"), "first item should start selected");
            assert.ok(!items[2].classList.contains("selected"), "third item should not be selected");

            // Delta: mousemove over third item changes selection
            const moveEvent = new (env.window as any).MouseEvent("mousemove", { bubbles: true });
            items[2].dispatchEvent(moveEvent);

            assert.ok(!items[0].classList.contains("selected"), "first item should lose selection");
            assert.ok(items[2].classList.contains("selected"), "third item should gain selection");
        });

        // Mousemove over already-selected item is a no-op
        it("mousemove over already-selected item does nothing", async () => {
            await tabSearch.activate();
            const items = env.document.querySelectorAll(".tabi-tab-search-item");

            // Move over first item (already selected) — should not throw or change state
            const moveEvent = new (env.window as any).MouseEvent("mousemove", { bubbles: true });
            items[0].dispatchEvent(moveEvent);

            assert.ok(items[0].classList.contains("selected"), "first item still selected");
            assert.equal((tabSearch as any).selectedIndex, 0);
        });
    });

    describe("command wiring", () => {
        it("openTabSearch command activates", async () => {
            let activated = false;
            const origActivate = tabSearch.activate.bind(tabSearch);
            tabSearch.activate = async () => { activated = true; await origActivate(); };
            (keyHandler as any).dispatch("openTabSearch");
            assert.equal(activated, true);
        });

        it("destroy unwires commands", () => {
            tabSearch.destroy();
            assert.equal((keyHandler as any).commands.has("openTabSearch"), false);
        });
    });
});
