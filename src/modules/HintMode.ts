// HintMode — link-hint overlay for Vimium
// Renders labeled hints over discovered elements and dispatches
// clicks when the user types the matching label characters.

import type { ModeValue } from "../types";
import { DEFAULTS } from "../types";
import { discoverElements, findAssociatedLabel, CLICKABLE_SELECTOR, NATIVE_INTERACTIVE_ELEMENTS, CLICKABLE_ROLES } from "./ElementGatherer";
import { Mode } from "../commands";

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

    const labels = HintMode.generateLabels(elements.length);
    this.createOverlay();
    this.hints = elements.map((el, i) => {
      const label = labels[i];
      const div = this.createHintDiv(el, label);
      return { element: el, label, div };
    });

    this.keyHandler.setModeKeyDelegate(this.handleKey.bind(this));
    document.addEventListener("mousedown", this.onMouseDown, true);
    window.addEventListener("scroll", this.onScroll, true);
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

    if (this.overlay) {
      this.overlay.classList.remove("visible");
      const overlay = this.overlay;
      overlay.addEventListener("transitionend", () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, { once: true });
      this.overlay = null;
    }

    this.hints = [];
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
        if ((rect.width === 0 && rect.height === 0) || parseFloat(getComputedStyle(el).opacity) === 0) {
          const label = findAssociatedLabel(el);
          if (label) return label;
        }
      }
    }

    if (el.tagName.toLowerCase() === "a" && rect.width === 0 && rect.height === 0) {
      for (const child of el.children) {
        const cr = (child as HTMLElement).getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) return child as HTMLElement;
      }
    }

    // Native interactive elements are atomic — drill down to heading or
    // text anchor if available, otherwise keep the element itself (which
    // may get bar/container style if block-level with content).
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || "";
    const isInteractive = NATIVE_INTERACTIVE_ELEMENTS.includes(tag) ||
      CLICKABLE_ROLES.includes(role);
    if (isInteractive) {
      const heading = el.querySelector("h1, h2, h3, h4, h5, h6") as HTMLElement | null;
      if (heading) {
        const hr = heading.getBoundingClientRect();
        if (hr.width > 0 && hr.height > 0) return heading;
      }
      return el;
    }

    // If this element contains other clickable children, don't redirect — keep
    // the hint on the first-level element. Inner clickable elements get their own hints.
    const hasClickableChildren = el.querySelector(CLICKABLE_SELECTOR) !== null;
    if (hasClickableChildren) return el;

    // For generic wrappers with no competing clickable children, find the best
    // visual target: sole clickable child, or first text-bearing element.
    const clickableChildren = el.querySelectorAll(CLICKABLE_SELECTOR);
    for (let i = 0; i < clickableChildren.length; i++) {
      const child = clickableChildren[i] as HTMLElement;
      if (child === el) continue;
      const cr = child.getBoundingClientRect();
      if (cr.width > 0 && cr.height > 0) return child;
    }

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) =>
        (node as HTMLElement).getAttribute("aria-hidden") === "true"
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    let node = walker.nextNode() as HTMLElement | null;
    while (node) {
      if (node !== el) {
        for (let i = 0; i < node.childNodes.length; i++) {
          const child = node.childNodes[i];
          if (child.nodeType === 3 && (child.textContent || "").trim().length > 0) {
            const cr = node.getBoundingClientRect();
            if (cr.width > 4 && cr.height > 4) return node;
          }
        }
      }
      node = walker.nextNode() as HTMLElement | null;
    }

    return el;
  }

  private getHintInfo(el: HTMLElement): { rect: DOMRect; container: boolean } {
    const target = this.getHintTargetElement(el);
    // Bar style: for block-level containers with branching content.
    // Single descendant chains (e.g. <a><span>text</span></a>) are just
    // wrapper nesting — not containers. Inline elements get pill+pointer.
    let rect = target.getBoundingClientRect();
    let container = false;
    if (target === el && el.children.length > 0 &&
        !getComputedStyle(el).display.startsWith("inline")) {
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

    // Inline elements have tight text rects — center on nearest block ancestor instead
    // so hints in vertical lists align rather than scattering with text width.
    // Exclude form controls — they are discrete positioned elements that should keep their own rect.
    // Exclude mixed content — when the parent has sibling text (e.g. <p>text <a>link</a></p>),
    // the link's natural position is correct.
    // Only expand when parent is the sole wrapper — a lone link in a wide
    // heading should stay near its text, not drift to the parent's center.
    // Skip when the parent is a single-child wrapper (e.g. <h2><a>text</a></h2>)
    // since there are no siblings to align with.
    const tag = target.tagName.toLowerCase();
    const isFormControl = tag === "input" || tag === "textarea" || tag === "select";
    if (!isFormControl && getComputedStyle(target).display.startsWith("inline") && target.parentElement) {
      const parent = target.parentElement;
      const hasMixedContent = Array.from(parent.childNodes).some(
        n => n !== target && n.nodeType === 3 && (n.textContent || "").trim().length > 0
      );
      // Skip when the element is the sole child of a standalone parent
      // (e.g. <h2><a>text</a></h2>) — hint should center on the text.
      // But keep centering when the parent is part of a repeating list
      // (parent has siblings), so adjacent items align their hints.
      const isSoleInStandalone = parent.children.length === 1 &&
        (!parent.parentElement || parent.parentElement.children.length <= 1);
      if (!hasMixedContent && !isSoleInStandalone) {
        const parentRect = parent.getBoundingClientRect();
        rect = new DOMRect(parentRect.left, rect.top, parentRect.width, rect.height);
      }
    }

    return { rect, container };
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
    this.overlay = document.createElement("div");
    this.overlay.className = `vimium-hint-overlay${DEFAULTS.animate ? " vimium-hint-animate" : ""}`;
    document.documentElement.appendChild(this.overlay);
    void this.overlay.offsetHeight;
    this.overlay.classList.add("visible");
  }

  private createHintDiv(element: HTMLElement, label: string): HTMLDivElement {
    const { rect, container } = this.getHintInfo(element);
    const div = document.createElement("div");
    div.className = container ? "vimium-hint vimium-hint-bar" : "vimium-hint";
    div.textContent = label;

    if (container) {
      // Bar style: centered at bottom edge of container
      const elRect = element.getBoundingClientRect();
      const barWidth = elRect.width * 0.25;
      const pos = this.viewportToDocument(elRect.left + elRect.width / 2, elRect.bottom);
      div.style.left = Math.max(0, pos.x) + "px";
      div.style.top = Math.max(0, pos.y) + "px";
      div.style.transform = "translateX(-50%)";
      div.style.width = barWidth + "px";
      div.textContent = "";
      div.dataset.label = label;

      // Subtle glow overlay on the container so users see what the hint targets.
      // Expand the glow to ensure breathing room — if the element already has
      // internal padding, no expansion needed; otherwise pad to at least 4px.
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
    } else {
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
        if (hint.div.classList.contains("vimium-hint-bar")) {
          hint.div.dataset.label = hint.label;
        } else {
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
