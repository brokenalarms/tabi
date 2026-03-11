// HintMode — link-hint overlay for Vimium
// Discovers clickable elements, renders labeled hints, and dispatches
// clicks when the user types the matching label characters.

const HINT_CHARS = "sadfjklewcmpgh";

const CLICKABLE_SELECTOR = [
    "a", "button", "input", "textarea", "select",
    "summary", "details",
    "[role='button']", "[role='link']", "[role='tab']",
    "[role='menuitem']", "[role='option']", "[role='checkbox']",
    "[role='radio']", "[role='switch']",
    "[tabindex]",
    "[onclick]", "[onmousedown]",
].join(", ");

class HintMode {
    constructor(keyHandler) {
        this._keyHandler = keyHandler;
        this._active = false;
        this._newTab = false;
        this._hints = [];          // { element, label, div }
        this._typed = "";
        this._overlay = null;
        this._styleEl = null;
        this._onKeyDown = this._onKeyDown.bind(this);
        this._wireCommands();
    }

    // --- Public API ---

    activate(newTab) {
        if (this._active) return;
        this._newTab = !!newTab;
        this._active = true;
        this._typed = "";
        this._keyHandler.setMode(Mode.HINTS);

        const elements = this._discoverElements();
        if (elements.length === 0) {
            this._deactivate();
            return;
        }

        const labels = HintMode.generateLabels(elements.length);
        this._injectStyles();
        this._createOverlay();
        this._hints = elements.map((el, i) => {
            const label = labels[i];
            const div = this._createHintDiv(el, label);
            return { element: el, label, div };
        });

        document.addEventListener("keydown", this._onKeyDown, true);
    }

    deactivate() {
        this._deactivate();
    }

    isActive() {
        return this._active;
    }

    // --- Element discovery ---

