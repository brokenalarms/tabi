// ScrollController — scroll target detection and scroll commands for Tabi
// Finds the correct scrollable element and performs directional/absolute scrolling.
//
// Step keys (j/k/h/l) use velocity-based scrolling: keydown starts a continuous
// RAF loop at a fixed speed, keyup decelerates to a stop via exponential smoothing.
// This avoids dependence on OS key repeat and produces smooth scrolling from frame 1.
//
// Jump commands (d/u, gg/G) delegate to native scrollTo/scrollBy with
// behavior: "smooth", letting the compositor handle the animation off main thread.

import { ScrollConfig } from "./constants";

type Axis = "x" | "y";

interface KeyHandlerLike {
  on(command: string, callback: () => void): void;
  onKeyUp(command: string, callback: () => void): void;
  off(command: string): void;
}

interface ChaseAnimation {
  targetX: number;
  targetY: number;
  rafId: number;
  lastTime: number;
}

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

  // --- Chase animation (exponential deceleration after j/k release) ---

  private static smoothScroll(
    target: Element,
    deltaX: number,
    deltaY: number,
  ): void {
    const existing = ScrollController.chaseAnimations.get(target);
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
      lastTime: 0,
    };

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
    if (v && v.axis === axis && v.direction === direction) return;

    ScrollController.stopVelocityImmediate();
    const target = ScrollController.findScrollTarget(axis);
    const chase = ScrollController.chaseAnimations.get(target);
    if (chase) {
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

    const remaining = ScrollConfig.scrollStep * v.direction;
    const dx = v.axis === "x" ? remaining : 0;
    const dy = v.axis === "y" ? remaining : 0;
    ScrollController.smoothScroll(v.target, dx, dy);
  }

  private static stopVelocityImmediate(): void {
    const v = ScrollController.velocity;
    if (!v) return;
    cancelAnimationFrame(v.rafId);
    const target = v.target;
    ScrollController.velocity = null;
    ScrollController.restoreSmoothScroll(target);
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
      kh.on(cmd, () => { ScrollController.startVelocity(axis, dir); this.onAction?.(); });
      kh.onKeyUp(cmd, () => ScrollController.stopVelocity());
    }

    kh.on("scrollHalfPageDown", () => {
      ScrollController.stopVelocityImmediate();
      const target = ScrollController.findScrollTarget("y");
      target.scrollBy({ top: Math.round(target.clientHeight / 2), behavior: "smooth" });
      this.onAction?.();
    });
    kh.on("scrollHalfPageUp", () => {
      ScrollController.stopVelocityImmediate();
      const target = ScrollController.findScrollTarget("y");
      target.scrollBy({ top: -Math.round(target.clientHeight / 2), behavior: "smooth" });
      this.onAction?.();
    });

    kh.on("scrollToTop", () => {
      ScrollController.stopVelocityImmediate();
      const target = ScrollController.findScrollTarget("y");
      target.scrollTo({ top: 0, behavior: "smooth" });
      this.onAction?.();
    });
    kh.on("scrollToBottom", () => {
      ScrollController.stopVelocityImmediate();
      const target = ScrollController.findScrollTarget("y");
      target.scrollTo({ top: target.scrollHeight - target.clientHeight, behavior: "smooth" });
      this.onAction?.();
    });

    kh.on("goBack", () => history.back());
    kh.on("goForward", () => history.forward());
    kh.on("pageRefresh", () => location.reload());
  }

  destroy(): void {
    ScrollController.stopVelocityImmediate();
    for (const [, chase] of ScrollController.chaseAnimations) {
      cancelAnimationFrame(chase.rafId);
    }
    ScrollController.chaseAnimations.clear();
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
