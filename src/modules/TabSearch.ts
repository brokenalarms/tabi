// TabSearch — modal overlay for fuzzy-searching and switching browser tabs
// Requests tab list from background. Premium users get fzf-style character-
// skipping fuzzy matching with contiguous bonuses; free users get the original
// prefix > word-boundary > substring scorer. Matched characters are highlighted
// with <mark> spans. Favicons are displayed when available.
// Keyboard: Up/Down or Ctrl-j/k to navigate, Enter to switch, Escape or
// Ctrl-x to dismiss.

import type { ModeValue, TabInfo } from "../types";
import { Mode } from "../commands";
import { removeOverlay } from "./overlayUtils";
import { BONUS_PREFIX, BONUS_WORD_BOUNDARY, BONUS_CONTIGUOUS, BASE_CHAR_SCORE } from "./constants";

// Browser API (Safari Web Extension)
declare const browser: {
  runtime: {
    sendMessage(message: { command: string; tabId?: number }): Promise<unknown>;
  };
};

interface KeyHandlerLike {
  setMode(mode: ModeValue): void;
  setModeKeyDelegate(handler: (event: KeyboardEvent) => boolean): void;
  clearModeKeyDelegate(): void;
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

/** Result of fuzzy-matching a query against text. */
export interface FuzzyResult {
  score: number;
  indices: number[];
}

interface ScoredEntry {
  tab: TabInfo;
  score: number;
  index: number;
  titleIndices: number[];
  urlIndices: number[];
}

// --- Fuzzy scoring constants ---
const SCORE_NO_MATCH = -1;
const WORD_SEPARATORS = new Set([" ", "/", ".", "-", "_", ":"]);

/**
 * fzf-style fuzzy scorer. Characters in `query` must appear in `text` in
 * order, but may be separated by arbitrary characters. Scores reward:
 *  - prefix position (first char matches index 0)
 *  - word-boundary alignment (char after a separator)
 *  - contiguous runs of matched characters
 *
 * Returns { score, indices } or { score: -1, indices: [] } on no match.
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult {
  if (!query || !text) return { score: SCORE_NO_MATCH, indices: [] };
  const lq = query.toLowerCase();
  const lt = text.toLowerCase();

  // Quick reject: every query char must exist in text
  let checkPos = 0;
  for (let i = 0; i < lq.length; i++) {
    const found = lt.indexOf(lq[i], checkPos);
    if (found < 0) return { score: SCORE_NO_MATCH, indices: [] };
    checkPos = found + 1;
  }

  // Greedy-forward match collecting indices
  const indices: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < lq.length; qi++) {
    while (ti < lt.length && lt[ti] !== lq[qi]) ti++;
    if (ti >= lt.length) return { score: SCORE_NO_MATCH, indices: [] };
    indices.push(ti);
    ti++;
  }

  // Score the match
  let score = 0;
  for (let i = 0; i < indices.length; i++) {
    const pos = indices[i];
    score += BASE_CHAR_SCORE;
    if (pos === 0) {
      score += BONUS_PREFIX;
    } else if (WORD_SEPARATORS.has(lt[pos - 1])) {
      score += BONUS_WORD_BOUNDARY;
    }
    if (i > 0 && indices[i] === indices[i - 1] + 1) {
      score += BONUS_CONTIGUOUS;
    }
  }

  return { score, indices };
}

/**
 * Original prefix/substring scorer for free-tier users.
 * Returns score (3 prefix, 2 word-boundary, 1 substring, -1 no match)
 * and the contiguous range of matched indices.
 */
export function substringMatch(query: string, text: string): FuzzyResult {
  if (!query || !text) return { score: SCORE_NO_MATCH, indices: [] };
  const lq = query.toLowerCase();
  const lt = text.toLowerCase();
  const idx = lt.indexOf(lq);
  if (idx < 0) return { score: SCORE_NO_MATCH, indices: [] };

  const indices: number[] = [];
  for (let i = idx; i < idx + lq.length; i++) indices.push(i);

  if (idx === 0) return { score: 3, indices };
  if (WORD_SEPARATORS.has(lt[idx - 1])) return { score: 2, indices };
  return { score: 1, indices };
}

export class TabSearch {
  private keyHandler: KeyHandlerLike;
  private active: boolean;
  private overlayEl: HTMLDivElement | null;
  private inputEl: HTMLInputElement | null;
  private resultsEl: HTMLDivElement | null;
  private tabs: TabInfo[];
  private scored: ScoredEntry[];
  private selectedIndex: number;
  private readonly onInputBound: () => void;
  private premium: boolean;
  /** Optional callback fired when a tab switch is executed. */
  onAction: (() => void) | null;

