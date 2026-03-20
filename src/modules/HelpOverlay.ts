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
  private keyHandler: KeyHandlerLike;
  private active: boolean;
  private overlay: HTMLDivElement | null;
  private readonly onMouseDown: () => void;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(keyHandler: KeyHandlerLike) {
    this.keyHandler = keyHandler;
    this.active = false;
    this.overlay = null;
    this.onMouseDown = this.deactivate.bind(this);
    this.onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.deactivate();
    };
    this.keyHandler.on("showHelp", () => this.activate());
  }

  activate(): void {
    if (this.active) {
      this.deactivate();
      return;
    }
    this.active = true;
    this.createOverlay();
    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("mousedown", this.onMouseDown, true);
  }

  private createOverlay(): void {
    this.overlay = document.createElement("div") as HTMLDivElement;
    this.overlay.className = "tabi-overlay";

    const modal = document.createElement("div");
    modal.className = "tabi-panel tabi-help-modal";

    const title = document.createElement("h2");
    title.className = "tabi-help-title";
    title.textContent = "tabi keyboard shortcuts";
    modal.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "tabi-help-grid";

    const bindings = this.keyHandler.getBindings();
    const normalBindings = bindings.get("NORMAL");
    let goToTabDigitShown = false;
    if (normalBindings) {
      for (const [seq, cmd] of normalBindings) {
        // Collapse g1-g9 into a single help row
        if (/^goToTab\d$/.test(cmd)) {
          if (goToTabDigitShown) continue;
          goToTabDigitShown = true;
          HelpOverlay.addRow(grid, "g1\u2013g9", "Go to tab by number");
          continue;
        }
        if (cmd === "goToTabFirst") {
          HelpOverlay.addRow(grid, "g0 / g^", "First tab");
          continue;
        }
        if (cmd === "goToTabLast") {
          HelpOverlay.addRow(grid, "g$", "Last tab");
          continue;
        }

        const label = COMMANDS[cmd] || cmd;
        HelpOverlay.addRow(grid, HelpOverlay.formatSequence(seq), label);
      }
    }

    modal.appendChild(grid);

    const hint = document.createElement("p");
    hint.className = "tabi-help-hint";
    hint.textContent = "Press any key to dismiss";
    modal.appendChild(hint);

    this.overlay.appendChild(modal);
    document.body.appendChild(this.overlay);
  }

  private static addRow(grid: HTMLElement, keyText: string, descText: string): void {
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

  static formatSequence(seq: string): string {
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

  private deactivate(): void {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("mousedown", this.onMouseDown, true);
    if (this.overlay) removeOverlay(this.overlay);
    this.overlay = null;
  }

  destroy(): void {
    this.deactivate();
    this.keyHandler.off("showHelp");
  }
}
