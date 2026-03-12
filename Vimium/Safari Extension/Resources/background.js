const MAX_CLOSED_TABS = 50;
const closedTabStack = [];
const activeTabSet = /* @__PURE__ */ new Set();
async function updateIconState(tabId) {
  try {
    if (activeTabSet.has(tabId)) {
      await browser.action.enable(tabId);
      await browser.action.setBadgeText({ text: "", tabId });
      await browser.action.setTitle({ title: "Vimium", tabId });
    } else {
      await browser.action.disable(tabId);
      await browser.action.setTitle({ title: "Vimium (disabled on this site)", tabId });
    }
  } catch (_) {
  }
}
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
async function handleCommand(command, sender, message) {
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
      const idx = tabs.findIndex((t) => t.id === sender.tab.id);
      if (idx < 0) break;
      const prev = (idx - 1 + tabs.length) % tabs.length;
      await browser.tabs.update(tabs[prev].id, { active: true });
      break;
    }
    case "tabRight":
    case "tabNext": {
      if (!sender.tab) break;
      const tabs = await browser.tabs.query({ currentWindow: true });
      const idx = tabs.findIndex((t) => t.id === sender.tab.id);
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
      return tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
    }
    case "syncSettings":
    case "settingsChanged": {
      await syncSettings();
      return { status: "ok" };
    }
    case "switchTab": {
      const targetTabId = message && message.tabId != null ? message.tabId : void 0;
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
const VALID_KEY_BINDING_MODES = ["location", "character"];
const VALID_THEMES = ["yellow", "dark", "light", "auto"];
const DEFAULT_SETTINGS = {
  excludedDomains: [],
  keyBindingMode: "location",
  theme: "yellow"
};
function validateSettings(raw) {
  const excludedDomains = Array.isArray(raw.excludedDomains) ? raw.excludedDomains.filter((d) => typeof d === "string") : DEFAULT_SETTINGS.excludedDomains;
  const keyBindingMode = VALID_KEY_BINDING_MODES.includes(raw.keyBindingMode) ? raw.keyBindingMode : DEFAULT_SETTINGS.keyBindingMode;
  const theme = VALID_THEMES.includes(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme;
  return { excludedDomains, keyBindingMode, theme };
}
async function syncSettings() {
  try {
    const response = await browser.runtime.sendNativeMessage(
      "com.anthropic.Vimium",
      { command: "getSettings" }
    );
    const settings = validateSettings(response ?? {});
    await browser.storage.local.set(settings);
  } catch (err) {
    console.error("Vimium: failed to sync settings:", err);
  }
}
syncSettings();
browser.tabs.onRemoved.addListener((tabId) => {
  activeTabSet.delete(tabId);
});
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message;
  if (!msg || !msg.command) {
    sendResponse({ status: "error", reason: "missing command" });
    return;
  }
  handleCommand(msg.command, sender, msg).then((result) => sendResponse(result)).catch((err) => {
    console.error("Vimium background error:", err);
    sendResponse({ status: "error", reason: err.message });
  });
  return true;
});
if (typeof globalThis !== "undefined") {
  const g = globalThis;
  g.closedTabStack = closedTabStack;
  g.pushClosedTab = pushClosedTab;
  g.popClosedTab = popClosedTab;
  g.handleCommand = handleCommand;
  g.MAX_CLOSED_TABS = MAX_CLOSED_TABS;
  g.activeTabSet = activeTabSet;
  g.updateIconState = updateIconState;
  g.syncSettings = syncSettings;
  g.validateSettings = validateSettings;
  g.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
}
