// Shared DOM traversal helpers — functions that find or navigate to
// a different element, or compute derived rects from the DOM.
// Used by both ElementGatherer and HintMode.

import { HEADING_SELECTOR, REPEATING_CONTAINER_SELECTOR, LIST_BOUNDARY_TAGS } from "./constants";
import { hasBox, isVisible, isSubtreeRemoved, isRedirectableControl, isEmpty } from "./elementPredicates";

/** Find the label associated with a form control (via for= or ancestor <label>).
 *  Used by ElementGatherer for discovery (label rect as fallback for zero-size
 *  inputs) and dedup (removing duplicate label when input is also discovered).
 *  Hint positioning uses findControlTarget instead. */
export function findAssociatedLabel(el: HTMLElement): HTMLElement | null {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label as HTMLElement;
  }
  const parent = el.closest("label");
  if (parent) return parent as HTMLElement;
  return null;
}

/** Resolve a label+input pair to the right hint target element.
 *  Handles two configurations:
 *  1. Element IS a checkbox/radio — looks up for its associated label
 *  2. Element CONTAINS a label wrapping a checkbox/radio — looks down
 *  In both cases: visible input → input, hidden input → label.
 *  Used by HintMode for positioning — decides WHERE the hint lands,
 *  not whether the element is discovered (that's ElementGatherer's job). */
export function findControlTarget(el: HTMLElement): HTMLElement | null {
  let input: HTMLElement | null = null;
  let label: HTMLElement | null = null;

  if (isRedirectableControl(el)) {
    input = el;
    label = findAssociatedLabel(el);
  } else {
    label = el.querySelector("label") as HTMLElement | null;
    if (label) {
      input = label.querySelector("input[type='checkbox'], input[type='radio']") as HTMLElement | null;
    }
  }

  if (!input || !label) return null;
  if (isVisible(input) && !isSubtreeRemoved(input)) return input;
  return label;
}

/** Return the first child with non-zero dimensions, or null. */
export function findVisibleChild(el: HTMLElement): HTMLElement | null {
  for (const child of el.children) {
    const cr = (child as HTMLElement).getBoundingClientRect();
    if (cr.width > 0 && cr.height > 0) return child as HTMLElement;
  }
  return null;
}

/** Return the first heading descendant (h1–h6), or null. */
export function getHeading(el: HTMLElement): HTMLElement | null {
  return el.querySelector(HEADING_SELECTOR) as HTMLElement | null;
}

/** If el is inside a heading, return the heading's rect to clamp against.
 *  The heading's block rect has the correct height (tighter line-height),
 *  while the inline <a> has the correct width. */
export function getHeadingAncestorRect(el: HTMLElement): DOMRect | null {
  const heading = el.closest(HEADING_SELECTOR) as HTMLElement | null;
  return heading ? heading.getBoundingClientRect() : null;
}

/** Clamp rect to the bounds of a container rect — takes the intersection
 *  so each edge uses whichever is tighter. */
