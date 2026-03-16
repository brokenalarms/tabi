// Stateless element predicates — each answers one question about an element.
// Used by walkerFilter (ElementGatherer) and hint positioning (HintMode).

import { HEADING_SELECTOR, REPEATING_CONTAINER_SELECTOR } from "./constants";

// --- Visibility & geometry ---

/** Is this rect non-zero and within the viewport? */
export function isOnScreen(rect: DOMRect): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  if (rect.right < 0 || rect.left > window.innerWidth) return false;
  return true;
}

/** Can children of this element still be visible?
 *  display:none is the only CSS property that irrecoverably hides all descendants.
 *  visibility:hidden and opacity:0 can be overridden by children. */
export function childrenCannotBeVisible(el: HTMLElement): boolean {
  return getComputedStyle(el).display === "none";
}

/** Stateless visibility check — does this element have a non-zero, on-screen,
 *  non-hidden rect? No clickability or occlusion logic — just geometry + CSS.
 *  Accepts an optional pre-computed rect (e.g. fallback rect for zero-size anchors). */
export function isVisible(el: HTMLElement, rect?: DOMRect): boolean {
  const r = rect ?? el.getBoundingClientRect();
  if (!isOnScreen(r)) return false;
  const style = getComputedStyle(el);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (parseFloat(style.opacity) === 0) return false;
  return true;
}

/** Does this element generate a CSS box?
 *  display:none and display:contents don't — overflow, sizing, and clipping
 *  properties have no effect on boxless elements. */
export function hasBox(el: HTMLElement): boolean {
  const display = getComputedStyle(el).display;
  return display !== "none" && display !== "contents";
}

// --- Intent & removal ---

/** Is this element in a subtree removed from the interaction tree?
 *  aria-hidden and inert cascade — any ancestor declaring these removes the
 *  entire subtree. The walker already REJECTs at the ancestor, so descendants
 *  are never visited. This predicate exists for elements found via
 *  elementsFromPoint (hit-testing bypasses the walker). */
export function isSubtreeRemoved(el: HTMLElement): boolean {
  if (el.closest("[aria-hidden='true']")) return true;
  if (el.closest("[inert]")) return true;
  return false;
}

/** Excluded by developer intent: subtree removal (aria-hidden, inert),
 *  element-level hidden attribute, or disabled state. */
export function isExcludedByIntent(el: HTMLElement): boolean {
  if (isSubtreeRemoved(el)) return true;
  if (el.hidden) return true;
  if ((el as HTMLButtonElement).disabled) return true;
  return false;
}

// --- Overflow & occlusion ---

/** Is this element clipped to an unusable size by an overflow ancestor?
 *  Checks overflowX/overflowY per axis — any value that isn't "visible" clips.
 *  Skips ancestors that have no box (display:contents/none) — overflow only
 *  applies to elements that generate a box. Rejects elements whose visible area
 *  within the clipping ancestor is too small to be a useful click target (< 4px). */
