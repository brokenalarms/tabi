// KeyHandler — mode-aware keyboard event router for Vimium
// Uses event.code for positional key bindings (layout-independent).

import type { KeyBindingMode, ModeValue } from "../types";

const Mode = {
  NORMAL: "NORMAL",
  INSERT: "INSERT",
  HINTS: "HINTS",
  FIND: "FIND",
  TAB_SEARCH: "TAB_SEARCH",
} as const;

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox", "radio", "submit", "button", "reset", "file", "image", "color", "range",
]);
const KEY_TIMEOUT_MS = 500;

type ModeListener = (newMode: ModeValue, prevMode: ModeValue) => void;

class KeyHandler {
  mode: ModeValue;
  private _keyBindingMode: KeyBindingMode;
  private _keyBuffer: string;
  private _keyTimer: ReturnType<typeof setTimeout> | null;
  private _bindings: Map<string, Map<string, string>>;
  private _commands: Map<string, () => void>;
  private _prefixes: Map<string, Set<string>>;
  private _modeListeners: ModeListener[];

  private readonly _onKeyDown: (event: KeyboardEvent) => void;
  private readonly _onFocusIn: (event: FocusEvent) => void;
  private readonly _onFocusOut: (event: FocusEvent) => void;

  constructor() {
    this.mode = Mode.NORMAL;
    this._keyBindingMode = "location";
    this._keyBuffer = "";
    this._keyTimer = null;
    this._bindings = new Map();
    this._commands = new Map();
    this._prefixes = new Map();
    this._modeListeners = [];

    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onFocusIn = this._handleFocusIn.bind(this);
    this._onFocusOut = this._handleFocusOut.bind(this);

    this._initDefaultBindings();
    this._attach();
  }

  // --- Public API ---

  getMode(): ModeValue {
    return this.mode;
  }

  setMode(newMode: ModeValue): void {
    if (newMode === this.mode) return;
    const prev = this.mode;
    this.mode = newMode;
    this._resetBuffer();
    for (const fn of this._modeListeners) fn(newMode, prev);
  }

  onModeChange(fn: ModeListener): void {
    this._modeListeners.push(fn);
  }

  setKeyBindingMode(mode: KeyBindingMode): void {
    this._keyBindingMode = mode;
  }

  on(commandName: string, callback: () => void): void {
    this._commands.set(commandName, callback);
  }

  off(commandName: string): void {
    this._commands.delete(commandName);
  }

  destroy(): void {
    this._detach();
    this._resetBuffer();
    this._commands.clear();
    this._bindings.clear();
    this._prefixes.clear();
    this._modeListeners.length = 0;
  }

  // --- Binding registration ---

  bind(mode: ModeValue, sequence: string, commandName: string): void {
    if (!this._bindings.has(mode)) {
      this._bindings.set(mode, new Map());
      this._prefixes.set(mode, new Set());
    }
    this._bindings.get(mode)!.set(sequence, commandName);
    this._rebuildPrefixes(mode);
  }

  // --- Key normalization ---

  static normalizeKey(event: KeyboardEvent, keyBindingMode: KeyBindingMode = "location"): string {
    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.metaKey) parts.push("Meta");

    let code: string;
    if (keyBindingMode === "character") {
      const key = event.key;
      if (key.length === 1 && key >= "a" && key <= "z") {
        if (event.shiftKey) parts.push("Shift");
        code = "Key" + key.toUpperCase();
      } else if (key.length === 1 && key >= "A" && key <= "Z") {
        if (event.shiftKey) parts.push("Shift");
        code = "Key" + key;
      } else if (key.length === 1 && key >= "0" && key <= "9") {
        if (event.shiftKey) parts.push("Shift");
        code = "Digit" + key;
      } else {
        // Symbols, special keys: use event.code directly
        if (event.shiftKey) parts.push("Shift");
        code = event.code;
      }
    } else {
      if (event.shiftKey) parts.push("Shift");
      code = event.code;
    }

