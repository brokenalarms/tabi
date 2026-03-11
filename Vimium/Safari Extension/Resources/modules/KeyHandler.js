// KeyHandler — mode-aware keyboard event router for Vimium
// Uses event.code for positional key bindings (layout-independent).

const Mode = Object.freeze({
    NORMAL: "NORMAL",
    INSERT: "INSERT",
    HINTS: "HINTS",
    FIND: "FIND",
    TAB_SEARCH: "TAB_SEARCH",
});

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const KEY_TIMEOUT_MS = 500;

class KeyHandler {
    constructor() {
        this.mode = Mode.NORMAL;
        this._keyBuffer = "";
        this._keyTimer = null;
        this._bindings = new Map(); // mode → Map(sequence → commandName)
        this._commands = new Map(); // commandName → callback
        this._prefixes = new Map(); // mode → Set(prefix)
        this._modeListeners = [];

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onFocusIn = this._onFocusIn.bind(this);
        this._onFocusOut = this._onFocusOut.bind(this);

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
            this._bindings.set(mode, new Map());
            this._prefixes.set(mode, new Set());
        }
        this._bindings.get(mode).set(sequence, commandName);
        this._rebuildPrefixes(mode);
    }

    // --- Key normalization ---

    static normalizeKey(event) {
        const parts = [];
        if (event.ctrlKey) parts.push("Ctrl");
        if (event.altKey) parts.push("Alt");
        if (event.metaKey) parts.push("Meta");
        if (event.shiftKey) parts.push("Shift");
        parts.push(event.code);
        return parts.join("-");
    }

    // --- Internals ---

    _initDefaultBindings() {
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

    _rebuildPrefixes(mode) {
        const prefixSet = new Set();
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

    _onFocusIn(event) {
        if (this._isInputField(event.target) && this.mode === Mode.NORMAL) {
            this.setMode(Mode.INSERT);
        }
    }

    _onFocusOut(event) {
        if (this._isInputField(event.target) && this.mode === Mode.INSERT) {
            this.setMode(Mode.NORMAL);
        }
    }

    _isInputField(el) {
        if (!el || !el.tagName) return false;
        if (INPUT_TAGS.has(el.tagName)) {
            if (el.tagName === "INPUT") {
                const type = (el.type || "text").toLowerCase();
                const nonText = new Set(["checkbox", "radio", "submit", "button", "reset", "file", "image", "color", "range"]);
                return !nonText.has(type);
            }
            return true;
        }
        return el.isContentEditable;
    }

    _onKeyDown(event) {
        // Ignore modifier-only keypresses
        if (["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
             "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(event.code)) {
            return;
        }

        // In INSERT mode, only handle Escape
        if (this.mode === Mode.INSERT) {
            if (event.code === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                this._dispatch("exitToNormal");
            }
            return;
        }

        // In passthrough modes (HINTS, FIND, TAB_SEARCH), only handle Escape
        // Other keys are consumed by those mode's own UI
        if (this.mode === Mode.HINTS || this.mode === Mode.FIND || this.mode === Mode.TAB_SEARCH) {
            if (event.code === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                this._dispatch("exitToNormal");
            }
            return;
        }

        // NORMAL mode key processing
        const key = KeyHandler.normalizeKey(event);
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

        // No match — if we had a partial buffer, discard it
        if (this._keyBuffer) {
            this._resetBuffer();
            // Don't suppress the key — let it through
            return;
        }

        // Single key with no binding — ignore (let browser handle)
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

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
    globalThis.Mode = Mode;
    globalThis.KeyHandler = KeyHandler;
}
