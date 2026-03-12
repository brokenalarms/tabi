// background.js unit tests — using Node.js built-in test runner
// Tests tab management message handling: create, close, restore tabs,
// tab cycling (left/right/first/last), closed-tab stack with max limit,
// and queryTabs response format.

const { describe, it, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");

// --- browser API shim ---

let mockTabs;
let createdTabs;
let removedTabIds;
let activatedTabId;
let actionState;
let tabRemovedListeners;
let nativeMessageResponse;
let storedSettings;

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
    nativeMessageResponse = {
        excludedDomains: [],
        keyBindingMode: "location",
        theme: "yellow",
    };
    storedSettings = {};

    global.browser = {
        tabs: {
            async create(opts) {
                const tab = { id: 100 + createdTabs.length, ...opts };
                createdTabs.push(tab);
                return tab;
            },
            async remove(tabId) {
                removedTabIds.push(tabId);
                mockTabs = mockTabs.filter(t => t.id !== tabId);
            },
            async update(tabId, props) {
                if (props.active) activatedTabId = tabId;
                return { id: tabId, ...props };
            },
            async query(_opts) {
                return [...mockTabs];
            },
            onRemoved: {
                addListener(fn) { tabRemovedListeners.push(fn); },
            },
        },
        action: {
            async enable(tabId) {
                if (!actionState[tabId]) actionState[tabId] = {};
                actionState[tabId].enabled = true;
            },
            async disable(tabId) {
                if (!actionState[tabId]) actionState[tabId] = {};
                actionState[tabId].enabled = false;
            },
            async setBadgeText(opts) {
                const id = opts.tabId;
                if (!actionState[id]) actionState[id] = {};
                actionState[id].badgeText = opts.text;
            },
            async setTitle(opts) {
                const id = opts.tabId;
                if (!actionState[id]) actionState[id] = {};
                actionState[id].title = opts.title;
            },
        },
        runtime: {
            onMessage: { addListener() {} },
            async sendNativeMessage(_appId, _message) {
                return nativeMessageResponse;
            },
        },
        storage: {
            local: {
                async set(items) {
                    Object.assign(storedSettings, items);
                },
            },
        },
    };
}

function makeSender(tabId) {
    const tab = mockTabs.find(t => t.id === tabId);
    return { tab: tab || { id: tabId, url: `https://example.com/${tabId}` } };
}

// --- Load module ---

let bgModule;

function loadBackground() {
    // Clear require cache so each test suite gets a fresh module
    const modPath = require.resolve("../Vimium/Safari Extension/Resources/background.js");
    delete require.cache[modPath];
    resetBrowserShim();
    require(modPath);
    bgModule = {
        closedTabStack: global.closedTabStack,
        pushClosedTab: global.pushClosedTab,
        popClosedTab: global.popClosedTab,
        handleCommand: global.handleCommand,
        MAX_CLOSED_TABS: global.MAX_CLOSED_TABS,
        activeTabSet: global.activeTabSet,
        updateIconState: global.updateIconState,
        syncSettings: global.syncSettings,
        validateSettings: global.validateSettings,
        DEFAULT_SETTINGS: global.DEFAULT_SETTINGS,
    };
}

