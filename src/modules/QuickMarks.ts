// QuickMarks — Vim-style marks that save and restore page positions.
// Each mark stores {url, scrollY, title, favicon}. Labels are one or two
// characters (a-z). Setting a mark prompts for Enter confirmation so
// two-character labels are possible. Jumping debounces briefly to allow
// a second character before dispatching.
//
// Mark mode enters a proper modal state (MARK mode) that captures all input,
// preventing conflicts with normal-mode commands. A bottom-right status bar
// shows the building key sequence. After a short delay with no input, a
// discovery panel appears listing saved marks with favicons.

import type { ModeValue } from "../types";
import { Mode } from "../commands";
import { MARK_PANEL_DELAY_MS, MARK_CONFIRM_DURATION_MS, MARK_JUMP_DEBOUNCE_MS } from "./constants";
import { removeOverlay } from "./overlayUtils";

export function urlOriginPath(raw: string): string {
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw;
  }
}

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
  favicon?: string;
}

export type MarkMap = Partial<Record<string, Mark>>;

const STORAGE_KEY = "quickMarks";
const SETTINGS_KEY = "quickMarkSettings";

export interface QuickMarkSettings {
  reuseTab: boolean;
}

const DEFAULT_SETTINGS: QuickMarkSettings = { reuseTab: true };

type MarkSubMode = "set" | "jump";

