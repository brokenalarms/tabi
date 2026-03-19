// HintMode — link-hint overlay for Tabi
// Renders labeled hints over discovered elements and dispatches
// clicks when the user types the matching label characters.

import type { ModeValue } from "../types";
import { DEFAULTS } from "../types";
import { discoverElements, renderDebugDots } from "./ElementGatherer";
import { HINT_HEIGHT } from "./constants";
import { isLargeEnoughForGlow, isFormControl, getRepeatingContainer, hasNestedLinks, isZeroSizeAnchor, shouldRedirectToHeading, hasBox } from "./elementPredicates";
import { LIST_BOUNDARY_SELECTOR, REPEATING_CONTAINER_SELECTOR } from "./constants";
import { findControlTarget, findVisibleChild, getHeading, getLinkContentRect, getBlockAncestorRect, getHeadingAncestorRect, clampRect, captureRetryStrategies, executeRetryStrategies } from "./elementTraversals";

import { Mode } from "../commands";
import { removeOverlay } from "./overlayUtils";

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

type HintModeType = "click" | "yank" | "multi";

interface Hint {
  element: HTMLElement;
  label: string;
  div: HTMLDivElement;
}

interface MultiSelection {
  hint: Hint;
}

type HintStyle = "pill" | "containerGlow";

type HintPlacement =
  | { style: "pill"; rect: DOMRect }
  | { style: "containerGlow"; rect: DOMRect; container: HTMLElement };

/** Strategy for applying ContainerGlow to elements sharing a repeating container parent.
 *  - "any": at least one container qualifies → all siblings get ContainerGlow
 *  - "all": every container must qualify for any to get ContainerGlow
 *  - "none": never use ContainerGlow (always Pill) */
type ContainerGlowStrategy = "any" | "all" | "none";
const CONTAINER_GLOW_STRATEGY: ContainerGlowStrategy = "all";

const HINT_CHARS = "sadgjklewcmpoh";

/** How far (px) a hinted element may drift before we dismiss hints. */
const DRIFT_THRESHOLD = 5;
/** How often (ms) we check for position drift. */
const DRIFT_CHECK_INTERVAL = 200;

export class HintMode {
  private keyHandler: KeyHandlerLike;
  private active: boolean;
  private willOpenNewTab: boolean;
  private modeType: HintModeType;
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
  /** Multi-select: accumulated selections waiting for Space to execute. */
  private multiSelections: MultiSelection[];
  /** Multi-select: status bar element shown at bottom of viewport. */
  private statusBar: HTMLDivElement | null;

  constructor(keyHandler: KeyHandlerLike) {
    this.keyHandler = keyHandler;
    this.active = false;
    this.willOpenNewTab = false;
    this.modeType = "click";
    this.hints = [];
    this.typed = "";
    this.overlay = null;
    this.activating = false;
    this.onMouseDown = this.deactivate.bind(this);
    this.onScroll = this.deactivate.bind(this);
    this.onResize = this.deactivate.bind(this);
    this.driftTimer = null;
    this.hintPlacementMap = new Map();
    this.multiSelections = [];
    this.statusBar = null;
  }

  // --- Public API ---

