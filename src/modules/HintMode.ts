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

const CLICKABLE_SELECTOR = [
  "a", "button", "input", "textarea", "select",
  "summary", "details",
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
  private readonly _onMouseDown: () => void;

  constructor(keyHandler: KeyHandlerLike) {
    this._keyHandler = keyHandler;
    this._active = false;
    this._newTab = false;
    this._hints = [];
    this._typed = "";
    this._overlay = null;
    this._pointerTails = false;
    this._onMouseDown = this._deactivate.bind(this);
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
        if (this._isVisible(el as HTMLElement)) result.push(el as HTMLElement);
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
    const resultSet = new Set(result);
    const toRemove = new Set<HTMLElement>();
    for (const el of result) {
      let ancestor = el.parentElement;
      while (ancestor) {
        if (resultSet.has(ancestor as HTMLElement)) {
          toRemove.add(ancestor as HTMLElement);
        }
        ancestor = ancestor.parentElement;
      }
    }
    return result.filter(el => !toRemove.has(el));
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
      return false;
    }
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;

    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (parseFloat(style.opacity) === 0) return false;

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

    // Check if element is actually reachable (not covered by another element)
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    // Clamp to viewport
    const px = Math.min(Math.max(centerX, 0), window.innerWidth - 1);
    const py = Math.min(Math.max(centerY, 0), window.innerHeight - 1);
    const topEl = document.elementFromPoint(px, py);
    if (topEl && !el.contains(topEl) && !topEl.contains(el)) {
      // Also try the top-left corner in case the center is covered
      const tlEl = document.elementFromPoint(
        Math.min(Math.max(rect.left + 2, 0), window.innerWidth - 1),
        Math.min(Math.max(rect.top + 2, 0), window.innerHeight - 1)
      );
      if (!tlEl || (!el.contains(tlEl) && !tlEl.contains(el))) {
        return false;
      }
    }

    return true;
  }

  // --- Hint rect fallback for zero-size anchors ---

  private _getHintRect(el: HTMLElement): DOMRect {
    const rect = el.getBoundingClientRect();

    if (el.tagName === "A") {
      // Prefer a heading child for positioning — Google (and similar sites)
      // wrap <h3> + site info in one large <a>, and the heading is the
      // visual target the user expects the hint on.
      const heading = el.querySelector("h1, h2, h3, h4, h5, h6");
      if (heading) {
        const hr = heading.getBoundingClientRect();
        if (hr.width > 0 && hr.height > 0) {
          // Subtract paddingTop so hint aligns with actual text, not element box
          const paddingTop = parseFloat(getComputedStyle(heading).paddingTop) || 0;
          if (paddingTop > 0) {
            return new DOMRect(hr.left, hr.top + paddingTop, hr.width, hr.height - paddingTop);
          }
          return hr;
        }
      }

      // Use getClientRects() for inline elements — gives per-line-box rects,
      // avoiding inflated bounding rects from visually-hidden child spans
      const clientRects = el.getClientRects();
      if (clientRects.length > 0) {
        for (let i = 0; i < clientRects.length; i++) {
          const cr = clientRects[i];
          if (cr.width > 1 && cr.height > 1) return cr;
        }
      }

      // Zero-size anchor fallback (display:contents) — find first visible child
      if (rect.width === 0 && rect.height === 0) {
        for (const child of el.children) {
          const cr = (child as HTMLElement).getBoundingClientRect();
          if (cr.width > 0 && cr.height > 0) return cr;
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

  private _createOverlay(): void {
    this._overlay = document.createElement("div") as HTMLDivElement;
    this._overlay.className = "vimium-hint-overlay";
    document.body.appendChild(this._overlay);
  }

  private _createHintDiv(element: HTMLElement, label: string): HTMLDivElement {
    const rect = this._getHintRect(element);
    const div = document.createElement("div") as HTMLDivElement;
    div.className = "vimium-hint";
    div.textContent = label;
    if (this._pointerTails) {
      // Floating mode: centered below element, tail points up
      div.style.left = Math.max(0, rect.left + rect.width / 2) + "px";
      div.style.top = Math.max(0, rect.bottom + 2) + "px";
      div.style.transform = "translateX(-50%)";
      const tail = document.createElement("div");
      tail.className = "vimium-hint-tail";
      div.appendChild(tail);
    } else {
      // Inline mode: at left edge of element, overlapping text
      div.style.left = Math.max(0, rect.left) + "px";
      div.style.top = Math.max(0, rect.top) + "px";
    }

    this._overlay!.appendChild(div);
    return div;
  }

  // --- Key handling during HINTS mode (called via KeyHandler delegate) ---

  private _handleKey(event: KeyboardEvent): boolean {
    if (!this._active) return false;

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
  }

  // --- Cleanup ---

  private _deactivate(): void {
    if (!this._active) return;
    this._active = false;
    this._typed = "";
    this._keyHandler.clearModeKeyDelegate();
    document.removeEventListener("mousedown", this._onMouseDown, true);

    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
    this._overlay = null;

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
