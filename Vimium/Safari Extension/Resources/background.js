// Vimium background service worker
// Handles tab management and messaging with content scripts

const MAX_CLOSED_TABS = 50;
const closedTabStack = [];

function pushClosedTab(url) {
    if (!url || url === "about:blank" || url === "about:newtab") return;
    closedTabStack.push(url);
    if (closedTabStack.length > MAX_CLOSED_TABS) {
        closedTabStack.shift();
    }
}

function popClosedTab() {
    return closedTabStack.pop() || null;
}

async function handleCommand(command, sender) {
    switch (command) {
        case "createTab":
            await browser.tabs.create({});
            break;

        case "closeTab": {
            if (!sender.tab) break;
            const tab = sender.tab;
            pushClosedTab(tab.url);
            await browser.tabs.remove(tab.id);
            break;
        }

        case "restoreTab": {
            const url = popClosedTab();
            if (url) {
                await browser.tabs.create({ url });
            }
            break;
        }

        case "tabLeft":
        case "tabPrev": {
            if (!sender.tab) break;
            const tabs = await browser.tabs.query({ currentWindow: true });
            const idx = tabs.findIndex(t => t.id === sender.tab.id);
            if (idx < 0) break;
            const prev = (idx - 1 + tabs.length) % tabs.length;
            await browser.tabs.update(tabs[prev].id, { active: true });
            break;
        }

        case "tabRight":
        case "tabNext": {
            if (!sender.tab) break;
            const tabs = await browser.tabs.query({ currentWindow: true });
            const idx = tabs.findIndex(t => t.id === sender.tab.id);
            if (idx < 0) break;
            const next = (idx + 1) % tabs.length;
            await browser.tabs.update(tabs[next].id, { active: true });
            break;
        }

        case "firstTab": {
            const tabs = await browser.tabs.query({ currentWindow: true });
            if (tabs.length > 0) {
                await browser.tabs.update(tabs[0].id, { active: true });
            }
            break;
        }

        case "lastTab": {
            const tabs = await browser.tabs.query({ currentWindow: true });
            if (tabs.length > 0) {
                await browser.tabs.update(tabs[tabs.length - 1].id, { active: true });
            }
            break;
        }

        case "queryTabs": {
            const tabs = await browser.tabs.query({ currentWindow: true });
            return tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
        }

        case "syncSettings": {
            await syncExcludedDomains();
            return { status: "ok" };
        }

        case "switchTab": {
            if (message.tabId != null) {
                await browser.tabs.update(message.tabId, { active: true });
            }
            break;
        }

        default:
            return { status: "unknown_command" };
    }

    return { status: "ok" };
}

// Sync excluded domains from native settings to browser.storage.local
async function syncExcludedDomains() {
    try {
        const response = await browser.runtime.sendNativeMessage(
            "com.anthropic.Vimium",
            { command: "getExcludedDomains" }
        );
        if (response && response.excludedDomains) {
            await browser.storage.local.set({ excludedDomains: response.excludedDomains });
        }
    } catch (err) {
        console.error("Vimium: failed to sync excluded domains:", err);
    }
}

// Sync on service worker startup
syncExcludedDomains();

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.command) {
        sendResponse({ status: "error", reason: "missing command" });
        return;
    }

    handleCommand(message.command, sender)
        .then(result => sendResponse(result))
        .catch(err => {
            console.error("Vimium background error:", err);
            sendResponse({ status: "error", reason: err.message });
        });

    // Return true to indicate async sendResponse
    return true;
});

// Export internals for testing
if (typeof module !== "undefined" && module.exports) {
    module.exports = { closedTabStack, pushClosedTab, popClosedTab, handleCommand, MAX_CLOSED_TABS };
}