  constructor(keyHandler: KeyHandlerLike, premium = false) {
    this.keyHandler = keyHandler;
    this.active = false;
    this.overlayEl = null;
    this.inputEl = null;
    this.resultsEl = null;
    this.tabs = [];
    this.scored = [];
    this.selectedIndex = 0;
    this.onInputBound = this.handleInput.bind(this);
    this.premium = premium;
    this.onAction = null;
    this.wireCommands();
  }

  setPremium(value: boolean): void {
    this.premium = value;
  }

  // --- Public API ---

  async activate(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.keyHandler.setMode(Mode.TAB_SEARCH);
    this.tabs = await this.fetchTabs();
    const nonActive = this.tabs.filter(t => !t.active);
    this.scored = nonActive.map((tab, i) => ({
      tab, score: 0, index: i, titleIndices: [], urlIndices: [],
    }));
    this.selectedIndex = 0;
    this.createOverlay();
    this.renderResults();
    if (!this.inputEl) return;
    this.inputEl.focus();
    this.keyHandler.setModeKeyDelegate(this.handleKey.bind(this));
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.keyHandler.clearModeKeyDelegate();
    if (this.overlayEl) removeOverlay(this.overlayEl);
    this.overlayEl = null;
    this.inputEl = null;
    this.resultsEl = null;
    this.tabs = [];
    this.scored = [];
    this.selectedIndex = 0;
    this.keyHandler.setMode(Mode.NORMAL);
  }

  isActive(): boolean {
    return this.active;
  }

  // --- Backward-compatible static methods ---

  static scoreMatch(query: string, text: string): number {
    return substringMatch(query, text).score;
  }

  static scoreTabs(query: string, tabs: TabInfo[]): TabInfo[] {
    if (!query) return tabs.slice();
    const entries: ScoredEntry[] = [];
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const titleResult = substringMatch(query, tab.title);
      const urlResult = substringMatch(query, tab.url);
      const bestScore = Math.max(titleResult.score, urlResult.score);
      if (bestScore > 0) {
        entries.push({
          tab, score: bestScore, index: i,
          titleIndices: titleResult.score >= urlResult.score ? titleResult.indices : [],
          urlIndices: urlResult.score > titleResult.score ? urlResult.indices : [],
        });
      }
    }
    entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
    return entries.map(s => s.tab);
  }

  // --- Internal scoring ---

