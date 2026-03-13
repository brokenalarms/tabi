// HintMode — link-hint overlay for Vimium
// Discovers clickable elements, renders labeled hints, and dispatches
// clicks when the user types the matching label characters.

import type { ModeValue } from "../types";

declare const Mode: {
  readonly NORMAL: "NORMAL";
  readonly INSERT: "INSERT";
  readonly HINTS: "HINTS";
  readonly FIND: "FIND";
  readonly TAB_SEARCH: "TAB_SEARCH";
};

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
const HINT_ANIMATE = true;

const CLICKABLE_SELECTOR = [
  "a", "button", "input", "textarea", "select",
  "summary", "details", "label[for]",
  "[role='button']", "[role='link']", "[role='tab']",
  "[role='menuitem']", "[role='option']", "[role='checkbox']",
  "[role='radio']", "[role='switch']",
  "[tabindex]:not([tabindex='-1'])",
  "[onclick]", "[onmousedown]",
].join(", ");

// --- Exclusion pipeline ---
// Declarative predicates that discard elements from hint discovery.
// Each returns true → element is excluded.

// Subtree exclude selector: if element or any ancestor matches, discard.
// Single closest() call handles all subtree-level exclusions.
const SUBTREE_EXCLUDE_SELECTOR = '[aria-hidden="true"], [inert]';

// Element excludes: checked on the element itself only.
const ELEMENT_EXCLUDES: Array<(el: HTMLElement) => boolean> = [
  (el) => !!(el as HTMLButtonElement).disabled,
  (el) => el.hidden,
];

// Style excludes: checked via getComputedStyle. Opacity:0 is handled
// separately in isVisible due to radio/checkbox → label redirect.
const STYLE_EXCLUDES: Array<(style: CSSStyleDeclaration) => boolean> = [
  (s) => s.display === "none",
  (s) => s.visibility === "hidden",
];

class HintMode {
  private keyHandler: KeyHandlerLike;
  private active: boolean;
  private newTab: boolean;
  private hints: Hint[];
  private typed: string;
  private overlay: HTMLDivElement | null;
  private pointerTails: boolean;
  private activating: boolean;
  private readonly onMouseDown: () => void;
  private readonly onScroll: () => void;

  constructor(keyHandler: KeyHandlerLike) {
    this.keyHandler = keyHandler;
    this.active = false;
    this.newTab = false;
    this.hints = [];
    this.typed = "";
    this.overlay = null;
    this.pointerTails = false;
    this.activating = false;
    this.onMouseDown = this.deactivate.bind(this);
    this.onScroll = this.deactivate.bind(this);
  }

  // --- Public API ---

  activate(newTab: boolean): void {
    if (this.active) {
      this.deactivate();
      return;
    }
    this.newTab = !!newTab;
    this.active = true;
    this.typed = "";
    this.keyHandler.setMode(Mode.HINTS);

    const elements = this.discoverElements();
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
    this.activating = false;
    this.keyHandler.clearModeKeyDelegate();
    document.removeEventListener("mousedown", this.onMouseDown, true);
    window.removeEventListener("scroll", this.onScroll, true);

    if (HINT_ANIMATE && this.overlay) {
      this.overlay.classList.remove("visible");
      const overlay = this.overlay;
      overlay.addEventListener("transitionend", () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, { once: true });
      this.overlay = null;
    } else if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
      this.overlay = null;
    }

