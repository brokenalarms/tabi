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

class HintMode {
  private _keyHandler: KeyHandlerLike;
  private _active: boolean;
  private _newTab: boolean;
  private _hints: Hint[];
  private _typed: string;
  private _overlay: HTMLDivElement | null;
  private _pointerTails: boolean;
  private _activating: boolean;
  private readonly _onMouseDown: () => void;
  private readonly _onScroll: () => void;

  constructor(keyHandler: KeyHandlerLike) {
    this._keyHandler = keyHandler;
    this._active = false;
    this._newTab = false;
    this._hints = [];
    this._typed = "";
    this._overlay = null;
    this._pointerTails = false;
    this._activating = false;
    this._onMouseDown = this._deactivate.bind(this);
    this._onScroll = this._deactivate.bind(this);
  }

  // --- Public API ---

  activate(newTab: boolean): void {
    if (this._active) {
      this._deactivate();
      return;
    }
    this._newTab = !!newTab;
    this._active = true;
    this._typed = "";
    this._keyHandler.setMode(Mode.HINTS);

    const elements = this._discoverElements();
    if (elements.length === 0) {
      this._deactivate();
      return;
    }

    const labels = HintMode.generateLabels(elements.length);
    this._createOverlay();
    this._hints = elements.map((el, i) => {
      const label = labels[i];
      const div = this._createHintDiv(el, label);
      return { element: el, label, div };
    });

    this._keyHandler.setModeKeyDelegate(this._handleKey.bind(this));
    document.addEventListener("mousedown", this._onMouseDown, true);
    window.addEventListener("scroll", this._onScroll, true);
  }

  deactivate(): void {
    this._deactivate();
  }

  isActive(): boolean {
    return this._active;
  }

  setPointerTails(enabled: boolean): void {
    this._pointerTails = enabled;
  }

  wireCommands(): void {
    this._keyHandler.on("activateHints", () => this.activate(false));
    this._keyHandler.on("activateHintsNewTab", () => this.activate(true));
  }

  unwireCommands(): void {
    this._keyHandler.off("activateHints");
    this._keyHandler.off("activateHintsNewTab");
  }

  // --- Element discovery ---

