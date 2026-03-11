// FindMode — in-page search with smartcase detection for Vimium
// Renders a bottom-of-viewport find bar, searches via window.find(),
// supports n/N for next/prev, Enter to close on match, Escape to clear.

class FindMode {
    constructor(keyHandler) {
        this._keyHandler = keyHandler;
        this._active = false;
        this._barEl = null;
        this._inputEl = null;
        this._countEl = null;
        this._styleEl = null;
        this._lastQuery = "";
        this._caseSensitive = false;
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onInput = this._onInput.bind(this);
        this._wireCommands();
    }

    // --- Public API ---

    activate() {
        if (this._active) return;
        this._active = true;
        this._keyHandler.setMode(Mode.FIND);
        this._injectStyles();
        this._createBar();
        this._inputEl.focus();
        document.addEventListener("keydown", this._onKeyDown, true);
    }

    deactivate(clearHighlight) {
        if (!this._active) return;
        this._active = false;
        document.removeEventListener("keydown", this._onKeyDown, true);

        if (clearHighlight) {
            this._clearSelection();
            this._lastQuery = "";
        }

        if (this._barEl && this._barEl.parentNode) {
            this._barEl.parentNode.removeChild(this._barEl);
        }
        this._barEl = null;
        this._inputEl = null;
        this._countEl = null;

        if (this._styleEl && this._styleEl.parentNode) {
            this._styleEl.parentNode.removeChild(this._styleEl);
        }
        this._styleEl = null;

        this._keyHandler.setMode(Mode.NORMAL);
    }

    isActive() {
        return this._active;
    }

    getLastQuery() {
        return this._lastQuery;
    }

    // --- Smartcase detection ---

    static isSmartCaseSensitive(query) {
        return query !== query.toLowerCase();
    }

    // --- Search ---

    _search(query, backward) {
        if (!query) return false;
        this._caseSensitive = FindMode.isSmartCaseSensitive(query);
        this._lastQuery = query;

        // Clear existing selection so window.find starts from top/bottom
        this._clearSelection();

        return this._windowFind(query, this._caseSensitive, backward);
    }

    _findNext() {
        if (!this._lastQuery) return false;
        return this._windowFind(this._lastQuery, this._caseSensitive, false);
    }

    _findPrev() {
        if (!this._lastQuery) return false;
        return this._windowFind(this._lastQuery, this._caseSensitive, true);
    }

    _windowFind(query, caseSensitive, backward) {
        // window.find(string, caseSensitive, backward, wrapAround)
        return window.find(query, caseSensitive, backward, true);
    }

    _clearSelection() {
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
    }

    // --- UI ---

    _injectStyles() {
        if (this._styleEl) return;
        this._styleEl = document.createElement("style");
        this._styleEl.textContent = `
.vimium-find-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    padding: 6px 12px;
    background: #333;
    border-top: 1px solid #555;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 14px;
    box-shadow: 0 -2px 8px rgba(0,0,0,0.3);
}
.vimium-find-bar input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid #666;
    border-radius: 3px;
    background: #1a1a1a;
    color: #eee;
    font-size: 14px;
    font-family: inherit;
    outline: none;
}
.vimium-find-bar input:focus {
    border-color: #4a9eff;
}
.vimium-find-bar .vimium-find-count {
    margin-left: 8px;
    color: #aaa;
    font-size: 12px;
    white-space: nowrap;
}
`;
        (document.head || document.documentElement).appendChild(this._styleEl);
    }

    _createBar() {
        this._barEl = document.createElement("div");
        this._barEl.className = "vimium-find-bar";

        this._inputEl = document.createElement("input");
        this._inputEl.type = "text";
        this._inputEl.placeholder = "Find…";
        this._inputEl.setAttribute("autocomplete", "off");
        this._inputEl.setAttribute("spellcheck", "false");

        // Pre-fill with last query if available
        if (this._lastQuery) {
            this._inputEl.value = this._lastQuery;
            this._inputEl.select();
        }

        this._countEl = document.createElement("span");
        this._countEl.className = "vimium-find-count";

        this._barEl.appendChild(this._inputEl);
        this._barEl.appendChild(this._countEl);
        document.body.appendChild(this._barEl);

        this._inputEl.addEventListener("input", this._onInput);
    }

    _onInput() {
        const query = this._inputEl.value;
        if (!query) {
            this._clearSelection();
            this._countEl.textContent = "";
            return;
        }
        const found = this._search(query, false);
        this._countEl.textContent = found ? "" : "No matches";
    }

    // --- Key handling during FIND mode ---

    _onKeyDown(event) {
        if (!this._active) return;

        if (event.code === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.deactivate(true);
            return;
        }

        if (event.code === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
                this._findPrev();
            } else {
                // Close find bar, keep match highlighted
                this._lastQuery = this._inputEl.value;
                this._caseSensitive = FindMode.isSmartCaseSensitive(this._lastQuery);
                this.deactivate(false);
            }
            return;
        }

        // Let input handle all other keys — don't propagate to KeyHandler
        event.stopPropagation();
    }

    // --- Command wiring ---

    _wireCommands() {
        this._keyHandler.on("enterFindMode", () => this.activate());
        this._keyHandler.on("findNext", () => this._findNext());
        this._keyHandler.on("findPrev", () => this._findPrev());
    }

    destroy() {
        this.deactivate(true);
        this._keyHandler.off("enterFindMode");
        this._keyHandler.off("findNext");
        this._keyHandler.off("findPrev");
    }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
    globalThis.FindMode = FindMode;
}
