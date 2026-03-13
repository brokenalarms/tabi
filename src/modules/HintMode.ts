// HintMode — link-hint overlay for Vimium
// Renders labeled hints over discovered elements and dispatches
// clicks when the user types the matching label characters.

import type { ModeValue } from "../types";
import { DEFAULTS } from "../types";
import { discoverElements, findAssociatedLabel, CLICKABLE_SELECTOR, NATIVE_INTERACTIVE_ELEMENTS } from "./ElementGatherer";
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

    const elements = discoverElements(this.getHintRect.bind(this));
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

    // Native interactive elements are atomic. If the element contains a heading
    // and no SVGs, use the heading as the hint target (e.g. article card links).
    // Otherwise use the element itself.
    const tag = el.tagName.toLowerCase();
    if (NATIVE_INTERACTIVE_ELEMENTS.includes(tag)) {
      if (!el.querySelector("svg")) {
        const heading = el.querySelector("h1, h2, h3, h4, h5, h6") as HTMLElement | null;
        if (heading) {
          const hr = heading.getBoundingClientRect();
          if (hr.width > 0 && hr.height > 0) return heading;
        }
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

  private getHintRect(el: HTMLElement): DOMRect {
    const target = this.getHintTargetElement(el);
    let rect = target.getBoundingClientRect();

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
    const tag = target.tagName.toLowerCase();
    const isFormControl = tag === "input" || tag === "textarea" || tag === "select";
    if (!isFormControl && getComputedStyle(target).display.startsWith("inline") && target.parentElement) {
      const parent = target.parentElement;
      const hasMixedContent = Array.from(parent.childNodes).some(
        n => n !== target && n.nodeType === 3 && (n.textContent || "").trim().length > 0
      );
      if (!hasMixedContent) {
        const parentRect = parent.getBoundingClientRect();
        rect = new DOMRect(parentRect.left, rect.top, parentRect.width, rect.height);
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
    this.overlay = document.createElement("div");
    this.overlay.className = `vimium-hint-overlay${DEFAULTS.animate ? " vimium-hint-animate" : ""}`;
    document.documentElement.appendChild(this.overlay);
    void this.overlay.offsetHeight;
    this.overlay.classList.add("visible");
  }

  private createHintDiv(element: HTMLElement, label: string): HTMLDivElement {
    const rect = this.getHintRect(element);
    const div = document.createElement("div");
    div.className = "vimium-hint";
    div.textContent = label;
    const pos = this.viewportToDocument(rect.left + rect.width / 2, rect.bottom + 2);
    div.style.left = Math.max(0, pos.x) + "px";
    div.style.top = Math.max(0, pos.y) + "px";
    div.style.transform = "translateX(-50%)";
    const tail = document.createElement("div");
    tail.className = "vimium-hint-tail";
    div.appendChild(tail);

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

    const targetRect = this.getHintRect(element);
    const tagRect = hint.div.getBoundingClientRect();
    if (tagRect.width > 0) {
      const dx = (targetRect.left + targetRect.width / 2) - (tagRect.left + tagRect.width / 2);
      const dy = (targetRect.top + targetRect.height / 2) - (tagRect.top + tagRect.height / 2);
      hint.div.style.setProperty("--poof-x", dx + "px");
      hint.div.style.setProperty("--poof-y", dy + "px");
    }

    hint.div.classList.add("vimium-hint-active");

    const afterCollapse = (): void => {
      this.deactivate();

      if (newTab && element.tagName.toLowerCase() === "a" && (element as HTMLAnchorElement).href) {
        browser.runtime.sendMessage({
          command: "createTab",
          url: (element as HTMLAnchorElement).href,
        });
      } else {
        element.focus();
        const opts = { bubbles: true, cancelable: true, view: window };
        element.dispatchEvent(new MouseEvent("mousedown", opts));
        element.dispatchEvent(new MouseEvent("mouseup", opts));
        element.click();
      }
    };

    hint.div.addEventListener("animationend", afterCollapse, { once: true });
  }
}
