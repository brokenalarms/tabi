// TabSearch — modal overlay for fuzzy-searching and switching browser tabs
// Requests tab list from background, scores matches by prefix > word-boundary
// > substring, sorts by score then recency. Keyboard navigation with
// Up/Down or Ctrl-j/k, Enter to switch, Escape to dismiss.

import type { ModeValue, TabInfo } from "../types";

// Browser API (Safari Web Extension)
declare const browser: {
  runtime: {
    sendMessage(message: { command: string; tabId?: number }): Promise<unknown>;
  };
};

declare const Mode: {
  readonly NORMAL: "NORMAL";
  readonly INSERT: "INSERT";
  readonly HINTS: "HINTS";
  readonly FIND: "FIND";
  readonly TAB_SEARCH: "TAB_SEARCH";
};

interface KeyHandlerLike {
  setMode(mode: ModeValue): void;
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

interface ScoredEntry {
  tab: TabInfo;
  score: number;
  index: number;
}

class TabSearch {
  private _keyHandler: KeyHandlerLike;
  private _active: boolean;
  private _overlayEl: HTMLDivElement | null;
  private _inputEl: HTMLInputElement | null;
  private _resultsEl: HTMLDivElement | null;
  private _tabs: TabInfo[];
  private _filtered: TabInfo[];
  private _selectedIndex: number;
  private readonly _onKeyDown: (event: KeyboardEvent) => void;
  private readonly _onInput: () => void;

  constructor(keyHandler: KeyHandlerLike) {
    this._keyHandler = keyHandler;
    this._active = false;
    this._overlayEl = null;
    this._inputEl = null;
    this._resultsEl = null;
    this._tabs = [];
    this._filtered = [];
    this._selectedIndex = 0;
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onInput = this._handleInput.bind(this);
    this._wireCommands();
  }

  // --- Public API ---

  async activate(): Promise<void> {
    if (this._active) return;
    this._active = true;
    this._keyHandler.setMode(Mode.TAB_SEARCH);
    this._tabs = await this._fetchTabs();
    this._filtered = this._tabs.filter(t => !t.active);
    this._selectedIndex = 0;
    this._createOverlay();
    this._renderResults();
    this._inputEl!.focus();
    document.addEventListener("keydown", this._onKeyDown, true);
  }

  deactivate(): void {
    if (!this._active) return;
    this._active = false;
    document.removeEventListener("keydown", this._onKeyDown, true);
    if (this._overlayEl && this._overlayEl.parentNode) {
      this._overlayEl.parentNode.removeChild(this._overlayEl);
    }
    this._overlayEl = null;
    this._inputEl = null;
    this._resultsEl = null;
    this._tabs = [];
    this._filtered = [];
    this._selectedIndex = 0;
    this._keyHandler.setMode(Mode.NORMAL);
  }

  isActive(): boolean {
    return this._active;
  }

  // --- Fuzzy matching ---

  static scoreMatch(query: string, text: string): number {
    if (!query || !text) return -1;
    const lowerQuery = query.toLowerCase();
    const lowerText = text.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);
    if (idx < 0) return -1;

    // Prefix match: query matches from the start
    if (idx === 0) return 3;

    // Word-boundary match: character before match is a separator
    const charBefore = lowerText[idx - 1];
    if (charBefore === " " || charBefore === "/" || charBefore === "."
        || charBefore === "-" || charBefore === "_" || charBefore === ":") {
      return 2;
    }

    // Substring match
    return 1;
  }

  static scoreTabs(query: string, tabs: TabInfo[]): TabInfo[] {
    if (!query) return tabs.slice();

    const scored: ScoredEntry[] = [];
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const titleScore = TabSearch.scoreMatch(query, tab.title);
      const urlScore = TabSearch.scoreMatch(query, tab.url);
      const bestScore = Math.max(titleScore, urlScore);
      if (bestScore > 0) {
        scored.push({ tab, score: bestScore, index: i });
      }
    }

    // Sort by score descending, then by original index (recency) ascending
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