export function clampRect(rect: DOMRect, bounds: DOMRect): DOMRect {
  const left = Math.max(rect.left, bounds.left);
  const top = Math.max(rect.top, bounds.top);
  const right = Math.min(rect.right, bounds.right);
  const bottom = Math.min(rect.bottom, bounds.bottom);
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

// --- Hint rect helpers ---

/** Union bounding rect of an element's visible children, or null if none.
 *  Used to narrow an <a>'s rect to its actual content (e.g. a <span> inside
 *  a padded nav link, or an <img> inside a card thumbnail). */
export function getChildrenContentRect(el: HTMLElement): DOMRect | null {
  let left = Infinity, right = -Infinity;
  let top = Infinity, bottom = -Infinity;
  for (const child of el.children) {
    const cr = (child as HTMLElement).getBoundingClientRect();
    if (cr.width > 0 && cr.height > 0) {
      left = Math.min(left, cr.left);
      right = Math.max(right, cr.right);
      top = Math.min(top, cr.top);
      bottom = Math.max(bottom, cr.bottom);
    }
  }
  if (left >= right || top >= bottom) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Content-tight rect for an <a> element. Narrows to children's union rect
 *  when children are present, or subtracts padding-bottom for text-only links.
 *  Returns the original rect unchanged if no narrowing applies. */
export function getLinkContentRect(el: HTMLElement, rect: DOMRect): DOMRect {
  if (el.children.length > 0) {
    return getChildrenContentRect(el) ?? rect;
  }
  const paddingBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
  return new DOMRect(rect.left, rect.top, rect.width, rect.height - paddingBottom);
}

/** Walk up through single-child ancestors to the nearest repeating container
 *  (li, tr) for hint width expansion. Only repeating containers benefit from
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

/** Expand rect width to the nearest repeating container ancestor for aligned
 *  hints in vertical lists. Returns the expanded-width rect (ancestor's
 *  horizontal extent, element's vertical position), or null if no qualifying
 *  ancestor exists or the ancestor has mixed text content. */
export function getBlockAncestorRect(el: HTMLElement, rect: DOMRect): DOMRect | null {
  const ancestor = findBlockAncestor(el);
  if (!ancestor) return null;
  const hasMixedContent = Array.from(ancestor.childNodes).some(
    n => n.nodeType === 3 && (n.textContent || "").trim().length > 0
  );
  if (hasMixedContent) return null;
  const ancestorRect = ancestor.getBoundingClientRect();
  return new DOMRect(ancestorRect.left, rect.top, ancestorRect.width, rect.height);
}

// --- Click retry strategies ---
// When clicking an element with aria-expanded doesn't toggle it, these
// strategies try alternative click targets. Each returns true if it
// found a target to click.

/** Find the first non-empty descendant by walking children.
 *  Skips contentless elements and list boundaries. If only one
 *  non-empty child exists at a level, recurses into it (it's a wrapper).
 *  If multiple exist, returns the first (the likely interactive target). */
function findFirstContentChild(el: HTMLElement): HTMLElement | null {
  const children = Array.from(el.children) as HTMLElement[];
  const first = children.find(c => !LIST_BOUNDARY_TAGS.has(c.tagName) && !isEmpty(c));
  if (!first) return null;
  return findFirstContentChild(first) ?? first;
}

// --- Click retry strategies ---
// Each strategy is a factory: given an element, returns { didChange, retry }
// if applicable, or null if not. The closure captures initial state.
// IMPORTANT: strategies must be created BEFORE the click so they snapshot
// the pre-click state. Otherwise a synchronous handler that updates
// aria-expanded (etc.) will cause the retry to see the post-click value
// as the baseline and double-click, undoing the toggle.

type RetryStrategy = (el: HTMLElement) => {
  didChange: () => boolean;
  retry: () => void;
} | null;

/** For elements with aria-expanded: click the first non-empty descendant
 *  (e.g. a toggle chevron inside a treeitem). */
export const retryExpandedToggle: RetryStrategy = (el) => {
  const before = el.getAttribute("aria-expanded");
  if (before === null) return null;
  return {
    didChange: () => el.getAttribute("aria-expanded") !== before,
    retry: () => {
      const target = findFirstContentChild(el);
      if (target) target.click();
    },
  };
};

const RETRY_STRATEGIES: RetryStrategy[] = [retryExpandedToggle];

type CapturedStrategy = { didChange: () => boolean; retry: () => void };

/** Snapshot all applicable retry strategies BEFORE the click.
 *  Returns captured results to pass to executeRetryStrategies(). */
export function captureRetryStrategies(element: HTMLElement, strategies = RETRY_STRATEGIES): CapturedStrategy[] {
  const captured: CapturedStrategy[] = [];
  for (const strategy of strategies) {
    const result = strategy(element);
    if (result) captured.push(result);
  }
  return captured;
}

const nextFrame = (): Promise<void> =>
  new Promise(resolve => requestAnimationFrame(() => resolve()));

/** After the click, run through pre-captured strategies: if the click
 *  already toggled the state, do nothing; otherwise retry with an
 *  alternative click target. */
export async function executeRetryStrategies(captured: CapturedStrategy[]): Promise<void> {
  for (const result of captured) {
    await nextFrame();
    if (result.didChange()) return;
    result.retry();
    await nextFrame();
    if (result.didChange()) return;
  }
}
