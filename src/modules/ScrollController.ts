// ScrollController — scroll target detection and scroll commands for Tabi
// Finds the correct scrollable element and performs directional/absolute scrolling.
// Uses requestAnimationFrame for smooth scrolling, since Safari does not reliably
// support CSS `behavior: "smooth"` on all elements.
//
// Step keys (j/k/h/l) use velocity-based scrolling: keydown starts a continuous
// RAF loop at a fixed speed, keyup decelerates to a stop via exponential smoothing.
// This avoids dependence on OS key repeat and produces smooth scrolling from frame 1.

type Axis = "x" | "y";

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  onKeyUp(command: string, callback: () => void): void;
  off(command: string): void;
}

export const ScrollConfig = {
  /** Scroll velocity (px/sec) for held j/k/h/l */
  scrollSpeed: 800,
  /** Pixels per single j/k tap (keydown→keyup with no hold) */
  scrollStep: 60,
  /** Smoothing time constant (ms) for deceleration and gg/G */
  smoothTimeMs: 120,
  /** Snap threshold (px) — stop animating when this close to target */
  snapThreshold: 0.5,
};

// --- Target-chase animation (exponential smoothing) ---
// Used for gg/G, half-page, and deceleration after key release.

interface ChaseAnimation {
  targetX: number;
  targetY: number;
  rafId: number;
  lastTime: number;
}

// --- Velocity-based continuous scroll (held keys) ---

interface VelocityScroll {
  target: Element;
  axis: Axis;
  direction: number; // +1 or -1
  rafId: number;
  lastTime: number;
}

export class ScrollController {
  private _keyHandler: KeyHandlerLike;
  private static _chaseAnimations = new Map<Element, ChaseAnimation>();
  private static _velocity: VelocityScroll | null = null;
  /** Elements whose scroll-behavior we've overridden to "auto". */
  private static _overriddenElements = new Set<HTMLElement>();

  /** Disable CSS scroll-behavior:smooth on the target so direct scrollTop/Left
   *  assignments aren't intercepted by the browser's smooth-scroll animation. */
  private static _disableSmoothScroll(target: Element): void {
    const el = target as HTMLElement;
    if (!el.style) return;
    if (ScrollController._overriddenElements.has(el)) return;
    const style = getComputedStyle(target);
    if (style.scrollBehavior === "smooth") {
      el.style.scrollBehavior = "auto";
      ScrollController._overriddenElements.add(el);
    }
  }

  /** Restore scroll-behavior on a target when all animations on it are done. */
  private static _restoreSmoothScroll(target: Element): void {
    const el = target as HTMLElement;
    if (!el.style) return;
    if (!ScrollController._overriddenElements.has(el)) return;
    // Only restore if no velocity or chase is still active on this target
    const v = ScrollController._velocity;
    if (v && v.target === target) return;
    if (ScrollController._chaseAnimations.has(target)) return;
    el.style.scrollBehavior = "";
    ScrollController._overriddenElements.delete(el);
  }

  constructor(keyHandler: KeyHandlerLike) {
    this._keyHandler = keyHandler;
    this._wireCommands();
  }

  // --- Scroll target detection ---

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

  // --- Chase animation (smooth scroll to target) ---

  private static _smoothScroll(
    target: Element,
    deltaX: number,
    deltaY: number,
  ): void {
    const existing = ScrollController._chaseAnimations.get(target);
    if (existing) {
      const maxX = target.scrollWidth - target.clientWidth;
      const maxY = target.scrollHeight - target.clientHeight;
      existing.targetX = Math.max(0, Math.min(maxX, existing.targetX + deltaX));
      existing.targetY = Math.max(0, Math.min(maxY, existing.targetY + deltaY));
      return;
    }

    const maxX = target.scrollWidth - target.clientWidth;
    const maxY = target.scrollHeight - target.clientHeight;
    const anim: ChaseAnimation = {
      targetX: Math.max(0, Math.min(maxX, target.scrollLeft + deltaX)),
      targetY: Math.max(0, Math.min(maxY, target.scrollTop + deltaY)),
      rafId: 0,
      lastTime: 0, // 0 = first frame not yet recorded
    };

    function step(now: number) {
      // First frame: just record the timestamp, skip computation.
      // Guarantees the next frame has a real dt (~16ms).
      if (anim.lastTime === 0) {
        anim.lastTime = now;
        anim.rafId = requestAnimationFrame(step);
        return;
      }

      const dt = now - anim.lastTime;
      anim.lastTime = now;

      if ("isConnected" in target && !target.isConnected) {
        ScrollController._chaseAnimations.delete(target);
        ScrollController._restoreSmoothScroll(target);
        return;
      }

      const beforeX = target.scrollLeft;
      const beforeY = target.scrollTop;
      const remainingX = anim.targetX - beforeX;
      const remainingY = anim.targetY - beforeY;

      if (Math.abs(remainingX) < ScrollConfig.snapThreshold &&
          Math.abs(remainingY) < ScrollConfig.snapThreshold) {
        target.scrollLeft = anim.targetX;
        target.scrollTop = anim.targetY;
        ScrollController._chaseAnimations.delete(target);
        ScrollController._restoreSmoothScroll(target);
        return;
      }

      const factor = 1 - Math.exp(-dt / ScrollConfig.smoothTimeMs);
      target.scrollLeft += remainingX * factor;
      target.scrollTop += remainingY * factor;

      // Sub-pixel rounding prevented movement — snap to close any remaining gap
      if (target.scrollLeft === beforeX && target.scrollTop === beforeY) {
        target.scrollLeft = anim.targetX;
        target.scrollTop = anim.targetY;
        ScrollController._chaseAnimations.delete(target);
        ScrollController._restoreSmoothScroll(target);
        return;
      }

      anim.rafId = requestAnimationFrame(step);
    }

    ScrollController._disableSmoothScroll(target);
    ScrollController._chaseAnimations.set(target, anim);
    anim.rafId = requestAnimationFrame(step);
  }

