// background.ts unit tests — using Node.js built-in test runner
// Tests tab management message handling: create, close, restore tabs,
// tab cycling (left/right/first/last), closed-tab stack with max limit,
// and queryTabs response format.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// --- browser API shim ---

let mockTabs: Array<{ id: number; title: string; url: string; active: boolean }>;
let createdTabs: Array<Record<string, unknown>>;
let removedTabIds: number[];
let activatedTabId: number | null;
let actionState: Record<number, Record<string, unknown>>;
let tabRemovedListeners: Array<(tabId: number) => void>;
let tabUpdatedListeners: Array<(tabId: number, changeInfo: { url?: string }, tab: { id: number; url: string; index?: number }) => void>;

function resetBrowserShim() {
    mockTabs = [
        { id: 1, title: "Tab 1", url: "https://example.com/1", active: false },
        { id: 2, title: "Tab 2", url: "https://example.com/2", active: true },
        { id: 3, title: "Tab 3", url: "https://example.com/3", active: false },
    ];
    createdTabs = [];
    removedTabIds = [];
    activatedTabId = null;
    actionState = {};
    tabRemovedListeners = [];
    tabUpdatedListeners = [];

    const g = globalThis as Record<string, unknown>;
    g.browser = {
        tabs: {
            async create(opts: Record<string, unknown>) {
                const tab = { id: 100 + createdTabs.length, ...opts };
                createdTabs.push(tab);
                return tab;
            },
            async remove(tabId: number) {
                removedTabIds.push(tabId);
                mockTabs = mockTabs.filter(t => t.id !== tabId);
            },
            async update(tabId: number, props: Record<string, unknown>) {
                if (props.active) activatedTabId = tabId;
                return { id: tabId, ...props };
            },
            async query(_opts: Record<string, unknown>) {
                return [...mockTabs];
            },
            onRemoved: {
                addListener(fn: (tabId: number) => void) { tabRemovedListeners.push(fn); },
            },
            onUpdated: {
                addListener(fn: (tabId: number, changeInfo: { url?: string }, tab: { id: number; url: string }) => void) { tabUpdatedListeners.push(fn); },
            },
        },
        action: {
            async enable(tabId: number) {
                if (!actionState[tabId]) actionState[tabId] = {};
                actionState[tabId].enabled = true;
            },
            async disable(tabId: number) {
                if (!actionState[tabId]) actionState[tabId] = {};
                actionState[tabId].enabled = false;
            },
            async setBadgeText(opts: { tabId: number; text: string }) {
                const id = opts.tabId;
                if (!actionState[id]) actionState[id] = {};
                actionState[id].badgeText = opts.text;
            },
            async setTitle(opts: { tabId: number; title: string }) {
                const id = opts.tabId;
                if (!actionState[id]) actionState[id] = {};
                actionState[id].title = opts.title;
            },
        },
        runtime: {
            onMessage: { addListener() {} },
        },
    };
}

function makeSender(tabId: number) {
    const tab = mockTabs.find(t => t.id === tabId);
    return { tab: tab || { id: tabId, url: `https://example.com/${tabId}` } };
}

// --- Import module (browser shim must be installed first) ---

resetBrowserShim();

import {
    closedTabStack,
    pushClosedTab,
    popClosedTab,
    handleCommand,
    MAX_CLOSED_TABS,
    activeTabSet,
    tabUrlCache,
    tabIndexCache,
    init,
} from "../src/background";