describe("background.js tab management", () => {
    beforeEach(() => {
        loadBackground();
    });

    describe("closed-tab stack", () => {
        // Verifies that closing tabs pushes URLs onto the stack and
        // restoring pops them in LIFO order.
        it("pushes URLs and pops in LIFO order", () => {
            bgModule.pushClosedTab("https://a.com");
            bgModule.pushClosedTab("https://b.com");
            assert.equal(bgModule.popClosedTab(), "https://b.com");
            assert.equal(bgModule.popClosedTab(), "https://a.com");
            assert.equal(bgModule.popClosedTab(), null);
        });

        // Verifies that blank/empty URLs are not pushed onto the stack.
        it("ignores blank and empty URLs", () => {
            bgModule.pushClosedTab("");
            bgModule.pushClosedTab("about:blank");
            bgModule.pushClosedTab("about:newtab");
            bgModule.pushClosedTab(null);
            assert.equal(bgModule.closedTabStack.length, 0);
        });

        // Verifies that the stack enforces a maximum size of 50 entries.
        it("enforces max size of 50", () => {
            for (let i = 0; i < 60; i++) {
                bgModule.pushClosedTab(`https://example.com/${i}`);
            }
            assert.equal(bgModule.closedTabStack.length, bgModule.MAX_CLOSED_TABS);
            // Oldest entries should have been evicted
            assert.equal(bgModule.popClosedTab(), "https://example.com/59");
        });
    });

    describe("createTab command", () => {
        // Verifies that the createTab command opens a new empty tab.
        it("creates a new tab", async () => {
            const result = await bgModule.handleCommand("createTab", {});
            assert.equal(result.status, "ok");
            assert.equal(createdTabs.length, 1);
        });
    });

    describe("closeTab command", () => {
        // Verifies that closing a tab removes it and pushes its URL to the stack.
        it("removes the sender tab and pushes URL to stack", async () => {
            const sender = makeSender(2);
            const result = await bgModule.handleCommand("closeTab", sender);
            assert.equal(result.status, "ok");
            assert.deepEqual(removedTabIds, [2]);
            assert.equal(bgModule.closedTabStack.length, 1);
            assert.equal(bgModule.closedTabStack[0], "https://example.com/2");
        });

        // Verifies that closeTab is a no-op when there is no sender tab.
        it("does nothing without sender tab", async () => {
            const result = await bgModule.handleCommand("closeTab", {});
            assert.equal(result.status, "ok");
            assert.equal(removedTabIds.length, 0);
        });
    });

    describe("restoreTab command", () => {
        // Verifies that restoring a tab creates one with the last closed URL.
        it("creates a tab with the last closed URL", async () => {
            bgModule.pushClosedTab("https://restored.com");
            const result = await bgModule.handleCommand("restoreTab", {});
            assert.equal(result.status, "ok");
            assert.equal(createdTabs.length, 1);
            assert.equal(createdTabs[0].url, "https://restored.com");
            assert.equal(bgModule.closedTabStack.length, 0);
        });

        // Verifies that restoring with an empty stack is a no-op.
        it("does nothing when stack is empty", async () => {
            const result = await bgModule.handleCommand("restoreTab", {});
            assert.equal(result.status, "ok");
            assert.equal(createdTabs.length, 0);
        });
    });

    describe("tab cycling", () => {
        // Verifies that tabLeft activates the tab to the left, wrapping around.
        it("tabLeft activates previous tab (wraps around)", async () => {
            const sender = makeSender(1); // index 0
            await bgModule.handleCommand("tabLeft", sender);
            assert.equal(activatedTabId, 3); // wraps to last
        });

        // Verifies that tabRight activates the next tab, wrapping around.
        it("tabRight activates next tab (wraps around)", async () => {
            const sender = makeSender(3); // index 2
            await bgModule.handleCommand("tabRight", sender);
            assert.equal(activatedTabId, 1); // wraps to first
        });

        // Verifies that tabPrev works the same as tabLeft.
        it("tabPrev works like tabLeft", async () => {
            const sender = makeSender(2); // index 1
            await bgModule.handleCommand("tabPrev", sender);
            assert.equal(activatedTabId, 1);
        });

        // Verifies that tabNext works the same as tabRight.
        it("tabNext works like tabRight", async () => {
            const sender = makeSender(2); // index 1
            await bgModule.handleCommand("tabNext", sender);
            assert.equal(activatedTabId, 3);
        });

        // Verifies that firstTab activates the first tab in the window.
        it("firstTab activates first tab", async () => {
            await bgModule.handleCommand("firstTab", makeSender(3));
            assert.equal(activatedTabId, 1);
        });

        // Verifies that lastTab activates the last tab in the window.
        it("lastTab activates last tab", async () => {
            await bgModule.handleCommand("lastTab", makeSender(1));
            assert.equal(activatedTabId, 3);
        });
    });

    describe("queryTabs command", () => {
        // Verifies that queryTabs returns tab metadata for all tabs.
        it("returns tab list with id, title, url, active fields", async () => {
            const result = await bgModule.handleCommand("queryTabs", {});
            assert.equal(result.length, 3);
            assert.deepEqual(Object.keys(result[0]).sort(), ["active", "id", "title", "url"]);
            assert.equal(result[1].active, true);
        });
    });

    describe("unknown command", () => {
        // Verifies that unknown commands return an error status.
        it("returns unknown_command status", async () => {
            const result = await bgModule.handleCommand("nonsense", {});
            assert.equal(result.status, "unknown_command");
        });
    });

    describe("toolbar icon state", () => {
        // Verifies that extensionActive marks the tab active and enables the icon.
        it("extensionActive enables icon for the tab", async () => {
            const sender = makeSender(2);
            await bgModule.handleCommand("extensionActive", sender, {});
            assert.equal(bgModule.activeTabSet.has(2), true);
            assert.equal(actionState[2].enabled, true);
            assert.equal(actionState[2].title, "Vimium");
        });

        // Verifies that extensionInactive disables the icon for the tab.
        it("extensionInactive disables icon for the tab", async () => {
            const sender = makeSender(3);
            bgModule.activeTabSet.add(3);
            await bgModule.handleCommand("extensionInactive", sender, {});
            assert.equal(bgModule.activeTabSet.has(3), false);
            assert.equal(actionState[3].enabled, false);
            assert.equal(actionState[3].title, "Vimium (disabled on this site)");
        });

        // Verifies that closing a tab cleans up its entry from activeTabSet.
        it("tab removal cleans up activeTabSet", () => {
            bgModule.activeTabSet.add(5);
            assert.equal(bgModule.activeTabSet.has(5), true);
            // Simulate tab removal by calling registered listeners
            for (const fn of tabRemovedListeners) fn(5);
            assert.equal(bgModule.activeTabSet.has(5), false);
        });
    });

    describe("switchTab command", () => {
        // Verifies that switchTab activates the specified tab by ID.
        it("activates the specified tab", async () => {
            const result = await bgModule.handleCommand("switchTab", {}, { tabId: 3 });
            assert.equal(result.status, "ok");
            assert.equal(activatedTabId, 3);
        });

        // Verifies that switchTab does nothing when no tabId is provided.
        it("does nothing without tabId", async () => {
            const result = await bgModule.handleCommand("switchTab", {}, {});
            assert.equal(result.status, "ok");
            assert.equal(activatedTabId, null);
        });
    });

    describe("validateSettings", () => {
        // Verifies that valid settings pass through unchanged.
        it("accepts valid settings", () => {
            const input = { excludedDomains: ["example.com"], keyBindingMode: "character", theme: "dark" };
            const result = bgModule.validateSettings(input);
            assert.deepEqual(result, input);
        });

        // Verifies that unrecognized keyBindingMode falls back to default.
        it("falls back to default for invalid keyBindingMode", () => {
            const result = bgModule.validateSettings({ keyBindingMode: "bogus" });
            assert.equal(result.keyBindingMode, "location");
        });

        // Verifies that unrecognized theme falls back to default.
        it("falls back to default for invalid theme", () => {
            const result = bgModule.validateSettings({ theme: "neon" });
            assert.equal(result.theme, "yellow");
        });

        // Verifies that non-array excludedDomains falls back to empty array.
        it("falls back to empty array for non-array excludedDomains", () => {
            const result = bgModule.validateSettings({ excludedDomains: "not-an-array" });
            assert.deepEqual(result.excludedDomains, []);
        });

        // Verifies that non-string entries are filtered from excludedDomains.
        it("filters non-string entries from excludedDomains", () => {
            const result = bgModule.validateSettings({ excludedDomains: ["ok.com", 42, null, "good.org"] });
            assert.deepEqual(result.excludedDomains, ["ok.com", "good.org"]);
        });

        // Verifies that empty/missing input returns all defaults.
        it("returns defaults for empty input", () => {
            assert.deepEqual(bgModule.validateSettings({}), bgModule.DEFAULT_SETTINGS);
        });
    });

    describe("syncSettings command", () => {
        // Verifies that syncSettings fetches settings from native and stores them.
        it("syncs settings from native app to browser.storage.local", async () => {
            nativeMessageResponse = {
                excludedDomains: ["github.com"],
                keyBindingMode: "character",
                theme: "dark",
            };
            storedSettings = {};
            const result = await bgModule.handleCommand("syncSettings", {});
            assert.equal(result.status, "ok");
            assert.deepEqual(storedSettings.excludedDomains, ["github.com"]);
            assert.equal(storedSettings.keyBindingMode, "character");
            assert.equal(storedSettings.theme, "dark");
        });

        // Verifies that settingsChanged command also triggers a sync.
        it("settingsChanged triggers sync", async () => {
            nativeMessageResponse = {
                excludedDomains: [],
                keyBindingMode: "location",
                theme: "light",
            };
            storedSettings = {};
            const result = await bgModule.handleCommand("settingsChanged", {});
            assert.equal(result.status, "ok");
            assert.equal(storedSettings.theme, "light");
        });

        // Verifies that invalid native response values fall back to defaults.
        it("validates and falls back for bad native response values", async () => {
            nativeMessageResponse = {
                excludedDomains: "not-array",
                keyBindingMode: "invalid",
                theme: 123,
            };
            storedSettings = {};
            await bgModule.handleCommand("syncSettings", {});
            assert.deepEqual(storedSettings.excludedDomains, []);
            assert.equal(storedSettings.keyBindingMode, "location");
            assert.equal(storedSettings.theme, "yellow");
        });
    });
});