const MODE_LABELS: Record<MarkSubMode, string> = {
  set: "Set Mark:",
  jump: "Jump to Mark:",
};

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
  private labelBuffer: string;
  private jumpDebounceTimer: ReturnType<typeof setTimeout> | null;
  private settings: QuickMarkSettings;

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
    this.labelBuffer = "";
    this.jumpDebounceTimer = null;
    this.settings = DEFAULT_SETTINGS;
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
    this.labelBuffer = "";
    this.clearPanelTimer();
    this.clearJumpDebounce();
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
    this.labelBuffer = "";
    this.prefixKey = subMode === "set" ? this.prefixKeys.set : this.prefixKeys.jump;
    this.keyHandler.setMode(Mode.MARK);
    this.keyHandler.setModeKeyDelegate(this.handleKey.bind(this));

    const stored = await browser.storage.local.get([STORAGE_KEY, SETTINGS_KEY]);
    this.marks = (stored[STORAGE_KEY] as MarkMap) || {};
    this.settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<QuickMarkSettings>) };

    this.createStatusBar();

    this.startPanelTimer();
  }

  // --- Key handling ---

  private handleKey(event: KeyboardEvent): boolean {
    if (!this.active) return false;

    if (event.code === "Escape") return false;

    event.preventDefault();
    event.stopPropagation();

    const key = event.key;

    if (key === "Enter") {
      if (this.subMode === "set" && this.labelBuffer.length > 0) {
        this.executeSetMark(this.labelBuffer);
      }
      return true;
    }

    if (key === "Backspace") {
      if (this.labelBuffer.length > 0) {
        this.labelBuffer = this.labelBuffer.slice(0, -1);
        this.updateStatusBarForInput();
      }
      return true;
    }

    if (key.length === 1 && key >= "a" && key <= "z") {
      this.labelBuffer += key;

      if (this.subMode === "set") {
        this.updateStatusBarForInput();
        if (this.labelBuffer.length >= 2) {
          // At max length — show prompt and wait for Enter
          this.updateStatusBarForInput();
        }
      } else {
        this.handleJumpInput();
      }
      return true;
    }

    return true;
  }

  private updateStatusBarForInput(): void {
    const modeLabel = MODE_LABELS[this.subMode];
    if (this.labelBuffer.length === 0) {
      this.updateStatusBar(modeLabel);
    } else {
      const label = this.labelBuffer;
      const prompt = this.subMode === "set" ? " ⏎ save" : "";
      this.updateStatusBar(`${modeLabel} ${label}${prompt}`);
    }
  }

  private handleJumpInput(): void {
    this.clearJumpDebounce();
    this.updateStatusBarForInput();

    if (this.labelBuffer.length >= 2) {
      this.executeJumpToMark(this.labelBuffer);
      return;
    }

    // Check for exact match — if this single char has a mark, debounce
    // so a second keystroke can override
    this.jumpDebounceTimer = setTimeout(() => {
      this.jumpDebounceTimer = null;
      if (this.active && this.labelBuffer.length > 0) {
        this.executeJumpToMark(this.labelBuffer);
      }
    }, MARK_JUMP_DEBOUNCE_MS);
  }

  private clearJumpDebounce(): void {
    if (this.jumpDebounceTimer !== null) {
      clearTimeout(this.jumpDebounceTimer);
      this.jumpDebounceTimer = null;
    }
  }

  private async executeSetMark(label: string): Promise<void> {
    this.clearPanelTimer();
    await this.setMark(label);
  }

  private async executeJumpToMark(label: string): Promise<void> {
    this.clearPanelTimer();
    this.clearJumpDebounce();
    await this.jumpToMark(label);
  }

  // --- Mark operations ---

  async setMark(label: string): Promise<void> {
    const favicon = this.getCurrentFavicon();
    const mark: Mark = {
      url: window.location.href,
      scrollY: window.scrollY,
      title: document.title,
      ...(favicon ? { favicon } : {}),
    };
    const marks = { ...this.marks, [label]: mark };
    await browser.storage.local.set({ [STORAGE_KEY]: marks });
    this.showConfirmation(label, mark.url, "set");
  }

  async jumpToMark(label: string): Promise<void> {
    const mark = this.marks[label];
    if (!mark) {
      this.showConfirmation(label, null, "notset");
      return;
    }

    this.showConfirmation(label, mark.url, "jump");

    const response = await browser.runtime.sendMessage({
      command: "jumpToMark",
      url: mark.url,
      scrollY: mark.scrollY,
      reuseTab: this.settings.reuseTab,
    });

    const resp = response as { status: string; sameTab?: boolean };
    if (resp.sameTab) {
      window.scrollTo(0, mark.scrollY);
    }
  }

  private getCurrentFavicon(): string | undefined {
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel~="icon"]'
    );
    return link?.href ?? undefined;
  }

  // --- Confirmation display ---

  private showConfirmation(label: string, url: string | null, type: "set" | "jump" | "notset"): void {
    if (this.panelOverlay) {
      removeOverlay(this.panelOverlay);
      this.panelOverlay = null;
    }
    this.active = false;
    this.labelBuffer = "";
    this.clearPanelTimer();
    this.clearJumpDebounce();
    this.keyHandler.clearModeKeyDelegate();
    this.keyHandler.setMode(Mode.NORMAL);

    const bar = this.statusBar;
    if (!bar) return;
    this.statusBar = null;

    bar.textContent = "";
    bar.classList.add("tabi-mode-bar-confirm");

    const keyLine = document.createElement("div");
    keyLine.className = "tabi-confirm-key";
    const modeLabel = MODE_LABELS[this.subMode];
    const suffix = type === "set" ? "saved" : type === "jump" ? "jump" : "not set";
    keyLine.textContent = `${modeLabel} ${label} — ${suffix}`;
    bar.appendChild(keyLine);

    if (url) {
      const urlLine = document.createElement("div");
      urlLine.className = "tabi-confirm-url";
      urlLine.textContent = url;
      bar.appendChild(urlLine);
    }

    bar.addEventListener("transitionend", () => bar.remove(), { once: true });
    // Hold the confirmation visible, then fade
    setTimeout(() => {
      void bar.offsetHeight;
      bar.classList.add("tabi-mode-bar-fade");
    }, MARK_CONFIRM_DURATION_MS);
  }

  // --- Status bar ---

  private createStatusBar(): void {
    this.statusBar = document.createElement("div");
    this.statusBar.className = "tabi-panel tabi-mode-bar tabi-mark-mode-bar";
    this.updateStatusBar(MODE_LABELS[this.subMode]);
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
      ? "Set mark — type label, Enter to save"
      : "Jump to mark — type label";
    modal.appendChild(header);

    const list = document.createElement("div");
    list.className = "tabi-tab-search-results";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tabi-tab-search-empty";
      empty.textContent = "No marks saved";
      list.appendChild(empty);
    } else {
      for (const [label, mark] of entries) {
        const item = document.createElement("div");
        item.className = "tabi-tab-search-item";

        if (mark.favicon) {
          const favicon = document.createElement("img");
          favicon.className = "tabi-tab-search-favicon";
          favicon.src = mark.favicon;
          favicon.width = 16;
          favicon.height = 16;
          favicon.alt = "";
          item.appendChild(favicon);
        }

        const labelEl = document.createElement("span");
        labelEl.className = "tabi-mark-label";
        labelEl.textContent = label;
        item.appendChild(labelEl);

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

export function saveMark(marks: MarkMap, label: string, mark: Mark): MarkMap {
  return { ...marks, [label]: mark };
}

export function getMark(marks: MarkMap, label: string): Mark | undefined {
  return marks[label];
}

export function loadSettings(stored: Record<string, unknown>): QuickMarkSettings {
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<QuickMarkSettings>) };
}
