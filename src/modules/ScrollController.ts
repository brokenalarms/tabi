// ScrollController — scroll target detection and scroll commands for Tabi
// Finds the correct scrollable element and performs directional/absolute scrolling.
// Uses requestAnimationFrame for smooth scrolling, since Safari does not reliably
// support CSS `behavior: "smooth"` on all elements.
//
// Step keys (j/k/h/l) use velocity-based scrolling: keydown starts a continuous
// RAF loop at a fixed speed, keyup decelerates to a stop via exponential smoothing.
// This avoids dependence on OS key repeat and produces smooth scrolling from frame 1.

import { ScrollConfig } from "./constants";

type Axis = "x" | "y";

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  onKeyUp(command: string, callback: () => void): void;
  off(command: string): void;
}

// --- Target-chase animation ---
// Two modes:
//   Exponential smoothing (deceleration after j/k release): converges on target
//     using a time constant.  Fast for small deltas.
//   Duration-based ease-in-out (d/u, gg/G): fixed-duration animation with a
//     cubic ease curve.  Matches native scroll feel for larger jumps.

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

interface ChaseAnimation {
  targetX: number;
  targetY: number;
  rafId: number;
  lastTime: number;
  // Duration mode fields (unset → exponential smoothing)
  startX?: number;
  startY?: number;
  startTime?: number;
  durationMs?: number;
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
  private keyHandler: KeyHandlerLike;
  /** Optional callback fired once per discrete scroll action (not per frame). */
  onAction: (() => void) | null = null;
  private static chaseAnimations = new Map<Element, ChaseAnimation>();
  private static velocity: VelocityScroll | null = null;
  /** Elements whose scroll-behavior we've overridden to "auto". */
  private static overriddenElements = new Set<HTMLElement>();

  /** Disable CSS scroll-behavior:smooth on the target so direct scrollTop/Left
   *  assignments aren't intercepted by the browser's smooth-scroll animation. */
  private static disableSmoothScroll(target: Element): void {
    const el = target as HTMLElement;
    if (!el.style) return;
    if (ScrollController.overriddenElements.has(el)) return;
    const style = getComputedStyle(target);
    if (style.scrollBehavior === "smooth") {
      el.style.scrollBehavior = "auto";
      ScrollController.overriddenElements.add(el);
    }
  }

  /** Restore scroll-behavior on a target when all animations on it are done. */
  private static restoreSmoothScroll(target: Element): void {
    const el = target as HTMLElement;
    if (!el.style) return;
    if (!ScrollController.overriddenElements.has(el)) return;
    // Only restore if no velocity or chase is still active on this target
    const v = ScrollController.velocity;
    if (v && v.target === target) return;
    if (ScrollController.chaseAnimations.has(target)) return;
    el.style.scrollBehavior = "";
    ScrollController.overriddenElements.delete(el);
  }

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

  // --- Chase animation (smooth scroll to target) ---

