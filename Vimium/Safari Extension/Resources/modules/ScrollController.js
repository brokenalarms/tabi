// ScrollController — scroll target detection and scroll commands for Vimium
// Finds the correct scrollable element and performs directional/absolute scrolling.

const SCROLL_STEP = 60;

class ScrollController {
    constructor(keyHandler) {
        this._keyHandler = keyHandler;
        this._wireCommands();
    }

    // --- Scroll target detection ---
    // Walk from the active element up through ancestors, looking for an
    // element that can actually scroll in the requested axis. Falls back to
    // the document's scrolling element.

    static findScrollTarget(axis) {
        let el = document.activeElement;
        if (el && el !== document.body && el !== document.documentElement) {
            let current = el;
            while (current && current !== document.body && current !== document.documentElement) {
                if (ScrollController._isScrollable(current, axis)) {
                    return current;
                }
                current = current.parentElement;
            }
        }
        return document.scrollingElement || document.documentElement;
    }

    static _isScrollable(el, axis) {
        const style = getComputedStyle(el);
        const overflowProp = axis === "x" ? style.overflowX : style.overflowY;
        if (overflowProp !== "auto" && overflowProp !== "scroll") return false;

        if (axis === "x") {
            return el.scrollWidth > el.clientWidth;
        }
        return el.scrollHeight > el.clientHeight;
    }

    // --- Scroll operations ---

    static scrollBy(axis, delta) {
        const target = ScrollController.findScrollTarget(axis);
        const opts = { behavior: "auto" };
        if (axis === "x") {
            opts.left = delta;
        } else {
            opts.top = delta;
        }
        target.scrollBy(opts);
    }

    static scrollToTop() {
        const target = ScrollController.findScrollTarget("y");
        target.scrollTo({ top: 0, behavior: "auto" });
    }

    static scrollToBottom() {
        const target = ScrollController.findScrollTarget("y");
        target.scrollTo({ top: target.scrollHeight, behavior: "auto" });
    }

    // --- Command wiring ---

    _wireCommands() {
        const kh = this._keyHandler;

        kh.on("scrollDown", () => ScrollController.scrollBy("y", SCROLL_STEP));
        kh.on("scrollUp", () => ScrollController.scrollBy("y", -SCROLL_STEP));
        kh.on("scrollRight", () => ScrollController.scrollBy("x", SCROLL_STEP));
        kh.on("scrollLeft", () => ScrollController.scrollBy("x", -SCROLL_STEP));

        kh.on("scrollHalfPageDown", () => {
            const target = ScrollController.findScrollTarget("y");
            ScrollController.scrollBy("y", Math.round(target.clientHeight / 2));
        });
        kh.on("scrollHalfPageUp", () => {
            const target = ScrollController.findScrollTarget("y");
            ScrollController.scrollBy("y", -Math.round(target.clientHeight / 2));
        });

        kh.on("scrollToTop", () => ScrollController.scrollToTop());
        kh.on("scrollToBottom", () => ScrollController.scrollToBottom());

        kh.on("goBack", () => history.back());
        kh.on("goForward", () => history.forward());
    }

    destroy() {
        const commands = [
            "scrollDown", "scrollUp", "scrollRight", "scrollLeft",
            "scrollHalfPageDown", "scrollHalfPageUp",
            "scrollToTop", "scrollToBottom",
            "goBack", "goForward",
        ];
        for (const cmd of commands) {
            this._keyHandler.off(cmd);
        }
    }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
    globalThis.ScrollController = ScrollController;
    globalThis.SCROLL_STEP = SCROLL_STEP;
}
