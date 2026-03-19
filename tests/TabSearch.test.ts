// TabSearch unit tests — using Node.js built-in test runner + happy-dom
// Tests fuzzy matching/scoring, overlay lifecycle, keyboard navigation,
// tab switching, and command wiring.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createDOM, type DOMEnvironment } from "./helpers/dom";
import { KeyHandler } from "../src/modules/KeyHandler";
import { TabSearch } from "../src/modules/TabSearch";
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
                        { id: 2, title: "Google Search", url: "https://google.com/search?q=test", active: false },
                        { id: 3, title: "Stack Overflow - JavaScript", url: "https://stackoverflow.com/questions", active: false },
                        { id: 4, title: "MDN Web Docs", url: "https://developer.mozilla.org", active: false },
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

    describe("scoreMatch", () => {
        // Verifies that a prefix match (start of string) gets highest score
        it("returns 3 for prefix match", () => {
            assert.equal(TabSearch.scoreMatch("git", "GitHub - Home"), 3);
        });

        // Verifies that a word-boundary match gets score 2
        it("returns 2 for word-boundary match", () => {
            assert.equal(TabSearch.scoreMatch("home", "GitHub - Home"), 2);
        });

        // Verifies that a plain substring match gets score 1
        it("returns 1 for substring match", () => {
            assert.equal(TabSearch.scoreMatch("ithu", "GitHub - Home"), 1);
        });

        // Verifies that non-matching queries return -1
        it("returns -1 for no match", () => {
            assert.equal(TabSearch.scoreMatch("xyz", "GitHub - Home"), -1);
        });

        // Verifies case-insensitive matching
        it("matches case-insensitively", () => {
            assert.equal(TabSearch.scoreMatch("GITHUB", "GitHub - Home"), 3);
        });

        // Verifies empty query returns -1
        it("returns -1 for empty query", () => {
            assert.equal(TabSearch.scoreMatch("", "GitHub"), -1);
        });

        // Verifies word boundary after various separators
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

        // Verifies that empty query returns all tabs in original order
        it("returns all tabs for empty query", () => {
            const result = TabSearch.scoreTabs("", tabs as any);
            assert.equal(result.length, 3);
            assert.equal(result[0].id, 1);
        });

        // Verifies that prefix matches rank higher than substring
        it("ranks prefix matches above substring matches", () => {
            const result = TabSearch.scoreTabs("git", tabs as any);
            // GitHub and GitLab both prefix-match; Google doesn't match
            assert.equal(result.length, 2);
            assert.equal(result[0].id, 1); // GitHub first (earlier index)
            assert.equal(result[1].id, 3); // GitLab second
        });

        // Verifies that non-matching tabs are excluded
        it("excludes non-matching tabs", () => {
            const result = TabSearch.scoreTabs("xyz", tabs as any);
            assert.equal(result.length, 0);
        });

        // Verifies URL matching works
        it("matches against URL as well as title", () => {
            const result = TabSearch.scoreTabs("gitlab.com", tabs as any);
            assert.equal(result.length, 1);
            assert.equal(result[0].id, 3);
        });
    });

    describe("activation and deactivation", () => {
        // Verifies that activating creates overlay and enters TAB_SEARCH mode
        it("creates overlay on activate and sets TAB_SEARCH mode", async () => {
            await tabSearch.activate();
            assert.equal(tabSearch.isActive(), true);
            assert.equal(keyHandler.getMode(), Mode.TAB_SEARCH);
            // Overlay should be appended to body
            const overlay = env.document.querySelector(".tabi-overlay");
            assert.ok(overlay, "overlay element should exist in DOM");
        });

        // Verifies that deactivation removes overlay and returns to NORMAL
        it("removes overlay on deactivate and returns to NORMAL", async () => {
            await tabSearch.activate();
            tabSearch.deactivate();
            assert.equal(tabSearch.isActive(), false);
            assert.equal(keyHandler.getMode(), Mode.NORMAL);
            const overlay = env.document.querySelector(".tabi-overlay");
            assert.equal(overlay, null, "overlay should be removed from DOM");
        });

        // Verifies that double-activate is idempotent
        it("ignores double activate", async () => {
            await tabSearch.activate();
            await tabSearch.activate();
            const overlays = env.document.querySelectorAll(".tabi-overlay");
            assert.equal(overlays.length, 1);
        });

        // Verifies active tab is excluded from results
        it("excludes the active tab from results", async () => {
            await tabSearch.activate();
            // 5 tabs total, 1 active → 4 shown
            assert.equal((tabSearch as any)._filtered.length, 4);
            assert.ok((tabSearch as any)._filtered.every((t: any) => !t.active));
        });
    });

    describe("keyboard navigation", () => {
        // Verifies ArrowDown moves selection forward
        it("ArrowDown moves selection down", async () => {
            await tabSearch.activate();
            assert.equal((tabSearch as any)._selectedIndex, 0);
            fireKeyDown("ArrowDown");
            assert.equal((tabSearch as any)._selectedIndex, 1);
        });

        // Verifies ArrowUp wraps around to last item
        it("ArrowUp wraps around from first to last", async () => {
            await tabSearch.activate();
            assert.equal((tabSearch as any)._selectedIndex, 0);
            fireKeyDown("ArrowUp");
            assert.equal((tabSearch as any)._selectedIndex, (tabSearch as any)._filtered.length - 1);
        });

        // Verifies Ctrl-j works like ArrowDown
        it("Ctrl-j moves selection down", async () => {
            await tabSearch.activate();
            fireKeyDown("KeyJ", { ctrlKey: true });
            assert.equal((tabSearch as any)._selectedIndex, 1);
        });

        // Verifies Ctrl-k works like ArrowUp
        it("Ctrl-k moves selection up (wraps)", async () => {
            await tabSearch.activate();
            fireKeyDown("KeyK", { ctrlKey: true });
            assert.equal((tabSearch as any)._selectedIndex, (tabSearch as any)._filtered.length - 1);
        });

        // Verifies ArrowDown wraps around at end
        it("ArrowDown wraps from last to first", async () => {
            await tabSearch.activate();
            const lastIdx = (tabSearch as any)._filtered.length - 1;
            (tabSearch as any)._selectedIndex = lastIdx;
            fireKeyDown("ArrowDown");
            assert.equal((tabSearch as any)._selectedIndex, 0);
        });
    });

    describe("Escape key", () => {
        // Verifies that Escape dismisses the tab search overlay
        it("dismisses overlay on Escape", async () => {
            await tabSearch.activate();
            fireKeyDown("Escape");
            assert.equal(tabSearch.isActive(), false);
            assert.equal(keyHandler.getMode(), Mode.NORMAL);
        });
    });

    describe("Enter key", () => {
        // Verifies that Enter sends switchTab message for the selected tab
        it("sends switchTab for selected tab on Enter", async () => {
            await tabSearch.activate();
            const selectedTab = (tabSearch as any)._filtered[0];
            fireKeyDown("Enter");
            const switchMsg = sentMessages.find(m => m.command === "switchTab");
            assert.ok(switchMsg, "switchTab message should be sent");
            assert.equal(switchMsg.tabId, selectedTab.id);
            assert.equal(tabSearch.isActive(), false);
        });

        // Verifies that Enter with no results does nothing harmful
        it("does nothing when no results match", async () => {
            await tabSearch.activate();
            (tabSearch as any)._filtered = [];
            (tabSearch as any)._selectedIndex = 0;
            const beforeCount = sentMessages.length;
            fireKeyDown("Enter");
            const switchMsg = sentMessages.slice(beforeCount).find((m: any) => m.command === "switchTab");
            assert.equal(switchMsg, undefined);
        });
    });

    describe("search filtering", () => {
        // Verifies that typing filters the tab list
        it("filters tabs on input", async () => {
            await tabSearch.activate();
            (tabSearch as any)._inputEl.value = "google";
            (tabSearch as any)._onInput();
            assert.equal((tabSearch as any)._filtered.length, 1);
            assert.equal((tabSearch as any)._filtered[0].title, "Google Search");
        });

        // Verifies that clearing input shows all non-active tabs
        it("shows all tabs when input cleared", async () => {
            await tabSearch.activate();
            (tabSearch as any)._inputEl.value = "google";
            (tabSearch as any)._onInput();
            (tabSearch as any)._inputEl.value = "";
            (tabSearch as any)._onInput();
            assert.equal((tabSearch as any)._filtered.length, 4);
        });

        // Verifies that selection resets to 0 after filtering
        it("resets selection on filter change", async () => {
            await tabSearch.activate();
            (tabSearch as any)._selectedIndex = 2;
            (tabSearch as any)._inputEl.value = "stack";
            (tabSearch as any)._onInput();
            assert.equal((tabSearch as any)._selectedIndex, 0);
        });
    });

    describe("key event isolation", () => {
        // Verifies navigation keys prevent default
        it("prevents default for ArrowDown", async () => {
            await tabSearch.activate();
            const event = fireKeyDown("ArrowDown");
            assert.equal(event.defaultPrevented, true);
        });
    });

    describe("command wiring", () => {
        // Verifies that openTabSearch command activates tab search
        it("openTabSearch command activates", async () => {
            let activated = false;
            const origActivate = tabSearch.activate.bind(tabSearch);
            tabSearch.activate = async () => { activated = true; await origActivate(); };
            (keyHandler as any).dispatch("openTabSearch");
            assert.equal(activated, true);
        });

        // Verifies that destroy unwires commands
        it("destroy unwires commands", () => {
            tabSearch.destroy();
            assert.equal((keyHandler as any).commands.has("openTabSearch"), false);
        });
    });
});
