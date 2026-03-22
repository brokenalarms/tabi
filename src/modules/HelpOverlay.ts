// HelpOverlay — keybinding reference modal for Tabi
// Shows all NORMAL-mode bindings grouped by category in a centered overlay.
// Dismissed on any keypress or mouse click.

import { COMMANDS, PREMIUM_COMMANDS, COMMAND_CATEGORIES, CATEGORY_LABELS } from "../commands";
import type { CommandCategory } from "../commands";
import { PRESETS } from "../keybindings";
import type { KeyBinding } from "../keybindings";
import type { KeyLayout } from "../types";
import { removeOverlay } from "./overlayUtils";
import { isPremiumActive } from "../premium";

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

interface HelpRow {
  display: string;
  label: string;
  category: CommandCategory | undefined;
  premium: boolean;
}

export class HelpOverlay {
  private keyHandler: KeyHandlerLike;
  private active: boolean;
  private overlay: HTMLDivElement | null;
  private layout: KeyLayout;
  private readonly onMouseDown: () => void;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(keyHandler: KeyHandlerLike, layout: KeyLayout = "optimized") {
    this.keyHandler = keyHandler;
    this.active = false;
    this.overlay = null;
    this.layout = layout;
    this.onMouseDown = this.deactivate.bind(this);
    this.onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.deactivate();
    };
    this.keyHandler.on("showHelp", () => this.activate());
  }

  setLayout(layout: KeyLayout): void {
    this.layout = layout;
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

  private buildRows(): HelpRow[] {
    const preset = PRESETS[this.layout];
    const premium = isPremiumActive();
    const rows: HelpRow[] = [];

    for (const binding of preset.bindings) {
      if (binding.command === "showHelp") continue;
      const label = COMMANDS[binding.command] || binding.command;
      const cat = COMMAND_CATEGORIES[binding.command];
      const baseCmd = binding.command.replace(/_.*$/, "");
      rows.push({
        display: binding.display,
        label,
        category: cat,
        premium: premium && PREMIUM_COMMANDS.has(baseCmd),
      });
    }

    // Tab-by-number (not in presets)
    rows.push({ display: "g1\u2013g9", label: "Go to tab by number", category: "tabs", premium: false });
    rows.push({ display: "g0 / g^", label: "First tab", category: "tabs", premium: false });
    rows.push({ display: "g$", label: "Last tab", category: "tabs", premium: false });

    return rows;
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

    const rows = this.buildRows();
    const body = document.createElement("div");
    body.className = "tabi-help-body";

    for (const { cat, label: catLabel } of CATEGORY_LABELS) {
      const catRows = rows.filter((r) => r.category === cat);
      if (catRows.length === 0) continue;

      const section = document.createElement("div");
      section.className = "tabi-help-section";

      const heading = document.createElement("div");
      heading.className = `tabi-help-section-label cat-${cat}`;
      heading.textContent = catLabel;
      section.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "tabi-help-grid";

      for (const row of catRows) {
        HelpOverlay.addRow(grid, row.display, row.label, cat, row.premium);
      }

      section.appendChild(grid);
      body.appendChild(section);
    }

    modal.appendChild(body);

    const hint = document.createElement("p");
    hint.className = "tabi-help-hint";
    hint.textContent = "Press any key to dismiss";
    modal.appendChild(hint);

    this.overlay.appendChild(modal);
    document.body.appendChild(this.overlay);
  }

  private static addRow(
    grid: HTMLElement,
    keyText: string,
    descText: string,
    category: CommandCategory,
    premium: boolean,
  ): void {
    const row = document.createElement("div");
    row.className = "tabi-help-row";
    const keyEl = document.createElement("kbd");
    keyEl.className = `tabi-help-key cat-${category}`;
    keyEl.textContent = keyText;
    const descEl = document.createElement("span");
    descEl.className = "tabi-help-desc";
    descEl.textContent = descText;
    if (premium) {
      const star = document.createElement("span");
      star.className = "tabi-help-premium";
      star.textContent = "\u2726";
      descEl.appendChild(star);
    }
    row.appendChild(keyEl);
    row.appendChild(descEl);
    grid.appendChild(row);
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
