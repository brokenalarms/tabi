// Tabi background service worker
// Handles tab management and messaging with content scripts

// Command names handled by the background service worker
type Command =
  | "createTab" | "closeTab" | "switchTab" | "queryTabs"
  | "restoreTab" | "tabLeft" | "tabRight" | "tabNext" | "tabPrev"
  | "goToTab" | "goToTabFirst" | "goToTabLast" | "extensionActive" | "extensionInactive"
  | "syncSettings"
  | "jumpToMark";

const APP_BUNDLE_ID = "com.brokenalarms.tabi";

interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

declare const browser: {
  tabs: {
    create(opts: { url?: string; index?: number }): Promise<{ id: number }>;
    remove(tabId: number): Promise<void>;
    update(tabId: number, props: { active: boolean }): Promise<unknown>;
    query(opts: { currentWindow: boolean }): Promise<Array<{ id: number; title: string; url: string; active: boolean }>>;
    sendMessage(tabId: number, message: Record<string, unknown>): Promise<unknown>;
    onRemoved: { addListener(fn: (tabId: number) => void): void };
    onUpdated: { addListener(fn: (tabId: number, changeInfo: { url?: string }, tab: { id: number; url: string }) => void): void };
    onActivated: { addListener(fn: (activeInfo: { tabId: number }) => void): void };
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
    sendNativeMessage(applicationId: string, message: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  storage: {
    local: {
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

interface MessageSender {
  tab?: { id: number; url: string };
}

type CommandResponse = { status: string; reason?: string; sameTab?: boolean } | TabInfo[];

export interface ClosedTab {
  url: string;
  leftNeighborId: number | null;
}

export const MAX_CLOSED_TABS = 50;
export const closedTabStack: ClosedTab[] = [];

// Track which tabs have the extension active (not excluded by domain)
export const activeTabSet = new Set<number>();

// Cache tab URLs so onRemoved can record closed tabs (the tab is already gone by then)
export const tabUrlCache = new Map<number, string>();

// Ordered list of tab IDs so we can find left neighbors when a tab is closed
export const tabOrder: number[] = [];

// Track the previously active tab so we can return to it after closing
export const activeHistory = { previous: null as number | null, current: null as number | null };

export async function updateIconState(tabId: number): Promise<void> {
  try {
    if (activeTabSet.has(tabId)) {
      await browser.action.enable(tabId);
      await browser.action.setBadgeText({ text: "", tabId });
      await browser.action.setTitle({ title: "tabi", tabId });
    } else {
      await browser.action.disable(tabId);
      await browser.action.setTitle({ title: "tabi (disabled on this site)", tabId });
    }
  } catch (_) {
    // browser.action may not be available in all contexts
  }
}

export function pushClosedTab(url: string | null | undefined, leftNeighborId: number | null): void {
  if (!url || url === "about:blank" || url === "about:newtab") return;
  closedTabStack.push({ url, leftNeighborId });
  if (closedTabStack.length > MAX_CLOSED_TABS) {
    closedTabStack.shift();
  }
}

export function popClosedTab(): ClosedTab | null {
  return closedTabStack.pop() || null;
}

/** Fetch settings from the native host app and write them to browser.storage.local. */
export async function syncSettings(): Promise<void> {
  const response = await browser.runtime.sendNativeMessage(APP_BUNDLE_ID, { command: "getSettings" });
  const settings: Record<string, unknown> = {};
  if (response.keyBindingMode !== undefined) settings.keyBindingMode = response.keyBindingMode;
  if (response.theme !== undefined) settings.theme = response.theme;
  if (response.isPremium !== undefined) settings.isPremium = response.isPremium;
  await browser.storage.local.set(settings);
}

export async function handleCommand(command: Command, sender: MessageSender, message?: Record<string, unknown>): Promise<CommandResponse> {
  switch (command) {
    case "createTab": {
      const url = message && typeof message.url === "string" ? message.url : undefined;
      // Open new tab to the right of the current tab
      const tabs = await browser.tabs.query({ currentWindow: true });
      const senderIdx = sender.tab ? tabs.findIndex(t => t.id === sender.tab!.id) : -1;
      const insertIndex = senderIdx >= 0 ? senderIdx + 1 : undefined;
      await browser.tabs.create(url ? { url, index: insertIndex } : { index: insertIndex });
      break;
    }

    case "closeTab": {
      if (!sender.tab) break;
      // Capture return target before remove — removing the tab triggers
      // onActivated (Safari auto-activates the next tab), which would
      // overwrite activeHistory before we can read it.
      const returnTo = activeHistory.previous !== null && activeHistory.previous !== sender.tab.id
        ? activeHistory.previous : null;
      if (returnTo !== null) {
        try { await browser.tabs.update(returnTo, { active: true }); } catch (_) {}
      }
      await browser.tabs.remove(sender.tab.id);
      break;
    }

    case "restoreTab": {
      const closed = popClosedTab();
      if (closed) {
        const tabs = await browser.tabs.query({ currentWindow: true });
        let index = 0;
        if (closed.leftNeighborId !== null) {
          const neighborIdx = tabs.findIndex(t => t.id === closed.leftNeighborId);
          index = neighborIdx >= 0 ? neighborIdx + 1 : tabs.length;
        }
        await browser.tabs.create({ url: closed.url, index });
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

    case "goToTab": {
      const tabs = await browser.tabs.query({ currentWindow: true });
      if (tabs.length === 0) break;
      const index = message && typeof message.index === "number" ? message.index : 1;
      // g1-g9 = tab N (1-indexed, clamped to tab count)
      const targetIndex = Math.min(index - 1, tabs.length - 1);
      await browser.tabs.update(tabs[targetIndex].id, { active: true });
      break;
    }

    case "goToTabFirst": {
      const tabs = await browser.tabs.query({ currentWindow: true });
      if (tabs.length > 0) {
        await browser.tabs.update(tabs[0].id, { active: true });
      }
      break;
    }

    case "goToTabLast": {
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

    case "syncSettings": {
      await syncSettings();
      break;
    }

    case "jumpToMark": {
      const url = message && typeof message.url === "string" ? message.url : undefined;
      const scrollY = message && typeof message.scrollY === "number" ? message.scrollY : 0;
      if (!url) break;

      // Check if the current tab already has this URL
      if (sender.tab && sender.tab.url === url) {
        return { status: "ok", sameTab: true } as CommandResponse;
      }

      // Find an existing tab with this URL
      const tabs = await browser.tabs.query({ currentWindow: true });
      const existing = tabs.find(t => t.url === url);
      if (existing) {
        await browser.tabs.update(existing.id, { active: true });
        // Send scroll restoration to the target tab
        try {
          await browser.tabs.sendMessage(existing.id, { command: "restoreScroll", scrollY });
        } catch (_) {
          // Content script may not be loaded yet
        }
        return { status: "ok", sameTab: false } as CommandResponse;
      }

      // No existing tab — open a new one
      await browser.tabs.create({ url });
      return { status: "ok", sameTab: false } as CommandResponse;
    }

    default:
      return { status: "unknown_command" };
  }

  return { status: "ok" };
}

// Register listeners and populate caches — called at load time in production,
// and explicitly from tests after the browser shim is installed.
export function init(): void {
  // Track active tab changes for "return to previous" on close
  browser.tabs.onActivated.addListener((activeInfo: { tabId: number }) => {
    activeHistory.previous = activeHistory.current;
    activeHistory.current = activeInfo.tabId;
  });

  // Track tab URLs for closed-tab restore
  browser.tabs.onUpdated.addListener((tabId: number, changeInfo: { url?: string }) => {
    if (changeInfo.url) {
      tabUrlCache.set(tabId, changeInfo.url);
    }
    // Ensure new tabs appear in tabOrder
    if (!tabOrder.includes(tabId)) {
      tabOrder.push(tabId);
    }
  });

  // Record closed tab with its left neighbor, then clean up caches
  browser.tabs.onRemoved.addListener((tabId: number) => {
    const url = tabUrlCache.get(tabId);
    const idx = tabOrder.indexOf(tabId);
    const leftNeighborId = idx > 0 ? tabOrder[idx - 1] : null;
    if (url) pushClosedTab(url, leftNeighborId);
    if (idx >= 0) tabOrder.splice(idx, 1);
    tabUrlCache.delete(tabId);
    activeTabSet.delete(tabId);
  });

  // Populate caches on startup
  browser.tabs.query({ currentWindow: true }).then(tabs => {
    tabOrder.length = 0;
    tabOrder.push(...tabs.map(t => t.id));
    for (const tab of tabs) {
      if (tab.url) tabUrlCache.set(tab.id, tab.url);
    }
  }).catch(() => {});

  // Sync settings from native host app on startup
  syncSettings().catch(() => {});

  browser.runtime.onMessage.addListener((message: unknown, sender: MessageSender, sendResponse: (response: unknown) => void) => {
    const msg = message as Record<string, unknown> | null;
    if (!msg || !msg.command) {
      sendResponse({ status: "error", reason: "missing command" });
      return;
    }

    handleCommand(msg.command as Command, sender, msg as Record<string, unknown>)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error("tabi background error:", err);
        sendResponse({ status: "error", reason: (err as Error).message });
      });

    // Return true to indicate async sendResponse
    return true;
  });
}

// Auto-init when running in the browser extension context
if (typeof browser !== "undefined") {
  init();
}