  activate(shiftHeld: boolean, mode: HintModeType = "click"): void {
    if (this.active) {
      this.deactivate();
      return;
    }
    this.willOpenNewTab = shiftHeld;
    this.modeType = mode;
    this.active = true;
    this.typed = "";
    this.multiSelections = [];
    this.keyHandler.setMode(Mode.HINTS);

    let elements = discoverElements((el: HTMLElement) => this.getHintRect(el));
    if (mode === "yank" || mode === "multi") {
      elements = elements.filter(el =>
        el.tagName.toLowerCase() === "a" && (el as HTMLAnchorElement).href
      );
    }
    if (elements.length === 0) {
      this.deactivate();
      return;
    }

    // Resolve hint placement. ContainerGlow is all-or-none per container
    // group (siblings sharing the same repeating-container parent).
    // Disqualified immediately if any container has nested discovered
    // links (glow label would clash with their hints). Beyond that,
    // size eligibility is decided by CONTAINER_GLOW_STRATEGY ("any"/"all").
    type ContainerCandidate = { el: HTMLElement; rect: DOMRect; container: HTMLElement; noNestedLinks: boolean; glowEligible: boolean };
    const containerGroups = new Map<HTMLElement, ContainerCandidate[]>();

    const discoveredSet = new Set(elements);

    for (const el of elements) {
      const rect = this.getHintRect(el);
      const target = this.getHintTargetElement(el);
      const container = target === el ? getRepeatingContainer(el) : null;

      if (container && CONTAINER_GLOW_STRATEGY !== "none") {
        const noNestedLinks = !hasNestedLinks(container, el, discoveredSet);
        const nestedList = container.querySelector(LIST_BOUNDARY_SELECTOR);
        const containerRect = nestedList
          ? this.clampRectToHeader(container.getBoundingClientRect(), nestedList as HTMLElement)
          : container.getBoundingClientRect();
        const glowEligible = nestedList !== null || isLargeEnoughForGlow(container, containerRect);
        const parent = container.parentElement || container;

        let group = containerGroups.get(parent);
        if (!group) {
          group = [];
          containerGroups.set(parent, group);
        }
        group.push({ el, rect, container, noNestedLinks, glowEligible });
      } else {
        this.hintPlacementMap.set(el, { style: "pill", rect });
      }
    }

    // Add sibling containers that have no discovered elements to the
    // group so they participate in the same all-or-none glow decision.
    // Repeating containers (li, tr) in the same parent share the same
    // interaction pattern — if some get glow, all should.
    for (const [parent, group] of containerGroups) {
      const containersInGroup = new Set(group.map(g => g.container));
      for (const child of parent.children) {
        const c = child as HTMLElement;
        if (containersInGroup.has(c)) continue;
        if (!c.matches(REPEATING_CONTAINER_SELECTOR)) continue;
        if (!hasBox(c)) continue;
        const nestedList = c.querySelector(LIST_BOUNDARY_SELECTOR);
        const containerRect = nestedList
          ? this.clampRectToHeader(c.getBoundingClientRect(), nestedList as HTMLElement)
          : c.getBoundingClientRect();
        const glowEligible = nestedList !== null || isLargeEnoughForGlow(c, containerRect);
        elements.push(c);
        group.push({ el: c, rect: containerRect, container: c, noNestedLinks: true, glowEligible });
      }
    }

    for (const [, group] of containerGroups) {
      const allFreeOfNestedHints = group.every(g => g.noNestedLinks);
      const groupSized = CONTAINER_GLOW_STRATEGY === "any"
        ? group.some(g => g.glowEligible)
        : group.every(g => g.glowEligible);
      const useGlow = allFreeOfNestedHints && groupSized;

      for (const { el, rect, container } of group) {
        if (useGlow) {
          this.hintPlacementMap.set(el, { style: "containerGlow", rect, container });
        } else {
          this.hintPlacementMap.set(el, { style: "pill", rect });
        }
      }
    }

    const labels = HintMode.generateLabels(elements.length);
    this.createOverlay();
    if (this.overlay) renderDebugDots(this.overlay, elements);
    this.hints = elements.map((el, i) => {
      const label = labels[i];
      const div = this.createHintDiv(el, label);
      return { element: el, label, div };
    });

    this.createStatusBar();

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
    this.modeType = "click";
    this.activating = false;
    this.multiSelections = [];
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
    for (const ring of document.documentElement.querySelectorAll(".tabi-hint-ring:not(.tabi-hint-ring-out)")) {
      ring.remove();
    }

    if (this.overlay) {
      this.overlay.classList.remove("visible");
      const overlay = this.overlay;
      overlay.addEventListener("transitionend", () => {
        removeOverlay(overlay);
      }, { once: true });
      this.overlay = null;
    }

    if (this.statusBar) {
      this.statusBar.remove();
      this.statusBar = null;
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
    this.keyHandler.on("yankLink", () => this.activate(false, "yank"));
    this.keyHandler.on("multiOpen", () => this.activate(false, "multi"));
  }

  unwireCommands(): void {
    this.keyHandler.off("activateHints");
    this.keyHandler.off("activateHintsNewTab");
    this.keyHandler.off("yankLink");
    this.keyHandler.off("multiOpen");
  }

  destroy(): void {
    this.deactivate();
    this.unwireCommands();
  }

  // --- Layout drift detection ---

  /** Periodically check whether hinted elements have shifted from their
   *  original positions. Dismisses hints when a majority of sampled
   *  elements have drifted, indicating a real layout shift rather than
   *  a single animated element (e.g. Amazon carousel). */
  private startDriftCheck(): void {
    const MAX_SAMPLE = 5;
    const entries = [...this.hintPlacementMap.keys()];
    // Evenly spaced sample so we don't just check the first few
    const step = Math.max(1, Math.floor(entries.length / MAX_SAMPLE));
    // Snapshot rects NOW (post-render) rather than using the pre-render rects
    // from hintPlacementMap. Inserting the overlay and hint divs can cause
    // minor layout shifts, especially on large/zoomed viewports — using
    // pre-render rects as the baseline would falsely trigger drift dismissal.
    const sample: Array<[HTMLElement, DOMRect]> = [];
    for (let i = 0; i < entries.length && sample.length < MAX_SAMPLE; i += step) {
      sample.push([entries[i], entries[i].getBoundingClientRect()]);
    }

    this.driftTimer = setInterval(() => {
      let drifted = 0;
      for (const [el, original] of sample) {
        const current = el.getBoundingClientRect();
        if (Math.abs(current.top - original.top) > DRIFT_THRESHOLD ||
            Math.abs(current.left - original.left) > DRIFT_THRESHOLD) {
          drifted++;
        }
      }
      // Majority of sampled elements must have drifted
      if (drifted > sample.length / 2) {
        this.deactivate();
      }
    }, DRIFT_CHECK_INTERVAL);
  }

  // --- Hint target element ---

  private getHintTargetElement(el: HTMLElement): HTMLElement {
    const rect = el.getBoundingClientRect();

    const controlTarget = findControlTarget(el);
    if (controlTarget) return controlTarget;

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

    // Narrow <a> rects to text content bounds (children union or padding-subtracted).
    // Redirected targets (heading, label) are already text-sized.
    if (el === target && el.tagName.toLowerCase() === "a") {
      rect = getLinkContentRect(target, rect);
    }

    // Clamp to heading ancestor bounds when <a> is inside <h1>–<h6>.
    // The heading's block rect has the correct height; the <a>'s inline
    // rect has the correct width. The intersection gives both.
    const headingRect = getHeadingAncestorRect(target);
    if (headingRect) rect = clampRect(rect, headingRect);

    // Expand width to repeating container ancestor for aligned hints in lists.
    if (!isFormControl(target)) {
      rect = getBlockAncestorRect(target, rect) ?? rect;
    }

    return rect;
  }

  // --- Clipboard ---

  static copyToClipboard(text: string): void {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
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
    const stale = document.documentElement.querySelector(".tabi-hint-overlay");
    if (stale) stale.remove();

    this.overlay = document.createElement("div");
    this.overlay.className = `tabi-hint-overlay${DEFAULTS.animate ? " tabi-hint-animate" : ""}`;
    document.documentElement.appendChild(this.overlay);
    void this.overlay.offsetHeight;
    this.overlay.classList.add("visible");
  }

  private createHintDiv(element: HTMLElement, label: string): HTMLDivElement {
    const placement = this.hintPlacementMap.get(element);
    const div = document.createElement("div");
    div.className = "tabi-hint";
    div.textContent = label;

    if (placement) {
      switch (placement.style) {
        case "containerGlow":
          this.positionContainerGlow(div, placement.container);
          break;
        case "pill":
          this.positionPill(div, placement.rect);
          break;
      }
    }

    if (this.overlay) this.overlay.appendChild(div);
    return div;
  }

  /** Clamp container rect to end before a nested list element. */
  private clampRectToHeader(rect: DOMRect, nestedList: HTMLElement): DOMRect {
    const listTop = nestedList.getBoundingClientRect().top;
    if (listTop > rect.top) {
      return new DOMRect(rect.left, rect.top, rect.width, listTop - rect.top);
    }
    return rect;
  }

  /** Glow border on repeating container + inside-end pill label. */
  private positionContainerGlow(div: HTMLDivElement, container: HTMLElement): void {
    let glowRect = container.getBoundingClientRect();
    const nestedList = container.querySelector(LIST_BOUNDARY_SELECTOR);
    if (nestedList) {
      glowRect = this.clampRectToHeader(glowRect, nestedList as HTMLElement);
    }
    const glow = document.createElement("div");
    glow.className = "tabi-hint-container-glow";
    const glowPos = this.viewportToDocument(glowRect.left, glowRect.top);
    glow.style.left = glowPos.x + "px";
    glow.style.top = glowPos.y + "px";
    glow.style.width = glowRect.width + "px";
    glow.style.height = glowRect.height + "px";
    if (this.overlay) this.overlay.appendChild(glow);

    const verticalInset = (glowRect.height - HINT_HEIGHT) / 3;
    const insetRight = Math.min(verticalInset, 24);
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
    tail.className = "tabi-hint-tail";
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

    const dismissCodes: Record<HintModeType, string> = { click: "KeyF", yank: "KeyY", multi: "KeyM" };
    const dismissCode = dismissCodes[this.modeType];
    if (event.code === dismissCode && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.deactivate();
      return true;
    }

    if (event.code === "Escape") return false;

    // Multi mode: Space or Enter executes all accumulated selections
    if (this.modeType === "multi" && (event.code === "Space" || event.code === "Enter")) {
      event.preventDefault();
      event.stopPropagation();
      this.executeMultiSelections();
      return true;
    }

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
      if (this.modeType === "yank") {
        // Copy immediately while still inside the user-gesture event chain
        // so Safari doesn't block execCommand('copy') as click-jacking.
        const url = (match.element as HTMLAnchorElement).href;
        HintMode.copyToClipboard(url);
        this.deactivate();
      } else if (this.modeType === "multi") {
        this.selectForMulti(match);
      } else {
        this.activateHint(match);
      }
    }
    return true;
  }

