// HelpOverlay — keybinding reference modal for Tabi
// Shows all NORMAL-mode bindings in a centered overlay.
// Dismissed on any keypress or mouse click.

import { COMMANDS } from "../commands";
import { removeOverlay } from "./overlayUtils";

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  off(command: string): void;
  getBindings(): Map<string, Map<string, string>>;
}

export class HelpOverlay {
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
    this._overlay.className = "tabi-help-overlay";

    const modal = document.createElement("div");
    modal.className = "tabi-help-modal";

    const title = document.createElement("h2");
    title.className = "tabi-help-title";
    title.textContent = "tabi keyboard shortcuts";
    modal.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "tabi-help-grid";

    const bindings = this._keyHandler.getBindings();
    const normalBindings = bindings.get("NORMAL");
    let goToTabDigitShown = false;
    if (normalBindings) {
      for (const [seq, cmd] of normalBindings) {
        // Collapse g1-g9 into a single help row
        if (/^goToTab\d$/.test(cmd)) {
          if (goToTabDigitShown) continue;
          goToTabDigitShown = true;
          HelpOverlay._addRow(grid, "g1\u2013g9", "Go to tab by number");
          continue;
        }
        if (cmd === "goToTabFirst") {
          HelpOverlay._addRow(grid, "g0 / g^", "First tab");
          continue;
        }
        if (cmd === "goToTabLast") {
          HelpOverlay._addRow(grid, "g$", "Last tab");
          continue;
        }

        const label = COMMANDS[cmd] || cmd;
        HelpOverlay._addRow(grid, HelpOverlay._formatSequence(seq), label);
      }
    }

    modal.appendChild(grid);

    const hint = document.createElement("p");
    hint.className = "tabi-help-hint";
    hint.textContent = "Press any key to dismiss";
    modal.appendChild(hint);

    this._overlay.appendChild(modal);
    document.body.appendChild(this._overlay);
  }

  private static _addRow(grid: HTMLElement, keyText: string, descText: string): void {
    const row = document.createElement("div");
    row.className = "tabi-help-row";
    const keyEl = document.createElement("kbd");
    keyEl.className = "tabi-help-key";
    keyEl.textContent = keyText;
    const descEl = document.createElement("span");
    descEl.className = "tabi-help-desc";
    descEl.textContent = descText;
    row.appendChild(keyEl);
    row.appendChild(descEl);
    grid.appendChild(row);
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
    if (this._overlay) removeOverlay(this._overlay);
    this._overlay = null;
  }

  destroy(): void {
    this._deactivate();
    this._keyHandler.off("showHelp");
  }
}
