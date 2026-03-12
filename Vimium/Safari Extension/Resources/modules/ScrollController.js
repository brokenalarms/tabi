const SCROLL_STEP = 60;
const SCROLL_DURATION_MS = 150;
const _ScrollController = class _ScrollController {
  constructor(keyHandler) {
    this._keyHandler = keyHandler;
    this._wireCommands();
  }
  // --- Scroll target detection ---
  // Walk from the active element up through ancestors, looking for an
  // element that can actually scroll in the requested axis. Falls back to
  // the document's scrolling element.
  static findScrollTarget(axis) {
    const el = document.activeElement;
    if (el && el !== document.body && el !== document.documentElement) {
      let current = el;
      while (current && current !== document.body && current !== document.documentElement) {
        if (_ScrollController._isScrollable(current, axis)) {
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
  // --- Easing ---
  // Quadratic ease-out for a natural deceleration feel.
  static _easeOut(t) {
    return t * (2 - t);
  }
  // --- Smooth scroll via requestAnimationFrame ---
  // Cancels any in-flight animation on the same element before starting a new
  // one, so rapid key-repeat feels responsive rather than queuing up animations.
  static _smoothScroll(target, deltaX, deltaY, duration = SCROLL_DURATION_MS) {
    const existing = _ScrollController._activeAnimations.get(target);
    if (existing) cancelAnimationFrame(existing);
    const startX = target.scrollLeft;
    const startY = target.scrollTop;
    const startTime = performance.now();
    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = _ScrollController._easeOut(progress);
      target.scrollLeft = startX + deltaX * eased;
      target.scrollTop = startY + deltaY * eased;
      if (progress < 1) {
        _ScrollController._activeAnimations.set(target, requestAnimationFrame(step));
      } else {
        _ScrollController._activeAnimations.delete(target);
      }
    }
    _ScrollController._activeAnimations.set(target, requestAnimationFrame(step));
  }
  // --- Scroll operations ---
  static scrollBy(axis, delta) {
    const target = _ScrollController.findScrollTarget(axis);
    const dx = axis === "x" ? delta : 0;
    const dy = axis === "y" ? delta : 0;
    _ScrollController._smoothScroll(target, dx, dy);
  }
  static scrollToTop() {
    const target = _ScrollController.findScrollTarget("y");
    const dy = -target.scrollTop;
    _ScrollController._smoothScroll(target, 0, dy);
  }
  static scrollToBottom() {
    const target = _ScrollController.findScrollTarget("y");
    const dy = target.scrollHeight - target.clientHeight - target.scrollTop;
    _ScrollController._smoothScroll(target, 0, dy);
  }
  // --- Command wiring ---
  _wireCommands() {
    const kh = this._keyHandler;
    kh.on("scrollDown", () => _ScrollController.scrollBy("y", SCROLL_STEP));
    kh.on("scrollUp", () => _ScrollController.scrollBy("y", -SCROLL_STEP));
    kh.on("scrollRight", () => _ScrollController.scrollBy("x", SCROLL_STEP));
    kh.on("scrollLeft", () => _ScrollController.scrollBy("x", -SCROLL_STEP));
    kh.on("scrollHalfPageDown", () => {
      const target = _ScrollController.findScrollTarget("y");
      _ScrollController.scrollBy("y", Math.round(target.clientHeight / 2));
    });
    kh.on("scrollHalfPageUp", () => {
      const target = _ScrollController.findScrollTarget("y");
      _ScrollController.scrollBy("y", -Math.round(target.clientHeight / 2));
    });
    kh.on("scrollToTop", () => _ScrollController.scrollToTop());
    kh.on("scrollToBottom", () => _ScrollController.scrollToBottom());
    kh.on("goBack", () => history.back());
    kh.on("goForward", () => history.forward());
    kh.on("pageRefresh", () => location.reload());
  }
  destroy() {
    const commands = [
      "scrollDown",
      "scrollUp",
      "scrollRight",
      "scrollLeft",
      "scrollHalfPageDown",
      "scrollHalfPageUp",
      "scrollToTop",
      "scrollToBottom",
      "goBack",
      "goForward",
      "pageRefresh"
    ];
    for (const cmd of commands) {
      this._keyHandler.off(cmd);
    }
  }
};
_ScrollController._activeAnimations = /* @__PURE__ */ new Map();
let ScrollController = _ScrollController;
if (typeof globalThis !== "undefined") {
  globalThis.ScrollController = ScrollController;
  globalThis.SCROLL_STEP = SCROLL_STEP;
}