  private static smoothScroll(
    target: Element,
    deltaX: number,
    deltaY: number,
    durationMs?: number,
  ): void {
    const existing = ScrollController.chaseAnimations.get(target);
    if (existing) {
      const maxX = target.scrollWidth - target.clientWidth;
      const maxY = target.scrollHeight - target.clientHeight;
      existing.targetX = Math.max(0, Math.min(maxX, existing.targetX + deltaX));
      existing.targetY = Math.max(0, Math.min(maxY, existing.targetY + deltaY));
      // If switching to duration mode, reset start position for the new target
      if (durationMs !== undefined) {
        existing.startX = target.scrollLeft;
        existing.startY = target.scrollTop;
        existing.startTime = undefined; // re-record on next frame
        existing.durationMs = durationMs;
      }
      return;
    }

    const maxX = target.scrollWidth - target.clientWidth;
    const maxY = target.scrollHeight - target.clientHeight;
    const anim: ChaseAnimation = {
      targetX: Math.max(0, Math.min(maxX, target.scrollLeft + deltaX)),
      targetY: Math.max(0, Math.min(maxY, target.scrollTop + deltaY)),
      rafId: 0,
      lastTime: 0,
    };

    if (durationMs !== undefined) {
      anim.startX = target.scrollLeft;
      anim.startY = target.scrollTop;
      anim.durationMs = durationMs;
    }

    function finish() {
      target.scrollLeft = anim.targetX;
      target.scrollTop = anim.targetY;
      ScrollController.chaseAnimations.delete(target);
      ScrollController.restoreSmoothScroll(target);
    }

    function step(now: number) {
      if ("isConnected" in target && !target.isConnected) {
        ScrollController.chaseAnimations.delete(target);
        ScrollController.restoreSmoothScroll(target);
        return;
      }

      // --- Duration mode: ease-in-out over fixed time ---
      if (anim.durationMs !== undefined) {
        if (anim.startTime === undefined) {
          anim.startTime = now;
        }
        const elapsed = now - anim.startTime;
        const progress = Math.min(1, elapsed / anim.durationMs);
        const eased = easeInOutCubic(progress);

        target.scrollLeft = anim.startX! + (anim.targetX - anim.startX!) * eased;
        target.scrollTop = anim.startY! + (anim.targetY - anim.startY!) * eased;

        if (progress >= 1) { finish(); return; }
        anim.rafId = requestAnimationFrame(step);
        return;
      }

      // --- Exponential mode: deceleration ---
      if (anim.lastTime === 0) {
        anim.lastTime = now;
        anim.rafId = requestAnimationFrame(step);
        return;
      }

      const dt = now - anim.lastTime;
      anim.lastTime = now;

      const beforeX = target.scrollLeft;
      const beforeY = target.scrollTop;
      const remainingX = anim.targetX - beforeX;
      const remainingY = anim.targetY - beforeY;

      if (Math.abs(remainingX) < ScrollConfig.snapThreshold &&
          Math.abs(remainingY) < ScrollConfig.snapThreshold) {
        finish();
        return;
      }

      const factor = 1 - Math.exp(-dt / ScrollConfig.smoothTimeMs);
      target.scrollLeft += remainingX * factor;
      target.scrollTop += remainingY * factor;

      if (target.scrollLeft === beforeX && target.scrollTop === beforeY) {
        finish();
        return;
      }

      anim.rafId = requestAnimationFrame(step);
    }

    ScrollController.disableSmoothScroll(target);
    ScrollController.chaseAnimations.set(target, anim);
    anim.rafId = requestAnimationFrame(step);
  }

  // --- Velocity scroll ---

  private static startVelocity(axis: Axis, direction: number): void {
    const v = ScrollController.velocity;
    // Already scrolling in same direction — ignore key repeat
    if (v && v.axis === axis && v.direction === direction) return;

    // Stop any existing velocity or chase on this target
    ScrollController.stopVelocityImmediate();
    const target = ScrollController.findScrollTarget(axis);
    const chase = ScrollController.chaseAnimations.get(target);
    if (chase) {
      // Don't snap — just stop the previous motion where it is and
      // start the new direction from the current position.
      cancelAnimationFrame(chase.rafId);
      ScrollController.chaseAnimations.delete(target);
    }

    const vel: VelocityScroll = {
      target,
      axis,
      direction,
      rafId: 0,
      lastTime: 0,
    };

    function step(now: number) {
      // First frame: record timestamp, no movement yet
      if (vel.lastTime === 0) {
        vel.lastTime = now;
        vel.rafId = requestAnimationFrame(step);
        return;
      }

      const dt = now - vel.lastTime;
      vel.lastTime = now;

      if ("isConnected" in vel.target && !vel.target.isConnected) {
        ScrollController.velocity = null;
        ScrollController.restoreSmoothScroll(vel.target);
        return;
      }

      const px = ScrollConfig.scrollSpeed * (dt / 1000) * vel.direction;

      if (vel.axis === "y") {
        vel.target.scrollTop += px;
      } else {
        vel.target.scrollLeft += px;
      }

      vel.rafId = requestAnimationFrame(step);
    }

    ScrollController.disableSmoothScroll(target);
    ScrollController.velocity = vel;
    vel.rafId = requestAnimationFrame(step);
  }

  private static stopVelocity(): void {
    const v = ScrollController.velocity;
    if (!v) return;
    cancelAnimationFrame(v.rafId);
    ScrollController.velocity = null;

    // Hand off momentum for smooth deceleration
    const remaining = ScrollConfig.scrollStep * v.direction;
    const dx = v.axis === "x" ? remaining : 0;
    const dy = v.axis === "y" ? remaining : 0;
    ScrollController.smoothScroll(v.target, dx, dy);
  }

