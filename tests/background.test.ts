// background.ts unit tests — using Node.js built-in test runner
// Tests tab management message handling: create, close, restore tabs,
// tab cycling (left/right/first/last), closed-tab stack with max limit,
// and queryTabs response format.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MAX_CLOSED_TABS } from "../src/modules/constants";

// --- browser API shim ---

let mockTabs: Array<{ id: number; title: string; url: string; active: boolean }>;
let createdTabs: Array<Record<string, unknown>>;
let removedTabIds: number[];
let activatedTabId: number | null;
let actionState: Record<number, Record<string, unknown>>;
let tabRemovedListeners: Array<(tabId: number) => void>;
let tabUpdatedListeners: Array<(tabId: number, changeInfo: { url?: string }, tab: { id: number; url: string }) => void>;
let tabActivatedListeners: Array<(activeInfo: { tabId: number }) => void>;
let nativeMessagesSent: Array<{ appId: string; message: Record<string, unknown> }>;
let nativeMessageResponse: Record<string, unknown>;
let storageState: Record<string, unknown>;

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
    tabActivatedListeners = [];
    nativeMessagesSent = [];
    nativeMessageResponse = {};
    storageState = {};

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
            async sendMessage(_tabId: number, _message: Record<string, unknown>) {
                return {};
            },
            onRemoved: {
                addListener(fn: (tabId: number) => void) { tabRemovedListeners.push(fn); },
            },
            onUpdated: {
                addListener(fn: (tabId: number, changeInfo: { url?: string }, tab: { id: number; url: string }) => void) { tabUpdatedListeners.push(fn); },
            },
            onActivated: {
                addListener(fn: (activeInfo: { tabId: number }) => void) { tabActivatedListeners.push(fn); },
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
            onClicked: { addListener() {} },
            async setTitle(opts: { tabId: number; title: string }) {
                const id = opts.tabId;
                if (!actionState[id]) actionState[id] = {};
                actionState[id].title = opts.title;
            },
        },
        runtime: {
            getURL(path: string) { return `safari-extension://test/${path}`; },
            onMessage: { addListener() {} },
            async sendNativeMessage(appId: string, message: Record<string, unknown>) {
                nativeMessagesSent.push({ appId, message });
                return nativeMessageResponse;
            },
        },
        storage: {
            local: {
                async set(items: Record<string, unknown>) {
                    Object.assign(storageState, items);
                },
            },
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
    syncSettings,
    activeTabSet,
    tabUrlCache,
    tabOrder,
    activeHistory,
    tabHistory,
    init,
} from "../src/background";