    _discoverElements() {
        const seen = new Set();
        const result = [];

        const collect = (root) => {
            const nodes = root.querySelectorAll(CLICKABLE_SELECTOR);
            for (const el of nodes) {
                if (seen.has(el)) continue;
                seen.add(el);
                if (this._isVisible(el)) result.push(el);
            }
            // cursor:pointer heuristic — check all elements, but only those
            // not already captured by selector matching
            const allEls = root.querySelectorAll("*");
            for (const el of allEls) {
                if (seen.has(el)) continue;
                try {
                    const style = getComputedStyle(el);
                    if (style.cursor === "pointer" && this._isVisible(el)) {
                        seen.add(el);
                        result.push(el);
                    }
                } catch (_) {
                    // getComputedStyle may throw for detached elements
                }
            }
        };

        collect(document);

        // Traverse open shadow roots
        const walkShadow = (root) => {
            const els = root.querySelectorAll("*");
            for (const el of els) {
                if (el.shadowRoot) {
                    collect(el.shadowRoot);
                    walkShadow(el.shadowRoot);
                }
            }
        };
        walkShadow(document);

        // Sort by viewport position: top-left elements get shortest labels
        result.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (ra.top - rb.top) || (ra.left - rb.left);
        });

        return result;
    }

    _isVisible(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
        if (rect.right < 0 || rect.left > window.innerWidth) return false;

        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return false;
        if (parseFloat(style.opacity) === 0) return false;

        return true;
    }

    // --- Label generation ---

    static generateLabels(count) {
        if (count <= 0) return [];
        const chars = HINT_CHARS.split("");
        const base = chars.length;

        // Determine minimum label length to fit all hints
        let len = 1;
        let capacity = base;
        while (capacity < count) {
            len++;
            capacity = Math.pow(base, len);
        }

        const labels = [];
        for (let i = 0; i < count; i++) {
            let label = "";
            let n = i;
            for (let d = len - 1; d >= 0; d--) {
                const divisor = Math.pow(base, d);
                const idx = Math.floor(n / divisor);
                label += chars[idx];
                n %= divisor;
            }
            labels.push(label);
        }
        return labels;
    }

    // --- Overlay rendering ---

    _injectStyles() {
        if (this._styleEl) return;
        this._styleEl = document.createElement("style");
        this._styleEl.textContent = `
.vimium-hint-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    z-index: 2147483647; pointer-events: none;
}
.vimium-hint {
    position: fixed; z-index: 2147483647;
    padding: 1px 3px;
    background: linear-gradient(to bottom, #fff785, #ffc542);
    border: 1px solid #c38a22; border-radius: 3px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    color: #302505;
    font: bold 12px/1.2 "Helvetica Neue", Helvetica, Arial, sans-serif;
    text-transform: uppercase;
    pointer-events: none; white-space: nowrap;
}
.vimium-hint .vimium-hint-matched { opacity: 0.4; }
`;
        (document.head || document.documentElement).appendChild(this._styleEl);
    }

    _createOverlay() {
        this._overlay = document.createElement("div");
        this._overlay.className = "vimium-hint-overlay";
        document.body.appendChild(this._overlay);
    }

    _createHintDiv(element, label) {
        const rect = element.getBoundingClientRect();
        const div = document.createElement("div");
        div.className = "vimium-hint";
        div.textContent = label;
        div.style.left = Math.max(0, rect.left) + "px";
        div.style.top = Math.max(0, rect.top) + "px";
        this._overlay.appendChild(div);
        return div;
    }

    // --- Key handling during HINTS mode ---

    _onKeyDown(event) {
        if (!this._active) return;

        event.preventDefault();
        event.stopPropagation();

        if (event.code === "Escape") {
            this._deactivate();
            return;
        }

        // Backspace removes last typed character
        if (event.code === "Backspace") {
            if (this._typed.length > 0) {
                this._typed = this._typed.slice(0, -1);
                this._updateHintVisibility();
            }
            return;
        }

        // Only accept hint characters
        const char = event.key ? event.key.toLowerCase() : "";
        if (!HINT_CHARS.includes(char) || char.length !== 1) return;

        this._typed += char;
        this._updateHintVisibility();

        // Check for exact match
        const match = this._hints.find((h) => h.label === this._typed);
        if (match) {
            this._activateHint(match);
        }
    }

    _updateHintVisibility() {
        for (const hint of this._hints) {
            const matches = hint.label.startsWith(this._typed);
            hint.div.style.display = matches ? "" : "none";
            if (matches) {
                // Highlight already-typed prefix
                const matched = hint.label.slice(0, this._typed.length);
                const remaining = hint.label.slice(this._typed.length);
                hint.div.innerHTML = "";
                if (matched) {
                    const span = document.createElement("span");
                    span.className = "vimium-hint-matched";
                    span.textContent = matched;
                    hint.div.appendChild(span);
                }
                hint.div.appendChild(document.createTextNode(remaining));
            }
        }
    }

    _activateHint(hint) {
        const element = hint.element;
        this._deactivate();

        if (this._newTab && element.tagName === "A" && element.href) {
            browser.runtime.sendMessage({
                command: "createTab",
                url: element.href,
            });
        } else {
            element.focus();
            element.click();
        }
    }

    // --- Cleanup ---

    _deactivate() {
        if (!this._active) return;
        this._active = false;
        this._typed = "";
        document.removeEventListener("keydown", this._onKeyDown, true);

        if (this._overlay && this._overlay.parentNode) {
            this._overlay.parentNode.removeChild(this._overlay);
        }
        this._overlay = null;

        if (this._styleEl && this._styleEl.parentNode) {
            this._styleEl.parentNode.removeChild(this._styleEl);
        }
        this._styleEl = null;

        this._hints = [];
        this._keyHandler.setMode(Mode.NORMAL);
    }

    // --- Command wiring ---

    _wireCommands() {
        this._keyHandler.on("activateHints", () => this.activate(false));
        this._keyHandler.on("activateHintsNewTab", () => this.activate(true));
    }

    destroy() {
        this._deactivate();
        this._keyHandler.off("activateHints");
        this._keyHandler.off("activateHintsNewTab");
    }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
    globalThis.HintMode = HintMode;
    globalThis.HINT_CHARS = HINT_CHARS;
    globalThis.CLICKABLE_SELECTOR = CLICKABLE_SELECTOR;
}
