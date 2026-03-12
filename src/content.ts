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
  resetBuffer(): void;
  on(command: string, callback: () => void): void;
}

declare class ScrollController {
  constructor(keyHandler: KeyHandler);
}

declare class HintMode {
  constructor(keyHandler: KeyHandler);
  isActive(): boolean;
  deactivate(): void;
  wireCommands(): void;
  unwireCommands(): void;
  setPointerTails(enabled: boolean): void;
}

declare class FindMode {
  constructor(keyHandler: KeyHandler);
  destroy(): void;
}

declare class TabSearch {
  constructor(keyHandler: KeyHandler);
  isActive(): boolean;
  deactivate(): void;
}

declare class HelpOverlay {
  constructor(keyHandler: KeyHandler);
  destroy(): void;
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

function parseRgba(color: string): { r: number; g: number; b: number; a: number } | null {
  const rgbaMatch = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!rgbaMatch) return null;
  return {
    r: parseFloat(rgbaMatch[1]),
    g: parseFloat(rgbaMatch[2]),
    b: parseFloat(rgbaMatch[3]),
    a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
  };
}

function detectPageBackground(): "dark" | "light" {
  // Sample background color from body and html element
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const bg = getComputedStyle(el).backgroundColor;
    const rgba = parseRgba(bg);
    if (!rgba || rgba.a < 0.1) continue;
    const luminance = (0.299 * rgba.r + 0.587 * rgba.g + 0.114 * rgba.b) / 255;
    // Light page → dark hints for contrast; dark page → light hints
    return luminance > 0.5 ? "dark" : "light";
  }
  // Default: assume light page → dark hints
  return "dark";
}

function applyTheme(theme: Theme): void {
  if (theme === "auto") {
    document.documentElement.setAttribute("data-vimium-theme", detectPageBackground());
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
  applyTheme(settings.theme || "auto");

  // Scroll and history navigation
  const scrollController = new ScrollController(keyHandler);

  // Link hint navigation
  const hintMode = new HintMode(keyHandler);
  if (settings.enableHints !== "false") {
    hintMode.wireCommands();
  }
  if (settings.enablePointerTails === "true") {
    hintMode.setPointerTails(true);
  }

  // In-page find
  const findMode = new FindMode(keyHandler);

  // Tab search overlay
  const tabSearch = new TabSearch(keyHandler);

  // Help overlay
  const helpOverlay = new HelpOverlay(keyHandler);

  // Listen for live settings changes from browser.storage
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.keyBindingMode?.newValue) {
      keyHandler.setKeyBindingMode(changes.keyBindingMode.newValue as KeyBindingMode);
    }
    if (changes.theme?.newValue) {
      applyTheme(changes.theme.newValue as Theme);
    }
    if (changes.enableHints) {
      if (changes.enableHints.newValue === "false") {
        hintMode.unwireCommands();
        if (hintMode.isActive()) hintMode.deactivate();
      } else {
        hintMode.wireCommands();
      }
    }
    if (changes.enablePointerTails) {
      hintMode.setPointerTails(changes.enablePointerTails.newValue === "true");
    }
  });

  // Default exitToNormal handler restores NORMAL mode
  keyHandler.on("exitToNormal", () => {
    if (keyHandler.getMode() === Mode.HINTS && hintMode.isActive()) {
      hintMode.deactivate();
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

  // Focus first text input on the page (gi). Tab cycles through inputs.
  keyHandler.on("focusInput", () => {
    const inputs = document.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="image"]):not([type="color"]):not([type="range"]), textarea, [contenteditable="true"]',
    );
    for (const el of inputs) {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        el.focus();
        break;
      }
    }
  });

  // Go up one level in the URL hierarchy (gu)
  keyHandler.on("goUpUrl", () => {
    const url = new URL(window.location.href);
    if (url.pathname.length > 1) {
      // Strip last path segment
      url.pathname = url.pathname.replace(/\/[^/]*\/?$/, "") || "/";
      url.search = "";
      url.hash = "";
      window.location.href = url.toString();
    }
  });

  // Clean up all mode overlays on navigation (page unload)
  function cleanupModes(): void {
    if (hintMode.isActive()) hintMode.deactivate();
    if (tabSearch.isActive()) tabSearch.deactivate();
  }
  window.addEventListener("beforeunload", cleanupModes);
  window.addEventListener("pagehide", cleanupModes);

  // Restore focus after popup/DevTools close — Safari doesn't always
  // re-deliver keyboard events to the content script until the page
  // regains explicit focus.
  function restoreFocus(): void {
    window.focus();
    if (keyHandler.getMode() === Mode.NORMAL) {
      keyHandler.resetBuffer();
    }
  }
  window.addEventListener("focus", restoreFocus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") restoreFocus();
  });

  // Notify background that extension is active on this tab
  browser.runtime.sendMessage({ command: "extensionActive" });

  // Expose for other modules (FindMode, TabSearch)
  window.__vimiumKeyHandler = keyHandler;

  // Suppress unused-variable warnings — these are used via their constructors
  void scrollController;
  void helpOverlay;
}

// Read all settings and initialize
browser.storage.local.get(["excludedDomains", "keyBindingMode", "theme", "enableHints", "enablePointerTails"]).then((result) => {
  const excluded = (result.excludedDomains as string[]) || [];
  if (isDomainExcluded(excluded)) {
    browser.runtime.sendMessage({ command: "extensionInactive" });
  } else {
    initialize({
      keyBindingMode: result.keyBindingMode as KeyBindingMode | undefined,
      theme: result.theme as Theme | undefined,
      enableHints: result.enableHints as string | undefined,
      enablePointerTails: result.enablePointerTails as string | undefined,
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