    parts.push(code);
    return parts.join("-");
  }

  // --- Internals ---

  private _initDefaultBindings(): void {
    const n = Mode.NORMAL;

    // Scrolling
    this.bind(n, "KeyJ", "scrollDown");
    this.bind(n, "KeyK", "scrollUp");
    this.bind(n, "KeyH", "scrollLeft");
    this.bind(n, "KeyL", "scrollRight");
    this.bind(n, "KeyD", "scrollHalfPageDown");
    this.bind(n, "KeyU", "scrollHalfPageUp");
    this.bind(n, "Shift-KeyG", "scrollToBottom");
    this.bind(n, "KeyG KeyG", "scrollToTop");

    // History
    this.bind(n, "Shift-KeyH", "goBack");
    this.bind(n, "Shift-KeyL", "goForward");

    // Hints
    this.bind(n, "KeyF", "activateHints");
    this.bind(n, "Shift-KeyF", "activateHintsNewTab");

    // Find
    this.bind(n, "Slash", "enterFindMode");
    this.bind(n, "KeyN", "findNext");
    this.bind(n, "Shift-KeyN", "findPrev");

    // Tabs
    this.bind(n, "KeyT", "createTab");
    this.bind(n, "KeyX", "closeTab");
    this.bind(n, "Shift-KeyX", "restoreTab");
    this.bind(n, "Shift-KeyJ", "tabLeft");
    this.bind(n, "Shift-KeyK", "tabRight");
    this.bind(n, "KeyG KeyT", "tabNext");
    this.bind(n, "KeyG Shift-KeyT", "tabPrev");
    this.bind(n, "KeyG Digit0", "firstTab");
    this.bind(n, "KeyG Shift-Digit4", "lastTab");

    // Tab search
    this.bind(n, "Shift-KeyT", "openTabSearch");

    // Mode escape — works in all non-NORMAL modes
    for (const mode of [Mode.INSERT, Mode.HINTS, Mode.FIND, Mode.TAB_SEARCH]) {
      this.bind(mode, "Escape", "exitToNormal");
    }
  }

  private _rebuildPrefixes(mode: ModeValue): void {
    const prefixSet = new Set<string>();
    const modeBindings = this._bindings.get(mode);
    if (!modeBindings) return;
    for (const seq of modeBindings.keys()) {
      const parts = seq.split(" ");
      for (let i = 1; i < parts.length; i++) {
        prefixSet.add(parts.slice(0, i).join(" "));
      }
    }
    this._prefixes.set(mode, prefixSet);
  }

  private _attach(): void {
    document.addEventListener("keydown", this._onKeyDown, true);
    document.addEventListener("focusin", this._onFocusIn, true);
    document.addEventListener("focusout", this._onFocusOut, true);
  }

  private _detach(): void {
    document.removeEventListener("keydown", this._onKeyDown, true);
    document.removeEventListener("focusin", this._onFocusIn, true);
    document.removeEventListener("focusout", this._onFocusOut, true);
  }

  private _handleFocusIn(event: FocusEvent): void {
    if (this._isInputField(event.target as Element) && this.mode === Mode.NORMAL) {
      this.setMode(Mode.INSERT);
    }
  }

  private _handleFocusOut(event: FocusEvent): void {
    if (this._isInputField(event.target as Element) && this.mode === Mode.INSERT) {
      this.setMode(Mode.NORMAL);
    }
  }

  private _isInputField(el: Element | null): boolean {
    if (!el || !el.tagName) return false;
    if (INPUT_TAGS.has(el.tagName)) {
      if (el.tagName === "INPUT") {
        const type = ((el as HTMLInputElement).type || "text").toLowerCase();
        return !NON_TEXT_INPUT_TYPES.has(type);
      }
      return true;
    }
    return (el as HTMLElement).isContentEditable;
  }

  private _handleKeyDown(event: KeyboardEvent): void {
    // Ignore modifier-only keypresses
    if (["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
         "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(event.code)) {
      return;
    }

    // In non-NORMAL modes, only handle Escape — other keys are consumed
    // by the mode's own UI (input fields, hint filter, find bar)
    if (this.mode !== Mode.NORMAL) {
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this._dispatch("exitToNormal");
      }
      return;
    }

    // NORMAL mode key processing
    const key = KeyHandler.normalizeKey(event, this._keyBindingMode);
    const candidate = this._keyBuffer ? this._keyBuffer + " " + key : key;

    const modeBindings = this._bindings.get(this.mode);
    const modePrefixes = this._prefixes.get(this.mode);

    if (modeBindings && modeBindings.has(candidate)) {
      event.preventDefault();
      event.stopPropagation();
      this._resetBuffer();
      this._dispatch(modeBindings.get(candidate)!);
      return;
    }

    if (modePrefixes && modePrefixes.has(candidate)) {
      event.preventDefault();
      event.stopPropagation();
      this._keyBuffer = candidate;
      this._startTimeout();
      return;
    }

    // No match — if we had a partial buffer, discard it
    if (this._keyBuffer) {
      this._resetBuffer();
      // Don't suppress the key — let it through
      return;
    }

    // Single key with no binding — ignore (let browser handle)
  }

  private _startTimeout(): void {
    clearTimeout(this._keyTimer!);
    this._keyTimer = setTimeout(() => {
      this._keyBuffer = "";
      this._keyTimer = null;
    }, KEY_TIMEOUT_MS);
  }

  private _resetBuffer(): void {
    this._keyBuffer = "";
    if (this._keyTimer) {
      clearTimeout(this._keyTimer);
      this._keyTimer = null;
    }
  }

  private _dispatch(commandName: string): void {
    const handler = this._commands.get(commandName);
    if (handler) {
      handler();
    }
  }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).Mode = Mode;
  (globalThis as Record<string, unknown>).KeyHandler = KeyHandler;
}
