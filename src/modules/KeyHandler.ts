// KeyHandler — mode-aware keyboard event router for Vimium
// Uses event.code for positional key bindings (layout-independent).

import type { KeyBindingMode, ModeValue } from "../types";
import { Mode, COMMANDS } from "../commands";

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox", "radio", "submit", "button", "reset", "file", "image", "color", "range",
]);
const KEY_TIMEOUT_MS = 500;

// Map typed characters to canonical US QWERTY event.code names.
// In character mode this lets symbol bindings work on any keyboard layout.
const KEY_CHAR_TO_CODE: Record<string, string> = {
  "/": "Slash", "?": "Slash",
  "\\": "Backslash", "|": "Backslash",
  ".": "Period", ">": "Period",
  ",": "Comma", "<": "Comma",
  ";": "Semicolon", ":": "Semicolon",
  "'": "Quote", "\"": "Quote",
  "[": "BracketLeft", "{": "BracketLeft",
  "]": "BracketRight", "}": "BracketRight",
  "`": "Backquote", "~": "Backquote",
  "-": "Minus", "_": "Minus",
  "=": "Equal", "+": "Equal",
  "!": "Digit1", "@": "Digit2", "#": "Digit3", "$": "Digit4",
  "%": "Digit5", "^": "Digit6", "&": "Digit7", "*": "Digit8",
  "(": "Digit9", ")": "Digit0",
};

type ModeListener = (newMode: ModeValue, prevMode: ModeValue) => void;

export class KeyHandler {
  mode: ModeValue;
  private _keyBindingMode: KeyBindingMode;
  private _keyBuffer: string;
  private _keyTimer: ReturnType<typeof setTimeout> | null;
  private _bindings: Map<string, Map<string, string>>;
  private _commands: Map<string, () => void>;
  private _keyUpCommands: Map<string, () => void>;
  private _prefixes: Map<string, Set<string>>;
  private _modeListeners: ModeListener[];
  private _modeKeyDelegate: ((event: KeyboardEvent) => boolean) | null;
  private _heldCommand: string | null;
  private _heldCode: string | null;

  private readonly _onKeyDown: (event: KeyboardEvent) => void;
  private readonly _onKeyUp: (event: KeyboardEvent) => void;
  private readonly _onFocusIn: (event: FocusEvent) => void;
  private readonly _onFocusOut: (event: FocusEvent) => void;

  constructor() {
    this.mode = Mode.NORMAL;
    this._keyBindingMode = "location";
    this._keyBuffer = "";
    this._keyTimer = null;
    this._bindings = new Map();
    this._commands = new Map();
    this._keyUpCommands = new Map();
    this._prefixes = new Map();
    this._modeListeners = [];
    this._modeKeyDelegate = null;
    this._heldCommand = null;
    this._heldCode = null;

    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
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
    this._resetBuffer();
  }

  setModeKeyDelegate(handler: (event: KeyboardEvent) => boolean): void {
    this._modeKeyDelegate = handler;
  }

  clearModeKeyDelegate(): void {
    this._modeKeyDelegate = null;
  }

  on(commandName: string, callback: () => void): void {
    this._commands.set(commandName, callback);
  }

  off(commandName: string): void {
    this._commands.delete(commandName);
    this._keyUpCommands.delete(commandName);
  }

  onKeyUp(commandName: string, callback: () => void): void {
    this._keyUpCommands.set(commandName, callback);
  }

  resetBuffer(): void {
    this._resetBuffer();
  }

  getBindings(): Map<string, Map<string, string>> {
    return this._bindings;
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
    const modeMap = this._bindings.get(mode);
    if (modeMap) modeMap.set(sequence, commandName);
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
        // Symbols and special keys: map typed character to canonical code
        // so bindings work regardless of physical keyboard layout
        if (event.shiftKey) parts.push("Shift");
        code = (key.length === 1 && KEY_CHAR_TO_CODE[key]) || event.code;
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
    const _bind = (mode: ModeValue, seq: string, cmd: string) => {
      if (!(cmd in COMMANDS)) {
        console.warn(`[Vimium] Unknown command "${cmd}" — not in COMMANDS`);
      }
      this.bind(mode, seq, cmd);
    };

    // Scrolling
    _bind(n, "KeyJ", "scrollDown");
    _bind(n, "KeyK", "scrollUp");
    _bind(n, "KeyH", "scrollLeft");
    _bind(n, "KeyL", "scrollRight");
    _bind(n, "KeyD", "scrollHalfPageDown");
    _bind(n, "KeyU", "scrollHalfPageUp");
    _bind(n, "Shift-KeyG", "scrollToBottom");
    _bind(n, "KeyG KeyG", "scrollToTop");

    // History / navigation
    _bind(n, "Shift-KeyH", "goBack");
    _bind(n, "Shift-KeyL", "goForward");
    _bind(n, "KeyR", "pageRefresh");

    // Hints
    _bind(n, "KeyF", "activateHints");
    _bind(n, "Shift-KeyF", "activateHintsNewTab");

    // Tabs
    _bind(n, "KeyT", "createTab");
    _bind(n, "KeyX", "closeTab");
    _bind(n, "Shift-KeyX", "restoreTab");
    _bind(n, "Shift-KeyJ", "tabLeft");
    _bind(n, "Shift-KeyK", "tabRight");
    _bind(n, "KeyG KeyT", "tabNext");
    _bind(n, "KeyG Shift-KeyT", "tabPrev");
    for (let i = 1; i <= 9; i++) {
      this.bind(n, "KeyG Digit" + i, "goToTab" + i);
    }
    this.bind(n, "KeyG Shift-Digit6", "goToTabFirst");   // g^
    this.bind(n, "KeyG Digit0", "goToTabFirst");          // g0
    this.bind(n, "KeyG Shift-Digit4", "goToTabLast");     // g$

    // Tab search
    _bind(n, "Shift-KeyT", "openTabSearch");

    // Navigation
    _bind(n, "KeyG KeyI", "focusInput");
    _bind(n, "KeyG KeyU", "goUpUrl");

    // Help
    _bind(n, "Shift-Slash", "showHelp");

    // Mode escape — works in all non-NORMAL modes
    for (const mode of [Mode.INSERT, Mode.HINTS, Mode.TAB_SEARCH]) {
      _bind(mode, "Escape", "exitToNormal");
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
    document.addEventListener("keyup", this._onKeyUp, true);
    document.addEventListener("focusin", this._onFocusIn, true);
    document.addEventListener("focusout", this._onFocusOut, true);
  }

  private _detach(): void {
    document.removeEventListener("keydown", this._onKeyDown, true);
    document.removeEventListener("keyup", this._onKeyUp, true);
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

    // In non-NORMAL modes, delegate to the active mode's key handler first
    if (this.mode !== Mode.NORMAL) {
      if (this._modeKeyDelegate) {
        const handled = this._modeKeyDelegate(event);
        if (handled) return;
      }
      // Fall through to Escape handling
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
      const cmd = modeBindings.get(candidate)!;
      // Track held key for keyup dispatch (only single-key bindings)
      if (!candidate.includes(" ") && this._keyUpCommands.has(cmd)) {
        this._heldCommand = cmd;
        this._heldCode = event.code;
      }
      this._dispatch(cmd);
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

  private _handleKeyUp(event: KeyboardEvent): void {
    if (this._heldCommand && event.code === this._heldCode) {
      const handler = this._keyUpCommands.get(this._heldCommand);
      if (handler) handler();
      this._heldCommand = null;
      this._heldCode = null;
    }
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