    this.hints = [];
    this.keyHandler.setMode(Mode.NORMAL);
  }

  isActive(): boolean {
    return this.active;
  }

  setPointerTails(enabled: boolean): void {
    this.pointerTails = enabled;
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

  // --- Element discovery ---

  private discoverElements(): HTMLElement[] {
    // Step 1: Find all clickable elements
    const seen = new Set<Element>();
    const result: HTMLElement[] = [];

    const collect = (root: Document | ShadowRoot): void => {
      const nodes = root.querySelectorAll(CLICKABLE_SELECTOR);
      for (const el of nodes) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (this.isVisible(el as HTMLElement) && this.isInteractive(el as HTMLElement)) result.push(el as HTMLElement);
      }

      // Check for shadow roots
      const allEls = root.querySelectorAll("*");
      for (const el of allEls) {
        if (el.shadowRoot) {
          collect(el.shadowRoot);
        }
      }
    };

    collect(document);

    // Cursor:pointer walk-up: find highest cursor:pointer ancestor for each
    // candidate. This catches container elements (e.g. Facebook reel cards)
    // that are clickable via cursor:pointer but don't match CLICKABLE_SELECTOR.
    const candidateSet = new Set<Element>(result);
    const pointerExtras: HTMLElement[] = [];
    for (const el of result) {
      let ancestor = el.parentElement;
      let highest: HTMLElement | null = null;
      while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
        if (candidateSet.has(ancestor)) break; // stop at existing candidate
        const style = getComputedStyle(ancestor);
        if (style.cursor === "pointer") {
          highest = ancestor;
        } else {
          break; // stop as soon as cursor is not pointer
        }
        ancestor = ancestor.parentElement;
      }
      if (highest && !candidateSet.has(highest)) {
        candidateSet.add(highest);
        pointerExtras.push(highest);
      }
    }
    for (const el of pointerExtras) {
      if (!this.isExcluded(el) && this.isVisible(el)) result.push(el);
    }

    // Sort by viewport position: top-left elements get shortest labels
    result.sort((a, b) => {
      const ra = this.getHintRect(a);
      const rb = this.getHintRect(b);
      return (ra.top - rb.top) || (ra.left - rb.left);
    });

    // Step 2: Resolve candidates — containment-based dedup
    const resultSet = new Set(result);
    const toRemove = new Set<HTMLElement>();

    // Build parentMap: each candidate → its nearest candidate ancestor
    const parentMap = new Map<HTMLElement, HTMLElement>();
    for (const el of result) {
      let ancestor = el.parentElement;
      while (ancestor) {
        if (ancestor !== el && resultSet.has(ancestor as HTMLElement)) {
          parentMap.set(el, ancestor as HTMLElement);
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    // Group children by their parent candidate
    const childrenOf = new Map<HTMLElement, HTMLElement[]>();
    for (const [child, parent] of parentMap) {
      let list = childrenOf.get(parent);
      if (!list) {
        list = [];
        childrenOf.set(parent, list);
      }
      list.push(child);
    }

    // Resolve each group
    for (const [root, descendants] of childrenOf) {
      const rootType = HintMode.interactiveType(root);
      const allSameType = descendants.every(d => HintMode.interactiveType(d) === rootType);
      const allGeneric = descendants.every(d => HintMode.interactiveType(d) === "generic");

      if (allGeneric) {
        // All descendants are generic (divs, spans) — keep root only
        for (const d of descendants) toRemove.add(d);
      } else if (allSameType) {
        // All descendants same type as root — drop root, keep descendants
        toRemove.add(root);
      } else {
        // Mixed specific types — keep both root and descendants
      }
    }

    // Label-for dedup: remove label[for] when its associated input is already
    // a candidate (the input's hint targets the label's position via findAssociatedLabel)
    const labelForIds = new Set<string>();
    for (const el of result) {
      if (el.tagName === "LABEL" && (el as HTMLLabelElement).htmlFor) {
        const forId = (el as HTMLLabelElement).htmlFor;
        const input = document.getElementById(forId);
        if (input && resultSet.has(input as HTMLElement)) {
          toRemove.add(el);
        } else {
          labelForIds.add(forId);
        }
      }
    }
    if (labelForIds.size > 0) {
      for (const el of result) {
        if (el.tagName === "A") {
          const href = el.getAttribute("href");
          if (href && href.charAt(0) === "#" && labelForIds.has(href.slice(1))) {
            toRemove.add(el);
          }
        }
      }
    }

    // Disclosure trigger dedup: remove aria-expanded + aria-controls elements
    // when a sibling candidate exists (hover-activated submenu buttons)
    for (const el of result) {
      if (toRemove.has(el)) continue;
      if (el.getAttribute("aria-expanded") == null) continue;
      if (!el.getAttribute("aria-controls")) continue;

      const parent = el.parentElement;
      if (!parent) continue;

      for (const sibling of result) {
        if (sibling !== el && !toRemove.has(sibling) && sibling.parentElement === parent) {
          toRemove.add(el);
          break;
        }
      }
    }

    return result.filter(el => !toRemove.has(el));
  }

  // Returns the interactive "type" of an element — used to determine whether
  // an ancestor and descendant are the same target or independent controls.
  private static interactiveType(el: HTMLElement): string {
    const tag = el.tagName;
    const role = el.getAttribute("role");
    if (tag === "A" || role === "link") return "link";
    if (tag === "BUTTON" || role === "button" || role === "menuitem") return "action";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        role === "checkbox" || role === "radio" || role === "switch" || role === "option") return "form";
    if (tag === "SUMMARY" || tag === "DETAILS" || role === "tab") return "disclosure";
    if (tag === "LABEL") return "label";
    return "generic";
  }

  private isExcluded(el: HTMLElement): boolean {
    return !!el.closest(SUBTREE_EXCLUDE_SELECTOR) || ELEMENT_EXCLUDES.some(fn => fn(el));
  }

  private isInteractive(el: HTMLElement): boolean {
    if (this.isExcluded(el)) return false;

    const tag = el.tagName;
    if (tag === "A" || tag === "BUTTON" || tag === "INPUT" ||
        tag === "TEXTAREA" || tag === "SELECT" ||
        tag === "SUMMARY" || tag === "DETAILS" || tag === "LABEL") {
      return true;
    }
    const role = el.getAttribute("role");
    if (role === "button" || role === "link" || role === "tab" ||
        role === "menuitem" || role === "option" ||
        role === "checkbox" || role === "radio" || role === "switch") {
      return true;
    }
    const style = getComputedStyle(el);
    return style.cursor === "pointer";
  }

  private findAssociatedLabel(el: HTMLElement): HTMLElement | null {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label as HTMLElement;
    }
    const parent = el.closest("label");
    if (parent) return parent as HTMLElement;
    return null;
  }

  private isVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      if (el.tagName === "A") {
        for (const child of el.children) {
          const cr = (child as HTMLElement).getBoundingClientRect();
          if (cr.width > 0 && cr.height > 0) {
            return this.isVisible(child as HTMLElement);
          }
        }
      }
      if (el.tagName === "INPUT") {
        const type = ((el as HTMLInputElement).type || "").toLowerCase();
        if (type === "radio" || type === "checkbox") {
          const label = this.findAssociatedLabel(el);
          if (label) return this.isVisible(label);
        }
      }
      return false;
    }
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;

    const style = getComputedStyle(el);
    if (STYLE_EXCLUDES.some(fn => fn(style))) return false;
    // Opacity:0 — excluded, with radio/checkbox → label redirect
    if (parseFloat(style.opacity) === 0) {
      if (el.tagName === "INPUT") {
        const type = ((el as HTMLInputElement).type || "").toLowerCase();
        if (type === "radio" || type === "checkbox") {
          const label = this.findAssociatedLabel(el);
          if (label) return this.isVisible(label);
        }
      }
      return false;
    }

    // Check if element is clipped by an ancestor with overflow:hidden/clip
    let ancestor = el.parentElement;
    while (ancestor && ancestor !== document.body) {
      const overflow = getComputedStyle(ancestor).overflow;
      if (overflow === "hidden" || overflow === "clip") {
        const ar = ancestor.getBoundingClientRect();
        if (rect.bottom <= ar.top || rect.top >= ar.bottom ||
            rect.right <= ar.left || rect.left >= ar.right) {
          return false;
        }
      }
      ancestor = ancestor.parentElement;
    }

    // Check if element is actually reachable (not fully covered by another element).
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const px = Math.min(Math.max(centerX, 0), window.innerWidth - 1);
    const py = Math.min(Math.max(centerY, 0), window.innerHeight - 1);

    const elMatchesPoint = (point: Element[]): boolean => {
      for (const hit of point) {
        if (el.contains(hit) || hit.contains(el)) return true;
      }
      return false;
    };

    const centerHits = document.elementsFromPoint(px, py);
    if (centerHits.length > 0 && !elMatchesPoint(centerHits)) {
      const tlHits = document.elementsFromPoint(
        Math.min(Math.max(rect.left + 2, 0), window.innerWidth - 1),
        Math.min(Math.max(rect.top + 2, 0), window.innerHeight - 1)
      );
      if (tlHits.length === 0 || !elMatchesPoint(tlHits)) {
        return false;
      }
    }

    return true;
  }

  private getHintTargetElement(el: HTMLElement): HTMLElement {
    const rect = el.getBoundingClientRect();

    if (el.tagName === "INPUT") {
      const type = ((el as HTMLInputElement).type || "").toLowerCase();
      if (type === "radio" || type === "checkbox") {
        if ((rect.width === 0 && rect.height === 0) || parseFloat(getComputedStyle(el).opacity) === 0) {
          const label = this.findAssociatedLabel(el);
          if (label) return label;
        }
      }
    }

    if (el.tagName === "A" && rect.width === 0 && rect.height === 0) {
      for (const child of el.children) {
        const cr = (child as HTMLElement).getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) return child as HTMLElement;
      }
    }

    const clickableChildren = el.querySelectorAll(CLICKABLE_SELECTOR);
    for (let i = 0; i < clickableChildren.length; i++) {
      const child = clickableChildren[i] as HTMLElement;
      if (child === el) continue;
      const cr = child.getBoundingClientRect();
      if (cr.width > 0 && cr.height > 0) return child;
    }

    if (typeof document.createTreeWalker === "function") {
      const walker = document.createTreeWalker(el, 0x1 /* NodeFilter.SHOW_ELEMENT */);
      let node = walker.nextNode() as HTMLElement | null;
      while (node) {
        if (node !== el) {
          if (node.getAttribute && node.getAttribute("aria-hidden") === "true") {
            node = walker.nextNode() as HTMLElement | null;
            continue;
          }
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
    }

    return el;
  }

  private getHintRect(el: HTMLElement): DOMRect {
    const target = this.getHintTargetElement(el);
    const rect = target.getBoundingClientRect();

    if (el !== target && el.getBoundingClientRect().width > window.innerWidth * 0.25) {
      const paddingTop = parseFloat(getComputedStyle(target).paddingTop) || 0;
      if (paddingTop > 0) {
        return new DOMRect(rect.left, rect.top + paddingTop, rect.width, rect.height - paddingTop);
      }
    }

    if (el.tagName === "A") {
      const clientRects = (el === target ? el : target).getClientRects();
      if (clientRects.length > 0) {
        for (let i = 0; i < clientRects.length; i++) {
          const cr = clientRects[i];
          if (cr.width > 1 && cr.height > 1) return cr;
        }
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
    this.overlay = document.createElement("div") as HTMLDivElement;
    this.overlay.className = "vimium-hint-overlay";
    if (HINT_ANIMATE) this.overlay.classList.add("vimium-hint-animate");
    document.documentElement.appendChild(this.overlay);
    if (HINT_ANIMATE) {
      void this.overlay.offsetHeight;
      this.overlay.classList.add("visible");
    }
  }

  private createHintDiv(element: HTMLElement, label: string): HTMLDivElement {
    const rect = this.getHintRect(element);
    const div = document.createElement("div") as HTMLDivElement;
    div.className = "vimium-hint";
    div.textContent = label;
    if (this.pointerTails) {
      const pos = this.viewportToDocument(rect.left + rect.width / 2, rect.bottom + 2);
      div.style.left = Math.max(0, pos.x) + "px";
      div.style.top = Math.max(0, pos.y) + "px";
      div.style.transform = "translateX(-50%)";
      const tail = document.createElement("div");
      tail.className = "vimium-hint-tail";
      div.appendChild(tail);
    } else {
      const pos = this.viewportToDocument(rect.left, rect.top);
      div.style.left = Math.max(0, pos.x) + "px";
      div.style.top = Math.max(0, pos.y) + "px";
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
    this.activating = true;

    for (const h of this.hints) {
      if (h !== hint) h.div.style.display = "none";
    }

    const targetRect = this.getHintRect(element);
    const tagRect = hint.div.getBoundingClientRect ? hint.div.getBoundingClientRect() : null;
    if (tagRect && tagRect.width > 0) {
      const dx = (targetRect.left + targetRect.width / 2) - (tagRect.left + tagRect.width / 2);
      const dy = (targetRect.top + targetRect.height / 2) - (tagRect.top + tagRect.height / 2);
      hint.div.style.setProperty("--poof-x", dx + "px");
      hint.div.style.setProperty("--poof-y", dy + "px");
    }

    if (hint.div.classList) hint.div.classList.add("vimium-hint-active");

    const afterCollapse = (): void => {
      this.deactivate();

      if (this.newTab && element.tagName === "A" && (element as HTMLAnchorElement).href) {
        browser.runtime.sendMessage({
          command: "createTab",
          url: (element as HTMLAnchorElement).href,
        });
      } else {
        element.focus();
        element.click();
      }
    };

    if (HINT_ANIMATE && hint.div.addEventListener) {
      hint.div.addEventListener("animationend", afterCollapse, { once: true });
    } else {
      afterCollapse();
    }
  }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).HintMode = HintMode;
  (globalThis as Record<string, unknown>).HINT_CHARS = HINT_CHARS;
  (globalThis as Record<string, unknown>).CLICKABLE_SELECTOR = CLICKABLE_SELECTOR;
}
