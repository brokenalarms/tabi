function isDomainExcluded(excludedDomains) {
  const hostname = window.location.hostname.toLowerCase();
  for (const pattern of excludedDomains) {
    if (hostname === pattern || hostname.endsWith("." + pattern)) {
      return true;
    }
  }
  return false;
}
function applyTheme(theme) {
  if (theme === "auto") {
    document.documentElement.removeAttribute("data-vimium-theme");
  } else {
    document.documentElement.setAttribute("data-vimium-theme", theme);
  }
}
function initialize(settings) {
  const keyHandler = new KeyHandler();
  if (settings.keyBindingMode) {
    keyHandler.setKeyBindingMode(settings.keyBindingMode);
  }
  if (settings.theme) {
    applyTheme(settings.theme);
  }
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.keyBindingMode?.newValue) {
      keyHandler.setKeyBindingMode(changes.keyBindingMode.newValue);
    }
    if (changes.theme?.newValue) {
      applyTheme(changes.theme.newValue);
    }
  });
  const scrollController = new ScrollController(keyHandler);
  const hintMode = new HintMode(keyHandler);
  const findMode = new FindMode(keyHandler);
  const tabSearch = new TabSearch(keyHandler);
  keyHandler.on("exitToNormal", () => {
    if (keyHandler.getMode() === Mode.HINTS && hintMode.isActive()) {
      hintMode.deactivate();
      return;
    }
    if (keyHandler.getMode() === Mode.FIND && findMode.isActive()) {
      findMode.deactivate(true);
      return;
    }
    if (keyHandler.getMode() === Mode.TAB_SEARCH && tabSearch.isActive()) {
      tabSearch.deactivate();
      return;
    }
    keyHandler.setMode(Mode.NORMAL);
    const active = document.activeElement;
    if (active && active !== document.body) active.blur();
  });
  const tabCommands = [
    "createTab",
    "closeTab",
    "restoreTab",
    "tabLeft",
    "tabRight",
    "tabNext",
    "tabPrev",
    "firstTab",
    "lastTab"
  ];
  for (const cmd of tabCommands) {
    keyHandler.on(cmd, () => {
      browser.runtime.sendMessage({ command: cmd });
    });
  }
  function cleanupModes() {
    if (hintMode.isActive()) hintMode.deactivate();
    if (findMode.isActive()) findMode.deactivate(true);
    if (tabSearch.isActive()) tabSearch.deactivate();
  }
  window.addEventListener("beforeunload", cleanupModes);
  window.addEventListener("pagehide", cleanupModes);
  browser.runtime.sendMessage({ command: "extensionActive" });
  window.__vimiumKeyHandler = keyHandler;
  void scrollController;
}
browser.storage.local.get(["excludedDomains", "keyBindingMode", "theme"]).then((result) => {
  const excluded = result.excludedDomains || [];
  if (isDomainExcluded(excluded)) {
    browser.runtime.sendMessage({ command: "extensionInactive" });
  } else {
    initialize({
      keyBindingMode: result.keyBindingMode,
      theme: result.theme
    });
  }
}).catch(() => {
  initialize({});
});
if (typeof globalThis !== "undefined") {
  globalThis.isDomainExcluded = isDomainExcluded;
  globalThis.applyTheme = applyTheme;
}
