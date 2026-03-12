// HelpOverlay — keybinding reference modal for Vimium
// Shows all NORMAL-mode bindings in a centered overlay.
// Dismissed on any keypress or mouse click.

import type { ModeValue } from "../types";

declare const COMMANDS: Record<string, string>;

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
    title.textContent = "vimium-mac keyboard shortcuts";
    modal.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "vimium-help-grid";

    const bindings = this._keyHandler.getBindings();
    const normalBindings = bindings.get("NORMAL");
    if (normalBindings) {
      for (const [seq, cmd] of normalBindings) {
        const label = COMMANDS[cmd] || cmd;

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
    return seq.split(" ").map((part) => {
      const modifiers: string[] = [];
      let code = part;
      for (const [prefix, symbol] of [
        ["Shift-", "\u21E7"], ["Ctrl-", "\u2303"],
        ["Alt-", "\u2325"], ["Meta-", "\u2318"],
      ] as const) {
        if (code.startsWith(prefix)) {
          modifiers.push(symbol);
          code = code.slice(prefix.length);
        }
      }
      code = code.replace(/^Key/, "").replace(/^Digit/, "");
      if (code === "Slash") code = "/";
      return modifiers.join("") + code.toLowerCase();
    }).join(" ");
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
