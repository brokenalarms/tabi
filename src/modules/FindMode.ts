// FindMode — thin wrapper that triggers the native macOS Cmd+F find bar.
// Vimium "/" binding dispatches a synthetic Cmd+F keydown so Safari's
// built-in find handles everything (highlight, n/N, UI).

import type { ModeValue } from "../types";

declare const Mode: {
  readonly NORMAL: "NORMAL";
  readonly INSERT: "INSERT";
  readonly HINTS: "HINTS";
  readonly FIND: "FIND";
  readonly TAB_SEARCH: "TAB_SEARCH";
};

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

class FindMode {
  private _keyHandler: KeyHandlerLike;

  constructor(keyHandler: KeyHandlerLike) {
    this._keyHandler = keyHandler;
    this._keyHandler.on("enterFindMode", () => this._triggerNativeFind());
  }

  private _triggerNativeFind(): void {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
  }

  isActive(): boolean {
    return false;
  }

  deactivate(_clearHighlight: boolean): void {
    // no-op — native find manages its own lifecycle
  }

  destroy(): void {
    this._keyHandler.off("enterFindMode");
  }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).FindMode = FindMode;
}