    return scored.map(s => s.tab);
  }

  // --- Tab fetching ---

  private async _fetchTabs(): Promise<TabInfo[]> {
    try {
      const response = await browser.runtime.sendMessage({ command: "queryTabs" });
      if (Array.isArray(response)) return response as TabInfo[];
      return [];
    } catch {
      return [];
    }
  }

  // --- UI ---

  private _createOverlay(): void {
    this._overlayEl = document.createElement("div");
    this._overlayEl.className = "vimium-tab-search-overlay";

    const modal = document.createElement("div");
    modal.className = "vimium-tab-search-modal";

    this._inputEl = document.createElement("input");
    this._inputEl.type = "text";
    this._inputEl.placeholder = "Search tabs\u2026";
    this._inputEl.setAttribute("autocomplete", "off");
    this._inputEl.setAttribute("spellcheck", "false");

    this._resultsEl = document.createElement("div");
    this._resultsEl.className = "vimium-tab-search-results";

    modal.appendChild(this._inputEl);
    modal.appendChild(this._resultsEl);
    this._overlayEl.appendChild(modal);
    document.body.appendChild(this._overlayEl);

    this._inputEl.addEventListener("input", this._onInput);
  }

  private _renderResults(): void {
    if (!this._resultsEl) return;

    // Clear existing results
    while (this._resultsEl.firstChild) {
      this._resultsEl.removeChild(this._resultsEl.firstChild);
    }

    if (this._filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "vimium-tab-search-empty";
      empty.textContent = this._inputEl && this._inputEl.value
          ? "No matching tabs" : "No other tabs";
      this._resultsEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < this._filtered.length; i++) {
      const tab = this._filtered[i];
      const item = document.createElement("div");
      item.className = "vimium-tab-search-item";
      if (i === this._selectedIndex) {
        item.className += " selected";
      }

      const title = document.createElement("div");
      title.className = "vimium-tab-search-item-title";
      title.textContent = tab.title || "(Untitled)";

      const url = document.createElement("div");
      url.className = "vimium-tab-search-item-url";
      url.textContent = tab.url || "";

      item.appendChild(title);
      item.appendChild(url);
      this._resultsEl.appendChild(item);
    }
  }

  private _handleInput(): void {
    const query = this._inputEl!.value;
    const nonActive = this._tabs.filter(t => !t.active);
    this._filtered = TabSearch.scoreTabs(query, nonActive);
    this._selectedIndex = 0;
    this._renderResults();
  }

  // --- Keyboard navigation ---

  private _handleKeyDown(event: KeyboardEvent): void {
    if (!this._active) return;

    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.deactivate();
      return;
    }

    if (event.code === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this._switchToSelected();
      return;
    }

    // Down: ArrowDown or Ctrl-j
    if (event.code === "ArrowDown" || (event.ctrlKey && event.code === "KeyJ")) {
      event.preventDefault();
      event.stopPropagation();
      if (this._filtered.length > 0) {
        this._selectedIndex = (this._selectedIndex + 1) % this._filtered.length;
        this._renderResults();
      }
      return;
    }

    // Up: ArrowUp or Ctrl-k
    if (event.code === "ArrowUp" || (event.ctrlKey && event.code === "KeyK")) {
      event.preventDefault();
      event.stopPropagation();
      if (this._filtered.length > 0) {
        this._selectedIndex = (this._selectedIndex - 1 + this._filtered.length) % this._filtered.length;
        this._renderResults();
      }
      return;
    }

    // Let input handle all other keys — don't propagate to KeyHandler
    event.stopPropagation();
  }

  private _switchToSelected(): void {
    if (this._filtered.length === 0) return;
    const tab = this._filtered[this._selectedIndex];
    if (tab && tab.id) {
      browser.runtime.sendMessage({ command: "switchTab", tabId: tab.id });
    }
    this.deactivate();
  }

  // --- Command wiring ---

  private _wireCommands(): void {
    this._keyHandler.on("openTabSearch", () => this.activate());
  }

  destroy(): void {
    this.deactivate();
    this._keyHandler.off("openTabSearch");
  }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).TabSearch = TabSearch;
}