export function isClippedByOverflow(el: HTMLElement, rect: DOMRect): boolean {
  let ancestor = el.parentElement;
  while (ancestor && ancestor !== document.body) {
    if (hasBox(ancestor)) {
      const ancestorStyle = getComputedStyle(ancestor);
      const overflow = ancestorStyle.overflow;
      const ox = ancestorStyle.overflowX || overflow;
      const oy = ancestorStyle.overflowY || overflow;
      const clipsX = ox !== "" && ox !== "visible";
      const clipsY = oy !== "" && oy !== "visible";
      if (clipsX || clipsY) {
        const ar = ancestor.getBoundingClientRect();
        const visibleW = clipsX ? Math.max(0, Math.min(rect.right, ar.right) - Math.max(rect.left, ar.left)) : rect.width;
        const visibleH = clipsY ? Math.max(0, Math.min(rect.bottom, ar.bottom) - Math.max(rect.top, ar.top)) : rect.height;
        if (visibleW < 4 || visibleH < 4) return true;
      }
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

/** Does the ancestor contain the descendant in the composed tree?
 *  Like Node.contains(), but walks up through shadow root boundaries
 *  so shadow hosts are recognized as ancestors of their shadow DOM content. */
export function composedContains(ancestor: Node, descendant: Node): boolean {
  let node: Node | null = descendant;
  while (node) {
    if (node === ancestor) return true;
    const root = node.getRootNode();
    if (root !== node && root !== document && (root as any).host) {
      node = (root as any).host;
    } else {
      node = node.parentNode;
    }
  }
  return false;
}

/** Is this element occluded at any corner by an unrelated element?
 *  Tests all 4 corners (+2px inset) via elementsFromPoint. If ANY corner's
 *  topmost element is an unrelated, non-exempt cover, the element is occluded.
 *  Covers that are ancestors/descendants, in removed subtrees, or contentless
 *  overlays are exempt — they won't steal clicks or get their own hints. */
export function isOccluded(el: HTMLElement, rect: DOMRect): boolean {
  const clampX = (x: number) => Math.min(Math.max(x, 0), window.innerWidth - 1);
  const clampY = (y: number) => Math.min(Math.max(y, 0), window.innerHeight - 1);

  const isCover = (cover: HTMLElement): boolean => {
    if (composedContains(el, cover) || composedContains(cover, el)) return false;
    if (isSubtreeRemoved(cover)) return false;
    if (isContentlessOverlay(cover)) return false;
    if (isSiblingInRepeatingContainer(el, cover)) return false;
    return true;
  };

  // Check all 4 corners but require at least one BOTTOM corner to be covered.
  // Top-only coverage (e.g. a thin loading bar or header border overlapping the
  // top edge) doesn't block interaction — the element is still clickable below.
  const corners: [number, number, boolean][] = [
    [rect.left + 2, rect.top + 2, false],
    [rect.right - 2, rect.top + 2, false],
    [rect.left + 2, rect.bottom - 2, true],
    [rect.right - 2, rect.bottom - 2, true],
  ];

  for (const [x, y, isBottom] of corners) {
    const hits = document.elementsFromPoint(clampX(x), clampY(y));
    if (hits.length > 0 && isCover(hits[0] as HTMLElement)) {
      if (isBottom) return true;
    }
  }
  return false;
}

/** Are these two elements in sibling repeating containers (different <li>/<tr>
 *  sharing the same parent)? Adjacent items' overflowing content is not a real
 *  occluder — it's just sibling bleed from the same list/table. */
export function isSiblingInRepeatingContainer(a: HTMLElement, b: HTMLElement): boolean {
  const aItem = a.closest(REPEATING_CONTAINER_SELECTOR);
  const bItem = b.closest(REPEATING_CONTAINER_SELECTOR);
  return aItem !== null && bItem !== null &&
         aItem !== bItem &&
         aItem.parentElement === bItem.parentElement;
}

/** Is this a contentless overlay link?
 *  True for <a> with no text, no visual children (img, svg, etc.), and a sibling
 *  with visible content — the "stretched-link" card pattern where an empty <a>
 *  is positioned over a card whose visible text lives in a sibling element.
 *  Used in occlusion checks to exempt these overlays from blocking sibling
 *  interactive elements (e.g. comment links that poke through via z-index). */
export function isContentlessOverlay(el: HTMLElement): boolean {
  if (el.tagName.toLowerCase() !== "a") return false;
  if ((el.textContent || "").trim()) return false;
  if (el.querySelector("img, svg, picture, video, canvas")) return false;
  const adj = el.nextElementSibling || el.previousElementSibling;
  return adj !== null && (adj.textContent || "").trim().length > 0;
}

// --- Element characteristics ---

/** Does this element generate a block-level box?
 *  Unknown display values default to true — a block box can contain visible
 *  children even if the element itself has zero dimensions, so it's safer to
 *  over-count than to miss one.  Only inline and boxless values return false. */
export function isBlockLevel(el: HTMLElement): boolean {
  if (!hasBox(el)) return false;
  const display = getComputedStyle(el).display;
  return display !== "" && !display.startsWith("inline");
}

/** Is this element inside a vertically repeating container (list or table row)?
 *  Elements inside <li> or <tr> are part of a flowing layout where hints should
 *  stay centered on the full container width for vertical alignment.
 *  Only counts ancestors that have a box — a display:contents <li> isn't a
 *  real container and shouldn't affect hint positioning. */
export function isInRepeatingContainer(el: HTMLElement): boolean {
  const container = el.closest(REPEATING_CONTAINER_SELECTOR) as HTMLElement | null;
  return container !== null && hasBox(container);
}

/** Is this element large and rectangular enough for container-style hint placement?
 *  Checks minimum width, aspect ratio or viewport fraction, and box generation. */
export function isContainerSized(el: HTMLElement, rect: DOMRect): boolean {
  if (!hasBox(el)) return false;
  if (rect.width <= 64) return false;
  const isRectangular = rect.width / (rect.height || 1) >= 1.5;
  const isLarge = rect.width > window.innerWidth * 0.25;
  return isRectangular || isLarge;
}

/** Does this element contain a heading (h1–h6) as a descendant? */
export function hasHeadingContent(el: HTMLElement): boolean {
  return el.querySelector(HEADING_SELECTOR) !== null;
}