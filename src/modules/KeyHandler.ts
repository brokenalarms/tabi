// KeyHandler — mode-aware keyboard event router for Tabi
// Uses event.code for positional key bindings (layout-independent).

import type { KeyBindingMode, KeyLayout, ModeValue } from "../types";
import { Mode, COMMANDS } from "../commands";
import { bindingsForPreset } from "../keybindings";

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox", "radio", "submit", "button", "reset", "file", "image", "color", "range",
]);
// ARIA roles that accept text input — elements with these roles should
// suppress Tabi keybindings just like native <input>/<textarea>.
const TEXT_INPUT_ROLES = new Set([
  "textbox", "searchbox", "combobox",
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
  private keyBindingMode: KeyBindingMode;
  private keyBuffer: string;
  private keyTimer: ReturnType<typeof setTimeout> | null;
  private bindings: Map<string, Map<string, string>>;
  private commands: Map<string, () => void>;
  private keyUpCommands: Map<string, () => void>;
  private prefixes: Map<string, Set<string>>;
  private modeListeners: ModeListener[];
  private modeKeyDelegate: ((event: KeyboardEvent) => boolean) | null;
  private heldCommand: string | null;
  private heldCode: string | null;

  private readonly onKeyDownHandler: (event: KeyboardEvent) => void;
  private readonly onKeyUpHandler: (event: KeyboardEvent) => void;
  private readonly onFocusInHandler: (event: FocusEvent) => void;
  private readonly onFocusOutHandler: (event: FocusEvent) => void;

  constructor() {
    this.mode = Mode.NORMAL;
    this.keyBindingMode = "location";
    this.keyBuffer = "";
    this.keyTimer = null;
    this.bindings = new Map();
    this.commands = new Map();
    this.keyUpCommands = new Map();
    this.prefixes = new Map();
    this.modeListeners = [];
    this.modeKeyDelegate = null;
    this.heldCommand = null;
    this.heldCode = null;

    this.onKeyDownHandler = this.handleKeyDown.bind(this);
    this.onKeyUpHandler = this.handleKeyUp.bind(this);
    this.onFocusInHandler = this.handleFocusIn.bind(this);
    this.onFocusOutHandler = this.handleFocusOut.bind(this);

    this.initDefaultBindings();
    this.attach();
  }

  // --- Public API ---

  getMode(): ModeValue {
    return this.mode;
  }

  setMode(newMode: ModeValue): void {
    if (newMode === this.mode) return;
    const prev = this.mode;
    this.mode = newMode;
    this.resetKeyBuffer();
    for (const fn of this.modeListeners) fn(newMode, prev);
  }

  onModeChange(fn: ModeListener): void {
    this.modeListeners.push(fn);
  }

  setKeyBindingMode(mode: KeyBindingMode): void {
    this.keyBindingMode = mode;
    this.resetKeyBuffer();
  }

  setLayout(layout: KeyLayout): void {
    // Clear all NORMAL mode bindings and re-register from the new layout
    this.bindings.delete(Mode.NORMAL);
    this.prefixes.delete(Mode.NORMAL);
    this.initDefaultBindings(layout);
    this.resetKeyBuffer();
  }

  setModeKeyDelegate(handler: (event: KeyboardEvent) => boolean): void {
    this.modeKeyDelegate = handler;
  }

  clearModeKeyDelegate(): void {
    this.modeKeyDelegate = null;
  }

  on(commandName: string, callback: () => void): void {
    this.commands.set(commandName, callback);
  }

  off(commandName: string): void {
    this.commands.delete(commandName);
    this.keyUpCommands.delete(commandName);
  }

  onKeyUp(commandName: string, callback: () => void): void {
    this.keyUpCommands.set(commandName, callback);
  }

  resetBuffer(): void {
    this.resetKeyBuffer();
  }

  getBindings(): Map<string, Map<string, string>> {
    return this.bindings;
  }

  destroy(): void {
    this.detach();
    this.resetKeyBuffer();
    this.commands.clear();
    this.bindings.clear();
    this.prefixes.clear();
    this.modeListeners.length = 0;
  }

  // --- Binding registration ---

  bind(mode: ModeValue, sequence: string, commandName: string): void {
    if (!this.bindings.has(mode)) {
      this.bindings.set(mode, new Map());
      this.prefixes.set(mode, new Set());
    }
    const modeMap = this.bindings.get(mode);
    if (modeMap) modeMap.set(sequence, commandName);
    this.rebuildPrefixes(mode);
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

  private initDefaultBindings(layout: KeyLayout = "optimized"): void {
    const n = Mode.NORMAL;

    // Load bindings from the shared layout
    for (const [seq, cmd] of bindingsForPreset(layout)) {
      if (!(cmd in COMMANDS)) {
        console.warn(`[Tabi] Unknown command "${cmd}" — not in COMMANDS`);
      }
      this.bind(n, seq, cmd);
    }

    // Tab-by-number bindings (g1–g9, g0, g^, g$) — not preset-specific
    for (let i = 1; i <= 9; i++) {
      this.bind(n, "KeyG Digit" + i, "goToTab" + i);
    }
    this.bind(n, "KeyG Shift-Digit6", "goToTabFirst");   // g^
    this.bind(n, "KeyG Digit0", "goToTabFirst");          // g0
    this.bind(n, "KeyG Shift-Digit4", "goToTabLast");     // g$

    // Mode escape — works in all non-NORMAL modes
    for (const mode of [Mode.INSERT, Mode.HINTS, Mode.TAB_SEARCH]) {
      this.bind(mode, "Escape", "exitToNormal");
    }
  }

  private rebuildPrefixes(mode: ModeValue): void {
    const prefixSet = new Set<string>();
    const modeBindings = this.bindings.get(mode);
    if (!modeBindings) return;
    for (const seq of modeBindings.keys()) {
      const parts = seq.split(" ");
      for (let i = 1; i < parts.length; i++) {
        prefixSet.add(parts.slice(0, i).join(" "));
      }
    }
    this.prefixes.set(mode, prefixSet);
  }

  private attach(): void {
    document.addEventListener("keydown", this.onKeyDownHandler, true);
    document.addEventListener("keyup", this.onKeyUpHandler, true);
    document.addEventListener("focusin", this.onFocusInHandler, true);
    document.addEventListener("focusout", this.onFocusOutHandler, true);
  }

  private detach(): void {
    document.removeEventListener("keydown", this.onKeyDownHandler, true);
    document.removeEventListener("keyup", this.onKeyUpHandler, true);
    document.removeEventListener("focusin", this.onFocusInHandler, true);
    document.removeEventListener("focusout", this.onFocusOutHandler, true);
  }

  private handleFocusIn(event: FocusEvent): void {
    // Use composedPath()[0] to get the actual focused element even when
    // the event crosses a shadow DOM boundary (event.target is retargeted
    // to the shadow host, but composedPath preserves the original target).
    const target = event.composedPath()[0] as Element;
    if (this.isInputField(target) && this.mode === Mode.NORMAL) {
      this.setMode(Mode.INSERT);
    }
  }

  private handleFocusOut(event: FocusEvent): void {
    const target = event.composedPath()[0] as Element;
    if (this.isInputField(target) && this.mode === Mode.INSERT) {
      this.setMode(Mode.NORMAL);
    }
  }

  private isInputField(el: Element | null): boolean {
    if (!el || !el.tagName) return false;
    // Native form elements
    if (INPUT_TAGS.has(el.tagName)) {
      if (el.tagName === "INPUT") {
        const type = ((el as HTMLInputElement).type || "text").toLowerCase();
        return !NON_TEXT_INPUT_TYPES.has(type);
      }
      return true;
    }
    // contentEditable (rich text editors, Google Docs, etc.)
    if ((el as HTMLElement).isContentEditable) return true;
    // ARIA text-input roles (custom components that accept text)
    const role = el.getAttribute?.("role");
    if (role && TEXT_INPUT_ROLES.has(role)) return true;
    // Shadow DOM: if activeElement is a shadow host, check the focused
    // element inside the shadow tree
    if (el.shadowRoot && el.shadowRoot.activeElement) {
      return this.isInputField(el.shadowRoot.activeElement);
    }
    return false;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // Ignore modifier-only keypresses
    if (["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
         "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(event.code)) {
      return;
    }

    // Fallback: if an input field is focused but focusin didn't fire
    // (e.g. field was already focused when content script loaded),
    // switch to INSERT now so the keystroke passes through.
    if (this.mode === Mode.NORMAL && this.isInputField(document.activeElement as Element)) {
      this.setMode(Mode.INSERT);
    }

    // In non-NORMAL modes, delegate to the active mode's key handler first
    if (this.mode !== Mode.NORMAL) {
      if (this.modeKeyDelegate) {
        const handled = this.modeKeyDelegate(event);
        if (handled) return;
      }
      // Fall through to Escape handling
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.dispatch("exitToNormal");
      }
      return;
    }

    // NORMAL mode key processing
    const key = KeyHandler.normalizeKey(event, this.keyBindingMode);
    const candidate = this.keyBuffer ? this.keyBuffer + " " + key : key;

    const modeBindings = this.bindings.get(this.mode);
    const modePrefixes = this.prefixes.get(this.mode);

    if (modeBindings && modeBindings.has(candidate)) {
      event.preventDefault();
      event.stopPropagation();
      this.resetKeyBuffer();
      const cmd = modeBindings.get(candidate)!;
      // Track held key for keyup dispatch (only single-key bindings)
      if (!candidate.includes(" ") && this.keyUpCommands.has(cmd)) {
        this.heldCommand = cmd;
        this.heldCode = event.code;
      }
      this.dispatch(cmd);
      return;
    }

    if (modePrefixes && modePrefixes.has(candidate)) {
      event.preventDefault();
      event.stopPropagation();
      this.keyBuffer = candidate;
      this.startTimeout();
      return;
    }

    // No match — if we had a partial buffer, discard it
    if (this.keyBuffer) {
      this.resetKeyBuffer();
      // Don't suppress the key — let it through
      return;
    }

    // Single key with no binding — ignore (let browser handle)
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (this.heldCommand && event.code === this.heldCode) {
      const handler = this.keyUpCommands.get(this.heldCommand);
      if (handler) handler();
      this.heldCommand = null;
      this.heldCode = null;
    }
  }

  private startTimeout(): void {
    clearTimeout(this.keyTimer!);
    this.keyTimer = setTimeout(() => {
      this.keyBuffer = "";
      this.keyTimer = null;
    }, KEY_TIMEOUT_MS);
  }

  private resetKeyBuffer(): void {
    this.keyBuffer = "";
    if (this.keyTimer) {
      clearTimeout(this.keyTimer);
      this.keyTimer = null;
    }
  }

  private dispatch(commandName: string): void {
    const handler = this.commands.get(commandName);
    if (handler) {
      handler();
    }
  }
}
