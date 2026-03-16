// HintMode — link-hint overlay for Vimium
// Renders labeled hints over discovered elements and dispatches
// clicks when the user types the matching label characters.

import type { ModeValue } from "../types";
import { DEFAULTS } from "../types";
import { CLICKABLE_SELECTOR, REPEATING_CONTAINER_SELECTOR } from "./constants";
import { discoverElements } from "./ElementGatherer";
import { hasHeadingContent, isBlockLevel, isContainerSized, isInRepeatingContainer, hasBox } from "./elementPredicates";
import { findAssociatedLabel } from "./elementTraversals";
import { HEADING_SELECTOR } from "./constants";

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

/** Return the first heading descendant, or null. */
export function getHeading(el: HTMLElement): HTMLElement | null {
  return el.querySelector(HEADING_SELECTOR) as HTMLElement | null;
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

const HINT_CHARS = "sadgjklewcmpoh";

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
  private hintInfoCache: Map<HTMLElement, { rect: DOMRect; container: boolean }>;

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
    this.hintInfoCache = new Map();
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

    const elements = discoverElements((el: HTMLElement) => this.getHintInfo(el).rect);
    if (elements.length === 0) {
      this.deactivate();
      return;
    }

    // Downgrade container=true for any element that contains another discovered element.
    // A container with nested hinted elements isn't a visual container — the nested
    // elements get their own hints, so the parent should use pill-below.
    for (const el of elements) {
      const info = this.hintInfoCache.get(el);
      if (info && info.container) {
        for (const other of elements) {
          if (other !== el && el.contains(other)) {
            info.container = false;
            break;
          }
        }
      }
    }

    const labels = HintMode.generateLabels(elements.length);
    this.createOverlay();
    this.hints = elements.map((el, i) => {
      const label = labels[i];
      const div = this.createHintDiv(el, label, elements);
      return { element: el, label, div };
    });

    this.keyHandler.setModeKeyDelegate(this.handleKey.bind(this));
    document.addEventListener("mousedown", this.onMouseDown, true);
    window.addEventListener("scroll", this.onScroll, true);
    window.addEventListener("resize", this.onResize);
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

    if (this.overlay) {
      this.overlay.classList.remove("visible");
      const overlay = this.overlay;
      overlay.addEventListener("transitionend", () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, { once: true });
      this.overlay = null;
    }

    this.hints = [];
    this.hintInfoCache.clear();
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

  // --- Hint target element ---

  private getHintTargetElement(el: HTMLElement): HTMLElement {
    const rect = el.getBoundingClientRect();

    if (el.tagName.toLowerCase() === "input") {
      const type = ((el as HTMLInputElement).type || "").toLowerCase();
      if (type === "radio" || type === "checkbox") {
        const label = findAssociatedLabel(el);
        if (label) return label;
      }
    }

    if (el.tagName.toLowerCase() === "a" && rect.width === 0 && rect.height === 0) {
      for (const child of el.children) {
        const cr = (child as HTMLElement).getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) return child as HTMLElement;
      }
    }

    // Block-level links with headings: position hint at the heading so it
    // centers on visible text, not the full-width block. Links in repeating
    // containers (li, tr) keep full-width hints for vertical alignment.
    if (el.tagName.toLowerCase() === "a" &&
        isBlockLevel(el) && hasHeadingContent(el) && !isInRepeatingContainer(el)) {
      return getHeading(el)!;
    }

    return el;
  }

  private getHintInfo(el: HTMLElement): { rect: DOMRect; container: boolean } {
    const cached = this.hintInfoCache.get(el);
    if (cached) return cached;
    const target = this.getHintTargetElement(el);
    // Bar style: for block-level containers with branching content.
    // Single descendant chains (e.g. <a><span>text</span></a>) are just
    // wrapper nesting — not containers. Inline elements get pill+pointer.
    let rect = target.getBoundingClientRect();
    let container = false;
    if (target === el && el.children.length > 0 && isContainerSized(el, rect)) {
      console.log("CONTAINER SIZED:", el.tagName, el.className.slice(0, 40), rect.width, rect.height);
      if (isInRepeatingContainer(el)) {
        // Elements in repeating containers (li, tr) always get container
        // treatment when sized — the list structure provides visual context.
        container = true;
      } else {
        // Walk the single-child chain — if it reaches a leaf with no sibling
        // text, it's just wrapper nesting (e.g. <a><span>text</span></a>).
        // But if any level has text nodes alongside the single element child
        // (e.g. <summary><svg/>Assignees</summary>), it's a real container.
        let node: HTMLElement = el;
        let hasTextAlongside = false;
        while (node.children.length === 1) {
          for (let i = 0; i < node.childNodes.length; i++) {
            const child = node.childNodes[i];
            if (child.nodeType === 3 && (child.textContent || "").trim().length > 0) {
              hasTextAlongside = true;
              break;
            }
          }
          if (hasTextAlongside) break;
          node = node.children[0] as HTMLElement;
        }
        container = node.children.length > 0 || hasTextAlongside;
      }
    }

    if (el !== target && el.getBoundingClientRect().width > window.innerWidth * 0.25) {
      const paddingTop = parseFloat(getComputedStyle(target).paddingTop) || 0;
      if (paddingTop > 0) {
        rect = new DOMRect(rect.left, rect.top + paddingTop, rect.width, rect.height - paddingTop);
      }
    }

    if (el.tagName.toLowerCase() === "a") {
      const clientRects = (el === target ? el : target).getClientRects();
      for (let i = 0; i < clientRects.length; i++) {
        const cr = clientRects[i];
        if (cr.width > 1 && cr.height > 1) { rect = cr; break; }
      }
    }

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

    // Shrink rect by padding-bottom so the hint pointer touches the content
    // edge rather than floating below the padding (e.g. MediaWiki sidebar links).
    const paddingBottom = parseFloat(getComputedStyle(target).paddingBottom) || 0;
    if (paddingBottom > 0) {
      rect = new DOMRect(rect.left, rect.top, rect.width, rect.height - paddingBottom);
    }

    const result = { rect, container };
    this.hintInfoCache.set(el, result);
    return result;
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

  private createHintDiv(element: HTMLElement, label: string, allElements: HTMLElement[]): HTMLDivElement {
    const { rect, container } = this.getHintInfo(element);
    const div = document.createElement("div");
    div.className = "vimium-hint";
    div.textContent = label;

    if (container) {
      // Container: glow border + inside-end pill
      const elRect = element.getBoundingClientRect();
      const cs = getComputedStyle(element);
      const padH = Math.max(0, 4 - parseFloat(cs.paddingLeft));
      const padV = Math.max(0, 4 - parseFloat(cs.paddingTop));
      const glow = document.createElement("div");
      glow.className = "vimium-hint-container-glow";
      const glowPos = this.viewportToDocument(elRect.left - padH, elRect.top - padV);
      glow.style.left = glowPos.x + "px";
      glow.style.top = glowPos.y + "px";
      glow.style.width = (elRect.width + padH * 2) + "px";
      glow.style.height = (elRect.height + padV * 2) + "px";
      if (this.overlay) this.overlay.appendChild(glow);

      const insetRight = Math.max(6, parseFloat(cs.paddingRight) || 0);
      const pos = this.viewportToDocument(
        elRect.right - insetRight,
        elRect.top + elRect.height / 2
      );
      div.style.left = pos.x + "px";
      div.style.top = pos.y + "px";
      div.style.transform = "translate(-100%, -50%)";
    } else {
      // Non-container: pill below with pointer tail
      const pos = this.viewportToDocument(rect.left + rect.width / 2, rect.bottom + 2);
      div.style.left = Math.max(0, pos.x) + "px";
      div.style.top = Math.max(0, pos.y) + "px";
      div.style.transform = "translateX(-50%)";
      const tail = document.createElement("div");
      tail.className = "vimium-hint-tail";
      div.appendChild(tail);
    }

    if (this.overlay) this.overlay.appendChild(div);
    return div;
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

    const targetRect = this.getHintInfo(element).rect;
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
      this.deactivate();

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