  private updateHintVisibility(): void {
    const selectedSet = this.modeType === "multi"
      ? new Set(this.multiSelections.map(s => s.hint))
      : null;

    for (const hint of this.hints) {
      // In multi mode, selected hints always stay visible
      const isSelected = selectedSet !== null && selectedSet.has(hint);
      const matches = hint.label.startsWith(this.typed);
      hint.div.style.display = (matches || isSelected) ? "" : "none";
      if (matches && !isSelected) {
        const matched = hint.label.slice(0, this.typed.length);
        const remaining = hint.label.slice(this.typed.length);
        hint.div.innerHTML = "";
        if (matched) {
          const span = document.createElement("span");
          span.className = "tabi-hint-matched";
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

    hint.div.classList.add("tabi-hint-active");

    // Focus ring around the full clickable element (not the text target)
    const ring = document.createElement("div");
    ring.className = "tabi-hint-ring";
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
        const captured = captureRetryStrategies(element);
        const opts = { bubbles: true, cancelable: true, view: window };
        element.dispatchEvent(new MouseEvent("mousedown", opts));
        element.dispatchEvent(new MouseEvent("mouseup", opts));
        element.click();
        executeRetryStrategies(captured);
      }

      // Fade out the ring
      ring.classList.add("tabi-hint-ring-out");
      ring.addEventListener("animationend", () => ring.remove(), { once: true });
    };

    hint.div.addEventListener("animationend", afterCollapse, { once: true });
  }

  // --- Multi-select ---

  private selectForMulti(hint: Hint): void {
    // Already selected — deselect
    const existingIdx = this.multiSelections.findIndex(s => s.hint === hint);
    if (existingIdx >= 0) {
      this.multiSelections.splice(existingIdx, 1);
      hint.div.classList.remove("tabi-hint-selected");
    } else {
      this.multiSelections.push({ hint });
      hint.div.classList.add("tabi-hint-selected");
    }

    // Reset typed buffer and show all unselected hints again
    this.typed = "";
    this.updateHintVisibility();
    this.updateStatusBar();
  }

  private executeMultiSelections(): void {
    const selections = [...this.multiSelections];
    this.deactivate();

    for (const { hint } of selections) {
      const element = hint.element;
      const isLink = element.tagName.toLowerCase() === "a" && (element as HTMLAnchorElement).href;

      if (isLink) {
        browser.runtime.sendMessage({
          command: "createTab",
          url: (element as HTMLAnchorElement).href,
        });
      } else {
        const opts = { bubbles: true, cancelable: true, view: window };
        element.dispatchEvent(new MouseEvent("mousedown", opts));
        element.dispatchEvent(new MouseEvent("mouseup", opts));
        element.click();
      }
    }
  }

  private static readonly MODE_LABELS: Record<HintModeType, string> = {
    click: "Hint mode",
    yank: "Link copy mode",
    multi: "Multi-select mode",
  };

  private createStatusBar(): void {
    this.statusBar = document.createElement("div");
    this.statusBar.className = "tabi-mode-bar";
    this.updateStatusBar();
    document.documentElement.appendChild(this.statusBar);
  }

  private updateStatusBar(): void {
    if (!this.statusBar) return;
    this.statusBar.textContent = HintMode.MODE_LABELS[this.modeType];
  }
}
