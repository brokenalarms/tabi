// ScrollController — scroll target detection and scroll commands for Vimium
// Finds the correct scrollable element and performs directional/absolute scrolling.
// Uses requestAnimationFrame-based easing for smooth scrolling, since Safari does
// not reliably support CSS `behavior: "smooth"` on all elements.

type Axis = "x" | "y";

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

const SCROLL_STEP = 60;
const SCROLL_DURATION_MS = 150;
const SCROLL_JUMP_MAX_MS = 380;

class ScrollController {
  private _keyHandler: KeyHandlerLike;
  private static _activeAnimations = new Map<Element, number>();

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

  // --- Easing ---
  // Quadratic ease-out for a natural deceleration feel.

  private static _easeOut(t: number): number {
    return t * (2 - t);
  }

  // --- Smooth scroll via requestAnimationFrame ---
  // Cancels any in-flight animation on the same element before starting a new
  // one, so rapid key-repeat feels responsive rather than queuing up animations.

  private static _smoothScroll(
    target: Element,
    deltaX: number,
    deltaY: number,
    duration: number = SCROLL_DURATION_MS,
  ): void {
    const existing = ScrollController._activeAnimations.get(target);
    if (existing) cancelAnimationFrame(existing);

    const startX = target.scrollLeft;
    const startY = target.scrollTop;
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = ScrollController._easeOut(progress);

      target.scrollLeft = startX + deltaX * eased;
      target.scrollTop = startY + deltaY * eased;

      if (progress < 1) {
        ScrollController._activeAnimations.set(target, requestAnimationFrame(step));
      } else {
        ScrollController._activeAnimations.delete(target);
      }
    }

    ScrollController._activeAnimations.set(target, requestAnimationFrame(step));
  }

  // --- Scroll operations ---

  static scrollBy(axis: Axis, delta: number): void {
    const target = ScrollController.findScrollTarget(axis);
    const dx = axis === "x" ? delta : 0;
    const dy = axis === "y" ? delta : 0;
    ScrollController._smoothScroll(target, dx, dy);
  }

  private static _jumpDuration(distance: number): number {
    if (distance === 0) return 0;
    // Scale duration with distance: short jumps stay snappy, long jumps ease in smoothly
    return Math.min(SCROLL_DURATION_MS + Math.log2(1 + Math.abs(distance)) * 20, SCROLL_JUMP_MAX_MS);
  }

  static scrollToTop(): void {
    const target = ScrollController.findScrollTarget("y");
    const dy = -target.scrollTop;
    ScrollController._smoothScroll(target, 0, dy, ScrollController._jumpDuration(dy));
  }

  static scrollToBottom(): void {
    const target = ScrollController.findScrollTarget("y");
    const dy = target.scrollHeight - target.clientHeight - target.scrollTop;
    ScrollController._smoothScroll(target, 0, dy, ScrollController._jumpDuration(dy));
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