describe("background.ts tab management", () => {
    beforeEach(() => {
        resetBrowserShim();
        closedTabStack.length = 0;
        activeTabSet.clear();
        tabUrlCache.clear();
        tabOrder.length = 0;
        activeHistory.previous = null;
        activeHistory.current = null;
        tabHistory.stack.length = 0;
        tabHistory.index = -1;
        tabHistory.navigating = false;
        init();
    });

    describe("closed-tab stack", () => {
        // Verifies that closing tabs pushes entries onto the stack and
        // restoring pops them in LIFO order.
        it("pushes entries and pops in LIFO order", () => {
            pushClosedTab("https://a.com", null);
            pushClosedTab("https://b.com", 1);
            assert.deepEqual(popClosedTab(), { url: "https://b.com", leftNeighborId: 1 });
            assert.deepEqual(popClosedTab(), { url: "https://a.com", leftNeighborId: null });
            assert.equal(popClosedTab(), null);
        });

        // Verifies that blank/empty URLs are not pushed onto the stack.
        it("ignores blank and empty URLs", () => {
            pushClosedTab("", null);
            pushClosedTab("about:blank", null);
            pushClosedTab("about:newtab", null);
            pushClosedTab(null, null);
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
        // Verifies that closing a tab removes it and records its left neighbor.
        it("removes the sender tab and records left neighbor", async () => {
            const sender = makeSender(2);
            // Simulate onUpdated having cached the URL; tabOrder populated by init()
            tabUrlCache.set(2, "https://example.com/2");
            // tabOrder is [1, 2, 3] from init() — tab 2's left neighbor is tab 1
            const result = await handleCommand("closeTab", sender);
            assert.equal(result.status, "ok");
            assert.deepEqual(removedTabIds, [2]);
            // onRemoved listener records the URL and left neighbor
            for (const fn of tabRemovedListeners) fn(2);
            assert.equal(closedTabStack.length, 1);
            assert.deepEqual(closedTabStack[0], { url: "https://example.com/2", leftNeighborId: 1 });
        });

        // Verifies that closeTab is a no-op when there is no sender tab.
        it("does nothing without sender tab", async () => {
            const result = await handleCommand("closeTab", {});
            assert.equal(result.status, "ok");
            assert.equal(removedTabIds.length, 0);
        });
    });

    describe("restoreTab command", () => {
        // Verifies that restoring a tab inserts it after its left neighbor.
        // mockTabs: [1, 2, 3] — if left neighbor is tab 1, restored tab goes at index 1 (after tab 1).
        it("restores tab after its left neighbor", async () => {
            pushClosedTab("https://restored.com", 1);
            const result = await handleCommand("restoreTab", {});
            assert.equal(result.status, "ok");
            assert.equal(createdTabs.length, 1);
            assert.equal(createdTabs[0].url, "https://restored.com");
            assert.equal(createdTabs[0].index, 1);
            assert.equal(closedTabStack.length, 0);
        });

        // Verifies that a tab with no left neighbor (was first) restores at index 0.
        it("restores at start when left neighbor is null", async () => {
            pushClosedTab("https://first.com", null);
            const result = await handleCommand("restoreTab", {});
            assert.equal(result.status, "ok");
            assert.equal(createdTabs[0].index, 0);
        });

        // Verifies that if the left neighbor was also closed, the tab goes to the end.
        it("restores at end when left neighbor no longer exists", async () => {
            pushClosedTab("https://orphan.com", 99);
            const result = await handleCommand("restoreTab", {});
            assert.equal(result.status, "ok");
            assert.equal(createdTabs[0].index, 3); // mockTabs has 3 tabs
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
            assert.deepEqual(Object.keys(result[0]).sort(), ["active", "favIconUrl", "id", "title", "url"]);
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
            assert.equal(actionState[2].title, "tabi");
        });

        // Verifies that extensionInactive disables the icon for the tab.
        it("extensionInactive disables icon for the tab", async () => {
            const sender = makeSender(3);
            activeTabSet.add(3);
            await handleCommand("extensionInactive", sender, {});
            assert.equal(activeTabSet.has(3), false);
            assert.equal(actionState[3].enabled, false);
            assert.equal(actionState[3].title, "tabi (disabled on this site)");
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

    describe("syncSettings", () => {
        it("fetches native settings and writes to storage", async () => {
            nativeMessagesSent = [];
            storageState = {};
            nativeMessageResponse = { keyBindingMode: "character", theme: "dark", isPremium: true };
            await syncSettings();

            assert.equal(nativeMessagesSent.length, 1);
            assert.equal(nativeMessagesSent[0].appId, "com.brokenalarms.tabi");
            assert.deepEqual(nativeMessagesSent[0].message, { command: "getSettings" });
            assert.equal(storageState.keyBindingMode, "character");
            assert.equal(storageState.theme, "dark");
            assert.equal(storageState.isPremium, true);
        });

        it("only writes defined fields to storage", async () => {
            nativeMessageResponse = { isPremium: false };
            await syncSettings();

            assert.equal(storageState.isPremium, false);
            assert.equal(storageState.keyBindingMode, undefined);
            assert.equal(storageState.theme, undefined);
        });

        it("is invokable via handleCommand", async () => {
            nativeMessageResponse = { isPremium: true };
            const result = await handleCommand("syncSettings", {});
            assert.equal(result.status, "ok");
            assert.equal(storageState.isPremium, true);
        });

        it("runs automatically on init", () => {
            nativeMessagesSent = [];
            nativeMessageResponse = { isPremium: true };
            init();
            assert.equal(nativeMessagesSent.length, 1);
            assert.deepEqual(nativeMessagesSent[0].message, { command: "getSettings" });
        });
    });

    describe("jumpToMark command", () => {
        it("returns sameTab when sender already on target URL", async () => {
            const sender = { tab: { id: 2, url: "https://example.com/2" } };
            const result = await handleCommand("jumpToMark", sender, {
                command: "jumpToMark",
                url: "https://example.com/2",
                scrollY: 100,
            });
            assert.equal((result as any).status, "ok");
            assert.equal((result as any).sameTab, true);
            assert.equal(activatedTabId, null);
            assert.equal(createdTabs.length, 0);
        });

        it("activates existing tab with matching URL", async () => {
            const sender = makeSender(1);
            const result = await handleCommand("jumpToMark", sender, {
                command: "jumpToMark",
                url: "https://example.com/3",
                scrollY: 50,
            });
            assert.equal((result as any).status, "ok");
            assert.equal((result as any).sameTab, false);
            assert.equal(activatedTabId, 3);
            assert.equal(createdTabs.length, 0);
        });

        it("opens new tab when no existing tab matches", async () => {
            const sender = makeSender(1);
            const result = await handleCommand("jumpToMark", sender, {
                command: "jumpToMark",
                url: "https://new-site.com/page",
                scrollY: 200,
            });
            assert.equal((result as any).status, "ok");
            assert.equal((result as any).sameTab, false);
            assert.equal(createdTabs.length, 1);
            assert.equal(createdTabs[0].url, "https://new-site.com/page");
        });

        it("does nothing without URL", async () => {
            const result = await handleCommand("jumpToMark", {}, { command: "jumpToMark" });
            assert.equal(result.status, "ok");
            assert.equal(activatedTabId, null);
            assert.equal(createdTabs.length, 0);
        });

        // Verifies that URL matching ignores query params when reuse is enabled
        it("matches tab ignoring query params", async () => {
            // Tab 3 has url https://example.com/3, mark url has query params
            const sender = makeSender(1);
            const result = await handleCommand("jumpToMark", sender, {
                command: "jumpToMark",
                url: "https://example.com/3?q=search",
                scrollY: 0,
                reuseTab: true,
            });
            assert.equal((result as any).status, "ok");
            assert.equal((result as any).sameTab, false);
            assert.equal(activatedTabId, 3);
            assert.equal(createdTabs.length, 0);
        });

        // Verifies that reuseTab=false always opens a new tab
        it("opens new tab when reuseTab is false even if URL matches", async () => {
            const sender = makeSender(1);
            const result = await handleCommand("jumpToMark", sender, {
                command: "jumpToMark",
                url: "https://example.com/3",
                scrollY: 0,
                reuseTab: false,
            });
            assert.equal((result as any).status, "ok");
            assert.equal((result as any).sameTab, false);
            assert.equal(activatedTabId, null);
            assert.equal(createdTabs.length, 1);
        });

        // Verifies that sameTab matches the current sender tab ignoring query params
        it("returns sameTab when sender matches via origin+pathname", async () => {
            const sender = { tab: { id: 2, url: "https://example.com/2?foo=bar" } };
            const result = await handleCommand("jumpToMark", sender, {
                command: "jumpToMark",
                url: "https://example.com/2",
                scrollY: 0,
                reuseTab: true,
            });
            assert.equal((result as any).status, "ok");
            assert.equal((result as any).sameTab, true);
        });
    });

    describe("tab history navigation", () => {
        function activateTab(tabId: number) {
            for (const fn of tabActivatedListeners) fn({ tabId });
        }

        // Verifies that activating tabs builds a history stack in order.
        it("builds history stack from tab activations", () => {
            activateTab(1);
            activateTab(2);
            activateTab(3);
            assert.deepEqual(tabHistory.stack, [1, 2, 3]);
            assert.equal(tabHistory.index, 2);
        });

        // Verifies that tabHistoryBack navigates to the previous tab in the stack.
        it("tabHistoryBack activates the previous tab", async () => {
            activateTab(1);
            activateTab(2);
            activateTab(3);

            await handleCommand("tabHistoryBack", makeSender(3));
            assert.equal(activatedTabId, 2);
            assert.equal(tabHistory.index, 1);
        });

        // Verifies that tabHistoryForward navigates to the next tab after going back.
        it("tabHistoryForward activates the next tab after back", async () => {
            activateTab(1);
            activateTab(2);
            activateTab(3);

            await handleCommand("tabHistoryBack", makeSender(3));
            activatedTabId = null;
            await handleCommand("tabHistoryForward", makeSender(2));
            assert.equal(activatedTabId, 3);
            assert.equal(tabHistory.index, 2);
        });

        // Verifies that going back at the start of history is a no-op.
        it("tabHistoryBack is a no-op at the start of history", async () => {
            activateTab(1);
            assert.equal(tabHistory.index, 0);

            await handleCommand("tabHistoryBack", makeSender(1));
            assert.equal(activatedTabId, null);
            assert.equal(tabHistory.index, 0);
        });

        // Verifies that going forward at the end of history is a no-op.
        it("tabHistoryForward is a no-op at the end of history", async () => {
            activateTab(1);
            activateTab(2);
            assert.equal(tabHistory.index, 1);

            await handleCommand("tabHistoryForward", makeSender(2));
            assert.equal(activatedTabId, null);
            assert.equal(tabHistory.index, 1);
        });

        // Verifies browser-style behavior: visiting a new tab after going back
        // wipes forward history.
        it("new activation after back wipes forward history", async () => {
            activateTab(1);
            activateTab(2);
            activateTab(3);

            await handleCommand("tabHistoryBack", makeSender(3));
            // Now at index 1 (tab 2), forward history = [3]
            // Visit a new tab — forward history should be wiped
            activateTab(1);
            assert.deepEqual(tabHistory.stack, [1, 2, 1]);
            assert.equal(tabHistory.index, 2);

            // Forward should be a no-op now
            activatedTabId = null;
            await handleCommand("tabHistoryForward", makeSender(1));
            assert.equal(activatedTabId, null);
        });

        // Verifies that consecutive visits to the same tab are deduplicated.
        it("deduplicates consecutive activations of the same tab", () => {
            activateTab(1);
            activateTab(1);
            activateTab(1);
            assert.deepEqual(tabHistory.stack, [1]);
            assert.equal(tabHistory.index, 0);
        });

        // Verifies that closing a tab removes it from the history stack
        // and adjusts the index.
        it("removes closed tabs from history stack", () => {
            activateTab(1);
            activateTab(2);
            activateTab(3);
            assert.deepEqual(tabHistory.stack, [1, 2, 3]);
            assert.equal(tabHistory.index, 2);

            // Close tab 2 (middle of history)
            for (const fn of tabRemovedListeners) fn(2);
            assert.deepEqual(tabHistory.stack, [1, 3]);
            assert.equal(tabHistory.index, 1);
        });

        // Verifies that multiple back navigations walk through the full stack.
        it("supports multiple back steps", async () => {
            activateTab(1);
            activateTab(2);
            activateTab(3);

            await handleCommand("tabHistoryBack", makeSender(3));
            assert.equal(activatedTabId, 2);
            assert.equal(tabHistory.index, 1);

            activatedTabId = null;
            await handleCommand("tabHistoryBack", makeSender(2));
            assert.equal(activatedTabId, 1);
            assert.equal(tabHistory.index, 0);

            // Already at start, no-op
            activatedTabId = null;
            await handleCommand("tabHistoryBack", makeSender(1));
            assert.equal(activatedTabId, null);
        });
    });
});
