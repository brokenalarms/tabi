// ScrollController — scroll target detection and scroll commands for Tabi
// Finds the correct scrollable element and performs directional scrolling.
//
// Step keys (j/k/h/l) use a RAF loop for 60fps smooth scrolling: keydown
// starts continuous scrolling at a fixed speed, keyup stops immediately.
// Single-shot commands (d/u/gg/G) use the browser's scrollBy/scrollTo
// with behavior:"smooth".

type Axis = "x" | "y";

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  onKeyUp(command: string, callback: () => void): void;
  off(command: string): void;
}

export const ScrollConfig = {
  /** Scroll velocity (px/sec) for held j/k/h/l */
  scrollSpeed: 800,
};

interface VelocityScroll {
  target: Element;
  axis: Axis;
  direction: number;
  rafId: number;
  lastTime: number;
}

export class ScrollController {
  private keyHandler: KeyHandlerLike;
  private static velocity: VelocityScroll | null = null;

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

  // --- Velocity scroll (held j/k/h/l) ---

  private static startVelocity(axis: Axis, direction: number): void {
    const v = ScrollController.velocity;
    if (v && v.axis === axis && v.direction === direction) return;

    ScrollController.stopVelocity();
    const target = ScrollController.findScrollTarget(axis);

    const vel: VelocityScroll = {
      target,
      axis,
      direction,
      rafId: 0,
      lastTime: 0,
    };

    function step(now: number) {
      if (vel.lastTime === 0) {
        vel.lastTime = now;
        vel.rafId = requestAnimationFrame(step);
        return;
      }

      const dt = now - vel.lastTime;
      vel.lastTime = now;

      const px = ScrollConfig.scrollSpeed * (dt / 1000) * vel.direction;
      const before = vel.axis === "y" ? vel.target.scrollTop : vel.target.scrollLeft;

      if (vel.axis === "y") {
        vel.target.scrollTop += px;
      } else {
        vel.target.scrollLeft += px;
      }

      const after = vel.axis === "y" ? vel.target.scrollTop : vel.target.scrollLeft;
      if (after === before) {
        ScrollController.velocity = null;
        return;
      }

      vel.rafId = requestAnimationFrame(step);
    }

    ScrollController.velocity = vel;
    vel.rafId = requestAnimationFrame(step);
  }

  private static stopVelocity(): void {
    const v = ScrollController.velocity;
    if (!v) return;
    cancelAnimationFrame(v.rafId);
    ScrollController.velocity = null;
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
      kh.on(cmd, () => ScrollController.startVelocity(axis, dir));
      kh.onKeyUp(cmd, () => ScrollController.stopVelocity());
    }

    kh.on("scrollHalfPageDown", () => {
      ScrollController.stopVelocity();
      const target = ScrollController.findScrollTarget("y");
      target.scrollBy({ top: Math.round(target.clientHeight / 2), behavior: "smooth" });
    });
    kh.on("scrollHalfPageUp", () => {
      ScrollController.stopVelocity();
      const target = ScrollController.findScrollTarget("y");
      target.scrollBy({ top: -Math.round(target.clientHeight / 2), behavior: "smooth" });
    });

    kh.on("scrollToTop", () => {
      ScrollController.stopVelocity();
      const target = ScrollController.findScrollTarget("y");
      target.scrollTo({ top: 0, behavior: "smooth" });
    });
    kh.on("scrollToBottom", () => {
      ScrollController.stopVelocity();
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
    ScrollController.stopVelocity();
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
