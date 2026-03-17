// HintMode — link-hint overlay for Vimium
// Renders labeled hints over discovered elements and dispatches
// clicks when the user types the matching label characters.

import type { ModeValue } from "../types";
import { DEFAULTS } from "../types";
import { REPEATING_CONTAINER_SELECTOR } from "./constants";
import { discoverElements, renderDebugDots } from "./ElementGatherer";
import { isContainerSized, getRepeatingContainer, hasBox, isRedirectableControl, isVisible, isZeroSizeAnchor, shouldRedirectToHeading } from "./elementPredicates";
import { findAssociatedLabel, findVisibleChild, getHeading } from "./elementTraversals";

import { Mode } from "../commands";

/** Walk up through single-child ancestors to the nearest repeating container
 *  (li, tr) for hint width expansion.  Only repeating containers benefit from
 *  expansion — they create vertical lists where aligned hints aid scanning.
 *  Skips boxless ancestors (display:contents/none).
 *  Stops at body/documentElement, or when a parent has multiple children. */
export function findBlockAncestor(el: HTMLElement): HTMLElement | null {
  let node = el;
  while (node.parentElement) {
    const parent = node.parentElement;
    if (parent === document.body || parent === document.documentElement) return null;
    if (parent.children.length !== 1) return null;
    if (parent.matches(REPEATING_CONTAINER_SELECTOR) && hasBox(parent)) return parent;
    node = parent;
  }
  return null;
}

declare const browser: {
  runtime: {
    sendMessage(message: { command: string; url?: string }): void;
  };
};

interface KeyHandlerLike {
  setMode(mode: ModeValue): void;
  setModeKeyDelegate(handler: (event: KeyboardEvent) => boolean): void;
  clearModeKeyDelegate(): void;
  on(command: string, callback: () => void): void;
  off(command: string): void;
}

interface Hint {
  element: HTMLElement;
  label: string;
  div: HTMLDivElement;
}

const enum HintStyle { Pill, ContainerGlow }

type HintPlacement =
  | { style: HintStyle.Pill; rect: DOMRect }
  | { style: HintStyle.ContainerGlow; rect: DOMRect; container: HTMLElement };

const HINT_CHARS = "sadgjklewcmpoh";

/** How far (px) a hinted element may drift before we dismiss hints. */
const DRIFT_THRESHOLD = 5;
/** How often (ms) we check for position drift. */
const DRIFT_CHECK_INTERVAL = 200;

export class HintMode {
  private keyHandler: KeyHandlerLike;
  private active: boolean;
  private willOpenNewTab: boolean;
  private hints: Hint[];
  private typed: string;
  private overlay: HTMLDivElement | null;
  private activating: boolean;
  private readonly onMouseDown: () => void;
  private readonly onScroll: () => void;
  private readonly onResize: () => void;
  private driftTimer: ReturnType<typeof setInterval> | null;
  /** Resolved hint placement for each discovered element. Populated in activate(). */
  private hintPlacementMap: Map<HTMLElement, HintPlacement>;

  constructor(keyHandler: KeyHandlerLike) {
    this.keyHandler = keyHandler;
    this.active = false;
    this.willOpenNewTab = false;
    this.hints = [];
    this.typed = "";
    this.overlay = null;
    this.activating = false;
    this.onMouseDown = this.deactivate.bind(this);
    this.onScroll = this.deactivate.bind(this);
    this.onResize = this.deactivate.bind(this);
    this.driftTimer = null;
    this.hintPlacementMap = new Map();
  }

  // --- Public API ---

