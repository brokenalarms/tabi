// Vimium content script
// Runs on every page to handle keyboard navigation

import type { KeyBindingMode, ModeValue, Theme, VimiumSettings } from "./types";

// Browser API (Safari Web Extension)
declare const browser: {
  runtime: {
    sendMessage(message: { command: string }): Promise<unknown>;
  };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
    };
    onChanged: {
      addListener(
        callback: (
          changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
          areaName: string,
        ) => void,
      ): void;
    };
  };
};

// Globals injected by content_scripts loaded before this file
declare const Mode: {
  readonly NORMAL: "NORMAL";
  readonly INSERT: "INSERT";
  readonly HINTS: "HINTS";
  readonly FIND: "FIND";
  readonly TAB_SEARCH: "TAB_SEARCH";
};

declare class KeyHandler {
  mode: ModeValue;
  getMode(): ModeValue;
  setMode(mode: ModeValue): void;
  setKeyBindingMode(mode: KeyBindingMode): void;
  on(command: string, callback: () => void): void;
}

declare class ScrollController {
  constructor(keyHandler: KeyHandler);
}

declare class HintMode {
  constructor(keyHandler: KeyHandler);
  isActive(): boolean;
  deactivate(): void;
}

declare class FindMode {
  constructor(keyHandler: KeyHandler);
  isActive(): boolean;
  deactivate(restoreSelection: boolean): void;
}

declare class TabSearch {
  constructor(keyHandler: KeyHandler);
  isActive(): boolean;
  deactivate(): void;
}

declare global {
  interface Window {
    __vimiumKeyHandler?: KeyHandler;
  }
}

function isDomainExcluded(excludedDomains: string[]): boolean {
  const hostname = window.location.hostname.toLowerCase();
  for (const pattern of excludedDomains) {
    if (hostname === pattern || hostname.endsWith("." + pattern)) {
      return true;
    }
  }
  return false;
}

function applyTheme(theme: Theme): void {
  if (theme === "auto") {
    document.documentElement.removeAttribute("data-vimium-theme");
  } else {
    document.documentElement.setAttribute("data-vimium-theme", theme);
  }
}

function initialize(settings: Partial<VimiumSettings>): void {
  const keyHandler = new KeyHandler();

  // Apply initial settings
  if (settings.keyBindingMode) {
    keyHandler.setKeyBindingMode(settings.keyBindingMode);
  }
  if (settings.theme) {
    applyTheme(settings.theme);
  }

  // Listen for live settings changes from browser.storage
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.keyBindingMode?.newValue) {
      keyHandler.setKeyBindingMode(changes.keyBindingMode.newValue as KeyBindingMode);
    }
    if (changes.theme?.newValue) {
      applyTheme(changes.theme.newValue as Theme);
    }
  });

  // Scroll and history navigation
  const scrollController = new ScrollController(keyHandler);

  // Link hint navigation
  const hintMode = new HintMode(keyHandler);

  // In-page find
  const findMode = new FindMode(keyHandler);

  // Tab search overlay
  const tabSearch = new TabSearch(keyHandler);

  // Default exitToNormal handler restores NORMAL mode
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
    if (active && active !== document.body) (active as HTMLElement).blur();
  });

  // Tab operations — delegate to background service worker
  const tabCommands = [
    "createTab", "closeTab", "restoreTab",
    "tabLeft", "tabRight", "tabNext", "tabPrev",
    "firstTab", "lastTab",
  ];
  for (const cmd of tabCommands) {
    keyHandler.on(cmd, () => {
      browser.runtime.sendMessage({ command: cmd });
    });
  }

  // Clean up all mode overlays on navigation (page unload)
  function cleanupModes(): void {
    if (hintMode.isActive()) hintMode.deactivate();
    if (findMode.isActive()) findMode.deactivate(true);
    if (tabSearch.isActive()) tabSearch.deactivate();
  }
  window.addEventListener("beforeunload", cleanupModes);
  window.addEventListener("pagehide", cleanupModes);

  // Notify background that extension is active on this tab
  browser.runtime.sendMessage({ command: "extensionActive" });

  // Expose for other modules (FindMode, TabSearch)
  window.__vimiumKeyHandler = keyHandler;

  // Suppress unused-variable warnings — these are used via their constructors
  void scrollController;
}

// Read all settings and initialize
browser.storage.local.get(["excludedDomains", "keyBindingMode", "theme"]).then((result) => {
  const excluded = (result.excludedDomains as string[]) || [];
  if (isDomainExcluded(excluded)) {
    browser.runtime.sendMessage({ command: "extensionInactive" });
  } else {
    initialize({
      keyBindingMode: result.keyBindingMode as KeyBindingMode | undefined,
      theme: result.theme as Theme | undefined,
    });
  }
}).catch(() => {
  // If storage read fails, initialize with defaults
  initialize({});
});

// Export for testing via globalThis
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).isDomainExcluded = isDomainExcluded;
  (globalThis as Record<string, unknown>).applyTheme = applyTheme;
}
