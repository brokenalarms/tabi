// Tabi content script
// Runs on every page to handle keyboard navigation

import type { KeyBindingMode, ModeValue, Theme } from "./types";
import { resolveSettings } from "./types";
import { Mode } from "./commands";
import { KeyHandler } from "./modules/KeyHandler";
import { ScrollController } from "./modules/ScrollController";
import { HintMode } from "./modules/HintMode";
import { TabSearch } from "./modules/TabSearch";
import { HelpOverlay } from "./modules/HelpOverlay";

// Browser API (Safari Web Extension)
declare const browser: {
  runtime: {
    sendMessage(message: { command: string; url?: string; index?: number }): Promise<unknown>;
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

declare global {
  interface Window {
    __tabiKeyHandler?: KeyHandler;
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
    document.documentElement.setAttribute("data-tabi-theme", detectPageBackground());
  } else {
    document.documentElement.setAttribute("data-tabi-theme", theme);
  }
}

function initialize(resolved: ReturnType<typeof resolveSettings>): void {
  const keyHandler = new KeyHandler();

  // Apply initial settings
  keyHandler.setKeyBindingMode(resolved.keyBindingMode);
  applyTheme(resolved.theme);

  // Scroll and history navigation
  const scrollController = new ScrollController(keyHandler);

  // Link hint navigation
  const hintMode = new HintMode(keyHandler);
  hintMode.wireCommands();

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
  ];
  for (const cmd of tabCommands) {
    keyHandler.on(cmd, () => {
      browser.runtime.sendMessage({ command: cmd });
    });
  }
  // g1-g9: go to tab by number
  for (let i = 1; i <= 9; i++) {
    keyHandler.on("goToTab" + i, () => {
      browser.runtime.sendMessage({ command: "goToTab", index: i });
    });
  }
  // g0 / g^ = first tab, g$ = last tab
  keyHandler.on("goToTabFirst", () => {
    browser.runtime.sendMessage({ command: "goToTabFirst" });
  });
  keyHandler.on("goToTabLast", () => {
    browser.runtime.sendMessage({ command: "goToTabLast" });
  });

  // Focus first text input on the page (gi). Tab cycles through inputs.
  // Searches into open shadow roots so inputs inside web components are found.
  const TEXT_INPUT_SELECTOR = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="image"]):not([type="color"]):not([type="range"]), textarea, [contenteditable="true"]';

  function findTextInputs(root: Document | ShadowRoot | Element, results: HTMLElement[]): void {
    const inputs = (root as Document | ShadowRoot).querySelectorAll
      ? (root as Document | ShadowRoot).querySelectorAll<HTMLElement>(TEXT_INPUT_SELECTOR)
      : [];
    for (const el of inputs) {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        results.push(el);
      }
    }
    // Recurse into open shadow roots
    const hosts = (root as Document | ShadowRoot).querySelectorAll
      ? (root as Document | ShadowRoot).querySelectorAll("*")
      : [];
    for (const el of hosts) {
      if (el.shadowRoot) {
        findTextInputs(el.shadowRoot, results);
      }
    }
  }

  keyHandler.on("focusInput", () => {
    const inputs: HTMLElement[] = [];
    findTextInputs(document, inputs);
    if (inputs.length > 0) {
      inputs[0].focus();
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
  // Restore focus after back/forward navigation — Safari restores pages
  // from bfcache without reliably firing focus or visibilitychange.
  window.addEventListener("pageshow", (e: PageTransitionEvent) => {
    if (e.persisted) restoreFocus();
  });

  // Notify background that extension is active on this tab
  browser.runtime.sendMessage({ command: "extensionActive" });

  // Expose for other modules (TabSearch)
  window.__tabiKeyHandler = keyHandler;

  // Suppress unused-variable warnings — these are used via their constructors
  void scrollController;
  void helpOverlay;
}

// Read all settings and initialize
browser.storage.local.get(["excludedDomains", "keyBindingMode", "theme"]).then((result) => {
  const excluded = (result.excludedDomains as string[]) || [];
  if (isDomainExcluded(excluded)) {
    browser.runtime.sendMessage({ command: "extensionInactive" });
  } else {
    initialize(resolveSettings(result));
  }
}).catch(() => {
  // If storage read fails, initialize with defaults
  initialize(resolveSettings({}));
});
