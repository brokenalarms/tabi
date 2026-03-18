// Shared DOM traversal helpers — functions that find or navigate to
// a different element, or compute derived rects from the DOM.
// Used by both ElementGatherer and HintMode.

import { HEADING_SELECTOR, REPEATING_CONTAINER_SELECTOR } from "./constants";
import { hasBox, isVisible, isSubtreeRemoved } from "./elementPredicates";

/** Find the label associated with a form control (via for= or ancestor <label>). */
export function findAssociatedLabel(el: HTMLElement): HTMLElement | null {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label as HTMLElement;
  }
  const parent = el.closest("label");
  if (parent) return parent as HTMLElement;
  return null;
}

/** Find a label-wrapped checkbox/radio inside an element.
 *  Returns the input if visible; otherwise returns the label (which wraps
 *  the visual control icon). Used to redirect <a> hints to the checkbox area. */
export function findEmbeddedControl(el: HTMLElement): HTMLElement | null {
  const label = el.querySelector("label") as HTMLElement | null;
  if (!label) return null;
  const input = label.querySelector("input[type='checkbox'], input[type='radio']") as HTMLInputElement | null;
  if (!input) return null;
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

/** Half-leading: the space above and below text within a line box.
 *  Line-height distributes (lineHeight - fontSize) / 2 on each side. */
export function getHalfLeading(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const fontSize = parseFloat(style.fontSize) || 0;
  const lineHeight = parseFloat(style.lineHeight) || 0;
  return lineHeight > fontSize ? (lineHeight - fontSize) / 2 : 0;
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
