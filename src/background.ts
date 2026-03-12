// Vimium background service worker
// Handles tab management and messaging with content scripts

// Command names handled by the background service worker
type Command =
  | "createTab" | "closeTab" | "switchTab" | "queryTabs"
  | "restoreTab" | "tabLeft" | "tabRight" | "tabNext" | "tabPrev"
  | "firstTab" | "lastTab" | "extensionActive" | "extensionInactive";

interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

declare const browser: {
  tabs: {
    create(opts: { url?: string }): Promise<{ id: number }>;
    remove(tabId: number): Promise<void>;
    update(tabId: number, props: { active: boolean }): Promise<unknown>;
    query(opts: { currentWindow: boolean }): Promise<Array<{ id: number; title: string; url: string; active: boolean }>>;
    onRemoved: { addListener(fn: (tabId: number) => void): void };
    onUpdated: { addListener(fn: (tabId: number, changeInfo: { url?: string }, tab: { id: number; url: string }) => void): void };
  };
  action: {
    enable(tabId: number): Promise<void>;
    disable(tabId: number): Promise<void>;
    setBadgeText(opts: { text: string; tabId: number }): Promise<void>;
    setTitle(opts: { title: string; tabId: number }): Promise<void>;
  };
  runtime: {
    onMessage: {
      addListener(fn: (message: unknown, sender: MessageSender, sendResponse: (response: unknown) => void) => boolean | void): void;
    };
  };
};

interface MessageSender {
  tab?: { id: number; url: string };
}

type CommandResponse = { status: string; reason?: string } | TabInfo[];

const MAX_CLOSED_TABS = 50;
const closedTabStack: string[] = [];

// Track which tabs have the extension active (not excluded by domain)
const activeTabSet = new Set<number>();

// Cache tab URLs so onRemoved can record closed tabs (the tab is already gone by then)
const tabUrlCache = new Map<number, string>();

async function updateIconState(tabId: number): Promise<void> {
  try {
    if (activeTabSet.has(tabId)) {
      await browser.action.enable(tabId);
      await browser.action.setBadgeText({ text: "", tabId });
      await browser.action.setTitle({ title: "vimium-mac", tabId });
    } else {
      await browser.action.disable(tabId);
      await browser.action.setTitle({ title: "vimium-mac (disabled on this site)", tabId });
    }
  } catch (_) {
    // browser.action may not be available in all contexts
  }
}

function pushClosedTab(url: string | null | undefined): void {
  if (!url || url === "about:blank" || url === "about:newtab") return;
  closedTabStack.push(url);
  if (closedTabStack.length > MAX_CLOSED_TABS) {
    closedTabStack.shift();
  }
}

function popClosedTab(): string | null {
  return closedTabStack.pop() || null;
}

async function handleCommand(command: Command, sender: MessageSender, message?: Record<string, unknown>): Promise<CommandResponse> {
  switch (command) {
    case "createTab": {
      const url = message && typeof message.url === "string" ? message.url : undefined;
      await browser.tabs.create(url ? { url } : {});
      break;
    }

    case "closeTab": {
      if (!sender.tab) break;
      await browser.tabs.remove(sender.tab.id);
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
      const idx = tabs.findIndex(t => t.id === sender.tab!.id);
      if (idx < 0) break;
      const prev = (idx - 1 + tabs.length) % tabs.length;
      await browser.tabs.update(tabs[prev].id, { active: true });
      break;
    }

    case "tabRight":
    case "tabNext": {
      if (!sender.tab) break;
      const tabs = await browser.tabs.query({ currentWindow: true });
      const idx = tabs.findIndex(t => t.id === sender.tab!.id);
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

    case "switchTab": {
      const targetTabId = message && message.tabId != null ? message.tabId as number : undefined;
      if (targetTabId != null) {
        await browser.tabs.update(targetTabId, { active: true });
      }
      break;
    }

    case "extensionActive": {
      if (sender.tab) {
        activeTabSet.add(sender.tab.id);
        await updateIconState(sender.tab.id);
      }
      break;
    }

    case "extensionInactive": {
      if (sender.tab) {
        activeTabSet.delete(sender.tab.id);
        await updateIconState(sender.tab.id);
      }
      break;
    }

    default:
      return { status: "unknown_command" };
  }

  return { status: "ok" };
}

// Track tab URLs for closed-tab restore
browser.tabs.onUpdated.addListener((tabId: number, changeInfo: { url?: string }) => {
  if (changeInfo.url) {
    tabUrlCache.set(tabId, changeInfo.url);
  }
});

// Clean up activeTabSet and record closed tabs for restore
browser.tabs.onRemoved.addListener((tabId: number) => {
  const url = tabUrlCache.get(tabId);
  if (url) pushClosedTab(url);
  tabUrlCache.delete(tabId);
  activeTabSet.delete(tabId);
});

// Populate URL cache on startup
browser.tabs.query({ currentWindow: true }).then(tabs => {
  for (const tab of tabs) {
    if (tab.url) tabUrlCache.set(tab.id, tab.url);
  }
}).catch(() => {});

browser.runtime.onMessage.addListener((message: unknown, sender: MessageSender, sendResponse: (response: unknown) => void) => {
  const msg = message as Record<string, unknown> | null;
  if (!msg || !msg.command) {
    sendResponse({ status: "error", reason: "missing command" });
    return;
  }

  handleCommand(msg.command as Command, sender, msg as Record<string, unknown>)
    .then(result => sendResponse(result))
    .catch(err => {
      console.error("vimium-mac background error:", err);
      sendResponse({ status: "error", reason: (err as Error).message });
    });

  // Return true to indicate async sendResponse
  return true;
});

// Export internals for testing via globalThis
if (typeof globalThis !== "undefined") {
  const g = globalThis as Record<string, unknown>;
  g.closedTabStack = closedTabStack;
  g.pushClosedTab = pushClosedTab;
  g.popClosedTab = popClosedTab;
  g.handleCommand = handleCommand;
  g.MAX_CLOSED_TABS = MAX_CLOSED_TABS;
  g.activeTabSet = activeTabSet;
  g.tabUrlCache = tabUrlCache;
  g.updateIconState = updateIconState;
}