describe("background.ts tab management", () => {
    beforeEach(() => {
        resetBrowserShim();
        closedTabStack.length = 0;
        activeTabSet.clear();
        tabUrlCache.clear();
        tabIndexCache.clear();
        init();
    });

    describe("closed-tab stack", () => {
        // Verifies that closing tabs pushes URLs onto the stack and
        // restoring pops them in LIFO order.
        it("pushes URLs and pops in LIFO order", () => {
            pushClosedTab("https://a.com", 0);
            pushClosedTab("https://b.com", 1);
            assert.deepEqual(popClosedTab(), { url: "https://b.com", index: 1 });
            assert.deepEqual(popClosedTab(), { url: "https://a.com", index: 0 });
            assert.equal(popClosedTab(), null);
        });

        // Verifies that blank/empty URLs are not pushed onto the stack.
        it("ignores blank and empty URLs", () => {
            pushClosedTab("", 0);
            pushClosedTab("about:blank", 0);
            pushClosedTab("about:newtab", 0);
            pushClosedTab(null, 0);
            assert.equal(closedTabStack.length, 0);
        });

        // Verifies that the stack enforces a maximum size of 50 entries.
        it("enforces max size of 50", () => {
            for (let i = 0; i < 60; i++) {
                pushClosedTab(`https://example.com/${i}`, i);
            }
            assert.equal(closedTabStack.length, MAX_CLOSED_TABS);
            // Oldest entries should have been evicted
            const popped = popClosedTab();
            assert.equal(popped?.url, "https://example.com/59");
        });
    });

    describe("createTab command", () => {
        // Verifies that the createTab command opens a new empty tab.
        it("creates a new tab", async () => {
            const result = await handleCommand("createTab", {});
            assert.equal(result.status, "ok");
            assert.equal(createdTabs.length, 1);
        });
    });

    describe("closeTab command", () => {
        // Verifies that closing a tab removes it. URL tracking is handled by onRemoved listener.
        it("removes the sender tab", async () => {
            const sender = makeSender(2);
            // Simulate onUpdated having cached the URL and index
            tabUrlCache.set(2, "https://example.com/2");
            tabIndexCache.set(2, 1);
            const result = await handleCommand("closeTab", sender);
            assert.equal(result.status, "ok");
            assert.deepEqual(removedTabIds, [2]);
            // onRemoved listener records the URL and index
            for (const fn of tabRemovedListeners) fn(2);
            assert.equal(closedTabStack.length, 1);
            assert.deepEqual(closedTabStack[0], { url: "https://example.com/2", index: 1 });
        });

        // Verifies that closeTab is a no-op when there is no sender tab.
        it("does nothing without sender tab", async () => {
            const result = await handleCommand("closeTab", {});
            assert.equal(result.status, "ok");
            assert.equal(removedTabIds.length, 0);
        });
    });

    describe("restoreTab command", () => {
        // Verifies that restoring a tab creates one with the last closed URL at the original index.
        it("creates a tab with the last closed URL at original index", async () => {
            pushClosedTab("https://restored.com", 2);
            const result = await handleCommand("restoreTab", {});
            assert.equal(result.status, "ok");
            assert.equal(createdTabs.length, 1);
            assert.equal(createdTabs[0].url, "https://restored.com");
            assert.equal(createdTabs[0].index, 2);
            assert.equal(closedTabStack.length, 0);
        });

        // Verifies that restoring with an empty stack is a no-op.
        it("does nothing when stack is empty", async () => {
            const result = await handleCommand("restoreTab", {});
            assert.equal(result.status, "ok");
            assert.equal(createdTabs.length, 0);
        });
    });

    describe("tab cycling", () => {
        // Verifies that tabLeft activates the tab to the left, wrapping around.
        it("tabLeft activates previous tab (wraps around)", async () => {
            const sender = makeSender(1); // index 0
            await handleCommand("tabLeft", sender);
            assert.equal(activatedTabId, 3); // wraps to last
        });

        // Verifies that tabRight activates the next tab, wrapping around.
        it("tabRight activates next tab (wraps around)", async () => {
            const sender = makeSender(3); // index 2
            await handleCommand("tabRight", sender);
            assert.equal(activatedTabId, 1); // wraps to first
        });

        // Verifies that tabPrev works the same as tabLeft.
        it("tabPrev works like tabLeft", async () => {
            const sender = makeSender(2); // index 1
            await handleCommand("tabPrev", sender);
            assert.equal(activatedTabId, 1);
        });

        // Verifies that tabNext works the same as tabRight.
        it("tabNext works like tabRight", async () => {
            const sender = makeSender(2); // index 1
            await handleCommand("tabNext", sender);
            assert.equal(activatedTabId, 3);
        });

        // Verifies that goToTabFirst activates the first tab.
        it("goToTabFirst activates first tab", async () => {
            await handleCommand("goToTabFirst", makeSender(3));
            assert.equal(activatedTabId, 1);
        });

        // Verifies that goToTabLast activates the last tab.
        it("goToTabLast activates last tab", async () => {
            await handleCommand("goToTabLast", makeSender(1));
            assert.equal(activatedTabId, 3);
        });

        // Verifies that goToTab index 2 activates the second tab.
        it("goToTab 2 activates second tab", async () => {
            await handleCommand("goToTab", makeSender(1), { command: "goToTab", index: 2 });
            assert.equal(activatedTabId, 2);
        });

        // Verifies that goToTab clamps to last tab when index exceeds count.
        it("goToTab clamps to last tab when index exceeds count", async () => {
            await handleCommand("goToTab", makeSender(1), { command: "goToTab", index: 8 });
            assert.equal(activatedTabId, 3);
        });
    });

    describe("queryTabs command", () => {
        // Verifies that queryTabs returns tab metadata for all tabs.
        it("returns tab list with id, title, url, active fields", async () => {
            const result = await handleCommand("queryTabs", {}) as unknown as Array<Record<string, unknown>>;
            assert.equal(result.length, 3);
            assert.deepEqual(Object.keys(result[0]).sort(), ["active", "id", "title", "url"]);
            assert.equal(result[1].active, true);
        });
    });

    describe("unknown command", () => {
        // Verifies that unknown commands return an error status.
        it("returns unknown_command status", async () => {
            const result = await handleCommand("nonsense" as any, {});
            assert.equal(result.status, "unknown_command");
        });
    });

    describe("toolbar icon state", () => {
        // Verifies that extensionActive marks the tab active and enables the icon.
        it("extensionActive enables icon for the tab", async () => {
            const sender = makeSender(2);
            await handleCommand("extensionActive", sender, {});
            assert.equal(activeTabSet.has(2), true);
            assert.equal(actionState[2].enabled, true);
            assert.equal(actionState[2].title, "vimium-mac");
        });

        // Verifies that extensionInactive disables the icon for the tab.
        it("extensionInactive disables icon for the tab", async () => {
            const sender = makeSender(3);
            activeTabSet.add(3);
            await handleCommand("extensionInactive", sender, {});
            assert.equal(activeTabSet.has(3), false);
            assert.equal(actionState[3].enabled, false);
            assert.equal(actionState[3].title, "vimium-mac (disabled on this site)");
        });

        // Verifies that closing a tab cleans up its entry from activeTabSet.
        it("tab removal cleans up activeTabSet", () => {
            activeTabSet.add(5);
            assert.equal(activeTabSet.has(5), true);
            // Simulate tab removal by calling registered listeners
            for (const fn of tabRemovedListeners) fn(5);
            assert.equal(activeTabSet.has(5), false);
        });
    });

    describe("switchTab command", () => {
        // Verifies that switchTab activates the specified tab by ID.
        it("activates the specified tab", async () => {
            const result = await handleCommand("switchTab", {}, { tabId: 3 });
            assert.equal(result.status, "ok");
            assert.equal(activatedTabId, 3);
        });

        // Verifies that switchTab does nothing when no tabId is provided.
        it("does nothing without tabId", async () => {
            const result = await handleCommand("switchTab", {}, {});
            assert.equal(result.status, "ok");
            assert.equal(activatedTabId, null);
        });
    });
});
