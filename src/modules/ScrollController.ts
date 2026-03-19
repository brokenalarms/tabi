// ScrollController — scroll target detection and scroll commands for Tabi
// Finds the correct scrollable element and performs directional scrolling.
//
// Step keys (j/k/h/l) use a single RAF loop with velocity smoothing:
// currentSpeed approaches targetSpeed via exponential smoothing each frame.
// Keydown sets targetSpeed to max → ease-in. Keyup sets targetSpeed to 0 →
// ease-out. Both directions use the same time constant for a consistent feel
// that matches Safari's native arrow key scrolling.
//
// Single-shot commands (d/u/gg/G) use the browser's native scrollBy/scrollTo
// with behavior:"smooth".

type Axis = "x" | "y";

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  onKeyUp(command: string, callback: () => void): void;
  off(command: string): void;
}

export const ScrollConfig = {
  /** Max scroll velocity (px/sec) for held j/k/h/l */
  scrollSpeed: 800,
  /** Velocity smoothing time constant (ms) — controls ease-in/out duration */
  smoothTimeMs: 80,
  /** Stop threshold (px/sec) — stop the loop when speed drops below this */
  stopThreshold: 5,
};

interface SmoothScroll {
  target: Element;
  axis: Axis;
  direction: number;
  targetSpeed: number;
  currentSpeed: number;
  rafId: number;
  lastTime: number;
}

export class ScrollController {
  private keyHandler: KeyHandlerLike;
  private static scroll: SmoothScroll | null = null;

  constructor(keyHandler: KeyHandlerLike) {
    this.keyHandler = keyHandler;
    this.wireCommands();
  }

  // --- Scroll target detection ---

  static findScrollTarget(axis: Axis): Element {
    const el = document.activeElement;
    if (el && el !== document.body && el !== document.documentElement) {
      let current: Element | null = el;
      while (current && current !== document.body && current !== document.documentElement) {
        if (ScrollController.isScrollable(current, axis)) {
          return current;
        }
        current = current.parentElement;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  private static isScrollable(el: Element, axis: Axis): boolean {
    const style = getComputedStyle(el);
    const overflowProp = axis === "x" ? style.overflowX : style.overflowY;
    if (overflowProp !== "auto" && overflowProp !== "scroll") return false;

    if (axis === "x") {
      return el.scrollWidth > el.clientWidth;
    }
    return el.scrollHeight > el.clientHeight;
  }

  // --- Smooth velocity scroll (held j/k/h/l) ---

  private static startScroll(axis: Axis, direction: number): void {
    const s = ScrollController.scroll;

    // Already scrolling in same direction — just ensure target speed is max
    if (s && s.axis === axis && s.direction === direction) {
      s.targetSpeed = ScrollConfig.scrollSpeed;
      return;
    }

    // Direction change or new axis — stop and restart
    ScrollController.stopImmediate();
    const target = ScrollController.findScrollTarget(axis);

    const scroll: SmoothScroll = {
      target,
      axis,
      direction,
      targetSpeed: ScrollConfig.scrollSpeed,
      currentSpeed: 0,
      rafId: 0,
      lastTime: 0,
    };

    function step(now: number) {
      if (scroll.lastTime === 0) {
        scroll.lastTime = now;
        scroll.rafId = requestAnimationFrame(step);
        return;
      }

      const dt = now - scroll.lastTime;
      scroll.lastTime = now;

      // Exponential smoothing: currentSpeed → targetSpeed
      const factor = 1 - Math.exp(-dt / ScrollConfig.smoothTimeMs);
      scroll.currentSpeed += (scroll.targetSpeed - scroll.currentSpeed) * factor;

      // If decelerating and speed is negligible, stop
      if (scroll.targetSpeed === 0 && scroll.currentSpeed < ScrollConfig.stopThreshold) {
        ScrollController.scroll = null;
        return;
      }

      const px = scroll.currentSpeed * (dt / 1000) * scroll.direction;
      const before = scroll.axis === "y" ? scroll.target.scrollTop : scroll.target.scrollLeft;

      if (scroll.axis === "y") {
        scroll.target.scrollTop += px;
      } else {
        scroll.target.scrollLeft += px;
      }

      const after = scroll.axis === "y" ? scroll.target.scrollTop : scroll.target.scrollLeft;
      if (after === before && scroll.targetSpeed > 0) {
        // Hit boundary
        ScrollController.scroll = null;
        return;
      }

      scroll.rafId = requestAnimationFrame(step);
    }

    ScrollController.scroll = scroll;
    scroll.rafId = requestAnimationFrame(step);
  }

  private static stopScroll(): void {
    const s = ScrollController.scroll;
    if (!s) return;
    // Set target to 0 — the loop will decelerate and self-terminate
    s.targetSpeed = 0;
  }

  private static stopImmediate(): void {
    const s = ScrollController.scroll;
    if (!s) return;
    cancelAnimationFrame(s.rafId);
    ScrollController.scroll = null;
  }

  // --- Command wiring ---

  private wireCommands(): void {
    const kh = this.keyHandler;

    const scrollCmds: [string, Axis, number][] = [
      ["scrollDown", "y", 1],
      ["scrollUp", "y", -1],
      ["scrollRight", "x", 1],
      ["scrollLeft", "x", -1],
    ];
    for (const [cmd, axis, dir] of scrollCmds) {
      kh.on(cmd, () => ScrollController.startScroll(axis, dir));
      kh.onKeyUp(cmd, () => ScrollController.stopScroll());
    }

    kh.on("scrollHalfPageDown", () => {
      ScrollController.stopImmediate();
      const target = ScrollController.findScrollTarget("y");
      target.scrollBy({ top: Math.round(target.clientHeight / 2), behavior: "smooth" });
    });
    kh.on("scrollHalfPageUp", () => {
      ScrollController.stopImmediate();
      const target = ScrollController.findScrollTarget("y");
      target.scrollBy({ top: -Math.round(target.clientHeight / 2), behavior: "smooth" });
    });

    kh.on("scrollToTop", () => {
      ScrollController.stopImmediate();
      const target = ScrollController.findScrollTarget("y");
      target.scrollTo({ top: 0, behavior: "smooth" });
    });
    kh.on("scrollToBottom", () => {
      ScrollController.stopImmediate();
      const target = ScrollController.findScrollTarget("y");
      target.scrollTo({
        top: target.scrollHeight - target.clientHeight,
        behavior: "smooth",
      });
    });

    kh.on("goBack", () => history.back());
    kh.on("goForward", () => history.forward());
    kh.on("pageRefresh", () => location.reload());
  }

  destroy(): void {
    ScrollController.stopImmediate();
    const commands = [
      "scrollDown", "scrollUp", "scrollRight", "scrollLeft",
      "scrollHalfPageDown", "scrollHalfPageUp",
      "scrollToTop", "scrollToBottom",
      "goBack", "goForward", "pageRefresh",
    ];
    for (const cmd of commands) {
      this.keyHandler.off(cmd);
    }
  }
}