  private scoreTabsInternal(query: string, tabs: TabInfo[]): ScoredEntry[] {
    if (!query) {
      return tabs.map((tab, i) => ({
        tab, score: 0, index: i, titleIndices: [], urlIndices: [],
      }));
    }

    const matchFn = this.premium ? fuzzyMatch : substringMatch;
    const entries: ScoredEntry[] = [];
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const titleResult = matchFn(query, tab.title);
      const urlResult = matchFn(query, tab.url);
      const bestScore = Math.max(titleResult.score, urlResult.score);
      if (bestScore > 0) {
        entries.push({
          tab, score: bestScore, index: i,
          titleIndices: titleResult.score >= urlResult.score ? titleResult.indices : [],
          urlIndices: urlResult.score > titleResult.score ? urlResult.indices : [],
        });
      }
    }
    entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });
    return entries;
  }

  // --- Tab fetching ---

  private async fetchTabs(): Promise<TabInfo[]> {
    try {
      const response = await browser.runtime.sendMessage({ command: "queryTabs" });
      if (Array.isArray(response)) return response as TabInfo[];
      return [];
    } catch {
      return [];
    }
  }

  // --- UI ---

  private createOverlay(): void {
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "tabi-overlay";

    const modal = document.createElement("div");
    modal.className = "tabi-panel tabi-tab-search-modal";

    const inputWrap = document.createElement("div");
    inputWrap.className = "tabi-tab-search-input-wrap";

    this.inputEl = document.createElement("input");
    this.inputEl.type = "text";
    this.inputEl.placeholder = "Search tabs\u2026";
    this.inputEl.setAttribute("autocomplete", "off");
    this.inputEl.setAttribute("spellcheck", "false");
    inputWrap.appendChild(this.inputEl);

    if (this.premium) {
      const star = document.createElement("span");
      star.className = "tabi-tab-search-premium";
      star.textContent = "\u2726";
      inputWrap.appendChild(star);
    }

    this.resultsEl = document.createElement("div");
    this.resultsEl.className = "tabi-tab-search-results";

    modal.appendChild(inputWrap);
    modal.appendChild(this.resultsEl);
    this.overlayEl.appendChild(modal);
    document.body.appendChild(this.overlayEl);

    this.inputEl.addEventListener("input", this.onInputBound);

    this.overlayEl.addEventListener("click", (e) => {
      if (e.target === this.overlayEl) this.deactivate();
    });

    this.resultsEl.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest(".tabi-tab-search-item");
      if (!item) return;
      const items = Array.from(this.resultsEl!.children);
      const index = items.indexOf(item);
      if (index < 0) return;
      this.selectedIndex = index;
      this.switchToSelected();
    });

    this.resultsEl.addEventListener("mousemove", (e) => {
      const item = (e.target as HTMLElement).closest(".tabi-tab-search-item");
      if (!item) return;
      const items = Array.from(this.resultsEl!.children);
      const index = items.indexOf(item);
      if (index < 0 || index === this.selectedIndex) return;
      const old = this.selectedIndex;
      this.selectedIndex = index;
      this.updateSelection(old);
    });
  }

  /** Build a text node / <mark> sequence for highlighted text. */
  private static highlightText(text: string, indices: number[], container: HTMLElement): void {
    if (indices.length === 0) {
      container.textContent = text;
      return;
    }

    const indexSet = new Set(indices);
    let run = "";
    let inMark = false;

    for (let i = 0; i < text.length; i++) {
      const shouldMark = indexSet.has(i);
      if (shouldMark !== inMark) {
        // Flush previous run
        if (run) {
          if (inMark) {
            const mark = document.createElement("mark");
            mark.textContent = run;
            container.appendChild(mark);
          } else {
            container.appendChild(document.createTextNode(run));
          }
          run = "";
        }
        inMark = shouldMark;
      }
      run += text[i];
    }
    // Flush remaining
    if (run) {
      if (inMark) {
        const mark = document.createElement("mark");
        mark.textContent = run;
        container.appendChild(mark);
      } else {
        container.appendChild(document.createTextNode(run));
      }
    }
  }

  private updateSelection(oldIndex: number): void {
    if (!this.resultsEl) return;
    const items = this.resultsEl.children;
    if (oldIndex >= 0 && oldIndex < items.length) {
      items[oldIndex].classList.remove("selected");
    }
    if (this.selectedIndex >= 0 && this.selectedIndex < items.length) {
      const next = items[this.selectedIndex] as HTMLElement;
      next.classList.add("selected");
      next.scrollIntoView({ block: "nearest" });
    }
  }

  private renderResults(): void {
    if (!this.resultsEl) return;

    while (this.resultsEl.firstChild) {
      this.resultsEl.removeChild(this.resultsEl.firstChild);
    }

    if (this.scored.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tabi-tab-search-empty";
      empty.textContent = this.inputEl && this.inputEl.value
          ? "No matching tabs" : "No other tabs";
      this.resultsEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < this.scored.length; i++) {
      const entry = this.scored[i];
      const tab = entry.tab;
      const item = document.createElement("div");
      item.className = "tabi-tab-search-item";
      if (i === this.selectedIndex) {
        item.className += " selected";
      }

      // Favicon
      if (tab.favIconUrl) {
        const favicon = document.createElement("img");
        favicon.className = "tabi-tab-search-favicon";
        favicon.src = tab.favIconUrl;
        favicon.width = 16;
        favicon.height = 16;
        favicon.alt = "";
        item.appendChild(favicon);
      }

      const textWrap = document.createElement("div");
      textWrap.className = "tabi-tab-search-text";

      const title = document.createElement("div");
      title.className = "tabi-tab-search-item-title";
      TabSearch.highlightText(tab.title || "(Untitled)", entry.titleIndices, title);

      const url = document.createElement("div");
      url.className = "tabi-tab-search-item-url";
      TabSearch.highlightText(tab.url || "", entry.urlIndices, url);

      textWrap.appendChild(title);
      textWrap.appendChild(url);
      item.appendChild(textWrap);
      this.resultsEl.appendChild(item);
    }
  }

  private handleInput(): void {
    if (!this.inputEl) return;
    const query = this.inputEl.value;
    const nonActive = this.tabs.filter(t => !t.active);
    this.scored = this.scoreTabsInternal(query, nonActive);
    this.selectedIndex = 0;
    this.renderResults();
  }

  // --- Keyboard navigation (called via KeyHandler delegate) ---

  private handleKey(event: KeyboardEvent): boolean {
    if (!this.active) return false;

    // Let Escape fall through to KeyHandler's exitToNormal dispatch
    if (event.code === "Escape") return false;

    // Ctrl-x dismisses the search
    if (event.ctrlKey && event.code === "KeyX") {
      event.preventDefault();
      event.stopPropagation();
      this.deactivate();
      return true;
    }

    if (event.code === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      this.switchToSelected();
      return true;
    }

    // Down: ArrowDown or Ctrl-j
    if (event.code === "ArrowDown" || (event.ctrlKey && event.code === "KeyJ")) {
      event.preventDefault();
      event.stopPropagation();
      if (this.scored.length > 0) {
        const old = this.selectedIndex;
        this.selectedIndex = (this.selectedIndex + 1) % this.scored.length;
        this.updateSelection(old);
      }
      return true;
    }

    // Up: ArrowUp or Ctrl-k
    if (event.code === "ArrowUp" || (event.ctrlKey && event.code === "KeyK")) {
      event.preventDefault();
      event.stopPropagation();
      if (this.scored.length > 0) {
        const old = this.selectedIndex;
        this.selectedIndex = (this.selectedIndex - 1 + this.scored.length) % this.scored.length;
        this.updateSelection(old);
      }
      return true;
    }

    // Let input handle all other keys — stop propagation but not default so keys reach input
    event.stopPropagation();
    return true;
  }

  private switchToSelected(): void {
    if (this.scored.length === 0) return;
    const entry = this.scored[this.selectedIndex];
    if (entry && entry.tab.id) {
      browser.runtime.sendMessage({ command: "switchTab", tabId: entry.tab.id });
      this.onAction?.();
    }
    this.deactivate();
  }

  // --- Command wiring ---

  private wireCommands(): void {
    this.keyHandler.on("openTabSearch", () => this.activate());
  }

  destroy(): void {
    this.deactivate();
    this.keyHandler.off("openTabSearch");
  }
}
