// ScrollController — scroll target detection and scroll commands for Vimium
// Finds the correct scrollable element and performs directional/absolute scrolling.

type Axis = "x" | "y";

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

const SCROLL_STEP = 60;

class ScrollController {
  private _keyHandler: KeyHandlerLike;

  constructor(keyHandler: KeyHandlerLike) {
    this._keyHandler = keyHandler;
    this._wireCommands();
  }

  // --- Scroll target detection ---
  // Walk from the active element up through ancestors, looking for an
  // element that can actually scroll in the requested axis. Falls back to
  // the document's scrolling element.

  static findScrollTarget(axis: Axis): Element {
    const el = document.activeElement;
    if (el && el !== document.body && el !== document.documentElement) {
      let current: Element | null = el;
      while (current && current !== document.body && current !== document.documentElement) {
        if (ScrollController._isScrollable(current, axis)) {
          return current;
        }
        current = current.parentElement;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  private static _isScrollable(el: Element, axis: Axis): boolean {
    const style = getComputedStyle(el);
    const overflowProp = axis === "x" ? style.overflowX : style.overflowY;
    if (overflowProp !== "auto" && overflowProp !== "scroll") return false;

    if (axis === "x") {
      return el.scrollWidth > el.clientWidth;
    }
    return el.scrollHeight > el.clientHeight;
  }

  // --- Scroll operations ---

  static scrollBy(axis: Axis, delta: number): void {
    const target = ScrollController.findScrollTarget(axis);
    const opts: ScrollToOptions = { behavior: "auto" };
    if (axis === "x") {
      opts.left = delta;
    } else {
      opts.top = delta;
    }
    target.scrollBy(opts);
  }

  static scrollToTop(): void {
    const target = ScrollController.findScrollTarget("y");
    target.scrollTo({ top: 0, behavior: "auto" });
  }

  static scrollToBottom(): void {
    const target = ScrollController.findScrollTarget("y");
    target.scrollTo({ top: target.scrollHeight, behavior: "auto" });
  }

  // --- Command wiring ---

  private _wireCommands(): void {
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
    kh.on("pageRefresh", () => location.reload());
  }

  destroy(): void {
    const commands = [
      "scrollDown", "scrollUp", "scrollRight", "scrollLeft",
      "scrollHalfPageDown", "scrollHalfPageUp",
      "scrollToTop", "scrollToBottom",
      "goBack", "goForward", "pageRefresh",
    ];
    for (const cmd of commands) {
      this._keyHandler.off(cmd);
    }
  }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).ScrollController = ScrollController;
  (globalThis as Record<string, unknown>).SCROLL_STEP = SCROLL_STEP;
}
