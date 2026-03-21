// TabSearch unit tests — using Node.js built-in test runner + happy-dom
// Tests fuzzy matching/scoring, substring matching, overlay lifecycle,
// keyboard navigation, tab switching, favicon rendering, match highlighting,
// premium gating, and command wiring.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom";
import { KeyHandler } from "../src/modules/KeyHandler";
import { TabSearch, fuzzyMatch, substringMatch } from "../src/modules/TabSearch";
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
        // Base: substring match fails for non-contiguous query
        assert.equal(substringMatch("ghb", "GitHub").score, -1);

        // Delta: fuzzy match succeeds with character skipping
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

describe("substringMatch", () => {
    // Verifies backward compatibility: prefix match gets score 3
    it("returns score 3 for prefix match with correct indices", () => {
        const result = substringMatch("git", "GitHub - Home");
        assert.equal(result.score, 3);
        assert.deepEqual(result.indices, [0, 1, 2]);
    });

    // Verifies word-boundary match gets score 2
    it("returns score 2 for word-boundary match", () => {
        const result = substringMatch("home", "GitHub - Home");
        assert.equal(result.score, 2);
        assert.deepEqual(result.indices, [9, 10, 11, 12]);
    });

    // Verifies plain substring gets score 1
    it("returns score 1 for substring match", () => {
        const result = substringMatch("ithu", "GitHub - Home");
        assert.equal(result.score, 1);
        assert.deepEqual(result.indices, [1, 2, 3, 4]);
    });

    // Verifies no match returns -1
    it("returns -1 for no match", () => {
        assert.equal(substringMatch("xyz", "GitHub - Home").score, -1);
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

    describe("scoreMatch (backward compat)", () => {
        // Verifies static scoreMatch still works for existing callers
        it("returns 3 for prefix match", () => {
            assert.equal(TabSearch.scoreMatch("git", "GitHub - Home"), 3);
        });

        it("returns 2 for word-boundary match", () => {
            assert.equal(TabSearch.scoreMatch("home", "GitHub - Home"), 2);
        });

        it("returns 1 for substring match", () => {
            assert.equal(TabSearch.scoreMatch("ithu", "GitHub - Home"), 1);
        });

        it("returns -1 for no match", () => {
            assert.equal(TabSearch.scoreMatch("xyz", "GitHub - Home"), -1);
        });

        it("matches case-insensitively", () => {
            assert.equal(TabSearch.scoreMatch("GITHUB", "GitHub - Home"), 3);
        });

        it("returns -1 for empty query", () => {
            assert.equal(TabSearch.scoreMatch("", "GitHub"), -1);
        });

        it("detects word boundary after slash", () => {
            assert.equal(TabSearch.scoreMatch("search", "google.com/search"), 2);
        });

        it("detects word boundary after dot", () => {
            assert.equal(TabSearch.scoreMatch("com", "google.com"), 2);
        });
    });

    describe("scoreTabs", () => {
        const tabs = [
            { id: 1, title: "GitHub", url: "https://github.com" },
            { id: 2, title: "Google Search", url: "https://google.com" },
            { id: 3, title: "GitLab CI", url: "https://gitlab.com" },
        ];

        it("returns all tabs for empty query", () => {
            const result = TabSearch.scoreTabs("", tabs as any);
            assert.equal(result.length, 3);
            assert.equal(result[0].id, 1);
        });

        it("ranks prefix matches above substring matches", () => {
            const result = TabSearch.scoreTabs("git", tabs as any);
            assert.equal(result.length, 2);
            assert.equal(result[0].id, 1);
            assert.equal(result[1].id, 3);
        });

        it("excludes non-matching tabs", () => {
            const result = TabSearch.scoreTabs("xyz", tabs as any);
            assert.equal(result.length, 0);
        });

        it("matches against URL as well as title", () => {
            const result = TabSearch.scoreTabs("gitlab.com", tabs as any);
            assert.equal(result.length, 1);
            assert.equal(result[0].id, 3);
        });
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

        // Non-premium tab search must render results on first activation
        it("renders tab results for non-premium users", async () => {
            // Base: non-premium tabSearch (default in tests) — should show results
            await tabSearch.activate();
            const items = env.document.querySelectorAll(".tabi-tab-search-item");
            assert.equal(items.length, 4, "non-premium should render 4 tab results");
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

    describe("premium fuzzy matching", () => {
        // Proves premium mode uses fuzzy matching (character skipping)
        it("finds tabs with scattered character matches when premium", async () => {
            tabSearch.setPremium(true);
            await tabSearch.activate();
            // "ggl" won't match via substring but will match "Google" via fuzzy
            (tabSearch as any).inputEl.value = "ggl";
            (tabSearch as any).onInputBound();
            assert.ok((tabSearch as any).scored.length > 0, "fuzzy should find matches");
            assert.equal((tabSearch as any).scored[0].tab.title, "Google Search");
        });

        // Proves free mode rejects non-contiguous queries
        it("rejects scattered queries when not premium", async () => {
            // Base: premium finds it
            tabSearch.setPremium(true);
            await tabSearch.activate();
            (tabSearch as any).inputEl.value = "ggl";
            (tabSearch as any).onInputBound();
            const premiumCount = (tabSearch as any).scored.length;
            assert.ok(premiumCount > 0);
            tabSearch.deactivate();

            // Delta: free mode rejects it
            tabSearch.setPremium(false);
            await tabSearch.activate();
            (tabSearch as any).inputEl.value = "ggl";
            (tabSearch as any).onInputBound();
            assert.equal((tabSearch as any).scored.length, 0, "substring should reject scattered query");
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
