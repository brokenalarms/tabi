// FindMode — in-page search with smartcase detection for Vimium
// Renders a bottom-of-viewport find bar, searches via window.find(),
// supports n/N for next/prev, Enter to close on match, Escape to clear.

import type { ModeValue } from "../types";

declare const Mode: {
  readonly NORMAL: "NORMAL";
  readonly INSERT: "INSERT";
  readonly HINTS: "HINTS";
  readonly FIND: "FIND";
  readonly TAB_SEARCH: "TAB_SEARCH";
};

// window.find() is a non-standard API available in Safari/Firefox/Chrome
declare global {
  interface Window {
    find(query: string, caseSensitive?: boolean, backward?: boolean, wrapAround?: boolean): boolean;
  }
}

interface KeyHandlerLike {
  setMode(mode: ModeValue): void;
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

class FindMode {
  private _keyHandler: KeyHandlerLike;
  private _active: boolean;
  private _barEl: HTMLDivElement | null;
  private _inputEl: HTMLInputElement | null;
  private _countEl: HTMLSpanElement | null;
  private _styleEl: HTMLStyleElement | null;
  private _lastQuery: string;
  private _caseSensitive: boolean;
  private readonly _onKeyDown: (event: KeyboardEvent) => void;
  private readonly _onInput: () => void;

  constructor(keyHandler: KeyHandlerLike) {
    this._keyHandler = keyHandler;
    this._active = false;
    this._barEl = null;
    this._inputEl = null;
    this._countEl = null;
    this._styleEl = null;
    this._lastQuery = "";
    this._caseSensitive = false;
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onInput = this._handleInput.bind(this);
    this._wireCommands();
  }

  // --- Public API ---

  activate(): void {
    if (this._active) return;
    this._active = true;
    this._keyHandler.setMode(Mode.FIND);
    this._injectStyles();
    this._createBar();
    this._inputEl!.focus();
    document.addEventListener("keydown", this._onKeyDown, true);
  }

  deactivate(clearHighlight: boolean): void {
    if (!this._active) return;
    this._active = false;
    document.removeEventListener("keydown", this._onKeyDown, true);

    if (clearHighlight) {
      this._clearSelection();
      this._lastQuery = "";
    }

    if (this._barEl && this._barEl.parentNode) {
      this._barEl.parentNode.removeChild(this._barEl);
    }
    this._barEl = null;
    this._inputEl = null;
    this._countEl = null;

    if (this._styleEl && this._styleEl.parentNode) {
      this._styleEl.parentNode.removeChild(this._styleEl);
    }
    this._styleEl = null;

    this._keyHandler.setMode(Mode.NORMAL);
  }

  isActive(): boolean {
    return this._active;
  }

  getLastQuery(): string {
    return this._lastQuery;
  }

  // --- Smartcase detection ---

  static isSmartCaseSensitive(query: string): boolean {
    return query !== query.toLowerCase();
  }

  // --- Search ---

  private _search(query: string, backward: boolean): boolean {
    if (!query) return false;
    this._caseSensitive = FindMode.isSmartCaseSensitive(query);
    this._lastQuery = query;

    // Clear existing selection so window.find starts from top/bottom
    this._clearSelection();

    return this._windowFind(query, this._caseSensitive, backward);
  }

  private _findNext(): boolean {
    if (!this._lastQuery) return false;
    return this._windowFind(this._lastQuery, this._caseSensitive, false);
  }

  private _findPrev(): boolean {
    if (!this._lastQuery) return false;
    return this._windowFind(this._lastQuery, this._caseSensitive, true);
  }

  private _windowFind(query: string, caseSensitive: boolean, backward: boolean): boolean {
    // window.find(string, caseSensitive, backward, wrapAround)
    return window.find(query, caseSensitive, backward, true);
  }

  private _clearSelection(): void {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  }

  // --- UI ---

  private _injectStyles(): void {
    if (this._styleEl) return;
    this._styleEl = document.createElement("style");
    this._styleEl.textContent = `
.vimium-find-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    padding: 6px 12px;
    background: #333;
    border-top: 1px solid #555;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 14px;
    box-shadow: 0 -2px 8px rgba(0,0,0,0.3);
}
.vimium-find-bar input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid #666;
    border-radius: 3px;
    background: #1a1a1a;
    color: #eee;
    font-size: 14px;
    font-family: inherit;
    outline: none;
}
.vimium-find-bar input:focus {
    border-color: #4a9eff;
}
.vimium-find-bar .vimium-find-count {
    margin-left: 8px;
    color: #aaa;
    font-size: 12px;
    white-space: nowrap;
}
`;
    (document.head || document.documentElement).appendChild(this._styleEl);
  }

  private _createBar(): void {
    this._barEl = document.createElement("div") as HTMLDivElement;
    this._barEl.className = "vimium-find-bar";

    this._inputEl = document.createElement("input") as HTMLInputElement;
    this._inputEl.type = "text";
    this._inputEl.placeholder = "Find\u2026";
    this._inputEl.setAttribute("autocomplete", "off");
    this._inputEl.setAttribute("spellcheck", "false");

    // Pre-fill with last query if available
    if (this._lastQuery) {
      this._inputEl.value = this._lastQuery;
      this._inputEl.select();
    }

    this._countEl = document.createElement("span") as HTMLSpanElement;
    this._countEl.className = "vimium-find-count";

    this._barEl.appendChild(this._inputEl);
    this._barEl.appendChild(this._countEl);
    document.body.appendChild(this._barEl);

    this._inputEl.addEventListener("input", this._onInput);
  }

  private _handleInput(): void {
    const query = this._inputEl!.value;
    if (!query) {
      this._clearSelection();
      this._countEl!.textContent = "";
      return;
    }
    const found = this._search(query, false);
    this._countEl!.textContent = found ? "" : "No matches";
  }

  // --- Key handling during FIND mode ---

  private _handleKeyDown(event: KeyboardEvent): void {
    if (!this._active) return;

    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.deactivate(true);
      return;
    }

    if (event.code === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        this._findPrev();
      } else {
        // Close find bar, keep match highlighted
        this._lastQuery = this._inputEl!.value;
        this._caseSensitive = FindMode.isSmartCaseSensitive(this._lastQuery);
        this.deactivate(false);
      }
      return;
    }

    // Let input handle all other keys — don't propagate to KeyHandler
    event.stopPropagation();
  }

  // --- Command wiring ---

  private _wireCommands(): void {
    this._keyHandler.on("enterFindMode", () => this.activate());
    this._keyHandler.on("findNext", () => this._findNext());
    this._keyHandler.on("findPrev", () => this._findPrev());
  }

  destroy(): void {
    this.deactivate(true);
    this._keyHandler.off("enterFindMode");
    this._keyHandler.off("findNext");
    this._keyHandler.off("findPrev");
  }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).FindMode = FindMode;
}
