// QuickMarks — Vim-style marks (a-z) that save and restore page positions.
// Each mark stores {url, scrollY, title}. Setting a mark saves the current
// page state; jumping to a mark finds an existing tab or opens a new one
// and restores the scroll position.
//
// Mark mode enters a proper modal state (MARK mode) that captures all input,
// preventing conflicts with normal-mode commands. A bottom-right status bar
// shows the building key sequence. After a short delay with no input, a
// discovery panel appears listing saved marks.

import type { ModeValue } from "../types";
import { Mode } from "../commands";
import { MARK_PANEL_DELAY_MS } from "./constants";
import { removeOverlay } from "./overlayUtils";

export function summarizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname.replace(/\/$/, "");
  if (!path || path === "/") return host;

  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (segments.length <= 1) return `${host}/${last}`;
  return `${host}/\u2026/${last}`;
}

declare const browser: {
  runtime: {
    sendMessage(message: Record<string, unknown>): Promise<unknown>;
  };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

export interface Mark {
  url: string;
  scrollY: number;
  title: string;
}

export type MarkMap = Partial<Record<string, Mark>>;

const STORAGE_KEY = "quickMarks";

type MarkSubMode = "set" | "jump";

interface KeyHandlerLike {
  setMode(mode: ModeValue): void;
  setModeKeyDelegate(handler: (event: KeyboardEvent) => boolean): void;
  clearModeKeyDelegate(): void;
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

export class QuickMarks {
  private keyHandler: KeyHandlerLike;
  private active: boolean;
  private subMode: MarkSubMode;
  private prefixKey: string;
  private statusBar: HTMLDivElement | null;
  private panelOverlay: HTMLDivElement | null;
  private panelTimer: ReturnType<typeof setTimeout> | null;
  private marks: MarkMap;

  constructor(keyHandler: KeyHandlerLike, prefixKey: { set: string; jump: string } = { set: "m", jump: "'" }) {
    this.keyHandler = keyHandler;
    this.active = false;
    this.subMode = "set";
    this.prefixKey = prefixKey.set;
    this.statusBar = null;
    this.panelOverlay = null;
    this.panelTimer = null;
    this.marks = {};
    this.prefixKeys = prefixKey;
    this.wireCommands();
  }

  private prefixKeys: { set: string; jump: string };

  // --- Public API ---

  isActive(): boolean {
    return this.active;
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.clearPanelTimer();
    this.keyHandler.clearModeKeyDelegate();
    if (this.statusBar) {
      this.statusBar.remove();
      this.statusBar = null;
    }
    if (this.panelOverlay) {
      removeOverlay(this.panelOverlay);
      this.panelOverlay = null;
    }
    this.keyHandler.setMode(Mode.NORMAL);
  }

  destroy(): void {
    this.deactivate();
    this.keyHandler.off("setMark");
    this.keyHandler.off("jumpMark");
  }

  // --- Activation ---

  private async activate(subMode: MarkSubMode): Promise<void> {
    if (this.active) {
      this.deactivate();
      return;
    }
    this.active = true;
    this.subMode = subMode;
    this.prefixKey = subMode === "set" ? this.prefixKeys.set : this.prefixKeys.jump;
    this.keyHandler.setMode(Mode.MARK);

    this.marks = await this.loadMarksFromStorage();

    this.createStatusBar();
    this.keyHandler.setModeKeyDelegate(this.handleKey.bind(this));
    this.startPanelTimer();
  }

  // --- Key handling ---

  private handleKey(event: KeyboardEvent): boolean {
    if (!this.active) return false;

    // Let Escape fall through to KeyHandler's exitToNormal
    if (event.code === "Escape") return false;

    event.preventDefault();
    event.stopPropagation();

    // Accept a-z letters only
    const key = event.key;
    if (key.length === 1 && key >= "a" && key <= "z") {
      this.executeMark(key);
      return true;
    }

    // Reject non-letter input but stay in mode
    return true;
  }

  private async executeMark(letter: string): Promise<void> {
    this.clearPanelTimer();

    if (this.subMode === "set") {
      await this.setMark(letter);
    } else {
      await this.jumpToMark(letter);
    }
  }

  // --- Mark operations ---

  async setMark(letter: string): Promise<void> {
    const mark: Mark = {
      url: window.location.href,
      scrollY: window.scrollY,
      title: document.title,
    };
    const marks = { ...this.marks, [letter]: mark };
    await browser.storage.local.set({ [STORAGE_KEY]: marks });
    const summary = summarizeUrl(mark.url);
    this.updateStatusBar(`${this.prefixKey}${letter} → ${summary}`);
    this.deactivateAfterConfirmation();
  }

  async jumpToMark(letter: string): Promise<void> {
    const mark = this.marks[letter];
    if (!mark) {
      this.updateStatusBar(`${this.prefixKey}${letter} — not set`);
      this.deactivateAfterConfirmation();
      return;
    }

    const summary = summarizeUrl(mark.url);
    this.updateStatusBar(`${this.prefixKey}${letter} → ${summary}`);

    const response = await browser.runtime.sendMessage({
      command: "jumpToMark",
      url: mark.url,
      scrollY: mark.scrollY,
    });

    const resp = response as { status: string; sameTab?: boolean };
    if (resp.sameTab) {
      window.scrollTo(0, mark.scrollY);
    }

    this.deactivateAfterConfirmation();
  }

  // --- Storage ---

  private async loadMarksFromStorage(): Promise<MarkMap> {
    const stored = await browser.storage.local.get([STORAGE_KEY]);
    return (stored[STORAGE_KEY] as MarkMap) || {};
  }

  // --- Status bar ---

  private createStatusBar(): void {
    this.statusBar = document.createElement("div");
    this.statusBar.className = "tabi-panel tabi-mode-bar tabi-mark-mode-bar";
    this.updateStatusBar(this.prefixKey);
    document.documentElement.appendChild(this.statusBar);
  }

  private updateStatusBar(text: string): void {
    if (!this.statusBar) return;
    this.statusBar.textContent = text;
  }

  // --- Discovery panel ---

  private startPanelTimer(): void {
    this.clearPanelTimer();
    this.panelTimer = setTimeout(() => {
      this.panelTimer = null;
      this.showPanel();
    }, MARK_PANEL_DELAY_MS);
  }

  private clearPanelTimer(): void {
    if (this.panelTimer !== null) {
      clearTimeout(this.panelTimer);
      this.panelTimer = null;
    }
  }

  private showPanel(): void {
    if (!this.active) return;

    const entries = Object.entries(this.marks)
      .filter((pair): pair is [string, Mark] => pair[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));

    this.panelOverlay = document.createElement("div");
    this.panelOverlay.className = "tabi-overlay";

    const modal = document.createElement("div");
    modal.className = "tabi-panel tabi-tab-search-modal tabi-mark-panel";

    const header = document.createElement("div");
    header.className = "tabi-mark-panel-header";
    header.textContent = this.subMode === "set"
      ? "Set mark (a-z)"
      : "Jump to mark (a-z)";
    modal.appendChild(header);

    const list = document.createElement("div");
    list.className = "tabi-tab-search-results";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tabi-tab-search-empty";
      empty.textContent = "No marks saved";
      list.appendChild(empty);
    } else {
      for (const [letter, mark] of entries) {
        const item = document.createElement("div");
        item.className = "tabi-tab-search-item";

        const label = document.createElement("span");
        label.className = "tabi-mark-label";
        label.textContent = letter;
        item.appendChild(label);

        const textWrap = document.createElement("div");
        textWrap.className = "tabi-tab-search-text";

        const title = document.createElement("div");
        title.className = "tabi-tab-search-item-title";
        title.textContent = mark.title || "(Untitled)";

        const url = document.createElement("div");
        url.className = "tabi-tab-search-item-url";
        url.textContent = summarizeUrl(mark.url);

        textWrap.appendChild(title);
        textWrap.appendChild(url);
        item.appendChild(textWrap);
        list.appendChild(item);
      }
    }

    modal.appendChild(list);
    this.panelOverlay.appendChild(modal);
    document.body.appendChild(this.panelOverlay);
  }

  // --- Deactivation with brief confirmation display ---

  private deactivateAfterConfirmation(): void {
    // Remove panel immediately but keep status bar briefly for confirmation
    if (this.panelOverlay) {
      removeOverlay(this.panelOverlay);
      this.panelOverlay = null;
    }
    // Mark as inactive so key delegate stops processing
    this.active = false;
    this.clearPanelTimer();
    this.keyHandler.clearModeKeyDelegate();
    this.keyHandler.setMode(Mode.NORMAL);

    // Fade out the status bar after a brief display
    const bar = this.statusBar;
    if (bar) {
      this.statusBar = null;
      bar.addEventListener("transitionend", () => bar.remove(), { once: true });
      // Trigger reflow before adding the fade class
      void bar.offsetHeight;
      bar.classList.add("tabi-mode-bar-fade");
    }
  }

  // --- Command wiring ---

  private wireCommands(): void {
    this.keyHandler.on("setMark", () => this.activate("set"));
    this.keyHandler.on("jumpMark", () => this.activate("jump"));
  }
}

// --- Pure helpers for storage logic (testable without browser APIs) ---

export function loadMarks(stored: Record<string, unknown>): MarkMap {
  return (stored[STORAGE_KEY] as MarkMap) || {};
}

export function saveMark(marks: MarkMap, letter: string, mark: Mark): MarkMap {
  return { ...marks, [letter]: mark };
}

export function getMark(marks: MarkMap, letter: string): Mark | undefined {
  return marks[letter];
}