  activate(shiftHeld: boolean): void {
    if (this.active) {
      this.deactivate();
      return;
    }
    this.willOpenNewTab = shiftHeld;
    this.active = true;
    this.typed = "";
    this.keyHandler.setMode(Mode.HINTS);

    const elements = discoverElements((el: HTMLElement) => this.getHintRect(el));
    if (elements.length === 0) {
      this.deactivate();
      return;
    }

    // Resolve hint placement for each element. Container glow requires a
    // repeating container that is large enough and contains no other
    // discovered elements. Everything else gets a pill.
    for (const el of elements) {
      const rect = this.getHintRect(el);
      const target = this.getHintTargetElement(el);
      const repeatingContainer = target === el ? getRepeatingContainer(el) : null;
      if (repeatingContainer) {
        const containerRect = repeatingContainer.getBoundingClientRect();
        const sole = !elements.some(other => other !== el && repeatingContainer.contains(other));
        if (isContainerSized(repeatingContainer, containerRect) && sole) {
          this.hintPlacementMap.set(el, { style: HintStyle.ContainerGlow, rect, container: repeatingContainer });
          continue;
        }
      }
      this.hintPlacementMap.set(el, { style: HintStyle.Pill, rect });
    }

    const labels = HintMode.generateLabels(elements.length);
    this.createOverlay();
    if (this.overlay) renderDebugDots(this.overlay, elements);
    this.hints = elements.map((el, i) => {
      const label = labels[i];
      const div = this.createHintDiv(el, label);
      return { element: el, label, div };
    });

    this.keyHandler.setModeKeyDelegate(this.handleKey.bind(this));
    document.addEventListener("mousedown", this.onMouseDown, true);
    window.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("resize", this.onResize);
    this.startDriftCheck();
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.typed = "";
    this.willOpenNewTab = false;
    this.activating = false;
    this.keyHandler.clearModeKeyDelegate();
    document.removeEventListener("mousedown", this.onMouseDown, true);
    window.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("resize", this.onResize);
    if (this.driftTimer !== null) {
      clearInterval(this.driftTimer);
      this.driftTimer = null;
    }

    // Remove any orphaned focus rings (e.g. deactivation interrupted the
    // hint collapse animation before afterCollapse could clean up).
    // Skip rings that are already fading out — those will self-remove on animationend.
    for (const ring of document.documentElement.querySelectorAll(".vimium-hint-ring:not(.vimium-hint-ring-out)")) {
      ring.remove();
    }

    if (this.overlay) {
      this.overlay.classList.remove("visible");
      const overlay = this.overlay;
      overlay.addEventListener("transitionend", () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, { once: true });
      this.overlay = null;
    }

    this.hints = [];
    this.hintPlacementMap.clear();
    this.keyHandler.setMode(Mode.NORMAL);
  }

  isActive(): boolean {
    return this.active;
  }

  wireCommands(): void {
    this.keyHandler.on("activateHints", () => this.activate(false));
    this.keyHandler.on("activateHintsNewTab", () => this.activate(true));
  }

  unwireCommands(): void {
    this.keyHandler.off("activateHints");
    this.keyHandler.off("activateHintsNewTab");
  }

  destroy(): void {
    this.deactivate();
    this.unwireCommands();
  }

  // --- Layout drift detection ---

  /** Periodically sample a few hinted elements and dismiss if any have
   *  moved more than DRIFT_THRESHOLD pixels from their original position.
   *  Catches layout shifts from lazy-loaded content, ad injection, etc. */
  private startDriftCheck(): void {
    this.driftTimer = setInterval(() => {
      for (const [el, placement] of this.hintPlacementMap) {
        const current = el.getBoundingClientRect();
        const original = placement.rect;
        if (Math.abs(current.top - original.top) > DRIFT_THRESHOLD ||
            Math.abs(current.left - original.left) > DRIFT_THRESHOLD) {
          this.deactivate();
          return;
        }
      }
    }, DRIFT_CHECK_INTERVAL);
  }

  // --- Hint target element ---

  private getHintTargetElement(el: HTMLElement): HTMLElement {
    const rect = el.getBoundingClientRect();

    if (isRedirectableControl(el) && !isVisible(el, rect)) {
      const label = findAssociatedLabel(el);
      if (label) return label;
    }
    if (isZeroSizeAnchor(el, rect)) {
      const child = findVisibleChild(el);
      if (child) return child;
    }
    if (shouldRedirectToHeading(el)) {
      return getHeading(el)!;
    }
    return el;
  }

  private getHintRect(el: HTMLElement): DOMRect {
    const target = this.getHintTargetElement(el);
    let rect = target.getBoundingClientRect();
    const inRepeatingContainer = target === el && getRepeatingContainer(el) !== null;

    // Inline elements in vertical lists: expand to nearest repeating container's
    // width so hints align. Walks up through single-child wrappers (e.g.
    // <li><span><a>text</a></span></li> expands to <li> width).
    const tag = target.tagName.toLowerCase();
    const isFormControl = tag === "input" || tag === "textarea" || tag === "select";
    if (!isFormControl) {
      const blockAncestor = findBlockAncestor(target);
      if (blockAncestor) {
        const hasMixedContent = Array.from(blockAncestor.childNodes).some(
          n => n.nodeType === 3 && (n.textContent || "").trim().length > 0
        );
        if (!hasMixedContent) {
          const ancestorRect = blockAncestor.getBoundingClientRect();
          rect = new DOMRect(ancestorRect.left, rect.top, ancestorRect.width, rect.height);
        }
      }
    }

    // Narrow rect horizontally to the children's content extent so the hint
    // centers on visible content, not an empty stretched box (e.g. Reddit's
    // flex <a> grid items that are wider than their SVG+text content).
    // Only for <a> links — buttons and role-based elements define their own area.
    if (!inRepeatingContainer && target.tagName.toLowerCase() === "a" && target.children.length > 0) {
      let contentLeft = Infinity, contentRight = -Infinity;
      for (const child of target.children) {
        const cr = (child as HTMLElement).getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) {
          contentLeft = Math.min(contentLeft, cr.left);
          contentRight = Math.max(contentRight, cr.right);
        }
      }
      if (contentLeft < contentRight) {
        rect = new DOMRect(contentLeft, rect.top, contentRight - contentLeft, rect.height);
      }
    }