  private static stopVelocityImmediate(): void {
    const v = ScrollController.velocity;
    if (!v) return;
    cancelAnimationFrame(v.rafId);
    ScrollController.velocity = null;
    // Don't restore smooth scroll — callers (scrollToTop, scrollHalfPageDown,
    // etc.) start a new animation right after, so the override must stay.
    // destroy() handles final cleanup.
  }

  // --- Scroll operations ---

  static scrollBy(axis: Axis, delta: number, durationMs?: number): void {
    const target = ScrollController.findScrollTarget(axis);
    const dx = axis === "x" ? delta : 0;
    const dy = axis === "y" ? delta : 0;
    ScrollController.smoothScroll(target, dx, dy, durationMs);
  }

  static scrollToTop(): void {
    ScrollController.stopVelocityImmediate();
    const target = ScrollController.findScrollTarget("y");
    ScrollController.cancelChase(target);
    const dy = -target.scrollTop;
    ScrollController.smoothScroll(target, 0, dy, ScrollConfig.scrollDurationMs);
  }

  static scrollToBottom(): void {
    ScrollController.stopVelocityImmediate();
    const target = ScrollController.findScrollTarget("y");
    ScrollController.cancelChase(target);
    const dy = target.scrollHeight - target.clientHeight - target.scrollTop;
    ScrollController.smoothScroll(target, 0, dy, ScrollConfig.scrollDurationMs);
  }

  private static cancelChase(target: Element): void {
    const existing = ScrollController.chaseAnimations.get(target);
    if (existing) {
      cancelAnimationFrame(existing.rafId);
      ScrollController.chaseAnimations.delete(target);
      // Don't restore smooth scroll here — callers always start a new
      // animation immediately, which keeps the override active.  The
      // restore→disable flip between cancelChase and the next smoothScroll
      // caused Safari to briefly re-enable CSS smooth scrolling, producing
      // visible jumps on half-page and absolute scroll commands.
    }
  }

  // --- Command wiring ---

  private wireCommands(): void {
    const kh = this.keyHandler;

    // Step scrolls: keydown starts velocity, keyup decelerates
    const scrollCmds: [string, Axis, number][] = [
      ["scrollDown", "y", 1],
      ["scrollUp", "y", -1],
      ["scrollRight", "x", 1],
      ["scrollLeft", "x", -1],
    ];
    for (const [cmd, axis, dir] of scrollCmds) {
      kh.on(cmd, () => { ScrollController.startVelocity(axis, dir); this.onAction?.(); });
      kh.onKeyUp(cmd, () => ScrollController.stopVelocity());
    }

    kh.on("scrollHalfPageDown", () => {
      ScrollController.stopVelocityImmediate();
      const target = ScrollController.findScrollTarget("y");
      ScrollController.cancelChase(target);
      ScrollController.scrollBy("y", Math.round(target.clientHeight / 2), ScrollConfig.scrollDurationMs);
      this.onAction?.();
    });
    kh.on("scrollHalfPageUp", () => {
      ScrollController.stopVelocityImmediate();
      const target = ScrollController.findScrollTarget("y");
      ScrollController.cancelChase(target);
      ScrollController.scrollBy("y", -Math.round(target.clientHeight / 2), ScrollConfig.scrollDurationMs);
      this.onAction?.();
    });

    kh.on("scrollToTop", () => { ScrollController.scrollToTop(); this.onAction?.(); });
    kh.on("scrollToBottom", () => { ScrollController.scrollToBottom(); this.onAction?.(); });

    kh.on("goBack", () => history.back());
    kh.on("goForward", () => history.forward());
    kh.on("pageRefresh", () => location.reload());
  }

  destroy(): void {
    ScrollController.stopVelocityImmediate();
    // Cancel any running chase animations
    for (const [, chase] of ScrollController.chaseAnimations) {
      cancelAnimationFrame(chase.rafId);
    }
    ScrollController.chaseAnimations.clear();
    // Restore smooth scroll on all overridden elements
    for (const el of ScrollController.overriddenElements) {
      el.style.scrollBehavior = "";
    }
    ScrollController.overriddenElements.clear();
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
