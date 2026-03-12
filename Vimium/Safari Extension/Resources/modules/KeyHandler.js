const Mode = {
  NORMAL: "NORMAL",
  INSERT: "INSERT",
  HINTS: "HINTS",
  FIND: "FIND",
  TAB_SEARCH: "TAB_SEARCH"
};
const INPUT_TAGS = /* @__PURE__ */ new Set(["INPUT", "TEXTAREA", "SELECT"]);
const NON_TEXT_INPUT_TYPES = /* @__PURE__ */ new Set([
  "checkbox",
  "radio",
  "submit",
  "button",
  "reset",
  "file",
  "image",
  "color",
  "range"
]);
const KEY_TIMEOUT_MS = 500;
class KeyHandler {
  constructor() {
    this.mode = Mode.NORMAL;
    this._keyBindingMode = "location";
    this._keyBuffer = "";
    this._keyTimer = null;
    this._bindings = /* @__PURE__ */ new Map();
    this._commands = /* @__PURE__ */ new Map();
    this._prefixes = /* @__PURE__ */ new Map();
    this._modeListeners = [];
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onFocusIn = this._handleFocusIn.bind(this);
    this._onFocusOut = this._handleFocusOut.bind(this);
    this._initDefaultBindings();
    this._attach();
  }
  // --- Public API ---
  getMode() {
    return this.mode;
  }
  setMode(newMode) {
    if (newMode === this.mode) return;
    const prev = this.mode;
    this.mode = newMode;
    this._resetBuffer();
    for (const fn of this._modeListeners) fn(newMode, prev);
  }
  onModeChange(fn) {
    this._modeListeners.push(fn);
  }
  setKeyBindingMode(mode) {
    this._keyBindingMode = mode;
  }
  on(commandName, callback) {
    this._commands.set(commandName, callback);
  }
  off(commandName) {
    this._commands.delete(commandName);
  }
  destroy() {
    this._detach();
    this._resetBuffer();
    this._commands.clear();
    this._bindings.clear();
    this._prefixes.clear();
    this._modeListeners.length = 0;
  }
  // --- Binding registration ---
  bind(mode, sequence, commandName) {
    if (!this._bindings.has(mode)) {
      this._bindings.set(mode, /* @__PURE__ */ new Map());
      this._prefixes.set(mode, /* @__PURE__ */ new Set());
    }
    this._bindings.get(mode).set(sequence, commandName);
    this._rebuildPrefixes(mode);
  }
  // --- Key normalization ---
  static normalizeKey(event, keyBindingMode = "location") {
    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.metaKey) parts.push("Meta");
    let code;
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
  _initDefaultBindings() {
    const n = Mode.NORMAL;
    this.bind(n, "KeyJ", "scrollDown");
    this.bind(n, "KeyK", "scrollUp");
    this.bind(n, "KeyH", "scrollLeft");
    this.bind(n, "KeyL", "scrollRight");
    this.bind(n, "KeyD", "scrollHalfPageDown");
    this.bind(n, "KeyU", "scrollHalfPageUp");
    this.bind(n, "Shift-KeyG", "scrollToBottom");
    this.bind(n, "KeyG KeyG", "scrollToTop");
    this.bind(n, "Shift-KeyH", "goBack");
    this.bind(n, "Shift-KeyL", "goForward");
    this.bind(n, "KeyR", "pageRefresh");
    this.bind(n, "KeyF", "activateHints");
    this.bind(n, "Shift-KeyF", "activateHintsNewTab");
    this.bind(n, "Slash", "enterFindMode");
    this.bind(n, "KeyN", "findNext");
    this.bind(n, "Shift-KeyN", "findPrev");
    this.bind(n, "KeyT", "createTab");
    this.bind(n, "KeyX", "closeTab");
    this.bind(n, "Shift-KeyX", "restoreTab");
    this.bind(n, "Shift-KeyJ", "tabLeft");
    this.bind(n, "Shift-KeyK", "tabRight");
    this.bind(n, "KeyG KeyT", "tabNext");
    this.bind(n, "KeyG Shift-KeyT", "tabPrev");
    this.bind(n, "KeyG Digit0", "firstTab");
    this.bind(n, "KeyG Shift-Digit4", "lastTab");
    this.bind(n, "Shift-KeyT", "openTabSearch");
    for (const mode of [Mode.INSERT, Mode.HINTS, Mode.FIND, Mode.TAB_SEARCH]) {
      this.bind(mode, "Escape", "exitToNormal");
    }
  }
  _rebuildPrefixes(mode) {
    const prefixSet = /* @__PURE__ */ new Set();
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
  _attach() {
    document.addEventListener("keydown", this._onKeyDown, true);
    document.addEventListener("focusin", this._onFocusIn, true);
    document.addEventListener("focusout", this._onFocusOut, true);
  }
  _detach() {
    document.removeEventListener("keydown", this._onKeyDown, true);
    document.removeEventListener("focusin", this._onFocusIn, true);
    document.removeEventListener("focusout", this._onFocusOut, true);
  }
  _handleFocusIn(event) {
    if (this._isInputField(event.target) && this.mode === Mode.NORMAL) {
      this.setMode(Mode.INSERT);
    }
  }
  _handleFocusOut(event) {
    if (this._isInputField(event.target) && this.mode === Mode.INSERT) {
      this.setMode(Mode.NORMAL);
    }
  }
  _isInputField(el) {
    if (!el || !el.tagName) return false;
    if (INPUT_TAGS.has(el.tagName)) {
      if (el.tagName === "INPUT") {
        const type = (el.type || "text").toLowerCase();
        return !NON_TEXT_INPUT_TYPES.has(type);
      }
      return true;
    }
    return el.isContentEditable;
  }
  _handleKeyDown(event) {
    if ([
      "ShiftLeft",
      "ShiftRight",
      "ControlLeft",
      "ControlRight",
      "AltLeft",
      "AltRight",
      "MetaLeft",
      "MetaRight"
    ].includes(event.code)) {
      return;
    }
    if (this.mode !== Mode.NORMAL) {
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this._dispatch("exitToNormal");
      }
      return;
    }
    const key = KeyHandler.normalizeKey(event, this._keyBindingMode);
    const candidate = this._keyBuffer ? this._keyBuffer + " " + key : key;
    const modeBindings = this._bindings.get(this.mode);
    const modePrefixes = this._prefixes.get(this.mode);
    if (modeBindings && modeBindings.has(candidate)) {
      event.preventDefault();
      event.stopPropagation();
      this._resetBuffer();
      this._dispatch(modeBindings.get(candidate));
      return;
    }
    if (modePrefixes && modePrefixes.has(candidate)) {
      event.preventDefault();
      event.stopPropagation();
      this._keyBuffer = candidate;
      this._startTimeout();
      return;
    }
    if (this._keyBuffer) {
      this._resetBuffer();
      return;
    }
  }
  _startTimeout() {
    clearTimeout(this._keyTimer);
    this._keyTimer = setTimeout(() => {
      this._keyBuffer = "";
      this._keyTimer = null;
    }, KEY_TIMEOUT_MS);
  }
  _resetBuffer() {
    this._keyBuffer = "";
    if (this._keyTimer) {
      clearTimeout(this._keyTimer);
      this._keyTimer = null;
    }
  }
  _dispatch(commandName) {
    const handler = this._commands.get(commandName);
    if (handler) {
      handler();
    }
  }
}
if (typeof globalThis !== "undefined") {
  globalThis.Mode = Mode;
  globalThis.KeyHandler = KeyHandler;
}