    // Shrink rect by padding-bottom so the hint pointer touches the content
    // edge rather than floating below the padding (e.g. MediaWiki sidebar links).
    // Only for <a> pill hints — buttons use padding as part of their visual area.
    // Redirected targets (heading, label) use their full bounding rect.
    if (el === target && !inRepeatingContainer && el.tagName.toLowerCase() === "a") {
      const paddingBottom = parseFloat(getComputedStyle(target).paddingBottom) || 0;
      if (paddingBottom > 0) {
        rect = new DOMRect(rect.left, rect.top, rect.width, rect.height - paddingBottom);
      }
    }

    return rect;
  }

  // --- Label generation ---

  static generateLabels(count: number): string[] {
    if (count <= 0) return [];
    const chars = HINT_CHARS.split("");
    const base = chars.length;

    let len = 1;
    let capacity = base;
    while (capacity < count) {
      len++;
      capacity = Math.pow(base, len);
    }

    const labels: string[] = [];
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

  private viewportToDocument(x: number, y: number): { x: number; y: number } {
    const docEl = document.documentElement;
    const rect = docEl.getBoundingClientRect();
    const style = getComputedStyle(docEl);
    if (style.position === "static" && !/content|paint|strict/.test(style.contain || "")) {
      const marginTop = parseFloat(style.marginTop) || 0;
      const marginLeft = parseFloat(style.marginLeft) || 0;
      return { x: x - rect.left + marginLeft, y: y - rect.top + marginTop };
    } else {
      const clientTop = docEl.clientTop;
      const clientLeft = docEl.clientLeft;
      return { x: x - rect.left - clientLeft, y: y - rect.top - clientTop };
    }
  }

  private createOverlay(): void {
    // Remove any stale overlay left from a previous activation whose
    // transitionend didn't fire (e.g. rapid toggle, animations disabled).
    const stale = document.documentElement.querySelector(".vimium-hint-overlay");
    if (stale) stale.remove();

    this.overlay = document.createElement("div");
    this.overlay.className = `vimium-hint-overlay${DEFAULTS.animate ? " vimium-hint-animate" : ""}`;
    document.documentElement.appendChild(this.overlay);
    void this.overlay.offsetHeight;
    this.overlay.classList.add("visible");
  }

  private createHintDiv(element: HTMLElement, label: string): HTMLDivElement {
    const placement = this.hintPlacementMap.get(element);
    const div = document.createElement("div");
    div.className = "vimium-hint";
    div.textContent = label;

    if (placement) {
      switch (placement.style) {
        case HintStyle.ContainerGlow:
          this.positionContainerGlow(div, placement.container);
          break;
        case HintStyle.Pill:
          this.positionPill(div, placement.rect);
          break;
      }
    }

    if (this.overlay) this.overlay.appendChild(div);
    return div;
  }

  /** Glow border on repeating container + inside-end pill label. */
  private positionContainerGlow(div: HTMLDivElement, container: HTMLElement): void {
    const glowRect = container.getBoundingClientRect();
    const cs = getComputedStyle(container);
    const glow = document.createElement("div");
    glow.className = "vimium-hint-container-glow";
    const glowPos = this.viewportToDocument(glowRect.left, glowRect.top);
    glow.style.left = glowPos.x + "px";
    glow.style.top = glowPos.y + "px";
    glow.style.width = glowRect.width + "px";
    glow.style.height = glowRect.height + "px";
    if (this.overlay) this.overlay.appendChild(glow);

    const padding = Math.max(
      parseFloat(cs.paddingRight) || 0,
      parseFloat(cs.paddingTop) || 0,
      parseFloat(cs.paddingBottom) || 0
    );
    const insetRight = Math.min(Math.max(6, padding), 24);
    const pos = this.viewportToDocument(
      glowRect.right - insetRight,
      glowRect.top + glowRect.height / 2
    );
    div.style.left = pos.x + "px";
    div.style.top = pos.y + "px";
    div.style.transform = "translate(-100%, -50%)";
  }

  /** Pill below element with pointer tail. */
  private positionPill(div: HTMLDivElement, rect: DOMRect): void {
    const pos = this.viewportToDocument(rect.left + rect.width / 2, rect.bottom + 2);
    div.style.left = Math.max(0, pos.x) + "px";
    div.style.top = Math.max(0, pos.y) + "px";
    div.style.transform = "translateX(-50%)";
    const tail = document.createElement("div");
    tail.className = "vimium-hint-tail";
    div.appendChild(tail);
  }

  // --- Key handling ---

  private handleKey(event: KeyboardEvent): boolean {
    if (!this.active) return false;

    if (this.activating) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (event.code === "KeyF" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.deactivate();
      return true;
    }

    if (event.code === "Escape") return false;

    event.preventDefault();
    event.stopPropagation();

    if (event.code === "Backspace") {
      if (this.typed.length > 0) {
        this.typed = this.typed.slice(0, -1);
        this.updateHintVisibility();
      }
      return true;
    }

    const char = event.key ? event.key.toLowerCase() : "";
    if (!HINT_CHARS.includes(char) || char.length !== 1) {
      this.deactivate();
      return true;
    }

    this.typed += char;
    this.updateHintVisibility();

    if (!this.hints.some(h => h.label.startsWith(this.typed))) {
      this.deactivate();
      return true;
    }

    const match = this.hints.find((h) => h.label === this.typed);
    if (match) {
      if (event.shiftKey) {
        this.willOpenNewTab = true;
      }
      this.activateHint(match);
    }
    return true;
  }

  private updateHintVisibility(): void {
    for (const hint of this.hints) {
      const matches = hint.label.startsWith(this.typed);
      hint.div.style.display = matches ? "" : "none";
      if (matches) {
        const matched = hint.label.slice(0, this.typed.length);
        const remaining = hint.label.slice(this.typed.length);
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

  private activateHint(hint: Hint): void {
    const element = hint.element;
    const newTab = this.willOpenNewTab;
    this.activating = true;

    for (const h of this.hints) {
      if (h !== hint) h.div.style.display = "none";
    }

    const placement = this.hintPlacementMap.get(element);
    if (!placement) return;
    const targetRect = placement.rect;
    const tagRect = hint.div.getBoundingClientRect();
    if (tagRect.width > 0) {
      const dx = (targetRect.left + targetRect.width / 2) - (tagRect.left + tagRect.width / 2);
      const dy = (targetRect.top + targetRect.height / 2) - (tagRect.top + tagRect.height / 2);
      hint.div.style.setProperty("--poof-x", dx + "px");
      hint.div.style.setProperty("--poof-y", dy + "px");
    }

    hint.div.classList.add("vimium-hint-active");

    // Focus ring around the full clickable element (not the text target)
    const ring = document.createElement("div");
    ring.className = "vimium-hint-ring";
    const ringRect = element.getBoundingClientRect();
    const pos = this.viewportToDocument(ringRect.left, ringRect.top);
    ring.style.left = pos.x - 2 + "px";
    ring.style.top = pos.y - 2 + "px";
    ring.style.width = ringRect.width + 4 + "px";
    ring.style.height = ringRect.height + 4 + "px";
    document.documentElement.appendChild(ring);

    const afterCollapse = (): void => {
      // If hints were already torn down (e.g. by mutation observer during
      // the collapse animation), skip the click — the target may have
      // moved and the ring was already cleaned up by deactivate().
      const wasActive = this.active;
      this.deactivate();
      if (!wasActive) {
        ring.remove();
        return;
      }

      const isLink = element.tagName.toLowerCase() === "a" && (element as HTMLAnchorElement).href;
      const opensNewWindow = isLink && (newTab || (element as HTMLAnchorElement).target === "_blank");

      if (opensNewWindow) {
        browser.runtime.sendMessage({
          command: "createTab",
          url: (element as HTMLAnchorElement).href,
        });
      } else {
        element.focus();
        element.style.outline = "none";
        element.addEventListener("blur", () => { element.style.outline = ""; }, { once: true });
        const opts = { bubbles: true, cancelable: true, view: window };
        element.dispatchEvent(new MouseEvent("mousedown", opts));
        element.dispatchEvent(new MouseEvent("mouseup", opts));
        element.click();
      }

      // Fade out the ring
      ring.classList.add("vimium-hint-ring-out");
      ring.addEventListener("animationend", () => ring.remove(), { once: true });
    };

    hint.div.addEventListener("animationend", afterCollapse, { once: true });
  }
}
