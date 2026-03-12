// HelpOverlay — keybinding reference modal for Vimium
// Shows all NORMAL-mode bindings in a centered overlay.
// Dismissed on any keypress or mouse click.

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
  getBindings(): Map<string, Map<string, string>>;
}

const COMMAND_LABELS: Record<string, string> = {
  scrollDown: "Scroll down",
  scrollUp: "Scroll up",
  scrollLeft: "Scroll left",
  scrollRight: "Scroll right",
  scrollHalfPageDown: "Half page down",
  scrollHalfPageUp: "Half page up",
  scrollToBottom: "Scroll to bottom",
  scrollToTop: "Scroll to top",
  goBack: "Go back",
  goForward: "Go forward",
  pageRefresh: "Refresh page",
  activateHints: "Open link (current tab)",
  activateHintsNewTab: "Open link (new tab)",
  enterFindMode: "Find on page",
  findNext: "Find next",
  findPrev: "Find previous",
  createTab: "New tab",
  closeTab: "Close tab",
  restoreTab: "Restore tab",
  tabLeft: "Move tab left",
  tabRight: "Move tab right",
  tabNext: "Next tab",
  tabPrev: "Previous tab",
  firstTab: "First tab",
  lastTab: "Last tab",
  openTabSearch: "Search tabs",
  focusInput: "Focus first text input",
  goUpUrl: "Go up one URL level",
  showHelp: "Show this help",
};

class HelpOverlay {
  private _keyHandler: KeyHandlerLike;
  private _active: boolean;
  private _overlay: HTMLDivElement | null;
  private readonly _onMouseDown: () => void;
  private readonly _onKeyDown: (event: KeyboardEvent) => void;

  constructor(keyHandler: KeyHandlerLike) {
    this._keyHandler = keyHandler;
    this._active = false;
    this._overlay = null;
    this._onMouseDown = this._deactivate.bind(this);
    this._onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this._deactivate();
    };
    this._keyHandler.on("showHelp", () => this.activate());
  }

  activate(): void {
    if (this._active) {
      this._deactivate();
      return;
    }
    this._active = true;
    this._createOverlay();
    document.addEventListener("keydown", this._onKeyDown, true);
    document.addEventListener("mousedown", this._onMouseDown, true);
  }

  private _createOverlay(): void {
    this._overlay = document.createElement("div") as HTMLDivElement;
    this._overlay.className = "vimium-help-overlay";

    const modal = document.createElement("div");
    modal.className = "vimium-help-modal";

    const title = document.createElement("h2");
    title.className = "vimium-help-title";
    title.textContent = "Vimium Keyboard Shortcuts";
    modal.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "vimium-help-grid";

    const bindings = this._keyHandler.getBindings();
    const normalBindings = bindings.get("NORMAL");
    if (normalBindings) {
      for (const [seq, cmd] of normalBindings) {
        const label = COMMAND_LABELS[cmd] || cmd;

        const row = document.createElement("div");
        row.className = "vimium-help-row";

        const keyEl = document.createElement("kbd");
        keyEl.className = "vimium-help-key";
        keyEl.textContent = HelpOverlay._formatSequence(seq);

        const descEl = document.createElement("span");
        descEl.className = "vimium-help-desc";
        descEl.textContent = label;

        row.appendChild(keyEl);
        row.appendChild(descEl);
        grid.appendChild(row);
      }
    }

    modal.appendChild(grid);

    const hint = document.createElement("p");
    hint.className = "vimium-help-hint";
    hint.textContent = "Press any key to dismiss";
    modal.appendChild(hint);

    this._overlay.appendChild(modal);
    document.body.appendChild(this._overlay);
  }

  static _formatSequence(seq: string): string {
    return seq
      .split(" ")
      .map((part) =>
        part
          .replace(/^Shift-/, "\u21E7")
          .replace(/^Ctrl-/, "\u2303")
          .replace(/^Alt-/, "\u2325")
          .replace(/^Meta-/, "\u2318")
          .replace(/^Key/, "")
          .replace(/^Digit/, "")
          .replace(/^Slash$/, "/"),
      )
      .join(" ");
  }

  private _deactivate(): void {
    if (!this._active) return;
    this._active = false;
    document.removeEventListener("keydown", this._onKeyDown, true);
    document.removeEventListener("mousedown", this._onMouseDown, true);
    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
    this._overlay = null;
  }

  destroy(): void {
    this._deactivate();
    this._keyHandler.off("showHelp");
  }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).HelpOverlay = HelpOverlay;
}