  private _discoverElements(): HTMLElement[] {
    const seen = new Set<Element>();
    const result: HTMLElement[] = [];

    const collect = (root: Document | ShadowRoot): void => {
      const nodes = root.querySelectorAll(CLICKABLE_SELECTOR);
      for (const el of nodes) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (this._isInteractive(el as HTMLElement) && this._isVisible(el as HTMLElement)) result.push(el as HTMLElement);
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

    // Sort by viewport position: top-left elements get shortest labels
    result.sort((a, b) => {
      const ra = this._getHintRect(a);
      const rb = this._getHintRect(b);
      return (ra.top - rb.top) || (ra.left - rb.left);
    });

    // Remove ancestor elements when a descendant is also a candidate —
    // the inner element is the actual interaction target.
    // Exception: keep both when they are different interactive types
    // (e.g. a link card containing a menu button — these are independent targets).
    const resultSet = new Set(result);
    const toRemove = new Set<HTMLElement>();
    for (const el of result) {
      const elType = HintMode._interactiveType(el);
      let ancestor = el.parentElement;
      while (ancestor) {
        if (resultSet.has(ancestor as HTMLElement)) {
          const ancType = HintMode._interactiveType(ancestor as HTMLElement);
          // Only remove ancestor if it's the same type as the descendant —
          // they represent the same click target (e.g. <a> wrapping <a>).
          // Different types means independent controls: keep both.
          if (ancType === elType) {
            toRemove.add(ancestor as HTMLElement);
          }
        }
        ancestor = ancestor.parentElement;
      }
    }

    // Deduplicate labels and their associated controls:
    // - Remove label[for] when its associated input is already a candidate
    //   (the input's hint already targets the label's position via _findAssociatedLabel)
    // - Remove hash-link anchors (href="#X") when a label[for="X"] is a candidate
    //   (CSS checkbox hack pattern — both control the same toggle)
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

    // Dedup 4: Remove disclosure triggers (aria-expanded + aria-controls)
    // when a sibling candidate exists. These are hover-activated submenu
    // buttons that are visually hidden but have DOM dimensions.
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
  private static _interactiveType(el: HTMLElement): string {
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

  // Non-semantic elements (divs, spans, etc.) must show visual interactivity
  // signals to be considered real click targets. Without this, container wrappers
  // with tabindex or onclick produce false hints.
  private _isInteractive(el: HTMLElement): boolean {
    // Disabled elements and aria-hidden trees are never interactive
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    // Elements inside an inert subtree are non-interactive
    if (el.closest("[inert]")) return false;

    const tag = el.tagName;
    if (tag === "A" || tag === "BUTTON" || tag === "INPUT" ||
        tag === "TEXTAREA" || tag === "SELECT" ||
        tag === "SUMMARY" || tag === "DETAILS" || tag === "LABEL") {
      return true;
    }
    // ARIA widget roles indicate intentional interactivity
    const role = el.getAttribute("role");
    if (role === "button" || role === "link" || role === "tab" ||
        role === "menuitem" || role === "option" ||
        role === "checkbox" || role === "radio" || role === "switch") {
      return true;
    }
    // Generic elements need cursor:pointer — real custom buttons set this
    const style = getComputedStyle(el);
    return style.cursor === "pointer";
  }

  private _findAssociatedLabel(el: HTMLElement): HTMLElement | null {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label as HTMLElement;
    }
    const parent = el.closest("label");
    if (parent) return parent as HTMLElement;
    return null;
  }

  private _isVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // Anchor elements with display:contents (e.g. Google search links)
      // have zero-size rects. Find the first child with a real bounding box.
      if (el.tagName === "A") {
        for (const child of el.children) {
          const cr = (child as HTMLElement).getBoundingClientRect();
          if (cr.width > 0 && cr.height > 0) {
            return this._isVisible(child as HTMLElement);
          }
        }
      }
      if (el.tagName === "INPUT") {
        const type = ((el as HTMLInputElement).type || "").toLowerCase();
        if (type === "radio" || type === "checkbox") {
          const label = this._findAssociatedLabel(el);
          if (label) return this._isVisible(label);
        }
      }
      return false;
    }
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;

    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (parseFloat(style.opacity) === 0) {
      if (el.tagName === "INPUT") {
        const type = ((el as HTMLInputElement).type || "").toLowerCase();
        if (type === "radio" || type === "checkbox") {
          const label = this._findAssociatedLabel(el);
          if (label) return this._isVisible(label);
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
    // Use elementsFromPoint (plural) so elements behind transparent overlays
    // (e.g. anchor overlays on top of labels) are still detected.
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    // Clamp to viewport
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
      // Also try the top-left corner in case the center is covered
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

  // --- Hint rect fallback for zero-size anchors ---

  // Returns the best visual target element for a hint — the element whose
  // bounding area the tag points to. Used for both tag placement and selection flash.
  private _getHintTargetElement(el: HTMLElement): HTMLElement {
    const rect = el.getBoundingClientRect();

    if (el.tagName === "INPUT") {
      const type = ((el as HTMLInputElement).type || "").toLowerCase();
      if (type === "radio" || type === "checkbox") {
        if ((rect.width === 0 && rect.height === 0) || parseFloat(getComputedStyle(el).opacity) === 0) {
          const label = this._findAssociatedLabel(el);
          if (label) return label;
        }
      }
    }

    if (rect.width > window.innerWidth * 0.25) {
      // First try specific widget children
      const children = el.querySelectorAll(
        "h1, h2, h3, h4, h5, h6, button, svg, [role='button'], [class*='icon'], [class*='chevron'], [class*='arrow']"
      );
      for (let i = 0; i < children.length; i++) {
        const cr = children[i].getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0 && cr.width < rect.width * 0.5) {
          return children[i] as HTMLElement;
        }
      }
      // Fall back to any narrower child with text (e.g. <span>Show more</span>)
      const textChildren = el.querySelectorAll("span, p, em, strong, b, i, u, small");
      for (let i = 0; i < textChildren.length; i++) {
        const child = textChildren[i] as HTMLElement;
        const cr = child.getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0 && cr.width < rect.width * 0.5 && (child.textContent || "").trim().length > 0) {
          return child;
        }
      }
    }

    if (el.tagName === "A" && rect.width === 0 && rect.height === 0) {
      for (const child of el.children) {
        const cr = (child as HTMLElement).getBoundingClientRect();
        if (cr.width > 0 && cr.height > 0) return child as HTMLElement;
      }
    }

    return el;
  }

  private _getHintRect(el: HTMLElement): DOMRect {
    const target = this._getHintTargetElement(el);
    const rect = target.getBoundingClientRect();

    // For wide-element children, adjust for padding
    if (el !== target && el.getBoundingClientRect().width > window.innerWidth * 0.25) {
      const paddingTop = parseFloat(getComputedStyle(target).paddingTop) || 0;
      if (paddingTop > 0) {
        return new DOMRect(rect.left, rect.top + paddingTop, rect.width, rect.height - paddingTop);
      }
    }

    if (el.tagName === "A") {
      // Use getClientRects() for inline elements — gives per-line-box rects,
      // avoiding inflated bounding rects from visually-hidden child spans
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

    // Determine minimum label length to fit all hints
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

  // Convert viewport-relative rect to document-relative coordinates
  private _viewportToDocument(x: number, y: number): { x: number; y: number } {
    const docEl = document.documentElement;
    const rect = docEl.getBoundingClientRect();
    const style = getComputedStyle(docEl);
    // Match Vimium's getViewportTopLeft approach
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

  private _createOverlay(): void {
    this._overlay = document.createElement("div") as HTMLDivElement;
    this._overlay.className = "vimium-hint-overlay";
    if (HINT_ANIMATE) this._overlay.classList.add("vimium-hint-animate");
    // Append to documentElement (not body) to avoid containing-block issues
    // from transforms/filters on body that break position:fixed
    document.documentElement.appendChild(this._overlay);
    if (HINT_ANIMATE) {
      void this._overlay.offsetHeight;
      this._overlay.classList.add("visible");
    }
  }

  private _createHintDiv(element: HTMLElement, label: string): HTMLDivElement {
    const rect = this._getHintRect(element);
    const div = document.createElement("div") as HTMLDivElement;
    div.className = "vimium-hint";
    div.textContent = label;
    if (this._pointerTails) {
      // Floating mode: centered below element, tail points up
      const pos = this._viewportToDocument(rect.left + rect.width / 2, rect.bottom + 2);
      div.style.left = Math.max(0, pos.x) + "px";
      div.style.top = Math.max(0, pos.y) + "px";
      div.style.transform = "translateX(-50%)";
      const tail = document.createElement("div");
      tail.className = "vimium-hint-tail";
      div.appendChild(tail);
    } else {
      // Inline mode: at left edge of element, overlapping text
      const pos = this._viewportToDocument(rect.left, rect.top);
      div.style.left = Math.max(0, pos.x) + "px";
      div.style.top = Math.max(0, pos.y) + "px";
    }

    if (this._overlay) this._overlay.appendChild(div);
    return div;
  }

  // --- Key handling during HINTS mode (called via KeyHandler delegate) ---

  private _handleKey(event: KeyboardEvent): boolean {
    if (!this._active) return false;

    // Swallow all keys while a hint is activating (animation in progress)
    if (this._activating) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    // 'f' with no modifiers toggles hints off
    if (event.code === "KeyF" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this._deactivate();
      return true;
    }

    // Let Escape fall through to KeyHandler's exitToNormal dispatch
    if (event.code === "Escape") return false;

    event.preventDefault();
    event.stopPropagation();

    // Backspace removes last typed character
    if (event.code === "Backspace") {
      if (this._typed.length > 0) {
        this._typed = this._typed.slice(0, -1);
        this._updateHintVisibility();
      }
      return true;
    }

    // Only accept hint characters; any other key dismisses
    const char = event.key ? event.key.toLowerCase() : "";
    if (!HINT_CHARS.includes(char) || char.length !== 1) {
      this._deactivate();
      return true;
    }

    this._typed += char;
    this._updateHintVisibility();

    // Deactivate if no hints match the typed prefix
    if (!this._hints.some(h => h.label.startsWith(this._typed))) {
      this._deactivate();
      return true;
    }

    // Check for exact match
    const match = this._hints.find((h) => h.label === this._typed);
    if (match) {
      this._activateHint(match);
    }
    return true;
  }

  private _updateHintVisibility(): void {
    for (const hint of this._hints) {
      const matches = hint.label.startsWith(this._typed);
      hint.div.style.display = matches ? "" : "none";
      if (matches) {
        // Highlight already-typed prefix
        const matched = hint.label.slice(0, this._typed.length);
        const remaining = hint.label.slice(this._typed.length);
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

  private _activateHint(hint: Hint): void {
    const element = hint.element;

    this._activating = true;

    // Hide all other hints, animate only the matched one
    for (const h of this._hints) {
      if (h !== hint) h.div.style.display = "none";
    }

    // Compute offset from tag toward center of the target element
    const targetRect = this._getHintRect(element);
    const tagRect = hint.div.getBoundingClientRect ? hint.div.getBoundingClientRect() : null;
    if (tagRect && tagRect.width > 0) {
      const dx = (targetRect.left + targetRect.width / 2) - (tagRect.left + tagRect.width / 2);
      const dy = (targetRect.top + targetRect.height / 2) - (tagRect.top + tagRect.height / 2);
      hint.div.style.setProperty("--poof-x", dx + "px");
      hint.div.style.setProperty("--poof-y", dy + "px");
    }

    if (hint.div.classList) hint.div.classList.add("vimium-hint-active");

    const afterCollapse = (): void => {
      this._deactivate();

      if (this._newTab && element.tagName === "A" && (element as HTMLAnchorElement).href) {
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

  // --- Cleanup ---

  private _deactivate(): void {
    if (!this._active) return;
    this._active = false;
    this._typed = "";
    this._activating = false;
    this._keyHandler.clearModeKeyDelegate();
    document.removeEventListener("mousedown", this._onMouseDown, true);
    window.removeEventListener("scroll", this._onScroll, true);

    if (HINT_ANIMATE && this._overlay) {
      this._overlay.classList.remove("visible");
      const overlay = this._overlay;
      overlay.addEventListener("transitionend", () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, { once: true });
      this._overlay = null;
    } else if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
      this._overlay = null;
    }

    this._hints = [];
    this._keyHandler.setMode(Mode.NORMAL);
  }

  destroy(): void {
    this._deactivate();
    this.unwireCommands();
  }
}

// Export for Node.js tests; no-op in browser content script context
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).HintMode = HintMode;
  (globalThis as Record<string, unknown>).HINT_CHARS = HINT_CHARS;
  (globalThis as Record<string, unknown>).CLICKABLE_SELECTOR = CLICKABLE_SELECTOR;
}