  // --- Velocity scroll ---

  private static _startVelocity(axis: Axis, direction: number): void {
    const v = ScrollController._velocity;
    // Already scrolling in same direction — ignore key repeat
    if (v && v.axis === axis && v.direction === direction) return;

    // Stop any existing velocity or chase on this target
    ScrollController._stopVelocityImmediate();
    const target = ScrollController.findScrollTarget(axis);
    const chase = ScrollController._chaseAnimations.get(target);
    if (chase) {
      // Don't snap — just stop the previous motion where it is and
      // start the new direction from the current position.
      cancelAnimationFrame(chase.rafId);
      ScrollController._chaseAnimations.delete(target);
    }

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

      if ("isConnected" in vel.target && !vel.target.isConnected) {
        ScrollController._velocity = null;
        ScrollController._restoreSmoothScroll(vel.target);
        return;
      }

      const px = ScrollConfig.scrollSpeed * (dt / 1000) * vel.direction;
      const before = vel.axis === "y" ? vel.target.scrollTop : vel.target.scrollLeft;

      if (vel.axis === "y") {
        vel.target.scrollTop += px;
      } else {
        vel.target.scrollLeft += px;
      }

      const after = vel.axis === "y" ? vel.target.scrollTop : vel.target.scrollLeft;

      // Hit boundary
      if (after === before) {
        ScrollController._velocity = null;
        ScrollController._restoreSmoothScroll(vel.target);
        return;
      }

      vel.rafId = requestAnimationFrame(step);
    }

    ScrollController._disableSmoothScroll(target);
    ScrollController._velocity = vel;
    vel.rafId = requestAnimationFrame(step);
  }

  private static _stopVelocity(): void {
    const v = ScrollController._velocity;
    if (!v) return;
    cancelAnimationFrame(v.rafId);
    ScrollController._velocity = null;

    // Hand off momentum for smooth deceleration
    const remaining = ScrollConfig.scrollStep * v.direction;
    const dx = v.axis === "x" ? remaining : 0;
    const dy = v.axis === "y" ? remaining : 0;
    ScrollController._smoothScroll(v.target, dx, dy);
  }

  private static _stopVelocityImmediate(): void {
    const v = ScrollController._velocity;
    if (!v) return;
    cancelAnimationFrame(v.rafId);
    ScrollController._velocity = null;
    ScrollController._restoreSmoothScroll(v.target);
  }

  // --- Scroll operations ---

  static scrollBy(axis: Axis, delta: number): void {
    const target = ScrollController.findScrollTarget(axis);
    const dx = axis === "x" ? delta : 0;
    const dy = axis === "y" ? delta : 0;
    ScrollController._smoothScroll(target, dx, dy);
  }

  static scrollToTop(): void {
    ScrollController._stopVelocityImmediate();
    const target = ScrollController.findScrollTarget("y");
    ScrollController._cancelChase(target);
    const dy = -target.scrollTop;
    ScrollController._smoothScroll(target, 0, dy);
  }

  static scrollToBottom(): void {
    ScrollController._stopVelocityImmediate();
    const target = ScrollController.findScrollTarget("y");
    ScrollController._cancelChase(target);
    const dy = target.scrollHeight - target.clientHeight - target.scrollTop;
    ScrollController._smoothScroll(target, 0, dy);
  }

  private static _cancelChase(target: Element): void {
    const existing = ScrollController._chaseAnimations.get(target);
    if (existing) {
      cancelAnimationFrame(existing.rafId);
      ScrollController._chaseAnimations.delete(target);
      ScrollController._restoreSmoothScroll(target);
    }
  }

  // --- Command wiring ---

  private _wireCommands(): void {
    const kh = this._keyHandler;

    // Step scrolls: keydown starts velocity, keyup decelerates
    const scrollCmds: [string, Axis, number][] = [
      ["scrollDown", "y", 1],
      ["scrollUp", "y", -1],
      ["scrollRight", "x", 1],
      ["scrollLeft", "x", -1],
    ];
    for (const [cmd, axis, dir] of scrollCmds) {
      kh.on(cmd, () => ScrollController._startVelocity(axis, dir));
      kh.onKeyUp(cmd, () => ScrollController._stopVelocity());
    }

    kh.on("scrollHalfPageDown", () => {
      ScrollController._stopVelocityImmediate();
      const target = ScrollController.findScrollTarget("y");
      ScrollController._cancelChase(target);
      ScrollController.scrollBy("y", Math.round(target.clientHeight / 2));
    });
    kh.on("scrollHalfPageUp", () => {
      ScrollController._stopVelocityImmediate();
      const target = ScrollController.findScrollTarget("y");
      ScrollController._cancelChase(target);
      ScrollController.scrollBy("y", -Math.round(target.clientHeight / 2));
    });

    kh.on("scrollToTop", () => ScrollController.scrollToTop());
    kh.on("scrollToBottom", () => ScrollController.scrollToBottom());

    kh.on("goBack", () => history.back());
    kh.on("goForward", () => history.forward());
    kh.on("pageRefresh", () => location.reload());
  }

  destroy(): void {
    ScrollController._stopVelocityImmediate();
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
