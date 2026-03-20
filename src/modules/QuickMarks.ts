// QuickMarks — Vim-style marks (a-z) that save and restore page positions.
// Each mark stores {url, scrollY, title}. Setting a mark saves the current
// page state; jumping to a mark finds an existing tab or opens a new one
// and restores the scroll position.

import type { ModeValue } from "../types";
import { QUICKMARK_TOAST_DURATION_MS } from "./constants";

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
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

export class QuickMarks {
  private keyHandler: KeyHandlerLike;
  private toastEl: HTMLDivElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(keyHandler: KeyHandlerLike) {
    this.keyHandler = keyHandler;
    this.wireCommands();
  }

  private wireCommands(): void {
    for (const letter of LETTERS) {
      this.keyHandler.on("setMark_" + letter, () => this.setMark(letter));
      this.keyHandler.on("jumpMark_" + letter, () => this.jumpToMark(letter));
    }
  }

  async setMark(letter: string): Promise<void> {
    const mark: Mark = {
      url: window.location.href,
      scrollY: window.scrollY,
      title: document.title,
    };
    const stored = await browser.storage.local.get([STORAGE_KEY]);
    const marks: MarkMap = (stored[STORAGE_KEY] as MarkMap) || {};
    marks[letter] = mark;
    await browser.storage.local.set({ [STORAGE_KEY]: marks });
    this.showToast(`Mark '${letter}' set`);
  }

  async jumpToMark(letter: string): Promise<void> {
    const stored = await browser.storage.local.get([STORAGE_KEY]);
    const marks: MarkMap = (stored[STORAGE_KEY] as MarkMap) || {};
    const mark = marks[letter];
    if (!mark) {
      this.showToast(`Mark '${letter}' not set`);
      return;
    }

    // Ask background to find an existing tab with this URL or open a new one
    const response = await browser.runtime.sendMessage({
      command: "jumpToMark",
      url: mark.url,
      scrollY: mark.scrollY,
    });

    // If we stayed on the same tab (URL matches), restore scroll directly
    const resp = response as { status: string; sameTab?: boolean };
    if (resp.sameTab) {
      window.scrollTo(0, mark.scrollY);
    }
    // If switched to another tab or opened a new one, the content script
    // on that tab will handle scroll restoration via a storage message.

    this.showToast(`Jumped to '${letter}'`);
  }

  private showToast(message: string): void {
    this.dismissToast();

    const el = document.createElement("div");
    el.textContent = message;
    el.setAttribute("data-tabi-toast", "");
    Object.assign(el.style, {
      position: "fixed",
      bottom: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "8px 16px",
      borderRadius: "6px",
      background: "rgba(0, 0, 0, 0.8)",
      color: "#fff",
      fontSize: "14px",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      zIndex: "2147483647",
      pointerEvents: "none",
      transition: "opacity 0.2s",
      opacity: "1",
    });

    document.body.appendChild(el);
    this.toastEl = el;

    this.toastTimer = setTimeout(() => {
      el.style.opacity = "0";
      this.toastTimer = setTimeout(() => {
        this.dismissToast();
      }, 200);
    }, QUICKMARK_TOAST_DURATION_MS);
  }

  private dismissToast(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.toastEl && this.toastEl.parentNode) {
      this.toastEl.parentNode.removeChild(this.toastEl);
      this.toastEl = null;
    }
  }

  destroy(): void {
    this.dismissToast();
    for (const letter of LETTERS) {
      this.keyHandler.off("setMark_" + letter);
      this.keyHandler.off("jumpMark_" + letter);
    }
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
